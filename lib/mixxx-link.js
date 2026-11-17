// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
// Mirrors the Mixxx control values reported by the mapping and sends
// set/trigger commands to it. Values are keyed "group,key" (or
// "group,key@p" for normalized 0..1 parameters).
// [End of AI-generated text]
"use strict";

const { EventEmitter } = require("node:events");
const P = require("./protocol");

class MixxxLink extends EventEmitter {
  constructor(transport) {
    super();
    this.transport = transport;
    this.values = new Map();
    this.lastSeen = 0;
    transport.on("sysex", (bytes) => this.onSysex(bytes));
  }

  get connected() {
    return Date.now() - this.lastSeen < 5000;
  }

  onSysex(bytes) {
    const msg = P.decode(bytes);
    if (!msg) {
      return;
    }
    if (msg.type === P.MSG.HELLO) {
      const wasConnected = this.connected;
      const alive = msg.lines[0] && msg.lines[0][1] === "1";
      this.lastSeen = alive ? Date.now() : 0;
      if (alive && !wasConnected) {
        this.requestDump();
      }
      this.emit("status");
      return;
    }
    if (msg.type !== P.MSG.VALUES) {
      return; // our own outgoing types echoed on a loopback bus
    }
    const wasConnected = this.connected;
    this.lastSeen = Date.now();
    if (!wasConnected) {
      this.emit("status");
    }
    const changed = {};
    for (const [group, key, raw] of msg.lines) {
      const value = Number(raw);
      if (!group || !key || !Number.isFinite(value)) {
        continue;
      }
      const id = `${group},${key}`;
      const old = this.values.get(id);
      this.values.set(id, value);
      changed[id] = value;
      this.emit("value", id, value, old);
    }
    this.emit("values", changed);
  }

  get(group, key, fallback = 0) {
    const v = this.values.get(`${group},${key}`);
    return v === undefined ? fallback : v;
  }

  sendLines(type, lines) {
    for (const bytes of P.encodeChunked(type, lines)) {
      this.transport.send(bytes);
    }
  }

  setValue(group, key, value) {
    if (!P.safeName(group) || !P.safeName(key) || !Number.isFinite(Number(value))) {
      return;
    }
    this.sendLines(P.MSG.SET_VALUE, [`${group}\t${key}\t${Number(value)}`]);
  }

  setParameter(group, key, value) {
    if (!P.safeName(group) || !P.safeName(key) || !Number.isFinite(Number(value))) {
      return;
    }
    const v = Math.max(0, Math.min(1, Number(value)));
    this.sendLines(P.MSG.SET_PARAM, [`${group}\t${key}\t${v}`]);
  }

  trigger(group, key) {
    if (!P.safeName(group) || !P.safeName(key)) {
      return;
    }
    this.sendLines(P.MSG.TRIGGER, [`${group}\t${key}`]);
  }

  requestDump() {
    this.transport.send(P.encode(P.MSG.DUMP, ""));
  }

  snapshot() {
    return Object.fromEntries(this.values);
  }
}

module.exports = { MixxxLink };
