#!/bin/sh
cd ~xonstat/xonstat/feeder
list=$1
if test -z "$list"; then
  list="1 2 3 4 _api"
fi

for inst in $list
do
  echo starting feeder $inst
  pid=`ps -ef | grep "node feeder.node.js -c cfg$inst.json" | grep -v "grep" | cut -c 10-14`
  if [ -n "$pid" ]; then
    kill $pid
    sleep 1
  fi
  ~xonstat/xonstat/cronjobs/autorestart.sh nohup node feeder.node.js -c cfg$inst.json >>feeder$inst.log 2>&1 &
done
