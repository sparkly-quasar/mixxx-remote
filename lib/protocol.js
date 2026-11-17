// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
// SysEx framing shared with mixxx-mapping/Phone-Remote.js. Keep both in sync.
// [End of AI-generated text]
"use strict";

const HEADER = [0xf0, 0x7d, 0x4d, 0x52];
const MSG = {
  SET_VALUE: 0x01,
  VALUES: 0x02,
  DUMP: 0x03,
  HELLO: 0x04,
  SET_PARAM: 0x05,
  TRIGGER: 0x06,
};
const MAX_PAYLOAD = 400;

function encode(type, lines) {
  const text = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
  const bytes = HEADER.slice();
  bytes.push(type);
  for (let i = 0; i < text.length; i++) {
    bytes.push(text.charCodeAt(i) & 0x7f);
  }
  bytes.push(0xf7);
  return bytes;
}

// Splits lines into as many messages as needed to keep each payload small.
function encodeChunked(type, lines) {
  const out = [];
  let chunk = [];
  let size = 0;
  for (const line of lines) {
    if (chunk.length > 0 && size + line.length + 1 > MAX_PAYLOAD) {
      out.push(encode(type, chunk));
      chunk = [];
      size = 0;
    }
    chunk.push(line);
    size += line.length + 1;
  }
  if (chunk.length > 0 || out.length === 0) {
    out.push(encode(type, chunk));
  }
  return out;
}

function decode(bytes) {
  const n = bytes.length;
  if (n < 6 || bytes[n - 1] !== 0xf7) {
    return null;
  }
  for (let i = 0; i < HEADER.length; i++) {
    if (bytes[i] !== HEADER[i]) {
      return null;
    }
  }
  let text = "";
  for (let i = 5; i < n - 1; i++) {
    text += String.fromCharCode(bytes[i]);
  }
  const lines = text.length ? text.split("\n").map((l) => l.split("\t")) : [];
  return { type: bytes[4], lines };
}

// Only plain ASCII without separators is allowed in group/key names.
function safeName(s) {
  return typeof s === "string" && /^[\x20-\x7e]{1,80}$/.test(s) && !/[\t\n]/.test(s);
}

module.exports = { HEADER, MSG, MAX_PAYLOAD, encode, encodeChunked, decode, safeName };
