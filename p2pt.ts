/**
 * Peer 2 Peer WebRTC connections with WebTorrent Trackers as signalling server
 * Copyright Subin Siby <mail@subinsb.com>, 2020
 * Licensed under MIT
 */

// @ts-ignore
import WebSocketTracker from "bittorrent-tracker/lib/client/websocket-tracker";
import randombytes from "randombytes";
import EventEmitter from "events";
import sha1 from "simple-sha1";
import debugFunction from "debug";
import SimplePeer from "simple-peer";
import { nanoid } from "nanoid";

const debug = debugFunction("p2pt");

/**
 * This character would be prepended to easily identify JSON msgs
 */
const JSON_MESSAGE_IDENTIFIER = "^";

/**
 * WebRTC data channel limit beyond which data is split into chunks
 * Chose 16KB considering Chromium
 * https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels#Concerns_with_large_messages
 */
const MAX_MESSAGE_LENGTH = 16000;

type RespondFunction = (msg: any) => Promise<[peer: Peer, msg: string]>;

interface AnnounceOpts {
    numwant: number | null;
    uploaded: number | null;
    downloaded: number | null;
}

interface DataMessage {
    id: string;
    msg: string;
    o: boolean;
    c?: number;
    last?: boolean;
}

/**
 * Websocket tracker is adding id to the SimplePeer object
 */
interface Peer extends SimplePeer.Instance {
    id: string;
    channelName: string;
    respond: RespondFunction;
}

export class P2PT extends EventEmitter {
    announceURLs: string[];
    trackers: { [key: string]: any };
    peers: { [peerId: string]: { [channel: string]: Peer } };
    msgChunks: { [key: string]: any };
    responseWaiting: {
        [peerId: string]: {
            [msgId: string]: (data: [peer: Peer, msg: string]) => void;
        };
    };
    _peerIdBuffer: Buffer;
    _peerId: string;
    _peerIdBinary: string;
    identifier?: string;
    infoHash?: string;
    _infoHashBuffer?: Buffer;
    _infoHashBinary?: string;
    _wrtc?: any;

    /**
     *
     * @param array announceURLs List of announce tracker URLs
     * @param string identifierString Identifier used to discover peers in the network
     */
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

        this._peerIdBuffer = randombytes(20);
        this._peerId = this._peerIdBuffer.toString("hex");
        this._peerIdBinary = this._peerIdBuffer.toString("binary");

