import { P2PT as BrowserP2PT } from "./p2pt";
// @ts-ignore
import wrtc from "wrtc";

export class P2PT extends BrowserP2PT {
    _wrtc: any;
    /**
     *
     * @param array announceURLs List of announce tracker URLs
     * @param string identifierString Identifier used to discover peers in the network
     */
    constructor(announceURLs = [], identifierString = "") {
        super(announceURLs, identifierString);

        this._wrtc = wrtc;
    }
}
