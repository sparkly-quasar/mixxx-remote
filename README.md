> **AI-generated:** this README and the code in this folder were written autonomously by Claude Code, an AI agent. Review before relying on them.

# Mixxx Phone Remote

Control Mixxx from your phone's browser over Wi-Fi so you can practice transitions with your own library: two decks, EQs, filter, volume, crossfader, sync, loops, hotcues, and a track list that marks which tracks fit the one that's playing (Camelot key and BPM within 6%).

```
phone browser  <--Wi-Fi / WebSocket-->  bridge (Node, on your Mac)  <--virtual MIDI-->  Mixxx
```

Audio stays on the Mac. The phone only sends controls.

## What you need

- macOS with **Mixxx 2.4 or newer**
- **Node.js 22.13 or newer** (24 LTS recommended): `brew install node`, or the installer from nodejs.org
- Phone and Mac on the same Wi-Fi network

## One-time setup

1. **Install the bridge**
   ```sh
   cd mixxx-remote
   npm install
   ```
2. **Install the Mixxx mapping.** Copy both files from `mixxx-mapping/` into Mixxx's user controller folder. The easiest way to find it is Mixxx > Preferences > Controllers > "Open User Mapping Folder". It is usually one of:
   - `~/Library/Containers/org.mixxx.mixxx/Data/Library/Application Support/Mixxx/controllers/` (official download)
   - `~/Library/Application Support/Mixxx/controllers/`

## Every session

Order matters: Mixxx only looks for MIDI devices when it starts, so **start the bridge first, then Mixxx**.

1. In Terminal: `cd mixxx-remote && npm start`
   - The first time, macOS may ask whether Terminal can access data from other apps. Allow it, because that is how the bridge reads your Mixxx library (read-only).
2. Start Mixxx. The first time, go to Preferences > Controllers > **Mixxx Phone Remote**, choose the **Phone Remote (Wi-Fi bridge)** mapping, tick **Enabled**, and apply. Mixxx remembers this.
3. Scan the QR code in the terminal with your phone's camera (or type the printed URL). The status dot turns green when Mixxx is connected.
   - Tip: on iPhone, Share > Add to Home Screen gives a full-screen app. The link includes an access key, so you only need to scan once.

## Practicing transitions

1. In Mixxx, make a playlist for the session and **open it in the library, sorted by the # column** (the default for playlists). Leave it open.
2. On the phone, go to **Library** and pick the same playlist. Tap **1** or **2** on a track to load it into that deck.
3. Start a deck playing. The list then highlights tracks whose key (green Camelot badge) and BPM (green number) fit what's playing. "Only tracks that fit" hides the rest.
4. On **Mix**: drag faders up and down or side to side (they move relative to where your finger lands, so they never jump). **Double-tap a fader to reset it.** Hold a hotcue for about a second to clear it. The time display turns red in the last 30 seconds.

**Crates** are browse-only. Use the "Mixxx highlight" arrows to move the selection in Mixxx's track list, then Load 1 or Load 2. For tap-to-load, add the tracks to a playlist.

**Headphones:** to pre-listen on the headphone button you need a second output, either an audio interface with 4 outputs or a splitter cable plus Mixxx's split-cue mode (set up in Preferences > Sound Hardware and the skin's headphone section).

## How tap-to-load works (and why it's set up this way)

Mixxx's controller API can't load "track X". It can only move the library highlight up or down (`[Playlist],SelectTrackKnob`) and load "the highlighted track". So the bridge:

1. loads whatever is highlighted,
2. recognizes it by fingerprint (duration, BPM and key, matched against `mixxxdb.sqlite`), which tells it where Mixxx's cursor is,
3. moves by the difference and loads again, checking the fingerprint every time.

If you scroll in Mixxx in between, the check fails and the bridge recalibrates on its own. That's also why the playlist needs to be open in Mixxx, sorted by #, with no search text. If it isn't, the phone tells you what's wrong.

The bridge **never writes** to your library database.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Mixxx Phone Remote" isn't in Mixxx's controller list | Quit Mixxx, make sure the bridge is running, start Mixxx again. |
| You restarted the bridge and controls stopped working | Restart Mixxx too (the virtual port was recreated). Or use the IAC bus, below. |
| "Couldn't line up with Mixxx's track list" | Open the same playlist in Mixxx, sort by #, clear the search box. |
| Library list empty / "database not found" | Start with `npm start -- --db "/path/to/mixxxdb.sqlite"`. |
| Phone can't open the page | Same Wi-Fi? Some guest or venue networks block device-to-device traffic. Allow Node through the macOS firewall if asked. |
| Screen sleeps mid-mix | Settings > Display & Brightness > Auto-Lock (the browser's keep-awake only works over HTTPS). |

**IAC bus (optional, survives bridge restarts):** open Audio MIDI Setup > Window > Show MIDI Studio, double-click IAC Driver, tick "Device is online". Then run `npm start -- --midi-port "IAC Driver Bus 1"` and pick the mapping for "IAC Driver Bus 1" in Mixxx.

## Other commands

- `npm run demo`: runs everything against a built-in Mixxx simulator with a fake library, so you can try the phone UI without Mixxx.
- `npm test`: end-to-end tests (bridge, SysEx protocol, the real mapping script running in the simulator).
- Options: `--port 8765`, `--db PATH`, `--midi-port NAME`, `--host 0.0.0.0`.

## Security

Anyone on your Wi-Fi who has the link (it includes a random key stored in `.token`) can control Mixxx. Delete `.token` to issue a new key. Don't expose the port to the internet.

## Limits

- Two decks. No waveforms (watch the Mac screen, or use the progress bar and timer).
- Wi-Fi adds roughly 10 to 50 ms and occasional hiccups: fine for faders and buttons, not for scratching.
- Tested against the simulator only. It has not yet been run against a real Mixxx on macOS.

> **AI-generated:** end of autonomously written text.
