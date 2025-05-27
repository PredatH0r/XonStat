var
  fs = require("graceful-fs"),
  pg = require("pg"),
  zlib = require("zlib"),
  glicko = require("./glicko1"),
  log4js = require("log4js"),
  Q = require("q"),
  utils = require("./utils");

// calculate a value for "c" so that an average RD value of 30 changes back to 350 when a player is inactive for 720 rating periods (=days)
// the default rating value must be kept in-sync with the value for the /elo API in player.py
var g2 = new glicko.Glicko({ rating: 900, rd: 350, c: Math.sqrt((Math.pow(350, 2) - Math.pow(30, 2)) / 720) });

// values for DB column games.g2_status
var
  ERR_NOTRATEDYET = 0,
  ERR_OK = 1,
  ERR_ABORTED = 2,
  ERR_ROUND_OR_TIMELIMIT = 3,
  ERR_BOTMATCH = 4,
  ERR_TEAMTIMEDIFF = 5,
  ERR_MINPLAYERS = 6,
  ERR_DATAFILEMISSING = 7,
  ERR_FACTORY_OR_SETTINGS = 8,
  ERR_UNSUPPORTED_GAME_TYPE = 9,
  ERR_UNRATED_SERVER = 10,
  ERR_UNRATED_GAME = 11,
  ERR_UNTRACKED_PLAYERS = 12;

var rateEachSingleMatch = true;
var _config;
var resetRating;
var updateDatabase;
var onlyProcessMatchesBefore;
var printResult;
var gametype;
var funMods;
var recalcFactories;
var strategy;
var playersBySteamId = {};
var serversByAddr = {};
var _lastProcessedMatchStartDt;
var rateSingleGameQueue = Q();

exports.rateAllGames = rateAllGames;
exports.rateSingleGame = rateSingleGame;
exports.createGameTypeStrategy = createGameTypeStrategy;

var _logger = log4js.getLogger("gamerating");

function init() {
  _config = JSON.parse(fs.readFileSync(__dirname + "/../cfg.json")); 
  //Q.longStackSupport = true;
}

function rateAllGames(gt, options) {
  applyOptions(gt, options);

  return utils.dbConnect(_config.webapi.database)
    .then(function(cli) {
      return resetRatingsInDb(cli)
        .then(function() { return loadServers(cli); })
        .then(function() { return loadPlayers(cli); })
        .then(function() { return getMatchIds(cli); })
        .then(function(matches) { return reprocessMatches(cli, matches); })
        .then(function() { return savePlayerRatings(cli, funMods) })
        .then(function() { return playersBySteamId; })
        .then(function(results) { return printResults(results); })
        .finally(function() { cli.release(); });
    })
    .catch(function(err) {
      _logger.error(err);
      throw err;
    });
}

function rateSingleGame(gameId, game) {
  // since this module has state variables for the rating process, all rating requests muss be executed sequentially to avoid mutual interference
  rateSingleGameQueue = (Q.isFulfilled(rateSingleGameQueue) ? Q() : rateSingleGameQueue).then(function () { return rateSingleGameCore(gameId, game); });
}

function rateSingleGameCore(gameId, game) {
  var gt = game.matchStats.GAME_TYPE;
  applyOptions(gt, { resetRating: false, updateDatabase: true, onlyProcessMatchesBefore: null, printResult: false });

  var steamIds = {};
  game.playerStats.forEach(function(p) {
    steamIds[p.STEAM_ID] = true;
  });
  steamIds = Object.keys(steamIds);
  
  var ratingPeriod = glickoPeriod(new Date(game.gameEndTimestamp * 1000));
  g2.setPeriod(ratingPeriod);

  return utils.dbConnect(_config.webapi.database)
    .then(function(cli) {
      return Q()
        .then(function() { return loadServers(cli, game.serverIp + ":" + game.serverPort); })
        .then(function() { return strategy.isSupported ? loadPlayers(cli, steamIds) : null; })
        .then(function() { return processGame(cli, gameId, game); })
        .then(function(isFunMod) { return isFunMod === null ? Q(null) : savePlayerRatings(cli, isFunMod, game); })
        .then(function() { return true; })
        .finally(function() { cli.release(); });
    })
    .catch(function(err) {
      _logger.error(err);
      return false;
    });
}

