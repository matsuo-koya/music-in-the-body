import React, { useEffect, useMemo, useRef } from "react";

const SAMPLE_SIZE = 800;
const WORLD_DEPTH = 6400;
const ROLE_COLOR = { ground: [226, 147, 82], cloud: [231, 195, 116], motif: [104, 218, 205], echo: [125, 174, 225], particle: [218, 136, 231] };

function hash32(text, salt = 0) {
  let value = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15;
  return value >>> 0;
}

function makeScene(graph) {
  const nodes = graph.nodes.slice(0, SAMPLE_SIZE);
  const index = new Map(nodes.map((id, i) => [id, i]));
  const points = nodes.map((id, i) => {
    const angle = (hash32(id, 17) / 0xffffffff) * Math.PI * 2;
    const radius = 130 + Math.pow(hash32(id, 29) / 0xffffffff, 0.58) * 980;
    return {
      id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.68,
      z: ((hash32(id, 43) / 0xffffffff) * WORLD_DEPTH + i * 7.31) % WORLD_DEPTH,
      size: 2.2 + (hash32(id, 61) % 30) / 20,
    };
  });
  const edges = [];
  const outgoing = Array.from({ length: nodes.length }, () => []);
  const connections = Array.from({ length: nodes.length }, () => []);
  for (const edge of graph.edges) {
    const source = index.get(edge.source), target = index.get(edge.target);
    if (source != null && target != null && source !== target) {
      const visualEdge = { source, target, strength: Math.min(1, Math.log1p(edge.synapse_count) / 6) };
      edges.push(visualEdge); outgoing[source].push(visualEdge); connections[source].push(visualEdge); connections[target].push(visualEdge);
      if (edges.length >= 2200) break;
    }
  }
  return { nodes, points, edges, outgoing, connections };
}

