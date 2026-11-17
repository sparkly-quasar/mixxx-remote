// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
//
// A stand-in for Mixxx used by `npm run demo` and the tests. It runs the real
// mixxx-mapping/Phone-Remote.js against a fake `engine`/`midi` API and
// imitates the parts of Mixxx the bridge relies on: the library track table
// (selection moves wrap around like WTrackTableView::moveSelection),
// LoadSelectedTrack, and a few deck controls.
//
// [End of AI-generated text]
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const MAPPING = path.join(__dirname, "..", "mixxx-mapping", "Phone-Remote.js");

// value <-> normalized parameter, roughly like Mixxx's control behaviours.
const PARAM_MAPS = [
  { test: /^parameter[123]$/, toValue: (p) => (p <= 0.5 ? p * 2 : 1 + (p - 0.5) * 6), toParam: (v) => (v <= 1 ? v / 2 : 0.5 + (v - 1) / 6) },
  { test: /^(rate|crossfader)$/, toValue: (p) => p * 2 - 1, toParam: (v) => (v + 1) / 2 },
];

function paramMap(key) {
  return PARAM_MAPS.find((m) => m.test.test(key)) || { toValue: (p) => p, toParam: (v) => v };
}

class FakeMixxx extends EventEmitter {
  constructor({ db, sidebar, tickMs = 50 } = {}) {
    super();
    this.db = db;
    this.values = new Map();
    this.callbacks = new Map();
    this.timers = new Set();
    this.selection = null; // row index in the visible track table, or null
    this.rows = [];
    this.tickMs = tickMs;
    this.loadDelayMs = 60;
    this.decks = {};
    for (const n of [1, 2]) {
      const g = `[Channel${n}]`;
      this.values.set(`${g},volume`, 1);
      this.values.set(`${g},rateRange`, 0.08);
      this.values.set(`${g},beatloop_size`, 8);
      this.values.set(`[EqualizerRack1_${g}_Effect1],parameter1`, 1);
      this.values.set(`[EqualizerRack1_${g}_Effect1],parameter2`, 1);
      this.values.set(`[EqualizerRack1_${g}_Effect1],parameter3`, 1);
      this.values.set(`[QuickEffectRack1_${g}],super1`, 0.5);
    }
    if (sidebar) {
      this.showList(sidebar.source, sidebar.id);
    } else if (db) {
      const first = db.lists().playlists.find((p) => p.name !== "Auto DJ queue");
      if (first) {
        this.showList("playlist", first.id);
      }
    }
  }

  // What the user has selected in Mixxx's sidebar.
  showList(source, id) {
    this.rows = this.db.tracks(source, id);
    this.selection = null;
  }

  get(group, key) {
    return this.values.get(`${group},${key}`) || 0;
  }

  set(group, key, value, { force = false } = {}) {
    const id = `${group},${key}`;
    const old = this.values.get(id);
    this.values.set(id, value);
    if (force || old !== value) {
      for (const cb of this.callbacks.get(id) || []) {
        cb(value, group, key);
      }
    }
  }

  moveSelection(delta) {
    const n = this.rows.length;
    if (n === 0) {
      return;
    }
    while (delta !== 0) {
      if (this.selection === null) {
        this.selection = delta > 0 ? 0 : n - 1;
      } else if (delta > 0) {
        this.selection = this.selection + 1 < n ? this.selection + 1 : 0;
      } else {
        this.selection = this.selection - 1 >= 0 ? this.selection - 1 : n - 1;
      }
      delta += delta > 0 ? -1 : 1;
    }
  }

  loadSelected(group) {
    if (this.selection === null) {
      return;
    }
    const t = this.rows[this.selection];
    setTimeout(() => {
      this.set(group, "track_loaded", 0, { force: true });
      this.set(group, "play_indicator", 0);
      this.set(group, "playposition", 0);
      this.set(group, "duration", t.duration);
      this.set(group, "file_bpm", t.bpm);
      this.set(group, "bpm", t.bpm);
      this.set(group, "file_key", t.keyId);
      this.set(group, "key", t.keyId);
      this.set(group, "track_loaded", 1, { force: true });
    }, this.loadDelayMs);
  }

