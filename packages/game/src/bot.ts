/**
 * 遥远之地的人机（「普通」难度，规则书 §9.7）。
 *
 * 输入只能是这个座位视角（redactGameForViewer 之后）的状态：别人的手牌、没翻开的牌、抽到的圣所它都看不到。
 * 「没见过的牌」= 68 张里去掉自己的手牌、所有人的出牌区、公共牌、移出的牌；圣所同理。
 *
 * 思路（大白话）：
 * - 估终局分：把「以后还会打出的牌」接在出牌区右边一起倒序计分。以后会打的 = 手里留下的牌 + 这一轮要挑的公共牌，
 *   不够 8 张的用没见过的牌随机补（代表以后挑来的牌），以后还会拿到的圣所也随机补几张（按以后还能发现几次估）。
 *   手里的牌按「要资源的放左边、给资源的放右边」排。抽几十个这样的「可能的未来」取平均。
 * - 出牌：对每张手牌各估一次（同一批随机未来共用，公平比较）。这张打出去以后：编号比上一张大就马上抽圣所（按线索数抽几张、挑最有用的），
 *   编号越小越早挑公共牌（按对手可能出的牌估排第几、前面的人挑走哪些），下一轮还能不能比它大（影响以后发现圣所）。
 *   所以要求高的卡会被早打（它右边会有更多资源），给资源的卡留到后面，小编号用来抢公共牌，大编号用来拿圣所。
 * - 挑公共牌：每张公共牌各估一次，挑终局分最高的。
 * - 留圣所：每张各估一次，挑终局分最高的（圣所的资源和颜色对每张区域卡都可见）。
 *
 * 每一步附一句理由（botDecision），教程的「提示」按钮用。
 */
import { clueCount, discoveryFor, region, REGION_COUNT, sanctuary, SANCTUARY_COUNT, scorePlayer, tally } from "./cards.js";
import { currentPicker, legalActions } from "./engine.js";
import type { GameCommand, GameState, Player, RegionCard, Tally, Wonder } from "./types.js";

export interface BotOptions {
  /** 每个候选抽几个「可能的未来」。 */
  readonly samples: number;
  /** 保险丝：一步算了这么多毫秒就停（至少抽够 minSamples 个）。 */
  readonly maxMs: number;
  readonly minSamples: number;
}

export const DEFAULT_BOT_OPTIONS: BotOptions = { samples: 60, maxMs: 80, minSamples: 12 };

/** 人机的一个决定：动作 + 一句玩家听得懂的理由；detail 给测试和调试看。 */
export interface BotDecision {
  readonly command: GameCommand;
  readonly reason: string;
  readonly detail?: { readonly scores: Record<string, number>; readonly samples: number };
}

// ---------- 小工具 ----------

/** 可复现的随机数（mulberry32），种子由局面决定：同一局面同一决定。 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(view: GameState, playerId: string): number {
  let h = 2166136261 ^ view.version;
  for (const ch of `${playerId}:${view.round}:${view.phase}:${view.resolveIndex}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function sampleWithout<T>(pool: readonly T[], count: number, rnd: () => number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  for (let i = 0; i < count && copy.length; i += 1) {
    const j = Math.floor(rnd() * copy.length);
    out.push(copy[j]!);
    copy[j] = copy[copy.length - 1]!;
    copy.pop();
  }
  return out;
}

/** 这张卡有多「吃资源」：有前置条件、按数量计分的放左边；没有任务、只给资源的放右边。 */
export function needScore(card: RegionCard): number {
  let score = 0;
  if (Object.keys(card.prereq).length) score += 2 + Object.values(card.prereq).reduce((a, b) => a + (b ?? 0), 0) * 0.3;
  if (card.quest) score += card.quest.type === "flat" ? 0.5 : 1.5;
  else score -= 3;
  score -= Object.values(card.wonders).reduce((a, b) => a + (b ?? 0), 0) * 0.4 + card.clues * 0.2 + (card.night ? 0.2 : 0);
  return score;
}

function orderFuture(cards: readonly number[]): number[] {
  return [...cards].sort((a, b) => needScore(region(b)) - needScore(region(a)) || a - b);
}

// ---------- 看到的东西 ----------

interface Knowledge {
  readonly me: Player;
  readonly unseenRegions: number[];
  readonly unseenSanctuaries: number[];
  readonly opponents: number;
}

