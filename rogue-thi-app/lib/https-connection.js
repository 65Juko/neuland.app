import * as forge from 'node-forge/lib/index.all'

const DEFAULT_TIMEOUT = 10000

function ab2str (buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf))
}

function str2ab (str) {
  const buf = new ArrayBuffer(str.length)
  const bufView = new Uint8Array(buf)
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i)
  }
  return buf
}

export default class HttpsConnection {
  constructor (options) {
    console.info('Creating new connection')

    this.options = options
    this.requests = []

    this.webSocket = new WebSocket(options.proxy)
    this.webSocket.binaryType = 'arraybuffer'
    this.webSocket.addEventListener('open', () => this.tlsConnection.handshake())
    this.webSocket.addEventListener('close', () => this.close())
    this.webSocket.addEventListener('message', event => this.tlsConnection.process(ab2str(event.data)))
    this.webSocket.addEventListener('error', event => options.error(new Error('WebSocket connection failed: ' + event)))

    this.tlsConnection = forge.tls.createConnection({
      server: false,
      caStore: options.certs,
      virtualHost: options.host,
      verify: (connection, verified, depth, certs) => this._onVerify(verified, depth, certs),
      connected: connection => this._onConnected(),
      tlsDataReady: connection => this._onTlsDataReady(),
      dataReady: connection => this._onDataReady(),
      closed: () => this.close(),
      error: (connection, error) => this.options.error(error)
    })

    this._restartTimeout()
  }

  send (request) {
    this.requests.push(request)

    if (!this.isConnected) {
      console.info('Not connected yet, delaying')
      return
    }

    if (this.requests.length > 1) {
      console.info('There is a running request, delaying')
      return
    }

    console.info('This is the first request, starting immediately')
    this._sendNextRequest()
  }

  close () {
    this.tlsConnection.close()
    this.webSocket.close()
    this.options.closed()
  }

  _restartTimeout () {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    this.timeout = setTimeout(() => this._onTimeout(), this.options.timeout || DEFAULT_TIMEOUT)
  }

  _sendNextRequest () {
    if (this.requests.length > 0) {
      const request = this.requests[0]
      this.tlsConnection.prepare(request.getData())
    }
  }

  _onVerify (verified, depth, certs) {
    if (certs[0].subject.getField('CN').value === this.options.host) {
      return verified
    } else {
      return false
    }
  }

  _onConnected () {
    this.isConnected = true
    this._sendNextRequest()
  }

  _onTlsDataReady () {
    const data = this.tlsConnection.tlsData.getBytes()
    this.webSocket.send(str2ab(data))

    this._restartTimeout()
  }

  _onDataReady () {
    const data = this.tlsConnection.data.getBytes()
    const request = this.requests[0]

    if (request.processData(data)) {
      this.requests.shift()
      this._sendNextRequest()
    }

    this._restartTimeout()
  }

  _onTimeout () {
    console.info('Connection timed out')

    this.timeout = null
    this.close()
  }
}
