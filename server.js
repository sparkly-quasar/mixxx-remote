#!/usr/bin/env node
// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
//
// Mixxx Phone Remote bridge.
//   phone (browser) <-WebSocket-> this server <-MIDI SysEx-> Mixxx mapping
//
// Usage: node server.js [--port 8765] [--db PATH] [--midi-port NAME] [--demo]
//
// [End of AI-generated text]
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { WebSocketServer } = require("ws");

const { LibraryDb, findDatabase, candidatePaths } = require("./lib/library-db");
const { MixxxLink } = require("./lib/mixxx-link");
const { TrackLoader } = require("./lib/track-loader");

const VIRTUAL_PORT_NAME = "Mixxx Phone Remote";
const ALLOWED_GROUP = /^\[(Channel[1-4]|PreviewDeck1|Master|Mixer|Library|Playlist|QuickEffectRack1_\[Channel[1-4]\]|EqualizerRack1_\[Channel[1-4]\]_Effect1)\]$/;
const ALLOWED_KEY = /^[A-Za-z0-9_]{1,64}$/;

function parseArgs(argv) {
  const args = { port: 8765, host: "0.0.0.0", db: null, midiPort: null, demo: false, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--port") args.port = Number(next());
    else if (a === "--host") args.host = next();
    else if (a === "--db") args.db = next();
    else if (a === "--midi-port") args.midiPort = next();
    else if (a === "--demo") args.demo = true;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log("node server.js [--port 8765] [--host 0.0.0.0] [--db PATH] [--midi-port NAME] [--demo]");
      process.exit(0);
    } else {
      console.error(`Unknown option ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function loadToken() {
  const file = path.join(__dirname, ".token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (/^[a-f0-9]{16,}$/.test(t)) return t;
  } catch {
    // first run
  }
  const t = crypto.randomBytes(12).toString("hex");
  fs.writeFileSync(file, t + "\n", { mode: 0o600 });
  return t;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const PUBLIC_DIR = path.join(__dirname, "public");

function createApp({ link, loader, db, transportDescription, token }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!/^\/[a-z0-9._-]+$/i.test(file)) {
      res.writeHead(404).end();
      return;
    }
    const full = path.join(PUBLIC_DIR, file);
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/ws" || url.searchParams.get("k") !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  const broadcast = (msg) => {
    const s = JSON.stringify(msg);
    for (const c of wss.clients) {
      if (c.readyState === 1) c.send(s);
    }
  };
  const status = () => ({ t: "status", mixxx: link.connected, midi: transportDescription, db: db ? db.file : null, busy: loader ? loader.busy : false });
  const deckInfo = {};

  // Batch value updates to the phones (~30 per second).
  let pending = {};
  let flushTimer = null;
  link.on("values", (changed) => {
    Object.assign(pending, changed);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        broadcast({ t: "v", d: pending });
        pending = {};
      }, 33);
    }
  });
  link.on("status", () => broadcast(status()));

  // Work out which track is on each deck whenever its track changes.
  const identifyTimers = {};
  const scheduleIdentify = (deck) => {
    clearTimeout(identifyTimers[deck]);
    identifyTimers[deck] = setTimeout(() => {
      if (!loader || loader.busy) return;
      const track = loader.identify(deck);
      deckInfo[deck] = track;
      broadcast({ t: "deck", deck, track });
    }, 400);
  };
  link.on("value", (id) => {
    const m = /^\[Channel([12])\],(track_loaded|duration)$/.exec(id);
    if (m) scheduleIdentify(Number(m[1]));
  });
  if (loader) {
    loader.on("deck", (deck, track) => {
      deckInfo[deck] = track;
      broadcast({ t: "deck", deck, track });
    });
    loader.on("busy", () => broadcast(status()));
  }

  let wasConnected = false;
  const statusTimer = setInterval(() => {
    if (link.connected !== wasConnected) {
      wasConnected = link.connected;
      broadcast(status());
    }
    if (!link.connected) link.requestDump();
  }, 2000);

  wss.on("connection", (ws) => {
    const send = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
    send({ t: "hello", values: link.snapshot(), decks: deckInfo });
    send(status());

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const okControl = typeof msg.g === "string" && ALLOWED_GROUP.test(msg.g) && typeof msg.k === "string" && ALLOWED_KEY.test(msg.k);
      try {
        switch (msg.t) {
          case "set":
            if (okControl) link.setValue(msg.g, msg.k, Number(msg.v));
            break;
          case "param":
            if (okControl) link.setParameter(msg.g, msg.k, Number(msg.v));
            break;
          case "trig":
            if (okControl) link.trigger(msg.g, msg.k);
            break;
          case "lists":
            if (!db) throw new Error("Mixxx library database not found. Start the bridge with --db /path/to/mixxxdb.sqlite");
            send({ t: "lists", ...db.lists() });
            break;
          case "tracks":
            if (!db) throw new Error("Mixxx library database not found.");
            send({ t: "tracks", source: msg.source, id: msg.id, tracks: db.tracks(msg.source, Number(msg.id)) });
            break;
          case "load": {
            if (!loader) throw new Error("Library database not found, so tap-to-load is unavailable.");
            const deck = Number(msg.deck);
            if (deck !== 1 && deck !== 2) throw new Error("Bad deck");
            const track = await loader.load(deck, msg.source, Number(msg.id), Number(msg.index));
            send({ t: "toast", kind: "ok", text: `Deck ${deck}: ${track.title}` });
            break;
          }
          case "browse":
            if (loader) loader.browse(Math.max(-50, Math.min(50, Math.trunc(Number(msg.delta) || 0))));
            else link.setValue("[Playlist]", "SelectTrackKnob", Math.trunc(Number(msg.delta) || 0));
            break;
          case "loadHighlighted": {
            const deck = Number(msg.deck);
            if (deck !== 1 && deck !== 2) throw new Error("Bad deck");
            if (!loader) {
              link.trigger(`[Channel${deck}]`, "LoadSelectedTrack");
              break;
            }
            const track = await loader.loadHighlighted(deck);
            send({ t: "toast", kind: "ok", text: `Deck ${deck}: ${track ? track.title : "loaded"}` });
            break;
          }
          default:
            break;
        }
      } catch (err) {
        send({ t: "toast", kind: "error", text: err.message });
      }
    });
  });

  const close = () => {
    clearInterval(statusTimer);
    for (const c of wss.clients) c.terminate();
    wss.close();
    server.close();
  };
  return { server, wss, close };
}

async function main() {
  const args = parseArgs(process.argv);
  let dbFile = findDatabase(args.db);
  let transport;

  if (args.demo) {
    const { createDemoDb } = require("./lib/demo-db");
    const { FakeMixxx, SimulatedTransport } = require("./lib/simulator");
    if (!args.db) dbFile = createDemoDb(path.join(os.tmpdir(), "mixxx-phone-remote-demo.sqlite"));
    const fake = new FakeMixxx({ db: new LibraryDb(dbFile) });
    transport = new SimulatedTransport(fake);
  } else {
    const { MidiTransport } = require("./lib/midi-transport");
    transport = new MidiTransport({ portName: VIRTUAL_PORT_NAME, existingPort: args.midiPort });
  }
  transport.open();

  let db = null;
  if (dbFile) {
    try {
      db = new LibraryDb(dbFile);
      db.lists();
    } catch (err) {
      console.error(`Could not read ${dbFile}: ${err.message}`);
      if (process.platform === "darwin") {
        console.error("If macOS asked whether Terminal may access data from other apps, allow it (System Settings > Privacy & Security).");
      }
      db = null;
    }
  } else {
    console.warn("Mixxx library database not found. Looked in:\n  " + candidatePaths().join("\n  "));
    console.warn("Pass --db /path/to/mixxxdb.sqlite. The mixer still works without it.");
  }

  const link = new MixxxLink(transport);
  const loader = db ? new TrackLoader(link, db) : null;
  const token = loadToken();
  const app = createApp({ link, loader, db, transportDescription: transport.description, token });

  app.server.listen(args.port, args.host, () => {
    const urls = lanAddresses().map((ip) => `http://${ip}:${args.port}/?k=${token}`);
    console.log("");
    console.log("Mixxx Phone Remote is running");
    console.log(`  MIDI:    ${transport.description}`);
    console.log(`  Library: ${db ? db.file : "not found"}`);
    console.log("");
    console.log("Open on your phone (same Wi-Fi):");
    for (const u of urls) console.log(`  ${u}`);
    if (urls.length === 0) console.log(`  http://localhost:${args.port}/?k=${token}`);
    if (urls[0] && !args.quiet) {
      try {
        require("qrcode-terminal").generate(urls[0], { small: true });
      } catch {
        // QR code is optional
      }
    }
    if (!args.demo) {
      console.log("Waiting for Mixxx... (start Mixxx AFTER this bridge, then enable the");
      console.log(`"${VIRTUAL_PORT_NAME}" controller with the "Phone Remote (Wi-Fi bridge)" mapping)`);
    }
  });

  let wasConnected = false;
  link.on("status", () => {
    if (link.connected !== wasConnected) {
      wasConnected = link.connected;
      console.log(link.connected ? "Mixxx connected." : "Mixxx disconnected.");
    }
  });

  const shutdown = () => {
    app.close();
    transport.close();
    if (db) db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { createApp };
