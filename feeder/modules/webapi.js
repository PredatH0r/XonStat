var
  log4js = require("log4js"),
  request = require("request"),
  gsq = require("gamedig"),
  Q = require("q"),
  dns = require("dns"),
  gr = require("./gamerating"),
  utils = require("./utils");

exports.init = init;

var DEBUG = false;
var _config;
var _logger = log4js.getLogger("webapi");

var GameTypes = { 0: "FFA", 1: "Duel", 2: "Race", 3: "TDM", 4: "CA", 5: "CTF", 6: "1Flag", 8: "Harv", 9: "FT", 10: "Dom", 11: "A&D", 12: "RR" };

// interface for communication with the feeder.node.js module
var _feeder = {
  getStatsConnections: function () { },
  isTeamGame: function(gt) {}
};

var _getServerSkillratingCache = { timestamp: 0, data: null, updatePromise: null };
var _getServerBrowserInfoCache = { };
var _getPlayerSkillratingsCache = { timestamp: 0, data: {}, updatePromise: null };
var _getAggregatedStatusDataCache = { timestamp: 0, data: {}, updatePromise: null };
var _getZmqFromGamePortCache = { timestamp: 0, data: {}, updatePromise: null };
var _getProsNowPlayingCache = { timestamp: 0, data: {}, updatePromise: null }


/**
 * Initializes the module and sets up the API routes in the express HTTP server
 * @param {} config - cfg.json object
 * @param {} app - express application object
 * @param {} feeder - interface with callback functions to the feeder module
 */
