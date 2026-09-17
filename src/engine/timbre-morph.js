export const TIMBRE_SCENES = [
  { id: "felt", label: "Felt", cutoff: 2700, reverb: 0.24 },
  { id: "glass", label: "Glass", cutoff: 6800, reverb: 0.38 },
  { id: "air", label: "Air", cutoff: 4100, reverb: 0.56 },
  { id: "piano", label: "Salamander Piano", cutoff: 5200, reverb: 0.34 },
];

/**
 * One scene takes eight 3/4 bars to become the next. Both sources remain
 * active during the transition and use an equal-power curve, so neither an
 * attack nor a reverb tail is cut when the timbre changes.
 */
export function timbreMorphAt(step, neuralBias = 0) {
  const sceneCount = TIMBRE_SCENES.length;
  const phase = (((step / 48) + Math.max(-0.16, Math.min(0.16, neuralBias * 0.45))) % sceneCount + sceneCount) % sceneCount;
  const from = Math.floor(phase), to = (from + 1) % sceneCount, mix = phase - from;
  const weights = Array(sceneCount).fill(0);
  weights[from] = Math.cos(mix * Math.PI / 2);
  weights[to] = Math.sin(mix * Math.PI / 2);
  // Keep every bank alive below -29 dB. This preserves already-running
  // envelopes and reverb tails when the active pair crosses a scene boundary.
  for (let index = 0; index < weights.length; index += 1) weights[index] += 0.035;
  const power = Math.sqrt(weights.reduce((sum, weight) => sum + weight * weight, 0));
  for (let index = 0; index < weights.length; index += 1) weights[index] /= power;
  const a = TIMBRE_SCENES[from], b = TIMBRE_SCENES[to];
  return {
    from, to, mix, weights,
    label: `${a.label} → ${b.label}`,
    cutoff: a.cutoff + (b.cutoff - a.cutoff) * mix,
    reverb: a.reverb + (b.reverb - a.reverb) * mix,
  };
}

export function sampledPianoFocus() {
  const weights = TIMBRE_SCENES.map((scene) => scene.id === "piano" ? 1 : 0.035);
  const power = Math.sqrt(weights.reduce((sum, weight) => sum + weight * weight, 0));
  for (let index = 0; index < weights.length; index += 1) weights[index] /= power;
  const piano = TIMBRE_SCENES.findIndex((scene) => scene.id === "piano");
  return { from: piano, to: piano, mix: 1, weights, label: "Salamander Grand Piano", cutoff: 5200, reverb: 0.34 };
}
