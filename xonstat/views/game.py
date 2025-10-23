import datetime
import logging
import re
import time
import os
from collections import OrderedDict
from pyramid.response import Response
from sqlalchemy import desc, func, over
from beaker.cache import cache_regions, cache_region
from webhelpers.paginate import Page, PageURL
from xonstat.models import *
from xonstat.util import page_url
from xonstat.views.helpers import RecentGame, recent_games_q, games_q, checkSession


log = logging.getLogger(__name__)


def _game_info_data(request):
    checkSession(request)

    game_id = request.matchdict['id']

    if request.params.has_key('show_elo'):
        show_elo = True
    else:
        show_elo = True #False

    show_latency = False

    try:
        notfound = False

        q = DBSession.query(Game, Server, Map, GameType).\
                filter(Game.server_id == Server.server_id).\
                filter(Game.map_id == Map.map_id).\
                filter(Game.game_type_cd == GameType.game_type_cd)
        if "-" in game_id:
                q = q.filter(Game.match_id == game_id)
        else:
                q = q.filter(Game.game_id == game_id)

        
        (game, server, map, gametype) = q.one()
        game_id = game.game_id

        here = os.path.dirname(__file__)
        if os.path.exists(here + "/../static/images/levelshots/" + map.name + ".jpg"):
            map.image = "/static/images/levelshots/" + map.name + ".jpg"
        else:
            map.image = ""


        pgstats = DBSession.query(PlayerGameStat).\
                filter(PlayerGameStat.game_id == game_id).\
                order_by(PlayerGameStat.g2_score.desc().nullslast()).\
                order_by(PlayerGameStat.score.desc()).\
                order_by(PlayerGameStat.kills.desc()).\
                order_by(PlayerGameStat.deaths).\
                order_by(PlayerGameStat.alivetime).\
                all()

        # if at least one player has a valid latency, we'll show the column
        for pgstat in pgstats:
            if pgstat.avg_latency is not None:
                show_latency = True

        q = DBSession.query(TeamGameStat).\
                filter(TeamGameStat.game_id == game_id)
        if game.game_type_cd == 'ctf':
            q = q.order_by(TeamGameStat.caps.desc())
        elif game.game_type_cd == 'ca' or game.game_type_cd == 'ft':
            q = q.order_by(TeamGameStat.rounds.desc())
        # dom -> ticks, rc -> laps, nb -> goals, as -> objectives

        q = q.order_by(TeamGameStat.score.desc())

        tgstats = q.all()

        stats_by_team = OrderedDict()
        for pgstat in pgstats:
            if pgstat.team not in stats_by_team.keys():
                stats_by_team[pgstat.team] = []
            stats_by_team[pgstat.team].append(pgstat)

        captimes = []
        if game.game_type_cd == 'ctf':
            for pgstat in pgstats:
                if pgstat.fastest is not None:
                    captimes.append(pgstat)
            captimes = sorted(captimes, key=lambda x:x.fastest)

        pwstats = OrderedDict()
        weapons = OrderedDict() ## ["gt","mg","sg","gl","rl","lg","rg","pg","hmg","bfg"]
        weaponFired = {}
        for (pwstat, pgstat, weapon) in DBSession.query(PlayerWeaponStat, PlayerGameStat, Weapon).\
                filter(PlayerGameStat.game_id == game_id).\
                filter(PlayerWeaponStat.game_id == PlayerGameStat.game_id).\
                filter(PlayerWeaponStat.player_id == PlayerGameStat.player_id).\
                filter(PlayerWeaponStat.weapon_cd == Weapon.weapon_cd).\
                order_by(PlayerGameStat.score.desc()).\
                order_by(PlayerGameStat.kills.desc()).\
                order_by(PlayerGameStat.deaths).\
                order_by(PlayerGameStat.alivetime).\
                order_by(Weapon.weapon_num).\
                all():
                    
                    if pwstat.fired != 0:
                        weaponFired[weapon.weapon_cd] = True;
                    weapons[weapon.weapon_cd] = weapon;

                    if pgstat.player_id not in pwstats:
                        pwstats[pgstat.player_id] = { "nick": pgstat.nick_html_colors(), "weapons": {} }
                    if weapon.weapon_cd not in pwstats[pgstat.player_id]["weapons"]:
                        pwstats[pgstat.player_id]["weapons"][weapon.weapon_cd] = []

                    if len(pwstats[pgstat.player_id]["weapons"][weapon.weapon_cd]) != 0:
                        pwstats[pgstat.player_id]["weapons"][weapon.weapon_cd][0] += pwstat.frags;
                        pwstats[pgstat.player_id]["weapons"][weapon.weapon_cd][1] += pwstat.max;
                        pwstats[pgstat.player_id]["weapons"][weapon.weapon_cd][2] += pwstat.hit;
                        pwstats[pgstat.player_id]["weapons"][weapon.weapon_cd][3] += pwstat.fired;
                    else:
                        pwstats[pgstat.player_id]["weapons"][weapon.weapon_cd] = [pwstat.frags, pwstat.max, pwstat.hit, pwstat.fired]

    except Exception as inst:
        game = None
        server = None
        map = None
        gametype = None
        pgstats = None
        tgstats = None
        pwstats = None
        captimes = None
        show_elo = False
        show_latency = False
        stats_by_team = None
        raise inst

    return {'game':game,
            'server':server,
            'map':map,
            'gametype':gametype,
            'pgstats':pgstats,
            'tgstats':tgstats,
            'pwstats':pwstats,
            'weapons':weapons,
            'weaponFired':weaponFired,
            'captimes':captimes,
            'show_elo':show_elo,
            'show_latency':show_latency,
            'stats_by_team':stats_by_team,
            }