export default function NeuronFlight({ graph, activity, running, speed = 1, lastNote = null, signals = [], canvasRef: suppliedCanvasRef = null, cinematicStart = 0, recording = false, activeNodeCount = 134181, datasetLabel = "FAFB" }) {
  const localCanvasRef = useRef(null), canvasRef = suppliedCanvasRef || localCanvasRef;
  const live = useRef({ activity, running, speed, lastNote, signals, cinematicStart, recording });
  const look = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
  const scene = useMemo(() => makeScene(graph), [graph]);
  live.current = { activity, running, speed, lastNote, signals, cinematicStart, recording };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d", { alpha: false });
    let frame = 0, previous = performance.now(), lastDraw = 0, cameraZ = 0, lastCinematicStart = 0;

    const draw = (now) => {
      if (now - lastDraw < 1000 / 30) { frame = requestAnimationFrame(draw); return; }
      lastDraw = now;
      const elapsed = Math.min(50, now - previous); previous = now;
      const state = live.current;
      if (state.cinematicStart && state.cinematicStart !== lastCinematicStart) { lastCinematicStart = state.cinematicStart; cameraZ = 0; }
      const diveRaw = state.cinematicStart ? Math.max(0, Math.min(1, (now - state.cinematicStart) / 7200)) : 1;
      const dive = diveRaw * diveRaw * (3 - 2 * diveRaw);
      cameraZ = (cameraZ + elapsed * (state.running ? (0.025 + 0.155 * dive) * state.speed : 0.018)) % WORLD_DEPTH;
      look.current.x += (look.current.targetX - look.current.x) * 0.045;
      look.current.y += (look.current.targetY - look.current.y) * 0.045;
      const dpr = Math.min(state.recording ? 2 : 1.5, window.devicePixelRatio || 1), width = canvas.clientWidth || 700, height = canvas.clientHeight || 340;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gradient = context.createRadialGradient(width * 0.5, height * 0.48, 5, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
      gradient.addColorStop(0, "#102d29"); gradient.addColorStop(0.48, "#081916"); gradient.addColorStop(1, "#030908");
      context.fillStyle = gradient; context.fillRect(0, 0, width, height);

      const cx = width / 2 + look.current.x * width * 0.13;
      const cy = height / 2 + look.current.y * height * 0.11;
      const focal = Math.min(width, height) * 1.05;
      const projected = new Array(scene.points.length);
      for (let i = 0; i < scene.points.length; i += 1) {
        const point = scene.points[i];
        const depth = ((point.z - cameraZ + WORLD_DEPTH) % WORLD_DEPTH) + 85;
        const scale = focal / depth;
        const turnX = point.x - look.current.x * depth * 0.32;
        const turnY = point.y - look.current.y * depth * 0.22;
        const perspectiveX = cx + turnX * scale, perspectiveY = cy + turnY * scale;
        const overviewAngle = now * 0.000035, zCenter = point.z - WORLD_DEPTH / 2;
        const overviewX = width / 2 + (point.x * Math.cos(overviewAngle) + zCenter * 0.18 * Math.sin(overviewAngle)) * width / 2500;
        const overviewY = height / 2 + (point.y + zCenter * 0.055) * height / 1500;
        const overviewScale = 0.09 + (1 - Math.abs(zCenter) / (WORLD_DEPTH / 2)) * 0.025;
        projected[i] = { x: overviewX + (perspectiveX - overviewX) * dive, y: overviewY + (perspectiveY - overviewY) * dive, depth: WORLD_DEPTH * 0.42 + (depth - WORLD_DEPTH * 0.42) * dive, scale: overviewScale + (scale - overviewScale) * dive };
      }

      context.lineWidth = 0.65;
      for (const edge of scene.edges) {
        const a = projected[edge.source], b = projected[edge.target];
        if (Math.abs(a.depth - b.depth) > 1050 || a.depth > 4200 || b.depth > 4200) continue;
        if (a.x < -80 || a.x > width + 80 || a.y < -80 || a.y > height + 80 || b.x < -80 || b.x > width + 80 || b.y < -80 || b.y > height + 80) continue;
        const pulse = Math.max(Math.abs(state.activity[edge.source] || 0), Math.abs(state.activity[edge.target] || 0));
        context.strokeStyle = `rgba(${pulse > 0.12 ? "231,177,81" : "83,151,137"},${Math.min(0.34, 0.025 + pulse * 0.6 + edge.strength * 0.05)})`;
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
      }

      const order = projected.map((point, i) => [point.depth, i]).sort((a, b) => b[0] - a[0]);
      for (const [, i] of order) {
        const point = projected[i];
        if (point.depth > 5000 || point.x < -30 || point.x > width + 30 || point.y < -30 || point.y > height + 30) continue;
        const value = state.activity[i] || 0, intensity = Math.min(1, Math.abs(value) * 4.5);
        const radius = Math.min(20, scene.points[i].size * point.scale * 5 + 0.7 + intensity * 3);
        if (intensity > 0.06 && radius > 1.2) {
          const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 4);
          glow.addColorStop(0, value >= 0 ? `rgba(246,190,84,${0.34 + intensity * 0.35})` : `rgba(83,197,211,${0.3 + intensity * 0.3})`);
          glow.addColorStop(1, "rgba(0,0,0,0)"); context.fillStyle = glow;
          context.beginPath(); context.arc(point.x, point.y, radius * 4, 0, Math.PI * 2); context.fill();
        }
        context.fillStyle = value >= 0 ? `rgba(255,211,119,${0.34 + intensity * 0.66})` : `rgba(114,220,229,${0.34 + intensity * 0.66})`;
        context.beginPath(); context.arc(point.x, point.y, Math.max(0.65, radius), 0, Math.PI * 2); context.fill();
      }

      // A sounding role is tied to the most active visible neuron in the
      // reservoir quarter that controls it. Pulses travel only on real edges
      // from the checked-in dataset subgraph; the positions remain synthetic.
      const liveSignals = state.signals.filter((signal) => now >= signal.time - 80 && now - signal.time < 2600);
      for (const signal of liveSignals) {
        const source = signal.neuronIndex, point = projected[source];
        if (!point || point.depth > 5000) continue;
        const age = Math.max(0, now - signal.time), fade = Math.max(0, 1 - age / 2600);
        const [r, g, b] = ROLE_COLOR[signal.role] || ROLE_COLOR.motif;
        const activityStrength = Math.min(1, Math.abs(signal.neuronActivity || 0) * 5 + 0.18);
        context.strokeStyle = `rgba(${r},${g},${b},${fade * 0.85})`; context.lineWidth = 1.2 + activityStrength * 2;
        context.beginPath(); context.arc(point.x, point.y, 6 + age / 75, 0, Math.PI * 2); context.stroke();
        const linked = (scene.outgoing[source]?.length ? scene.outgoing[source] : scene.connections[source])?.slice(0, 3) || [];
        for (const edge of linked) {
          const targetIndex = edge.source === source ? edge.target : edge.source, target = projected[targetIndex];
          if (!target || Math.abs(point.depth - target.depth) > 1300) continue;
          context.strokeStyle = `rgba(${r},${g},${b},${fade * 0.48})`; context.lineWidth = 1 + edge.strength;
          context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(target.x, target.y); context.stroke();
          const travel = Math.min(1, age / 900), x = point.x + (target.x - point.x) * travel, y = point.y + (target.y - point.y) * travel;
          context.fillStyle = `rgba(${r},${g},${b},${fade})`; context.beginPath(); context.arc(x, y, 2.3 + activityStrength * 2, 0, Math.PI * 2); context.fill();
        }
      }

      const notePulse = state.lastNote && now >= state.lastNote.time ? ((now - state.lastNote.time) / 850) : 3;
      context.strokeStyle = `rgba(237,190,96,${notePulse < 1 ? (1 - notePulse) * 0.75 : 0.22})`;
      context.lineWidth = 1; context.beginPath(); context.arc(width / 2, height / 2, 9 + Math.min(1, notePulse) * 13, 0, Math.PI * 2); context.stroke();
      context.beginPath(); context.moveTo(width / 2 - 28, height / 2); context.lineTo(width / 2 - 14, height / 2); context.moveTo(width / 2 + 14, height / 2); context.lineTo(width / 2 + 28, height / 2); context.stroke();

      context.fillStyle = "rgba(199,219,210,.72)"; context.font = "10px ui-monospace, monospace";
      const viewLabel = diveRaw < 0.18 ? "WHOLE CONNECTOME" : diveRaw < 1 ? "DIVING INTO THE NETWORK" : "NEURON POV";
      context.fillText(`${viewLabel}  ·  ${state.running ? "FLIGHT" : "DRIFT"}  ·  ${scene.nodes.length} VISIBLE / ${activeNodeCount.toLocaleString()} ACTIVE  ·  ${datasetLabel}`, 14, 21);
      const latest = liveSignals.at(-1);
      if (latest) {
        const rootId = scene.nodes[latest.neuronIndex] || "unknown";
        context.fillStyle = "rgba(238,191,96,.9)";
        context.fillText(`MODEL PULSE ${latest.neuronActivity >= 0 ? "+" : "−"}${Math.abs(latest.neuronActivity || 0).toFixed(3)}  ·  NEURON …${rootId.slice(-8)}`, 14, 38);
        context.fillText(`${latest.role.toUpperCase()} → MIDI ${latest.midi}`, 14, 54);
      }
      if (state.recording) {
        context.fillStyle = "rgba(246,88,78,.95)"; context.beginPath(); context.arc(width - 79, 18, 3.5, 0, Math.PI * 2); context.fill();
        context.font = "9px ui-monospace, monospace"; context.fillText("REC · MP4", width - 69, 21);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [scene]);

  return <canvas ref={canvasRef} className="mof-network mof-flight" aria-label="ニューロン群の生成3Dレイアウトを一人称視点で飛行するモデル活動表示"
    onPointerMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); look.current.targetX = ((event.clientX - box.left) / box.width - 0.5) * 2; look.current.targetY = ((event.clientY - box.top) / box.height - 0.5) * 2; }}
    onPointerLeave={() => { look.current.targetX = 0; look.current.targetY = 0; }} />;
}