  onSet(group, key, value) {
    const deck = /^\[Channel(\d)\]$/.exec(group);
    if (group === "[Playlist]" && key === "SelectTrackKnob") {
      this.moveSelection(Math.trunc(value));
      return;
    }
    if (deck && key === "LoadSelectedTrack" && value > 0) {
      this.loadSelected(group);
    }
    if (deck && key === "play") {
      this.set(group, "play_indicator", value > 0 && this.get(group, "track_loaded") ? 1 : 0);
    }
    if (deck && /^hotcue_\d_activate$/.test(key) && value > 0) {
      this.set(group, key.replace("activate", "status"), 1);
    }
    let m;
    if (deck && (m = /^beatloop_([\d.]+)_toggle$/.exec(key)) && value > 0) {
      this.set(group, "beatloop_size", Number(m[1]));
      this.set(group, "loop_enabled", this.get(group, "loop_enabled") ? 0 : 1);
    }
    if (deck && key === "reloop_toggle" && value > 0) {
      this.set(group, "loop_enabled", this.get(group, "loop_enabled") ? 0 : 1);
    }
    if (deck && key === "rate") {
      const bpm = this.get(group, "file_bpm") * (1 + value * this.get(group, "rateRange"));
      this.set(group, "bpm", Math.round(bpm * 100) / 100);
    }
  }

  tick() {
    for (const n of [1, 2]) {
      const g = `[Channel${n}]`;
      const playing = this.get(g, "play_indicator") > 0;
      const dur = this.get(g, "duration");
      if (playing && dur > 0) {
        const pos = this.get(g, "playposition") + this.tickMs / 1000 / dur;
        this.set(g, "playposition", Math.min(pos, 1));
        this.set(g, "vu_meter", 0.55 + Math.random() * 0.4);
      } else {
        this.set(g, "vu_meter", 0);
      }
    }
  }

  // The `engine` object the mapping script sees.
  engineApi() {
    return {
      getValue: (g, k) => this.get(g, k),
      setValue: (g, k, v) => {
        this.set(g, k, v, { force: true });
        this.onSet(g, k, v);
      },
      getParameter: (g, k) => paramMap(k).toParam(this.get(g, k)),
      setParameter: (g, k, p) => {
        const v = paramMap(k).toValue(p);
        this.set(g, k, v);
        this.onSet(g, k, v);
      },
      makeConnection: (g, k, cb) => {
        const id = `${g},${k}`;
        if (!this.callbacks.has(id)) {
          this.callbacks.set(id, new Set());
        }
        this.callbacks.get(id).add(cb);
        return { disconnect: () => this.callbacks.get(id).delete(cb) };
      },
      beginTimer: (ms, fn) => {
        const t = setInterval(fn, ms);
        this.timers.add(t);
        return t;
      },
      stopTimer: (t) => {
        clearInterval(t);
        this.timers.delete(t);
      },
    };
  }

  start() {
    const context = vm.createContext({
      engine: this.engineApi(),
      midi: { sendSysexMsg: (bytes) => this.emit("toBridge", bytes.slice()) },
      console: { log: () => {} },
      ArrayBuffer,
      Uint8Array,
    });
    vm.runInContext(fs.readFileSync(MAPPING, "utf8"), context, { filename: MAPPING });
    this.mapping = context.PhoneRemote;
    this.mapping.init("Phone Remote", false);
    this.ticker = setInterval(() => this.tick(), this.tickMs);
  }

  receive(bytes) {
    // Qt 6 hands SysEx to scripts as an ArrayBuffer.
    const buf = new Uint8Array(bytes).buffer;
    this.mapping.incomingData(buf, bytes.length);
  }

  stop() {
    this.mapping && this.mapping.shutdown();
    clearInterval(this.ticker);
    for (const t of this.timers) {
      clearInterval(t);
    }
    this.timers.clear();
  }
}

// Same interface as MidiTransport, but wired to a FakeMixxx.
class SimulatedTransport extends EventEmitter {
  constructor(fake) {
    super();
    this.fake = fake;
    this.description = "simulator (no Mixxx, no MIDI)";
    fake.on("toBridge", (bytes) => setImmediate(() => this.emit("sysex", bytes)));
  }

  open() {
    this.fake.start();
  }

  send(bytes) {
    setImmediate(() => this.fake.receive(bytes));
  }

  close() {
    this.fake.stop();
  }
}

module.exports = { FakeMixxx, SimulatedTransport };
