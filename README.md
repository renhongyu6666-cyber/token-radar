# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/renhongyu6666-cyber/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/renhongyu6666-cyber/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — a token launch radar for make.fun's token-radar-01 bounty. It reads a sealed DefiLlama snapshot (758 protocols), ranks the protocols that record no token yet by an implied value derived from the snapshot's own figures (TVL, 7-day growth, time running with no token), and ships a sortable, filterable dashboard with a detail view and a farm plan for each protocol. The board covers all 40 watchlist protocols (198 rows); protocols whose token already trades are kept apart as live-token comparables.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22.18+ required, standard library only. The run writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, deterministically — two runs write identical bytes.

## The model

`lib/model.ts` derives every implied value from the snapshot's own figures: base value = TVL × the category median market-cap/TVL ratio of tokened peers (clamped 0.02–2.00), adjusted by 7-day TVL growth (clamped −50%…+100%, factor 1 + change × 0.4) and by longevity (1 + min(age in years, 5) × 0.04). No protocol name is ever special-cased.

## Layout

- `main.ts` — entry point
- `lib/model.ts` — the value model, the board, the farm plans
- `vendor/makefun-board.ts` — the kit's dossier library, verbatim
- `dashboard/` — the static page (index.html, app.css, app.js), no network
- `screenshots/` — the board, a detail view, a filtered view

---

<sub>Entered on [make.fun](https://make.fun/?ref=qx8twn3b&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
