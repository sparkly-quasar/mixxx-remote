// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
// End-to-end tests: TrackLoader -> MixxxLink -> SysEx -> real mapping script
// running in the simulator.
// [End of AI-generated text]
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");

const P = require("../lib/protocol");
const { keyInfo } = require("../lib/keys");
const { createDemoDb } = require("../lib/demo-db");
const { LibraryDb } = require("../lib/library-db");
const { MixxxLink } = require("../lib/mixxx-link");
const { TrackLoader, shortestDelta } = require("../lib/track-loader");
const { FakeMixxx, SimulatedTransport } = require("../lib/simulator");

const dbFile = createDemoDb(path.join(os.tmpdir(), `phone-remote-test-${process.pid}.sqlite`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}) {
  const db = new LibraryDb(dbFile);
  const fake = new FakeMixxx({ db, tickMs: 20, sidebar: { source: "playlist", id: 2 }, ...opts });
  fake.loadDelayMs = 5;
  const transport = new SimulatedTransport(fake);
  transport.open();
  const link = new MixxxLink(transport);
  const loader = new TrackLoader(link, db, { settleMs: 30, stepMs: 5, loadTimeoutMs: 400 });
  const close = () => {
    transport.close();
    db.close();
  };
  return { db, fake, link, loader, close };
}

test("protocol round trip", () => {
  const bytes = P.encode(P.MSG.SET_VALUE, ["[Channel1]\tvolume\t0.5"]);
  assert.deepStrictEqual(bytes.slice(0, 5), [0xf0, 0x7d, 0x4d, 0x52, 1]);
  assert.strictEqual(bytes.at(-1), 0xf7);
  assert.ok(bytes.every((b, i) => i === 0 || i === bytes.length - 1 || b < 0x80));
  const msg = P.decode(bytes);
  assert.deepStrictEqual(msg.lines, [["[Channel1]", "volume", "0.5"]]);
  const many = Array.from({ length: 80 }, (_, i) => `[Channel1]\tkey_${i}\t${i}`);
  const chunks = P.encodeChunked(P.MSG.VALUES, many);
  assert.ok(chunks.length > 1);
  assert.deepStrictEqual(chunks.flatMap((c) => P.decode(c).lines).length, 80);
});

test("keys and wrap-around deltas", () => {
  assert.deepStrictEqual(keyInfo(10), { id: 10, name: "A", camelot: "11B" });
  assert.deepStrictEqual(keyInfo(22), { id: 22, name: "Am", camelot: "8A" });
  assert.strictEqual(keyInfo(0), null);
  assert.strictEqual(shortestDelta(0, 15, 16), -1);
  assert.strictEqual(shortestDelta(14, 2, 16), 4);
  assert.strictEqual(shortestDelta(3, 3, 16), 0);
});

test("mapping relays values and rejects groups outside the allowlist", async () => {
  const { fake, link, close } = setup();
  try {
    await sleep(80);
    assert.ok(link.connected, "HELLO received");
    link.setParameter("[Channel1]", "volume", 0.25);
    link.setValue("[Channel2]", "play", 1);
    link.setValue("[App]", "num_decks", 8);
    await sleep(120);
    assert.strictEqual(fake.get("[Channel1]", "volume"), 0.25);
    assert.strictEqual(link.get("[Channel1]", "volume@p"), 0.25);
    assert.strictEqual(fake.get("[App]", "num_decks"), 0);
  } finally {
    close();
  }
});

test("loads any playlist track regardless of where Mixxx's cursor starts", async () => {
  const { db, fake, loader, close } = setup();
  try {
    await sleep(60);
    const playlistId = 2;
    const tracks = db.playlistTracks(playlistId);
    for (const start of [null, 0, 7, 15]) {
      fake.selection = start;
      loader.cursor = null;
      for (const target of [0, 15, 8, 1, 14]) {
        const deck = target % 2 ? 1 : 2;
        const t = await loader.load(deck, "playlist", playlistId, target);
        assert.strictEqual(t.id, tracks[target].id);
        assert.strictEqual(fake.get(`[Channel${deck}]`, "duration"), tracks[target].duration);
      }
    }
  } finally {
    close();
  }
});

test("recovers when the selection is moved on the computer between loads", async () => {
  const { db, fake, loader, close } = setup();
  try {
    await sleep(60);
    const tracks = db.playlistTracks(2);
    await loader.load(1, "playlist", 2, 3);
    fake.moveSelection(5); // someone scrolls in Mixxx
    const t = await loader.load(2, "playlist", 2, 10);
    assert.strictEqual(t.id, tracks[10].id);
    assert.strictEqual(fake.get("[Channel2]", "duration"), tracks[10].duration);
  } finally {
    close();
  }
});

test("explains the problem when a different playlist is open in Mixxx", async () => {
  const { fake, loader, close } = setup();
  try {
    await sleep(60);
    fake.showList("playlist", 3);
    fake.selection = 2;
    await assert.rejects(loader.load(1, "playlist", 2, 4), /isn't in "Warmup practice"/);
  } finally {
    close();
  }
});

test("refuses to load into a playing deck", async () => {
  const { link, loader, close } = setup();
  try {
    await sleep(60);
    await loader.load(1, "playlist", 2, 0);
    link.setValue("[Channel1]", "play", 1);
    await sleep(80);
    await assert.rejects(loader.load(1, "playlist", 2, 5), /Deck 1 is playing/);
  } finally {
    close();
  }
});

test("identifies what is on a deck from the whole library", async () => {
  const { db, fake, loader, close } = setup();
  try {
    await sleep(60);
    fake.showList("crate", 1);
    fake.selection = 4;
    const track = await loader.loadHighlighted(2);
    assert.strictEqual(track.id, db.crateTracks(1)[4].id);
  } finally {
    close();
  }
});
