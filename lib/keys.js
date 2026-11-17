// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
// Mixxx stores keys as ChromaticKey ids (src/proto/keys.proto):
// 1..12 = C..B major, 13..24 = C..B minor, 0 = unknown.
// [End of AI-generated text]
"use strict";

const MAJOR_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_NAMES = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

function keyInfo(id) {
  id = Math.round(Number(id) || 0);
  if (id >= 1 && id <= 12) {
    return { id, name: MAJOR_NAMES[id - 1], camelot: MAJOR_CAMELOT[id - 1] + "B" };
  }
  if (id >= 13 && id <= 24) {
    return { id, name: MINOR_NAMES[id - 13], camelot: MINOR_CAMELOT[id - 13] + "A" };
  }
  return null;
}

module.exports = { keyInfo };
