// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
//
// Loads a specific playlist track into a deck even though Mixxx's controller
// API can only move the library selection relatively
// ([Playlist],SelectTrackKnob) and load "the selected track".
//
// How: we load whatever is selected, recognize it by its fingerprint
// (duration + BPM + key, compared with the library database), which tells us
// where Mixxx's cursor is. Then we move by the difference and load again,
// checking the fingerprint every time. If someone moved the selection on the
// computer in between, the check fails and we recalibrate.
//
// [End of AI-generated text]
"use strict";

const { EventEmitter } = require("node:events");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function matchScore(track, fp) {
  if (!track || !fp || !(fp.duration > 0) || !(track.duration > 0)) {
    return Infinity;
  }
  const dd = Math.abs(track.duration - fp.duration);
  if (dd > 1.5) {
    return Infinity;
  }
  let score = dd;
  if (track.bpm > 0 && fp.bpm > 0) {
    score += Math.min(Math.abs(track.bpm - fp.bpm), 3) * 0.3;
  }
  if (track.keyId > 0 && fp.keyId > 0 && track.keyId !== fp.keyId) {
    score += 0.5;
  }
  return score;
}

// Indices of the best-matching tracks (several if there are duplicates).
function bestMatches(tracks, fp) {
  let best = Infinity;
  const scores = tracks.map((t) => {
    const s = matchScore(t, fp);
    best = Math.min(best, s);
    return s;
  });
  if (best === Infinity || best > 2) {
    return [];
  }
  const out = [];
  scores.forEach((s, i) => {
    if (s <= best + 0.05) {
      out.push(i);
    }
  });
  return out;
}

function shortestDelta(from, to, n) {
  let d = (((to - from) % n) + n) % n;
  if (d > n / 2) {
    d -= n;
  }
  return d;
}

function circularDistance(a, b, n) {
  return Math.abs(shortestDelta(a, b, n));
}

class TrackLoader extends EventEmitter {
  constructor(link, db, opts = {}) {
    super();
    this.link = link;
    this.db = db;
    this.loadTimeoutMs = opts.loadTimeoutMs || 4000;
    this.settleMs = opts.settleMs || 250;
    this.stepMs = opts.stepMs || 80;
    this.cursor = null; // { source, id, index }
    this.busy = false;
    this.deckTracks = {};
  }

  fingerprint(deck) {
    const g = `[Channel${deck}]`;
    return {
      loaded: this.link.get(g, "track_loaded") > 0,
      duration: this.link.get(g, "duration"),
      bpm: this.link.get(g, "file_bpm"),
      keyId: Math.round(this.link.get(g, "file_key")),
    };
  }

