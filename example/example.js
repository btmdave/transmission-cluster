var tCluster = require('../');

var servers = [{
  host: '',
  port: 9091,
  download_dir: '/'
},
{
  host: '',
  port: 9091,
  username: '',
  password: '',
  download_dir: '/'
}]

var tc = new tCluster(servers);

tc.add('', function(err, events) {

  if (err) {
    console.log(err);
    return;
  }

  events.on('download', function(torrent) {
    console.log('download', torrent);
  });

  events.on('error', function(error) {
    console.log('error', error);
  });

  events.on('complete', function(torrent) {
    console.log('complete');
    uc.remove(torrent.hash, function(err, res) {

    });
  });

  events.on('noseeds', function(torrent) {
    console.log('noseeds', torrent);
    uc.remove(torrent.hash, function(err, res) {

    });
  });

  events.on('timeout', function(message) {
    console.log('timeout', message);
  });

});
