import EventEmitter from 'events';
import SimplePeer from 'simple-peer';

/**
 * Peer 2 Peer WebRTC connections with WebTorrent Trackers as signalling server
 * Copyright Subin Siby <mail@subinsb.com>, 2020
 * Licensed under MIT
 */

declare type RespondFunction = (msg: any) => Promise<[peer: Peer, msg: string]>;
interface AnnounceOpts {
    numwant: number | null;
    uploaded: number | null;
    downloaded: number | null;
}
/**
 * Websocket tracker is adding id to the SimplePeer object
 */
interface Peer extends SimplePeer.Instance {
    id: string;
    channelName: string;
    respond: RespondFunction;
}
declare class P2PT extends EventEmitter {
    announceURLs: string[];
    trackers: {
        [key: string]: any;
    };
    peers: {
        [peerId: string]: {
            [channel: string]: Peer;
        };
    };
    msgChunks: {
        [key: string]: any;
    };
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
    constructor(announceURLs?: never[], identifierString?: string);
    /**
     * Set the identifier string used to discover peers in the network
     * @param string identifierString
     */
    setIdentifier(identifier: string): void;
    /**
     * Connect to network and start discovering peers
     */
    start(): void;
    /**
     * Add a tracker
     * @param string announceURL Tracker Announce URL
     */
    addTracker(announceURL: string): void;
    /**
     * Remove a tracker without destroying peers
     */
    removeTracker(announceURL: string): void;
    /**
     * Remove a peer from the list if all channels are closed
     * @param integer id Peer ID
     */
    _removePeer(peer: Peer): boolean;
    /**
     * Send a msg and get response for it
     * @param Peer peer simple-peer object to send msg to
     * @param string msg Message to send
     * @param integer msgID ID of message if it's a response to a previous message
     */
    send(peer: Peer, msg: string | object, msgID?: string): Promise<[peer: Peer, msg: string]>;
    /**
     * Request more peers
     */
    requestMorePeers(): Promise<unknown>;
    /**
     * Get basic stats about tracker connections
     */
    getTrackerStats(): {
        connected: number;
        total: number;
    };
    /**
     * Destroy object
     */
    destroy(): void;
    /**
     * A custom function binded on Peer object to easily respond back to message
     * @param Peer peer Peer to send msg to
     * @param integer msgID Message ID
     */
    _peerRespond(peer: Peer, msgID: string): (msg: string) => Promise<[peer: Peer, msg: string]>;
    /**
     * Handle msg chunks. Returns false until the last chunk is received. Finally returns the entire msg
     * @param object data
     */
    _chunkHandler(data: any): any;
    /**
     * Remove all stored chunks of a particular message
     * @param integer msgID Message ID
     */
    _destroyChunks(msgID: string): void;
    /**
     * Default announce options
     * @param object opts Options
     */
    _defaultAnnounceOpts(opts?: Partial<AnnounceOpts>): AnnounceOpts;
    /**
     * Initialize trackers and fetch peers
     */
    _fetchPeers(): void;
}

export { P2PT };