function applyOptions(gt, options) {
  gametype = gt.toLowerCase();
  strategy = createGameTypeStrategy(gametype);
  resetRating = options.resetRating;
  updateDatabase = options.updateDatabase;
  printResult = options.printResult;
  onlyProcessMatchesBefore = options.onlyProcessMatchesBefore;
  funMods = options.funMods;

  playersBySteamId = {};
  _lastProcessedMatchStartDt = null;
}

function createGameTypeStrategy(gametype) {
  var ValidFactoriesForGametype = {
    "duel": ["duel", "qcon_duel"],
    "ffa": ["ffa", "mg_ffa_classic"],
    "ca": ["ca", "capickup", "hoq_ca", "mg_ca_classic"],
    "tdm": ["ctdm", "qcon_tdm", "mg_tdm_fullclassic", "tdm_classic", "hoq_tdm", "ftdm"],
    "ctf": ["ctf", "ctf2", "qcon_ctf", "hoq_ctf"],
    "ad": ["ad"],
    "ft": ["freeze", "cftag", "ft", "ftclassic", "ft_classic", "mg_ft_fullclassic", "vft", "ft_competitive"]
  }
  var MinRequiredPlayersForGametype = {
    "duel": 2,
    "ffa": 4,
    "ca": 6,
    "tdm": 4,
    "ctf": 6,
    "ad": 6,
    "ft": 6
  }
  var ValidateMatchForGametype = {
    "duel": function(game) { return game.matchStats.GAME_LENGTH >= 10 * 60 - 5 || game.matchStats.EXIT_MSG.indexOf("forfeited") >= 0 },
    "ffa": function(game) { return game.matchStats.FRAG_LIMIT >= 50 },
    "ca": function(game) { return Math.max(game.matchStats.TSCORE0, game.matchStats.TSCORE1) >= 8 || Math.abs(game.matchStats.TSCORE0 - game.matchStats.TSCORE1) >= 5 /* old JSONS have no ROUND_LIMIT */ },
    "tdm": function(game) { return Math.max(game.matchStats.TSCORE0, game.matchStats.TSCORE1) >= 100 || Math.abs(game.matchStats.TSCORE0 - game.matchStats.TSCORE1) >= 30 || game.matchStats.GAME_LENGTH >= 15 * 60 },
    "ctf": function(game) { return Math.max(game.matchStats.TSCORE0, game.matchStats.TSCORE1) >= 5  || Math.abs(game.matchStats.TSCORE0 - game.matchStats.TSCORE1) >= 5 || game.matchStats.GAME_LENGTH >= 15 * 60 },
    "ad": function(game) { return game.matchStats.SCORE_LIMIT >= 15 },
    "ft": function(game) { return Math.max(game.matchStats.TSCORE0, game.matchStats.TSCORE1) >= 8 || Math.abs(game.matchStats.TSCORE0 - game.matchStats.TSCORE1) >= 5 || game.matchStats.GAME_LENGTH >= 15 * 60 /* old JSONS have no ROUND_LIMIT */ }
  }
  
  // a and b are performance scores adjusted for participation time
  var IsDrawForGametype = {
    "duel": function() { return false; },
    "ffa": function(a, b, game) { return Math.abs(a - b) <= 2 * Math.max(1, game.matchStats.FRAG_LIMIT/50) },
    "ca": function(a, b) { return Math.abs(a - b) <= 2 },
    "tdm": function(a, b) { return a != 0 && b != 0 && Math.abs(a / b) <= 1.05 && Math.abs(b / a) <= 1.05 },
    "ctf": function(a, b) { return a != 0 && b != 0 && a / b <= 1.05 && b / a <= 1.05 },
    "ft": function(a, b) { return Math.abs(a - b) <= 5; }
  }

  return {
    isSupported: ValidFactoriesForGametype[gametype] !== undefined,
    validFactories: ValidFactoriesForGametype[gametype] || [],
    minPlayers: MinRequiredPlayersForGametype[gametype] || 2,
    validateGame: ValidateMatchForGametype[gametype] || (function () { return false; }),
    maxTeamTimeDiff: 1.05, // in a 4on4 game with 10 mins (or rounds) it will allow up to 42 player minutes in one team
    isDraw: IsDrawForGametype[gametype] || (function () { return false; })
  }
}