/** 这个座位没见过的区域卡和圣所卡（只用它能看到的信息算）。 */
export function botUnknownCards(view: GameState, playerId: string): { regions: number[]; sanctuaries: number[] } {
  const seen = new Set<number>([...view.market, ...view.removed]);
  const seenS = new Set<number>();
  for (const player of view.players) {
    player.played.forEach((card) => seen.add(card));
    player.sanctuaries.forEach((card) => seenS.add(card));
    if (player.id === playerId) {
      player.hand.forEach((card) => seen.add(card));
      if (player.pendingPlay !== null) seen.add(player.pendingPlay);
      player.offer.forEach((card) => seenS.add(card));
    }
  }
  const regions: number[] = [];
  for (let id = 1; id <= REGION_COUNT; id += 1) if (!seen.has(id)) regions.push(id);
  const sanctuaries: number[] = [];
  for (let id = 1; id <= SANCTUARY_COUNT; id += 1) if (!seenS.has(id)) sanctuaries.push(id);
  return { regions, sanctuaries };
}

function know(view: GameState, playerId: string): Knowledge {
  const me = view.players.find((player) => player.id === playerId)!;
  const unknown = botUnknownCards(view, playerId);
  return { me, unseenRegions: unknown.regions, unseenSanctuaries: unknown.sanctuaries, opponents: view.players.length - 1 };
}

// ---------- 估终局分 ----------

/** 一个「可能的未来」：补位用的区域卡、补位用的圣所、对手这一轮会出的牌。 */
interface World {
  readonly fillers: number[];
  readonly sanctuaryPool: number[];
  readonly opponentPlays: number[];
  readonly seed: number;
}

function makeWorlds(k: Knowledge, count: number, seed: number): World[] {
  const worlds: World[] = [];
  for (let i = 0; i < count; i += 1) {
    const rnd = makeRng(seed + i * 7919);
    worlds.push({
      fillers: sampleWithout(k.unseenRegions, 8, rnd),
      sanctuaryPool: sampleWithout(k.unseenSanctuaries, 12, rnd),
      opponentPlays: sampleWithout(k.unseenRegions, k.opponents, rnd),
      seed: seed + i * 104729 + 1,
    });
  }
  return worlds;
}

