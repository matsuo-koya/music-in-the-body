import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

test("MaleCNS CSR artifact is separate and matches its own manifest", () => {
  const binary = readFileSync(new URL("../public/male-cns-v1.0-full.mofg", import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL("../data/processed/full_data_manifest.json", import.meta.url), "utf8"));
  assert.equal(binary.subarray(0, 8).toString(), "MOFGV001");
  const nodes = binary.readUInt32LE(8), edges = binary.readUInt32LE(12);
  const weightsOffset = binary.readUInt32LE(28);
  assert.equal(nodes, 163997);
  assert.equal(edges, 6236393);
  assert.equal(binary.length, weightsOffset + edges * 4);
  assert.equal(nodes, manifest.neuron_count);
  assert.equal(edges, manifest.directed_edge_count);
  assert.equal(createHash("sha256").update(binary).digest("hex"), manifest.binary_sha256);
});
