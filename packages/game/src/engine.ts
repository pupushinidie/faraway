import {
  discoveryFor,
  HAND_SIZE,
  REGION_COUNT,
  ROUNDS,
  SANCTUARY_COUNT,
  scorePlayer,
  smallestCard,
} from "./cards.js";
import { restoreRng, rngFromSeed, type Rng } from "./rng.js";
import type {
  Config,
  FinalResult,
  GameCommand,
  GameEvent,
  GameOptions,
  GameState,
  LogEntry,
  Phase,
  Player,
  RoundPlay,
} from "./types.js";

export const DEFAULT_OPTIONS: GameOptions = { assist: true };

/** 检查并补全开房选项：不给的项用默认值；给了但不合法就抛错（服务器把错误原样回给房主）。 */
export function normalizeOptions(input: unknown = {}): GameOptions {
  if (input === null || typeof input !== "object") throw new Error("开房选项格式不对。");
  const raw = input as Record<string, unknown>;
  const assist = raw.assist ?? DEFAULT_OPTIONS.assist;
  if (typeof assist !== "boolean") throw new Error("辅助显示只能开或关。");
  return { assist };
}

export function defaultConfig(options: Partial<GameOptions> = {}, overrides: Partial<Config> = {}): Config {
  return {
    ...normalizeOptions(options),
    minPlayers: 2,
    maxPlayers: 6,
    rounds: ROUNDS,
    playTimeoutSec: 60,
    resolveTimeoutSec: 30,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/**
 * 指定发牌（教程、预览、测试用）：hands[i] 是第 i 位玩家的开局手牌；regionDeck 是开局手牌之后区域牌堆从顶往下的顺序
 * （前 N+1 张就是第 1 轮的公共牌）；sanctuaryDeck 是圣所牌堆从顶往下的顺序。没指定的牌洗乱接在后面。
 */
export interface DealStack {
  readonly hands?: readonly (readonly number[])[];
  readonly regionDeck?: readonly number[];
  readonly sanctuaryDeck?: readonly number[];
}

/**
 * 动画节奏（毫秒），界面照这个放，服务器按它给下一步的倒计时和人机的停顿留出时间：
 * 翻牌 revealMs；每发一次圣所 drawMs；挑公共牌 takeMs；终局倒序计分 scoringMs（每人 8 张 + 圣所，约 15 秒，可以跳过）。
 */
export const ANIMATION = { revealMs: 1600, drawMs: 500, takeMs: 600, scoringMs: 15000 } as const;

/** 这一批事件要放多久动画（毫秒）。服务器在换步骤时用最近一步的事件算。 */
export function animationMs(events: readonly GameEvent[]): number {
  let ms = 0;
  for (const event of events) {
    if (event.type === "Revealed") ms += ANIMATION.revealMs;
    else if (event.type === "SanctuariesDrawn") ms += ANIMATION.drawMs;
    else if (event.type === "MarketTaken") ms += ANIMATION.takeMs;
    else if (event.type === "GameEnded") ms += ANIMATION.scoringMs;
  }
  return ms;
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("你不在这局里。");
  return player;
}

function sortAsc(cards: number[]): number[] {
  return cards.sort((a, b) => a - b);
}

/** 公共牌张数 = 人数 + 1。 */
export function marketSize(players: number): number {
  return players + 1;
}

function syncCounts(state: GameState): void {
  state.regionDeckCount = state.regionDeck?.length ?? state.regionDeckCount;
  state.sanctuaryDeckCount = state.sanctuaryDeck?.length ?? state.sanctuaryDeckCount;
}

/** 所有人都提交了：同时翻开 → 判定谁发现圣所 → 按编号从小到大发圣所 → 进入阶段③。 */
function reveal(state: GameState, events: GameEvent[]): void {
  const plays: RoundPlay[] = [];
  const wanted = new Map<string, number>();
  for (const player of state.players) {
    const card = player.pendingPlay!;
    const discovery = discoveryFor(player.played, player.sanctuaries, card);
    player.played.push(card);
    player.pendingPlay = null;
    plays.push({ player: player.id, card, discovered: discovery.discovered });
    wanted.set(player.id, discovery.count);
  }
  plays.sort((a, b) => a.card - b.card);
  state.lastReveal = { round: state.round, plays };
  events.push({ type: "Revealed", round: state.round, plays });
  const deck = state.sanctuaryDeck ?? [];
  for (const play of plays) {
    if (!play.discovered) continue;
    const player = findPlayer(state, play.player);
    const want = wanted.get(play.player)!;
    // 牌堆不够时按编号从小到大发，发完为止（开工拍板 §11-1 a）；这一轮放回的要到留圣所时才进牌堆底，补不到后面的人。
    player.offer = deck.splice(0, Math.min(want, deck.length));
    player.offerCount = player.offer.length;
    player.offerWanted = want;
    events.push({ type: "SanctuariesDrawn", player: play.player, count: player.offerCount, wanted: want });
  }
  state.phase = "resolve";
  state.resolveOrder = plays.map((play) => play.player);
  state.resolveIndex = state.round >= state.config.rounds ? state.resolveOrder.length : 0;
  syncCounts(state);
  maybeEndRound(state, events);
}

/** 阶段③全部做完（公共牌挑完、圣所都留好）就结束这一轮：剩下的公共牌移出游戏，翻下一轮的公共牌，或者进入终局计分。 */
function maybeEndRound(state: GameState, events: GameEvent[]): void {
  if (state.phase !== "resolve") return;
  if (state.resolveIndex < state.resolveOrder.length) return;
  if (state.players.some((player) => player.offerCount > 0)) return;
  for (const card of state.market) {
    state.removed.push(card);
    events.push({ type: "MarketRemoved", card });
  }
  state.market = [];
  if (state.round >= state.config.rounds) {
    finishGame(state, events);
    return;
  }
  state.round += 1;
  // 第 1–6 轮结束翻新的公共牌；第 7 轮结束不翻（第 8 轮不挑牌）。
  if (state.round < state.config.rounds) {
    const deck = state.regionDeck ?? [];
    state.market = sortAsc(deck.splice(0, marketSize(state.players.length)));
  }
  state.phase = "play";
  state.resolveOrder = [];
  state.resolveIndex = 0;
  for (const player of state.players) {
    player.submitted = false;
    player.offerWanted = 0;
    player.tookMarket = false;
  }
  syncCounts(state);
  events.push({ type: "RoundStarted", round: state.round, market: [...state.market] });
}

/** 名次：总分高的在前；并列时出牌区里编号最小的那张更小的在前（规则书 §7，官方）。 */
export function rankPlayers(players: readonly { id: string; played: readonly number[]; total: number }[]): string[] {
  return [...players]
    .sort((a, b) => b.total - a.total || smallestCard(a.played) - smallestCard(b.played))
    .map((player) => player.id);
}

function finishGame(state: GameState, events: GameEvent[]): void {
  const scores: FinalResult["scores"] = {};
  for (const player of state.players) scores[player.id] = scorePlayer(player.played, player.sanctuaries);
  const ranking = rankPlayers(state.players.map((player) => ({ id: player.id, played: player.played, total: scores[player.id]!.total })));
  const first = scores[ranking[0]!]!.total;
  const tieBreak = ranking.length > 1 && scores[ranking[1]!]!.total === first;
  state.finalResult = { ranking, winners: [ranking[0]!], scores, tieBreak };
  state.phase = "ended";
  state.resolveOrder = [];
  state.resolveIndex = 0;
  const totals: Record<string, number> = {};
  for (const id of ranking) totals[id] = scores[id]!.total;
  events.push({ type: "GameEnded", ranking, totals });
}

function applyPlay(state: GameState, player: Player, card: number, events: GameEvent[]): void {
  if (state.phase !== "play") throw new Error("现在不是出牌的时候。");
  if (player.submitted) throw new Error("这一轮你已经出过牌了，提交后不能撤回。");
  const index = player.hand.indexOf(card);
  if (!Number.isInteger(card) || index < 0) throw new Error("这张牌不在你手里。");
  player.hand.splice(index, 1);
  player.handCount = player.hand.length;
  player.pendingPlay = card;
  player.submitted = true;
  events.push({ type: "Submitted", player: player.id });
  if (state.players.every((candidate) => candidate.submitted)) reveal(state, events);
}

/** 现在轮到谁挑公共牌（没有就是 null：第 8 轮、或者都挑完了）。 */
export function currentPicker(state: GameState): string | null {
  if (state.phase !== "resolve") return null;
  return state.resolveOrder[state.resolveIndex] ?? null;
}

function applyTake(state: GameState, player: Player, card: number, events: GameEvent[]): void {
  if (state.phase !== "resolve") throw new Error("现在不是挑公共牌的时候。");
  if (state.round >= state.config.rounds) throw new Error("第 8 轮不挑公共牌。");
  if (currentPicker(state) !== player.id) throw new Error("还没轮到你挑公共牌。");
  const index = state.market.indexOf(card);
  if (!Number.isInteger(card) || index < 0) throw new Error("这张牌不在公共牌里。");
  state.market.splice(index, 1);
  player.hand.push(card);
  sortAsc(player.hand);
  player.handCount = player.hand.length;
  player.tookMarket = true;
  state.resolveIndex += 1;
  events.push({ type: "MarketTaken", player: player.id, card });
  maybeEndRound(state, events);
}

function applyKeep(state: GameState, player: Player, id: number, events: GameEvent[]): void {
  if (state.phase !== "resolve") throw new Error("现在不是留圣所的时候。");
  if (player.offer.length === 0) throw new Error("你没有待选的圣所卡。");
  if (!Number.isInteger(id) || !player.offer.includes(id)) throw new Error("这张圣所卡不在你抽到的牌里。");
  const rest = player.offer.filter((card) => card !== id);
  player.sanctuaries.push(id);
  state.sanctuaryDeck?.push(...rest);
  player.offer = [];
  player.offerCount = 0;
  syncCounts(state);
  if (state.sanctuaryDeck === undefined) state.sanctuaryDeckCount += rest.length;
  events.push({ type: "SanctuaryKept", player: player.id, sanctuary: id, returned: rest.length });
  maybeEndRound(state, events);
}

function cloneState(state: GameState): GameState {
  const next: GameState = {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hand: [...player.hand],
      played: [...player.played],
      sanctuaries: [...player.sanctuaries],
      offer: [...player.offer],
    })),
    market: [...state.market],
    removed: [...state.removed],
    resolveOrder: [...state.resolveOrder],
    events: [],
  };
  if (state.regionDeck) next.regionDeck = [...state.regionDeck];
  if (state.sanctuaryDeck) next.sanctuaryDeck = [...state.sanctuaryDeck];
  if (state.log) next.log = [...state.log];
  return next;
}

