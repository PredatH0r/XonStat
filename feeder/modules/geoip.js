var
  pg = require("pg"),
  log4js = require("log4js"),
  request = require("request"),
  Q = require("q");

exports.fillAllServers = fillAllServers;
exports.fillServer = fillServer;

var _logger = log4js.getLogger("geoip");
var throttledUntilTms = 0;

function fillAllServers(cli, config) {
  return queryServers(cli).then(rows => processServers(cli, rows));
}

function queryServers(cli) {
  return Q
    .ninvoke(cli, "query", "select distinct ip_addr from servers where location is null or location='' and coalesce(ip_addr,'')<>''")
    .then(result => Q(result.rows));
}

function processServers(cli, rows) {
  var ips = rows.map(function (row) { return row.ip_addr; });

  var batches = [];
  for (var i = 0; i < ips.length; i += 100)
    batches.push(ips.slice(i, Math.min(i + 100, ips.length)));

  return batches.reduce( (chain, batch) => chain.then(() => fillServers(cli, batch)), Q());
}

function fillServer(cli, ip) {
  return fillServers(cli, [ip]);
}

function fillServers(cli, ips) {
  return lookupGeoIp(ips)
    .then(results => 
      results.reduce((chain, geoInfo) => chain
        .then(() => updateDatabase(cli, geoInfo))
          .catch(err => _logger.error("Failed to set location info for " + ip + ": " + err))
      , Q()));
}

function lookupGeoIp(ips) {
  var now = new Date().getTime();
  var sleep = now < throttledUntilTms ? delay(throttledUntilTms - now) : Q();
  return sleep
    .then(() => {
      var defer = Q.defer();
      var ok = true;
      var opt = {
        uri: "http://ip-api.com/batch/?fields=country,countryCode,region,lat,lon,query",
        method: "POST",
        timeout: 5000,
        json: true,
        body: ips
      };
      request(opt)
        .on("error", function (err) { defer.reject(err); })
        .on("response", function (response) {
          if (response.caseless.get("X-Rl") == "0")
            throttledUntilTms = new Date().getTime() + parseInt(response.caseless.get("X-Ttl") * 1000);
          if (response.statusCode != 200) {
            ok = false;
            defer.reject(new Error("HTTP status code " + response.statusCode));
          }
        })
        .on("data", function (data) {
          if (ok)
            defer.resolve(JSON.parse(data));
        });
      return defer.promise;
    });
}

function updateDatabase(cli, geoInfo) {
  // geoInfo = {country: 'Spain', countryCode: 'ES', region: 'CM', lat: ..., lon: ..., query: '192.157.241.12' }
  var ip = geoInfo.query;
  var region = getRegion(geoInfo.lat, geoInfo.lon);
  var values = [geoInfo.country, region, geoInfo.countryCode, geoInfo.region, geoInfo.lat, geoInfo.lon, ip];
  return Q
    .ninvoke(cli, "query", { name: "servers_upd", text: "update servers set location=$1, region=$2, country=$3, state=$4, latitude=$5, longitude=$6 where ip_addr=$7", values: values })
    .then(function() { _logger.debug("updated location for server " + ip) });
}

function getRegion(lat, lon) {
  const regions = {
    germany: [53.55, 10.48],
    congo: [-2.12, 23.79],
    china: [44.175189, 93.097220],
    australia: [-27.151813, 142.956882],
    usa: [39.277695, -103.059941],
    brazil: [-12.944029, -58.121122]
  };

  var bestDist = 100000000000;
  var bestRegion = 0;
  var keys = Object.keys(regions);
  for (var i = 0; i < keys.length; i++) {
    var region = regions[keys[i]];
    var dist = calcDistance(region[0], region[1], lat, lon);
    if (dist < bestDist) {
      bestDist = dist;
      bestRegion = i;
    }
  }
  return bestRegion + 1;
}

function calcDistance(lat1, lon1, lat2, lon2) {
  var R = 6371000; // metres
  var phi1 = lat1 * Math.PI / 180;
  var phi2 = lat2 * Math.PI / 180;
  var delta_phi = (lat2 - lat1) * Math.PI / 180;
  var delta_lambda = (lon2 - lon1) * Math.PI / 180;

  var a = Math.sin(delta_phi / 2) * Math.sin(delta_phi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(delta_lambda / 2) * Math.sin(delta_lambda / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
