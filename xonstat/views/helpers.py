import logging
import sqlalchemy.sql.expression as expr
from datetime import datetime
from sqlalchemy import or_
from sqlalchemy.orm import aliased
from xonstat.models import *
from xonstat.util import *
from urllib import unquote

log = logging.getLogger(__name__)

class RecentGame(object):
    '''
    This is a helper class to facilitate showing recent games
    data within mako. The idea is to take the results of a query
    and transform it into class members easily accessible later.
    It is like a namedtuple but a little easier to form.

    The constructor takes a query row that has been fetched, and
    it requires the following columns to be present in the row:

        game_id, game_type_cd, game_type_descr, winner, start_dt,
        server_id, server_name, map_id, map_name, player_id, nick,
        rank, team

    The following columns are optional:

        elo_delta

    This class is meant to be used in conjunction with recent_games_q,
    which will return rows matching this specification.
    '''
    def __init__(self, row):
        self.game_id = row.game_id
        self.game_type_cd = row.game_type_cd
        self.game_type_descr = row.game_type_descr
        self.winner = row.winner
        self.start_dt = row.start_dt
        self.fuzzy_date = pretty_date(row.start_dt)
        self.epoch = timegm(row.start_dt.timetuple())
        self.server_id = row.server_id
        self.server_name = row.server_name
        self.map_id = row.map_id
        self.map_name = row.map_name
        self.g2_status = row.g2_status
        self.score1 = row.score1
        self.score2 = row.score2
        self.country = row.country;
        self.location = row.location;
        self.pg1_player_id = row.pg1_player_id
        self.pg1_nick = row.pg1_nick
        self.pg1_rank = row.pg1_rank
        self.pg1_team = row.pg1_team
        self.pg1_old_r = row.pg1_old_r
        self.pg1_old_rd = row.pg1_old_rd
        self.pg1_delta_r = row.pg1_delta_r
        self.pg1_delta_rd = row.pg1_delta_rd
        self.pg2_player_id = row.pg2_player_id
        self.pg2_nick = row.pg2_nick
        self.pg2_rank = row.pg2_rank
        self.pg2_team = row.pg2_team
        self.pg2_old_r = row.pg2_old_r
        self.pg2_old_rd = row.pg2_old_rd
        self.pg2_delta_r = row.pg2_delta_r
        self.pg2_delta_rd = row.pg2_delta_rd
        self.pg3_player_id = row.pg3_player_id
        self.pg3_nick = row.pg3_nick
        self.pg3_rank = row.pg3_rank
        self.pg3_team = row.pg3_team
        self.pg3_old_r = row.pg3_old_r
        self.pg3_old_rd = row.pg3_old_rd
        self.pg3_delta_r = row.pg3_delta_r
        self.pg3_delta_rd = row.pg3_delta_rd

    def __json__(self, request):
        return self._asdict()

    def _asdict(self):
        return {
            "game_id": self.game_id,
            "game_type_cd": self.game_type_cd,
            "game_type_descr": self.game_type_descr,
            "winner": self.winner,
            "start_dt": self.start_dt,
            "fuzzy_dt": self.fuzzy_date,
            "epoch": self.epoch,
            "server_id": self.server_id,
            "server_name": self.server_name,
            "map_id": self.map_id,
            "map_name": self.map_name,
            "score1": self.score1,
            "score2": self.score2,
            "g2_status": self.g2_status,
            "pg1_player_id": self.pg1_player_id,
            "pg1_nick": self.pg1_nick,
            "pg1_rank": self.pg1_rank,
            "pg1_team": self.pg1_team,
            "pg1_delta_r": int(round(self.pg1_delta_r,0)) if self.pg1_delta_r else None,
            "pg1_delta_rd": int(round(self.pg1_delta_rd, 0)) if self.pg1_delta_rd else None,
            "pg1_old_r":int(round(self.pg1_old_r, 0)) if self.pg1_old_r else None,
            "pg1_old_rd":int(round(self.pg1_old_rd, 0)) if self.pg1_old_rd else None,
            "pg2_player_id": self.pg2_player_id,
            "pg2_nick": self.pg2_nick,
            "pg2_rank": self.pg2_rank,
            "pg2_team": self.pg2_team,
            "pg2_delta_r": int(round(self.pg2_delta_r,0)) if self.pg2_delta_r else None,
            "pg2_delta_rd": int(round(self.pg2_delta_rd, 0)) if self.pg2_delta_rd else None,
            "pg2_old_r":int(round(self.pg2_old_r, 0)) if self.pg2_old_r else None,
            "pg2_old_rd":int(round(self.pg2_old_rd, 0)) if self.pg2_old_rd else None,
            "pg3_player_id": self.pg3_player_id,
            "pg3_nick": self.pg3_nick,
            "pg3_rank": self.pg3_rank,
            "pg3_team": self.pg3_team,
            "pg3_delta_r": int(round(self.pg3_delta_r,0)) if self.pg3_delta_r else None,
            "pg3_delta_rd": int(round(self.pg3_delta_rd, 0)) if self.pg3_delta_rd else None,
            "pg3_old_r":int(round(self.pg3_old_r, 0)) if self.pg3_old_r else None,
            "pg3_old_rd":int(round(self.pg3_old_rd, 0)) if self.pg3_old_rd else None
            }

    def __repr__(self):
        return "<RecentGame(id=%s, gametype=%s, server=%s, map=%s)>" % (self.game_id, self.game_type_cd, self.server_name, self.map_name)

def games_q():
    result = DBSession.query(GameType.game_type_cd).\
            filter(GameType.active_ind==True).\
          order_by(expr.asc(GameType.game_type_cd)).\
      all();
    return [row[0] for row in result];

