const MyLittleVisio = (function() {

class Deferred {
    constructor() {
	this.promise = new Promise((resolve, reject) => {
	    this.resolve = resolve;
	    this.reject = reject;
	});
    }
}

class Message {
    constructor(id, type, params, body) {
        this.id = id || 'unknown';
        this.type = type || 'unknown';
        this.params = params || [];
        this.body = body || '';
    }

    static deserialize(str) {
        const lines = str.split('\n');
        const header = lines.shift();
        const body = lines.join('\n');

        const params = header.split(' ');
        const id = params.shift();
        const type = params.shift();

        return new Message(id, type, params, body);
    }

    serialize() {
        const header = [this.id, this.type].concat(this.params).join(' ');
        return header + '\n' + (this.body || '');
    }
}

class Signaling {
    constructor(cb) {
        this.callbacks = {};
        this.defaultCallback = cb;
        this.queue = [];
        this.timeout = 1000;
    }

    connect(url) {
        const ws = new WebSocket(url);
        ws.onopen = this.onOpen;
        ws.onclose = this.onClose;
        ws.onmessage = this.onMessage;
        ws.onerror = () => console.error('Signaling error');
        this.ws = ws;
        this.url = url;
    }

    disconnect() {
        if(this.ws) this.ws.close();
        this.ws = undefined;
        this.url = undefined;
    }

    send(message) {
        const data = message.serialize();
        if(this.ws) this.ws.send(data)
        else this.queue.push(data);
    }

    recv(id, cb) {
        this.callbacks[id] = cb;
    }

    onOpen = () => {
        console.log('Signaling open');
        for(const data of this.queue)
            this.ws.send(data);

        this.queue = [];
        this.timeout = 1000;
    }

    onClose = () => {
        console.log('Signaling closed');
        setTimeout(this.onRetry, this.timeout * Math.random());
        this.timeout*= 2;
        this.ws = undefined;
    }

    onRetry = () => {
        this.connect(this.url);
    }

    onMessage = (ev) => {
        if(typeof(ev.data) == 'string') {
            const message = Message.deserialize(ev.data);
            if(message.type == 'leave') {
                this.defaultCallback(message);
            } else {
                const cb = this.callbacks[message.id] || this.defaultCallback;
                cb(message);
            }
        }
    }
}

class Connection {
    constructor(id, config, sig, polite) {
        sig.recv(id, this.onSignaling);
        this.id = id;
        this.sig = sig;
        this.polite = polite;

        const pc = new RTCPeerConnection(config);
        pc.onnegotiationneeded = this.onNegotiationNeeded;
        pc.onicecandidate = this.onCandidate;
        pc.oniceconnectionstatechange = this.onStateChange;
        pc.ontrack = this.onTrack;
        this.pc = pc;

        self.isMakingOffer = false;
        self.isIgnoringOffer = false;
        self.isSettingRemoteAnswer = false;

        this._defferedStream = new Deferred();
    }

    close() {
        this.pc.close();
    }

    remoteStream() {
        return this._defferedStream.promise;
    }

    setLocalStream(stream) {
        for(const track of stream.getTracks())
            this.pc.addTrack(track, stream);
    }

    signalLocalDescription() {
        const { type, sdp } = this.pc.localDescription;
        this.sig.send(new Message(this.id, 'description', [type], sdp));
    }

    signalLocalCandidate({ sdpMid, candidate }) {
        this.sig.send(new Message(this.id, 'candidate', [sdpMid], candidate));
    }

    async makeOffer() {
        try {
            this.isMakingOffer = true;
            const offer = await this.pc.createOffer();
            if (this.pc.signalingState != 'stable')
                return;

            await this.pc.setLocalDescription(offer);
            this.signalLocalDescription();

        } catch(err) {
            console.error(`Failed to send offer: ${err}`);
        } finally {
            this.isMakingOffer = false;
        }
    }

    onSignaling = async (message) => {
        switch(message.type) {
            case 'description':
                const [type] = message.params;

                const readyForOffer =
                    !this.makingOffer &&
                    (this.pc.signalingState == "stable" || this.isSettingRemoteAnswer);

                const offerCollision = type == "offer" && !readyForOffer;

                this.isIgnoringOffer = !this.polite && offerCollision;
                if (this.isIgnoreOffer)
                    return;

                this.isSettingRemoteAnswer = type == "answer";
                try {
                    await this.pc.setRemoteDescription({ type, sdp: message.body });
                } finally {
                    this.isSettingRemoteAnswer = false;
                }
                if (type == 'offer') {
                    await this.pc.setLocalDescription(await this.pc.createAnswer());
                    this.signalLocalDescription();
                }
                break;

            case 'candidate':
                const [sdpMid] = message.params;

                try {
                    await this.pc.addIceCandidate({ sdpMid, candidate: message.body });
                } catch(err) {
                    if(!this.isIgnoringOffer)
                        throw err;
                }
                break;

            default:
                console.error(`Unexpected signaling message of type \"${message.type}\"`);
                break;
        }
    }

    onNegotiationNeeded = () => {
        this.makeOffer();
    }

    onCandidate = (ev) => {
        if(ev.candidate)
            this.signalLocalCandidate(ev.candidate);
    }

    onStateChange = async () => {
        console.log(`State change: ${this.pc.iceConnectionState}`);
        if (this.pc.iceConnectionState === "failed") {
            if (this.pc.restartIce) {
                this.pc.restartIce();
            } else {
                this.makeOffer();
            }
        }
    }

    onTrack = (ev) => {
        this.stream = this.stream || (ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream());
        this.stream.addTrack(ev.track);
        this._defferedStream.resolve(this.stream);
    }
}

class Session {
    constructor(config) {
        this.config = config || {};
        this.conns = {};
        this.sig = new Signaling(this.onSignaling);
        this._defferedId = new Deferred();

        this.onpeerjoin = () => {};
        this.onpeerleave = () => {};
        this.onremotestream = () => {};
    }

    localId() {
        return this._defferedId.promise;
    }

    localStream() {
        const constraints = {
            audio: true,
            video: {
                facingMode: 'user',
                width: { min: 640, ideal: 1280, max: 1920 },
                height: { min: 360, ideal: 720, max: 1080 },
            },
        };
        return this._cachedUserMedia ||
            (this._cachedUserMedia = navigator.mediaDevices.getUserMedia(constraints));
    }

    remoteStream(id) {
        this.connection(id).remoteStream();
    }

    connection(id) {
        return this.conns[id] || this.connect(id);
    }

    createConnection(id) {
        const polite = !(id < this._localId);
        const conn = new Connection(id, this.config, this.sig, polite);
        this.localStream()
            .then((stream) => conn.setLocalStream(stream))
            .catch((err) => console.error(err));
        conn.remoteStream()
            .then((stream) => this.onremotestream({id, stream}))
            .catch((err) => console.error(err));
        this.conns[id] = conn;
        this.onpeerjoin({ id });
        return conn;
    }

    deleteConnection(id) {
        const conn = this.conns[id];
        if(conn) {
            conn.close();
            delete this.conns[id];
            this.onpeerleave({ id });
        }
    }

    connectSignaling(url) {
        this.sig.connect(url);
    }

    onSignaling = async (message) => {
        switch(message.type) {
            case 'register':
                console.log(`Local id is ${message.id}`);
                this._localId = message.id;
                this._defferedId.resolve(this._localId);
                break;
            case 'join':
                console.log(`Got remote id ${message.id}`);
                this.createConnection(message.id);
                break;
            case 'leave':
                this.deleteConnection(message.id);
                break;
            case 'description':
                await this.createConnection(message.id).onSignaling(message);
                break;
            case 'error':
                const messages = {
                    not_found: 'Not found',
                    not_connected: 'Not connected',
                };
                const err = message.params[0];
                console.error(`Error: ${messages[err] || 'Unknown error'}`);
                break;
            default:
                console.error(`Unexpected signaling message of type \"${message.type}\"`);
                break;
        }
    }
}

function webSocketUrl(path) {
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol.replace('http', 'ws');
    return url.href;
}

function addRemoteView(id, stream = null) {
    const viewId = `view-remote-${id}`;
    let view = document.getElementById(viewId);
    if(!view) {
        view = document.createElement('video');
        view.id = viewId;
        const views = document.getElementById('views');
        views.insertBefore(view, views.firstChild);
    }

    if(stream) {
        view.srcObject = stream;
        function tryPlay() {
            view.muted = false;
            view.play().catch(err => {
                if (err.name == 'NotAllowedError') {
                    view.muted = true;
                    view.play().catch((err) => console.error(err));
                    setTimeout(tryPlay, 1000);
                }
                else console.error(err);
            });
        }
        tryPlay();
    }
}

function removeRemoteView(id) {
    const viewId = `view-remote-${id}`;
    const view = document.getElementById(viewId);
    if(view)
        view.remove();
}

async function start() {
    try {
        if(!window.RTCPeerConnection)
            throw Error('This browser does not support WebRTC');

        const roomId = window.location.hash ? window.location.hash.substring(1) : randomId(6);
        window.location.hash = '#' + roomId;

        window.addEventListener('hashchange', () => window.location.reload());

        const config = {
            rtcpMuxPolicy: 'require',
            bundlePolicy: 'max-bundle',
            iceServers: [{
                urls: 'stun:stun.ageneau.net:3478',
            },
            {
                urls: 'turn:stun.ageneau.net:3478',
                username: 'mylittlevisio',
                credential: '67613740051432',
            }],
        };

        const session = new Session(config);
        session.onpeerjoin = (evt) => addRemoteView(evt.id);
        session.onpeerleave = (evt) => removeRemoteView(evt.id);
        session.onremotestream = (evt) => addRemoteView(evt.id, evt.stream);
        session.connectSignaling(webSocketUrl(`room/${roomId}`));

        const localStream = await session.localStream();
        const localView = document.getElementById('view-local');
        localView.srcObject = localStream;
        localView.play();
    }
    catch(err) {
        console.error(err);
        alert(`Error: ${err.message}`);
    }
}

return {start};

})();

window.addEventListener('load', () => MyLittleVisio.start());

