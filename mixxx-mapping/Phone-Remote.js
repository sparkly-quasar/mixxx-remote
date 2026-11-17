// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
//
// Phone Remote: Mixxx side of the Wi-Fi bridge.
//
// Every message is a SysEx packet: F0 7D 4D 52 <type> <ASCII payload> F7
// (0x7D is the MIDI "non-commercial / educational" manufacturer ID).
// Payload lines are "group<TAB>key<TAB>value", separated by "\n".
//
// Bridge -> Mixxx: SET_VALUE, SET_PARAM, TRIGGER, DUMP
// Mixxx -> Bridge: VALUES, HELLO (sent on init and as a heartbeat)
//
// [End of AI-generated text]

var PhoneRemote = {};

PhoneRemote.HEADER = [0xF0, 0x7D, 0x4D, 0x52];
PhoneRemote.MSG = {
    SET_VALUE: 0x01,
    VALUES: 0x02,
    DUMP: 0x03,
    HELLO: 0x04,
    SET_PARAM: 0x05,
    TRIGGER: 0x06,
};
PhoneRemote.PROTOCOL_VERSION = 1;
PhoneRemote.DECKS = [1, 2];
PhoneRemote.MAX_PAYLOAD = 400;
PhoneRemote.FLUSH_MS = 40;
PhoneRemote.HEARTBEAT_TICKS = 50; // 50 * 40 ms = 2 s

PhoneRemote.ALLOWED_GROUP = new RegExp(
    "^\\[(Channel[1-4]|PreviewDeck1|Master|Mixer|Library|Playlist|" +
    "QuickEffectRack1_\\[Channel[1-4]\\]|" +
    "EqualizerRack1_\\[Channel[1-4]\\]_Effect1)\\]$");
PhoneRemote.ALLOWED_KEY = /^[A-Za-z0-9_]{1,64}$/;

// [group, key, mode ("v" = value, "p" = normalized parameter), polled]
PhoneRemote.buildWatchList = function() {
    const list = [];
    PhoneRemote.DECKS.forEach(function(n) {
        const ch = "[Channel" + n + "]";
        [
            "play", "play_indicator", "cue_indicator", "sync_enabled", "pfl", "keylock",
            "track_loaded", "loop_enabled", "beatloop_size", "bpm", "file_bpm",
            "file_key", "key", "duration", "rateRange",
        ].forEach(function(k) {
            list.push([ch, k, "v", false]);
        });
        for (let i = 1; i <= 4; i++) {
            list.push([ch, "hotcue_" + i + "_status", "v", false]);
        }
        list.push([ch, "volume", "p", false]);
        list.push([ch, "rate", "p", false]);
        const eq = "[EqualizerRack1_" + ch + "_Effect1]";
        list.push([eq, "parameter1", "p", false]);
        list.push([eq, "parameter2", "p", false]);
        list.push([eq, "parameter3", "p", false]);
        list.push(["[QuickEffectRack1_" + ch + "]", "super1", "p", false]);
        list.push([ch, "playposition", "v", true]);
        list.push([ch, "vu_meter", "v", true]);
    });
    list.push(["[Master]", "crossfader", "p", false]);
    return list;
};

PhoneRemote.init = function() {
    PhoneRemote.watch = PhoneRemote.buildWatchList();
    PhoneRemote.pending = {};
    PhoneRemote.lastPolled = {};
    PhoneRemote.connections = [];
    PhoneRemote.tick = 0;

    PhoneRemote.watch.forEach(function(w) {
        if (w[3]) {
            return;
        }
        const conn = engine.makeConnection(w[0], w[1], function() {
            PhoneRemote.queue(w);
        });
        if (conn) {
            PhoneRemote.connections.push(conn);
        }
    });

    PhoneRemote.sendHello(1);
    PhoneRemote.queueAll();
    PhoneRemote.timer = engine.beginTimer(PhoneRemote.FLUSH_MS, PhoneRemote.onTimer);
};

PhoneRemote.shutdown = function() {
    if (PhoneRemote.timer) {
        engine.stopTimer(PhoneRemote.timer);
        PhoneRemote.timer = 0;
    }
    PhoneRemote.connections.forEach(function(c) {
        c.disconnect();
    });
    PhoneRemote.connections = [];
    PhoneRemote.sendHello(0);
};

PhoneRemote.watchId = function(w) {
    return w[0] + "\t" + w[1] + "\t" + w[2];
};

PhoneRemote.queue = function(w) {
    PhoneRemote.pending[PhoneRemote.watchId(w)] = w;
};

PhoneRemote.queueAll = function() {
    PhoneRemote.watch.forEach(PhoneRemote.queue);
};

