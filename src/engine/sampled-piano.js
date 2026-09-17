import * as Tone from "tone";

export const SALAMANDER_KEYS = ["A0", "C1", "D#1", "F#1", "A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5", "C6", "D#6", "F#6", "A6", "C7", "D#7", "F#7", "A7", "C8"];
const CORE_KEYS = ["C2", "F#2", "C3", "F#3", "C4", "F#4", "C5", "F#5", "C6", "A6"];
const fileName = (key) => `${key.replace("#", "s")}.mp3`;

function createFeltFallback(output) {
  const felt = new Tone.PolySynth(Tone.FMSynth, {
    maxPolyphony: 32, harmonicity: 2.01, modulationIndex: 3.2,
    oscillator: { type: "sine" }, modulation: { type: "sine" },
    envelope: { attack: 0.006, decay: 2.4, sustain: 0.04, release: 3.4 },
    modulationEnvelope: { attack: 0.004, decay: 0.32, sustain: 0, release: 0.4 },
  }).connect(output);
  const body = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 32, oscillator: { type: "triangle" },
    envelope: { attack: 0.008, decay: 2.6, sustain: 0.03, release: 3 },
  }).connect(output);
  return {
    trigger(note, duration, time, velocity) {
      felt.triggerAttackRelease(note, duration, time, velocity * 0.72);
      body.triggerAttackRelease(note, duration, time, velocity * 0.34);
    },
    releaseAll() { felt.releaseAll(); body.releaseAll(); },
    dispose() { felt.dispose(); body.dispose(); },
  };
}

const loadBuffer = (baseUrl, key) => new Tone.ToneAudioBuffer().load(`${baseUrl}${fileName(key)}`);

/**
 * Satie Infinity-style progressive Salamander loader.
 * Felt is immediately playable. Ten core samples unlock the real piano, then
 * the remaining samples arrive in the background. Both paths overlap during
 * a three-second crossfade, so a load boundary cannot create silence.
 */
export function createProgressivePiano({ output, localBaseUrl, cdnBaseUrl = "https://tonejs.github.io/audio/salamander/", onStatus = () => {} }) {
  const feltBus = new Tone.Gain(1).connect(output);
  const sampleBus = new Tone.Gain(0).connect(output);
  const fallback = createFeltFallback(feltBus);
  let sampler = null, alive = true, loadGeneration = 1;

  const load = async () => {
    const generation = loadGeneration;
    const sources = [{ label: "同梱", baseUrl: localBaseUrl }, { label: "CDN", baseUrl: cdnBaseUrl }];
    for (const source of sources) {
      try {
        let done = 0;
        const progress = () => { done += 1; if (alive && generation === loadGeneration) onStatus(`Salamander読込中（${source.label}） ${done} / ${SALAMANDER_KEYS.length}`); };
        onStatus(`Salamander読込中（${source.label}） 0 / ${SALAMANDER_KEYS.length}`);
        const core = {};
        await Promise.all(CORE_KEYS.map(async (key) => { core[key] = await loadBuffer(source.baseUrl, key); progress(); }));
        if (!alive || generation !== loadGeneration) { Object.values(core).forEach((buffer) => buffer.dispose()); return; }
        sampler = new Tone.Sampler({ urls: core, release: 1.8, curve: "exponential" }).connect(sampleBus);
        sampleBus.gain.rampTo(1, 3);
        feltBus.gain.rampTo(0.035, 3);
        onStatus(`Salamander Grand Piano（${source.label}）· 中核音準備完了`);
        const rest = SALAMANDER_KEYS.filter((key) => !CORE_KEYS.includes(key));
        await Promise.all(rest.map(async (key) => {
          const buffer = await loadBuffer(source.baseUrl, key);
          if (!alive || generation !== loadGeneration || !sampler) { buffer.dispose(); return; }
          sampler.add(key, buffer); progress();
        }));
        if (alive && generation === loadGeneration) onStatus(`Salamander Grand Piano（${source.label}）· 30音 · CC BY 3.0 / A. Holm`);
        return;
      } catch (error) {
        if (!alive || generation !== loadGeneration) return;
        console.warn(`[music-in-the-body] Salamander ${source.label} load failed`, error);
      }
    }
    if (alive) onStatus("Felt合成（Salamanderを読み込めませんでした）");
  };
  const ready = load();
  return {
    ready,
    trigger(note, duration, time, velocity) {
      fallback.trigger(note, duration, time, velocity);
      sampler?.triggerAttackRelease(note, duration, time, velocity * 0.9);
    },
    releaseAll() { try { fallback.releaseAll(); sampler?.releaseAll(); } catch { /* disposed */ } },
    dispose() {
      alive = false; loadGeneration += 1;
      try { fallback.dispose(); sampler?.dispose(); feltBus.dispose(); sampleBus.dispose(); } catch { /* no-op */ }
    },
  };
}