/** 从 pool 里挑最能加分的一张圣所。 */
function bestSanctuary(pool: readonly number[], played: readonly number[], sanctuaries: readonly number[]): number {
  let best = pool[0]!;
  let bestScore = -Infinity;
  for (const id of pool) {
    const score = scorePlayer(played, [...sanctuaries, id]).total;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

interface Plan {
  readonly played: readonly number[];
  readonly sanctuaries: readonly number[];
  /** 以后会打的已知牌（手里的、要挑的公共牌）。 */
  readonly known: readonly number[];
  /** 以后还有几张牌要打出（不含已经在 played 里的）。 */
  readonly futurePlays: number;
  /** 以后预计还会拿到几张圣所（可以带小数）。 */
  readonly futureSanctuaries: number;
  /** 以后每次发现圣所抽几张。 */
  readonly drawEach: number;
  /** 这一步马上要抽的圣所张数（0 = 不抽）。 */
  readonly drawNow: number;
}

/** 已知的牌比以后能打的多（最后几轮）：挑一组最好的打出去。 */
function bestSubset(plan: Plan): number[] {
  const n = plan.futurePlays;
  if (n <= 0) return [];
  let best: number[] = [];
  let bestScore = -Infinity;
  const choose = (start: number, picked: number[]) => {
    if (picked.length === n) {
      const ordered = orderFuture(picked);
      const score = scorePlayer([...plan.played, ...ordered], plan.sanctuaries).total;
      if (score > bestScore) {
        bestScore = score;
        best = ordered;
      }
      return;
    }
    for (let i = start; i < plan.known.length; i += 1) choose(i + 1, [...picked, plan.known[i]!]);
  };
  choose(0, []);
  return best;
}

/** 在一个可能的未来里估终局总分。 */
function evaluate(plan: Plan, world: World): number {
  const known = plan.known.length > plan.futurePlays ? bestSubset(plan) : orderFuture(plan.known);
  const fillers: number[] = [];
  for (const card of world.fillers) {
    if (known.length + fillers.length >= plan.futurePlays) break;
    if (!known.includes(card) && !plan.played.includes(card)) fillers.push(card);
  }
  const row = [...plan.played, ...known, ...fillers];
  const sanctuaries = [...plan.sanctuaries];
  let cursor = 0;
  const draw = (n: number) => {
    const size = Math.max(1, n);
    const pool = world.sanctuaryPool.slice(cursor, cursor + size);
    cursor += size;
    if (pool.length) sanctuaries.push(bestSanctuary(pool, row, sanctuaries));
  };
  if (plan.drawNow > 0) draw(plan.drawNow);
  const whole = Math.floor(plan.futureSanctuaries);
  const extra = makeRng(world.seed)() < plan.futureSanctuaries - whole ? 1 : 0;
  for (let i = 0; i < whole + extra; i += 1) draw(plan.drawEach);
  return scorePlayer(row, sanctuaries).total;
}

/** 以后还能发现几次圣所（粗估）：下一轮手里有比 lastCard 大的牌就很可能，之后每轮大约一半。 */
function futureDiscoveries(lastCard: number, nextHand: readonly number[], roundsLeft: number, unseen: readonly number[]): number {
  if (roundsLeft <= 0) return 0;
  const higherInHand = nextHand.some((card) => card > lastCard);
  const higherShare = unseen.length ? unseen.filter((card) => card > lastCard).length / unseen.length : 0;
  const next = higherInHand ? 0.8 : higherShare * 0.5;
  return next + 0.45 * (roundsLeft - 1);
}

/** 挑公共牌时排第几：对手这一轮出的牌比我小的人数 + 1。 */
function pickPosition(card: number, opponentPlays: readonly number[]): number {
  return 1 + opponentPlays.filter((other) => other < card).length;
}

// ---------- 三种决定 ----------

interface Candidate {
  readonly key: string;
  readonly command: GameCommand;
  readonly plan: (world: World) => number;
}

function runWorlds(k: Knowledge, view: GameState, playerId: string, options: BotOptions, candidates: Candidate[]) {
  const started = Date.now();
  const worlds = makeWorlds(k, options.samples, hashSeed(view, playerId));
  const sums = candidates.map(() => 0);
  let used = 0;
  for (const world of worlds) {
    candidates.forEach((candidate, i) => {
      sums[i]! += candidate.plan(world);
    });
    used += 1;
    if (used >= options.minSamples && Date.now() - started > options.maxMs) break;
  }
  const scored = candidates.map((candidate, i) => ({ key: candidate.key, command: candidate.command, value: sums[i]! / Math.max(1, used) }));
  const best = scored.reduce((a, b) => (b.value > a.value ? b : a));
  return { best, scores: Object.fromEntries(scored.map((s) => [s.key, Math.round(s.value * 10) / 10])), samples: used };
}

function decidePlay(view: GameState, k: Knowledge, options: BotOptions): BotDecision {
  const me = k.me;
  const roundsAfter = view.config.rounds - view.round;
  const marketOpen = view.round < view.config.rounds && view.market.length > 0;
  const candidates: Candidate[] = me.hand.map((card) => {
    const rest = me.hand.filter((other) => other !== card);
    const discovery = discoveryFor(me.played, me.sanctuaries, card);
    const played = [...me.played, card];
    const drawEach = 1 + clueCount(played, me.sanctuaries);
    return {
      key: String(card),
      command: { type: "play", card },
      plan: (world: World) => {
        // 这一轮挑公共牌：排第几，前面的人随机挑走几张，我挑剩下里最合适的
        let pick: number[] = [];
        if (marketOpen) {
          const position = pickPosition(card, world.opponentPlays);
          const left = sampleWithout(view.market, view.market.length - (position - 1), makeRng(world.seed + card));
          let best = left[0]!;
          let bestScore = -Infinity;
          for (const option of left) {
            const score = scorePlayer([...played, ...orderFuture([...rest, option])], me.sanctuaries).total;
            if (score > bestScore) {
              bestScore = score;
              best = option;
            }
          }
          pick = [best];
        }
        const nextHand = [...rest, ...pick];
        return evaluate(
          {
            played,
            sanctuaries: me.sanctuaries,
            known: nextHand,
            futurePlays: roundsAfter,
            futureSanctuaries: futureDiscoveries(card, nextHand, roundsAfter, k.unseenRegions),
            drawEach,
            drawNow: discovery.discovered ? discovery.count : 0,
          },
          world,
        );
      },
    };
  });
  const { best, scores, samples } = runWorlds(k, view, me.id, options, candidates);
  const card = (best.command as { card: number }).card;
  return { command: best.command, reason: playReason(view, me, card), detail: { scores, samples } };
}

function decideTake(view: GameState, k: Knowledge, options: BotOptions): BotDecision {
  const me = k.me;
  const roundsAfter = view.config.rounds - view.round;
  const lastCard = me.played.at(-1) ?? 0;
  const drawEach = 1 + clueCount(me.played, me.sanctuaries);
  const candidates: Candidate[] = view.market.map((card) => ({
    key: String(card),
    command: { type: "take", card },
    plan: (world: World) => {
      const nextHand = [...me.hand, card];
      return evaluate(
        {
          played: me.played,
          sanctuaries: me.sanctuaries,
          known: nextHand,
          futurePlays: roundsAfter,
          futureSanctuaries: futureDiscoveries(lastCard, nextHand, roundsAfter, k.unseenRegions),
          drawEach,
          drawNow: 0,
        },
        world,
      );
    },
  }));
  const { best, scores, samples } = runWorlds(k, view, me.id, options, candidates);
  const card = (best.command as { card: number }).card;
  return { command: best.command, reason: takeReason(me, card), detail: { scores, samples } };
}

function decideKeep(view: GameState, k: Knowledge, options: BotOptions): BotDecision {
  const me = k.me;
  const roundsAfter = view.config.rounds - view.round;
  const lastCard = me.played.at(-1) ?? 0;
  const candidates: Candidate[] = me.offer.map((id) => ({
    key: `S${id}`,
    command: { type: "keep", sanctuary: id },
    plan: (world: World) =>
      evaluate(
        {
          played: me.played,
          sanctuaries: [...me.sanctuaries, id],
          known: me.hand,
          futurePlays: roundsAfter,
          futureSanctuaries: futureDiscoveries(lastCard, me.hand, roundsAfter, k.unseenRegions),
          drawEach: 1 + clueCount(me.played, [...me.sanctuaries, id]),
          drawNow: 0,
        },
        world,
      ),
  }));
  if (candidates.length === 1) {
    const only = candidates[0]!;
    return { command: only.command, reason: keepReason(me, me.offer[0]!, 1) };
  }
  const { best, scores, samples } = runWorlds(k, view, me.id, options, candidates);
  const id = (best.command as { sanctuary: number }).sanctuary;
  return { command: best.command, reason: keepReason(me, id, candidates.length), detail: { scores, samples } };
}

// ---------- 理由 ----------

const WONDER_NAME: Record<Wonder, string> = { stone: "奇石", chimera: "灵兽", thistle: "蓟草" };

function prereqText(card: RegionCard): string {
  return (Object.entries(card.prereq) as [Wonder, number][]).map(([w, n]) => `${n} 个${WONDER_NAME[w]}`).join("、");
}

function wondersText(card: { wonders: Partial<Record<Wonder, number>>; clues: number; night: boolean }): string {
  const parts = (Object.entries(card.wonders) as [Wonder, number][]).map(([w, n]) => (n > 1 ? `${n} 个${WONDER_NAME[w]}` : WONDER_NAME[w]));
  if (card.clues) parts.push("线索");
  if (card.night) parts.push("夜");
  return parts.join("、");
}

function sName(id: number): string {
  return `S${String(id).padStart(2, "0")}`;
}

function playReason(view: GameState, me: Player, card: number): string {
  const info = region(card);
  const last = me.played.at(-1);
  const discovery = discoveryFor(me.played, me.sanctuaries, card);
  const smallest = Math.min(...me.hand) === card;
  const roundsAfter = view.config.rounds - view.round;
  if (Object.keys(info.prereq).length && roundsAfter >= 3) {
    return `出 ${card}：它要 ${prereqText(info)} 才得分，早点放在左边，后面打的牌都能帮它凑条件。`;
  }
  if (discovery.discovered && last !== undefined) return `出 ${card}：比上一张 ${last} 大，能抽 ${discovery.count} 张圣所挑 1 张。`;
  if (smallest && view.round < view.config.rounds && view.market.length) return `出 ${card}：编号小，这一轮能早点挑公共牌。`;
  if (!info.quest && wondersText(info)) return `出 ${card}：它没有任务，只给${wondersText(info)}，放在右边正好给左边的卡用。`;
  if (info.quest && !Object.keys(info.prereq).length) return `出 ${card}：它的任务不要前置条件，现在打也稳稳拿分。`;
  return `出 ${card}：按现在的手牌估下来，这张打出去终局分最高。`;
}

function questValue(card: RegionCard, t: Tally): number {
  const q = card.quest!;
  switch (q.type) {
    case "flat":
      return q.points;
    case "perIcon":
      return q.points * t[q.icon];
    case "perColor":
      return q.points * q.colors.reduce((s, c) => s + t[c], 0);
    case "perColorSet":
      return q.points * Math.min(t.red, t.green, t.blue, t.yellow);
  }
}

/** 这些新东西（以后打在右边的区域卡、新圣所）让左边哪张已打出的卡涨分最多。 */
function helpedCard(played: readonly number[], sanctuaries: readonly number[], extraRegions: readonly number[], extraSanctuaries: readonly number[]): { card: number; gain: number } | null {
  const before = scorePlayer(played, sanctuaries).regions;
  const extra = tally(extraRegions, extraSanctuaries);
  let best: { card: number; gain: number } | null = null;
  for (let i = 0; i < played.length; i += 1) {
    const info = region(played[i]!);
    if (!info.quest) continue;
    const t = tally(played.slice(i), sanctuaries);
    for (const key of Object.keys(extra) as (keyof Tally)[]) t[key] += extra[key];
    const ok = (Object.entries(info.prereq) as [Wonder, number][]).every(([w, n]) => t[w] >= n);
    const gain = (ok ? questValue(info, t) : 0) - before[i]!;
    if (gain > 0 && (!best || gain > best.gain)) best = { card: played[i]!, gain };
  }
  return best;
}

function takeReason(me: Player, card: number): string {
  const info = region(card);
  const helped = helpedCard(me.played, me.sanctuaries, [card], []);
  if (helped && helped.gain >= 2) return `挑 ${card}：以后打出去，它的${wondersText(info) || "颜色"}能让左边的 ${helped.card} 多得 ${helped.gain} 分。`;
  if (Object.keys(info.prereq).length) return `挑 ${card}：分值高（要 ${prereqText(info)}），适合早点打在左边。`;
  if (info.quest) return `挑 ${card}：它的任务和你现在的牌搭得上，估下来最划算。`;
  return `挑 ${card}：给${wondersText(info) || "资源"}，留到后面打在右边。`;
}

function keepReason(me: Player, id: number, choices: number): string {
  const info = sanctuary(id);
  if (choices <= 1) return `留 ${sName(id)}：只抽到这一张，必须留下。`;
  const helped = helpedCard(me.played, me.sanctuaries, [], [id]);
  const own = info.quest ? scorePlayer(me.played, [...me.sanctuaries, id]).sanctuaries.at(-1)! : 0;
  if (helped && helped.gain >= Math.max(2, own)) return `留 ${sName(id)}：它的${wondersText(info) || "颜色"}一直算数，马上让 ${helped.card} 多得 ${helped.gain} 分。`;
  if (own >= 3) return `留 ${sName(id)}：它自己的任务按现在算就有 ${own} 分，以后还会涨。`;
  if (info.clues) return `留 ${sName(id)}：多 1 个线索，以后发现圣所能多抽一张。`;
  return `留 ${sName(id)}：估下来对终局分帮助最大。`;
}

// ---------- 对外 ----------

/** 人机的决定和理由（教程「提示」按钮也用）。没有要做的事返回 null。 */
export function botDecision(view: GameState, playerId: string, options: Partial<BotOptions> = {}): BotDecision | null {
  const opts = { ...DEFAULT_BOT_OPTIONS, ...options };
  const me = view.players.find((player) => player.id === playerId);
  if (!me || view.phase === "ended") return null;
  const k = know(view, playerId);
  if (view.phase === "play") {
    if (me.submitted || !me.hand.length) return null;
    return decidePlay(view, k, opts);
  }
  // 阶段③：有圣所待选先留（不影响挑牌的顺序，留好了挑牌估得更准）
  if (me.offer.length) return decideKeep(view, k, opts);
  if (currentPicker(view) === playerId && view.market.length) return decideTake(view, k, opts);
  return null;
}

export const botHint = botDecision;

/** 人机的动作（输入是这个座位的 redact 视角）。 */
export function botCommand(view: GameState, playerId: string, options: Partial<BotOptions> = {}): GameCommand | null {
  const decision = botDecision(view, playerId, options);
  if (decision) return decision.command;
  return legalActions(view, playerId)[0] ?? null;
}
