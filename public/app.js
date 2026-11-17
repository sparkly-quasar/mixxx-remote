// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
"use strict";

// ---------- Key helpers (Mixxx ChromaticKey ids, see lib/keys.js) ----------
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
function camelot(id) {
  id = Math.round(id || 0);
  if (id >= 1 && id <= 12) return { n: MAJOR_CAMELOT[id - 1], l: "B" };
  if (id >= 13 && id <= 24) return { n: MINOR_CAMELOT[id - 13], l: "A" };
  return null;
}
const camelotText = (id) => {
  const c = camelot(id);
  return c ? c.n + c.l : "--";
};
function keysFit(a, b) {
  const x = camelot(a);
  const y = camelot(b);
  if (!x || !y) return false;
  if (x.n === y.n) return true; // same key or relative major/minor
  const d = Math.abs(x.n - y.n);
  return x.l === y.l && (d === 1 || d === 11);
}
function bpmFits(track, ref) {
  if (!(track > 0) || !(ref > 0)) return false;
  return [ref, ref / 2, ref * 2].some((r) => Math.abs(track - r) / r <= 0.06);
}
const fmtTime = (s) => {
  if (!(s >= 0)) return "-:--";
  s = Math.round(s);
  return `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Connection ----------
const params = new URLSearchParams(location.search);
let token = params.get("k");
try {
  if (token) localStorage.setItem("mixxxRemoteToken", token);
  else token = localStorage.getItem("mixxxRemoteToken");
} catch {
  // storage unavailable: token must stay in the URL
}

const values = {};
const deckTracks = {};
let ws = null;
let bridgeUp = false;
let mixxxUp = false;
let busy = false;
let retryMs = 500;

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// Coalesce fader messages to one per animation frame per control.
const pendingParams = new Map();
let paramFrame = 0;
function sendParam(g, k, v) {
  pendingParams.set(`${g},${k}`, { t: "param", g, k, v: Math.round(v * 10000) / 10000 });
  if (!paramFrame) {
    paramFrame = requestAnimationFrame(() => {
      paramFrame = 0;
      for (const m of pendingParams.values()) send(m);
      pendingParams.clear();
    });
  }
}

function connect() {
  if (!token) {
    setStatus("Open the link printed by the bridge (it has ?k=...)", "off");
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?k=${encodeURIComponent(token)}`);
  ws.onopen = () => {
    bridgeUp = true;
    retryMs = 500;
    updateStatus();
    if (!document.getElementById("library").hidden) send({ t: "lists" });
  };
  ws.onclose = () => {
    bridgeUp = false;
    updateStatus();
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 5000);
  };
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
}

function onMessage(m) {
  switch (m.t) {
    case "hello":
      Object.assign(values, m.values);
      Object.assign(deckTracks, m.decks || {});
      renderAll();
      break;
    case "v":
      Object.assign(values, m.d);
      scheduleRender();
      break;
    case "status":
      mixxxUp = m.mixxx;
      busy = m.busy;
      updateStatus();
      updateLoadButtons();
      break;
    case "deck":
      deckTracks[m.deck] = m.track;
      renderDeckTrack(m.deck);
      renderTracks();
      break;
    case "lists":
      renderSources(m.playlists, m.crates);
      break;
    case "tracks":
      lib.tracks = m.tracks;
      lib.loadedKey = `${m.source}:${m.id}`;
      renderTracks();
      break;
    case "toast":
      toast(m.text, m.kind === "error");
      break;
  }
}

function setStatus(text, cls) {
  const el = document.getElementById("status");
  el.className = `status ${cls}`;
  el.querySelector(".label").textContent = text;
}
function updateStatus() {
  if (!bridgeUp) setStatus("Bridge offline", "off");
  else if (!mixxxUp) setStatus("Waiting for Mixxx", "wait");
  else setStatus(busy ? "Loading track..." : "Mixxx connected", "on");
}

