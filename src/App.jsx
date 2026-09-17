import React from "react";
import ConnectomeInstrument from "./ConnectomeInstrument.jsx";
import graph from "../data/processed/male_cns_v1_subgraph.json";
import manifest from "../data/processed/data_manifest.json";
import fullManifest from "../data/processed/full_data_manifest.json";
import "./styles/male-cns.css";

const base = import.meta.env.BASE_URL;

const instrument = {
  id: "male-cns", className: "mcns-shell", title: "MaleCNS — Music in the Body",
  kicker: "WHOLE-CNS INSTRUMENT · BRAIN ↕ BODY",
  tagline: "ショウジョウバエのオスの脳と腹側神経索。その往復から、終わらない身体の音楽をつくる。",
  graph, manifest, fullManifest,
  binaryUrl: `${base}male-cns-v1.0-full.mofg`, defaultSeed: 100,
  datasetLabel: "MALECNS v1.0 · MALE WHOLE CNS", sourceLabel: "MaleCNS",
  allScopeLabel: "有意body全体", activeScopeDescription: "接続表の全163,997 endpoint bodyを演算中",
  preset: "Brain ↕ Body: Perpetual Gait", fileSlug: "male-cns-music-in-the-body",
  profile: "sensorimotor", defaultBpm: 68, defaultDensity: 0.58,
  synapseLabel: "採用シナプス（weight ≥ 5）",
  sampleBaseUrl: `${base}salamander/`,
  footer: "モデル活動とbody-pulseは実測された発火・運動ではありません。MaleCNSの実接続を用いた人工的な動的ネットワークと音楽的解釈です。Janelia/FlyEMによる推奨・公認を意味しません。",
};

export default function App() {
  return <ConnectomeInstrument instrument={instrument} />;
}
