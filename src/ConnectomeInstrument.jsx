import React, { useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { createReservoir } from "./engine/reservoir.js";
import { createFullReservoir } from "./engine/full-reservoir.js";
import { createComposer, lastBars } from "./engine/composer.js";
import { buildMidi, downloadBytes } from "./engine/midi-export.js";
import { timbreMorphAt, TIMBRE_SCENES } from "./engine/timbre-morph.js";
import NeuronFlight from "./engine/neuron-flight.jsx";
import "./styles/music-on-fly.css";
import "./styles/music-on-fly-full.css";
import "./styles/neuron-flight.css";

const MODES = [
  ["flywire", "FlyWire"], ["rewired", "配線組み替え"], ["no-recurrence", "再帰接続なし"],
];
const midiName = (m) => `${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][m % 12]}${Math.floor(m / 12) - 1}`;

function saveJson(value, name) {
  downloadBytes(new TextEncoder().encode(JSON.stringify(value, null, 2)), name, "application/json");
}

function pickMp4Mime() {
  const candidates = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4"];
  return candidates.find((mime) => window.MediaRecorder?.isTypeSupported?.(mime)) || "";
}

function freshTakeSeed() {
  if (globalThis.crypto?.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  return ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0) || 1;
}

function createTimbreBank(scene, output) {
  if (scene === "glass") {
    const make = (role) => new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: role === "ground" ? 1.01 : 1.5, modulationIndex: role === "particle" ? 4.2 : role === "cloud" ? 2.1 : 1.35,
      oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: role === "cloud" ? 0.18 : 0.035, decay: 1.1, sustain: 0.1, release: role === "ground" ? 3.8 : 2.5 },
      modulationEnvelope: { attack: 0.08, decay: 1.6, sustain: 0.02, release: 2.8 },
    }).connect(output);
    return Object.fromEntries(["ground", "cloud", "motif", "particle"].map((role) => [role, make(role)]));
  }
  if (scene === "air") {
    const make = (role) => new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: role === "particle" ? 2.5 : 1.002, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: role === "motif" ? 0.12 : 0.45, decay: 1.8, sustain: 0.25, release: role === "cloud" ? 5.5 : 3.2 },
      modulationEnvelope: { attack: 0.8, decay: 2.2, sustain: 0.12, release: 4.5 },
    }).connect(output);
    return Object.fromEntries(["ground", "cloud", "motif", "particle"].map((role) => [role, make(role)]));
  }
  return {
    ground: new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sine4" }, envelope: { attack: 0.16, decay: 0.9, sustain: 0.35, release: 3.4 } }).connect(output),
    cloud: new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle8" }, envelope: { attack: 0.09, decay: 1.3, sustain: 0.22, release: 4.2 } }).connect(output),
    motif: new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle4" }, envelope: { attack: 0.025, decay: 0.55, sustain: 0.12, release: 1.8 } }).connect(output),
    particle: new Tone.PolySynth(Tone.FMSynth, { harmonicity: 1.5, modulationIndex: 1.2, envelope: { attack: 0.02, decay: 1.2, sustain: 0, release: 2.5 }, modulationEnvelope: { attack: 0.2, decay: 0.8, sustain: 0, release: 1.8 } }).connect(output),
  };
}

