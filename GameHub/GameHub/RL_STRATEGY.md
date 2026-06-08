# GameHub RL / Auto-Research Strategy

Status: repository cloned at commit `122231014a83a32913d2cc9c1ece818a308262a2`; `npm install && npm run typecheck` passes in `GameHub/GameHub`.

This project already has bots and lightweight CEM training:

- `training/train_skyjo.mjs`: CEM over a 4-parameter Skyjo threshold policy.
- `training/train_flip7.mjs`: CEM over a linear Flip 7 hit/stay policy.
- `public/index.html`: client-side bot driver; server compute stays ~zero.

The next step should not be “just PPO”. These are stochastic, imperfect-information card games, and the current best path is: **build a trustworthy seeded simulator + evaluator, add search/oracle policies, distill them into tiny client policies, and run an Auto-Researcher loop over experiments.**

---

## 1. Design goals

1. **Strong play**, not just pretty training logs.
2. **Observation-correct policies**: bots must train on exactly what they can see in the UI, not hidden deck/board truth unless using sampled beliefs.
3. **Small inference footprint**: policies must run on the host/local browser, ideally under 10–50 ms per move, with no Cloudflare Durable Object compute burden.
4. **Repeatable evaluation**: seeded games, rotated seats, confidence intervals, and a persistent leaderboard.
5. **Game-agnostic research loop**: adding future games should reuse the same eval/training harness.

---

## 2. Immediate technical foundation

### 2.1 Seed everything

Current engines use `Math.random()`. For serious RL/evaluation, add a tiny seeded RNG and pass it through:

- deck shuffles,
- bot exploration,
- rollout sampling,
- evaluation seed batches.

This enables paired comparisons: policy A and B play under identical random game streams with seat rotations, reducing variance dramatically.

### 2.2 Unify engine copies

There are currently multiple copies/versions of logic:

- server TypeScript engines in `src/`,
- client/local engines embedded in `public/index.html`,
- training simulators in `training/*.mjs`.

Long-term, move game logic to shared modules, then bundle or paste generated client code. At minimum, add conformance tests that run the training simulator and server/local engines against identical action traces.

### 2.3 Build an evaluation harness before more training

Add scripts like:

```bash
node research/eval_flip7.mjs --policy hard-v1 --opponents medium,easy,hard-v0 --games 50000 --seats rotate
node research/eval_skyjo.mjs --policy hard-v1 --opponents medium,easy,hard-v0 --games 20000 --players 2,3,4,6,8
```

Outputs should be JSONL plus summary:

- win rate by seat/player-count/opponent mix,
- mean score margin,
- standard error / 95% CI,
- average decision latency,
- bundle-size impact,
- illegal/no-op action count.

Use Elo/TrueSkill-style ratings for the bot population, not only one-off win rates.

---

## 3. Key issue in current training

### Flip 7 train/test mismatch

`training/flip7_sim.mjs` uses `sim.bustProb(pi)`, which sees the true remaining deck. The client bot estimates bust probability from visible cards and `deckCount` only. That means the learned weights partly train on privileged information.

Fix: train with an **observation feature extractor** matching `public/index.html`, or use belief sampling:

1. construct the set of possible unseen cards,
2. sample many deck completions consistent with visible information,
3. estimate bust probability / EV from that posterior.

### Skyjo current policy is too low-dimensional

Skyjo hard currently uses only:

```js
[thrTakeDiscard, thrBeat, thrSwapMargin, thrLockLow]
```

It ignores many important features:

- column/triplet potential,
- hidden-card posterior,
- deck/discard composition,
- game score and endgame risk,
- opponent board states,
- whether revealing more cards could trigger final turns,
- the value of ending the round vs delaying.

The result can beat weak bots, but it leaves a lot of strength on the table.

---

## 4. Algorithm ladder: strongest practical path

### Stage A — Baselines and exact calculators

Do this first because it gives interpretable targets and catches simulator bugs.