/**
 * 把收到的动作整理成只含规则要用的字段（客户端多塞的东西一概丢掉，不进校验也不进动作序列）。
 * 字段值合不合法（牌在不在手里）由各个动作自己检查。
 */
export function normalizeCommand(raw: unknown): GameCommand {
  if (!raw || typeof raw !== "object") throw new Error("未知的行动。");
  const input = raw as Record<string, unknown>;
  const step = typeof input.step === "string" && input.step.length <= 40 ? { step: input.step } : {};
  const number = (value: unknown) => (typeof value === "number" ? value : Number.NaN);
  switch (input.type) {
    case "play":
      return { type: "play", card: number(input.card), ...step };
    case "take":
      return { type: "take", card: number(input.card), ...step };
    case "keep":
      return { type: "keep", sanctuary: number(input.sanctuary), ...step };
    default:
      throw new Error("未知的行动。");
  }
}

function withoutStep(command: GameCommand): GameCommand {
  const { step: _step, ...rest } = command;
  return rest as GameCommand;
}

/**
 * 迟到的点击：动作带的 step 和现在的对不上就拒绝。留圣所和别人挑公共牌是同时进行的，
 * 所以 keep 只比「第几轮、哪个阶段」，不管现在轮到第几个人挑。
 */
function stepMatches(state: GameState, command: GameCommand): boolean {
  if (command.step === undefined) return true;
  if (command.type === "keep") return command.step.startsWith(`${state.round}:resolve`) && state.phase === "resolve";
  return command.step === stepKey(state);
}

