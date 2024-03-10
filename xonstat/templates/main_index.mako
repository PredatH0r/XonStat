<%inherit file="base.mako"/>
<%namespace file="filter.mako" import="*" />
<% from xonstat.util import html_colors %>
<%block name="css">
  ${parent.css()}
</%block>

<%block name="navigation">
  ${parent.navigation()}
  ${filter_bar()}
</%block>

<%block name="hero_unit">

<div class="row newsitem" style="background-color:#822;display:none">
  <div class="col-sm-2">
    2016-01-07 22:16 CET
  </div>
  <div class="col-sm-10">
    Duel ratings are being recalculated. ETA ~1.5h
    <br />CA, FFA, TDM, CTF and FT are already done.
  </div>
</div>

<div class="row newsitem" style="display:block;background-color:#9A7D0A">
  <div class="col-sm-2">
    2023-12-15
  </div>
  <div class="col-sm-10">
    qlstats.net moved to a new hoster and has a new IP address.
    <br>Server owners who use a firewall may have to update the rule to allow connections from the new qlstats.net IP to the ZMQ port.
  </div>
</div>

</%block>

<%block name="js">
  ${parent.js()}
  ${filter_js()}
<script>
  var region=parseInt(getCookie("region"));
  var gameType=getCookie("gametype");
  var rankingCache={}, serverCache={}, mapCache={}, matchCache={};

  function fillRanking(region, gameType) {
    $("#moreRanking").attr("href", "/ranks/" + gameType + "/" + region);

    if (rankingCache.hasOwnProperty(gameType + region))
      fillTable();
    else {
      rankingCache[gameType + region] = null;
      $.getJSON("/ranks/" + gameType + "/" + region + ".json", { limit: 10 }, function(data) {
        rankingCache[gameType + region] = data;
        fillTable();
      })
      .fail(function(err) { console.log(err); });
    }

    function fillTable() {
      var data = rankingCache[gameType + region] || { players: []};
      for (var i=1, c=data.players.length; i<=10; i++) {
        var player=data.players[i-1];
        var $row = $($("#rankingTable tr")[i]);
        var $cells = $row.children();
        $($cells[1]).data("href", i <= c ? "/player/" + player.player_id : null);
        $($cells[1]).html(i <= c ? "<a href='/player/" + player.player_id + "'>" + player.html_name + "</a>" : "");
        $($cells[2]).html(i <= c ? player.rating : "").attr("title", i < c ? "\xb1 " + player.rd : "").css("cursor", "help");
      }
      $("#ranksNote").text(
        $("#filterBar li[data-region='" + region + "']").text() + " / " + 
        $("#filterBar li[data-gametype='" + gameType + "']").text()
      );
    }
  }

  function fillServers(region, gameType) {
    if (serverCache.hasOwnProperty(gameType + region))
      fillTable();
    else {
      serverCache[gameType + region] = null;
      $.getJSON("/topservers.json", { gametype: gameType, region: region, limit: 10 }, function(data) {
        serverCache[gameType + region] = data;
        fillTable();
      })
      .fail(function(err) { console.log(err); });
    }

    function fillTable() {
      var data = serverCache[gameType + region] || { servers: []};
      for (var i=1, c=data.servers.length; i<=10; i++) {
        var server=data.servers[i-1];
        var $row = $($("#serverTable tr")[i]);
        var $cells = $row.children();
        $($cells[1]).html(i <= c && server[3] != null ? "<img src='/static/images/flags/" + server[3].toLowerCase() + ".png' class='flag'> " + server[3] : "");
        $($cells[2]).html(i <= c ? "<a href='/server/" + server[0] + "'>" + escapeHtml(server[1]) + "</a>" : "");
        $($cells[3]).html(i <= c ? server[2] : "");
      }
      $("#serversNote").text(
        $("#filterBar li[data-region='" + (region || 0) + "']").text() + " / " + 
        $("#filterBar li[data-gametype='" + (gameType || "overall") + "']").text()
      );
    }
  }

  function fillMaps(region, gameType) {
    if (mapCache.hasOwnProperty(gameType + region))
      fillTable();
    else {
      mapCache[gameType + region] = null;
      $.getJSON("/topmaps.json", { gametype: gameType, region: region, limit: 10 }, function(data) {
        mapCache[gameType + region] = data;
        fillTable();
      })
      .fail(function(err) { console.log(err); });
    }

    function fillTable() {
      var data = mapCache[gameType + region] || { maps: []};
      for (var i=1, c=data.maps.length; i<=10; i++) {
        var server=data.maps[i-1];
        var $row = $($("#mapTable tr")[i]);
        var $cells = $row.children();
        $($cells[1]).html(i <= c ? "<a href='/map/" + server[0] + "'>" + escapeHtml(server[1]) + "</a>" : "");
        $($cells[2]).html(i <= c ? server[2] : "");
      }
      $("#mapsNote").text(
        $("#filterBar li[data-region='" + (region || 0) + "']").text() + " / " + 
        $("#filterBar li[data-gametype='" + (gameType || "overall") + "']").text().substr(0,5)
      );
    }
  }

  function fillTopMatches(region, gameType) {
    if (matchCache.hasOwnProperty(region))
      fillTable();
    else {
      matchCache[region] = null;
      var api = "${request.registry.settings.get('qlstat.feeder_webapi_url')}" || "http://" + location.hostname + ":8081/api";
      $.getJSON(api + "/nowplaying", { gametype: gameType, region: region, limit: 10 }, function(data) {
        matchCache[region] = data;
        fillTable();
      })
      .fail(function(err) { console.log(err); });
    }

    function fillTable() {
      var data = (matchCache[region] || {})[gameType] || [];
      for (var i=1, c=data.length; i<=10; i++) {
        var row=data[i-1] || {};
        var $row = $($("#matchTable tr")[i]);
        var $cells = $row.children();
        var players = htmlColors(row.name);
        if (row.opponent)
          players += " vs " + htmlColors(row.opponent.name);
        $($cells[1]).html(i <= c ? "<a href='/server/" + row.server + "'>" + players + "</a>" : "");
      }
      $("#matchNote").text(
        $("#filterBar li[data-region='" + (region || 0) + "']").text() + " / " + 
        $("#filterBar li[data-gametype='" + (gameType) + "']").text().substr(0,5)
      );
    }
  }

  $("#filterBar li").on("click", function() {
    region = parseInt(getCookie("region"));
    gameType = getCookie("gametype");
    fillRanking(region || "1", gameType || "duel");
    fillServers(region, gameType);
    //fillMaps(region, gameType);
    fillTopMatches(region, gameType || "duel");
  });

  $("td.link").on("click", function() {
    var url = $(this).data("href");
    if (url)
      location.href = url;
  });
  fillRanking(region || "1", gameType || "duel");
  fillServers(region, gameType);
  //fillMaps(region, gameType);
  fillTopMatches(region, gameType || "duel");

