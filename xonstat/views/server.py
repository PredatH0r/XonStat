import logging
import sqlalchemy.sql.functions as func
import sqlalchemy.sql.expression as expr
from datetime import datetime, timedelta
from beaker.cache import cache_regions, cache_region
from webhelpers.paginate import Page
from xonstat.models import *
from xonstat.util import page_url, html_colors
from xonstat.views.helpers import RecentGame, recent_games_q, checkSession

log = logging.getLogger(__name__)

def _server_index_data(request):
    checkSession(request)

    if request.params.has_key('page'):
        current_page = request.params['page']
    else:
        current_page = 1

    try:
        server_q = DBSession.query(Server).\
                order_by(Server.server_id.desc())

        servers = Page(server_q, current_page, items_per_page=25, url=page_url)


    except Exception as e:
        servers = None

    return {'servers':servers, }


def server_index(request):
    """
    Provides a list of all the current servers.
    """
    return _server_index_data(request)


def server_index_json(request):
    """
    Provides a list of all the current servers. JSON.
    """
    return [{'status':'not implemented'}]


def _server_info_data(request):
    try:
        leaderboard_lifetime = int(request.registry.settings['xonstat.leaderboard_lifetime'])
    except:
        leaderboard_lifetime = 30

    leaderboard_count = 10
    recent_games_count = 20

    server_id = request.matchdict['id']

    try:
        # if a "." is in the id, lookup server table by ip address to get the real id
        if "." in server_id:
                server = DBSession.query(Server).filter_by(hashkey=server_id).first()
                if server:
                        server_id = server.server_id
        else:
                server = DBSession.query(Server).filter_by(server_id=server_id).first()

        if server == None:
                return { 'server': None, 'recent_games': [], 'top_players': [], 'top_maps': [] }

        # top players by score
        top_scorers = DBSession.query(Player, func.sum(PlayerGameStat.score)).\
                join(PlayerGameStat, PlayerGameStat.player_id == Player.player_id).\
                join(Game, Game.game_id == PlayerGameStat.game_id).\
                filter(Game.server_id == server.server_id).\
                filter(Game.create_dt > (datetime.utcnow() - timedelta(days=leaderboard_lifetime))).\
                filter(PlayerGameStat.player_id > 2).\
                group_by(Player.player_id).\
                group_by(Player.nick).\
                order_by(expr.desc(func.sum(PlayerGameStat.score))).\
                limit(leaderboard_count).all()
#                filter(PlayerGameStat.create_dt > (datetime.utcnow() - timedelta(days=leaderboard_lifetime))).\

        top_scorers = [(player.player_id, player.nick, player.nick_html_colors(), score) \
                for (player, score) in top_scorers]

        # top players by playing time
        top_players = get_top_players_by_time(server_id)

        # top maps by total times played
        top_maps = get_top_maps(server_id)

        # recent games played in descending order
        rgs = recent_games_q(server_id=server_id, limit=recent_games_count).all()
        recent_games = [RecentGame(row) for row in rgs]

    except Exception as e:
        server = None
        recent_games = None
        top_players = None
        raise e
    return {'server':server,
            'recent_games':recent_games,
            'top_players': top_players,
            'top_maps': top_maps,
            'top_scorers': top_scorers,
            }


@cache_region('hourly_term')
def get_top_players_by_time(server_id):
    try:
        leaderboard_lifetime = int(request.registry.settings['xonstat.leaderboard_lifetime'])
    except:
        leaderboard_lifetime = 30

    leaderboard_count = 10
    recent_games_count = 20

    try:
        top_players = DBSession.query(PlayerGameStat.player_id, func.sum(PlayerGameStat.alivetime)).\
                filter(Game.server_id == server_id).\
                filter(Game.create_dt > (datetime.utcnow() - timedelta(days=leaderboard_lifetime))).\
                filter(PlayerGameStat.game_id == Game.game_id).\
                filter(PlayerGameStat.player_id > 2).\
                order_by(expr.desc(func.sum(PlayerGameStat.alivetime))).\
                group_by(PlayerGameStat.player_id).\
                limit(leaderboard_count).all()

        player_ids = []
        player_total = {}
        for (player_id, total) in top_players:
                player_ids.append(player_id)
                player_total[player_id] = total

        top_players = []
        players = DBSession.query(Player.player_id, Player.nick).filter(Player.player_id.in_(player_ids)).all()
        for (player_id, nick) in players:
                top_players.append( (player_id, nick, player_total[player_id]) )
        top_players.sort(key=lambda tup: -tup[2])

    except Exception as e:
        top_players = []
        raise e
    return top_players


@cache_region('hourly_term')
def get_top_maps(server_id):
    try:
        leaderboard_lifetime = int(request.registry.settings['xonstat.leaderboard_lifetime'])
    except:
        leaderboard_lifetime = 30

    leaderboard_count = 10
    recent_games_count = 20

    try:
        top_maps = DBSession.query(Game.map_id, Map.name,
                func.count()).\
                filter(Map.map_id==Game.map_id).\
                filter(Game.server_id==server_id).\
                filter(Game.create_dt > (datetime.utcnow() - timedelta(days=leaderboard_lifetime))).\
                order_by(expr.desc(func.count())).\
                group_by(Game.map_id).\
                group_by(Map.name).limit(leaderboard_count).all()

    except Exception as e:
        top_maps = []
        raise e
    return top_maps


def server_info(request):
    """
    List the stored information about a given server.
    """
    serverinfo_data =  _server_info_data(request)

    # FIXME: code clone, should get these from _server_info_data
    leaderboard_count = 10
    recent_games_count = 20

    for i in range(leaderboard_count-len(serverinfo_data['top_players'])):
        serverinfo_data['top_players'].append(('', '', ''))

    for i in range(leaderboard_count-len(serverinfo_data['top_maps'])):
        serverinfo_data['top_maps'].append(('', '', ''))

    return serverinfo_data


def server_info_json(request):
    """
    List the stored information about a given server. JSON.
    """
    return [{'status':'not implemented'}]


def _server_game_index_data(request):
    server_id = request.matchdict['server_id']
    current_page = request.matchdict['page']

    try:
        server = DBSession.query(Server).filter_by(server_id=server_id).one()

        games_q = DBSession.query(Game, Server, Map).\
                filter(Game.server_id == server_id).\
                filter(Game.server_id == Server.server_id).\
                filter(Game.map_id == Map.map_id).\
                order_by(Game.create_dt.desc())

        games = Page(games_q, current_page, url=page_url)
    except Exception as e:
        server = None
        games = None
        raise e

    return {'games':games,
            'server':server}


def server_game_index(request):
    """
    List the games played on a given server. Paginated.
    """
    return _server_game_index_data(request)


def server_game_index_json(request):
    """
    List the games played on a given server. Paginated. JSON.
    """
    return [{'status':'not implemented'}]