function applyInternal(state: GameState, playerId: string, raw: GameCommand): { state: GameState; events: GameEvent[] } {
  if (state.phase === "ended") throw new Error("对局已经结束。");
  findPlayer(state, playerId);
  const command = normalizeCommand(raw);
  if (!stepMatches(state, command)) throw new Error("这一步已经过去了，请看最新的局面再选。");
  const next = cloneState(state);
  const player = findPlayer(next, playerId);
  const events: GameEvent[] = [];
  switch (command.type) {
    case "play":
      applyPlay(next, player, command.card, events);
      break;
    case "take":
      applyTake(next, player, command.card, events);
      break;
    case "keep":
      applyKeep(next, player, command.sanctuary, events);
      break;
  }
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/**
 * 纯函数：playerId 做 command，返回新状态和这一步的事件，不改输入。
 * 遥远之地开局以后再没有随机（牌堆在开局洗好、放回的圣所进牌堆底），rng 留着保持全站统一的签名。
 */
export function apply(state: GameState, playerId: string, command: GameCommand, _rng?: Rng): { state: GameState; events: GameEvent[] } {
  return applyInternal(state, playerId, command);
}

function runCommand(state: GameState, playerId: string, command: GameCommand, auto = false): { state: GameState; events: GameEvent[] } {
  const { state: next, events } = applyInternal(state, playerId, command);
  const clean = withoutStep(normalizeCommand(command));
  const entry: LogEntry = auto ? { player: playerId, command: clean, auto: true } : { player: playerId, command: clean };
  next.log = [...(state.log ?? []), entry];
  return { state: next, events };
}

/** 服务端用：动作记进 state.log。opts.auto：这一步是替这个座位代做的（超时、托管、离线由人机代打）。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand, opts: { auto?: boolean } = {}): GameState {
  return runCommand(state, playerId, command, opts.auto === true).state;
}

/** 现在还要等谁：出牌时没提交的人；阶段③轮到挑公共牌的人 + 有圣所待选的人。 */
export function waitingFor(state: GameState): string[] {
  switch (state.phase) {
    case "play":
      return state.players.filter((player) => !player.submitted).map((player) => player.id);
    case "resolve": {
      const ids = new Set<string>();
      const picker = currentPicker(state);
      if (picker) ids.add(picker);
      for (const player of state.players) if (player.offerCount > 0) ids.add(player.id);
      return state.players.map((player) => player.id).filter((id) => ids.has(id));
    }
    case "ended":
      return [];
  }
}

/** playerId 现在能做的所有动作。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return [];
  switch (state.phase) {
    case "play":
      return player.submitted ? [] : player.hand.map((card) => ({ type: "play", card }));
    case "resolve": {
      const actions: GameCommand[] = [];
      if (currentPicker(state) === playerId) for (const card of state.market) actions.push({ type: "take", card });
      for (const id of player.offer) actions.push({ type: "keep", sanctuary: id });
      return actions;
    }
    case "ended":
      return [];
  }
}

/**
 * 服务器的计时 key：只在换轮、换阶段、或者轮到下一个人挑公共牌时变。
 * 出牌和留圣所都是大家同时做的「轮外操作」，别人提交 / 留圣所不改变 key，倒计时不会被重置。
 */
export function stepKey(state: GameState): string {
  if (state.phase === "ended") return "ended";
  if (state.phase === "play") return `${state.round}:play`;
  return `${state.round}:resolve:${state.resolveIndex}`;
}

/** 超时代做时怎么选：拿到的是这个座位视角（redact 之后）的状态。服务器用人机策略；不给就用简单基线。 */
export type TimeoutPolicy = (view: GameState, playerId: string) => GameCommand | null;

/** 简单基线（超时保底，规则书 §9.4）：出手里编号最小的；挑公共牌里编号最小的；留抽到的第一张。 */
export function baselineCommand(view: GameState, playerId: string): GameCommand | null {
  const player = view.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  if (view.phase === "play" && !player.submitted && player.hand.length) return { type: "play", card: Math.min(...player.hand) };
  if (view.phase === "resolve") {
    if (currentPicker(view) === playerId && view.market.length) return { type: "take", card: Math.min(...view.market) };
    if (player.offer.length) return { type: "keep", sanctuary: player.offer[0]! };
  }
  return null;
}

/** 两个动作是不是同一个（不看 step）。 */
export function sameCommand(left: GameCommand, right: GameCommand): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "keep" && right.type === "keep") return left.sanctuary === right.sanctuary;
  if (left.type === "keep" || right.type === "keep") return false;
  return left.card === right.card;
}

