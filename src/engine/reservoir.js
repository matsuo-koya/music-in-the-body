export function seededRandom(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  random.state = () => state >>> 0;
  return random;
}

function rewiredEdges(edges, nodeIndex, random) {
  const result = edges.map((e) => ({ ...e }));
  const occupied = new Set(result.map((e) => `${e.source}>${e.target}`));
  const attempts = result.length * 12;
  for (let k = 0; k < attempts; k += 1) {
    const a = Math.floor(random() * result.length);
    const b = Math.floor(random() * result.length);
    if (a === b) continue;
    const e1 = result[a], e2 = result[b];
    if (e1.source === e2.source || e1.target === e2.target) continue;
    const p1 = `${e1.source}>${e2.target}`, p2 = `${e2.source}>${e1.target}`;
    if (e1.source === e2.target || e2.source === e1.target || occupied.has(p1) || occupied.has(p2)) continue;
    occupied.delete(`${e1.source}>${e1.target}`);
    occupied.delete(`${e2.source}>${e2.target}`);
    [e1.target, e2.target] = [e2.target, e1.target];
    occupied.add(p1); occupied.add(p2);
  }
  return result.filter((e) => nodeIndex.has(e.source) && nodeIndex.has(e.target));
}

export function createReservoir(graph, { seed = 783, mode = "flywire", alpha = 0.2, gain = 0.9 } = {}) {
  if (!graph?.nodes?.length || !graph?.edges?.length) throw new Error("検証済みグラフが空です");
  const nodeIndex = new Map(graph.nodes.map((id, i) => [id, i]));
  const random = seededRandom(seed);
  const sourceEdges = mode === "rewired" ? rewiredEdges(graph.edges, nodeIndex, random) : graph.edges;
  const incoming = Array.from({ length: graph.nodes.length }, () => []);
  const totals = new Float64Array(graph.nodes.length);
  for (const edge of sourceEdges) {
    const source = nodeIndex.get(edge.source), target = nodeIndex.get(edge.target);
    if (source == null || target == null) continue;
    const weight = Math.sqrt(edge.synapse_count);
    incoming[target].push([source, weight]);
    totals[target] += weight;
  }
  for (let target = 0; target < incoming.length; target += 1) {
    const total = totals[target] || 1;
    incoming[target] = incoming[target].map(([source, weight]) => [source, weight / total]);
  }

  let state = new Float64Array(graph.nodes.length);
  const inputWeight = Float64Array.from(state, () => random() * 2 - 1);
  const bias = Float64Array.from(state, () => (random() * 2 - 1) * 0.08);
  for (let i = 0; i < state.length; i += 1) state[i] = (random() * 2 - 1) * 0.05;
  let tick = 0;

  function step({ phase = 0, drift = 0, feedback = 0 } = {}) {
    const next = new Float64Array(state.length);
    let sum = 0, sq = 0, saturated = 0;
    for (let target = 0; target < state.length; target += 1) {
      let recurrent = 0;
      if (mode !== "no-recurrence") {
        for (const [source, weight] of incoming[target]) recurrent += weight * state[source];
      }
      const drive = 0.38 * Math.sin(phase * Math.PI * 2 + inputWeight[target]) + 0.24 * drift + 0.12 * feedback;
      const value = (1 - alpha) * state[target] + alpha * Math.tanh(gain * recurrent + inputWeight[target] * drive + bias[target]);
      if (!Number.isFinite(value)) throw new Error("モデル活動が非有限値になりました");
      next[target] = value;
      sum += value; sq += value * value;
      if (Math.abs(value) > 0.98) saturated += 1;
    }
    state = next; tick += 1;
    const quarter = Math.max(1, Math.floor(state.length / 4));
    const groups = [0, 1, 2, 3].map((g) => {
      let total = 0;
      const start = g * quarter, end = g === 3 ? state.length : Math.min(state.length, start + quarter);
      for (let i = start; i < end; i += 1) total += state[i];
      return total / Math.max(1, end - start);
    });
    const visibleCount = Math.min(800, state.length);
    const drivers = [0, 1, 2, 3].map((group) => {
      const start = group * quarter, end = group === 3 ? state.length : Math.min(state.length, start + quarter);
      let sampleIndex = -1, value = 0;
      for (let index = start; index < Math.min(end, visibleCount); index += 1) {
        if (sampleIndex < 0 || Math.abs(state[index]) > Math.abs(value)) { sampleIndex = index; value = state[index]; }
      }
      return { sampleIndex, value };
    });
    return { tick, groups, drivers, mean: sum / state.length, variance: sq / state.length - (sum / state.length) ** 2, saturation: saturated / state.length };
  }

  return { step, getState: () => state.slice(), randomState: () => random.state(), mode, edgeCount: sourceEdges.length };
}