/***************************/

  function setLinkToServerAdminPanel() {
    var url = '${request.registry.settings.get("qlstat.feeder_webadmin_url", "")}' || "http://" + location.hostname + ":8081/";
    if (url && url.toLowerCase().trim() != "false")
      $("#btnAddServer").attr("href", url).css("display", "inline-block");
  }
  setLinkToServerAdminPanel();

</script>
</%block>

<div class="row">

  ##### RANKS #####
  <div class="col-sm-6 col-md-3">
    <div>
      <h3 style="display:inline-block">Player Ranking</h3>
      <img class="info" alt="information" title="updated daily at 12:00 CET&#x0a;requires a minimum of 10 matches&#x0a;offenders are excluded from rankings" />
      <span id="ranksNote" class="note"></span>
    </div>
    <table id="rankingTable" class="table table-hover table-condensed" style="table-layout:fixed;width:100%">
      <thead>
        <tr>
          <th style="width:25px">#</th>
          <th>Player</th>
          <th style="width:50px">Glicko</th>
        </tr>
      </thead>
      <tbody>
        % for i in range(1,11):
        <tr>
          <td>${i}</td>
          <td class="link" style="white-space:nowrap;overflow-x:hidden"></td>
          <td></td>
        </tr>
        % endfor
      </tbody>
    </table>
    <p class="note"><a id="moreRanking" href="" title="See more rankings">More...</a></p>
  </div> <!-- /span3 -->

  ##### TOP LIVE MATCHES #####
  <div class="col-sm-6 col-md-3 col-md-push-6">
    <h3 style="display:inline-block">Now Playing</h3>
    <span style="color:green;font-size:large">&#x25cf;</span>   
    <span id="matchNote" class="note"></span>
    <table id="matchTable" class="table table-hover table-condensed">
      <thead>
        <tr>
          <th style="width:25px;">#</th>
          <th>Players</th>
        </tr>
      </thead>
      <tbody>
        % for i in range(1,11):
        <tr>
          <td>${i}</td>
          <td></td>
        </tr>
        % endfor
      </tbody>
    </table>
  </div> <!-- /span4 -->

  ##### ACTIVE MAPS #####
  <!--
  <div class="col-sm-6 col-md-3 col-md-push-6" stype="display:none">
    <h3 style="display:inline-block">Most Active Maps</h3>
    <img class="info" alt="information" title="updated every hour with data from the past 7 days" />
    <span id="mapsNote" class="note"></span>
    <table id="mapTable" class="table table-hover table-condensed">
      <thead>
        <tr>
          <th style="width:40px;">#</th>
          <th style="width:180px;">Map</th>
          <th style="width:60px;">Games</th>
        </tr>
      </thead>
      <tbody>
        % for i in range(1,11):
        <tr>
          <td>${i}</td>
          <td class="nostretch" style="max-width:180px;"></td>
          <td></td>
        </tr>
        % endfor
      </tbody>
    </table>
    <p class="note"><a href="${request.route_path('top_maps_by_times_played', page=1)}" title="See more map activity">More...</a></p>
  </div> 
  -->
 
  ##### ACTIVE SERVERS #####
  <div class="col-sm-12 col-md-6 col-md-pull-3">
    <h3 style="display:inline-block">Most Active Servers</h3>
    <img class="info" alt="information" title="updated every hour with data from the past 7 days"/>
    <span id="serversNote" class="note"></span>
    <p style="position:absolute;right:15px;top:20px"><a id="btnAddServer" class="btn btn-primary btn-small" style="display:none" href="">Add Server</a></p>
    <table id="serverTable" class="table table-hover table-condensed">
      <thead>
        <tr>
          <th style="width:40px;">#</th>
          <th style="width:40px;">Loc</th>
          <th style="width:250px;">Server</th>
          <th style="width:60px;">Games</th>
        </tr>
      </thead>
      <tbody>
        % for i in range(1, 11):
        <tr>
          <td>${i}</td>
          <td></td>
          <td class="nostretch" style="max-width:180px;"></td>
          <td></td>
        </tr>
        % endfor
      </tbody>
    </table>
    <p class="note"><a href="${request.route_path('top_servers_by_players', page=1)}" title="See more server activity">More...</a></p>
  </div> <!-- /span4 -->