type Duty = "play" | "take" | "keep";

/** 超时时某人欠着的动作：出牌；轮到他挑公共牌；他有圣所待选。 */
function dutiesOf(state: GameState, playerId: string): Duty[] {
  const player = findPlayer(state, playerId);
  const duties: Duty[] = [];
  if (state.phase === "play" && !player.submitted) duties.push("play");
  if (state.phase === "resolve") {
    if (currentPicker(state) === playerId) duties.push("take");
    if (player.offerCount > 0) duties.push("keep");
  }
  return duties;
}

/** 按 policy 代做 duty 这一种动作；policy 给的不是这种、或者不合法，就退回基线。 */
function autoCommand(state: GameState, playerId: string, duty: Duty, policy: TimeoutPolicy): GameCommand {
  const view = redactGameForViewer(state, playerId);
  const legal = legalActions(state, playerId).filter((action) => action.type === duty);
  let command: GameCommand | null = null;
  try {
    command = policy(view, playerId);
  } catch {
    command = null;
  }
  if (command && command.type === duty && legal.some((action) => sameCommand(action, command!))) return command;
  if (duty === "keep") {
    // 人机先挑了公共牌之类：单独问一次「留哪张」，不行就留第一张
    return legal[0]!;
  }
  if (duty === "take") return { type: "take", card: Math.min(...state.market) };
  return { type: "play", card: Math.min(...findPlayer(state, playerId).hand) };
}

