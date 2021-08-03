
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
        this.id = id || "unknown";
        this.type = type || "unknown";
        this.params = params || [];
        this.body = body || "";
    }

    static deserialize(str) {
        const lines = str.split("\n");
        const header = lines.shift();
        const body = lines.join("\n");

        const params = header.split(" ");
        const id = params.shift();
        const type = params.shift();

        return new Message(id, type, params, body);
    }

    serialize() {
        const header = [this.id, this.type].concat(this.params).join(" ");
        return header + "\n" + (this.body || "");
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
        ws.onerror = () => console.error("Signaling error");
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
        //console.log("<<", data);
        if(this.ws) this.ws.send(data)
        else this.queue.push(data);
    }

    recv(id, cb) {
        this.callbacks[id] = cb;
    }

    onOpen = () => {
        console.log("Signaling open");
        for(const data of this.queue)
            this.ws.send(data);

        this.queue = [];
        this.timeout = 1000;
    }

    onClose = () => {
        console.log("Signaling closed");
        setTimeout(this.onRetry, this.timeout * Math.random());
        this.timeout*= 2;
        this.ws = undefined;
    }

    onRetry = () => {
        this.connect(this.url);
    }

    onMessage = (ev) => {
        if(typeof(ev.data) == "string") {
            //console.log(">>", ev.data);
            const message = Message.deserialize(ev.data);
            if(message.type == "leave") {
                this.defaultCallback(message);
            } else {
                const cb = this.callbacks[message.id] || this.defaultCallback;
                cb(message);
            }
        }
    }
}

class Connection {
    constructor(id, config, sig) {
        sig.recv(id, this.onSignaling);
        this.id = id;
        this.sig = sig;

        const pc = new RTCPeerConnection(config);
        pc.onicecandidate = this.onCandidate;
        pc.oniceconnectionstatechange = this.onStateChange;
        pc.ontrack = this.onTrack;
        this.pc = pc;

        this._defferedStream = new Deferred();
    }

    close() {
        this.pc.close();
    }

    async offer() {
        await this.setLocalDescription(await this.pc.createOffer());
    }

    async answer() {
        await this.setLocalDescription(await this.pc.createAnswer());
    }

    remoteStream() {
        return this._defferedStream.promise;
    }

    async setLocalStream(stream) {
        for(const track of stream.getTracks())
            this.pc.addTrack(track, stream);
    }

    async setRemoteDescription(description) {
        await this.pc.setRemoteDescription(description);
    }

    async setLocalDescription(description) {
        await this.pc.setLocalDescription(description);
        const { type, sdp } = description;
        this.sig.send(new Message(this.id, type, [], sdp));
    }

    onSignaling = async (message) => {
        switch(message.type) {
            case "offer":
                await this.setRemoteDescription({ type: "offer", sdp: message.body });
                await answer();
                break;
            case "answer":
                await this.setRemoteDescription({ type: "answer", sdp: message.body });
                break;
            case "candidate":
                const mid = message.params[0] || null;
                await this.pc.addIceCandidate({ sdpMid: mid, candidate: message.body});
                break;
            default:
                console.error(`Unexpected signaling message of type \"${message.type}\"`);
                break;
        }
    }

    onCandidate = (ev) => {
        if(ev.candidate) {
            const { sdpMid, candidate } = ev.candidate;
            this.sig.send(new Message(this.id, "candidate", [sdpMid], candidate));
        }
    }

    onStateChange = () => {
        console.log(`State change: ${this.pc.iceConnectionState}`);
        // TODO: ICE restart on disconnected or failed
    }

    onTrack = (ev) => {
        this.stream = this.stream || (ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream());
        this.stream.addTrack(ev.track);
        this._defferedStream.resolve(this.stream);
    }
}

class Session {
    constructor(url, config) {
        this.config = config || {};
        this.conns = {};
        this.sig = new Signaling(this.onSignaling);
        this.sig.connect(url);
        this._defferedId = new Deferred();
    }

    localId() {
        return this._defferedId.promise;
    }

    localStream() {
        const constraints = {
            audio: true,
            video: {
                facingMode: "user",
                width: { min: 640, ideal: 1280, max: 1920 },
                height: { min: 360, ideal: 720, max: 1080 },
            },
            video: true,
        };
        return this._cachedUserMedia ||
            (this._cachedUserMedia = navigator.mediaDevices.getUserMedia(constraints));
    }

    remoteStream(id) {
        const conn = this.conns[id] || this.connect(id);
        return conn.remoteStream();
    }

    createConnection(id) {
        const conn = new Connection(id, this.config, this.sig);
        conn.remoteStream().then((stream) => (this.onremotestream||(()=>{}))({id, stream}));
        this.conns[id] = conn;
        return conn;
    }

    deleteConnection(id) {
        const conn = this.conns[id];
        if(conn) {
            conn.close();
            delete this.conns[id];
            (this.onremotestream||(()=>{}))({id, stream: null});
        }
    }

    async connect(id) {
        const conn = await this.createConnection(id);
        conn.setLocalStream(await this.localStream());
        await conn.offer();
    }

    onSignaling = async (message) => {
        switch(message.type) {
            case "register":
                console.log(`Local id is ${message.id}`);
                this._defferedId.resolve(message.id);
                break;
            case "join":
                console.log(`Got remote id ${message.id}`);
                await this.connect(message.id);
                break;
            case "leave":
                this.deleteConnection(message.id);
                break;
            case "offer":
                const conn = this.createConnection(message.id);
                await conn.setRemoteDescription({ type: "offer", sdp: message.body });
                await conn.setLocalStream(await this.localStream());
                await conn.answer();
                break;
            case "error":
                const messages = {
                    not_found: "Not found",
                    not_connected: "Not connected",
                };
                const err = message.params[0];
                console.error(`Error: ${messages[err] || "Unknown error"}`);
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

async function initSession() {
    try {
        const roomId = window.location.hash ? window.location.hash.substring(1) : randomId(6);
        window.location.hash = '#' + roomId;

        const localLink = document.getElementById("local_link");
        const localView = document.getElementById("local_view");
        const views = document.getElementById("views");

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

        const session = new Session(webSocketUrl(`room/${roomId}`), config);

        session.onremotestream = (evt) => {
            const remoteViewId = `remote_view_${evt.id}`;
            let remoteView = document.getElementById(remoteViewId);
            if(evt.stream) {
                console.log(`Got remote stream for ${evt.id}`);
                if(!remoteView)
                    remoteView = document.createElement('video');

                remoteView.id = remoteViewId;
                remoteView.srcObject = evt.stream;
                remoteView.play();
                views.insertBefore(remoteView, views.firstChild);
            } else {
                if(remoteView)
                    remoteView.remove();
            }
        };

        const localId = await session.localId();
        const localStream = await session.localStream();
        localView.srcObject = localStream;
    }
    catch(e) {
        console.error(e);
        alert(`Error: ${e}`);
    }
}

window.addEventListener('load', () => initSession());

