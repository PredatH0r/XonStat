(function() {

  const
    fs = require("graceful-fs"),
    pg = require("pg"),
    log4js = require("log4js"),
    Q = require("q"),
    geo = require("./modules/geoip");

  var _config = JSON.parse(fs.readFileSync(__dirname + "/cfg.json"));
  const _logger = log4js.getLogger("geoip");

  function main() {
    _logger.level = "DEBUG";

    return dbConnect()
      .then(function(cli) {
        return geo.fillAllServers(cli, _config.geoip)
          .finally(function() { cli.release(); });
      })
      .catch(function(err) {
        _logger.error(err);
        throw err;
      })
      .done(function() {
        _logger.info("-- done --");
        process.exit(0);
      });
  }

  function dbConnect() {
    var defConnect = Q.defer();
    pg.connect(_config.webapi.database, function(err, cli, release) {
      if (err)
        defConnect.reject(new Error(err));
      else {
        cli.release = release;
        defConnect.resolve(cli);
      }
    });
    return defConnect.promise;
  }

  main();

})();