/**
 * 当前这一步超时：到点时还欠着动作的人由系统代做（policy，默认简单基线）。
 * - 出牌：没提交的人代打一张，最后一张提交完就翻牌；
 * - 阶段③：轮到的人代挑公共牌；到点时有圣所待选的人代留一张。到点后才轮到的人不代做（他的倒计时重新开始）。
 * 事件最前面是 TimedOut（被代做的人）。
 */
export function timeoutTurn(state: GameState, policy: TimeoutPolicy = baselineCommand): GameState {
  if (state.phase === "ended") return state;
  const phase: Phase = state.phase;
  const round = state.round;
  const owed: { player: string; duty: Duty }[] = [];
  for (const playerId of waitingFor(state)) for (const duty of dutiesOf(state, playerId)) owed.push({ player: playerId, duty });
  // 先挑公共牌，再留圣所，最后出牌（同一阶段只会有一种或前两种）
  owed.sort((a, b) => (a.duty === "take" ? -1 : 0) - (b.duty === "take" ? -1 : 0));
  let current = state;
  const events: GameEvent[] = [];
  for (const { player, duty } of owed) {
    if (current.phase !== phase || current.round !== round) break;
    if (!dutiesOf(current, player).includes(duty)) continue;
    const step = runCommand(current, player, autoCommand(current, player, duty, policy), true);
    events.push(...step.events);
    current = step.state;
  }
  if (current === state) return state;
  const players = [...new Set(owed.map((entry) => entry.player))];
  current.events = [{ type: "TimedOut", phase, players }, ...events];
  return current;
}