function init(config, app, feeder) {
  _config = config;
  _feeder = feeder;
  _logger.setLevel(config.webapi.logLevel || "INFO");

  // Internal API methods

  var prefix = _config.webapi.urlprefix;

  app.get(prefix + "/server/statusdump", function(req, res) {
    Q(getServerStatusdump(req))
      .then(function(obj) { res.json(obj); })
      .catch(function(err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
      .finally(function() { res.end(); });
  });

  app.get(prefix + "/player/:id/locate", function(req, res) {
    Q(locatePlayer(req, res))
      .then(function (obj) { res.json(obj); })
      .catch(function (err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
      .finally(function () { res.end(); });
  });

  // this URL is served directly off the various server panels so that a qtv client can get the event stream
  app.get(_config.webadmin.urlprefix + "/qtv/:addr/stream", function (req, res) {
    Q(getQtvEventStream(req, res))
      .then(function (obj) { res.json(obj); })
      .catch(function (err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
      .finally(function () { res.end(); });
  });

  if (!_config.webapi.enabled)
    return;

  // Public API methods

  if (_config.webapi.allowJsonDownload) {
    // API to access raw match data has been disabled for GDPR compliance

    app.get(prefix + "/jsons", function(req, res) {
      Q(queryJson(req))
        .then(function(obj) { res.json(obj); })
        .catch(function(err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
        .finally(function() { res.end(); });
    });

    app.get(prefix + "/jsons/:date/:file.json(.gz)?", function(req, res) {
      Q(getJson(req, res))
        .catch(function(err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
        .finally(function() { res.end(); });
    });
  }

  app.get(prefix + "/server/skillrating", function(req, res) {
    Q(getServerSkillrating(req))
      .then(function(obj) { res.json(obj); })
      .catch(function(err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
      .finally(function() { res.end(); });
  });

  app.get(prefix + "/server/:addr/players", function(req, res) {
    Q(getServerPlayers(req, res))
      .then(function(obj) { res.json(obj); })
      .catch(function(err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
      .finally(function() { res.end(); });
  });

  app.get(prefix + "/a_rated_factories", function(req, res) {
    Q(getARatedFactories(req))
      .then(function (obj) { res.json(obj); })
      .catch(function (err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
      .finally(function () { res.end(); });
  });

  app.get(prefix + "/nowplaying", function(req, res) {
    Q(getProsNowPlaying(req, res))
      .then(function (obj) { res.json(obj); })
      .catch(function (err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
      .finally(function () { res.end(); });
  });

  app.get(prefix + "/qtv/:addr/url", function (req, res) {
    Q(getQtvEventStreamUrl(req, res))
      .then(function (obj) { res.json(obj); })
      .catch(function (err) { res.json({ ok: false, msg: "internal error: " + err, stacktrace: err.stack }); })
      .finally(function () { res.end(); });
  });

}


/**
 * Query the database for a list of match-GUIDs + match dates for a given server. With that information the JSONs can be downloaded through getJson().
 * Used by kodisha to pull JSONs for omega CTF servers
 * @param { query: {server, date} req express request, server="ip:port", date="YYYY-MM-ddTHH:mm:ssZ"
 * @returns {ok=false, msg} | [{end, match_id}]
 */
function queryJson(req) {
  return utils.dbConnect(_config.webapi.database)
    .then(function(cli) {
      if (!req.query.server)
        return { ok: false, msg: "'server' query parameter must be specified for the numeric server id" };
      if (!req.query.date)
        return { ok: false, msg: "'date' query parameter must be specified as a UTC timestamp (YYYY-MM-ddTHH:mm:ssZ)" };

      var cond = "";
      var values = [req.query.server, req.query.date];
      // TODO: add optional query criteria

      return Q.ninvoke(cli, "query", { name: "json_query", text: "select start_dt as end, match_id as id from games where server_id=$1 and start_dt>=$2 " + cond + " order by start_dt", values: values })
        .then(function(result) { return result.rows; })
        .finally(function() { cli.release(); });
    });
}

/**
 * Retrieve a JSON [.gz] data file based on the match date and match GUID.
 * @param { params: {date, file}, path} req express request. date="YYYY-mm-dd", file=GUID, path="*.json[.gz]"
 * @param {} res 
 * @returns {} 
 */
function getJson(req, res) {
  var ts = Date.parse(req.params.date);
  if (ts == NaN || !ts)
    return Q(res.json({ ok: false, msg: "Date must be provided in YYYY-MM-DD format" }));

  var date = new Date(ts);
  var dir = (_config.feeder.jsondir.startsWith("/") ? "" : __dirname + "/../") +
      _config.feeder.jsondir + "/" + date.getUTCFullYear() + "-" + ("0" + (date.getUTCMonth() + 1)).substr(-2) + "/" + ("0" + date.getUTCDate()).substr(-2) + "/";
  var asGzip = req.path.substr(-3) == ".gz";
  var options = {
    root: dir,
    dotfiles: "deny",
    headers: asGzip ? { } : { "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip" }
  };
  return Q.ninvoke(res, "sendFile", req.params.file + ".json.gz", options).catch(function() { return res.json({ ok: false, msg: "File not found" }) });
}

/**
 * Returns a list of all players which appeared on a ZMQ message for the given server.
 * This API method is used by SteamServerBrowser to get players, ratings, team info, steamid, ... for the currently selected server.
 * @param {} req express request
 * @param {} res express response
 * @returns {ok, players:[{steamid, name, team, rating, rd, time}], serverinfo:{addr, gt, min, avg, max, pc, bc, sc, map}} 
 */
function getServerPlayers(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  var gameAddr = req.params.addr;
  if (!gameAddr) return { ok: false, msg: "No server address specified" };

  return Q.all([getAggregatedServerStatusData(), getSkillRatings(), getZmqFromGamePort(), resolveServerAddr(gameAddr)])
    .then(function(info) {
      var serverStatus = info[0];
      var ratings = info[1];
      var portMapping = info[2];
      gameAddr = info[3];
      var zmqAddr = portMapping[gameAddr] || gameAddr;
      var status = serverStatus[zmqAddr];
      if (!status) return { ok: false, msg: "Server is not being tracked" };

      return getServerBrowserInfo(gameAddr)
        .then(function(info) {
          var gt = info && info.gt || status.gt;
          var keys = status.p ? Object.keys(status.p) : [];
          var factory = info && info.raw.rules.g_factory || status.f;
          var serverinfo = calcServerInfo(zmqAddr, status, gt, factory, ratings);
          var players = keys.reduce(function(result, steamid) {
            var player = status.p[steamid];
            if (!player.quit) {
              var rating = gt && ratings && ratings[steamid] ? ratings[steamid][gt] || {} : {};
              result.push({
                steamid: steamid, name: player.name, team: player.team,
                rating: serverinfo.rating == "A" ? rating.r : rating.b_r,
                rd:  serverinfo.rating == "A" ? rating.rd : rating.b_rd,
                time: player.time
              });
            }
            return result;
          }, []);
          if (info) {
            serverinfo.map = info.raw.rules.mapname;
            serverinfo.mapstart = info.raw.rules.g_gameState == "IN_PROGRESS" ? info.raw.rules.g_levelStartTime : 0;
            if (_feeder.isTeamGame(gt)) {
              serverinfo.scoreRed = info.raw.rules.g_redScore;
              serverinfo.scoreBlue = info.raw.rules.g_blueScore;
            }
          }
          return { ok: true, players: players, serverinfo: serverinfo };
        });
    });
}

/**
 * Locate the server where a player with a given steamid is playing
 * @param { params: { id } req express request
 * @param {} res 
 * @returns { ok: true, steamid, server: null | "ip:port" } 
 */
function locatePlayer(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  if (!_config.webapi.enabled && !isInternalRequest(req))
    return { ok: false, msg: "For internal use only" };

  var steamid = req.params.id;
  var stats = _feeder.getStatsConnections();
  for (var addr in stats) {
    if (!stats.hasOwnProperty(addr)) continue;
    var conn = stats[addr];
    if (conn.players[steamid] && !conn.players[steamid].quit)
      return { ok: true, steamid: steamid, server: conn.addr };
  }

  if (_config.webapi.aggregatePanelPorts.length == 0)
    return { ok: true, steamid: steamid, server: null };

  var tasks = [];
  _config.webapi.aggregatePanelPorts.forEach(function(port) {
    tasks.push(getJsonFromPort(port, _config.webapi.urlprefix + "/player/" + steamid + "/locate"));
  });
  return Q
    .allSettled(tasks)
    .then(function(results) {
      for (var i = 0; i < results.length; i++) {
        var result = results[i];
        if (result.state != "fulfilled") continue;
        if (result.value && result.value.server)
          return result.value;
      }
      return { ok: true, steamid: steamid, server: null };
    });
}


/**
 * Method used by SteamServerBrowser for the initial list of all servers to get the skill rating and correct number of players (without ghosts)
 * @returns data or promise for [{server, gt, min, avg, max, pc, sc, bc}]
 */
function getServerSkillrating() {
  var now = Date.now();
  if (_getServerSkillratingCache.timestamp + 15000 > now)
    return _getServerSkillratingCache.data;
  if (_getServerSkillratingCache.updatePromise != null)
    return _getServerSkillratingCache.updatePromise;

  return _getServerSkillratingCache.updatePromise = Q
    .all([getAggregatedServerStatusData(), getSkillRatings()])
    .then(function(results) { return rateServers(results[0], results[1]); })
    .catch(function(err) {
      _logger.error(err);
      throw err;
    })
    .finally(function() { _getServerSkillratingCache.updatePromise = null; });

  // combine information from players on servers with player ratings
  function rateServers(serverStatus, skillInfo) {
    var info = [];
    var addrs = Object.keys(serverStatus);
    var delay = 0;
    addrs.forEach(function(addr) {
      var conn = serverStatus[addr];
      var gameAddr = conn.gp ? addr.substr(0, addr.indexOf(":") + 1) + conn.gp : addr;
      var gt = conn.gt || (_getServerBrowserInfoCache[gameAddr] || {})["gt"];
      var factory = (_getServerBrowserInfoCache[gameAddr] || {})["factory"];
      if (!gt) {
        // execute browser query in the background and put the result in the cache for the next call to this API
        Q.delay(delay += 10).then(function() {
          getServerBrowserInfo(gameAddr);
        }).catch();
        return;
      }

      info.push(calcServerInfo(addr, conn, gt, factory, skillInfo));
    });

    _getServerSkillratingCache.timestamp = now;
    _getServerSkillratingCache.data = info;
    return info;
  }
}


/**
 * This is an internal API method only needed when there are separate feeder processes for tracking servers and hosting the API
 * Using this method the API host process can get the actual data from the other feeder processes and aggregate it
 * @param {} req 
 * @returns {} 
 */
function getServerStatusdump(req) {
  if (!isInternalRequest(req))
    return { ok: false, msg: "only internal connections allowed" };

  var info = {};
  var conns = _feeder.getStatsConnections();
  var addrs = Object.keys(conns);
  addrs.forEach(function(addr) {
    var conn = conns[addr];
    if (!conn.connected) return;
    info[addr] = { gp: conn.gamePort, gt: conn.gameType, f: conn.factory, p: conn.players, api: _config.webadmin.urlprefix };
  });
  return info;
}


/**
 * This method returns a dictionary with game types and the list of supported factories for A-ratings.
 * Minqlx can use this information to decide whether it should pull ratings from the /elo or /elo_b route of the python HTTP server
 * @returns { gt: string[] factories } 
 */
function getARatedFactories() {
  var factories = {};
  ["duel", "ffa", "ca", "tdm", "ctf", "ft"].forEach(function (gt) {
    var strat = gr.createGameTypeStrategy(gt);
    factories[gt] = strat.validFactories;
  });
  return factories;
}

/**
 * Get list of 10 top rated matches for each game type
 * @returns {gt:[{steamid,rating}]} 
 */
function getProsNowPlaying(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  var region = parseInt(req.query.region) || 0;
  var limit = parseInt(req.query.limit) || 10;
  var queryGt = req.query.gt || null;

  var now = Date.now();
  if (_getProsNowPlayingCache.timestamp + 15000 > now)
    return _getProsNowPlayingCache.data;
  if (_getProsNowPlayingCache.updatePromise != null)
    return _getProsNowPlayingCache.updatePromise;

  return _getProsNowPlayingCache.updatePromise = Q
    .all([getAggregatedServerStatusData(), getSkillRatings()])
    .then(function(results) {
      var status = results[0];
      var ratings = results[1];
      var tops = {};
      Object.keys(status).forEach(function(addr) {
        var serverInfo = status[addr];
        var gameAddr = serverInfo.gp ? addr.substr(0, addr.indexOf(":") + 1) + serverInfo.gp : addr;
        var gt = serverInfo.gt || (_getServerBrowserInfoCache[gameAddr] || {})["gt"];
        if (!gt) {
          getServerBrowserInfo(gameAddr);
          return;
        }

        if (queryGt && gt != queryGt)
          return;

        var top = tops[gt];
        if (!top)
          top = tops[gt] = [];
        var player1, player2;
        Object.keys(serverInfo.p).forEach(function(steamid) {
          var p = serverInfo.p[steamid];
          var r = ratings[steamid] || {};
          if (!r.np) // player does not allow locating ("privacy_nowplaying")
            return;
          r = r[gt] || { r:0, region: 0 };
          if (p.team != 3 && !p.quit && (!region || r.region == region)) {
            var player = { steamid: steamid, name: p.name, rating: r.r, server: gameAddr };
            if (!player1)
              player1 = player;
            else if (r.r > player1.rating) {
              player2 = player1;
              player1 = player;
            }
            else if (!player2 || r.r > player2.rating)
              player2 = player;
          }
        });
        if (player1) {
          player1.opponent = player2;
          top.push(player1);
        }
      });

      Object.keys(tops).forEach(function(gt) {
        var top = tops[gt];
        top.sort(function(a, b) { return b.rating - a.rating; });
        tops[gt] = top.slice(0, limit);
      });

      return tops;
    })
    .finally(function() {
      _getProsNowPlayingCache.updatePromise = null;
    });
}


/**
 * Get the URL of the ZMQ event stream for the specified server ip:gameport
 * @returns {bool ok, string streamUrl}
 */
function getQtvEventStreamUrl(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  var addr = req.params.addr;
  return Q.all([getAggregatedServerStatusData(), getZmqFromGamePort(), resolveServerAddr(addr)])
    .then(function(data) {
      var status = data[0];
      var portMap = data[1];
      addr = data[2];
      var zmqAddr = portMap[addr] || addr;
      var panelApiUrlPrefix = status[zmqAddr].api;
      return { ok: true, streamUrl: req.protocol + "://" + req.hostname + panelApiUrlPrefix + "/qtv/" + zmqAddr + "/stream" };
    });
}


/**
 * Steaming HTTP response with JSONs about game events.
 * This API method must be called from the same feeder port that is tracking the server (and not from the aggregated API host)
 */
function getQtvEventStream(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  
  var addr = req.params.addr;

  var conn = _feeder.getStatsConnections()[addr];
  if (!conn)
    return { ok: false, msg: "No ZMQ connection to " + addr };
  
  res.set("Content-Type", "text/event-stream; charset=utf-8");
  res.on('close', removeListener);

  var defer = Q.defer();

  var gameAddr = addr.substr(0, addr.indexOf(":") + 1) + conn.gamePort;
  return resolveServerAddr(gameAddr)
    .then(function(gameAddr) { return getServerBrowserInfo(gameAddr) })
    .then(function(info) {
      // send initial player status
      var players = [];
      Object.keys(conn.players).forEach(function(steamid) {
        var p = conn.players[steamid];
        players.push({ STEAM_ID: steamid, TEAM: p.team, DEAD: p.dead });
      });
      var gt = info.gt || conn.gameType;
      var init = { TYPE: "INIT", TIME: Math.floor(Date.now() / 1000), GAME_TYPE: gt, PLAYERS: players };
      res.write("data:" + JSON.stringify(init) + "\n\n");
    
      // relay incoming ZMQ events to listener
      conn.emitter.on('zmq', onZmq);

      return defer.promise;
  });

  function onZmq() {
    var msg = arguments[0];
    try {
      var event = null;
      if (msg.TYPE == "PLAYER_CONNECT" || msg.TYPE == "PLAYER_DISCONNECT")
        event = { STEAM_ID: msg.DATA.STEAM_ID }
      else if (msg.TYPE == "PLAYER_SWITCHTEAM")
        event = { STEAM_ID: msg.DATA.KILLER.STEAM_ID, TEAM: msg.DATA.KILLER.TEAM };
      else if (msg.TYPE == "PLAYER_DEATH")
        event = { STEAM_ID: msg.DATA.VICTIM.STEAM_ID, WARMUP: msg.DATA.WARMUP };
      else if (msg.TYPE == "MATCH_STARTED" || msg.TYPE == "ROUND_OVER" || msg.TYPE == "MATCH_REPORT")
        event = { };
      
      if (event) {
        event.TYPE = msg.TYPE;
        event.TIME = Math.floor(Date.now() / 1000);
        var text = "data:" + JSON.stringify(event) + "\n\n";
        res.write(text);
      }
    }
    catch (err) {
      removeListener();
      defer.resolve();
    }
  }

  function removeListener() {
    conn.emitter.removeListener('zmq', onZmq);    
  }
}


// helper functions


// checks if the request is null or from a localhost IPv4 or IPv6
function isInternalRequest(req) {
  return !req || !req.connection || !req.connection.remoteAddress || req.connection.remoteAddress.indexOf("127.0.0.") >= 0 || req.connection.remoteAddress == "::1";
}


function resolveServerAddr(addr) {
  var idx = addr.indexOf(":");
  var ipOrHost = idx < 0 ? addr : addr.substr(0, idx);
  var port = idx < 0 ? ":27960" : addr.substr(idx);
  var match = /^([\d.]+)/.exec(ipOrHost);
  if (match)
    return Q(ipOrHost + port);

  var defer = Q.defer();
  dns.lookup(ipOrHost, 4, function(err, address) {
    if (err)
      defer.reject(err);
    else if (!address)
      defer.reject(new Error("no IPv4 addresses for " + ipOrHost));
    else
      defer.resolve(address + port);
  });
  return defer.promise;
}

// run a server browser query and return a promise for the result as { ok: true, state: {...} }
function getServerBrowserInfo(gameAddr) {
  var cached = _getServerBrowserInfoCache[gameAddr];
  if (!cached)
    cached = _getServerBrowserInfoCache[gameAddr] = { time: 0, raw: { rules: {}, players: [] } };
  else if (cached.time + 10 * 1000 >= Date.now())
    return Q(cached);
  else if (cached.updatePromise)
    return cached.updatePromise;

  var parts = gameAddr.split(":");
  var host = parts[0];
  var gamePort = (parts[1] ? parseInt(parts[1]) : 0) || 27960;

  
  var def = Q.defer();
  _logger.debug("getting server browser information for " + gameAddr);
  //gsq({ type: "synergy", host: host, port: gamePort, localPort: _config.httpd.port }, function(state) { def.resolve(state); });
  
  return cached.updatePromise = 
    //def.promise
    gsq.query({type:'quakelive', host: host, port: gamePort, requestRules: true })
    .then(function(state) {
      _logger.debug("received server browser information for " + gameAddr + ": map=" + state.map);
      if (state.raw && state.raw.rules) {
        var gt = (GameTypes[parseInt(state.raw.rules.g_gametype)] || "").toLowerCase();
        var factory = (state.raw.rules.g_factory || gt).toLowerCase();
        return _getServerBrowserInfoCache[gameAddr] = { time: Date.now(), gt: gt, factory: factory, raw: state.raw };
      }
      return cached;
    })
    .catch(error => {
      _logger.debug("received server browser information for " + gameAddr + ": error=" + error);
    })
    .finally(function() {
      cached.updatePromise = null;
    });
}

// get addr, gt, min, avg, max (rating) and count of players, specs and bots for the given server
function calcServerInfo(addr, serverStatus, gt, factory, skillInfo) {
  var totalRating = 0;
  var maxRating = 0;
  var minRating = 9999;
  var count = 0;
  var playerCount = 0, botCount = 0, specCount = 0;
  var is_b_rated = true;

  if ( gt && factory ) {
    var aRatings = getARatedFactories()[gt];
    if (aRatings && aRatings.indexOf(factory) > -1)
      is_b_rated = false;
  }

  Object.keys(serverStatus.p).reduce(function (prev, steamid) {
    var player = serverStatus.p[steamid];
    if (player.quit)
      return;
    if (steamid == 0)
      ++botCount;
    else if (player.team == -1 || player.team >= 3) {
      ++specCount;
      return;
    }
    else
      ++playerCount;
    var playerRating = skillInfo[steamid];
    var rating = playerRating && playerRating[gt] ? ( is_b_rated ? playerRating[gt].b_r : playerRating[gt].r ) : null;
    if (!rating) return;
    ++count;
    totalRating += rating;
    maxRating = Math.max(maxRating, rating);
    minRating = Math.min(minRating, rating);
  }, []);
  return {
    server: addr, gt: gt, 
    min: count == 0 ? 0 : Math.round(minRating), avg: count == 0 ? 0 : Math.round(totalRating / count), max: Math.round(maxRating), 
    rating: is_b_rated ? "B" : "A",
    pc: playerCount, sc: specCount, bc: botCount
  };  
}

// load skill ratings for all players from the database. data is chached for 1min
function getSkillRatings() {
  if (_getPlayerSkillratingsCache.timestamp + 60 * 1000 > Date.now())
    return Q(_getPlayerSkillratingsCache.data);
  if (_getPlayerSkillratingsCache.updatePromise !== null)
    return _getPlayerSkillratingsCache.updatePromise;

  return _getPlayerSkillratingsCache.updatePromise = utils.dbConnect(_config.webapi.database)
    .then(function(cli) {
      return Q
        .ninvoke(cli, "query", {
          name: "serverskill",
          text:
            "select hashkey, game_type_cd, g2_r, g2_rd, region, b_r, b_rd, privacy_nowplaying " +
            "from hashkeys h " +
            "inner join player_elos e on e.player_id=h.player_id " +
            "inner join players p on p.player_id=e.player_id " +
            "where (e.g2_games >= 5 or e.b_games >= 5) "
        })
        .then(function(result) {
          _getPlayerSkillratingsCache.data = mapSkillInfo(result.rows);
          _getPlayerSkillratingsCache.timestamp = Date.now();
          return _getPlayerSkillratingsCache.data;
        })
        .finally(function() {
          cli.release();
          _getPlayerSkillratingsCache.updatePromise = null;
        });
    });

  function mapSkillInfo(rows) {
    var info = {};
    rows.forEach(function(row) {
      var player = info[row.hashkey];
      if (!player)
        info[row.hashkey] = player = { np: row.privacy_nowplaying };
      player[row.game_type_cd] = {
        r: Math.round(row.g2_r), rd: Math.round(row.g2_rd),
        b_r:  Math.round(row.b_r), b_rd: Math.round(row.b_rd),
        region: row.region
      };
    });
    return info;
  }
}

// aggregate server status data from all stats tracking feeder processes
function getAggregatedServerStatusData() {
  // bypass cache for single instance feeder/webadmin/webapi process
  if (_config.webapi.aggregatePanelPorts.length == 0 || _config.webapi.aggregatePanelPorts.length == 1 && _config.webapi.aggregatePanelPorts[0] == _config.httpd.port)
    return getServerStatusdump();

  if (_getAggregatedStatusDataCache.timestamp + 5 * 1000 > Date.now())
    return Q(_getAggregatedStatusDataCache.data);
  if (_getAggregatedStatusDataCache.updatePromise !== null)
    return _getAggregatedStatusDataCache.updatePromise;

  var aggregateInfo = DEBUG ? {} : getServerStatusdump();
  var tasks = [];
  _config.webapi.aggregatePanelPorts.forEach(function(port) {
    if (port != _config.httpd.port || DEBUG)
      tasks.push(getStatusdumpFromPort(port).catch(function(err) { _logger.error("aggregate from port " + port + ": " + err); }));
  });

  return _getAggregatedStatusDataCache.updatePromise = Q
    .all(tasks)
    .then(function() {
      _getAggregatedStatusDataCache.data = aggregateInfo;
      _getAggregatedStatusDataCache.timestamp = Date.now();
      return aggregateInfo;
    })
    .finally(function() { _getAggregatedStatusDataCache.updatePromise = null; });

  // load status dump from a different admin panel port and aggregate the information
  function getStatusdumpFromPort(port) {
    return getJsonFromPort(port, _config.webapi.urlprefix + "/server/statusdump")
      .then(function(info) {
        for (var key in info) {
          if (!info.hasOwnProperty(key)) continue;
          aggregateInfo[key] = info[key];
        }
      });
  }
}

// request JSON from API of a stats tracking feeder process on another port
function getJsonFromPort(port, route) {
  var defer = Q.defer();
  var ok = true;
  var buffer = "";
  request.get("http://127.0.0.1:" + port + route, { timeout: 1000 })
    .on("error", function(err) { defer.reject(err); })
    .on("response", function(response) {
      if (response.statusCode != 200) {
        ok = false;
        defer.reject(new Error("HTTP status code " + response.statusCode));
      }
    })
    .on("data", function(data) { buffer += data; })
    .on("end", function() {
      if (!ok) return;
      var info = JSON.parse(buffer);
      defer.resolve(info);
    }).end();

  return defer.promise;
}

// aggregate server status data from all stats tracking feeder processes
function getZmqFromGamePort() {
  if (_getZmqFromGamePortCache.timestamp + 60 * 1000 > Date.now())
    return Q(_getZmqFromGamePortCache.data);
  if (_getZmqFromGamePortCache.updatePromise)
    return _getZmqFromGamePortCache.updatePromise;

  return _getZmqFromGamePortCache.updatePromise =
    utils.dbConnect(_config.webapi.database)
    .then(function(cli) {
      return Q
        .ninvoke(cli, "query", "select ip_addr, port, hashkey from servers where active_ind=true")
        .then(function(result) {
          _getZmqFromGamePortCache = { timestamp: Date.now(), data: {} };
          result.rows.forEach(function(row) {
            _getZmqFromGamePortCache.data[row.ip_addr + ":" + row.port] = row.hashkey;
          });
          return _getZmqFromGamePortCache.data;
        })
        .finally(function() { cli.release(); });
    })
    .finally(function() { _getZmqFromGamePortCache.updatePromise = null; });
}
