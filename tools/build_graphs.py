#!/usr/bin/env python3
"""Build the independent MaleCNS browser graphs from the official flat connectome.

Input is Janelia's MaleCNS v1.0 significant-body Feather table.  The browser
binary uses the same small CSR container as Music on the Fly, but provenance,
thresholding, outputs, and manifests remain separate from the FAFB instrument.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyarrow.compute as pc
import pyarrow.feather as feather

MAGIC = b"MOFGV001"
HEADER_SIZE = 32
SOURCE_URL = (
    "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/"
    "flat-connectome/connectome-weights-male-cns-v1.0-minconf-0.5-"
    "significant-only.feather"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def largest_scc(nodes: set[int], edge_pairs: list[tuple[int, int, int]]) -> set[int]:
    outgoing = {node: [] for node in nodes}
    incoming = {node: [] for node in nodes}
    for source, target, _ in edge_pairs:
        outgoing[source].append(target)
        incoming[target].append(source)
    seen, order = set(), []
    for start in sorted(nodes):
        if start in seen:
            continue
        seen.add(start)
        stack = [(start, 0)]
        while stack:
            node, offset = stack[-1]
            if offset < len(outgoing[node]):
                nxt = outgoing[node][offset]
                stack[-1] = (node, offset + 1)
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append((nxt, 0))
            else:
                order.append(node)
                stack.pop()
    seen.clear()
    components = []
    for start in reversed(order):
        if start in seen:
            continue
        component, stack = {start}, [start]
        seen.add(start)
        while stack:
            node = stack.pop()
            for nxt in incoming[node]:
                if nxt not in seen:
                    seen.add(nxt)
                    component.add(nxt)
                    stack.append(nxt)
        components.append(component)
    return max(components, key=lambda value: (len(value), -min(value)))


def build(args):
    source = args.source
    table = feather.read_table(source, columns=["body_pre", "body_post", "weight"], memory_map=True)
    source_rows = table.num_rows
    selected = table.filter(pc.greater_equal(table["weight"], args.min_weight))
    selected = selected.filter(pc.not_equal(selected["body_pre"], selected["body_post"]))
    pre = selected["body_pre"].combine_chunks().to_numpy(zero_copy_only=False).astype(np.int64, copy=False)
    post = selected["body_post"].combine_chunks().to_numpy(zero_copy_only=False).astype(np.int64, copy=False)
    synapses = selected["weight"].combine_chunks().to_numpy(zero_copy_only=False).astype(np.int64, copy=False)

    nodes = np.unique(np.concatenate((pre, post)))
    pre_index = np.searchsorted(nodes, pre).astype(np.uint32)
    post_index = np.searchsorted(nodes, post).astype(np.uint32)
    order = np.lexsort((pre_index, post_index))
    pre_index, post_index, synapses = pre_index[order], post_index[order], synapses[order]
    counts = np.bincount(post_index, minlength=len(nodes)).astype(np.uint32)
    offsets = np.empty(len(nodes) + 1, dtype=np.uint32)
    offsets[0] = 0
    np.cumsum(counts, dtype=np.uint32, out=offsets[1:])
    roots = np.sqrt(synapses.astype(np.float64))
    denominators = np.bincount(post_index, weights=roots, minlength=len(nodes))
    weights = (roots / denominators[post_index]).astype(np.float32)

    args.binary.parent.mkdir(parents=True, exist_ok=True)
    ids_offset = HEADER_SIZE
    offsets_offset = ids_offset + len(nodes) * 8
    sources_offset = offsets_offset + len(offsets) * 4
    weights_offset = sources_offset + len(pre_index) * 4
    with args.binary.open("wb") as handle:
        handle.write(struct.pack("<8sIIIIII", MAGIC, len(nodes), len(pre_index), ids_offset,
                                 offsets_offset, sources_offset, weights_offset))
        handle.write(nodes.astype("<u8", copy=False).tobytes())
        handle.write(offsets.astype("<u4", copy=False).tobytes())
        handle.write(pre_index.astype("<u4", copy=False).tobytes())
        handle.write(weights.astype("<f4", copy=False).tobytes())

    degree = np.bincount(pre_index, weights=synapses, minlength=len(nodes))
    degree += np.bincount(post_index, weights=synapses, minlength=len(nodes))
    candidate_indices = np.argsort(-degree, kind="stable")[:args.candidates]
    candidate_mask = np.zeros(len(nodes), dtype=bool)
    candidate_mask[candidate_indices] = True
    visual_mask = candidate_mask[pre_index] & candidate_mask[post_index]
    visual_edges = [(int(nodes[s]), int(nodes[t]), int(w)) for s, t, w in
                    zip(pre_index[visual_mask], post_index[visual_mask], synapses[visual_mask])]
    recurrent = largest_scc(set(map(int, nodes[candidate_indices])), visual_edges)
    ranked = sorted(recurrent, key=lambda body: (-degree[np.searchsorted(nodes, body)], body))[:args.visual_nodes]
    ranked_set = set(ranked)
    chosen = largest_scc(ranked_set, [edge for edge in visual_edges if edge[0] in ranked_set and edge[1] in ranked_set])
    visual_edges = [edge for edge in visual_edges if edge[0] in chosen and edge[1] in chosen]
    visual_edges.sort()
    graph = {
        "format": "music-on-the-fly-graph", "version": 1, "dataset": "MaleCNS v1.0",
        "nodes": [str(body) for body in sorted(chosen)],
        "edges": [{"source": str(s), "target": str(t), "synapse_count": w} for s, t, w in visual_edges],
    }
    canonical = json.dumps(graph, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    graph["graph_sha256"] = hashlib.sha256(canonical).hexdigest()
    args.graph.parent.mkdir(parents=True, exist_ok=True)
    args.graph.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    built_at = datetime.now(timezone.utc).isoformat()
    common = {
        "dataset_name": "Janelia MaleCNS connectome connectivity",
        "dataset_version": "1.0",
        "source_page_url": "https://male-cns.janelia.org/download/",
        "source_download_url": SOURCE_URL,
        "source_file_name": source.name,
        "source_size_bytes": source.stat().st_size,
        "source_sha256": sha256(source),
        "source_row_count": source_rows,
        "minimum_synapse_weight": args.min_weight,
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "MaleCNS / FlyEM at HHMI Janelia; Berg et al. (2026)",
        "built_at": built_at,
    }
    manifest = {
        **common, "format": "music-on-the-fly-csr", "format_version": 1,
        "selection_method": "significant-only bodies; weight >= 5; self-connections excluded",
        "source_synapse_count_sum": int(synapses.sum()),
        "neuron_count": len(nodes), "directed_edge_count": len(pre_index),
        "weight_transform": "sqrt(weight), normalized by target incoming sum",
        "binary_file_name": args.binary.name, "binary_size_bytes": args.binary.stat().st_size,
        "binary_sha256": sha256(args.binary),
    }
    subgraph_manifest = {
        **common,
        "selection_method": "top weighted-degree candidates, largest SCC, degree clip, SCC recheck",
        "selection_parameters": {"target_nodes": args.visual_nodes, "candidate_nodes": args.candidates},
        "neuron_count": len(graph["nodes"]), "directed_edge_count": len(graph["edges"]),
        "synapse_count_sum": sum(edge[2] for edge in visual_edges),
        "weight_transform": "sqrt(weight), normalized by target incoming sum at runtime",
        "graph_sha256": graph["graph_sha256"],
    }
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.graph_manifest.write_text(json.dumps(subgraph_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--min-weight", type=int, default=5)
    parser.add_argument("--visual-nodes", type=int, default=1000)
    parser.add_argument("--candidates", type=int, default=2500)
    parser.add_argument("--binary", type=Path, default=Path("public/male-cns/male-cns-v1.0-full.mofg"))
    parser.add_argument("--manifest", type=Path, default=Path("music-on-the-fly-male-cns/data/processed/full_data_manifest.json"))
    parser.add_argument("--graph", type=Path, default=Path("music-on-the-fly-male-cns/data/processed/male_cns_v1_subgraph.json"))
    parser.add_argument("--graph-manifest", type=Path, default=Path("music-on-the-fly-male-cns/data/processed/data_manifest.json"))
    args = parser.parse_args()
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    build(args)


if __name__ == "__main__":
    main()
