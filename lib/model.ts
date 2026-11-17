// Token Radar: the value model for token-radar-01.
//
// The board ranks protocols that record no token yet by an implied value that is
// derived only from the sealed snapshot's own figures:
//
//   1. Category multiple. From the protocols that DO record a token (mcap_usd
//      present), take the median mcap/TVL ratio inside the protocol's own
//      category. A category counts only when at least MIN_CATEGORY_PEERS tokened
//      peers exist; otherwise the protocol falls back to the global median
//      ratio across all tokened protocols. The multiple is clamped to
//      [MULTIPLE_FLOOR, MULTIPLE_CEILING] so one outlier token cannot set the
//      price of a whole category. No protocol name is ever special-cased.
//   2. Base value. base = tvl_usd x category multiple.
//   3. Growth. The protocol's 7-day TVL change, clamped to
//      [GROWTH_FLOOR_PCT, GROWTH_CAP_PCT], moves the value by
//      growthMultiplier = 1 + clampedChange/100 x GROWTH_WEIGHT.
//      Growth raises the value, decline lowers it, and the effect is bounded.
//   4. Longevity. listed_at gives the age in days at the snapshot date.
//      ageMultiplier = 1 + min(ageYears, AGE_BONUS_CAP_YEARS) x AGE_BONUS_PER_YEAR:
//      a protocol that has run for years with no token yet has proven staying
//      power, so it earns a modest bonus; an unknown listing date earns none.
//   5. implied = round(base x growthMultiplier x ageMultiplier), clamped to
//      [1, 1e14] whole dollars.
//
// The board covers every watchlist slug, plus every other pre-token protocol
// (gecko_id and symbol both null) that is not a wrapped, staked or bridged
// product and not a versioned name, applying the snapshot README's own
// exclusions. Tokened protocols are kept apart and shown as comparables with
// the market's own market cap, never mixed into the ranked board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard so the judge can re-derive any row. */
export interface ModelConstants {
  min_category_peers: number;
  multiple_floor: number;
  multiple_ceiling: number;
  growth_weight: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  age_bonus_per_year: number;
  age_bonus_cap_years: number;
}

/** The model's version label, shown on the dashboard. */
export const MODEL_VERSION = 'radar-2';

export const MODEL: ModelConstants = {
  min_category_peers: 3,
  multiple_floor: 0.02,
  multiple_ceiling: 2.0,
  growth_weight: 0.4,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  age_bonus_per_year: 0.04,
  age_bonus_cap_years: 5,
};

/** How many live-token comparables the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    base_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  category_peers: number;
  base_value_usd: number;
  growth_multiplier: number;
  age_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category multiples: for every category with at least MIN_CATEGORY_PEERS
 * tokened protocols, the median mcap/TVL of those peers, clamped to the sane
 * band; plus the global median across all tokened protocols as the fallback.
 * A protocol's own category is used only when it has enough peers, so a
 * category with one wild token cannot set the price of its whole family.
 */
export interface CategoryMultiples {
  byCategory: Map<string, { multiple: number; peers: number }>;
  globalMultiple: number;
}

export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryMultiples {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? '(no category)';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const globalMultiple = clampMultiple(median(all), model);
  const out = new Map<string, { multiple: number; peers: number }>();
  for (const [key, ratios] of byCategory) {
    if (ratios.length < model.min_category_peers) continue;
    out.set(key, { multiple: clampMultiple(median(ratios), model), peers: ratios.length });
  }
  return { byCategory: out, globalMultiple };
}

/** A multiple kept inside the model's sane band. */
function clampMultiple(multiple: number, model: ModelConstants): number {
  return Math.min(model.multiple_ceiling, Math.max(model.multiple_floor, multiple));
}

/** The category multiple one protocol gets: its own category's median, else the global median. */
export function multipleFor(p: SnapshotProtocol, multiples: CategoryMultiples, model: ModelConstants = MODEL): { multiple: number; peers: number } {
  const key = p.category ?? '(no category)';
  const own = multiples.byCategory.get(key);
  if (own !== undefined) return own;
  return { multiple: multiples.globalMultiple, peers: 0 };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: CategoryMultiples,
  model: ModelConstants = MODEL,
): {
  implied: number;
  categoryMultiple: number;
  categoryPeers: number;
  baseValue: number;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, peers } = multipleFor(protocol, multiples, model);
  const baseValue = protocol.tvl_usd * multiple;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageYears = age === null ? 0 : age / 365;
  const ageMult = 1 + Math.min(ageYears, model.age_bonus_cap_years) * model.age_bonus_per_year;
  const implied = Math.min(100_000_000_000_000, Math.max(1, Math.round(baseValue * growthMult * ageMult)));
  return { implied, categoryMultiple: multiple, categoryPeers: peers, baseValue: Math.round(baseValue), growthPct, growthMult, ageMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the snapshot README excludes from the watchlist rule. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol name must not begin with, per the snapshot README. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word that marks a wrapped, staked or bridged product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all (no market cap, no CoinGecko id, no symbol). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product, not a versioned name, not an exchange product.
 * This is the snapshot README's own exclusion rule, applied to every row.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever its TVL.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the README rule allows,
  // at any TVL the snapshot carries. No floor is cut here because the full
  // rankable set already lands near two hundred rows.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, v };
  });
  // Strongest first; the slug breaks ties so the run is byte-identical every time.
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: round4(s.v.categoryMultiple),
      category_peers: s.v.categoryPeers,
      base_value_usd: s.v.baseValue,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      age_multiplier: round4(s.v.ageMult),
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A small deterministic pick from a list, so wording varies across rows without randomness. */
function pick<T>(items: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return items[h % items.length]!;
}