        debug("my peer id: " + this._peerId);
    }

    /**
     * Set the identifier string used to discover peers in the network
     * @param string identifierString
     */
    setIdentifier(identifier: string) {
        this.identifier = identifier;
        this.infoHash = sha1.sync(identifier).toLowerCase();
        this._infoHashBuffer = Buffer.from(this.infoHash, "hex");
        this._infoHashBinary = this._infoHashBuffer.toString("binary");
    }

    /**
     * Connect to network and start discovering peers
     */
    start() {
        this.on("peer", (peer: Peer) => {
            const newPeer = !this.peers[peer.id];

            if (newPeer) {
                this.peers[peer.id] = {};
                this.responseWaiting[peer.id] = {};
            }

            peer.on("connect", () => {
                /**
                 * Multiple data channels to one peer is possible
                 * The `peer` object actually refers to a peer with a data channel. Even though it may have same `id` (peerID) property, the data channel will be different. Different trackers giving the same "peer" will give the `peer` object with different channels.
                 * We will store all channels as backups in case any one of them fails
                 * A peer is removed if all data channels become unavailable
                 */
                this.peers[peer.id][peer.channelName] = peer;

                if (newPeer) {
                    this.emit("peerconnect", peer);
                }
            });

            peer.on("data", (data: any) => {
                this.emit("data", peer, data);

                data = data.toString();

                debug("got a message from " + peer.id);

                if (data[0] === JSON_MESSAGE_IDENTIFIER) {
                    try {
                        data = JSON.parse(data.slice(1));

                        // A respond function
                        // peer.respond = this._peerRespond(peer, data.id);

                        let msg = this._chunkHandler(data);

                        // msg fully retrieved
                        if (msg !== false) {
                            if (data.o) {
                                msg = JSON.parse(msg);
                            }

                            /**
                             * If there's someone waiting for a response, call them
                             */
                            if (this.responseWaiting[peer.id][data.id]) {
                                this.responseWaiting[peer.id][data.id]([
                                    peer,
                                    msg,
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

            peer.on("error", (err: Error) => {
                this._removePeer(peer);
                debug("Error in connection : " + err);
            });

            peer.on("close", () => {
                this._removePeer(peer);
                debug("Connection closed with " + peer.id);
            });
        });

        // Tracker responded to the announce request
        this.on("update", (response) => {
            const tracker =
                this.trackers[this.announceURLs.indexOf(response.announce)];

            this.emit("trackerconnect", tracker, this.getTrackerStats());
        });

        // Errors in tracker connection
        this.on("warning", (err) => {
            this.emit("trackerwarning", err, this.getTrackerStats());
        });

        this._fetchPeers();
    }

    /**
     * Add a tracker
     * @param string announceURL Tracker Announce URL
     */
    addTracker(announceURL: string) {
        if (this.announceURLs.indexOf(announceURL) !== -1) {
            throw new Error("Tracker already added");
        }

        const key = this.announceURLs.push(announceURL);

        this.trackers[key] = new WebSocketTracker(this, announceURL);
        this.trackers[key].announce(this._defaultAnnounceOpts());
    }

    /**
     * Remove a tracker without destroying peers
     */
    removeTracker(announceURL: string) {
        const key = this.announceURLs.indexOf(announceURL);

        if (key === -1) {
            throw new Error("Tracker does not exist");
        }

        // hack to not destroy peers
        this.trackers[key].peers = [];
        this.trackers[key].destroy();

        delete this.trackers[key];
        delete this.announceURLs[key];
    }

    /**
     * Remove a peer from the list if all channels are closed
     * @param integer id Peer ID
     */
    _removePeer(peer: Peer) {
        if (!this.peers[peer.id]) {
            return false;
        }

        delete this.peers[peer.id][peer.channelName];

        // All data channels are gone. Peer lost
        if (Object.keys(this.peers[peer.id]).length === 0) {
            this.emit("peerclose", peer);

            delete this.responseWaiting[peer.id];
            delete this.peers[peer.id];
        }

        return true;
    }

    /**
     * Send a msg and get response for it
     * @param Peer peer simple-peer object to send msg to
     * @param string msg Message to send
     * @param integer msgID ID of message if it's a response to a previous message
     */
    send(peer: Peer, msg: string | object, msgID = "") {
        return new Promise<[peer: Peer, msg: string]>((resolve, reject) => {
            let data: DataMessage = {
                id: msgID !== "" ? msgID : nanoid(),
                msg: typeof msg === "object" ? JSON.stringify(msg) : msg,
                o: typeof msg === "object",
            };

            try {
                /**
                 * Maybe peer channel is closed, so use a different channel if available
                 * Array should atleast have one channel, otherwise peer connection is closed
                 */
                if (!peer.connected) {
                    for (const index in this.peers[peer.id]) {
                        peer = this.peers[peer.id][index];

                        if (peer.connected) break;
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

    /**
     * Request more peers
     */
    requestMorePeers() {
        return new Promise((resolve) => {
            for (const key in this.trackers) {
                this.trackers[key].announce(this._defaultAnnounceOpts());
            }
            resolve(this.peers);
        });
    }

    /**
     * Get basic stats about tracker connections
     */
    getTrackerStats() {
        let connectedCount = 0;
        for (const key in this.trackers) {
            if (
                this.trackers[key].socket &&
                this.trackers[key].socket.connected
            ) {
                connectedCount++;
            }
        }

        return {
            connected: connectedCount,
            total: this.announceURLs.length,
        };
    }

    /**
     * Destroy object
     */
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

    /**
     * A custom function binded on Peer object to easily respond back to message
     * @param Peer peer Peer to send msg to
     * @param integer msgID Message ID
     */
    _peerRespond(peer: Peer, msgID: string) {
        return (msg: string) => {
            return this.send(peer, msg, msgID);
        };
    }

    /**
     * Handle msg chunks. Returns false until the last chunk is received. Finally returns the entire msg
     * @param object data
     */
    _chunkHandler(data: any) {
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

    /**
     * Remove all stored chunks of a particular message
     * @param integer msgID Message ID
     */
    _destroyChunks(msgID: string) {
        delete this.msgChunks[msgID];
    }

    /**
     * Default announce options
     * @param object opts Options
     */
    _defaultAnnounceOpts(opts?: Partial<AnnounceOpts>): AnnounceOpts {
        return {
            numwant: opts?.numwant ?? 50,
            uploaded: opts?.uploaded ?? 0,
            downloaded: opts?.downloaded ?? 0,
        };
    }

    /**
     * Initialize trackers and fetch peers
     */
    _fetchPeers() {
        for (const key in this.announceURLs) {
            this.trackers[key] = new WebSocketTracker(
                this,
                this.announceURLs[key]
            );
            this.trackers[key].announce(this._defaultAnnounceOpts());
        }
    }
}
