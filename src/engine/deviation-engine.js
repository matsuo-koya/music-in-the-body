const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export const DEVIATION_TRACKS = ["harmony", "motif", "texture", "phase"];

function structuralDistance(a, b) {
  if (!a || !b) return 0;
  const harmony = a.harmony === b.harmony ? 0 : 0.34;
  const motif = Math.min(1, Math.abs(a.motif - b.motif) / 4) * 0.25;
  const texture = Math.min(1, Math.abs(a.texture - b.texture) / 3) * 0.23;
  const phase = Math.min(1, Math.abs(a.phase - b.phase) / 2) * 0.18;
  return clamp(harmony + motif + texture + phase);
}

export function createDeviationController({ random, targetSurprise = 0.31 } = {}) {
  const history = new Map();
  const ages = Object.fromEntries(DEVIATION_TRACKS.map((track) => [track, 0]));
  let familiarity = 0, surprise = 0, interest = 0, drive = 0, freeze = false;
  function step({ position, structure, neural = [0, 0, 0, 0], variation = 0.42 }) {
    const predicted = history.get(position);
    surprise = structuralDistance(structure, predicted);
    history.set(position, { ...structure });
    for (const track of DEVIATION_TRACKS) ages[track] += 1;
    familiarity = predicted ? clamp(Object.values(ages).reduce((a, b) => a + b, 0) / 72) : familiarity * 0.82;
    freeze = surprise > targetSurprise * 2.15;
    drive = freeze ? 0 : clamp((familiarity - 0.38) * 1.25 + Math.max(0, targetSurprise - surprise) * 0.7);
    let deviation = null;
    if (predicted && (position % 4 === 3 || position === 15) && random() < drive * variation) {
      deviation = DEVIATION_TRACKS.map((track, index) => ({ track, score: ages[track] + Math.abs(neural[index] || 0) * 18 + random() * 3 })).sort((a, b) => b.score - a.score)[0].track;
      ages[deviation] = 0;
    }
    interest = clamp((1 - Math.abs(surprise - targetSurprise)) * 0.7 + Math.min(1, familiarity) * 0.3);
    return { familiarity, surprise, interest, freeze, drive, deviation, ages: { ...ages } };
  }
  return { step, state: () => ({ familiarity, surprise, interest, freeze, drive, ages: { ...ages } }) };
}
