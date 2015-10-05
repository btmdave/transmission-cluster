var request = require('request');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var _ = require('lodash');
var tServer = require('./tserver');
var parseTorrent = require('parse-torrent');
var async = require('async');
var Redis = require('ioredis');
var debug = require('debug')('tCluster');

/**
 * Expose tCluster.
 */
module.exports = tCluster;

function tCluster(servers, redis) {

  this.servers = [];
  if (!_.isUndefined(redis)) { 
    this.redis = redis;
  } else {
    this.redis = new Redis({ keyPrefix: 'utcluster:' });
  }

  var self = this;

  servers.forEach(function(server) {
    server.download_dir = _.isUndefined(server.download_dir) ? '/' : server.download_dir
    var t = new tServer({
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password,
      download_dir: server.download_dir
    }, self.redis);
    self.servers.push(t)
  })

  return this;

};

/**
 * Inherit from 'EventEmitter.prototype'.
 */

util.inherits(tCluster, EventEmitter);

/**
 * Find the server associated to a specific hash
 */
tCluster.prototype.getServerByHash = function(hash, callback) {

  debug('tCluster.getServerByHash:' + hash);

  var self = this;
  //Get the server associated to the supplied hash
  this.redis.get(hash, function(err, res) {
    try { 
      var server = self.servers.filter(function(server) {
        return server.host == JSON.parse(res);
      });

      if (_.isEmpty(server)) {
         return callback(null, null);
      }

      if (server.length > 1) {
        callback(null, server[0]);
      } else {
        callback(null, server);
      }

    } catch (e) {
      callback(e);
    }
  });

};

/**
 * Search all servers and find the first with the associated hash
 */
tCluster.prototype.searchServersByHash = function(hash, callback) {

  debug('tCluster.searchServersByHash:' + hash);

  var self = this;

  var uServer = null;
  //Search all servers for the supplied hash and return if found.
  async.each(this.servers, function(server, cb) {
    server.get(hash, function(err, res) {
      if (!_.isEmpty(res)) {
        self.redis.multi().set(hash, JSON.stringify({host: server.host})).expire(hash, 300).exec(function(error) {
          if (error) console.log(err);
          uServer = server;
          cb(200);
        });
      } else {
        cb();
      }
    })
  }, function(err) {
      if (err) {
        if (err === 200) {
          callback(null, uServer);
        } else {
          callback(err, null);
        }
      } else {
        callback(null, null);
      }
  });

};



/**
 * Get the lowest loaded server, new torrents are always added to the server with lowest load
 */
tCluster.prototype.getLowestLoaded = function(callback) {

  debug('tCluster.getLowestLoaded');

  var serverCounts = [];
  async.each(this.servers, function(server, cb) {
    server.getCount(function(err, count) {
      if (!err) {
        serverCounts.push({
          server: server,
          count: count
        });
      }
      cb();
    })
  }, function(err) {

      if (err) {
        return callback(err);
      }

      if (_.isEmpty(serverCounts)) {
        return callback('No servers were found when attempting to get counts.');
      }
    
      var ut = _.sortBy(serverCounts, 'count')[0].server;
      callback(null, ut);
  });

};

/**
 * Add new torrent to the lowest loaded server
 */
tCluster.prototype.add = function(torrent_url, callback) {  

  debug('tCluster.add: ' + torrent_url);

  var self = this;
  var hash = null;

  parseTorrent.remote(torrent_url, function (err, parsedTorrent) {

    if (err) {
      //Handle urls with hashes that failed to get parsed (can happen with torcache)
      var match = torrent_url.match(/([A-F\d]{32,40})\b/i);
      if (match) {
        torrent_url = 'magnet:?xt=urn:btih:' + match[0];
        hash = match[0];
      } else {
        return callback(err);
      }
    }

    if (!hash) {

      hash = parsedTorrent.infoHash;
      
      //We force use magnets as some torrent urls (torcache), while valid, don't act consistent with transmission
      if (/\b(http:|https:)/.test(torrent_url)) {
        torrent_url = 'magnet:?xt=urn:btih:' + hash;
      }
      
    }

    self.getServer(hash, function(err, server) {

      console.log(server);

      if (server) {
        return server.resume(hash, callback);
      }
      
      self.getLowestLoaded(function(err, server) {
         if (err) {
           return callback(err);
         }
         if (!server) {
           return callback(null, null);
         }

         server.add(torrent_url, hash, function(err, uEvent, torrent) {
            
           if (err) {
             return callback(err); 
           }
          
           self.redis.multi().set(uEvent.hash, JSON.stringify({host: server.host})).expire(uEvent.hash, 300).exec(function(error, res) {
            if (error) console.log(error);
            callback(err, uEvent, torrent);
           });
           
         });

      });
      
    });

  });

  return this;

};


tCluster.prototype.remove = function(hash, callback) {
  
  var self = this;

  this.getServer(hash, function(err, server) {

    if (err) {
      return callback(err);
    }

    if (!server) {
      return callback(null, null);
    }

    self.redis.del(hash);
    server.remove(hash, callback);

  });

}

tCluster.prototype.removeData = function(hash, callback) {
  
  var self = this;

  this.getServer(hash, function(err, server) {

    if (err) {
      return callback(err);
    }

    if (!server) {
      return callback(null, null);
    }

    self.redis.del(hash);
    server.removeData(hash, callback);

  });

}

tCluster.prototype.getServer = function(hash, callback) {

  var self = this;

  async.waterfall([
    function(cb) {
      self.getServerByHash(hash, cb);
    },
    function(server, cb) {
      if (server) {
        return cb(null, server);
      }
      self.searchServersByHash(hash, cb);
    }
  ], callback);

};


/**
 * Find in cluster and get the torrent object for the associated hash
 */
tCluster.prototype.get = function(hash, callback) { 

  this.getServer(hash, function(err, server) {

    if (err) {
      return callback(err);
    }

    if (!server) {
      return callback(null, null);
    }

    server.get(hash, function(err, response) {
      if (err || _.isEmpty(response)) {
        self.redis.del(hash);
      }
      
      response = _.isEmpty(response) ? null : response;

      callback(err, response);

    });

  });

}