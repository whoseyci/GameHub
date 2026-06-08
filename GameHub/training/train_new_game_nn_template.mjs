#!/usr/bin/env node
// Template for training a small neural-net bot for a new game.
//
// Copy this file to train_<game>_nn.mjs, import your simulator, and implement:
//   encode(viewOrState) -> number[]
//   decode(logits, legalActions) -> action
//   playMatch(policyNet) -> numeric score

import { writeFileSync } from 'node:fs';
import { argmax, createMlp, createRng, forward, trainEvolution } from './nn.mjs';

const INPUTS = 8;   // TODO: feature count from encode(...)
const HIDDEN = 16;  // small enough to paste into the browser/client bot module if needed
const OUTPUTS = 4;  // TODO: action logits

function encode(/* state, seat */) {
  // TODO: return normalized numbers, usually in [-1, 1] or [0, 1].
  return Array(INPUTS).fill(0);
}

function chooseAction(net, state, seat, legalActions) {
  const logits = forward(net, encode(state, seat));
  const ranked = logits.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
  for (const r of ranked) if (legalActions[r.i]) return legalActions[r.i];
  return legalActions[argmax(legalActions.map((_, i) => logits[i] ?? -Infinity))] ?? legalActions[0];
}

async function playMatch(net) {
  // TODO: run deterministic simulated games vs baseline bots.
  // Return higher-is-better score, e.g. win rate * 1000 + score differential.
  void chooseAction;
  return Math.random();
}

const rng = createRng(42);
const base = createMlp([INPUTS, HIDDEN, OUTPUTS], rng, 0.35);
const result = await trainEvolution({
  base,
  evaluate: async (net) => {
    let total = 0;
    for (let i = 0; i < 24; i++) total += await playMatch(net);
    return total / 24;
  },
  generations: 40,
  population: 32,
  elite: 6,
  sigma: 0.20,
  seed: 123,
  onGeneration: ({ gen, bestScore, genBest }) => console.log(`gen=${gen} genBest=${genBest.toFixed(4)} best=${bestScore.toFixed(4)}`),
});

writeFileSync('training/new_game_nn_policy.json', JSON.stringify(result.net));
console.log('saved training/new_game_nn_policy.json');