</div> <!-- /row -->

##### RECENT GAMES #####
% if len(recent_games) > 0:
<div class="row">
  <div class="col-sm-12">
    <h3>Recent Games</h3>
    <table class="table table-hover table-condensed">
      <thead>
        <tr>
          <th></th>
          <th>Time</th>
          <th>Type</th>
          <th>Loc</th>
          <th>Server</th>
          <th>Map</th>
          <th>Players</th>
          <th>Score</th>
          <th>Rated</th>
        </tr>
      </thead>
      <tbody>
        % for rg in recent_games:
        <tr>
          <td class="tdcenter"><a class="btn btn-primary btn-small" href="${request.route_path('game_info', id=rg.game_id)}" title="View detailed information about this game">view</a></td>
          <td><span class="abstime" data-epoch="${rg.epoch}">${rg.start_dt.strftime('%H:%M:%S')}</span></td>
          <td><img src="/static/images/icons/24x24/${rg.game_type_cd}.png" alt="${rg.game_type_cd}" width="24" height="24"> ${rg.game_type_cd}</td>
          <td>
            % if rg.country is not None:
            <img src="/static/images/flags/${rg.country.lower()}.png" alt="${rg.country}" width="24" height="24" class="flag"> ${rg.country}
            % endif
          </td>
          <td><a href="${request.route_path('server_info', id=rg.server_id)}" title="Go to the detail page for this server">${rg.server_name}</a></td>
          <td><a href="${request.route_path('map_info', id=rg.map_id)}" title="Go to the map detail page for this map">${rg.map_name}</a></td>
          <td class="nostretch">
            % if rg.pg1_player_id > 2:
            <a href="${request.route_path('player_info', id=rg.pg1_player_id)}" title="Go to the player info page for this player">${html_colors(rg.pg1_nick)|n}</a>
            % else:
            ${html_colors(rg.pg1_nick)|n}
            % endif

            &nbsp;vs&nbsp;

            % if rg.pg2_player_id > 2:
            <a href="${request.route_path('player_info', id=rg.pg2_player_id)}" title="Go to the player info page for this player">${html_colors(rg.pg2_nick)|n}</a>
            % else:
            ${html_colors(rg.pg2_nick)|n}
            % endif
          </td>
          <td>
            % if rg.score1 is not None:
            ${rg.score1 if rg.score1 is not None else "DNF"}:${rg.score2 if rg.score2 is not None else "DNF"}
            % endif
          </td>
          <td class="tdcenter">
            %if rg.g2_status == 0:
            TBD
            %elif rg.g2_status == 1:
            A
            %elif rg.g2_status == 8:
            B
            %else:
            <i class="glyphicon glyphicon-minus"></i>
            %endif
          </td>
        </tr>
        % endfor
      </tbody>
    </table>
    <p><a href="${request.route_path('game_index')}">More...</a></p>
  </div> <!-- /span12 -->
</div> <!-- /row -->
% endif
