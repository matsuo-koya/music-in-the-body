# MaleCNS — Music in the Body

[Open the instrument](https://matsuo-koya.github.io/music-in-the-body/)

MaleCNS v1.0の実接続構造から、停止するまで演奏を続けるブラウザ音楽作品です。オスのショウジョウバエの脳と腹側神経索を一つの人工的な動的ネットワークとして動かし、サティ、アンビエント、ミニマルの文法を通して和声、モチーフ、粒子音、身体パルスへ読み出します。

## Features

- MaleCNS v1.0の163,997 endpoint bodiesと6,236,393 directed edgesをWeb Workerで演算
- 3Dニューロン空間を一人称視点で飛行
- 発音、モデル活動、接続上の光パルスを同期
- Felt / Glass / Air / Salamander Grand Piano間の連続モーフィング
- 無限サティ機関と同じ、中核10音を先に読み残り20音を演奏中に追加するサンプル読込
- 4音源モーフとサンプリングピアノ固定を演奏中に切り替え
- 毎回変化し、seedを固定すると再現できる導入
- 映像と最終音声ミックスのMP4録画
- 直近8小節のMIDIと再現条件JSONを保存
- 実接続、配線組み替え、再帰なしの比較

## Run locally

```sh
npm install
npm run dev
```

## Data and scientific scope

Source: [MaleCNS v1.0 download](https://male-cns.janelia.org/download/), `connectome-weights-male-cns-v1.0-minconf-0.5-significant-only.feather`.

The browser artifact retains connections with weight ≥ 5 and excludes self-connections. Exact provenance, transforms, counts, and SHA-256 values are stored in `data/processed/`.

Measured data consists of wiring and connection weights. Network dynamics, external input, visual pulses, `body-pulse`, harmony, rhythm, and timbre mapping are artificial. They are not recordings of neural firing or behavior. Display positions are a deterministic performance layout, not anatomical coordinates. Current readout groups are deterministic body-ID partitions rather than anatomical brain/VNC classes.

MaleCNS data is CC BY 4.0. Salamander Grand Piano V3 samples are by Alexander Holm and distributed under CC BY 3.0. See [ATTRIBUTION.md](ATTRIBUTION.md), [DATA_LICENSE.md](DATA_LICENSE.md), and `public/salamander/CREDITS.txt`. No endorsement by MaleCNS, FlyEM, HHMI Janelia, or the dataset authors is implied.
