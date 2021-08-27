<%inherit file="base.mako"/>
<%namespace name="nav" file="nav.mako" />
<%namespace file="navlinks.mako" import="navlinks" />
<%
from xonstat.util import html_colors
import datetime
%>
<%block name="navigation">
<%
navareas = { "player": "players", "server": "servers", "map": "maps", "game": "games"}
navarea = navareas[result_type] if result_type in navareas else "games"
%>
${nav.nav(navarea)}
</%block>

% if results == None:

<%block name="title">
Advanced Search
</%block>

<div class="row">
  <div class="col-sm-12">
    <form class="form-horizontal" style="display:block; width:340px; margin: 20px auto 0 auto;">
      <fieldset>

        <!-- Form submitted? -->
        <input type="hidden" name="fs" />

        <div style="display:inline-block">
          <!-- Text input-->
          <div class="control-group">
            <label class="control-label">Nick</label>
            <div class="controls">
              <input id="nick" name="nick" type="text" placeholder="player nick" class="input-xlarge">
              <p class="help-block"></p>
            </div>
          </div>

          <!-- Text input-->
          <div class="control-group">
            <label class="control-label">Server</label>
            <div class="controls">
              <input id="server_name" name="server_name" type="text" placeholder="server name" class="input-xlarge">
              <p class="help-block"></p>
            </div>
          </div>

          <!-- Text input-->
          <div class="control-group">
            <label class="control-label">Map</label>
            <div class="controls">
              <input id="map_name" name="map_name" type="text" placeholder="map name" class="input-xlarge">
              <p class="help-block"></p>
            </div>
          </div>
        </div>

        <div style="display:inline-block;margin-left:50px">
          <!-- Multiple Checkboxes -->
          <div class="control-group">
            <label class="control-label">Game Types</label>
            <div class="controls">
              <label class="checkbox">
                <input type="checkbox" name="dm" value="Deathmatch">
                Deathmatch
              </label>
              <label class="checkbox">
                <input type="checkbox" name="duel" value="Duel">
                Duel
              </label>
              <label class="checkbox">
                <input type="checkbox" name="ctf" value="Capture The Flag">
                Capture The Flag
              </label>
              <label class="checkbox">
                <input type="checkbox" name="tdm" value="Team Deathmatch">
                Team Deathmatch
              </label>
            </div>
          </div>

          <!-- Button -->
          <div class="control-group">
            <label class="control-label"></label>
            <div class="controls">
              <button id="submit" name="submit" type="submit" class="btn btn-primary">Submit</button>
            </div>
          </div>
        </div>
      </fieldset>
    </form>
  </div>
</div>


% elif len(results) == 0:
<div class="row">
  <div class="col-sm-12">
    <h1 class="text-center">Sorry, nothing found!</h1>
  </div>
</div>
% else:


##### player-only results #####
% if result_type == "player":
<div class="row">
  <div class="col-sm-12 col-md-6 col-md-offset-3">
    <table class="table table-hover table-condensed" style="table-layout:fixed">
      <thead>
        <tr>
          <th style="width:100px;">Player ID</th>
          <th>Nick</th>
          <th class="create-dt" style="width:180px;">Joined</th>
          <!-- <th style="width:60px;">Games</th> -->
        </tr>
      </thead>
      <tbody>
        % for (player_id, nick, stripped_nick, create_dt, is_alias) in results:
        <tr>
          <td>${player_id}</td>
          <td class="player-nick"><a href="${request.route_path("player_info", id=player_id)}" title="Go to this player's info page">${html_colors(nick)|n}</a></td>
          <td><span class="abstime" data-epoch="${int((create_dt - datetime.datetime(1970,1,1)).total_seconds())}">${create_dt.strftime('%Y-%m-%d')}</span></td>
          <!--
          <td class="tdcenter">
            <a href="${request.route_path("player_game_index", player_id=player_id, page=1)}" title="View recent games by this player">
              <i class="glyphicon glyphicon-list"></i>
            </a>
          </td>
          -->
        </tr>
        % endfor
      </tbody>
    </table>
  </div>
</div>
% endif

##### server-only results #####
% if result_type == "server":
<div class="row">
  <div class="col-sm-12 col-md-8 col-md-offset-2">
    <table class="table table-hover table-condensed">
      <tr>
        <th style="width:60px;">ID</th>
        <th>Name</th>
        <th class="create-dt">Added</th>
        <th></th>
      </tr>
      % for server in results:
      <tr>
        <td>${server.server_id}</td>
        <td><a href="${request.route_path("server_info", id=server.server_id)}" title="Go to this server's info page">${server.name}</a></th>
        <td><span class="abstime" data-epoch="${server.epoch()}" title="${server.create_dt.strftime('%a, %d %b %Y %H:%M:%S UTC')}">${server.fuzzy_date()}</span></td>
        <td class="tdcenter">
          <a href="${request.route_path("game_index", _query={'server_id':server.server_id})}" title="View recent games on this server">
            <i class="glyphicon glyphicon-list"></i>
          </a>
        </td>
      </tr>
      % endfor
    </table>
  </div>
</div>
% endif

##### map-only results #####
% if result_type == "map":
<div class="row">
  <div class="col-sm-12 col-md-6 col-md-offset-3">
    <table class="table table-hover table-condensed">
      <tr>
        <th style="width:70px;">ID</th>
        <th>Name</th>
        <th>Added</th>
        <th></th>
      </tr>
      % for map in results:
      <tr>
        <td>${map.map_id}</td>
        <td><a href="${request.route_path("map_info", id=map.map_id)}" title="Go to this map's info page">${map.name}</a></th>
        <td><span class="abstime" data-epoch="${map.epoch()}" title="${map.create_dt.strftime('%a, %d %b %Y %H:%M:%S UTC')}">${map.fuzzy_date()}</span></td>
          <td class="tdcenter">
          <a href="${request.route_path("game_index", _query={'map_id':map.map_id})}" title="View recent games on this map">
            <i class="glyphicon glyphicon-list"></i>
          </a>
        </td>
      </tr>
      % endfor
    </table>
  </div>
</div>
% endif

##### game results #####
% if result_type == "game":
<div class="row">
  <div class="col-sm-12">
    <table class="table table-hover table-condensed">
      <tr>
        <th></th>
        <th>Map</th>
        <th>Server</th>
        <th>Time</th>
      </tr>
      % for (game, server, gmap) in results:
      <tr>
        <td><a class="btn btn-primary btn-small" href="${request.route_path("game_info", id=game.game_id)}" name="Game info page for game #${game.game_id}">View</a></td>
        <td><a href="${request.route_path("map_info", id=gmap.map_id)}" name="Map info page for map #${gmap.map_id}">${gmap.name}</a></td>
        <td><a href="${request.route_path("server_info", id=server.server_id)}" name="Server info page for server #${server.server_id}">${server.name}</a></td>
        <td><span class="abstime" data-epoch="${game.epoch()}" title="${game.create_dt.strftime('%a, %d %b %Y %H:%M:%S UTC')}">${game.fuzzy_date()}</span></td>
      </tr>
      % endfor
    </table>
% endif

<!-- navigation links -->
${navlinks("search", results.page, results.last_page, search_query=query)}
  </div>
</div>
% endif

<%block name="js">
${parent.js()}
</%block>