def game_info(request):
    """
    List the game stats (scoreboard) for a particular game. Paginated.
    """
    return _game_info_data(request)


def game_info_json(request):
    """
    List the game stats (scoreboard) for a particular game. Paginated. JSON.
    """
    return _game_info_data(request)


@cache_region('hourly_term')
def _rank_index_data(request):
    if request.params.has_key('page'):
        current_page = request.params['page']
    else:
        current_page = 1

    game_type_cd = request.matchdict.get('game_type_cd') or request.params.get("region") or request.cookies.get("region")
    region = request.matchdict.get('region') or request.params.get("region") or request.cookies.get("region")

    ranks_q = DBSession.query(PlayerRank).\
            filter(PlayerRank.game_type_cd==game_type_cd).\
            filter(PlayerRank.region==region).\
            order_by(PlayerRank.rank)

    ranks = Page(ranks_q, current_page, url=page_url)

    if len(ranks) == 0:
        ranks = None

    return {
            'ranks':ranks,
            'game_type_cd':game_type_cd,
            'region': region
           }


def rank_index(request):
    """
    Provide a list of gametype ranks, paginated.
    """
    return _rank_index_data(request)


def rank_index_json(request):
    """
    Provide a list of gametype ranks, paginated. JSON.
    """
    data = _rank_index_data(request)
    players = []
    if data["ranks"]:
      for player in data["ranks"]:
        players.append({"rank": player.rank, "player_id": player.player_id, "html_name": html_colors(player.nick), "rating": int(round(player.g2_r)), "rd": int(round(player.g2_rd))})
    return {
      "region": request.matchdict.get("region", None),
      "game_type_cd": request.matchdict.get("game_type_cd", None),
      "players": players
      }


def game_finder_data(request):
    if request.params.has_key('page'):
        current_page = request.params['page']
    else:
        current_page = 1

    query = {}

    server_id, map_id, player_id = None, None, None
    game_type_cd, start_game_id, end_game_id = None, None, None
    game_type_descr = None

    # these become WHERE clauses when present
    if request.params.has_key('server_id'):
        server_id = request.params['server_id']
        query['server_id'] = server_id

    if request.params.has_key('map_id'):
        map_id = request.params['map_id']
        query['map_id'] = map_id

    if request.params.has_key('player_id'):
        player_id = request.params['player_id']
        query['player_id'] = player_id

    if request.params.has_key('start_game_id'):
        start_game_id = request.params['start_game_id']
        query['start_game_id'] = start_game_id

    if request.params.has_key('end_game_id'):
        end_game_id = request.params['end_game_id']
        query['end_game_id'] = end_game_id

    game_type_cd = request.params.get('type') or request.cookies.get('gametype')
    if game_type_cd:        
        query['type'] = game_type_cd
        try:
            game_type_descr = DBSession.query(GameType.descr).\
                filter(GameType.game_type_cd == game_type_cd).\
                one()[0]
        except Exception as e:
            game_type_cd = None

    rgs_q = recent_games_q(server_id=server_id, map_id=map_id,
            player_id=player_id, game_type_cd=game_type_cd,
            start_game_id=start_game_id, end_game_id=end_game_id, limit=20)

    recent_games = [RecentGame(row) for row in rgs_q.all()]
    
    if len(recent_games) > 0:
        query['start_game_id'] = recent_games[-1].game_id - 1

    # build the list of links for the stripe across the top
    game_type_links = []

    # clear out the game_id window
    gt_query = query.copy()
    if 'start_game_id' in gt_query:
        del gt_query['start_game_id']
    if 'end_game_id' in gt_query:
        del gt_query['end_game_id']

    gameList = games_q();
    gameList.insert(0, 'overall');
    for gt in gameList:
        gt_query['type'] = gt
        url = request.route_path("game_index", _query=gt_query)
        game_type_links.append((gt, url))

    return {
            'recent_games':recent_games,
            'query':query,
            'game_type_cd':game_type_cd,
            'game_type_links':game_type_links,
           }

def game_finder(request):
    """
    Provide a list of recent games with an advanced filter.
    """
    return game_finder_data(request)
