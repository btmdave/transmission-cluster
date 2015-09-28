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
    this.attempts = {};
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
      console.log(response.arguments);
      callback(null, response.arguments.torrentCount);
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
  var args = [hash]
  this.request('torrent-remove', args, callback);
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
  thisEvent.on('cancel', function() {
     clearTimeout(self.timer);
   self.timer = false;
   self.remove(thisEvent.hash, function(err, res) {
       //Don't care about callback, but we'll remove it clean up tServer if it's been cancelled
   });   
  });

  var pollInterval = function() {

  thisEvent.emit('sendPoll', thisEvent.hash);
    
    self.get(thisEvent.hash, function(err, torrent) {

      if (err) {
        return thisEvent.emit('sendError', err);
      }

      if (torrent) {
        
        self.pollDate = moment().unix() * 1000;  
        
        if (torrent.isStatusCompleted()) {
            return thisEvent.emit('sendComplete', torrent);
        } else if (torrent.isStatusError()) {
            return thisEvent.emit('sendError', torrent);
        } else if (!torrent.hasSeeds()) {
            return thisEvent.emit('sendNoSeeds', torrent);
        } else {
            thisEvent.emit('sendDownload', torrent);
        }
      } else {
        //If a magnet link is invalid or for whatever other reason we don't get our torrent
        //and it's been 90 seconds
        var delay = moment().diff(moment(self.pollDate), 'seconds')
        if (delay > 90) {
          return thisEvent.emit('sendTimeout', {'host': self.host, 'hash': thisEvent.hash}); 
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


      var callString = new Buffer(JSON.stringify(options)).toString("base64");
      self.attempts[callString] = _.isUndefined(self.attempts[callString]) ? 1 : self.attempts[callString];

      if (err) {

        debugRequests(err);
        console.log(err);

        //If attempting to get the lowest loaded server, skip additional logic so we can continue on and add to another in the cluster
        if (err.code == 'ECONNREFUSED' && method == 'session-stats') {
          return callback(err.code);
        } 

        self.attempts[callString] = self.attempts[callString] + 1;

        if (self.attempts[callString] > 60) {
          self.attempts[callString] = 0;
          return callback('Max attempts reached.');
        }

        /**
         * ECONNREFUSED - transmission server is unavailable
         * ETIMEDOUT - for whatever reason, was unable to complete request
         * ECONNRESET - TBD
         */
        if (err.code === 'ECONNREFUSED' || err.code == 'ETIMEDOUT' || err.code == 'ECONNRESET') {
          setTimeout(function() {
            self.request(method, args, callback);
          }, 1000);
          return;
        } else {
          return callback(err);
        }

      }

      debugRequests(res.statusCode, body);

      if (res.statusCode === 409) { 
        self.session_id = res.headers['x-transmission-session-id'];
        return self.request(method, args, callback);
      }

      if (res.statusCode === 401) { 
        console.log('Unauthorized 401: ' + self.host);
        return callback(res.statusCode)
      }

      //Reset our max attempts if we've had successful attempts
      self.attempts[callString] = 0;
      callback(null, body);

  });

};