function resetRatingsInDb(cli) {
  if (!resetRating || !updateDatabase)
    return Q();

  _logger.info("resetting ratings in database");
  recalcFactories = "'" + strategy.validFactories.join("','") + "'";
  if (funMods) {
    return Q()
      //.then(function () { return Q.ninvoke(cli, "query", "update player_elos set b_games=0, b_r=0, b_rd=0, b_dt=null where game_type_cd=$1", [gametype]) })
      .then(function () { return Q.ninvoke(cli, "query", "update player_game_stats pgs set g2_score=null, g2_delta_r=null, g2_delta_rd=null from games g where pgs.game_id=g.game_id and g.game_type_cd=$1 and g2_status=$2", [gametype, ERR_FACTORY_OR_SETTINGS]) })
      .then(function () { return Q.ninvoke(cli, "query", "update games set g2_status=$2 where game_type_cd=$1 and mod not in (" + recalcFactories + ") and g2_status<>$3", [gametype, ERR_NOTRATEDYET, ERR_DATAFILEMISSING]) });
  }
  else {
    return Q()
      //.then(function() { return Q.ninvoke(cli, "query", "update player_elos set g2_games=0, g2_r=0, g2_rd=0, g2_dt=null where game_type_cd=$1", [gametype]) })
      .then(function() { return Q.ninvoke(cli, "query", "update player_game_stats pgs set g2_score=null, g2_delta_r=null, g2_delta_rd=null from games g where pgs.game_id=g.game_id and g.game_type_cd=$1 and g.mod in (" + recalcFactories + ")", [gametype]) })
      .then(function() { return Q.ninvoke(cli, "query", "update games set g2_status=$2 where game_type_cd=$1 and g2_status<>$3", [gametype, ERR_NOTRATEDYET, ERR_DATAFILEMISSING]) })
      .then(function() { return Q.ninvoke(cli, "query", "update games set g2_status=$2 where game_type_cd=$1 and mod not in (" + recalcFactories + ") and g2_status<>$3", [gametype, ERR_FACTORY_OR_SETTINGS, ERR_DATAFILEMISSING]) });
  }
}

function loadServers(cli, addr) {
  var where = addr ? " where hashkey = $1" : "";
  var args = addr ? [addr] : [];
  return Q
    .ninvoke(cli, "query", "select hashkey, pure_ind from servers" + where, args)
    .then(function (result) {
    for (var i = 0; i < result.rows.length; i++)
      serversByAddr[result.rows[i].hashkey] = result.rows[i].pure_ind;
    return serversByAddr;
  });
}

function loadPlayers(cli, steamIds) {
  var query = "select h.hashkey, p.player_id, p.nick, p.active_ind, pe.g2_r, pe.g2_rd, pe.g2_dt, pe.g2_games, pe.b_r, pe.b_rd, pe.b_dt, pe.b_games "
    + " from hashkeys h"
    + " inner join players p on p.player_id=h.player_id"
    + " left outer join player_elos pe on pe.player_id=h.player_id and pe.game_type_cd=$1";
  var params = [gametype];
  
  if (steamIds) {
    query += " where h.hashkey in ('-1'";
    steamIds.forEach(function(steamId, i) {
      query += ",$" + (i + 2);
      params.push(steamId);
    });
    query += ")";
  }

  return Q.ninvoke(cli, "query", query, params)
    .then(function(result) {
      _logger.debug("loaded " + result.rows.length + " players");
      result.rows.forEach(function(row) {
        var player = resetRating ?
          getOrAddPlayer(row.player_id, row.hashkey, row.nick, row.active_ind, 0, 0, 0, 0, 0, 0, 0, 0) :
          getOrAddPlayer(row.player_id, row.hashkey, row.nick, row.active_ind, row.g2_r, row.g2_rd, glickoPeriod(row.g2_dt), row.g2_games, row.b_r, row.b_rd, glickoPeriod(row.b_dt), row.b_games);
        player.mustSave = false;
      });
      return playersBySteamId;
    });
}