#### Flip 7

Build exact / semi-exact expected value calculators for:

- hit vs stay,
- action target choice (`freeze`, `flip3`, duplicate `second`),
- game-context EV, not only current-round EV.

Because Flip 7 is mostly public and action space is tiny, a rollout/expectimax policy can be very strong.

Recommended decision objective:

```text
choose action maximizing estimated P(win game) or tournament utility,
not merely expected round points.
```

Include:

- current banked scores,
- distance to 200,
- opponents’ live scores,
- turn order,
- second-chance status,
- active/stayed/busted states,
- risk of giving an opponent points through Flip Three.

#### Skyjo

Build a belief-based evaluator:

- sample hidden own/opponent cards and deck order from remaining card multiset,
- simulate candidate actions with rollouts,
- use common random samples across candidate actions to reduce variance.

The search policy can be slow offline; later distill it into a compact browser policy.

---

### Stage B — Search policies as teachers

For each legal move, run N sampled futures and score action value.

#### Flip 7 search

- 100–2,000 rollouts is probably enough offline.
- Browser hard bot can use a smaller budget, e.g. 50–200 rollouts or a pre-distilled policy.
- Action space is tiny: `hit/stay` or a target index.

#### Skyjo search

Action space varies:

- reveal one of hidden cards,
- take discard vs draw deck,
- swap into revealed or hidden card,
- discard drawn and reveal a hidden card.

Use progressive widening / candidate pruning:

- Always consider swapping into worst revealed card.
- Consider hidden swap/reveal targets by column priority, not all equivalent random cells.
- Consider triplet-building/clearing moves explicitly.
- Consider endgame risk when hidden count is small.

---

### Stage C — Distill search into tiny policies

Once search/oracle policies are strong, generate millions of `(observation, action/value)` examples and train compact policies:

- linear / logistic models for Flip 7,
- small MLP or gradient-boosted decision tree for Skyjo,
- or hand-designed feature model optimized by CEM/CMA-ES/PBT.

Export to JSON weights, like existing `flip7_weights.json` and `skyjo_params.json`.

For the browser:

- prefer a tiny JS evaluator,
- optionally use a Web Worker for hard bot search so UI animations do not stutter,
- keep a fallback heuristic if decision budget expires.

---

### Stage D — Self-play / population training

Only after the evaluator is solid, add true self-play.

Good candidates:

1. **CMA-ES / CEM over feature policies**  
   Best first choice: robust, simple, works well for card-game bots with engineered features.

2. **Population-Based Training (PBT)**  
   Keep a population of policies and mutate hyperparameters/weights. Evaluate against a historical league to avoid overfitting to one opponent.

3. **PSRO / NFSP-style league**  
   For multi-agent imperfect-information games, train approximate best responses against a meta-strategy over prior policies.

4. **PPO/A2C**  
   Useful only after you have a vectorized simulator and correct observation encoding. It is likely overkill as the first move, especially for browser-sized bots.

---

## 5. Game-specific plan

## 5.1 Flip 7

### Current bot weaknesses

- Trained on true deck bust probability but deployed with estimated bust probability.
- Hit/stay policy ignores many game-level signals.
- Targeting actions are heuristic-only.
- Fitness is mostly seat-0 win rate vs fixed opponents; this can overfit.

### Stronger feature set

For hit/stay:

```text
bias
estimated bust probability
live score
unique count
has second chance
banked score
points to 200
leader distance
best opponent banked
best opponent live
active player count
stayed player count
turn order position
expected value of stay now
posterior expected value of next hit
risk × live score
risk × distance-to-win
```

For target selection:

```text
target live score
target banked score
target unique count
target bust probability
target has second chance
is target close to 200
expected Δ win probability if frozen / flip3'd / given second
```

### Best policy architecture

1. Bayesian posterior over unseen cards.
2. Rollout evaluator for `hit/stay` and target actions.
3. Distill to:
   - logistic hit/stay model,
   - target scorer model per action card.
