<%inherit file="base.mako"/>
<%namespace name="nav" file="nav.mako" />
<%
import json
from xonstat.util import strftime
%>

<%block name="navigation">
% if player and player.email_addr is not None:
${nav.nav('players', True)}
% else:
${nav.nav('players', False)}
% endif
</%block>

<%block name="css">
${parent.css()}
<style>
#damageChart, #accuracyChart {
  height: 250px;
}
</style>
</%block>

<%block name="js">
${parent.js()}

%if may_view:
<!--<script type="text/javascript" src="https://www.gstatic.com/charts/loader.js"></script>-->
<!-- www.google.com/jsapi?autoload={'modules':[{'name':'visualization','version':'1','packages':['corechart']}]} -->
<script type="text/javascript" src="/static/charts/loader.js"></script>
<!--<script type="text/javascript" src="/static/charts/51/loader.js?{'modules':[{'name':'visualization','version':'1','packages':['corechart']}]}"></script>-->
<script src="/static/js/weaponCharts.min.js"></script>

<script type="text/javascript">

var gametype = ((location.hash || "").indexOf("#") == 0 ? location.hash.substr(1) : getCookie("gametype")) || "overall";

$("#gbtab li").click(function() {
  gametype = $(this).data("gametype");
  setCookie("gametype", gametype == "overall" ? null : gametype);
  window.location.hash = "#" + gametype;
  loadDataAndDrawChart(); 
  loadRecentGames();
});

$(document).ready(function() {
  $("#gbtab li[data-gametype='" + gametype + "']").addClass("active");
  $("#gbtabcontainer div").removeClass("active");
  $("#tab-" + gametype).addClass("active");
  window.location.hash = "#" + gametype;
  loadDataAndDrawChart();
  loadRecentGames();
});

///////////////////////////////
  
var jsonUrl = "${request.route_path('player_weaponstats_data_json', id=player.player_id, _query={'limit':20})}";
  
// weapon accuracy and damage charts
var chartData, chartName = "accuracyChart", chartOpt = null, chartLimit=20;
google.load('visualization', '1.1', {packages: ['corechart']});
function loadDataAndDrawChart() {
  if (!google.visualization) {
    setTimeout(loadDataAndDrawChart, 500);
    return;
  }
    
  var url = jsonUrl + (gametype ? "&game_type=" + gametype : "");
  url = url.replace(/limit=\d+/, "limit=" + chartLimit);
  $.getJSON(url, function(data) {
    chartData = data;
    drawChart(chartName, (typeof($("#chartRow h3.selected")).data("arg") == "undefined") ? null : $("#chartRow h3.selected").data("arg"));
  });
}
function drawChart(chart, opt) {
  $(".row #chartArea").empty();
  $(".row #chartArea").append('<svg id="' + chart + 'SVG"></svg>')
  if (chart == "accuracyChart")
    drawAccuracyChart(chartData);
  else if (chart == "damageChart")
    drawDamageChart(chartData, opt == "1");
  else if (chart == "fragChart")
    drawFragChart(chartData, opt == "1");
  chartName = chart;
  chartOpt = opt;
}
$("#chartRow h3").click(function() {
  $("#chartRow h3").removeClass("selected");
  $(this).addClass("selected");
  drawChart($(this).data("chart"), $(this).data("arg"));
});
$("#chartRow h4").click(function() {
  $("#chartRow h4").removeClass("selected");
  $(this).addClass("selected");
  chartLimit=parseInt($(this).text()) || 20;
  if (!chartData || chartLimit != chartData.games.length)
    loadDataAndDrawChart();
  //else
  //  drawChart(chartName, chartOpt);
});

///////////////////////////////

var data = [];
function loadRecentGames() {
  var args = {};
  if (gametype != "overall")
    args.game_type_cd = gametype;
  $.getJSON("/player/${player.player_id}/recent_games.json", args, function(data) {
    fillRecentGames(data);
  });
}

