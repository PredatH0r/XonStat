const
  pg = require("pg"),
  Q = require("q");

exports.dbConnect = dbConnect;
exports.dbClose = dbClose;
exports.strippedNick = strippedNick;

var initialized = false;

var pool;

// connect to the DB
function dbConnect(conn) {
  // this hack prevents node-postgres from applying the local time offset to timestaps that are already in UTC 
  // see: https://github.com/brianc/node-postgres/issues/429#issuecomment-24870258
  if (!initialized) {
    const regex = /postgres:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/;
    let match = conn.match(regex);
    let poolConfig = { connectionString: conn };
    // if (match) {
    //   poolConfig = {
    //     user: match[1],
    //     password: match[2],
    //     host: match[3],
    //     port: match[4],
    //     database: match[5]
    //   };
    // }
    poolConfig.connectionTimeoutMillis = 1000;
    pool = new pg.Pool(poolConfig);
    pg.types.setTypeParser(1114, function (stringValue) {
      return new Date(Date.parse(stringValue + "+0000"));
    });
    initialized = true;
  }

  var defConnect = Q.defer();
  pool.connect(function (err, cli, release) {
    if (err)
      defConnect.reject(new Error("failed to connect to postgreSQL: " + err));
    else {
      cli.release = release;
      defConnect.resolve(cli);
    }
  });
  return defConnect.promise;
}

function dbClose() {
  if (pool)
    pool.end();
}

/**
 * Remove color coding from nicknames (^1Nic^7k => Nick)
 * @param {string} nick
 */
function strippedNick(nick) {
  var stripped = "";
  var i, c;
  for (i = 0; i < nick.length; i++) {
    if (nick[i] === "^")
      i++;
    else
      stripped += nick[i];
  }
  return stripped;
}