4. Browser hard bot optionally runs a small rollout if `deckCount` is low or decision is close.

---

## 5.2 Skyjo

### Current bot weaknesses

- Initial reveals are random.
- Hidden target choices are mostly random.
- Triplet/column structure is not strategically modeled.
- Policy ignores opponent/endgame context.
- Only four parameters control all phases.

### Stronger feature set

Board features:

```text
revealed values by 3x4 position
hidden count
cleared count
current visible score
worst revealed value and position
second/third worst values
column value pairs
triplet-completion opportunities
risk of revealing final hidden card
```

Card-count/belief features:

```text
remaining multiset estimate
posterior mean hidden card value
posterior low-card probability
posterior pair/triplet probability per column
discard top value
deck count / discard count
```

Game context:

```text
round number
total scores
score distance to leader
opponent visible scores/opponent hidden counts
is someone near ending the round
expected penalty if this player ends round and fails to be lowest
```

### Best policy architecture

1. Belief sampler from visible state.
2. Move generator with column-aware candidate actions.
3. Rollout/value search for candidate actions.
4. Distill into a small model:
   - action-type scorer: take discard/draw, swap/discard, reveal target,
   - cell scorer: revealed/hidden placement/reveal priorities.

For browser hard bot, use:

- distilled scorer by default,
- 20–100 rollout tie-breaker for close decisions if latency allows.

---

## 6. Auto-Researcher loop

A Karpathy-style auto-researcher should not directly “play the game”. It should orchestrate experiments, read results, propose code/config changes, and maintain a leaderboard.

### Directory layout

```text
research/
  README.md
  ideas.md
  leaderboard.json
  runs/
    2026-06-07T...jsonl
  configs/
    flip7_baseline.json
    skyjo_search_teacher.json
  eval_flip7.mjs
  eval_skyjo.mjs
  train_flip7_policy.mjs
  train_skyjo_policy.mjs
  autoresearch.mjs
```

### Loop

1. **Hypothesis**  
   Example: “Adding banked-score features improves Flip 7 win rate at 4 players.”

2. **Patch/config generation**  
   Generate a small experiment config or a code diff.

3. **Run**  
   Execute seeded training/evaluation.

4. **Parse**  
   Collect JSON metrics, confidence intervals, and regression checks.

5. **Judge**  
   Promote only if statistically significant and no latency/bundle regression.

6. **Summarize**  
   Append notes to `research/ideas.md` and update `leaderboard.json`.

### Promotion rule

A new hard policy is promoted only if it beats current hard by e.g.:

```text
+3% absolute win rate in 4-player mixed pool
and non-negative in 2p/3p/6p/8p tests
and no statistically significant drop vs medium/easy
and p95 decision latency < budget
```

---

## 7. Concrete next sprint

1. Add seedable RNG and deterministic shuffle to training simulators.
2. Add `research/eval_*.mjs` with seat rotation and JSONL output.
3. Fix Flip 7 train/deploy mismatch by training on observation-correct features.
4. Expand Flip 7 features with banked/opponent context and train target-selection scorers.
5. Implement Skyjo candidate move generator + card-counting features.
6. Build first rollout teacher for Skyjo and compare it against current hard.
7. Distill improved policies into JSON and wire them into `public/index.html`.

---

## 8. Recommended first implementation order

Highest ROI order:

1. **Evaluation harness** — without this, every claimed improvement is noisy.
2. **Flip 7 observation-correct retraining** — fast and likely immediate improvement.
3. **Flip 7 target policy** — small action space, large tactical impact.
4. **Skyjo feature expansion** — medium work, likely big improvement.
5. **Skyjo rollout teacher** — high upside but more complex.
6. **Auto-Researcher wrapper** — useful after reliable eval/training scripts exist.

The repo is already in good shape for this: bots are client-side, training is isolated, and policies are compact JSON/JS constants. The main missing piece is rigorous seeded research infrastructure.
