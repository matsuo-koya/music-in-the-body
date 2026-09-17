const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
function variable(n) {
  let bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

export function buildMidi(events, bpm = 72) {
  const ppq = 480;
  const messages = [];
  const tempo = Math.round(60_000_000 / bpm);
  messages.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] });
  for (const event of events) {
    const start = Math.round(event.absoluteBeat * ppq), end = start + Math.max(1, Math.round(event.duration * ppq));
    const channel = { ground: 0, cloud: 1, motif: 2, echo: 2, particle: 3 }[event.role] ?? 0;
    messages.push({ tick: start, order: 1, bytes: [0x90 | channel, event.midi & 0x7f, Math.round(event.velocity * 127)] });
    messages.push({ tick: end, order: 0, bytes: [0x80 | channel, event.midi & 0x7f, 0] });
  }
  messages.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let at = 0, track = [];
  for (const message of messages) {
    track.push(...variable(message.tick - at), ...message.bytes); at = message.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(ppq), 0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track]);
}

export function downloadBytes(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
