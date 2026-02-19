var
  fs = require("graceful-fs"),
  pg = require("pg"),
  Q = require("q"),
  utils = require("./modules/utils"),
  { MessageChannel } = require ('worker_threads');


function main() {
  const port = new MessageChannel();
  port.port1.ref(); // forces nodejs to keep running until unref()

  var cfgFileNames = process.argv.slice(2);
  
  if (cfgFileNames.length < 1) {
    console.log("usage: purge-servers <cfg1.json>, ...");
    process.exit(1);
  }

  var chain = Q();
  cfgFileNames.forEach(cfgFileName => {
    var cfgPath = __dirname + "/" + cfgFileName;
    var config = JSON.parse(fs.readFileSync(cfgPath));

    chain.then(() => {
      utils.dbConnect(config.webapi.database)
        .then(cli => purgeServers(cli, config)
            .then(() => fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2)))
            .finally(() => cli.release())
        )
        .catch(err => {
          console.log(err);
        })
        .finally(() => utils.dbClose())
        .done();
    })
  });
  chain.then(() => port.port1.unref());
  chain.done();
}

function purgeServers(cli, cfg) {
  // query to get for all servers their hashkey (ip:port), create_dt and latest game start_dt
  // NOTE: servers without any recorded matches are not found in the database!
  var sql =
    "select s.hashkey,s.create_dt create_dt,max(g.start_dt) start_dt " +
    "  from servers s left outer join games g on g.server_id=s.server_id " +
    "  group by s.hashkey,s.create_dt ";
  var activeCount = 0, inactiveCount = 0, deletedCount = 0, newCount = 0;
  var pendingInserts = [];
  return Q.ninvoke(cli, "query", sql)
    .then(result => {
      var activeServers = {};
      result.rows.forEach(row => {
        activeServers[row["hashkey"]] = row["start_dt"] || row["create_dt"];
      });
      return activeServers;
    })
    .then(activeServers => {
      var activeIps = {};
      for (var ipAndPort in activeServers) {
        var parts = ipAndPort.split(':');
        if (!activeIps[parts[0]] || activeIps[parts[0]] < activeServers[ipAndPort])
          activeIps[parts[0]] = activeServers[ipAndPort];
      }

      var cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 3 * 30); // created or last recorded match more than 90 days ago
      var newServers = cfg.feeder.servers.filter(serverInfoLine => {
        var parts = serverInfoLine.split(':');
        var ip = parts[1];
        var port = parts[2].split('/')[0];
        var ipAndPort = ip + ":" + port;
        if (activeServers[ipAndPort] >= cutoff) {
          ++activeCount;
        }
        else if (activeIps[parts[1]] >= cutoff) {
          console.log("inactive " + ipAndPort); // server on different port on same IP is active
          ++inactiveCount;
        }
        else if (activeServers[ipAndPort]) {
          console.log("deleting " + ipAndPort);
          ++deletedCount;
          return false;
        }
        else {
          // ip:port wasn't found in the database, so add it, that it can be deleted if there are no recorded matches in the next 90 days
          console.log("adding " + ipAndPort);
          ++newCount;
          pendingInserts.push(
            Q.ninvoke(cli, "query", { name: "insert_server", text: "insert into servers(hashkey,ip_addr,port,create_dt) values ($1, $2, $3, now())", values: [ipAndPort, ip, port] })
          );
        }

        return true;
      });
      cfg.feeder.servers = newServers;
    })
    .then(() => Q.all(pendingInserts))
    .then(() => {
      console.log(`active/new servers: ${activeCount}, inactive: ${inactiveCount}, deleted ${deletedCount}, added ${newCount}`);
    });
}

main();