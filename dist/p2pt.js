'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var WebSocketTracker = require('bittorrent-tracker/lib/client/websocket-tracker');
var randombytes = require('randombytes');
var EventEmitter = require('events');
var sha1 = require('simple-sha1');
var debugFunction = require('debug');
var nanoid = require('nanoid');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var WebSocketTracker__default = /*#__PURE__*/_interopDefaultLegacy(WebSocketTracker);
var randombytes__default = /*#__PURE__*/_interopDefaultLegacy(randombytes);
var EventEmitter__default = /*#__PURE__*/_interopDefaultLegacy(EventEmitter);
var sha1__default = /*#__PURE__*/_interopDefaultLegacy(sha1);
var debugFunction__default = /*#__PURE__*/_interopDefaultLegacy(debugFunction);

const debug = debugFunction__default["default"]("p2pt");
const JSON_MESSAGE_IDENTIFIER = "^";
const MAX_MESSAGE_LENGTH = 16e3;
class P2PT extends EventEmitter__default["default"] {
  constructor(announceURLs = [], identifierString = "") {
    super();
    this.announceURLs = announceURLs;
    this.trackers = {};
    this.peers = {};
    this.msgChunks = {};
    this.responseWaiting = {};
    if (identifierString) {
      this.setIdentifier(identifierString);
    }
    this._peerIdBuffer = randombytes__default["default"](20);
    this._peerId = this._peerIdBuffer.toString("hex");
    this._peerIdBinary = this._peerIdBuffer.toString("binary");
    debug("my peer id: " + this._peerId);
  }
  setIdentifier(identifier) {
    this.identifier = identifier;
    this.infoHash = sha1__default["default"].sync(identifier).toLowerCase();
    this._infoHashBuffer = Buffer.from(this.infoHash, "hex");
    this._infoHashBinary = this._infoHashBuffer.toString("binary");
  }
  start() {
    this.on("peer", (peer) => {
      const newPeer = !this.peers[peer.id];
      if (newPeer) {
        this.peers[peer.id] = {};
        this.responseWaiting[peer.id] = {};
      }
      peer.on("connect", () => {
        this.peers[peer.id][peer.channelName] = peer;
        if (newPeer) {
          this.emit("peerconnect", peer);
        }
      });
      peer.on("data", (data) => {
        this.emit("data", peer, data);
        data = data.toString();
        debug("got a message from " + peer.id);
        if (data[0] === JSON_MESSAGE_IDENTIFIER) {
          try {
            data = JSON.parse(data.slice(1));
            let msg = this._chunkHandler(data);
            if (msg !== false) {
              if (data.o) {
                msg = JSON.parse(msg);
              }
              if (this.responseWaiting[peer.id][data.id]) {
                this.responseWaiting[peer.id][data.id]([
                  peer,
                  msg
                ]);
                delete this.responseWaiting[peer.id][data.id];
              } else {
                this.emit("msg", peer, msg);
              }
              this._destroyChunks(data.id);
            }
          } catch (e) {
            console.log(e);
          }
        }
      });
      peer.on("error", (err) => {
        this._removePeer(peer);
        debug("Error in connection : " + err);
      });
      peer.on("close", () => {
        this._removePeer(peer);
        debug("Connection closed with " + peer.id);
      });
    });
    this.on("update", (response) => {
      const tracker = this.trackers[this.announceURLs.indexOf(response.announce)];
      this.emit("trackerconnect", tracker, this.getTrackerStats());
    });
    this.on("warning", (err) => {
      this.emit("trackerwarning", err, this.getTrackerStats());
    });
    this._fetchPeers();
  }
  addTracker(announceURL) {
    if (this.announceURLs.indexOf(announceURL) !== -1) {
      throw new Error("Tracker already added");
    }
    const key = this.announceURLs.push(announceURL);
    this.trackers[key] = new WebSocketTracker__default["default"](this, announceURL);
    this.trackers[key].announce(this._defaultAnnounceOpts());
  }
  removeTracker(announceURL) {
    const key = this.announceURLs.indexOf(announceURL);
    if (key === -1) {
      throw new Error("Tracker does not exist");
    }
    this.trackers[key].peers = [];
    this.trackers[key].destroy();
    delete this.trackers[key];
    delete this.announceURLs[key];
  }
  _removePeer(peer) {
    if (!this.peers[peer.id]) {
      return false;
    }
    delete this.peers[peer.id][peer.channelName];
    if (Object.keys(this.peers[peer.id]).length === 0) {
      this.emit("peerclose", peer);
      delete this.responseWaiting[peer.id];
      delete this.peers[peer.id];
    }
    return true;
  }
  send(peer, msg, msgID = "") {
    return new Promise((resolve, reject) => {
      let data = {
        id: msgID !== "" ? msgID : nanoid.nanoid(),
        msg: typeof msg === "object" ? JSON.stringify(msg) : msg,
        o: typeof msg === "object"
      };
      try {
        if (!peer.connected) {
          for (const index in this.peers[peer.id]) {
            peer = this.peers[peer.id][index];
            if (peer.connected)
              break;
          }
        }
        if (!this.responseWaiting[peer.id]) {
          this.responseWaiting[peer.id] = {};
        }
        this.responseWaiting[peer.id][data.id] = resolve;
      } catch (e) {
        return reject(Error("Connection to peer closed" + e));
      }
      let chunks = 0;
      let remaining = "";
      while (data.msg.length > 0) {
        data.c = chunks;
        remaining = data.msg.slice(MAX_MESSAGE_LENGTH);
        data.msg = data.msg.slice(0, MAX_MESSAGE_LENGTH);
        if (!remaining) {
          data.last = true;
        }
        peer.send(JSON_MESSAGE_IDENTIFIER + JSON.stringify(data));
        data.msg = remaining;
        chunks++;
      }
      debug("sent a message to " + peer.id);
    });
  }
  requestMorePeers() {
    return new Promise((resolve) => {
      for (const key in this.trackers) {
        this.trackers[key].announce(this._defaultAnnounceOpts());
      }
      resolve(this.peers);
    });
  }
  getTrackerStats() {
    let connectedCount = 0;
    for (const key in this.trackers) {
      if (this.trackers[key].socket && this.trackers[key].socket.connected) {
        connectedCount++;
      }
    }
    return {
      connected: connectedCount,
      total: this.announceURLs.length
    };
  }
  destroy() {
    let key;
    for (key in this.peers) {
      for (const key2 in this.peers[key]) {
        this.peers[key][key2].destroy();
      }
    }
    for (key in this.trackers) {
      this.trackers[key].destroy();
    }
  }
  _peerRespond(peer, msgID) {
    return (msg) => {
      return this.send(peer, msg, msgID);
    };
  }
  _chunkHandler(data) {
    if (!this.msgChunks[data.id]) {
      this.msgChunks[data.id] = [];
    }
    this.msgChunks[data.id][data.c] = data.msg;
    if (data.last) {
      const completeMsg = this.msgChunks[data.id].join("");
      return completeMsg;
    } else {
      return false;
    }
  }
  _destroyChunks(msgID) {
    delete this.msgChunks[msgID];
  }
  _defaultAnnounceOpts(opts) {
    var _a, _b, _c;
    return {
      numwant: (_a = opts == null ? void 0 : opts.numwant) != null ? _a : 50,
      uploaded: (_b = opts == null ? void 0 : opts.uploaded) != null ? _b : 0,
      downloaded: (_c = opts == null ? void 0 : opts.downloaded) != null ? _c : 0
    };
  }
  _fetchPeers() {
    for (const key in this.announceURLs) {
      this.trackers[key] = new WebSocketTracker__default["default"](this, this.announceURLs[key]);
      this.trackers[key].announce(this._defaultAnnounceOpts());
    }
  }
}

exports.P2PT = P2PT;
//# sourceMappingURL=p2pt.js.map
