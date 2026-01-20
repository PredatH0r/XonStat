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
  var sql = "select hashkey from " +
    "(select s.hashkey,s.create_dt,max(g.start_dt) start_dt " +
    "  from servers s left outer join games g on g.server_id=s.server_id " +
    "  group by s.hashkey, s.create_dt " +
    ") as tmp " +
    "where create_dt>=current_date - interval '1 month' " +
    "  or start_dt>=current_date - interval '3 month';"
  var activeCount = 0, inactiveCount = 0, deletedCount = 0;

  return Q.ninvoke(cli, "query", sql)
    .then(result => {
      var activeServers = {};
      result.rows.forEach(row => {
        activeServers[row["hashkey"]] = true;
      });
      return activeServers;
    })
    .then(activeServers => {
      var activeIps = {};
      for (var ipAndPort in activeServers) {
        var parts = ipAndPort.split(':');
        activeIps[parts[0]] = true;
      }

      var newServers = cfg.feeder.servers.filter(serverInfoLine => {
        var parts = serverInfoLine.split(':');
        var ipAndPort = parts[1] + ":" + parts[2].split('/')[0];
        if (activeServers[ipAndPort] === true) {
          ++activeCount;
        } else if (activeIps[parts[1]] === true) {
          console.log("inactive " + ipAndPort);
          ++inactiveCount;
        } else {
          console.log("deleting " + ipAndPort);
          ++deletedCount;
          return false;
        }
        return true;
      });
      cfg.feeder.servers = newServers;
      console.log(`active servers: ${activeCount}, inactive: ${inactiveCount}, deleted ${deletedCount}`);
    });
}

main();