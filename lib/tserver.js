var request = require('request');
var util = require('util');
var _ = require('lodash');
var parseTorrent = require('parse-torrent');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var moment = require('moment');
var Torrent = require('./torrent');
var tEvents = require('./tevents');
var debug = require('debug')('tServer');
var debugRequests = require('debug')('requests');

/**
 * Expose tServer.
 */
module.exports = tServer;

function tServer(options, redis) {
    options = options || {};
    this.host = options.host;
    this.port = options.port;
    this.rpcUrl = 'http://' + options.host + ':' + options.port + '/transmission/rpc';
    this.username = options.username;
    this.password = options.password;
    this.download_dir = options.download_dir;
    this.token = null;
    this.cookies = request.jar();
    this.redis = redis;
    this.attempts = 0;
    this.session_id = '';
    EventEmitter.call(this);
};

/**
 * Inherit from 'EventEmitter.prototype'.
 */

util.inherits(tServer, EventEmitter);

/**
 * Get the total count of downloads for this instance
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
tServer.prototype.getCount = function(callback) {
  this.request('session-stats', null, function(err, response) {
    if (err) {
      callback(err);
    } else {
      if (!_.isUndefined(response.arguments)) {
        callback(null, response.arguments.torrentCount);
      } else {
        callback(response);
      }
    }
  });
};

/**
 * Remove torrent
 * @param  {[type]}   hash     [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
tServer.prototype.remove = function(hash, callback) {
  var args = {
    'ids' : [hash]
  }
  this.redis.del(hash);
  this.request('torrent-remove', args, callback);
};

/**
 * Verify torrent
 * @param  {[type]}   hash     [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
tServer.prototype.verify = function(hash, callback) {
  var args = {
    'ids' : [hash]
  }
  this.request('torrent-verify', args, callback);
};

/**
 * Resume an already existing transfer
 *
 *
 */
tServer.prototype.resume = function(hash, callback) {
  
  var self = this;

  var thisEvent = new tEvents(hash, self.redis);

  self.get(thisEvent.hash, function(err, torrent) {
    callback(err, thisEvent, torrent);
    self.poll(thisEvent);
  });

};

/**
 * Get the total count of downloads for this instance
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
tServer.prototype.add = function(torrent_url, hash, callback) {

  debug('tServer.add: ' + torrent_url + ' hash: ' + hash);

  var self = this;
 
  var args = {
    'filename' : torrent_url, 
    'download-dir' : self.download_dir + '/' + hash
  };

  self.request('torrent-add', args, function(err, body) {

    if (err) {
      return callback(err);
    }

    var thisEvent = new tEvents(hash, self.redis);

    self.get(thisEvent.hash, function(err, torrent) {
      callback(null, thisEvent, torrent);
      self.poll(thisEvent);
    });

  });

};

/**
 * Poll for a specific hash and emit events
 * @param  {[type]} thisEvent [description]
 * @return {[type]}           [description]
 */
tServer.prototype.poll = function(thisEvent) {

  this.pollDate = moment().unix() * 1000;
  this.timer = true;
  
  var self = this;

  //Listen for cancel event to stop our polling and remove from tServer 
  thisEvent.on('cancel_remove', function() {
     clearTimeout(self.timer);
     self.timer = false;
     self.remove(thisEvent.hash, function(err, res) {
        //Don't care about callback, but we'll remove it clean up tServer if it's been cancelled
     });   
  });

  //Listen for cancel event to stop our polling and remove from tServer 
  thisEvent.on('cancel', function() {
     clearTimeout(self.timer);
     self.timer = false;
  });

  var pollInterval = function() {

    thisEvent.emit('sendPoll', thisEvent.hash);
    
    self.get(thisEvent.hash, function(err, torrent) {

      if (err) {
        thisEvent.emit('sendError', err);
        return clearTimeout(self.timer);
      }

      if (torrent) {
     
        self.pollDate = moment().unix() * 1000;  
        
        //Torrent is complete
        if (torrent.isStatusCompleted()) {
            thisEvent.emit('sendComplete', torrent);
            return clearTimeout(self.timer);
        
        //Torrent threw an error
        } else if (torrent.error !== 0) {
            thisEvent.emit('sendError', torrent);
            return clearTimeout(self.timer);

        //Torrent has no seeders
        } else if (!torrent.hasSeeds()) {
            thisEvent.emit('sendNoSeeds', torrent);
            return clearTimeout(self.timer);

        //Torrent is stalled, treat as timeout
        } else if (torrent.isStalled) {
            thisEvent.emit('sendTimeout', torrent);
            return clearTimeout(self.timer);

        //Torrent is downloading
        } else {
           thisEvent.emit('sendDownload', torrent);
        }

      } else {
        //If a magnet link is invalid or for whatever other reason we don't get our torrent
        //and it's been 5 minutes
        var delay = moment().diff(moment(self.pollDate), 'seconds')
        if (delay > 300) {
          self.redis.del(thisEvent.hash);
          return thisEvent.emit('sendTimeout', {'host': self.host, 'hash': thisEvent.hash, 'reason' : 'exceeded 300 seconds'}); 
        }
      }

      if (self.timer || typeof self.timer === 'number') {
        self.timer = setTimeout(pollInterval, 2000)
      }

    });
   
  }
  
  setImmediate(pollInterval);

};


