# GameHub Bot Research Process — Final Kept Summary

Date: 2026-06-07

This file replaces the many raw experiment logs that were generated during research. The raw logs/candidates were useful during search, but the repo now keeps only the production policies, compact repro/eval scripts, and this process summary.

## Final production hard bots

Build in `public/index.html`:

```text
v15-skyjo-bucketed-polish
```

### Flip 7 hard

Final policy:

```text
uploaded exact-EV/card-counting hit-stay
+ our threat action-card targeting
```

Production params:

```text
training/flip7_ev_params.json
```

```json
{
  "n2": [-0.0164, 0.0027, 0.0493, 3.4614],
  "n4": [-0.0197, 0.0375, 0.1339, 3.5668],
  "n6": [-0.1253, 0.0464, 0.0475, 5.2227]
}
```

Why this won:

- Uploaded EV/card-counting hit-stay was slightly stronger than our learned linear V2 hit/stay.
- Our threat target logic was stronger than uploaded target logic.
- The fusion was best: EV hit-stay + threat targeting.

Final eval snapshot:

| Players | EV + threat | Previous V2 + threat | Result |
|---:|---:|---:|---|
| 2 | 50.75% | 49.25% | small gain |
| 4 | 31.43% | 30.85% | small gain |
| 6 | 22.59% | 22.28% | small gain |
| 8 | 18.66% | 17.29% | gain |

### Skyjo hard

Final policy:

```text
solo-inspired board-efficiency / reveal-geometry / triplet policy
```

Production params:

```text
training/skyjo_solo_params.json
```

```json
{
  "n4": [2.427,3.157,3.55,1.873,4.354,3.155,1.87,3.686,1.634,2.64,0.818,7.501],
  "n6": [2.425,3.413,3.211,1.995,3.733,3.335,0.798,3.036,1.283,2.688,0.645,8.273]
}
```

The client uses `n4` for 2–4 players and `n6` for 5+ players.

Param layout:

```text
[lowKeep,takeScore,beatWorst,deckSwapScore,tripletW,pairW,hiddenPenalty,
 revealSpreadW,revealHighW,revealPairPenalty,turnPenalty,highDiscard]
```

Final eval snapshot vs previous uploaded-v3 production policy:

| Players | New solo-polished | Previous prod v3 | Result |
|---:|---:|---:|---|
| 2 | 58.63% (`n4`) | 41.38% | big gain |
| 4 | 49.54% (`n4`) | 29.33% | huge gain |
| 6 | 40.88% (`n6`) | 22.18% | huge gain |
| 8 | 26–27% (`n4`/`n6`) | ~16–18% | huge gain |

Note: these evals include fillers such as medium/easy where relevant; see previous commits if raw logs are needed.

---

## What was tried and what happened

### Flip 7

1. **Original CEM linear hard**
   - Good baseline, but only modestly better than heuristic medium.
   - Learned 7-feature hit/stay policy was not enough.

2. **Observation-correct retraining**
   - Fixed a train/deploy mismatch where training used true deck bust probability but browser only had visible estimates.
   - Small CEM runs did not beat current hard.

3. **V2 context features**
   - Added banked score, distance to 200, leader gap, active/stayed counts, etc.
   - Helped, but gains were modest.

4. **Threat action targeting**
   - Major deployable improvement.
   - Key insight: Freeze should usually deny future upside while locking a low score, not freeze someone already sitting on a high live score.

5. **Target rollout oracle**
   - Huge research-only upper bound: target choices can be much better if we know/simulate futures.
   - Hidden-state oracle was not deployable because it sees true deck order.
   - Belief rollout variants were positive but did not beat hand threat targeting.

6. **1M full-game CEM**
   - Found modest 3/4-player win-rate gains but worsened margin and 2p robustness.
   - Not promoted.

7. **Margin-regularized CEM**
   - Improved score margin, tiny win-rate gain.
   - Not promoted.