export default function ConnectomeInstrument({ active = true, instrument } = {}) {
  const config = instrument;
  const [graph, setGraph] = useState(config.graph);
  const [manifest, setManifest] = useState(config.manifest);
  const [scope, setScope] = useState("full");
  const [mode, setMode] = useState("flywire");
  const [seed, setSeed] = useState(config.defaultSeed);
  const [takeSeed, setTakeSeed] = useState(freshTakeSeed);
  const [takeLocked, setTakeLocked] = useState(false);
  const [bpm, setBpm] = useState(config.defaultBpm || 62);
  const [volume, setVolume] = useState(0.28);
  const [density, setDensity] = useState(config.defaultDensity || 0.5);
  const [variation, setVariation] = useState(0.42);
  const [motifReturn, setMotifReturn] = useState(0.55);
  const [flightSpeed, setFlightSpeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [audioState, setAudioState] = useState("suspended");
  const [status, setStatus] = useState("停止中");
  const [events, setEvents] = useState([]);
  const [metrics, setMetrics] = useState({ variance: 0, saturation: 0 });
  const [activity, setActivity] = useState([]);
  const [lastVisualNote, setLastVisualNote] = useState(null);
  const [visualSignals, setVisualSignals] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [cinematicStart, setCinematicStart] = useState(0);
  const [timbreState, setTimbreState] = useState(() => timbreMorphAt(0));
  const [musicState, setMusicState] = useState({ cycle: 0, position: 0, address: Array(16).fill(null), cellName: "—", harmony: "—", texture: 2, phase: 0, deviation: { familiarity: 0, surprise: 0, interest: 0, drive: 0, ages: {} } });
  const runtime = useRef(null);
  const flightCanvas = useRef(null);
  const recordingRuntime = useRef(null);
  const controls = useRef({});
  controls.current = { bpm, volume, density, variation, motifReturn };

  const stop = () => {
    const activeRecorder = recordingRuntime.current?.recorder;
    if (activeRecorder && activeRecorder.state !== "inactive") activeRecorder.stop();
    const rt = runtime.current;
    if (!rt) return;
    clearInterval(rt.timer);
    rt.stopWorker?.();
    rt.fullReservoir?.terminate();
    const allInstruments = rt.instrumentBanks?.flatMap((bank) => Object.values(bank)) || [];
    try { rt.master.gain.rampTo(0, 0.12); allInstruments.forEach((instrument) => instrument.releaseAll?.()); } catch { /* already disposed */ }
    setTimeout(() => { try { allInstruments.forEach((instrument) => instrument.dispose()); rt.sceneBuses?.forEach((bus) => bus.dispose()); rt.filter.dispose(); rt.reverb.dispose(); rt.compressor.dispose(); rt.master.dispose(); rt.limiter.dispose(); } catch { /* no-op */ } }, 180);
    runtime.current = null; setRunning(false); setStatus("停止中");
  };
  useEffect(() => () => stop(), []);
  useEffect(() => { if (!active && running) stop(); }, [active, running]);

  const start = async () => {
    if (runtime.current) return;
    try {
      const performanceTake = takeLocked ? takeSeed : freshTakeSeed();
      if (!takeLocked) setTakeSeed(performanceTake);
      await Tone.start();
      let reservoir = null, fullReservoir = null, fullMetadata = null;
      if (scope === "full") {
        setStatus(`${config.allScopeLabel}の接続グラフを読み込み中…`);
        fullReservoir = createFullReservoir({ seed, mode, sampleIds: graph.nodes.slice(0, 800), url: config.binaryUrl });
        fullMetadata = await fullReservoir.ready;
      } else {
        reservoir = createReservoir(graph, { seed, mode });
      }
      const composer = createComposer({ seed, takeSeed: performanceTake, density, variation, motifReturn, profile: config.profile });
      const limiter = new Tone.Limiter(-3).toDestination();
      const master = new Tone.Gain(volume).connect(limiter);
      const recordingDestination = Tone.getContext().createMediaStreamDestination();
      master.connect(recordingDestination);
      const compressor = new Tone.Compressor({ threshold: -26, ratio: 2.4, attack: 0.18, release: 0.85, knee: 14 }).connect(master);
      const reverb = new Tone.Reverb({ decay: 5.8, wet: 0.29 }).connect(compressor);
      const filter = new Tone.Filter(3600, "lowpass").connect(reverb);
      const initialMorph = timbreMorphAt(0);
      const sceneBuses = TIMBRE_SCENES.map((_, index) => new Tone.Gain(initialMorph.weights[index]).connect(filter));
      const instrumentBanks = TIMBRE_SCENES.map((scene, index) => createTimbreBank(scene.id, sceneBuses[index]));
      let nextTime = Tone.now() + 0.12, step = 0, feedback = 0, lastPaint = 0, morphBias = 0;
      let queue = [], batchPending = false, stopped = false;
      const requestBatch = () => {
        if (!fullReservoir || batchPending || stopped || queue.length >= 8) return;
        batchPending = true;
        fullReservoir.batch(16, feedback).then(({ output, activity: sample }) => {
          batchPending = false;
          if (stopped) return;
          queue.push(...output); setActivity(Array.from(sample)); schedule(); requestBatch();
        }).catch((error) => {
          batchPending = false;
          if (!stopped) { stop(); setStatus(`全グラフ更新失敗: ${error.message}`); }
        });
      };
      const schedule = () => {
        const c = controls.current, eighth = 30 / c.bpm;
        master.gain.rampTo(c.volume, 0.08);
        if (nextTime < Tone.now() - 0.25) nextTime = Tone.now() + 0.05;
        while (nextTime < Tone.now() + 0.35) {
          const readout = fullReservoir ? queue.shift() : reservoir.step({ phase: (step % 8) / 8, drift: Math.sin(step / 37), feedback });
          if (!readout) { requestBatch(); break; }
          const frame = composer.next(readout, c);
          morphBias += ((readout.groups[3] || 0) - morphBias) * 0.035;
          const morph = timbreMorphAt(step, morphBias);
          sceneBuses.forEach((bus, index) => bus.gain.rampTo(morph.weights[index], 2.4));
          filter.frequency.rampTo(morph.cutoff, 3.5); reverb.wet.rampTo(morph.reverb, 3.5);
          const signalTime = performance.now();
          for (const event of frame.events) {
            const when = nextTime + (event.offset || 0) * 60 / c.bpm;
            const role = event.role === "echo" ? "motif" : event.role;
            event.timbre = { from: TIMBRE_SCENES[morph.from].id, to: TIMBRE_SCENES[morph.to].id, mix: +morph.mix.toFixed(4) };
            instrumentBanks.forEach((bank) => (bank[role] || bank.motif).triggerAttackRelease(Tone.Frequency(event.midi, "midi"), event.duration * 60 / c.bpm, when, event.velocity));
          }
          const lead = frame.events.find((event) => event.role === "motif") || frame.events[0];
          if (frame.events.length) setVisualSignals((previous) => [...previous.filter((signal) => signal.time > signalTime - 3500), ...frame.events.filter((event) => event.neuronIndex >= 0).map((event) => ({ ...event, time: signalTime + (event.offset || 0) * 60000 / c.bpm }))].slice(-32));
          if (lead) { feedback = (lead.midi - 67) / 12; setLastVisualNote({ midi: lead.midi, role: lead.role, neuronIndex: lead.neuronIndex, time: signalTime + (lead.offset || 0) * 60000 / c.bpm }); }
          else feedback *= 0.8;
          nextTime += eighth; step += 1;
          if (step - lastPaint >= 2) {
            lastPaint = step;
            setEvents(composer.events.slice(-128));
            setMusicState(composer.getState());
            setTimbreState(morph);
            setMetrics({ variance: readout.variance, saturation: readout.saturation });
            if (reservoir) setActivity(Array.from(reservoir.getState().slice(0, 800)));
          }
        }
        requestBatch();
      };
      const timer = setInterval(schedule, 40);
      runtime.current = { reservoir, fullReservoir, fullMetadata, composer, instrumentBanks, sceneBuses, filter, reverb, compressor, master, limiter, recordingDestination, timer, stopWorker: () => { stopped = true; } };
      requestBatch(); schedule(); setRunning(true); setAudioState(Tone.context.state);
      setStatus(`演奏中 · Take ${performanceTake.toString(36).toUpperCase()} · ${scope === "full" ? `${fullMetadata.nodeCount.toLocaleString()}ニューロン` : `${graph.nodes.length.toLocaleString()}ニューロン`} · AudioContext ${Tone.context.state}`);
    } catch (error) { stop(); setStatus(`開始失敗: ${error.message}`); }
  };

  const stopRecording = () => {
    const recorder = recordingRuntime.current?.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const toggleRecording = async () => {
    if (recordingRuntime.current) { stopRecording(); return; }
    if (!window.MediaRecorder || !flightCanvas.current?.captureStream) { setStatus("このブラウザはCanvas録画に対応していません"); return; }
    const mimeType = pickMp4Mime();
    if (!mimeType) { setStatus("このブラウザはMP4録画に対応していません。Safari最新版などMP4/H.264対応ブラウザを使用してください"); return; }
    if (!runtime.current) await start();
    const rt = runtime.current;
    if (!rt?.recordingDestination) { setStatus("音声ストリームを準備できませんでした"); return; }
    try {
      const canvasStream = flightCanvas.current.captureStream(30);
      const stream = new MediaStream([...canvasStream.getVideoTracks(), ...rt.recordingDestination.stream.getAudioTracks()]);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
      const chunks = [], startedAt = performance.now();
      const clock = setInterval(() => setRecordSeconds((performance.now() - startedAt) / 1000), 200);
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = (event) => setStatus(`MP4録画エラー: ${event.error?.message || "不明なエラー"}`);
      recorder.onstop = () => {
        clearInterval(clock);
        const blob = new Blob(chunks, { type: mimeType }), url = URL.createObjectURL(blob), anchor = document.createElement("a");
        const recordedTake = rt.composer.getState().takeSeed;
        anchor.href = url; anchor.download = `${config.fileSlug}-${seed}-${recordedTake.toString(36)}-${Date.now()}.mp4`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        stream.getTracks().forEach((track) => track.stop());
        recordingRuntime.current = null; setRecording(false); setRecordSeconds(0); setStatus(`MP4を保存しました · ${(blob.size / 1_000_000).toFixed(1)} MB`);
      };
      recordingRuntime.current = { recorder, stream, clock };
      const introStart = performance.now(); setCinematicStart(introStart);
      recorder.start(1000); setRecording(true); setRecordSeconds(0); setStatus("MP4録画中 · 全景からニューロン空間へダイブ");
    } catch (error) { setStatus(`MP4録画を開始できません: ${error.message}`); }
  };

  const save = () => {
    const source = runtime.current?.composer.events || events;
    const recent = lastBars(source, 8);
    if (!recent.length) { setStatus("保存できるノートがまだありません"); return; }
    const base = `${config.fileSlug}-${Date.now()}`;
    downloadBytes(buildMidi(recent, bpm), `${base}.mid`, "audio/midi");
    const dataInfo = scope === "full" ? config.fullManifest : manifest;
    saveJson({ format: "music-on-the-fly-session", version: 2, engineVersion: "3.3.0", instrument: config.id, createdAt: new Date().toISOString(), preset: config.preset, meter: "3/4", bpm, key: "C major / A minor", seed, takeSeed: runtime.current?.composer.getState().takeSeed ?? takeSeed, mode: mode === "flywire" ? config.id : mode, scope, flyAddress: runtime.current?.composer.getState().address || musicState.address, musicalState: runtime.current?.composer.getState() || musicState, timbreMorph: timbreState, controls: { density, variation, motifReturn }, graphSha256: dataInfo.binary_sha256 || dataInfo.graph_sha256 || graph.graph_sha256, weightTransform: dataInfo.weight_transform, neuronCount: scope === "full" ? config.fullManifest.neuron_count : graph.nodes.length, directedEdgeCount: scope === "full" ? config.fullManifest.directed_edge_count : graph.edges.length, model: { alpha: 0.2, gain: mode === "no-recurrence" ? 0 : 0.9 }, randomState: runtime.current ? { reservoir: runtime.current.reservoir?.randomState() || null, composer: runtime.current.composer.randomState() } : null, events: recent }, `${base}.json`);
    setStatus(`直近${Math.min(8, Math.ceil((recent.at(-1)?.absoluteBeat || 0) / 4 + 1))}小節を保存しました`);
  };

  const importGraph = async (file) => {
    try {
      const value = JSON.parse(await file.text());
      if (value.format !== "music-on-the-fly-graph" || !value.nodes?.length || !value.edges?.length || !value.nodes.every((n) => typeof n === "string")) throw new Error("対応する検証済みグラフ形式ではありません");
      stop(); setScope("subgraph"); setGraph(value); setManifest({ dataset_name: value.dataset || "ローカル検証済みグラフ", dataset_version: "不明", neuron_count: value.nodes.length, directed_edge_count: value.edges.length, graph_sha256: value.graph_sha256 || "未記録", weight_transform: "sqrt + target normalization" }); setEvents([]); setStatus("ローカルグラフを読み込みました（部分グラフ）");
    } catch (error) { setStatus(`読込失敗: ${error.message}`); }
  };

  const recentNotes = events.slice(-12).reverse();
  return <main className={`mof-shell ${config.className}`}>
    <header className="mof-hero">
      <div><p className="mof-kicker">{config.kicker}</p><h1>{config.title}</h1><p>{config.tagline}</p></div>
      <div className={`mof-status ${running ? "live" : ""}`}><i />{status}</div>
    </header>

    <section className="mof-grid">
      <div className="mof-panel mof-stage">
        <NeuronFlight graph={graph} activity={activity} running={running} speed={flightSpeed} lastNote={lastVisualNote} signals={visualSignals} canvasRef={flightCanvas} cinematicStart={cinematicStart} recording={recording} activeNodeCount={scope === "full" ? config.fullManifest.neuron_count : graph.nodes.length} datasetLabel={config.datasetLabel} />
        <span className="mof-layout-note">{scope === "full" ? config.activeScopeDescription : `${graph.nodes.length.toLocaleString()}ニューロンを演算中`} · 高次数800ニューロンと実接続を一人称表示 · 位置は飛行用生成レイアウトで、解剖座標ではありません</span>
        <div className="mof-transport">
          <button className="mof-play" onClick={running ? stop : start}>{running ? "■ 停止" : "▶ 再生"}</button>
          {running && <button onClick={async () => { await Tone.start(); setAudioState(Tone.context.state); setStatus(`演奏中 · ${scope === "full" ? `${config.fullManifest.neuron_count.toLocaleString()}ニューロン` : `${graph.nodes.length.toLocaleString()}ニューロン`} · AudioContext ${Tone.context.state}`); }}>↻ 音声再開</button>}
          <button onClick={save}>⇩ 直近8小節 MIDI + JSON</button>
          <button onClick={() => setCinematicStart(performance.now())}>↘ ダイブをプレビュー</button>
          <button className={`mof-record ${recording ? "active" : ""}`} onClick={toggleRecording}>{recording ? `■ 録画停止・MP4保存 ${recordSeconds.toFixed(1)}s` : "● 映像＋音声をMP4録画"}</button>
        </div>
        <p className="mof-record-note">録画範囲はビジュアライザー映像と最終音声ミックスです。開始後7.2秒で全景からニューロン視点へ移行します。</p>
        <div className="mof-meters"><span>活動分散 <b>{metrics.variance.toFixed(5)}</b></span><span>飽和率 <b>{(metrics.saturation * 100).toFixed(2)}%</b></span><span>生成ノート <b>{events.length}</b></span><span>音声 <b>{audioState}</b></span></div>
        <div className="mof-score-state">
          <div><small>HARMONY</small><strong>{musicState.harmony}</strong><span>{musicState.cellName}</span></div>
          <div><small>PHRASE</small><strong>{String(musicState.position + 1).padStart(2, "0")} / 16</strong><span>cycle {musicState.cycle + 1}</span></div>
          <div><small>INTEREST</small><strong>{Math.round((musicState.deviation?.interest || 0) * 100)}%</strong><span>{musicState.deviation?.deviation || "listening"}</span></div>
          <div><small>TIMBRE MORPH</small><strong>{timbreState.label}</strong><span>{Math.round(timbreState.mix * 100)}% · filter {Math.round(timbreState.cutoff)} Hz</span></div>
        </div>
        <div className="mof-address" aria-label="現在のFly address"><span>FLY ADDRESS</span>{musicState.address.map((value, index) => <i key={index} className={index === musicState.position ? "current" : ""}>{value == null ? "·" : value.toString(11).toUpperCase()}</i>)}</div>
      </div>

      <aside className="mof-panel mof-controls">
        <h2>演奏</h2>
        <label>音量 <output>{Math.round(volume * 100)}%</output><input type="range" min="0" max="0.55" step="0.01" value={volume} onChange={(e) => setVolume(+e.target.value)} /></label>
        <label>音の密度 <output>{Math.round(density * 100)}%</output><input type="range" min="0.1" max="0.9" step="0.01" value={density} onChange={(e) => setDensity(+e.target.value)} /></label>
        <label>変化 <output>{Math.round(variation * 100)}%</output><input type="range" min="0" max="1" step="0.01" value={variation} onChange={(e) => setVariation(+e.target.value)} /></label>
        <label>モチーフの回帰 <output>{Math.round(motifReturn * 100)}%</output><input type="range" min="0" max="1" step="0.01" value={motifReturn} onChange={(e) => setMotifReturn(+e.target.value)} /></label>
        <label>飛行速度 <output>{flightSpeed.toFixed(1)}×</output><input type="range" min="0.25" max="3" step="0.05" value={flightSpeed} onChange={(e) => setFlightSpeed(+e.target.value)} /></label>
        <div className="mof-row"><label>Tempo<input type="number" min="48" max="96" value={bpm} onChange={(e) => setBpm(Math.max(48, Math.min(96, +e.target.value || 62)))} /></label><label>Seed<input type="number" value={seed} disabled={running} onChange={(e) => setSeed(+e.target.value || 1)} /></label></div>
        <div className="mof-take"><span>TAKE <b>{takeSeed.toString(36).toUpperCase()}</b></span><button className={takeLocked ? "selected" : ""} onClick={() => setTakeLocked((value) => !value)}>{takeLocked ? "🔒 次回も固定" : "♻ 再生ごとに更新"}</button><button disabled={running} onClick={() => setTakeSeed(freshTakeSeed())}>新しい導入</button></div>
        <div className="mof-deviation"><span>親密度 <b>{Math.round((musicState.deviation?.familiarity || 0) * 100)}</b></span><span>驚き <b>{Math.round((musicState.deviation?.surprise || 0) * 100)}</b></span><span>変化圧 <b>{Math.round((musicState.deviation?.drive || 0) * 100)}</b></span></div>
        <h2>回路比較</h2>
        <div className="mof-segments">{MODES.map(([value, label]) => <button key={value} disabled={running} className={mode === value ? "selected" : ""} onClick={() => { setMode(value); setEvents([]); }}>{value === "flywire" ? config.sourceLabel : label}</button>)}</div>
        <p className="mof-scope">演算範囲: <strong>{scope === "full" ? `${config.allScopeLabel}（既定）` : "部分グラフ"}</strong>{scope !== "full" && <button disabled={running} onClick={() => { setScope("full"); setEvents([]); setStatus(`${config.allScopeLabel}モードに戻しました`); }}>{config.allScopeLabel}へ戻す</button>}</p>
      </aside>
    </section>

    <section className="mof-lower">
      <div className="mof-panel mof-data"><h2>データ来歴</h2><dl><dt>状態</dt><dd><strong>実データ読込済み · {scope === "full" ? config.allScopeLabel : "部分グラフ"}</strong></dd><dt>データ</dt><dd>{(scope === "full" ? config.fullManifest : manifest).dataset_name} · v{(scope === "full" ? config.fullManifest : manifest).dataset_version}</dd><dt>演算グラフ</dt><dd>{(scope === "full" ? config.fullManifest.neuron_count : graph.nodes.length).toLocaleString()} neurons · {(scope === "full" ? config.fullManifest.directed_edge_count : graph.edges.length).toLocaleString()} directed edges</dd><dt>{config.synapseLabel}</dt><dd>{(scope === "full" ? config.fullManifest.source_synapse_count_sum : manifest.synapse_count_sum)?.toLocaleString() || "未記録"}</dd><dt>Graph SHA-256</dt><dd className="mof-hash">{scope === "full" ? config.fullManifest.binary_sha256 : (manifest.graph_sha256 || graph.graph_sha256)}</dd><dt>モデル</dt><dd>leaky tanh · α 0.2 · g {mode === "no-recurrence" ? "0" : "0.9"} · Worker演算</dd></dl><label className="mof-import">部分グラフを読み込む<input type="file" accept="application/json,.json" onChange={(e) => e.target.files[0] && importGraph(e.target.files[0])} /></label></div>
      <div className="mof-panel mof-log"><h2>アンサンブル・イベント</h2>{recentNotes.length ? recentNotes.map((e, i) => <div className="mof-event" key={`${e.absoluteBeat}-${e.role}-${i}`}><b>{midiName(e.midi)}</b><span>{e.role} · neuron {e.neuronIndex >= 0 ? graph.nodes[e.neuronIndex]?.slice(-6) : "—"} · {e.cellName}</span><em style={{ width: `${Math.min(100, Math.abs(e.neuronActivity || 0) * 400)}%` }} /></div>) : <p className="mof-empty">再生すると、発音を選んだ代表ニューロンと4声部がここに現れます。</p>}</div>
    </section>
    <footer>{config.footer}</footer>
  </main>;
}