function fillRecentGames(data) {
  var $tbody = $("#recentGames tbody");
  $tbody.empty();
  for (var i=0, c=data.length; i<c; i++) {
    var html=[];
    var rg = data[i];
    html.push('<td>' + (i+1) + '</td>');
    html.push('<td class="tdcenter"><a class="btn btn-primary btn-small" href="/game/' + rg.game_id + '" title="View detailed information about this game">view</a></td>');
    html.push('<td>' + dateStr(rg.epoch) + '</td>');
    html.push('<td><img src="/static/images/icons/24x24/' + rg.game_type_cd + '.png" width="24" height="24" alt="' + rg.game_type_cd + '" title="' + rg.game_type_descr + '"> ' + rg.game_type_cd + '</td>');
    html.push('<td><a href="/server/' + rg.server_id + '" title="Go to the detail page for this server">' + rg.server_name + '</a></td>');
    html.push('<td><a href="/map/' + rg.map_id + '" title="Go to the detail page for this map">' + rg.map_name + '</a></td>');
    html.push('<td class='  + ((rg.pg3_team ? rg.pg3_team == rg.winner : rg.pg3_rank == 1) ? "eloup" : "elodown") + '>' + rg.score1 + ":" + rg.score2 + (rg.game_type_cd != "duel" ? " (#" + rg.pg3_rank + ")" : "") + "</td>");
    if (rg.pg3_player_id == rg.pg1_player_id) {
      html.push('<td><a href="/player/' + rg.pg2_player_id + '">' + htmlColors(rg.pg2_nick) + '</a></td>');
      html.push('<td>' + (rg.pg2_old_r ? rg.pg2_old_r + " &plusmn; " + rg.pg2_old_rd : "") + '</td>')
    }
    else {
      html.push('<td><a href="/player/' + rg.pg1_player_id + '">' + htmlColors(rg.pg1_nick) + '</a></td>');
      html.push('<td>' + (rg.pg2_old_r ? rg.pg1_old_r + " &plusmn; " + rg.pg1_old_rd : "") + '</td>')
    }
    html.push('<td>' + (rg.pg3_old_r ? rg.pg3_old_r + " &plusmn; " + rg.pg3_old_rd : "") + '</td>')
    html.push('<td class="tdcenter">');
    html.push('<a href="/game/' + rg.game_id + '" title="View detailed information about this game">');  
    var delta =  rg.pg3_delta_r + " / " + (rg.pg3_delta_rd || 0);
    if ((rg.g2_status != 1 && rg.g2_status != 8) || typeof(rg.pg3_delta_r) !== "number")
      html.push('<span class="eloneutral"><i class="glyphicon glyphicon-minus"></i></span>');
    else if (rg.pg3_delta_r > 0)
      html.push('<span class="eloup">+' + delta + '</span>');
    else
      html.push('<span class="elodown">' + delta + '</span>');
    html.push('</a>');
    if (rg.g2_status == 8)
      html.push(' &nbsp; (<span title="B-Rating for custom settings/factories">B</span>) ');
    html.push('</td>');

    $tbody.append("<tr>" + html.join("\n") + "</tr>");
  }
}

function dateStr(unixtimestamp) {
  var date = new Date();
  date.setTime(unixtimestamp * 1000);
  return (1900 + date.getYear()) + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());

  function pad(num) {
    return ("0" + num).substr(-2);
  }
}

///////////////////////////////
</script>
%endif

%if player and player.privacy_nowplaying == 1:
<script>
function locatePlayer() {
  $.getJSON("${request.registry.settings.get('qlstat.feeder_webapi_url','')}/player/${hashkey}/locate", function(data) {
    if (data.ok && data.server) {
      $("#btnNowPlaying").css("display", "inline").attr("href", "/server/" + data.server);
    }
  });
}

locatePlayer();
</script>
%endif



</%block>

<%block name="title">
Player Information
</%block>

%if not player:
  <h2>Sorry, that player wasn't found!</h2>

%else:

<div class="row" style="min-height: 200px">
  <div class="col-xs-6 col-sm-4 col-md-3">
    <h2 style="display:inline-block">${player.nick_html_colors()|n}</h2> <a href="/aliases/${hashkey}">Aliases</a>
    <p>
      <% 
      regions = [ "not set", "Europe", "Africa", "Asia", "Australia", "North America", "South America"]
      region = "unknown" if player.region is None or player.region > len(regions) else regions[player.region]
      %>
%if may_view:
      Region: ${region}
