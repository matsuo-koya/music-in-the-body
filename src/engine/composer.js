import { seededRandom } from "./reservoir.js";
import { createDeviationController } from "./deviation-engine.js";

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const FUNCTIONS = [
  { name: "IΔ", root: 0, tones: [0, 4, 7, 11, 14] }, { name: "I/3", root: 4, tones: [0, 4, 7, 11, 14] },
  { name: "IVΔ", root: 5, tones: [5, 9, 12, 16, 19] }, { name: "IV6", root: 9, tones: [5, 9, 12, 16, 19] },
  { name: "vi7", root: 9, tones: [9, 12, 16, 19, 23] }, { name: "iii7", root: 4, tones: [4, 7, 11, 14, 18] },
  { name: "Vsus", root: 7, tones: [7, 12, 14, 17, 21] }, { name: "V9", root: 7, tones: [7, 11, 14, 17, 21] },
  { name: "IΔ", root: 0, tones: [0, 4, 7, 11, 14] }, { name: "iii7", root: 4, tones: [4, 7, 11, 14, 18] },
  { name: "IVΔ", root: 5, tones: [5, 9, 12, 16, 19] }, { name: "ii9", root: 2, tones: [2, 5, 9, 12, 16] },
  { name: "Vsus", root: 7, tones: [7, 12, 14, 17, 21] }, { name: "vi9", root: 9, tones: [9, 12, 16, 19, 23] },
  { name: "IV/I", root: 0, tones: [0, 5, 9, 12, 16] }, { name: "I6/9", root: 0, tones: [0, 4, 7, 9, 14] },
];
const MOTIFS = [[0, 2, 1, 4, 2, 5], [0, 1, 3, 2, 5, 4], [2, 0, 4, 3, 1, 5], [0, 3, 2, 4, 1, 5], [4, 2, 0, 1, 3, 5]];
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
const CELL_NAMES = ["Still", "Open", "Veil", "Thirds", "Drift", "Echo", "Suspension", "Halo", "Canon", "Bloom", "Dissolve"];

function nearestPitchClass(pc, target) {
  const base = target - ((target - pc) % 12 + 12) % 12;
  return Math.abs(base - target) <= Math.abs(base + 12 - target) ? base : base + 12;
}

function projectVoicing(chord, cell, previous = []) {
  const rotations = [0, 1, 2, 1, 3, 0, 2, 4, 1, 3, 0];
  const spread = cell === 1 || cell === 7 || cell === 9;
  const tones = chord.tones.slice(0, cell === 10 ? 3 : cell >= 7 ? 5 : 4);
  const candidates = [];
  for (let octave = 0; octave < 3; octave += 1) {
    const rotated = tones.map((_, i) => tones[(i + rotations[cell]) % tones.length]);
    let notes = rotated.map((tone, i) => nearestPitchClass((60 + tone) % 12, 57 + octave * 5 + i * (spread ? 6 : 4)));
    notes = notes.sort((a, b) => a - b).map((note, i) => note + (spread && i >= 2 ? 12 : 0)).filter((note) => note >= 52 && note <= 88);
    if (notes.length >= 3) candidates.push(notes);
  }
  const score = (notes) => {
    if (!previous.length) return Math.abs(notes[0] - 58) + (notes.at(-1) - notes[0]) * 0.08;
    let cost = 0;
    for (let i = 0; i < Math.min(notes.length, previous.length); i += 1) cost += Math.abs(notes[i] - previous[i]);
    for (let i = 1; i < Math.min(notes.length, previous.length); i += 1) {
      const before = Math.abs(previous[i] - previous[i - 1]) % 12, after = Math.abs(notes[i] - notes[i - 1]) % 12;
      if ((before === 0 || before === 7) && after === before && notes[i] !== previous[i]) cost += 7;
    }
    return cost;
  };
  return candidates.sort((a, b) => score(a) - score(b))[0] || [60, 64, 67, 71];
}

function chooseCell(readout, position, random) {
  const signal = clamp((readout.groups[position % 4] || 0) * 8, -1, 1);
  const center = 5 + Math.round(signal * 3.8), jitter = random() < 0.18 ? (random() < 0.5 ? -1 : 1) : 0;
  return clamp(center + jitter, 0, 10);
}