  // Loads Mixxx's selected track into the deck and resolves with its fingerprint
  // (null if nothing got loaded).
  loadSelected(deck) {
    const group = `[Channel${deck}]`;
    return new Promise((resolve) => {
      let settleTimer = null;
      const finish = () => {
        this.link.off("value", onValue);
        clearTimeout(timeout);
        clearTimeout(settleTimer);
        const fp = this.fingerprint(deck);
        resolve(fp.loaded && fp.duration > 0 ? fp : null);
      };
      const onValue = (id, value) => {
        if (id === `${group},track_loaded` && value === 1) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, this.settleMs);
        }
      };
      const timeout = setTimeout(finish, this.loadTimeoutMs);
      this.link.on("value", onValue);
      this.link.trigger(group, "LoadSelectedTrack");
    });
  }

  moveSelection(delta) {
    if (delta !== 0) {
      this.link.setValue("[Playlist]", "SelectTrackKnob", delta);
    }
  }

  async calibrate(deck, list) {
    // Makes sure something is selected without changing an existing selection:
    // +1 then -1 is a no-op, or selects the last row if nothing was selected.
    this.moveSelection(1);
    this.moveSelection(-1);
    await sleep(this.stepMs);
    const fp = await this.loadSelected(deck);
    if (!fp) {
      throw new Error("Nothing was loaded. In Mixxx, open the playlist in the library so its tracks are listed.");
    }
    const matches = bestMatches(list.tracks, fp);
    if (matches.length === 0) {
      throw new Error(`The track highlighted in Mixxx isn't in "${list.name}". Open that playlist in Mixxx's library (and clear any search).`);
    }
    this.cursor = { source: list.source, id: list.id, index: matches[0] };
    return matches;
  }

  async load(deck, source, id, index) {
    if (this.busy) {
      throw new Error("Already loading a track, one moment.");
    }
    if (source !== "playlist") {
      throw new Error("Tap-to-load only works for playlists. Use the browse buttons for crates.");
    }
    const group = `[Channel${deck}]`;
    if (this.link.get(group, "play_indicator") > 0) {
      throw new Error(`Deck ${deck} is playing. Stop it first or load into the other deck.`);
    }
    const tracks = this.db.playlistTracks(id);
    const target = tracks[index];
    if (!target) {
      throw new Error("That track is no longer in the playlist. Refresh the list.");
    }
    const listInfo = this.db.lists().playlists.find((p) => p.id === id);
    const list = { source, id, tracks, name: listInfo ? listInfo.name : "this playlist" };
    const n = tracks.length;

    this.busy = true;
    this.emit("busy", true);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const cursorOk = this.cursor && this.cursor.source === source && this.cursor.id === id &&
          this.cursor.index < n;
        if (!cursorOk) {
          const matches = await this.calibrate(deck, list);
          if (matches.includes(index)) {
            this.cursor.index = index;
            return this.done(deck, target);
          }
        }
        // Prefer the duplicate closest to the target if the track appears twice.
        this.moveSelection(shortestDelta(this.cursor.index, index, n));
        this.cursor.index = index;
        await sleep(this.stepMs);
        const fp = await this.loadSelected(deck);
        const matches = fp ? bestMatches(tracks, fp) : [];
        if (matches.includes(index)) {
          return this.done(deck, target);
        }
        if (matches.length === 0) {
          this.cursor = null;
        } else {
          matches.sort((a, b) => circularDistance(a, index, n) - circularDistance(b, index, n));
          this.cursor.index = matches[0];
        }
      }
      this.cursor = null;
      throw new Error("Couldn't line up with Mixxx's track list. In Mixxx, make sure the playlist is open, sorted by the # column, with no search text.");
    } finally {
      this.busy = false;
      this.emit("busy", false);
    }
  }

  done(deck, track) {
    this.deckTracks[deck] = { track, fp: this.fingerprint(deck) };
    this.emit("deck", deck, track);
    return track;
  }

  // Works out what is loaded on a deck (for display), whoever loaded it.
  identify(deck) {
    const fp = this.fingerprint(deck);
    if (!fp.loaded || !(fp.duration > 0)) {
      delete this.deckTracks[deck];
      return null;
    }
    const known = this.deckTracks[deck];
    if (known && matchScore(known.track, fp) <= 0.2) {
      return known.track;
    }
    const candidates = this.db.tracksNearDuration(fp.duration);
    const matches = bestMatches(candidates, fp);
    const track = matches.length ? candidates[matches[0]] : null;
    if (track) {
      this.deckTracks[deck] = { track, fp };
    } else {
      delete this.deckTracks[deck];
    }
    return track;
  }

  // Manual browsing (works for crates and anything else shown in Mixxx).
  browse(delta) {
    this.moveSelection(delta);
    if (this.cursor) {
      this.cursor = null; // we no longer know where we are relative to a playlist
    }
  }

  async loadHighlighted(deck) {
    const group = `[Channel${deck}]`;
    if (this.link.get(group, "play_indicator") > 0) {
      throw new Error(`Deck ${deck} is playing. Stop it first or load into the other deck.`);
    }
    if (this.busy) {
      throw new Error("Already loading a track, one moment.");
    }
    this.busy = true;
    this.emit("busy", true);
    try {
      const fp = await this.loadSelected(deck);
      if (!fp) {
        throw new Error("Nothing was loaded. Is a track highlighted in Mixxx?");
      }
      return this.identify(deck);
    } finally {
      this.busy = false;
      this.emit("busy", false);
    }
  }
}

module.exports = { TrackLoader, matchScore, bestMatches, shortestDelta };
