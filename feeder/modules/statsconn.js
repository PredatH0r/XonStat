var zmq = require("zeromq");
var events = require("events");

exports.create = create;
exports.setLogger = setLogger;


const MonitorInterval = 1000; // interval for checking connection status
const ConnectAttemptInterval = 10 * 1000; // try for 10 sec to establish a connection, then consider the server to be offline
const OfflineServerRetryInterval = 5 * 60 * 1000; // try to reconnect to offline servers after 5min
const IdleReconnectInterval = 15 * 60 * 1000; // reconnect to idle servers after 15min (QL stops sending data at some point)
const ReconnectRandomizedInterval = 10 * 1000; // randomly delay reconnection attempts by up to +/-5 seconds to avoid load spikes on the server
const ConnectAttempts = 3; // with a bad password, there is first a "connect" and then an immediate "disconnect" afterwards. Some servers disconnect also 1-2 times with a valid password

var _logger = {};
_logger.trace = _logger.debug = _logger.info = _logger.warn = _logger.error = function(msg) { log(msg); };

function create(owner, ip, port, pass, onZmqMessageCallback, gamePort) {
  return new StatsConnection(owner, ip, port, pass, onZmqMessageCallback, gamePort);
}

function setLogger(logger) {
  _logger = logger;
}

function safeFunction(func) {
  // can't use a lambda here because that would not capture the "arguments"
  return function () {
    try {
      return func.apply(this, arguments);
    } catch (err) {
      _logger.error(err);
    }
  };
}

function StatsConnection(owner, ip, port, pass, onZmqMessageCallback, gamePort) {
  this.owner = owner;
  this.ip = ip;
  this.port = port;
  this.pass = pass;
  this.onZmqMessageCallback = onZmqMessageCallback;
  this.gamePort = gamePort || port;
  
  this.addr = ip + ":" + port;
  this.lastConnectAttemptFailed = false;
  this.connectAttempt = 0;
  this.badPassword = false;
  this.resetState();
}

StatsConnection.prototype.resetState = function () {
  this.matchStartTime = 0;
  this.playerStats = [];

  if (this.reconnectTimer)
    clearTimeout(this.reconnectTimer);
  this.reconnectTimer = null;

  if (this.connectedTimer)
    clearTimeout(this.connectedTimer);
  this.connectedTimer = null;

  this.connecting = false;
  this.connected = false;
  this.disconnected = false;
  this.lastMessageUtc = 0;
  this.connectUtc = 0;

  // stuff for the webapi
  this.players = {};
  this.gameType = null;
  this.factory = null;

  // stuff for feeder to track rounds and real play time
  this.round = 0;
  this.roundStartTime = 0;
  this.emitter = new events.EventEmitter();
  this.roundStats = [];
  this.quitters = [];

  this.events = [];
}

StatsConnection.prototype.connect = function(isReconnect) {
  var self = this;

  _logger.trace(self.addr + ": connect(" + isReconnect + ")");

  if (this.connecting || this.connected)
    return;

  this.resetState();
  this.connecting = true;
  this.connectUtc = Date.now();

  this.sub = zmq.socket("sub");
  if (this.pass) {
    this.sub.sap_domain = "stats";
    this.sub.plain_username = "stats";
    this.sub.plain_password = this.pass;
  }

  _logger.info(self.addr + ": trying to connect");

  this.sub.on("connect",
    safeFunction(() => {
      _logger.trace(self.addr + ": ZMQ connect");

      if (!self.connected) // "message" might have been received even before "connect"
        self.connectedTimer = setTimeout(() => self.logConnected(isReconnect), 10);
    }));

  this.sub.on("connect_delay",
    safeFunction(() => {
      _logger.trace(self.addr + ": ZMQ connect_delay");

      if (self.connected) // ignore a "connect_delay" that is received after a successful "connect"
        return;
      if (Date.now() - self.connectUtc >= ConnectAttemptInterval) {
        if (self.lastConnectAttemptFailed) // avoid log spam
          _logger.debug(self.addr + ": still failing to connect, but will keep trying...");
        else
          _logger.warn(self.addr + ": failed to connect, but will keep trying...");
        self.disconnect();
        self.startReconnectTimer();
        self.lastConnectAttemptFailed = true;
      }
    }));

  this.sub.on("connect_retry",
    safeFunction(() => {
      _logger.trace(self.addr + ": ZMQ connect_retry");
    //  self.connecting = true;
    //  if (Date.now() - self.connectUtc >= ConnectAttemptInterval) {
    //    self.disconnect();
    //    self.startReconnectTimer();
    //  } else if (self.failAttempt % 40 === 0)
    //    _logger.debug(self.addr + ": retrying to connect");
    }));

  this.sub.on("message",
    safeFunction(data => {
      _logger.trace(self.addr + ": ZMQ message");

      self.lastMessageUtc = Date.now();

      // a "message" might arrive before a delayed logConnected() is called from within "connect"
      if (!self.connected) {
        clearTimeout(self.connectedTimer);
        self.connectedTimer = null;
        self.logConnected();
      }

      self.onZmqMessageCallback(self, data);
      self.resetIdleTimeout();
    }));

  this.sub.on("disconnect",
    safeFunction(() => {
      _logger.trace(self.addr + ": ZMQ disconnect");

      if (self.disconnected)
        return;

      if (self.connectedTimer) {
        clearTimeout(self.connectedTimer);
        self.connectedTimer = null;
      }

      self.badPassword = ++self.connectAttempt >= ConnectAttempts;

      if (!self.badPassword) {
        if (self.connected)
          _logger.info(self.addr + ": disconnected");
        else
          _logger.trace(self.addr + ": disconnected")

        self.disconnect();
        // defer reconnect so that the "monitor_error" caused by self.disconnect() gets processed first
        setTimeout(() => self.connect(false), 0); 
      }
      else {
        // when the password is wrong, we first get a "connect" event and then immediately after a "disconnect"
        _logger.info(self.addr + ": disconnected (probably wrong password)");
        self.disconnect();
        self.startReconnectTimer();
      }
    }));

  this.sub.on("monitor_error",
    safeFunction(() => {
      _logger.trace(self.addr + ": ZMQ monitor_error");

      if (self.disconnected) // the "monitor_error" event may be a result of intentionally disconnecting
        return;
      _logger.error(self.addr + ": error monitoring network status");
      self.disconnect();
      self.startReconnectTimer(); // maybe should change this to an undelayed (but defered) self.connect()
    }));

  this.sub.monitor(MonitorInterval, 0);
  this.sub.connect("tcp://" + this.addr);
  this.sub.subscribe("");
};