export function createComposer({ seed = 783, takeSeed = 0, density = 0.5, variation = 0.42, motifReturn = 0.55, profile = "cerebral" } = {}) {
  const compositionSeed = (Number(seed) ^ Number(takeSeed)) >>> 0;
  const random = seededRandom(compositionSeed ^ 0xa51ce), deviation = createDeviationController({ random }), events = [];
  let stepIndex = 0, previousVoicing = [], cycle = 0, address = Array(16).fill(null);
  const openingOffsets = [0, 4, 8, 12], harmonicOffset = openingOffsets[Math.floor(random() * openingOffsets.length)];
  let motifVariant = (compositionSeed + Math.floor(random() * MOTIFS.length)) % MOTIFS.length;
  let texture = 1 + Math.floor(random() * 3), phase = Math.floor(random() * 3), color = Math.floor(random() * 11);
  let cell = 5, chord = FUNCTIONS[harmonicOffset], voicing = [], controlState = deviation.state();

  function push(frame, event) {
    const complete = { ...event, cycle, position: Math.floor(stepIndex / 6) % 16, cell, cellName: CELL_NAMES[cell] };
    frame.push(complete); events.push(complete);
    if (events.length > 512) events.splice(0, 128);
  }
  function applyDeviation(track, neural) {
    if (track === "harmony") color = (color + (neural[0] >= 0 ? 1 : 10)) % 11;
    if (track === "motif") motifVariant = (motifVariant + 1 + Math.floor(Math.abs(neural[1] || 0) * 12)) % MOTIFS.length;
    if (track === "texture") texture = clamp(texture + (neural[2] >= 0 ? 1 : -1), 1, 4);
    if (track === "phase") phase = (phase + 1) % 3;
  }

  function next(readout, settings = {}) {
    const d = settings.density ?? density, v = settings.variation ?? variation, mr = settings.motifReturn ?? motifReturn;
    const stepInBar = stepIndex % 6, bar = Math.floor(stepIndex / 6), position = bar % 16, frame = [];
    if (stepInBar === 0) {
      if (position === 0 && bar > 0) { cycle += 1; address = Array(16).fill(null); }
      cell = chooseCell(readout, position, random); address[position] = cell; chord = FUNCTIONS[(position + harmonicOffset) % FUNCTIONS.length];
      controlState = deviation.step({ position, structure: { harmony: `${chord.name}:${color}`, motif: motifVariant, texture, phase }, neural: readout.groups, variation: v });
      if (controlState.deviation) applyDeviation(controlState.deviation, readout.groups);
      voicing = projectVoicing(chord, (cell + color) % 11, previousVoicing); previousVoicing = voicing;
      push(frame, { bar, beat: 0, absoluteBeat: bar * 3, midi: 36 + chord.root, duration: 3.2, velocity: 0.28 + Math.min(0.12, readout.variance * 5), role: "ground", offset: 0 });
      for (const midi of voicing) push(frame, { bar, beat: 0.75, absoluteBeat: bar * 3 + 0.75, midi, duration: 2.85, velocity: 0.19 + texture * 0.025, role: "cloud", offset: 0.75 });
    }
    const motif = MOTIFS[motifVariant], motifStep = (stepInBar + phase) % 6;
    const active = random() < d * (0.47 + texture * 0.09) && (motifStep % 2 === 0 || texture >= 3), returning = position % 4 === 3 && random() < mr;
    if (active) {
      let degree = motif[motifStep];
      if (!returning && random() < v * 0.24) degree = clamp(degree + (random() < 0.5 ? -1 : 1), 0, SCALE.length - 1);
      // Register changes are octave-only so every melodic cell remains in the
      // same C-major/A-minor pitch collection as the harmonic grammar.
      const register = cell >= 8 ? 72 : 60, midi = clamp(register + SCALE[degree], 57, 91);
      push(frame, { bar, beat: stepInBar / 2, absoluteBeat: bar * 3 + stepInBar / 2, midi, duration: motifStep === 5 || cell === 0 || cell === 6 ? 1.35 : 0.62, velocity: clamp(0.25 + (readout.groups[1] || 0) * 0.5, 0.18, 0.52), role: "motif", offset: 0 });
      if (cell === 8 && stepInBar >= 2 && random() < 0.4) push(frame, { bar, beat: stepInBar / 2 + 0.25, absoluteBeat: bar * 3 + stepInBar / 2 + 0.25, midi: midi - 12, duration: 0.48, velocity: 0.16, role: "echo", offset: 0.25 });
    }
    if ((stepIndex % 11 === 0 || stepIndex % 13 === 0) && random() < 0.18 + d * 0.16) {
      const tone = voicing.length ? voicing[(stepIndex + cell) % voicing.length] + 12 : 84;
      push(frame, { bar, beat: stepInBar / 2, absoluteBeat: bar * 3 + stepInBar / 2, midi: clamp(tone, 72, 96), duration: 2.4, velocity: 0.12, role: "particle", offset: 0 });
    }
    // The whole-CNS instrument has an extra quiet gait-like ostinato. It is a
    // musical reading of the network, not a measured motor-neuron discharge.
    if (profile === "sensorimotor" && (stepInBar === 2 || stepInBar === 4)) {
      const impulse = readout.groups[3] || 0;
      push(frame, { bar, beat: stepInBar / 2, absoluteBeat: bar * 3 + stepInBar / 2,
        midi: 43 + (impulse > 0.08 ? 5 : 0), duration: 0.28, velocity: clamp(0.12 + Math.abs(impulse) * 0.65, 0.12, 0.3),
        role: "ground", offset: 0, stream: "body-pulse" });
    }
    const roleGroup = profile === "sensorimotor"
      ? { ground: 3, cloud: 0, motif: 2, echo: 2, particle: 1 }
      : { ground: 0, cloud: 2, motif: 1, echo: 1, particle: 3 };
    for (const event of frame) {
      const group = roleGroup[event.role] ?? 0, driver = readout.drivers?.[group];
      event.neuronGroup = group;
      event.neuronIndex = driver?.sampleIndex ?? -1;
      event.neuronActivity = driver?.value ?? readout.groups[group] ?? 0;
    }
    stepIndex += 1;
    return { events: frame, state: getState() };
  }
  function getState() {
    return { cycle, position: Math.floor(stepIndex / 6) % 16, address: address.slice(), cell, cellName: CELL_NAMES[cell], harmony: chord.name, motifVariant, texture, phase, profile, takeSeed: Number(takeSeed) >>> 0, harmonicOffset, deviation: controlState };
  }
  return { next, events, getState, getMotif: () => MOTIFS[motifVariant].slice(), getStep: () => stepIndex, randomState: () => random.state() };
}

export function lastBars(events, bars = 8) {
  if (!events.length) return [];
  const last = Math.floor(events[events.length - 1].absoluteBeat / 3), startBeat = Math.max(0, (last - bars + 1) * 3);
  return events.filter((event) => event.absoluteBeat >= startBeat).map((event) => ({ ...event, absoluteBeat: event.absoluteBeat - startBeat }));
}
