var EventEmitter = require('events').EventEmitter;
var util = require('util');

/**
 * Expose Events.
 */
module.exports = tEvents;

function tEvents(hash, redis) {

  this.hash = hash;
  this.redis = redis;
  
  this.on('error', function(err) {
    if (err.code == 'ECONNREFUSED') {
      redis.del(hash);
      console.error('events', err);
    }
  });

  this.on('sendPoll', function(hash) {
    this.emit('poll', hash);
  });

  this.on('sendDownload', function(torrent) {
    this.emit('download', torrent);
  });

  this.on('sendComplete', function(torrent) {
    this.emit('complete', torrent);
  });

  this.on('sendNoSeeds', function(torrent) {
    this.emit('noseeds', torrent);
  });

  this.on('sendError', function(error) {
    this.emit('error', error);
  });

  this.on('sendTimeout', function(message) {
    this.emit('timeout', message);
  });

};

/**
 * Inherit from 'EventEmitter.prototype'.
 */
util.inherits(tEvents, EventEmitter);