PhoneRemote.read = function(w) {
    return w[2] === "p" ? engine.getParameter(w[0], w[1]) : engine.getValue(w[0], w[1]);
};

PhoneRemote.onTimer = function() {
    PhoneRemote.tick++;
    PhoneRemote.watch.forEach(function(w) {
        if (!w[3]) {
            return;
        }
        const id = PhoneRemote.watchId(w);
        const v = PhoneRemote.read(w);
        const last = PhoneRemote.lastPolled[id];
        if (last === undefined || Math.abs(v - last) > 0.0004) {
            PhoneRemote.lastPolled[id] = v;
            PhoneRemote.pending[id] = w;
        }
    });
    PhoneRemote.flush();
    if (PhoneRemote.tick % PhoneRemote.HEARTBEAT_TICKS === 0) {
        PhoneRemote.sendHello(1);
    }
};

PhoneRemote.formatNumber = function(v) {
    if (typeof v !== "number" || !isFinite(v)) {
        return "0";
    }
    return String(Math.round(v * 100000) / 100000);
};

PhoneRemote.flush = function() {
    const ids = Object.keys(PhoneRemote.pending);
    if (ids.length === 0) {
        return;
    }
    let chunk = "";
    ids.forEach(function(id) {
        const w = PhoneRemote.pending[id];
        const key = w[2] === "p" ? w[1] + "@p" : w[1];
        const line = w[0] + "\t" + key + "\t" + PhoneRemote.formatNumber(PhoneRemote.read(w));
        if (chunk.length > 0 && chunk.length + line.length + 1 > PhoneRemote.MAX_PAYLOAD) {
            PhoneRemote.send(PhoneRemote.MSG.VALUES, chunk);
            chunk = "";
        }
        chunk = chunk.length > 0 ? chunk + "\n" + line : line;
    });
    PhoneRemote.pending = {};
    if (chunk.length > 0) {
        PhoneRemote.send(PhoneRemote.MSG.VALUES, chunk);
    }
};

PhoneRemote.sendHello = function(state) {
    PhoneRemote.send(PhoneRemote.MSG.HELLO,
        "v" + PhoneRemote.PROTOCOL_VERSION + "\t" + state);
};

PhoneRemote.send = function(type, text) {
    const bytes = PhoneRemote.HEADER.slice();
    bytes.push(type);
    for (let i = 0; i < text.length; i++) {
        bytes.push(text.charCodeAt(i) & 0x7F);
    }
    bytes.push(0xF7);
    midi.sendSysexMsg(bytes, bytes.length);
};

PhoneRemote.decodePayload = function(bytes, length) {
    let text = "";
    for (let i = 5; i < length - 1; i++) {
        text += String.fromCharCode(bytes[i]);
    }
    return text;
};

PhoneRemote.incomingData = function(data, length) {
    const bytes = (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer)
        ? new Uint8Array(data) : data;
    if (length < 6 || bytes[length - 1] !== 0xF7) {
        return;
    }
    for (let i = 0; i < PhoneRemote.HEADER.length; i++) {
        if (bytes[i] !== PhoneRemote.HEADER[i]) {
            return;
        }
    }
    const type = bytes[4];
    if (type === PhoneRemote.MSG.DUMP) {
        PhoneRemote.queueAll();
        return;
    }
    if (type !== PhoneRemote.MSG.SET_VALUE &&
            type !== PhoneRemote.MSG.SET_PARAM &&
            type !== PhoneRemote.MSG.TRIGGER) {
        // VALUES / HELLO are our own message types (seen when using a
        // loopback bus such as the macOS IAC Driver): ignore them.
        return;
    }
    PhoneRemote.decodePayload(bytes, length).split("\n").forEach(function(line) {
        const parts = line.split("\t");
        if (parts.length < 2) {
            return;
        }
        const group = parts[0];
        const key = parts[1];
        if (!PhoneRemote.ALLOWED_GROUP.test(group) || !PhoneRemote.ALLOWED_KEY.test(key)) {
            console.log("PhoneRemote: rejected " + group + "," + key);
            return;
        }
        if (type === PhoneRemote.MSG.TRIGGER) {
            engine.setValue(group, key, 1);
            engine.setValue(group, key, 0);
            return;
        }
        const value = Number(parts[2]);
        if (!isFinite(value)) {
            return;
        }
        if (type === PhoneRemote.MSG.SET_PARAM) {
            engine.setParameter(group, key, Math.max(0, Math.min(1, value)));
        } else {
            engine.setValue(group, key, value);
        }
    });
};

// [AI-generated: end of autonomously written file]