let toastTimer = 0;
function toast(text, isError) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.className = `show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), isError ? 6000 : 2500);
}

// ---------- Faders ----------
const faders = [];

class Fader {
  constructor(el, group, key) {
    this.el = el;
    this.group = group;
    this.key = key;
    this.vertical = el.classList.contains("v");
    this.def = Number(el.dataset.def || 0.5);
    this.bipolar = el.dataset.bipolar === "1";
    this.value = this.def;
    this.dragging = false;
    this.lastLocal = 0;
    this.lastTap = 0;
    this.fill = el.querySelector(".fill");
    this.thumb = el.querySelector(".thumb");
    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("pointermove", (e) => this.move(e));
    el.addEventListener("pointerup", () => this.up());
    el.addEventListener("pointercancel", () => this.up());
    this.render();
  }

  down(e) {
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const now = Date.now();
    if (now - this.lastTap < 300) {
      this.setLocal(this.def); // double tap: reset
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;
    this.dragging = true;
    this.el.classList.add("dragging");
    this.startValue = this.value;
    this.startPos = this.vertical ? e.clientY : e.clientX;
  }

  move(e) {
    if (!this.dragging) return;
    const rect = this.el.getBoundingClientRect();
    const len = this.vertical ? rect.height : rect.width;
    const pos = this.vertical ? e.clientY : e.clientX;
    const delta = (this.vertical ? this.startPos - pos : pos - this.startPos) / len;
    this.setLocal(Math.max(0, Math.min(1, this.startValue + delta)));
  }

  up() {
    this.dragging = false;
    this.el.classList.remove("dragging");
  }

  setLocal(v) {
    // Snap to the centre detent for bipolar controls (EQ, filter, tempo, crossfader).
    if (this.bipolar && Math.abs(v - 0.5) < 0.015) v = 0.5;
    this.value = v;
    this.lastLocal = Date.now();
    this.render();
    sendParam(this.group, this.key, v);
  }

  remote(v) {
    if (this.dragging || Date.now() - this.lastLocal < 300 || v === undefined) return;
    if (Math.abs(v - this.value) > 0.0005) {
      this.value = v;
      this.render();
    }
  }

  render() {
    const pct = this.value * 100;
    if (this.vertical) {
      this.thumb.style.bottom = `${pct}%`;
      if (this.bipolar) {
        this.fill.style.bottom = `${Math.min(pct, 50)}%`;
        this.fill.style.height = `${Math.abs(pct - 50)}%`;
      } else {
        this.fill.style.height = `${pct}%`;
      }
    } else {
      this.thumb.style.left = `${pct}%`;
      if (this.bipolar) {
        this.fill.style.left = `${Math.min(pct, 50)}%`;
        this.fill.style.width = `${Math.abs(pct - 50)}%`;
      } else {
        this.fill.style.width = `${pct}%`;
      }
    }
  }
}

// ---------- Decks ----------
const decks = {};

function buildDecks() {
  const tpl = document.getElementById("deck-tpl");
  const container = document.querySelector(".decks");
  for (const n of [1, 2]) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.deck = n;
    node.querySelector(".deck-num").textContent = n;
    const ch = `[Channel${n}]`;
    container.appendChild(node);
    decks[n] = { el: node, ch };

    node.querySelectorAll(".fader").forEach((el) => {
      let group = ch;
      let key = el.dataset.k;
      if (el.dataset.eq) {
        group = `[EqualizerRack1_${ch}_Effect1]`;
        key = `parameter${el.dataset.eq}`;
      } else if (el.dataset.fx) {
        group = `[QuickEffectRack1_${ch}]`;
        key = "super1";
      }
      faders.push(new Fader(el, group, key));
    });

    node.querySelectorAll("[data-toggle]").forEach((b) => {
      b.addEventListener("click", () => {
        const k = b.dataset.toggle;
        send({ t: "set", g: ch, k, v: values[`${ch},${k}`] > 0 ? 0 : 1 });
      });
    });
    node.querySelectorAll("[data-hold]").forEach((b) => {
      const k = b.dataset.hold;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        send({ t: "set", g: ch, k, v: 1 });
      });
      const release = () => send({ t: "set", g: ch, k, v: 0 });
      b.addEventListener("pointerup", release);
      b.addEventListener("pointercancel", release);
    });
    node.querySelectorAll("[data-loop]").forEach((b) => {
      b.addEventListener("click", () => send({ t: "trig", g: ch, k: `beatloop_${b.dataset.loop}_toggle` }));
    });
    node.querySelectorAll("[data-hotcue]").forEach((b) => {
      const i = b.dataset.hotcue;
      let holdTimer = 0;
      let cleared = false;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        cleared = false;
        send({ t: "set", g: ch, k: `hotcue_${i}_activate`, v: 1 });
        // Long press clears the hotcue.
        holdTimer = setTimeout(() => {
          cleared = true;
          send({ t: "set", g: ch, k: `hotcue_${i}_activate`, v: 0 });
          send({ t: "trig", g: ch, k: `hotcue_${i}_clear` });
          toast(`Deck ${n}: hotcue ${i} cleared`);
        }, 800);
      });
      const release = () => {
        clearTimeout(holdTimer);
        if (!cleared) send({ t: "set", g: ch, k: `hotcue_${i}_activate`, v: 0 });
      };
      b.addEventListener("pointerup", release);
      b.addEventListener("pointercancel", release);
    });
  }
  faders.push(new Fader(document.getElementById("xfader"), "[Master]", "crossfader"));
}

const val = (g, k) => values[`${g},${k}`];

function renderDeck(n) {
  const { el, ch } = decks[n];
  const loaded = val(ch, "track_loaded") > 0;
  const bpm = val(ch, "bpm");
  el.querySelector(".bpm").textContent = loaded && bpm > 0 ? bpm.toFixed(1) : "--.-";
  el.querySelector(".keybadge").textContent = loaded ? camelotText(val(ch, "key")) : "--";
  const dur = val(ch, "duration") || 0;
  const pos = Math.max(0, Math.min(1, val(ch, "playposition") || 0));
  const remaining = loaded ? dur * (1 - pos) : NaN;
  const time = el.querySelector(".time");
  time.textContent = fmtTime(remaining);
  time.classList.toggle("ending", loaded && remaining < 30);
  el.querySelector(".progress .bar").style.width = `${loaded ? pos * 100 : 0}%`;

  el.querySelector(".play").classList.toggle("on", val(ch, "play_indicator") > 0);
  el.querySelector(".cue").classList.toggle("on", val(ch, "cue_indicator") > 0);
  for (const k of ["sync_enabled", "pfl", "keylock"]) {
    el.querySelector(`[data-toggle="${k}"]`).classList.toggle("on", val(ch, k) > 0);
  }
  const loopOn = val(ch, "loop_enabled") > 0;
  const size = val(ch, "beatloop_size");
  el.querySelectorAll("[data-loop]").forEach((b) => b.classList.toggle("on", loopOn && Number(b.dataset.loop) === size));
  el.querySelectorAll("[data-hotcue]").forEach((b) => b.classList.toggle("set", val(ch, `hotcue_${b.dataset.hotcue}_status`) > 0));
  const vu = Math.max(0, Math.min(1, val(ch, "vu_meter") || 0));
  el.querySelector(".vu-fill").style.height = `${vu * 100}%`;
}

function renderDeckTrack(n) {
  const el = decks[n].el;
  const t = deckTracks[n];
  const loaded = val(decks[n].ch, "track_loaded") > 0;
  el.querySelector(".title").textContent = t ? t.title : loaded ? "Unknown track" : "No track";
  el.querySelector(".artist").textContent = t ? t.artist : "";
}

function renderAll() {
  for (const n of [1, 2]) {
    renderDeck(n);
    renderDeckTrack(n);
  }
  for (const f of faders) f.remote(val(f.group, `${f.key}@p`));
  updateRef();
}

let renderFrame = 0;
function scheduleRender() {
  if (!renderFrame) {
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      renderAll();
    });
  }
}

// ---------- Library ----------
const lib = { tracks: [], sources: [], loadedKey: null, ref: null };

function currentSource() {
  const v = document.getElementById("source").value;
  if (!v) return null;
  const [source, id] = v.split(":");
  return { source, id: Number(id) };
}

function renderSources(playlists, crates) {
  const sel = document.getElementById("source");
  let saved = sel.value;
  if (!saved) {
    try {
      saved = localStorage.getItem("mixxxRemoteSource") || "";
    } catch {
      saved = "";
    }
  }
  const opt = (s) => `<option value="${s.source}:${s.id}">${esc(s.name)} (${s.count})</option>`;
  sel.innerHTML =
    (playlists.length ? `<optgroup label="Playlists (tap to load)">${playlists.map(opt).join("")}</optgroup>` : "") +
    (crates.length ? `<optgroup label="Crates (browse only)">${crates.map(opt).join("")}</optgroup>` : "");
  if (saved && [...sel.options].some((o) => o.value === saved)) sel.value = saved;
  else {
    const firstReal = playlists.find((p) => p.name !== "Auto DJ queue") || playlists[0] || crates[0];
    if (firstReal) sel.value = `${firstReal.source}:${firstReal.id}`;
  }
  requestTracks();
}

function requestTracks() {
  const s = currentSource();
  if (!s) {
    lib.tracks = [];
    renderTracks();
    return;
  }
  try {
    localStorage.setItem("mixxxRemoteSource", `${s.source}:${s.id}`);
  } catch {
    // ignore
  }
  send({ t: "tracks", source: s.source, id: s.id });
}

// The deck you are mixing out of: the one playing (the louder one if both are).
function updateRef() {
  const playing = [1, 2].filter((n) => val(`[Channel${n}]`, "play_indicator") > 0);
  let deck = null;
  if (playing.length === 1) deck = playing[0];
  else if (playing.length === 2) deck = (val("[Channel1]", "volume@p") || 0) >= (val("[Channel2]", "volume@p") || 0) ? 1 : 2;
  const ref = deck ? { deck, bpm: val(`[Channel${deck}]`, "bpm"), key: val(`[Channel${deck}]`, "key") } : null;
  const changed = JSON.stringify(ref && { ...ref, bpm: Math.round(ref.bpm * 10) }) !== JSON.stringify(lib.ref && { ...lib.ref, bpm: Math.round(lib.ref.bpm * 10) });
  lib.ref = ref;
  const refEl = document.getElementById("ref");
  refEl.textContent = ref ? `Deck ${deck}: ${ref.bpm > 0 ? ref.bpm.toFixed(1) : "--"} BPM, ${camelotText(ref.key)}` : "Nothing playing";
  if (changed) renderTracks();
  updateLoadButtons();
}

function renderTracks() {
  const ul = document.getElementById("tracks");
  const s = currentSource();
  const hint = document.getElementById("lib-hint");
  const isPlaylist = s && s.source === "playlist";
  if (!s) {
    hint.textContent = "";
    ul.innerHTML = `<li class="empty">No playlists or crates found in your Mixxx library.</li>`;
    return;
  }
  hint.className = isPlaylist ? "hint" : "hint warn";
  hint.textContent = isPlaylist
    ? "Keep this playlist open in Mixxx's library, sorted by #."
    : "Crates are browse-only: open the crate in Mixxx and use the highlight buttons below. For tap-to-load, add the tracks to a playlist.";
  if (lib.loadedKey !== `${s.source}:${s.id}`) {
    ul.innerHTML = `<li class="empty">Loading...</li>`;
    return;
  }

  const q = document.getElementById("filter").value.trim().toLowerCase();
  const sort = document.getElementById("sort").value;
  const onlyFit = document.getElementById("only-matches").checked;
  const ref = lib.ref;
  const onDeckIds = new Set([1, 2].map((n) => deckTracks[n] && deckTracks[n].id).filter(Boolean));

  let rows = lib.tracks.map((t, index) => ({
    t,
    index,
    keyFit: ref ? keysFit(t.keyId, ref.key) : false,
    bpmFit: ref ? bpmFits(t.bpm, ref.bpm) : false,
  }));
  if (q) rows = rows.filter((r) => `${r.t.title} ${r.t.artist}`.toLowerCase().includes(q));
  if (onlyFit && ref) rows = rows.filter((r) => r.keyFit && r.bpmFit);
  const camelotSort = (t) => {
    const c = camelot(t.keyId);
    return c ? c.n * 2 + (c.l === "B" ? 1 : 0) : 99;
  };
  if (sort === "bpm") rows.sort((a, b) => (a.t.bpm || 999) - (b.t.bpm || 999));
  else if (sort === "key") rows.sort((a, b) => camelotSort(a.t) - camelotSort(b.t) || a.t.bpm - b.t.bpm);
  else if (sort === "title") rows.sort((a, b) => a.t.title.localeCompare(b.t.title));

  if (rows.length === 0) {
    ul.innerHTML = `<li class="empty">${lib.tracks.length ? "No tracks match." : "This list is empty."}</li>`;
    return;
  }
  ul.innerHTML = rows
    .map((r) => {
      const t = r.t;
      const pos = isPlaylist ? r.index + 1 : "";
      const loadBtns = isPlaylist
        ? `<button class="d1" data-load="1" data-index="${r.index}" aria-label="Load to deck 1">1</button><button class="d2" data-load="2" data-index="${r.index}" aria-label="Load to deck 2">2</button>`
        : "";
      return `<li class="${isPlaylist ? "playlist" : ""}${onDeckIds.has(t.id) ? " on-deck" : ""}">
        <span class="pos">${pos}</span>
        <div class="info"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div>
        <span class="tb${r.bpmFit ? " fit" : ""}">${t.bpm > 0 ? t.bpm.toFixed(1) : "--"}</span>
        <span class="tk${r.keyFit ? " fit" : ""}">${t.camelot || "--"}</span>
        ${loadBtns}
      </li>`;
    })
    .join("");
  updateLoadButtons();
}

function updateLoadButtons() {
  const playing = { 1: val("[Channel1]", "play_indicator") > 0, 2: val("[Channel2]", "play_indicator") > 0 };
  document.querySelectorAll("[data-load], [data-loadhl]").forEach((b) => {
    const deck = b.dataset.load || b.dataset.loadhl;
    b.disabled = busy || !mixxxUp || playing[deck];
  });
}

function setupLibrary() {
  document.getElementById("source").addEventListener("change", requestTracks);
  document.getElementById("refresh").addEventListener("click", () => send({ t: "lists" }));
  document.getElementById("filter").addEventListener("input", renderTracks);
  document.getElementById("sort").addEventListener("change", renderTracks);
  document.getElementById("only-matches").addEventListener("change", renderTracks);
  document.getElementById("tracks").addEventListener("click", (e) => {
    const b = e.target.closest("[data-load]");
    if (!b || b.disabled) return;
    const s = currentSource();
    send({ t: "load", deck: Number(b.dataset.load), source: s.source, id: s.id, index: Number(b.dataset.index) });
    toast(`Loading to deck ${b.dataset.load}...`);
  });
  document.querySelectorAll("[data-browse]").forEach((b) =>
    b.addEventListener("click", () => send({ t: "browse", delta: Number(b.dataset.browse) })),
  );
  document.querySelectorAll("[data-loadhl]").forEach((b) =>
    b.addEventListener("click", () => send({ t: "loadHighlighted", deck: Number(b.dataset.loadhl) })),
  );
}

// ---------- Tabs, wake lock, boot ----------
function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== tab.dataset.tab));
      if (tab.dataset.tab === "library") send({ t: "lists" });
    }),
  );
}

async function keepAwake() {
  // Only works over HTTPS on most browsers; harmless otherwise.
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") await navigator.wakeLock.request("screen");
  } catch {
    // not available
  }
}
document.addEventListener("visibilitychange", keepAwake);

buildDecks();
setupLibrary();
setupTabs();
renderAll();
keepAwake();
connect();
// [AI-generated: end of autonomously written file]