function getMatchIds(cli) {
  var cond = resetRating ? "" : " and g2_status=" + ERR_NOTRATEDYET;
  cond += " and (" + (onlyProcessMatchesBefore ? 1 : 0) + "=0 or start_dt<$1)";

  return Q.ninvoke(cli, "query",
      "select match_id, start_dt, game_id"
      + " from games"
      + " where game_type_cd=$2"
      + " and mod " + (funMods ? "not" : "") + " in ('" + strategy.validFactories.join("','") + "')" 
      + " and g2_status<>$3"
      + cond
      + " order by start_dt", [onlyProcessMatchesBefore || new Date(), gametype, ERR_DATAFILEMISSING])
    .then(function(result) {
      return result.rows.map(function(row) { return { game_id: row.game_id, date: row.start_dt, match_id: row.match_id }; });
    });
}

function reprocessMatches(cli, matches) {
  var currentRatingPeriod = 0;

  var counter = 0;
  var printProgress = true;
  _logger.info("found " + matches.length + " matches");
  var progressLogger = setInterval(function() { printProgress = true; }, 5000);
  return matches.reduce(function(chain, match) {
      return chain.then(function() {
        if (printProgress) {
          _logger.info("processed matches: " + counter + " (" + Math.round(counter * 10000 / matches.length) / 100 + "%)");
          printProgress = false;
        }
        var midSave = ++counter % 1000 == 0 ? savePlayerRatings(cli, funMods) : Q();
        
        g2.setPeriod(glickoPeriod(match.date));
        return /* ok || */ Q(midSave).then(function() { return reprocessMatch(cli, match.match_id, match.date, match.game_id, currentRatingPeriod); });
      });
    }, Q())
    .then(function() { return playersBySteamId; })
    .finally(function() { clearTimeout(progressLogger) });
}

function reprocessMatch(cli, matchId, date, gameId) {
  var deltas = [0, +1, -1];
  var subfolders = [];
  for (var i = 0; i < 3; i++)
    subfolders.push(getDateFolder(date, deltas[i]));

  var file = null;
  for (var i = 0; i < subfolders.length; i++) {
    try {
      file = __dirname + "/../" + _config.feeder.jsondir + subfolders[i] + matchId + ".json.gz";
      var stat = fs.statSync(file);
      if (stat && stat.isFile())
        break;
    }
    catch (err) {
    }
    file = null;
  }
  
  _lastProcessedMatchStartDt = date;

  if (file) {
    return processFile(cli, gameId, file)
      .catch(function(err) {
        _logger.error("Failed to process " + file + ": " + err);
        return false;
      });
  }

  _logger.warn("json.gz not found: " + matchId);
  return setGameStatus(cli, gameId, ERR_DATAFILEMISSING).then(function () { return false; });
}

function getDateFolder(date, deltaDays) {
  // match .json.gz files are stored in YYYY-MM/DD/ folders
  var newDate;
  if (deltaDays) {
    newDate = new Date(date.getTime());
    newDate.setDate(newDate.getDate() + deltaDays);
  }
  else
    newDate = date;

  var year = newDate.getUTCFullYear();
  var month = newDate.getUTCMonth();
  var day = newDate.getUTCDate();
  return year + "-" + ("0" + (month + 1)).substr(-2) + "/" + ("0" + day).substr(-2) + "/";
}

function processFile(cli, gameId, file) {
  return Q
    .nfcall(fs.readFile, file)
    .then(function (data) { return file.indexOf(".gz") < 0 ? Q(data) : Q.nfcall(zlib.gunzip, data); })
    .then(function (json) { return processGame(cli, gameId, JSON.parse(json)) });
}

