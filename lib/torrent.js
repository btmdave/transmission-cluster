var moment = require('moment');
/**
 * Torrent model
 */
function Torrent(id,
  hashString,
  name,
  status,
  addedDate,
  percentDone,
  totalSize,
  eta,
  rateDownload,
  rateUpload,
  errorString,
  error,
  isFinished,
  isPrivate,
  isStalled,
  peers,
  peersConnected,
  downloadDir,
  host) {

  this.id = id;
  this.hash = hashString.toLowerCase();
  this.status = status;
  this.dateAdded = addedDate * 1000;
  this.date = moment(this.dateAdded).format();

  switch (status) {
    case 0:
      this.statusString = 'stopped';
      break;
    case 1:
      this.statusString = 'checking_wait';
      break;
    case 2:
      this.statusString = 'checking';
      break;
    case 3:
      this.statusString = 'downloading_wait';
      break;
    case 4:
      this.statusString = 'downloading';
      break;
    case 5:
      this.statusString = 'seeding_wait';
      break;
    case 6:
      this.statusString = 'seeding';
      break;
    case 7:
      this.statusString = 'isolated';
      break;
  }

  this.name = name;
  this.status = status;
  this.percent = percentDone;
  this.size = totalSize;
  this.eta = eta;
  this.downloadSpeed = rateDownload;
  this.uploadSpeed = rateUpload;
  this.errorString = errorString;
  this.error = error;
  this.isFinished = isFinished;
  this.isPrivate = isPrivate;
  this.isStalled = isStalled;

  this.peersInSwarm = peers.filter(function(peer) {
    return peer.progress !== 1;
  }).length;

  this.peersConnected = peers.filter(function(peer) {
    return peer.progress !== 1 && peer.isDownloadingFrom;
  }).length;

  this.seedsInSwarm = peers.filter(function(peer) {
    return peer.progress == 1;
  }).length;

  this.seedsConnected = peers.filter(function(peer) {
    return peer.progress == 1 && peer.isDownloadingFrom;
  }).length;

};

/**
 * Expose Torrent.
 */
module.exports = Torrent;

Torrent.prototype.isStatusError = function () { 
  return false;
};


Torrent.prototype.isStatusDownloading = function() {
  return this.status == 4;
};

Torrent.prototype.hasSeeds = function () {

  if (this.isStatusDownloading() && this.seedsConnected == 0 && this.peersConnected < 2 && !this.isPrivate && moment().diff(moment(this.dateAdded), 'minutes') > 5) {
    return false;
  }
  //Give extra time for private torrents
  if (this.isStatusDownloading() && this.seedsConnected == 0 && this.peersConnected < 2 && this.isPrivate && moment().diff(moment(this.dateAdded), 'minutes') > 10) {
    return false;
  }

  return true;

};

Torrent.prototype.isStatusCompleted = function () {
  return this.percent == 1;
};

Torrent.prototype.getPercentStr = function () {
  return (this.percent/10).toFixed(0) + '%';
};