StatsConnection.prototype.logConnected = function (isReconnect) {
  const self = this;
  self.connected = true;
  self.connectUtc = Date.now();
  self.badPassword = false;
  self.lastConnectAttemptFailed = false;
  if (isReconnect)
    _logger.debug(self.addr + ": reconnected successfully");
  else
    _logger.info(self.addr + ": connected successfully");
  self.resetIdleTimeout();
}

StatsConnection.prototype.startReconnectTimer = function() {
  var self = this;
  this.reconnectTimer = setTimeout(function () {
    self.badPassword = false;
    self.connectAttempt = 0;
    self.connect();
  },
    OfflineServerRetryInterval + (Math.random() - 0.5) * ReconnectRandomizedInterval);
};

StatsConnection.prototype.resetIdleTimeout = function() {
  var self = this;
  if (this.idleTimeout)
    clearTimeout(this.idleTimeout);
  this.idleTimeout = setTimeout(function() { self.onIdleTimeout(); },
    IdleReconnectInterval + (Math.random() - 0.5) * ReconnectRandomizedInterval);
};

StatsConnection.prototype.onIdleTimeout = function() {
  _logger.debug(this.addr + ": disconnecting from idle server");
  this.disconnect();
  this.connect(true);
};

StatsConnection.prototype.disconnect = function () {
  _logger.trace(this.addr + ": disconnect()");

  if (!this.disconnected) {
    this.disconnected = true;
    //try { this.sub.unsubscribe(""); } catch (err) { }
    try {
      this.sub.unmonitor();
    } catch (err) {
      _logger.error("Can't unmonitor " + this.addr + ": " + err);
    }
    if (this.connected) {
      try {
        this.sub.disconnect("tcp://" + this.addr);
      } catch (err) {
        _logger.error("Can't disconnect from " + this.addr + ": " + err);
      }
    }
    try {
      this.sub.close();
    } catch (err) {
      _logger.error("Can't close " + this.addr + ": " + err);
    }
  }
  this.connected = false;
  this.connecting = false;
  this.lastMessageUtc = 0;
  //this.connectUtc = Date.now();

  if (this.idleTimeout)
    clearTimeout(this.idleTimeout);
  this.idleTimeout = null;

  if (this.reconnectTimer)
    clearTimeout(this.reconnectTimer);
  this.reconnectTimer = null;

  if (this.connectedTimer)
    clearTimeout(this.connectedTimer);
  this.connectedTimer = null;

  this.players = {};
  //this.gameType = null;
};

StatsConnection.prototype.compareTo = function(other) {
  var c = (this.owner || "").localeCompare(other.owner || "");
  if (c !== 0) return c;
  c = compareIp(this.ip, other.ip);
  if (c !== 0) return c;
  if (this.port < other.port) return -1;
  if (this.port > other.port) return +1;
  return 0;

  function compareIp(a, b) {
    var x = a.split(".").map(function(n) { return parseInt(n); });
    var y = b.split(".").map(function(n) { return parseInt(n); });
    for (var i = 0; i < 4; i++) {
      if (x[i] < y[i]) return -1;
      if (x[i] > y[i]) return +1;
    }
    return 0;
  }
};