%endif
      <br>Player ID: ${player.player_id}
      <br>Steam ID: <a href="http://steamcommunity.com/profiles/${hashkey}/" target="_blank">${hashkey}</a>
%if may_view:
      <br>Joined: <span class="abstime" data-epoch="${player.epoch()}" title="${strftime(player.create_dt, '%a, %d %b %Y %H:%M:%S UTC')}">Joined ${player.joined_pretty_date()}</span>
%endif
      <br>Status: ${ "active" if player.active_ind else "<span class='warntext'>deactivated</span>" | n}
    </p>
%if player.privacy_nowplaying == 1:
    <a id="btnNowPlaying" class="btn btn-primary btn-small" href="" style="display:none">Now Playing</a>
%endif
  </div>

%if not may_view:
  <div class="col-xs-6 xol-sm-8 col-md-9" style="padding: 50pt 0 0 60pt; font-size: 16pt">
    This profile is private 
  </div>
%else:

  <div class="col-xs-6 col-sm-8 col-md-9">
    <ul id="gbtab" class="nav nav-tabs" style="margin-top:20px">
      % for g in games_played:
      <li class="tab-${g.game_type_cd}" data-gametype="${g.game_type_cd}">
        <a href="#tab-${g.game_type_cd}" data-toggle="tab" alt="${g.game_type_cd}" title="${overall_stats[g.game_type_cd].game_type_descr}">
          <img src="/static/images/icons/24x24/${g.game_type_cd}.png" width="24" height="24"><br />
          ${g.game_type_cd} <br />
          <small>(${g.games})</small>
        </a>
      </li>
      % endfor
    </ul>

    <div id="gbtabcontainer" class="tab-content">
      % for g in games_played:
      <div class="row tab-pane${ ' active' if g.game_type_cd == 'overall' else ''}" id="tab-${g.game_type_cd}">
        <div class="col-sm-4">
          Win Rate: <small>${round(g.win_pct,2)}% (${g.wins} wins, ${g.losses} losses)</small>
          <br />

          Kill Ratio:
          % if g.game_type_cd in overall_stats and overall_stats[g.game_type_cd].k_d_ratio is not None:
          <small>${round(overall_stats[g.game_type_cd].k_d_ratio,2)} (${overall_stats[g.game_type_cd].total_kills} kills, ${overall_stats[g.game_type_cd].total_deaths} deaths)</small>
          % else:
          <small>-</small>
          % endif
          <br />

          Cap Ratio:
          % if g.game_type_cd == 'ctf' and overall_stats[g.game_type_cd].cap_ratio is not None:
          <small>${round(overall_stats[g.game_type_cd].cap_ratio,2)} (${overall_stats[g.game_type_cd].total_captures} captures, ${overall_stats[g.game_type_cd].total_pickups} pickups)</small>
          % else:
          <small>-</small>
          % endif
          <br />
        </div>

        <div class="col-sm-4">
          <%
            def tostr(game_type_cd, games, r, rd):
              if not r:
                return "-"
              return str(int(round(r,0))) + " &plusmn; " + str(int(round(rd, 0))) + " (" + game_type_cd + ", " + str(games or 0) + " games)"
            
            ratings = elos.get(g.game_type_cd)
            rating_a = tostr(ratings.game_type_cd, ratings.g2_games, ratings.g2_r, ratings.g2_rd) if ratings else "-"
            rating_b = tostr(ratings.game_type_cd, ratings.b_games, ratings.b_r, ratings.b_rd) if ratings else "-"
          %>
          % if g.game_type_cd == 'overall':
          Best Rating: <small>${rating_a|n}</small>
          <br />Best B-Rating: TBD
          % else:
          Rating: <small>${rating_a|n}</small>
          <br /><span title="Rating for custom settings/factories">B-Rating: <small>${rating_b|n}</small></span>
          % endif
          <br />

          % if g.game_type_cd in ranks:
          % if g.game_type_cd == 'overall':
          Best Rank:
          <small>
            <a href="${request.route_path('rank_index', game_type_cd=ranks[g.game_type_cd].game_type_cd, region=player.region, _query={'page':(ranks[g.game_type_cd].rank-1)/20+1})}" title="Player rank page for this player">
              ${ranks[g.game_type_cd].rank} of ${ranks[g.game_type_cd].max_rank}
            </a>
            (${ranks[g.game_type_cd].game_type_cd}, top ${round(100-ranks[g.game_type_cd].percentile,2)}%)
          </small>
          % else:
          Rank:
          <small>
            <a href="${request.route_path('rank_index', game_type_cd=g.game_type_cd, region=player.region, _query={'page':(ranks[g.game_type_cd].rank-1)/20+1})}" title="Player rank page for this player">
              ${ranks[g.game_type_cd].rank} of ${ranks[g.game_type_cd].max_rank}
            </a>
            (top ${round(100-ranks[g.game_type_cd].percentile,2)}%)
          </small>
          % endif
          % else:
          Rank: -
          % endif
        </div>

        <div class="col-sm-4">
          Last Played: 
          % if g.game_type_cd in overall_stats:
          <small><span class="abstime" data-epoch="${overall_stats[g.game_type_cd].last_played_epoch}" title="${strftime(overall_stats[g.game_type_cd].last_played, '%a, %d %b %Y %H:%M:%S UTC')}"> ${overall_stats[g.game_type_cd].last_played_fuzzy}</span></small>
          % else:
          <small>-</small>
          % endif
          <br />

          Games Played: 
          % if g.game_type_cd == 'overall':
          <small><a href="${request.route_path("player_game_index", player_id=player.player_id)}" title="View recent games">${g.games}</a></small>
          % else:
          <small><a href="${request.route_path("player_game_index", player_id=player.player_id, _query={'type':g.game_type_cd})}" title="View recent ${overall_stats[g.game_type_cd].game_type_descr} games">${g.games}</a></small>
          % endif
          <br />

          Favorite Map:
          % if g.game_type_cd in fav_maps:
          <small><a href="${request.route_path("map_info", id=fav_maps[g.game_type_cd].map_id)}" title="Go to the detail page for this map">${fav_maps[g.game_type_cd].map_name}</a></small>
          % else:
          <small>-</small>
          % endif
          <br />

          <!--
          % if g.game_type_cd == 'ctf':
          % if overall_stats[g.game_type_cd].total_captures is not None:
          <small><a href="${request.route_path("player_captimes", player_id=player.player_id)}">Fastest flag captures...</a> <br /></small>
          % else:
          <small><br /></small>
          % endif
          % else:
          <small><br /></small>
          % endif
          -->
        </div>
      </div>
      %endfor
    </div>
  </div>
