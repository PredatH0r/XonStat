#!/bin/sh
set curdir=`pwd`
set pgpassword=xonstat
cd `dirname $0`/..
psql -U xonstat -w xonstatdb <sql/update_player_region.sql
psql -U xonstat -w xonstatdb <sql/update_ranks.sql
psql -U xonstat -w xonstatdb <sql/purge_deleted_steamids.sql
cd feeder
node purge-servers.node.js cfg1.json cfg2.json cfg3.json cfg4.json
cd "$curdir"