8. **Fresh win/loss-only parallel league CEM**
   - Learned nontrivial play from scratch.
   - Did not beat engineered production policy in multiplayer pools.
   - Conclusion: pure fresh RL needs much more compute or better structure.

9. **Uploaded EV hit-stay + threat targeting**
   - Best final result.
   - Promoted.

### Skyjo

1. **Original 4-threshold policy**
   - Decent but saturated.
   - More CEM over only 4 params did not produce reliable gains.

2. **Skyjo V2 column/triplet/end-risk policy**
   - First major improvement over threshold policy.
   - Promoted temporarily.

3. **Uploaded strategy policy**
   - Strong in multiplayer, especially 4p/6p/8p.
   - Promoted temporarily as v3.

4. **Solo board-efficiency pretraining**
   - Validated the user's hypothesis.
   - Even solo-only board-efficiency training transferred strongly to multiplayer.

5. **Solo-inspired multiplayer policy**
   - Added explicit features for low cards, high discard discipline, reveal geometry, triplet opportunities, and unsafe close penalty.
   - Direct multiplayer tuning over these features became the strongest Skyjo bot.

6. **Polish runs from current solo policy**
   - Further improved the solo-inspired policy.
   - Separate polish runs found that 2–4p and 5+p prefer slightly different risk/tempo settings.
   - Promoted as final v15 bucketed policy.

---

## Algorithmic insights: how to get good at Skyjo

1. **Low cards are the foundation.**
   - Take and keep low cards aggressively.
   - High cards should usually be discarded unless they complete valuable structure.

2. **Reveal geometry matters.**
   - Revealing across columns early is strong because it creates information and triplet anchors.
   - Do not just reveal random hidden cards.

3. **Triplet opportunities are real value.**
   - A single revealed medium card can be useful as an anchor.
   - Two matching revealed cards in a column are a high-value opportunity.
   - But do not clear negative/very low columns blindly: clearing low/negative cards can be bad.

4. **High-card discard discipline wins.**
   - If a drawn card is high and does not complete a useful triplet, discard it and reveal.

5. **Closing is dangerous.**
   - Filling/revealing your last hidden card is only good if your board is actually ahead.
   - Unsafe closes can trigger the doubling penalty and lose games.

6. **Board efficiency transfers to multiplayer.**
   - Solo training worked because the core Skyjo skill is building a low, flexible board quickly.

7. **Next-level multiplayer concept:** directional opponents.
   - Previous player matters because they feed your discard pile.
   - Next player matters because they can take your discard.
   - Other players mostly matter through visible score and hidden-card count / closing pressure.

---

## Flip 7: where the best bot usually stops

The final Flip 7 hard bot uses card-counting EV, so it does not have a single fixed stop value. Still, in simulations, the practical stop/bank values are roughly:

| Players | Median stay value | Mean stay value | Typical stop band |
|---:|---:|---:|---|
| 2 | ~29 | ~30.5 | 26–32 |
| 4 | ~30 | ~32.4 | 27–34 |
| 6 | ~36 | ~39.0 | 32–41 |
| 8 | ~37 | ~39.5 | 33–42 |

Rule of thumb without card counting:

```text
2p/4p: consider banking around 28–33 live points unless very safe/behind.
6p/8p: you often need to push closer to 35–42 because someone else may spike.
```

Modifiers matter:

- `x2` makes lower number sums worth banking.
- Second Chance raises the hit threshold a lot.
- If you are behind near 200, push more.
- If you are safely ahead and opponents cannot catch, bank earlier.

---

## Remaining research ideas, not kept as production

1. **Flip 7 public-memory target micro-rollout**
   - Potentially large upside, but current deployable belief rollout did not beat hand threat.

2. **Skyjo directional opponent features**
   - Likely next major Skyjo gain.
   - Model previous player's likely discard and next player's discard benefit.

3. **Room-size-specific Flip 7 policies**
   - Some candidates were better in 4p but worse in 2p.
   - Could be useful later, but final EV hybrid was robust enough to keep simple.
