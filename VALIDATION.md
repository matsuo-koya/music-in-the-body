# Validation

- Source SHA-256: `5c536423a62a688e59e7b441f9c04d6272c9a1f017e35814cf561f8c275d9e9e`
- Browser CSR: 163,997 bodies, 6,236,393 edges, 51,859,144 bytes
- Browser CSR SHA-256: `0bac7f6b68863ec07af8b0509c82610ba23b9d75b6ffb6941d74807fdaa5e5d9`
- Display subgraph: 991 bodies, 27,142 edges
- Display graph SHA-256: `451835bf71bc28410cba670d3b96b5def604ff5bac5ca517bc3138bcff8c077e`

Run:

```sh
npm test
npm run build
```

Automated checks verify deterministic finite dynamics, bounded history, MIDI generation, four-source timbre morph continuity, sampled-piano focus, take-seed reproducibility, the sensorimotor music profile, and the full CSR artifact hash.

Browser verification loaded all 30 bundled Salamander samples, reported CC BY 3.0 attribution in the UI, played the 163,997-body graph with `AudioContext running`, and switched from fixed sampled piano to the four-source morph while note generation continued without warnings or errors.