/**
 * Get a single torrent by hash
 */
tServer.prototype.get = function(hash, callback) {

  debug('tServer.get: ' + hash);

  var self = this;
  
  var args = {
    'fields' : 

    [
      'id',
      'hashString',
      'name',
      'status',
      'addedDate',
      'percentDone',
      'totalSize',
      'eta',
      'rateDownload',
      'rateUpload',
      'errorString',
      'error',
      'isFinished',
      'isPrivate',
      'isStalled',
      'peers',
      'peersConnected',
      'downloadDir'
    ],

    'ids' : [hash]
  };

  this.request('torrent-get', args, function(err, response) {

    if (err) return callback(err);

    var torrent = {};

    if (_.isUndefined(response.arguments)) { 
      return callback(null, null);
    }

    if (_.isUndefined(response.arguments.torrents)) { 
      return callback(null, null);
    }

    var torrent = response.arguments.torrents[0];

    if  (_.isEmpty(torrent)) {
      return callback(null, null);
    }

    var t = new Torrent(
          torrent.id,
          torrent.hashString,
          torrent.name,
          torrent.status,
          torrent.addedDate,
          torrent.percentDone,
          torrent.totalSize,
          torrent.eta,
          torrent.rateDownload,
          torrent.rateUpload,
          torrent.errorString,
          torrent.error,
          torrent.isFinished,
          torrent.isPrivate,
          torrent.isStalled,
          torrent.peers,
          torrent.peersConnected,
          torrent.downloadDir,
          self.host
          );

    callback(null, t);

  });

};

/**
 * Make our requests to the tServer server
 */
tServer.prototype.request = function(method, args, callback) {

  var self = this;
  
  debugRequests(method, args);

  var options = {
    'method': 'POST',
    'uri': this.rpcUrl,
    'json' : true,
    'body' : {
      'method'  : method,
      'arguments' : args
    },
    'headers' :  {
      'Time': new Date(),
      'Host': this.host + ':' + this.port,
      'X-Requested-With': 'Node-Transmission-Cluster',
      'X-Transmission-Session-Id': this.session_id || '',
      'Content-Type' : 'application/json'
    },
    'timeout': 10000
  }

  if (this.username) {
    options.headers.Authorization = auth_header = 'Basic ' + new Buffer(self.username + (self.password ? ':' + self.password : '')).toString('base64')
  }

  request(options, function(err, res, body) {

      if (err) {

        debugRequests(err);
        console.log(self.rpcUrl);
        console.log(err.code);

        //If attempting to get the lowest loaded server, skip additional retries so we can continue on and add to another from the cluster
        if (err.code == 'ECONNREFUSED' && method == 'session-stats') {
          return callback(err.code);
        } 

        self.attempts = self.attempts + 1;

        if (self.attempts > 20) {
          self.attempts = 0;
          console.log('Max Attempts reached');
          console.log(args);
          return callback('Max attempts reached.');
        }

        /**
         * ECONNREFUSED - transmission server is unavailable
         * ETIMEDOUT - for whatever reason, was unable to complete request
         * ECONNRESET
         */
        if (err.code === 'ECONNREFUSED' || err.code == 'ETIMEDOUT' || err.code == 'ECONNRESET') {
          setTimeout(function() {
            self.request(method, args, callback);
          }, 1500);
          return;
        } else {
          return callback(err);
        }

      }

      debugRequests(res.statusCode, body);

      if (res.statusCode === 409) { 
        console.log(409);
        console.log(self.host);
        self.session_id = res.headers['x-transmission-session-id'];
        return self.request(method, args, callback);
      }

      if (res.statusCode === 401) { 
        console.log('Unauthorized 401: ' + self.host);
        return callback(res.statusCode)
      }

      //Reset our max attempts if we've had successful attempts
      self.attempts = 0;
      callback(null, body);

  });

};