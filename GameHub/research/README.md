# GameHub Bot Research

The raw experiment logs and rejected candidates were removed to keep the repository lean.

Kept files:

- `RESEARCH_PROCESS.md` — full process summary, what worked/failed, final insights.
- `leaderboard.json` — compact record of final promoted policies and notable candidates.
- `eval_flip7_hybrid.mjs` — small eval harness for Flip 7 EV+threat hard bot.
- `eval_skyjo_solo_candidate.mjs` — eval harness for the final Skyjo solo-inspired policy.

Final production hard bots are wired directly in `public/index.html`:

- Flip 7: EV/card-counting hit-stay + threat targeting.
- Skyjo: solo-inspired board-efficiency / reveal-geometry / triplet policy.

Final params are kept in:

- `training/flip7_ev_params.json`
- `training/skyjo_solo_params.json`
