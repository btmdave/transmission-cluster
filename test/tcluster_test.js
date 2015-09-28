var should = require('should');
var assert = require('assert');
var uCluster = require('../');

describe('tCluster', function () {

  before(function (done) {
    tc = new tCluster([{
        host: process.env.host || 'localhost',
        port: process.env.port || 9000,
        username: process.env.username || 'admin',
        password: process.env.password || 'pass'
      },{
        host: process.env.host || 'localhost',
        port: process.env.port || 9000,
        username: process.env.username || 'admin',
        password: process.env.password || 'pass'
      }]);
    done();
  });

  it ('should add a torrent', function(done) {
    this.timeout(10000);
    tc.add('magnet:?xt=urn:btih:cb84ccc10f296df72d6c40ba7a07c178a4323a14', function(err, events) {
      if (err) {
        return done(err);
      }
      done();
    });
  });

  it ('should emit download event', function(done) {
    this.timeout(10000);
    tc.add('magnet:?xt=urn:btih:cb84ccc10f296df72d6c40ba7a07c178a4323a14', function(err, events) {
      if (err) {
        return done(err);
      }
      setTimeout(function() {
        events.on('download', function(torrent) {
          done()
        });
      }, 2000);
    });
  });

  it ('should return an error when adding an invalid url', function(done) {
    tc.add('BADURL', function(err, events) {
      if (err) {
        return done();
      }
      if (events) {
        return done(new Error('Expected erorr not returned'));
      }
    });
  });

});