function processGame(cli, gameId, game) {
  var addr = game.serverIp + ":" + game.serverPort;
  var ratedServer = !serversByAddr.hasOwnProperty(addr) || serversByAddr[addr];
  var result = ratedServer ? extractDataFromGameObject(game) : ERR_UNRATED_SERVER;

  // store a status code why the game was not rated
  if (typeof (result) === "number")
    return setGameStatus(cli, gameId, result).then(function() { return null; });

  var isFunMod = strategy.validFactories.indexOf(game.matchStats.FACTORY) < 0 
    || game.matchStats.INSTAGIB;

  var playerRanking = result;
  var players = [];

  for (var i = 0; i < playerRanking.length; i++) {
    var r1 = playerRanking[i];
    var p1 = playersBySteamId[r1.id];
    p1.score = Math.round(r1.score);
    p1.mustSave = true;
    players.push(p1);
    var rating1 = isFunMod ? p1.ratingB : p1.rating;

    ++rating1.games;

    for (var j = i + 1; j < playerRanking.length; j++) {
      var r2 = playerRanking[j];
      var p2 = playersBySteamId[r2.id];
      var outcome = strategy.isDraw(r1.score, r2.score, game) ? 0.5 : r1.score > r2.score ? 1 : 0;
      var rating2 = isFunMod ? p2.ratingB : p2.rating;

      if (r1.team !== undefined && r1.team == r2.team) // don't compare with team mates
        continue;

      if (p1.active == p2.active) // neither or both are cheaters
        g2.addResult(rating1, rating2, outcome);
      else if (!p1.active) // p1 is a cheater, so only his rating will be updated
        g2.addResult(rating1, rating2, outcome, true);
      else // p2 is a cheater, so only his rating will be updated
        g2.addResult(rating2, rating1, 1 - outcome, true);
    }
  }

  if (rateEachSingleMatch)
    g2.calculatePlayersRatings();

  return (rateEachSingleMatch ? savePlayerGameRatingChange(players, game) : Q())
    .then(function() { return setGameStatus(cli, gameId, isFunMod ? ERR_FACTORY_OR_SETTINGS : ERR_OK) })
    .then(function() { return isFunMod });

  function savePlayerGameRatingChange(players, game) {
    if (!updateDatabase)
      return Q();

    return players.reduce(function(chain, p) {
      return chain.then(function () {
        var pid = game.steamIdMappingAnon[p.id];
        var rating = isFunMod ? p.ratingB : p.rating;
        var val = [gameId, pid, p.score, rating.__oldR, rating.__oldRd, rating.getRating() - rating.__oldR, rating.getRd() - rating.__oldRd];
        return Q.ninvoke(cli, "query", { name: "pgs_upd", text: "update player_game_stats set g2_score=$3, g2_old_r=$4, g2_old_rd=$5, g2_delta_r=$6, g2_delta_rd=$7 where game_id=$1 and player_id=$2", values: val })
          .then(function(result) {
            if (result.rowCount == 0)
              _logger.warn("player_game_stats not found: gid=" + gameId + ", pid=" + pid + ", steamId=" + p.id);
            return Q();
          });
      });
    }, Q());
  }
}

