declare module 'P2PT';

type Data = {
  id: string
  c: string | number
  o: any
  msg: any
  last: any
}

type Opts = {
  numwant: number
  uploaded: number
  downloaded: number
}

type Peer = {
  connected: any
  id: string
  channelName: any
  respond: any
  send: (arg0: string) => void
  on: Function
}