</div>

##### Charts ####
<div id="chartRow" class="row">
  <div class="col-sm-12">
    <h3 data-chart="accuracyChart" class="selected">Accuracy</h3>
    <h3 data-chart="fragChart" data-arg="0">Frag #</h3>
    <h3 data-chart="fragChart" data-arg="1">Frag %</h3>
    <h3 data-chart="damageChart" data-arg="0">Damage #</h3>
    <h3 data-chart="damageChart" data-arg="1">Damage %</h3>
    <h4 class="selected">20</h4>
    <h4>50</h4>
    <h4>100</h4>
    <noscript>
      Sorry, but you've disabled JavaScript! It is required to draw the accuracy chart.
    </noscript>
    <div id="chartArea" style="height:500px">
      <!--<svg id="....ChartSVG"></svg>-->
    </div>
  </div> <!-- end span12 -->
</div> <!-- end row -->


##### RECENT GAMES (v2) ####
<div class="row">
  <div class="col-sm-12" id="recentGames">
    <h3>Recent Games</h3>
    <table class="table table-hover table-condensed">
      <thead>
        <tr>
          <th>#</th>
          <th></th>
          <th>Played</th>
          <th>Type</th>
          <th>Server</th>
          <th>Map</th>
          <th>Result</th>
          <th>Opponent</th>
          <th>Rating</th>
          <th title="Rating &plusmn; Uncertainty">Old Glicko</th>
          <th title="Rating / Uncertainty">Glicko Change</th>
        </tr>
      </thead>
      <tbody>

      </tbody>
    </table>
    <p><a href="${request.route_path("player_game_index", player_id=player.player_id, page=1)}" title="Game index for ${player.stripped_nick}">More...</a></p>
  </div>
</div>
%endif
%endif
