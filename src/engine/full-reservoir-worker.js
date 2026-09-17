/* Web Worker for the complete FlyWire graph. Every state update traverses all
 * neurons and every directed pair in the compiled CSR file. */
let nodeCount = 0, edgeCount = 0, offsets, sources, weights;
let state, nextState, inputWeight, bias, tick = 0, alpha = 0.2, gain = 0.9;
let currentMode = "flywire", rewireShift = 1;
let sampleIndices = [];
let sampleGroups = [];

function randomFactory(seed) {
  let value = (Number(seed) >>> 0) || 1;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function initialize({ url, seed, mode, sampleIds = [] }) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`全脳グラフを取得できません (${response.status})`);
  const buffer = await response.arrayBuffer();
  const view = new DataView(buffer);
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
  if (magic !== "MOFGV001") throw new Error("全脳グラフの形式が違います");
  nodeCount = view.getUint32(8, true); edgeCount = view.getUint32(12, true);
  const idsOffset = view.getUint32(16, true), offsetsOffset = view.getUint32(20, true);
  const sourcesOffset = view.getUint32(24, true), weightsOffset = view.getUint32(28, true);
  offsets = new Uint32Array(buffer, offsetsOffset, nodeCount + 1);
  sources = new Uint32Array(buffer, sourcesOffset, edgeCount);
  weights = new Float32Array(buffer, weightsOffset, edgeCount);
  const ids = new BigUint64Array(buffer, idsOffset, nodeCount);
  const findId = (wanted) => {
    let low = 0, high = ids.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1, value = ids[middle];
      if (value === wanted) return middle;
      if (value < wanted) low = middle + 1; else high = middle - 1;
    }
    return -1;
  };
  sampleIndices = sampleIds.slice(0, 800).map((id) => findId(BigInt(id))).filter((index) => index >= 0);
  if (!sampleIndices.length) sampleIndices = Array.from({ length: Math.min(800, nodeCount) }, (_, index) => index);
  sampleGroups = sampleIndices.map((index) => Math.min(3, Math.floor(index / Math.ceil(nodeCount / 4))));
  const random = randomFactory(seed);
  state = new Float32Array(nodeCount); nextState = new Float32Array(nodeCount);
  inputWeight = new Float32Array(nodeCount); bias = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i += 1) {
    state[i] = (random() * 2 - 1) * 0.05;
    inputWeight[i] = random() * 2 - 1;
    bias[i] = (random() * 2 - 1) * 0.08;
  }
  currentMode = mode; tick = 0;
  // Rotate the complete source-endpoint list across fixed target slots. This
  // is a permutation of edge endpoints: every source occurrence (out-degree),
  // target slot (in-degree), and weight is retained without a second graph.
  rewireShift = 1 + Math.floor(random() * Math.max(1, edgeCount - 1));
  return { nodeCount, edgeCount, bytes: buffer.byteLength, firstRootId: ids[0].toString(), lastRootId: ids[nodeCount - 1].toString() };
}

function step(feedback) {
  const phase = (tick % 8) / 8, drift = Math.sin(tick / 37);
  let sum = 0, square = 0, saturated = 0;
  for (let target = 0; target < nodeCount; target += 1) {
    let recurrent = 0;
    if (currentMode !== "no-recurrence") {
      for (let edge = offsets[target]; edge < offsets[target + 1]; edge += 1) {
        const source = currentMode === "rewired" ? sources[(edge + rewireShift) % edgeCount] : sources[edge];
        recurrent += weights[edge] * state[source];
      }
    }
    const drive = 0.38 * Math.sin(phase * Math.PI * 2 + inputWeight[target]) + 0.24 * drift + 0.12 * feedback;
    const value = (1 - alpha) * state[target] + alpha * Math.tanh(gain * recurrent + inputWeight[target] * drive + bias[target]);
    nextState[target] = value; sum += value; square += value * value;
    if (Math.abs(value) > 0.98) saturated += 1;
  }
  [state, nextState] = [nextState, state]; tick += 1;
  const quarter = Math.ceil(nodeCount / 4), groups = [];
  for (let group = 0; group < 4; group += 1) {
    const start = group * quarter, end = Math.min(nodeCount, start + quarter);
    let total = 0; for (let i = start; i < end; i += 1) total += state[i];
    groups.push(total / Math.max(1, end - start));
  }
  const mean = sum / nodeCount;
  const drivers = [0, 1, 2, 3].map((group) => {
    let sampleIndex = -1, value = 0;
    for (let slot = 0; slot < sampleIndices.length; slot += 1) {
      if (sampleGroups[slot] === group && (sampleIndex < 0 || Math.abs(state[sampleIndices[slot]]) > Math.abs(value))) {
        sampleIndex = slot; value = state[sampleIndices[slot]];
      }
    }
    return { sampleIndex, value };
  });
  return { tick, groups, drivers, mean, variance: square / nodeCount - mean * mean, saturation: saturated / nodeCount };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const metadata = await initialize(data);
      self.postMessage({ type: "ready", metadata });
    } else if (data.type === "batch") {
      const output = [];
      for (let i = 0; i < data.count; i += 1) output.push(step(data.feedback || 0));
      const activity = Float32Array.from(sampleIndices, (index) => state[index]);
      self.postMessage({ type: "batch", output, activity }, [activity.buffer]);
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || String(error) });
  }
};