function extractDataFromGameObject(game) {
  if (/unrated|unranked/i.test(game.matchStats.FACTORY_TITLE)) {
    _logger.debug(addr + ": ignoring unrated game " + game.matchStats.MATCH_GUID);
    return ERR_UNRATED_GAME;
  }

  if (!strategy.isSupported) return ERR_UNSUPPORTED_GAME_TYPE;
  if (game.matchStats.ABORTED) return ERR_ABORTED;
  if (game.matchStats.INFECTED) return ERR_FACTORY_OR_SETTINGS;
  if (game.matchStats.QUADHOG) return ERR_FACTORY_OR_SETTINGS;
  if (game.matchStats.TRAINING) return ERR_FACTORY_OR_SETTINGS;
  if (!strategy.validateGame(game)) return ERR_ROUND_OR_TIMELIMIT;

  // aggregate total time, damage and score of player during a match (could have been switching teams)
  var playerData = {};
  var botmatch = false;
  var untrackedPlayers = false;
  var timeRed = 0, timeBlue = 0, isTeamGame, roundsRed, roundsBlue;
  aggregateTimeAndScorePerPlayer();

  if (botmatch)
    return ERR_BOTMATCH;
  if (untrackedPlayers)
    return ERR_UNTRACKED_PLAYERS;
  if (game.roundCount) {
    if (roundsBlue != 0 && (roundsRed / roundsBlue > strategy.maxTeamTimeDiff || roundsBlue / roundsRed > strategy.maxTeamTimeDiff))
      return ERR_TEAMTIMEDIFF;    
  }
  else if (timeBlue != 0 && (timeRed/timeBlue > strategy.maxTeamTimeDiff || timeBlue/timeRed > strategy.maxTeamTimeDiff))
    return ERR_TEAMTIMEDIFF;

  var players = calculatePlayerRanking();
  if (players.length < strategy.minPlayers)
    return ERR_MINPLAYERS;
  return players;

  function aggregateTimeAndScorePerPlayer() {
    game.playerStats.forEach(function (p) {
      isTeamGame |= p.hasOwnProperty("TEAM");

      var pendingSteamAuth = p.STEAM_ID == "0" && (!isTeamGame || p.TEAM != 0);// there are cases in team games where steam_id=0 can appear with team=0 (none). Maybe due to pending steam-auth?
      botmatch |= p.STEAM_ID == "0" && !pendingSteamAuth; 
      untrackedPlayers |= !playersBySteamId[p.STEAM_ID] || playersBySteamId[p.STEAM_ID].pid <= 2;
      if (p.WARMUP || botmatch || untrackedPlayers || pendingSteamAuth) // p.ABORTED must be counted for team switchers
        return;

      var pd = playerData[p.STEAM_ID];
      if (!pd) {
        pd = { id: p.STEAM_ID, name: p.NAME, timeRed: 0, timeBlue: 0, roundsRed: 0, roundsBlue: 0, score: 0, k: 0, d: 0, dg: 0, dt: 0, a: 0, win: false, c: 0, quit: false };
        playerData[p.STEAM_ID] = pd;
      }

      var time = Math.min(p.PLAY_TIME, game.matchStats.GAME_LENGTH); // pauses and whatever QL bugs can cause excessive PLAY_TIME
      if (p.TEAM == 2) {
        timeBlue += time;
        pd.timeBlue += time;
        if (game.roundCount && game.roundCount.players[p.STEAM_ID])
          roundsRed += pd.roundsBlue = game.roundCount.players[p.STEAM_ID].b; // don't aggregate round counts, they already are totals
      }
      else {
        timeRed += time;
        pd.timeRed += time;
        if (game.roundCount && game.roundCount.players[p.STEAM_ID])
          roundsBlue += pd.roundsRed = game.roundCount.players[p.STEAM_ID].r; // don't aggregate round counts, they already are totals
      }
      pd.score += p.SCORE;
      pd.dg += p.DAMAGE.DEALT;
      pd.dt += p.DAMAGE.TAKEN;
      pd.k += p.KILLS;
      pd.d += p.DEATHS;
      pd.a += p.MEDALS.ASSISTS;
      pd.c += p.MEDALS.CAPTURES;
      if (p.RANK == 1 && !p.ABORTED) // when using map_restart, there might be multiple aborted entries before the real winner/loser entry in duel
        pd.win = true;
      pd.quit |= p.QUIT;
    });
    
    // on 2016-01-14 feeder started to track play times manually to exclude the map load + warmup time from PLAY_TIME
    if (game.playTimes) {
      timeBlue = 0;
      timeRed = 0;
      game.matchStats.GAME_LENGTH = game.playTimes.total;
      Object.keys(playerData).forEach(function(steamid) {
        var times = game.playTimes.players[steamid];
        if (times) {
          var pd = playerData[steamid];
          timeRed += pd.timeRed = times[0] + times[1];
          timeBlue += pd.timeBlue = times[2];
        }
      });
    }
  }

  function calculatePlayerRanking() {
    var players = [];
    for (var steamId in playerData) {
      if (!playerData.hasOwnProperty(steamId)) continue;
      var pd = playerData[steamId];

      if (game.roundCount) {
        // min. 50% round participation
        if (pd.roundsRed + pd.roundsBlue < game.roundCount.total / 2)
          continue;
      }
      else if (pd.timeRed + pd.timeBlue < game.matchStats.GAME_LENGTH / 2) {
        // minumum 50% time participation
        continue;
      }
      
      // skip AFK players (except for duel and race)
      if ("duel,race".indexOf(game.matchStats.GAME_TYPE.toLowerCase()) < 0 && (pd.dg <= 100 || pd.dt / pd.dg >= 10.0)) 
        continue;
      

      var p = getOrAddPlayer(null, pd.id, pd.name);
      p.played = true;

      if (isTeamGame) {
        var winningTeam = game.matchStats.TSCORE0 > game.matchStats.TSCORE1 ? -1 : game.matchStats.TSCORE0 == game.matchStats.TSCORE1 ? 0 : +1;
        var playerTeam = pd.timeRed >= pd.timeBlue ? -1 : +1;
        pd.win = playerTeam == winningTeam;
        // if same time in red and blue, use team "free" so the player is compared to everyone
        pd.team = pd.timeRed > pd.timeBlue ? 1 : pd.timeRed < pd.timeBlue ? 2 : 0;
      }

      var rankingScore = calcPlayerPerformance(pd, game);
      if (rankingScore != NaN)
        players.push({ steamId: steamId, id: pd.id, score: rankingScore, win: pd.win, team: pd.team });
    }
    return players;
  }
}