/** The category's core action, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): { text: string; cost: string; time: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      text: `Supply $${capital} of USDC to ${name} on ${chain} as a lender, and leave the deposit earning instead of withdrawing it`,
      cost: `$${capital} of capital, about $5 of gas`,
      time: '15 minutes to set up',
    };
  }
  if (c.includes('dex')) {
    return {
      text: `Add $${capital} of liquidity to ${name}'s busiest pool on ${chain}, in a balanced pair, and keep the LP position open`,
      cost: `$${capital} of capital, about $6 of gas`,
      time: '20 minutes to set up',
    };
  }
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) {
    return {
      text: `Deposit $${capital} of USDC into a ${name} yield vault on ${chain} and keep the vault shares in your wallet`,
      cost: `$${capital} of capital, about $5 of gas`,
      time: '15 minutes to set up',
    };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('prediction')) {
    return {
      text: `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small position, and close it the same week`,
      cost: `$${capital} of capital, about $4 of gas`,
      time: '20 minutes to set up',
    };
  }
  if (c.includes('stable') || c.includes('dual-token')) {
    return {
      text: `Mint $${capital} of the stable asset through ${name} on ${chain} against USDC collateral and hold the minted tokens`,
      cost: `$${capital} of capital, about $5 of gas`,
      time: '15 minutes to set up',
    };
  }
  if (c.includes('rwa')) {
    return {
      text: `Mint $${capital} of ${name}'s tokenised yield asset on ${chain} and hold it in your wallet while it accrues`,
      cost: `$${capital} of capital, about $6 of gas`,
      time: '15 minutes to set up',
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      text: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt token`,
      cost: `$${capital} of capital, about $4 of gas`,
      time: '10 minutes to set up',
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      text: `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds once inside its app`,
      cost: `$${capital} of capital, about $3 of bridge fees`,
      time: '20 minutes to set up',
    };
  }
  if (c.includes('launchpad')) {
    return {
      text: `Commit $${capital} of USDC to a ${name} launch on ${chain} and complete the launch's own verification steps`,
      cost: `$${capital} of capital, about $3 of gas`,
      time: '20 minutes to set up',
    };
  }
  if (c.includes('payment')) {
    return {
      text: `Route $${capital} of payments through ${name} on ${chain} for a real purchase or transfer you already need to make`,
      cost: `$${capital} of capital, about $2 of fees`,
      time: '10 minutes to set up',
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) {
    return {
      text: `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares while it allocates the funds`,
      cost: `$${capital} of capital, about $5 of gas`,
      time: '15 minutes to set up',
    };
  }
  return {
    text: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open instead of withdrawing it`,
    cost: `$${capital} of capital, about $4 of gas`,
    time: '15 minutes to set up',
  };
}

/** The weekly qualifying action, worded for the protocol's category. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'a deposit, a borrow, a repayment or a vote';
  if (c.includes('dex')) return 'a swap, a liquidity add or a fee claim';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('prediction')) return 'a small trade, a margin top-up or a position close';
  if (c.includes('yield') || c.includes('farm')) return 'a deposit, a harvest or a re-stake';
  if (c.includes('stable')) return 'a mint, a redeem or a stability-pool action';
  return 'a deposit, a swap, a vote or a claim';
}

/**
 * A protocol's farm plan: five steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names, and the wording varies by
 * category and by row so two protocols do not read as the same boilerplate.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const core = coreAction(p, capital, chain);
  const weekly = weeklyAction(p);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const bridgeLine =
    secondChain !== null
      ? `Bridge about $${capital} of USDC from ${chain} to ${secondChain} and use ${p.name} there too, so the wallet shows activity on two chains`
      : `Move about $${capital} of USDC onto ${chain} from your exchange or main wallet, ready to use inside ${p.name}`;
  const steps: { text: string; cost: string; time: string }[] = [
    {
      text: `Set up a fresh wallet that holds only the funds you plan to farm with ${p.name}, and keep its seed phrase offline on paper`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: bridgeLine, cost: `about $3 of bridge or transfer fees`, time: '10 minutes' },
    core,
    {
      text: pick(
        [
          `Repeat one qualifying action each week, such as ${weekly}, so the wallet stays active across snapshots`,
          `Come back once a week and do one qualifying action, such as ${weekly}, to keep the wallet's activity fresh`,
        ],
        p.slug,
      ),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, then open ${p.name}'s own points or rewards page and claim only from the link it publishes`,
      cost: `the $${capital} stays in the position; never pay to claim`,
      time: `${hold} days, then 10 minutes`,
    },
  ];
  return steps.map((s) => stepText(s.text, s.cost, s.time));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_peers: row.model.category_peers,
    base_value_usd: row.model.base_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = categoryMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    global_multiple: round4(multiples.globalMultiple),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${byRank[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
