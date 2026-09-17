import test from "node:test";
import assert from "node:assert/strict";
import { createReservoir } from "../src/engine/reservoir.js";
import { createComposer, lastBars } from "../src/engine/composer.js";
import { buildMidi } from "../src/engine/midi-export.js";
import { sampledPianoFocus, timbreMorphAt } from "../src/engine/timbre-morph.js";

const graph = { nodes: ["1", "2", "3"], edges: [
  { source: "1", target: "2", synapse_count: 4 },
  { source: "2", target: "3", synapse_count: 9 },
  { source: "3", target: "1", synapse_count: 16 },
] };

test("reservoir is deterministic and finite", () => {
  const a = createReservoir(graph, { seed: 4 });
  const b = createReservoir(graph, { seed: 4 });
  for (let i = 0; i < 100; i += 1) assert.deepEqual(a.step({ phase: i / 8 }), b.step({ phase: i / 8 }));
  assert.ok(a.getState().every(Number.isFinite));
});

test("recurrence changes generated events", () => {
  const run = (mode) => {
    const r = createReservoir(graph, { seed: 9, mode });
    const c = createComposer({ seed: 9, density: 0.8 });
    for (let i = 0; i < 128; i += 1) c.next(r.step({ phase: (i % 8) / 8, drift: Math.sin(i / 21) }));
    return c.events.map((e) => [e.absoluteBeat, e.midi, e.duration]);
  };
  assert.notDeepEqual(run("flywire"), run("no-recurrence"));
});

test("history is bounded to eight bars and exports valid SMF", () => {
  const events = Array.from({ length: 80 }, (_, i) => ({ absoluteBeat: i, midi: 60, duration: 0.5, velocity: 0.5 }));
  const recent = lastBars(events, 8);
  assert.equal(recent[0].absoluteBeat, 0);
  assert.ok(recent.length <= 32);
  assert.equal(new TextDecoder().decode(buildMidi(recent).slice(0, 4)), "MThd");
});

test("Fly Dice emits a layered 3/4 ensemble and a reproducible 16-cell address", () => {
  const composer = createComposer({ seed: 783, density: 0.8 });
  const readout = { groups: [0.03, -0.02, 0.01, 0.04], drivers: [0, 1, 2, 3].map((sampleIndex) => ({ sampleIndex, value: 0.1 + sampleIndex * 0.01 })), variance: 0.003, saturation: 0 };
  const first = composer.next(readout);
  assert.ok(first.events.some((event) => event.role === "ground"));
  assert.ok(first.events.filter((event) => event.role === "cloud").length >= 3);
  assert.ok(first.events.every((event) => Number.isFinite(event.midi) && event.duration > 0));
  assert.ok(first.events.every((event) => event.neuronIndex >= 0 && Number.isFinite(event.neuronActivity)));
  for (let i = 1; i < 96; i += 1) composer.next(readout);
  const state = composer.getState();
  assert.equal(state.address.length, 16);
  assert.ok(state.address.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 10));
  assert.ok(state.deviation.interest >= 0 && state.deviation.interest <= 1);
  assert.ok(new Set(composer.events.map((event) => event.role)).size >= 3);
  const diatonic = new Set([0, 2, 4, 5, 7, 9, 11]);
  assert.ok(composer.events.filter((event) => event.role === "motif" || event.role === "echo").every((event) => diatonic.has(event.midi % 12)));
});

test("timbre morph is continuous, equal-power, and cyclic", () => {
  let previous = timbreMorphAt(0);
  for (let step = 1; step <= 192; step += 1) {
    const current = timbreMorphAt(step);
    assert.ok(Math.abs(current.weights.reduce((sum, weight) => sum + weight * weight, 0) - 1) < 1e-10);
    assert.ok(current.weights.every((weight) => weight > 0));
    assert.ok(Math.max(...current.weights.map((weight, index) => Math.abs(weight - previous.weights[index]))) < 0.04);
    assert.ok(Number.isFinite(current.cutoff) && current.reverb >= 0 && current.reverb <= 1);
    previous = current;
  }
  assert.deepEqual(timbreMorphAt(0).weights, timbreMorphAt(192).weights);
  const boundaryBefore = timbreMorphAt(47.999), boundaryAfter = timbreMorphAt(48.001);
  assert.ok(Math.max(...boundaryBefore.weights.map((weight, index) => Math.abs(weight - boundaryAfter.weights[index]))) < 0.001);
});

test("sampled piano focus keeps all banks alive while selecting Salamander", () => {
  const focus = sampledPianoFocus();
  assert.equal(focus.label, "Salamander Grand Piano");
  assert.ok(focus.weights.every((weight) => weight > 0));
  assert.ok(focus.weights[3] > 0.99);
  assert.ok(Math.abs(focus.weights.reduce((sum, weight) => sum + weight * weight, 0) - 1) < 1e-10);
});

test("take seeds vary the opening while remaining reproducible", () => {
  const readout = { groups: [0.02, -0.03, 0.01, 0.04], variance: 0.002, saturation: 0 };
  const render = (takeSeed) => {
    const composer = createComposer({ seed: 783, takeSeed, density: 0.75 });
    for (let step = 0; step < 48; step += 1) composer.next(readout);
    return { signature: composer.events.map((event) => `${event.role}:${event.midi}:${event.cell}`).join("|"), state: composer.getState() };
  };
  assert.deepEqual(render(12345), render(12345));
  assert.notEqual(render(12345).signature, render(67890).signature);
  assert.notEqual(render(12345).state.takeSeed, render(67890).state.takeSeed);
});

test("MaleCNS sensorimotor profile adds a bounded body pulse and remaps its driver", () => {
  const composer = createComposer({ seed: 100, takeSeed: 77, density: 0.6, profile: "sensorimotor" });
  const readout = { groups: [0.01, -0.02, 0.03, 0.12], drivers: [0, 1, 2, 3].map((sampleIndex) => ({ sampleIndex, value: 0.04 * (sampleIndex + 1) })), variance: 0.003, saturation: 0 };
  for (let step = 0; step < 6; step += 1) composer.next(readout);
  const pulses = composer.events.filter((event) => event.stream === "body-pulse");
  assert.equal(pulses.length, 2);
  assert.ok(pulses.every((event) => event.role === "ground" && event.neuronGroup === 3));
  assert.equal(composer.getState().profile, "sensorimotor");
});