function getOrAddPlayer(playerId, steamId, name, isActive, rating, rd, period, games, ratingB, rdB, periodB, gamesB) {
  var player = playersBySteamId[steamId];
  if (!player) {
    if (isActive !== false)
      isActive = true;
    playersBySteamId[steamId] = player = {
      pid: playerId,
      id: steamId,
      name: name,
      active: isActive,
      rating: g2.makePlayer(rating, rd, period),
      ratingB: g2.makePlayer(ratingB, rdB, periodB)
    };
    player.rating.games = games || 0;
    player.ratingB.games = gamesB || 0;    
  }
  return player;
}

function calcPlayerPerformance(p, raw) {
  var timeFactor = raw.matchStats.GAME_LENGTH / (p.timeRed + p.timeBlue);
  if (raw.roundCount) {
    var pr = raw.roundCount.players[p.id];
    if (!pr) return NaN;
    timeFactor = raw.roundCount.total / (pr.r + pr.b);
  }

  // CTF score formula inspired by http://bot.xurv.org/rating.pdf
  if (gametype == "ctf")
    return (p.dt == 0 ? 2 : Math.min(2, Math.max(0.5, p.dg / p.dt))) * (p.score + p.dg / 20) * timeFactor; // + (p.win ? 300 : 0);

  // TDM performance formula inspired by http://qlstats.info/about-ql-statistics.html
  if (gametype == "tdm")
    return ((p.k - p.d) * 5 + (p.dg - p.dt) / 100 * 4 + p.dg / 100 * 3) * timeFactor;

  if (gametype == "duel")
    return p.quit ? -1 : p.win ? 1 : 0;

  // then use score/rounds for CA
  if (gametype == "ca")
    return (p.score - 0.75*p.k) * timeFactor * (p.win ? 1.1 : 1.0);

  if (gametype == "ft")
    return (p.dg / 100 + 0.5*(p.k - p.d) + 2*p.a) * timeFactor;

  if (gametype == "ad")
    return (p.dg / 100 + p.k + p.c) * timeFactor;

  // FFA, FT: score/time
  return p.score * timeFactor;
}

function glickoPeriod(date) {
  if (!date) return 0;
  if (typeof (date) == "number") return date;
  return Math.floor(date.getTime() / 1000 / 60 / 60 / 24);
}

function glickoDate(period) {
  //return period ? new Date(period * 24 * 60 * 60 * 1000) : null;
  return period;
}

