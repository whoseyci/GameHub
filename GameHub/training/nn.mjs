// nn.mjs — tiny dependency-free neural net utilities for lightweight bot policies.
// Designed for evolutionary/CEM training in Node, not backprop-heavy ML.

export function createRng(seed = 123456789) {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMlp(sizes, rng = Math.random, scale = 0.5) {
  const layers = [];
  for (let l = 0; l < sizes.length - 1; l++) {
    const input = sizes[l], output = sizes[l + 1];
    layers.push({
      w: Array.from({ length: output }, () => Array.from({ length: input }, () => (rng() * 2 - 1) * scale)),
      b: Array.from({ length: output }, () => (rng() * 2 - 1) * scale),
    });
  }
  return { sizes, layers };
}

export function forward(net, input) {
  let a = input.slice();
  for (let l = 0; l < net.layers.length; l++) {
    const layer = net.layers[l];
    const last = l === net.layers.length - 1;
    a = layer.w.map((row, i) => {
      let z = layer.b[i];
      for (let j = 0; j < row.length; j++) z += row[j] * a[j];
      return last ? z : Math.tanh(z);
    });
  }
  return a;
}

export function argmax(xs) {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}

export function cloneNet(net) {
  return JSON.parse(JSON.stringify(net));
}

function gaussian(rng) {
  const u = Math.max(1e-12, rng());
  const v = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function mutateNet(net, rng = Math.random, sigma = 0.1) {
  const out = cloneNet(net);
  for (const layer of out.layers) {
    for (const row of layer.w) for (let i = 0; i < row.length; i++) row[i] += gaussian(rng) * sigma;
    for (let i = 0; i < layer.b.length; i++) layer.b[i] += gaussian(rng) * sigma;
  }
  return out;
}

export async function trainEvolution({
  base,
  evaluate,
  generations = 50,
  population = 32,
  elite = 6,
  sigma = 0.25,
  seed = 1,
  onGeneration = () => {},
}) {
  const rng = createRng(seed);
  let best = cloneNet(base);
  let bestScore = -Infinity;

  for (let gen = 1; gen <= generations; gen++) {
    const candidates = [best];
    while (candidates.length < population) candidates.push(mutateNet(best, rng, sigma));
    const scored = [];
    for (const net of candidates) scored.push({ net, score: await evaluate(net) });
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].score > bestScore) { bestScore = scored[0].score; best = cloneNet(scored[0].net); }

    // Recenter around a simple average of elites.
    const elites = scored.slice(0, elite);
    best = averageNets(elites.map((x) => x.net));
    if (scored[0].score > bestScore) bestScore = scored[0].score;
    onGeneration({ gen, bestScore, genBest: scored[0].score, sigma });
    sigma *= 0.98;
  }
  return { net: best, score: bestScore };
}

export function averageNets(nets) {
  const out = cloneNet(nets[0]);
  for (const layer of out.layers) {
    for (const row of layer.w) row.fill(0);
    layer.b.fill(0);
  }
  for (const net of nets) {
    for (let l = 0; l < out.layers.length; l++) {
      for (let i = 0; i < out.layers[l].w.length; i++) {
        for (let j = 0; j < out.layers[l].w[i].length; j++) out.layers[l].w[i][j] += net.layers[l].w[i][j] / nets.length;
        out.layers[l].b[i] += net.layers[l].b[i] / nets.length;
      }
    }
  }
  return out;
}
