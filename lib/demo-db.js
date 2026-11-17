// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
// Builds a small fake Mixxx library (same tables/columns the bridge reads)
// for demo mode and tests. Track names are made up.
// [End of AI-generated text]
"use strict";

const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const ARTISTS = ["Low Orbit", "Kestrel Lane", "Paper Lanterns", "Tidal Index", "Velvet Ridge", "Night Bus Choir", "Soft Static", "Hollow Pines"];
const WORDS = ["Thermal", "Ridge Lift", "Glide", "Afterglow", "Updraft", "Signal", "Halcyon", "Drift", "Canopy", "Morning Field", "Cloudbase", "Long Shadow", "Wavefold", "Undertow", "Sea Breeze", "Lantern"];

function createDemoDb(file, { tracks = 48 } = {}) {
  if (fs.existsSync(file)) {
    fs.rmSync(file);
  }
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE track_locations (id INTEGER PRIMARY KEY AUTOINCREMENT, location varchar(512) UNIQUE,
      filename varchar(512), directory varchar(512), filesize INTEGER, fs_deleted INTEGER, needs_verification INTEGER);
    CREATE TABLE library (id INTEGER PRIMARY KEY AUTOINCREMENT, artist varchar(64), title varchar(64),
      album varchar(64), duration float, bpm float, key varchar(8), key_id INTEGER DEFAULT 0,
      location INTEGER, mixxx_deleted INTEGER DEFAULT 0, datetime_added DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE Playlists (id INTEGER PRIMARY KEY, name varchar(48), position INTEGER,
      hidden INTEGER DEFAULT 0 NOT NULL, date_created datetime, date_modified datetime);
    CREATE TABLE PlaylistTracks (id INTEGER PRIMARY KEY, playlist_id INTEGER, track_id INTEGER, position INTEGER);
    CREATE TABLE crates (id INTEGER PRIMARY KEY AUTOINCREMENT, name varchar(48) UNIQUE NOT NULL,
      count INTEGER DEFAULT 0, show INTEGER DEFAULT 1);
    CREATE TABLE crate_tracks (crate_id INTEGER NOT NULL, track_id INTEGER NOT NULL, UNIQUE (crate_id, track_id));
  `);
  const insLoc = db.prepare("INSERT INTO track_locations (location, filename, directory, fs_deleted) VALUES (?, ?, ?, 0)");
  const insTrack = db.prepare("INSERT INTO library (artist, title, duration, bpm, key_id, location) VALUES (?, ?, ?, ?, ?, ?)");
  // Deterministic pseudo-random numbers so tests are repeatable.
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < tracks; i++) {
    const artist = ARTISTS[i % ARTISTS.length];
    const title = `${WORDS[i % WORDS.length]}${i >= WORDS.length ? ` (${["Club Mix", "Dub", "Extended"][i % 3]})` : ""}`;
    const file = `${artist} - ${title}.flac`;
    const loc = insLoc.run(`/Music/${file}`, file, "/Music").lastInsertRowid;
    const bpm = Math.round((118 + rnd() * 12) * 100) / 100;
    const duration = Math.round((300 + rnd() * 180) * 1000) / 1000;
    insTrack.run(artist, title, duration, bpm, 1 + Math.floor(rnd() * 24), loc);
  }
  db.exec(`
    INSERT INTO Playlists (id, name, position, hidden) VALUES
      (1, 'Auto DJ', 0, 1), (2, 'Warmup practice', 1, 0), (3, 'Peak time', 2, 0), (4, 'Set log', 3, 2);
    INSERT INTO crates (id, name) VALUES (1, 'Deep'), (2, 'Driving');
  `);
  const insPl = db.prepare("INSERT INTO PlaylistTracks (playlist_id, track_id, position) VALUES (?, ?, ?)");
  for (let i = 1; i <= 16; i++) {
    insPl.run(2, i, i);
  }
  for (let i = 0; i < 20; i++) {
    insPl.run(3, 17 + i, i + 1);
  }
  for (let i = 1; i <= 5; i++) {
    insPl.run(1, 40 + i, i);
  }
  const insCr = db.prepare("INSERT INTO crate_tracks (crate_id, track_id) VALUES (?, ?)");
  for (let i = 1; i <= tracks; i++) {
    insCr.run(i % 2 ? 1 : 2, i);
  }
  db.close();
  return file;
}

module.exports = { createDemoDb };
