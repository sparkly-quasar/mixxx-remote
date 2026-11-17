// [AI-generated: written autonomously by Claude Code, an AI agent. Review before use.]
// Opens a MIDI connection to Mixxx: either a pair of virtual ports
// (default) or an existing port such as "IAC Driver Bus 1".
// [End of AI-generated text]
"use strict";

const { EventEmitter } = require("node:events");

class MidiTransport extends EventEmitter {
  constructor({ portName, existingPort }) {
    super();
    this.portName = portName;
    this.existingPort = existingPort || null;
  }

  open() {
    let midi;
    try {
      midi = require("@julusian/midi");
    } catch (err) {
      throw new Error(`Could not load the MIDI library (${err.message}). Did you run "npm install"?`);
    }
    this.input = new midi.Input();
    this.output = new midi.Output();
    // ignoreTypes(sysex, timing, activeSensing): we need SysEx.
    this.input.ignoreTypes(false, true, true);
    this.input.on("message", (_deltaTime, message) => this.emit("sysex", message));

    if (this.existingPort) {
      const find = (port) => {
        for (let i = 0; i < port.getPortCount(); i++) {
          if (port.getPortName(i).includes(this.existingPort)) {
            return i;
          }
        }
        return -1;
      };
      const inIdx = find(this.input);
      const outIdx = find(this.output);
      if (inIdx < 0 || outIdx < 0) {
        const names = [];
        for (let i = 0; i < this.output.getPortCount(); i++) {
          names.push(this.output.getPortName(i));
        }
        throw new Error(`MIDI port "${this.existingPort}" not found. Available: ${names.join(", ") || "none"}`);
      }
      this.input.openPort(inIdx);
      this.output.openPort(outIdx);
      this.description = `existing port "${this.existingPort}"`;
    } else {
      // Mixxx sees our virtual output as an input device and vice versa.
      // Identical names make Mixxx pair them into one controller.
      this.input.openVirtualPort(this.portName);
      this.output.openVirtualPort(this.portName);
      this.description = `virtual port "${this.portName}"`;
    }
  }

  send(bytes) {
    this.output.sendMessage(bytes);
  }

  close() {
    try {
      this.input && this.input.closePort();
      this.output && this.output.closePort();
    } catch {
      // ignore
    }
  }
}

module.exports = { MidiTransport };
