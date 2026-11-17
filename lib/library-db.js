// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
// Read-only access to Mixxx's library database (mixxxdb.sqlite).
// The bridge never writes to it.
// [End of AI-generated text]
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { keyInfo } = require("./keys");

function candidatePaths() {
  const home = os.homedir();
  const list = [];
  if (process.env.MIXXX_DB) {
    list.push(process.env.MIXXX_DB);
  }
  list.push(
    // macOS, sandboxed builds (official downloads)
    path.join(home, "Library/Containers/org.mixxx.mixxx/Data/Library/Application Support/Mixxx/mixxxdb.sqlite"),
    // macOS, non-sandboxed builds
    path.join(home, "Library/Application Support/Mixxx/mixxxdb.sqlite"),
    // Linux
    path.join(home, ".mixxx/mixxxdb.sqlite"),
    path.join(home, ".local/share/mixxx/mixxxdb.sqlite"),
  );
  if (process.env.LOCALAPPDATA) {
    list.push(path.join(process.env.LOCALAPPDATA, "Mixxx", "mixxxdb.sqlite"));
  }
  return list;
}

function findDatabase(explicit) {
  if (explicit) {
    return fs.existsSync(explicit) ? explicit : null;
  }
  return candidatePaths().find((p) => fs.existsSync(p)) || null;
}

const TRACK_COLUMNS = `
  l.id AS id,
  COALESCE(NULLIF(l.title, ''), tl.filename, '') AS title,
  COALESCE(l.artist, '') AS artist,
  COALESCE(l.bpm, 0) AS bpm,
  COALESCE(l.key_id, 0) AS keyId,
  COALESCE(l.duration, 0) AS duration`;

class LibraryDb {
  constructor(file) {
    this.file = file;
    this.db = new DatabaseSync(file, { readOnly: true });
    try {
      this.db.exec("PRAGMA busy_timeout = 2000");
    } catch {
      // Older Node versions may refuse PRAGMAs on read-only handles.
    }
  }

  close() {
    this.db.close();
  }

  static shapeTrack(row) {
    const key = keyInfo(row.keyId);
    return {
      id: row.id,
      title: row.title,
      artist: row.artist,
      bpm: Math.round(row.bpm * 100) / 100,
      keyId: row.keyId,
      key: key ? key.name : "",
      camelot: key ? key.camelot : "",
      duration: Math.round(row.duration * 1000) / 1000,
      position: row.position,
    };
  }

  lists() {
    const playlists = this.db.prepare(`
      SELECT p.id, p.name, p.hidden, COUNT(l.id) AS count
      FROM Playlists p
      LEFT JOIN PlaylistTracks pt ON pt.playlist_id = p.id
      LEFT JOIN library l ON l.id = pt.track_id AND l.mixxx_deleted = 0
      WHERE p.hidden IN (0, 1)
      GROUP BY p.id
      ORDER BY p.hidden DESC, p.name COLLATE NOCASE`).all();
    const crates = this.db.prepare(`
      SELECT c.id, c.name, COUNT(l.id) AS count
      FROM crates c
      LEFT JOIN crate_tracks ct ON ct.crate_id = c.id
      LEFT JOIN library l ON l.id = ct.track_id AND l.mixxx_deleted = 0
      WHERE c.show = 1
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE`).all();
    return {
      playlists: playlists.map((p) => ({
        source: "playlist",
        id: p.id,
        name: p.hidden === 1 ? "Auto DJ queue" : p.name,
        count: p.count,
      })),
      crates: crates.map((c) => ({ source: "crate", id: c.id, name: c.name, count: c.count })),
    };
  }

  // Same rows, in the same order, as Mixxx's playlist view sorted by "#".
  playlistTracks(playlistId) {
    return this.db.prepare(`
      SELECT pt.position AS position, ${TRACK_COLUMNS}
      FROM PlaylistTracks pt
      JOIN library l ON l.id = pt.track_id
      LEFT JOIN track_locations tl ON tl.id = l.location
      WHERE pt.playlist_id = ? AND l.mixxx_deleted = 0
      ORDER BY pt.position`).all(playlistId).map(LibraryDb.shapeTrack);
  }

  crateTracks(crateId) {
    return this.db.prepare(`
      SELECT NULL AS position, ${TRACK_COLUMNS}
      FROM crate_tracks ct
      JOIN library l ON l.id = ct.track_id
      LEFT JOIN track_locations tl ON tl.id = l.location
      WHERE ct.crate_id = ? AND l.mixxx_deleted = 0
      ORDER BY l.artist COLLATE NOCASE, l.title COLLATE NOCASE`).all(crateId).map(LibraryDb.shapeTrack);
  }

  tracks(source, id) {
    if (source === "playlist") {
      return this.playlistTracks(id);
    }
    if (source === "crate") {
      return this.crateTracks(id);
    }
    throw new Error(`unknown source ${source}`);
  }

  // Candidates for a loaded deck, found by duration (then ranked by matchScore).
  tracksNearDuration(duration, tolerance = 1.5) {
    return this.db.prepare(`
      SELECT NULL AS position, ${TRACK_COLUMNS}
      FROM library l
      LEFT JOIN track_locations tl ON tl.id = l.location
      WHERE l.mixxx_deleted = 0 AND l.duration BETWEEN ? AND ?
      LIMIT 200`).all(duration - tolerance, duration + tolerance).map(LibraryDb.shapeTrack);
  }
}

module.exports = { LibraryDb, findDatabase, candidatePaths };