def recent_games_q(server_id=None, map_id=None, player_id=None,
        game_type_cd=None, cutoff=None, force_player_id=False,
        start_game_id=None, end_game_id=None, limit=-1):
    '''
    Returns a SQLA query of recent game data. Parameters filter
    the results returned if they are provided. If not, it is
    assumed that results from all servers and maps is desired.

    The cutoff parameter provides a way to limit how far back to
    look when querying. Only games that happened on or after the
    cutoff (which is a datetime object) will be returned.
    '''
    pgstat1 = aliased(PlayerGameStat, name='pgstat1')
    pgstat2 = aliased(PlayerGameStat, name='pgstat2')
    pgstat3 = aliased(PlayerGameStat, name='pgstat3')

    recent_games_q = DBSession.query(Game.game_id, Game.server_id, Game.map_id, 
            Game.game_type_cd, Game.winner, Game.start_dt, 
            Game.score1, Game.score2, Game.g2_status, Game.player_id1, Game.player_id2, Game.create_dt).\
        order_by(expr.desc(Game.create_dt))

    # the various filters provided get tacked on to the query
    if server_id is not None:
        recent_games_q = recent_games_q.filter(Game.server_id==server_id)

    if map_id is not None:
        recent_games_q = recent_games_q.filter(Game.map_id==map_id)

    if player_id is not None:
        recent_games_q = recent_games_q.filter(Game.players.contains([player_id]))
        #sub = DBSession.query(PlayerGameStat.game_id).filter(PlayerGameStat.player_id==player_id).order_by(expr.desc(PlayerGameStat.create_dt))
        #recent_games_q = recent_games_q.filter(Game.game_id.in_(sub))

    if game_type_cd is not None and game_type_cd != '':
        recent_games_q = recent_games_q.filter(Game.game_type_cd==game_type_cd.lower())

    if cutoff is not None:
        right_now = datetime.utcnow()
        recent_games_q = recent_games_q.\
            filter(expr.between(Game.create_dt, cutoff, right_now))
            ## filter(expr.between(PlayerGameState.create_dt, cutoff, right_now))

    if start_game_id is not None:
        recent_games_q = recent_games_q.filter(Game.game_id <= start_game_id)

    if end_game_id is not None:
        recent_games_q = recent_games_q.filter(Game.game_id >= end_game_id)

    if limit >= 0:
            recent_games_q = recent_games_q.limit(limit)

    GameQ = recent_games_q.subquery()

    recent_games_q = DBSession.query(
            GameQ.c.game_id, GameQ.c.game_type_cd, GameQ.c.server_id, GameQ.c.map_id, GameQ.c.winner, GameQ.c.start_dt, GameQ.c.score1, GameQ.c.score2, GameQ.c.g2_status, GameQ.c.player_id1, GameQ.c.player_id2, GameQ.c.create_dt,
            Server.name.label('server_name'), Server.country, Server.location,
            Map.map_id, Map.name.label('map_name'), 
            GameType.descr.label('game_type_descr'),
            pgstat1.player_id.label("pg1_player_id"), pgstat1.nick.label("pg1_nick"), pgstat1.rank.label("pg1_rank"), pgstat1.team.label("pg1_team"), pgstat1.g2_old_r.label("pg1_old_r"), pgstat1.g2_old_rd.label("pg1_old_rd"), pgstat1.g2_delta_r.label("pg1_delta_r"), pgstat1.g2_delta_rd.label("pg1_delta_rd"),
            pgstat2.player_id.label("pg2_player_id"), pgstat2.nick.label("pg2_nick"), pgstat2.rank.label("pg2_rank"), pgstat2.team.label("pg2_team"), pgstat2.g2_old_r.label("pg2_old_r"), pgstat2.g2_old_rd.label("pg2_old_rd"), pgstat2.g2_delta_r.label("pg2_delta_r"), pgstat2.g2_delta_rd.label("pg2_delta_rd"),
            pgstat3.player_id.label("pg3_player_id"), pgstat3.nick.label("pg3_nick"), pgstat3.rank.label("pg3_rank"), pgstat3.team.label("pg3_team"), pgstat3.g2_old_r.label("pg3_old_r"), pgstat3.g2_old_rd.label("pg3_old_rd"), pgstat3.g2_delta_r.label("pg3_delta_r"), pgstat3.g2_delta_rd.label("pg3_delta_rd")
            ).\
            outerjoin(pgstat1, (pgstat1.game_id == GameQ.c.game_id) & (pgstat1.player_id == GameQ.c.player_id1) & or_(pgstat1.team == None, pgstat1.team == 1)).\
            outerjoin(pgstat2, (pgstat2.game_id == GameQ.c.game_id) & (pgstat2.player_id == GameQ.c.player_id2) & or_(pgstat2.team == None, pgstat2.team == 2)).\
            filter(Server.server_id == GameQ.c.server_id).\
            filter(Map.map_id == GameQ.c.map_id).\
            filter(GameType.game_type_cd == GameQ.c.game_type_cd).\
            order_by(expr.desc(GameQ.c.create_dt))
            

    if player_id is not None and force_player_id:
        recent_games_q = recent_games_q.outerjoin(pgstat3, (pgstat3.game_id == GameQ.c.game_id) & (pgstat3.player_id == player_id))
    else:
        recent_games_q = recent_games_q.outerjoin(pgstat3, pgstat3.game_id == 0)


    return recent_games_q

def checkSession(request):
    sessioncookie = unquote(request.cookies.get("SteamAuthSession", ""))
    row = DBSession.query(Hashkey).\
            filter_by(sessionkey=sessioncookie).\
            first()
    if row is None or row.active_ind == False:
        raise pyramid.httpexceptions.HTTPUnauthorized