function setGameStatus(cli, gameId, status) {
  if (!updateDatabase)
    return Q();
  return Q.ninvoke(cli, "query", { name: "game_upd", text: "update games set g2_status=$2 where game_id=$1", values: [gameId, status] });
}

function savePlayerRatings(cli, isFunMod) {
  var players = playersBySteamId;
  if (!updateDatabase)
    return Q(players);

  var list = [];
  for (var steamId in players) {
    if (!players.hasOwnProperty(steamId)) continue;
    var player = players[steamId];
    if (player.mustSave) {
      list.push(player);
      player.mustSave = false;
    }
  }

  var update, insert, updateName = "elo_upd", insertName = "elo_ins";
  if (isFunMod) {
    update = "update player_elos set b_games=$3, b_r=$4, b_rd=$5, b_dt=$6, update_dt=now() at time zone 'utc' where player_id=$1 and game_type_cd=$2";
    insert = "insert into player_elos (player_id, game_type_cd, b_games, b_r, b_rd, b_dt, update_dt, elo) values ($1,$2,$3,$4,$5,$6,now() at time zone 'utc', 100)";
    updateName += "_b";
    insertName += "_b";
  }
  else {
    update = "update player_elos set g2_games=$3, g2_r=$4, g2_rd=$5, g2_dt=$6, update_dt=now() at time zone 'utc' where player_id=$1 and game_type_cd=$2";
    insert = "insert into player_elos (player_id, game_type_cd, g2_games, g2_r, g2_rd, g2_dt, update_dt, elo) values ($1,$2,$3,$4,$5,$6,now() at time zone 'utc', 100)";
  }

  return list.reduce(function(chain, player) {
      return chain.then(function() {
        var r = isFunMod ? player.ratingB : player.rating;
        var val = [player.pid, gametype, r.games, r.getRating(), r.getRd(), glickoDate(r.getPeriod())];
        // try update and if rowcount is 0, execute an insert
        return Q.ninvoke(cli, "query", { name: updateName, text: update, values: val })
          .then(function(result) {
            if (result.rowCount == 1 || !player.pid) return Q();
            return Q.ninvoke(cli, "query", { name: insertName, text: insert, values: val })
              .catch(function(err) { _logger.error("Failed to insert/update player_elo: steam-id=" + player.id + ", data=" + JSON.stringify(val) + ", name=" + player.name + ":\n" + err); });
          });
      });
    }, Q())
    .then(function() {
      // reprocessing could have taken quite a long time and new matches could have been added with incorrect ratings, so mark the new games as NOT_RATED_YET
      if (resetRating) {
        var val = [gametype, ERR_NOTRATEDYET, ERR_DATAFILEMISSING, _lastProcessedMatchStartDt];
        var cond = funMods ? "not" : "";
        return Q.ninvoke(cli, "query", "update games set g2_status=$2 where game_type_cd=$1 and g2_status<>$3 and start_dt>$4 and mod " + cond + " in (" + recalcFactories + ")", val);
      }
      return Q();
    })
    .then(function () { return players; });
}

function printResults() {
  if (!printResult)
    return playersBySteamId;

  // bring all RD values to today's date  
  //var allRatings = Object.keys(playersBySteamId).map(function (key) { return playersBySteamId[key].rating; });
  //g2.setPeriod(glickoPeriod(new Date()), allRatings);

  var players = [];
  for (var key in playersBySteamId) {
    if (!playersBySteamId.hasOwnProperty(key)) continue;
    var p = playersBySteamId[key];
    if (!p.played) continue;
    var r = funMods ? p.ratingB : p.rating;
    p.r1 = r.getRating() - r.getRd();
    players.push(p);
  }
  players.sort(function(a, b) { return -(a.r1 - b.r1); });
  players.forEach(function(p) {
    if (!p) return;
    var r = funMods ? p.ratingB : p.rating;
    if (r.games < 5) return;
    console.log(p.name
      + ": r-rd=" + Math.round(p.r1)
      + ", (r=" + Math.round(r.getRating())
      + ", rd=" + Math.round(r.getRd())
      + "), games: " + r.games
    );
  });

  return playersBySteamId;
}

init();