/** 只在服务端的字段：牌堆顺序、种子、随机数状态、动作序列。 */
function stripServerOnly(state: GameState): GameState {
  const { regionDeck: _r, sanctuaryDeck: _s, seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  return structuredClone(rest) as GameState;
}

/**
 * 玩家 viewerId 能看到的状态：别人的手牌、已提交还没翻开的牌、抽到待选的圣所都去掉（张数和「已提交」照给），
 * 牌堆顺序、种子、随机数状态、动作序列都去掉。viewerId 不是玩家（比如 ""）时谁的都看不到。
 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const view = stripServerOnly(state);
  view.players = view.players.map((player) => (player.id === viewerId ? player : { ...player, hand: [], pendingPlay: null, offer: [] }));
  return view;
}

/**
 * 观战的人：房主打开「观战看手牌」时看得到所有人的手牌和抽到的圣所，但**看不到已提交还没翻开的牌**——
 * 那张放回手牌里一起显示，所以从手牌也推不出打的是哪张。牌堆顺序和种子永远看不到。
 */
export function redactGameForSpectator(state: GameState, seeAll: boolean): GameState {
  if (!seeAll) return redactGameForViewer(state, "");
  const view = stripServerOnly(state);
  view.players = view.players.map((player) => ({
    ...player,
    hand: player.pendingPlay === null ? player.hand : sortAsc([...player.hand, player.pendingPlay]),
    pendingPlay: null,
  }));
  return view;
}

/** 不给种子时：有 Web Crypto（Node 18+、浏览器）就生成 256 位十六进制密钥，否则退回 32 位数字。 */
function randomSeed(): number | string {
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Math.floor(Math.random() * 2 ** 32);
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** 指定的牌放在前面（按给的顺序），其余洗乱接在后面。 */
function stacked(all: number[], fixed: readonly number[], rng: Rng): number[] {
  const set = new Set(fixed);
  if (set.size !== fixed.length) throw new Error("指定发牌里有重复的牌。");
  for (const card of fixed) if (!all.includes(card)) throw new Error(`指定发牌里的 ${card} 不能用。`);
  return [...fixed, ...rng.shuffle(all.filter((card) => !set.has(card)))];
}

/**
 * 开一局：每人发 3 张，翻 N+1 张公共牌，圣所牌堆洗好，进入第 1 轮出牌。
 * **服务器必须给 128–256 位的十六进制种子**（ChaCha20）；数字种子（mulberry32）只给测试、教程、预览用。
 * options 是开房选项；overrides 改计时之类的配置（测试用）；stack 指定发牌（教程、预览用）。
 */
export function createGame(
  players: readonly NewPlayer[],
  seed: number | string = randomSeed(),
  options: Partial<GameOptions> = {},
  overrides: Partial<Config> = {},
  stack: DealStack = {},
): GameState {
  const config = defaultConfig(options, overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new Error("玩家 id 重复。");
  const rng = rngFromSeed(seed);
  const handCards = players.map((_, i) => stack.hands?.[i] ?? null);
  const fixedRegions = [...handCards.flatMap((hand) => hand ?? []), ...(stack.regionDeck ?? [])];
  const pool = stacked(range(1, REGION_COUNT), fixedRegions, rng);
  // pool：先是指定的手牌和牌堆，再是洗乱的其余牌。没指定手牌的人从洗乱的部分里发。
  const fixedDeck = [...(stack.regionDeck ?? [])];
  let free = pool.slice(fixedRegions.length);
  const hands = handCards.map((hand) => {
    if (hand) {
      if (hand.length !== HAND_SIZE) throw new Error("指定的开局手牌要正好 3 张。");
      return sortAsc([...hand]);
    }
    const dealt = free.slice(0, HAND_SIZE);
    free = free.slice(HAND_SIZE);
    return sortAsc(dealt);
  });
  const regionDeck = [...fixedDeck, ...free];
  const sanctuaryDeck = stacked(range(1, SANCTUARY_COUNT), stack.sanctuaryDeck ?? [], rng);
  const market = sortAsc(regionDeck.splice(0, marketSize(players.length)));
  const state: GameState = {
    config,
    phase: "play",
    players: players.map((player, seat) => ({
      id: player.id,
      name: player.name,
      seat,
      hand: hands[seat]!,
      handCount: HAND_SIZE,
      played: [],
      sanctuaries: [],
      submitted: false,
      pendingPlay: null,
      offer: [],
      offerCount: 0,
      offerWanted: 0,
      tookMarket: false,
    })),
    round: 1,
    market,
    removed: [],
    regionDeckCount: regionDeck.length,
    sanctuaryDeckCount: sanctuaryDeck.length,
    resolveOrder: [],
    resolveIndex: 0,
    lastReveal: null,
    events: [{ type: "RoundStarted", round: 1, market: [...market] }],
    version: 0,
    regionDeck,
    sanctuaryDeck,
    seed,
    rngState: rng.state,
    log: [],
  };
  return state;
}

/** 从存档恢复随机数（全站统一的接口；遥远之地开局后不再用随机数）。 */
export function rngOf(state: GameState): Rng {
  return state.rngState !== undefined ? restoreRng(state.rngState) : rngFromSeed(state.seed ?? 0);
}
