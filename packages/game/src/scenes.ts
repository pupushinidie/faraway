/**
 * 预览局面工厂（对外接口）：界面的预览页、教程、自测都用它造局面，不用真打一局去等。
 *
 * - buildGame(spec)：按参数造任意精确局面（每人手牌、出牌区、圣所、已提交的牌、抽到的圣所、公共牌、第几轮、哪个阶段）；
 * - playRound(state, cards) / takeAll(state, picks) / keepAll(state, keeps)：按指定的牌推进；
 * - autoAdvance(state, until, policy)：用策略（默认简单基线）一步步推进，直到 until 成立；
 * - createScene(name, opts)：按名字造常见局面（完整的服务端状态，给界面用之前要过 redact）；
 * - createSceneRoom(game, opts)：包成网页收到的房间快照（某个座位或观战视角），可以标离线、人机、托管、倒计时。
 *
 * 签名和用法见 README「对外接口」一节。
 */
import { HAND_SIZE, REGION_COUNT, SANCTUARY_COUNT } from "./cards.js";
import {
  applyCommand,
  baselineCommand,
  createGame,
  currentPicker,
  defaultConfig,
  marketSize,
  rankPlayers,
  redactGameForSpectator,
  redactGameForViewer,
  timeoutTurn,
  waitingFor,
  type TimeoutPolicy,
} from "./engine.js";
import { discoveryFor, scorePlayer } from "./cards.js";
import { createRng } from "./rng.js";
import { DEFAULT_ROOM_ACCESS, type Capacity, type LobbyMember, type LobbyRoomSnapshot } from "./roomTypes.js";
import type { GameOptions, GameState, Phase, Player, RoundPlay } from "./types.js";

/** 预览里的玩家名（座位 0 是「我」）。玩家 id 是 p1–p6。 */
export const SCENE_NAMES_OF_PLAYERS = ["我", "阿远", "小溪", "石头", "岩岩", "菌菌"] as const;
const BOT_NAMES = ["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号", "咕噜五号"];

export interface PlayerSpec {
  /** 默认 p1、p2…（按顺序）。 */
  readonly id?: string;
  readonly name?: string;
  /** 手牌；不给就从没用到的牌里随机发（张数按阶段推算）。 */
  readonly hand?: readonly number[];
  /** 出牌区（左 → 右）；不给就随机（张数按阶段推算）。 */
  readonly played?: readonly number[];
  /** 留下的圣所。 */
  readonly sanctuaries?: readonly number[];
  /** 出牌阶段已提交、还没翻开的牌。 */
  readonly pendingPlay?: number | null;
  /** 阶段③抽到待选的圣所。 */
  readonly offer?: readonly number[];
  /** 抽圣所时本来要抽几张（默认 = offer 张数）。 */
  readonly offerWanted?: number;
}

export interface ExactSpec {
  /** 人数（2–6，名字和 id 用默认的），或者逐个指定。 */
  readonly players: number | readonly PlayerSpec[];
  /** 第几轮（1–8），默认 1。 */
  readonly round?: number;
  /** 默认 play。ended 时自动算终局计分。 */
  readonly phase?: Phase;
  /** 公共牌；不给就随机（张数按阶段推算）。 */
  readonly market?: readonly number[];
  /** 移出游戏的公共牌；不给就随机 round−1 张。 */
  readonly removed?: readonly number[];
  /** 区域牌堆顶上的几张（其余没用到的洗乱接在后面）。 */
  readonly regionDeck?: readonly number[];
  /** 圣所牌堆顶上的几张（其余没用到的洗乱接在后面）。 */
  readonly sanctuaryDeck?: readonly number[];
  /** true：圣所牌堆就是 sanctuaryDeck，没用到的圣所不进牌堆（测牌堆不够发用）。 */
  readonly sanctuaryDeckExact?: boolean;
  /** 阶段③现在轮到第几个人挑公共牌（默认 0；第 8 轮固定是人数）。 */
  readonly resolveIndex?: number;
  readonly options?: Partial<GameOptions>;
  /** 随机补牌用的种子（默认 7）。 */
  readonly seed?: number;
}

function defaultPlayer(index: number): { id: string; name: string } {
  return { id: `p${index + 1}`, name: SCENE_NAMES_OF_PLAYERS[index] ?? `玩家${index + 1}` };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * 按参数造一个精确局面。会检查牌不重复、编号合法；没指定的部分从剩下的牌里随机补，剩下的进牌堆（服务端字段），
 * 所以区域卡 68 张、圣所 45 张守恒（sanctuaryDeckExact 除外）。阶段③的顺序按每人出牌区最后一张自动算。
 */
export function buildGame(spec: ExactSpec): GameState {
  const specs: PlayerSpec[] = typeof spec.players === "number" ? Array.from({ length: spec.players }, () => ({})) : [...spec.players];
  const n = specs.length;
  const phase: Phase = spec.phase ?? "play";
  const round = phase === "ended" ? 8 : spec.round ?? 1;
  const rng = createRng(spec.seed ?? 7);
  const usedRegions = new Set<number>();
  const usedSanctuaries = new Set<number>();
  const claim = (cards: readonly number[], set: Set<number>, max: number, what: string) => {
    for (const card of cards) {
      if (!Number.isInteger(card) || card < 1 || card > max) throw new Error(`${what} ${card} 不存在。`);
      if (set.has(card)) throw new Error(`${what} ${card} 用了两次。`);
      set.add(card);
    }
  };
  for (const player of specs) {
    claim(player.hand ?? [], usedRegions, REGION_COUNT, "区域卡");
    claim(player.played ?? [], usedRegions, REGION_COUNT, "区域卡");
    if (player.pendingPlay != null) claim([player.pendingPlay], usedRegions, REGION_COUNT, "区域卡");
    claim(player.sanctuaries ?? [], usedSanctuaries, SANCTUARY_COUNT, "圣所卡");
    claim(player.offer ?? [], usedSanctuaries, SANCTUARY_COUNT, "圣所卡");
  }
  claim(spec.market ?? [], usedRegions, REGION_COUNT, "区域卡");
  claim(spec.removed ?? [], usedRegions, REGION_COUNT, "区域卡");
  claim(spec.regionDeck ?? [], usedRegions, REGION_COUNT, "区域卡");
  claim(spec.sanctuaryDeck ?? [], usedSanctuaries, SANCTUARY_COUNT, "圣所卡");
  let free = rng.shuffle(range(1, REGION_COUNT).filter((card) => !usedRegions.has(card)));
  const take = (count: number) => {
    const out = free.slice(0, count);
    free = free.slice(count);
    return out;
  };
  const playedLen = phase === "play" ? round - 1 : phase === "resolve" ? round : 8;
  const played = specs.map((player) => [...(player.played ?? take(playedLen))]);
  // 阶段③的顺序：按这一轮打出的（出牌区最后一张）从小到大
  const order = phase === "resolve" ? specs.map((_, i) => i).sort((a, b) => played[a]!.at(-1)! - played[b]!.at(-1)!) : [];
  const resolveIndex = phase === "resolve" ? (round >= 8 ? n : spec.resolveIndex ?? 0) : 0;
  const tookMarket = specs.map((_, i) => phase === "resolve" && round < 8 && order.indexOf(i) < resolveIndex);
  const handLen = (i: number) => {
    const player = specs[i]!;
    if (phase === "play") return HAND_SIZE - (player.pendingPlay != null ? 1 : 0);
    if (phase === "resolve") return HAND_SIZE - 1 + (tookMarket[i] ? 1 : 0);
    return HAND_SIZE - 1;
  };
  const hands = specs.map((player, i) => [...(player.hand ?? take(handLen(i)))].sort((a, b) => a - b));
  const marketLen = round >= 8 || phase === "ended" ? 0 : marketSize(n) - (phase === "resolve" ? resolveIndex : 0);
  const market = [...(spec.market ?? take(marketLen))].sort((a, b) => a - b);
  const removed = [...(spec.removed ?? take(Math.min(round - 1, 7)))];
  const regionDeck = [...(spec.regionDeck ?? []), ...free];
  const freeSanctuaries = rng.shuffle(range(1, SANCTUARY_COUNT).filter((card) => !usedSanctuaries.has(card)));
  const sanctuaryDeck = spec.sanctuaryDeckExact ? [...(spec.sanctuaryDeck ?? [])] : [...(spec.sanctuaryDeck ?? []), ...freeSanctuaries];
  const players: Player[] = specs.map((player, seat) => {
    const base = defaultPlayer(seat);
    const offer = [...(player.offer ?? [])];
    return {
      id: player.id ?? base.id,
      name: player.name ?? base.name,
      seat,
      hand: hands[seat]!,
      handCount: hands[seat]!.length,
      played: played[seat]!,
      sanctuaries: [...(player.sanctuaries ?? [])],
      submitted: phase === "play" ? player.pendingPlay != null : true,
      pendingPlay: phase === "play" ? player.pendingPlay ?? null : null,
      offer,
      offerCount: offer.length,
      offerWanted: player.offerWanted ?? offer.length,
      tookMarket: tookMarket[seat]!,
    };
  });
  let lastReveal: GameState["lastReveal"] = null;
  if (phase === "resolve") {
    const plays: RoundPlay[] = order.map((i) => {
      const cards = played[i]!;
      const card = cards.at(-1)!;
      return { player: players[i]!.id, card, discovered: discoveryFor(cards.slice(0, -1), [], card).discovered };
    });
    lastReveal = { round, plays };
  }
  const state: GameState = {
    config: defaultConfig(spec.options ?? {}, { minPlayers: 2 }),
    phase,
    players,
    round,
    market: phase === "ended" ? [] : market,
    removed,
    regionDeckCount: regionDeck.length,
    sanctuaryDeckCount: sanctuaryDeck.length,
    resolveOrder: order.map((i) => players[i]!.id),
    resolveIndex,
    lastReveal,
    events: [],
    version: 1,
    regionDeck,
    sanctuaryDeck,
    seed: spec.seed ?? 7,
    log: [],
  };
  if (phase === "ended") finalize(state);
  return state;
}

/** 给 phase = ended 的局面补上终局计分（buildGame 用；引擎里正常打完会自己算）。 */
function finalize(state: GameState): void {
  const scores: Record<string, ReturnType<typeof scorePlayer>> = {};
  for (const player of state.players) scores[player.id] = scorePlayer(player.played, player.sanctuaries);
  const ranking = rankPlayers(state.players.map((player) => ({ id: player.id, played: player.played, total: scores[player.id]!.total })));
  const first = scores[ranking[0]!]!.total;
  state.finalResult = {
    ranking,
    winners: [ranking[0]!],
    scores,
    tieBreak: ranking.length > 1 && scores[ranking[1]!]!.total === first,
  };
  state.round = 8;
}

/** 所有还没提交的人按 cards[座位] 出牌（已提交的人跳过）；最后一人提交时翻牌。 */
export function playRound(state: GameState, cards: readonly number[]): GameState {
  let current = state;
  current.players.forEach((player, seat) => {
    if (!player.submitted) current = applyCommand(current, player.id, { type: "play", card: cards[seat]! });
  });
  return current;
}

/** 阶段③：按顺序挑公共牌，picks[座位] 是那个人要挑的牌（没给就挑最小的）。不碰圣所。 */
export function takeAll(state: GameState, picks: Readonly<Record<number, number>> = {}): GameState {
  let current = state;
  for (let guard = 0; guard < 10 && current.phase === "resolve"; guard += 1) {
    const picker = currentPicker(current);
    if (!picker) break;
    const seat = current.players.findIndex((player) => player.id === picker);
    const card = picks[seat] ?? Math.min(...current.market);
    current = applyCommand(current, picker, { type: "take", card });
  }
  return current;
}

/** 阶段③：有圣所待选的人各留一张，keeps[座位] 是要留的（没给就留第一张）。 */
export function keepAll(state: GameState, keeps: Readonly<Record<number, number>> = {}): GameState {
  let current = state;
  for (const [seat, player] of state.players.entries()) {
    const live = current.players[seat]!;
    if (current.phase !== "resolve" || live.offer.length === 0) continue;
    current = applyCommand(current, player.id, { type: "keep", sanctuary: keeps[seat] ?? live.offer[0]! });
  }
  return current;
}

/** 用策略（默认简单基线，拿到的是各座位的 redact 视角）一步步推进，直到 until 成立或对局结束。 */
export function autoAdvance(state: GameState, until: (state: GameState) => boolean, policy: TimeoutPolicy = baselineCommand): GameState {
  let current = state;
  for (let guard = 0; guard < 500 && current.phase !== "ended" && !until(current); guard += 1) {
    const playerId = waitingFor(current)[0]!;
    const command = policy(redactGameForViewer(current, playerId), playerId) ?? baselineCommand(redactGameForViewer(current, playerId), playerId)!;
    current = applyCommand(current, playerId, command);
  }
  return current;
}

/** 一个座位挑公共牌之前的随机策略（场景里让局面多样一些）。 */
function seededPolicy(seed: number): TimeoutPolicy {
  const rng = createRng(seed);
  return (view, playerId) => {
    const player = view.players.find((candidate) => candidate.id === playerId)!;
    if (view.phase === "play" && !player.submitted) return { type: "play", card: rng.pick(player.hand) };
    if (view.phase === "resolve") {
      if (player.offer.length) return { type: "keep", sanctuary: rng.pick(player.offer) };
      if (currentPicker(view) === playerId) return { type: "take", card: rng.pick(view.market) };
    }
    return null;
  };
}

export const SCENE_NAMES = [
  "start",
  "play",
  "submitted",
  "pick",
  "pick-keep",
  "keep-wait",
  "watch-pick",
  "round8",
  "round8-keep",
  "short-deck",
  "timeout",
  "ended",
  "ended-tie",
  "full",
] as const;

export type SceneName = (typeof SCENE_NAMES)[number];

export const SCENE_DESCRIPTIONS: Record<SceneName, string> = {
  start: "开局：第 1 轮出牌，大家都还没出",
  play: "第 4 轮出牌：别人有的已提交，我还没出（手牌标能不能拿圣所）",
  submitted: "第 4 轮：我已提交，等别人",
  pick: "阶段③轮到我挑公共牌（没有圣所）",
  "pick-keep": "阶段③轮到我挑公共牌，同时抽到 3 张圣所待选",
  "keep-wait": "阶段③别人在挑公共牌，我有圣所待选",
  "watch-pick": "阶段③别人在挑，我没事做",
  round8: "第 8 轮出牌（没有公共牌）",
  "round8-keep": "第 8 轮翻牌后留圣所",
  "short-deck": "圣所牌堆不够发：后面的人少拿",
  timeout: "出牌超时：系统代打、翻牌（TimedOut）",
  ended: "终局：倒序计分完",
  "ended-tie": "终局：总分并列，比最小编号",
  full: "最多人数中盘：6 人第 7 轮，出牌区和圣所都多",
};

export interface SceneOptions {
  /** 人数，默认 4（ended-tie 默认 2，full 固定 6）。 */
  readonly players?: number;
  readonly seed?: number;
  readonly options?: Partial<GameOptions>;
}

const PLAYER_LIST = (n: number) => Array.from({ length: n }, (_, i) => defaultPlayer(i));

/** 按名字造局面（完整的服务端状态）。「我」是 p1。 */
export function createScene(name: SceneName, opts: SceneOptions = {}): GameState {
  const n = name === "full" ? 6 : opts.players ?? (name === "ended-tie" ? 2 : 4);
  const seed = opts.seed ?? 11;
  const fresh = () => createGame(PLAYER_LIST(n), seed, opts.options ?? {});
  const policy = seededPolicy(seed);
  const me = "p1";
  switch (name) {
    case "start":
      return fresh();
    case "play":
    case "submitted": {
      let state = autoAdvance(fresh(), (s) => s.round === 4 && s.phase === "play", policy);
      // 除了我和最后一位，别人都先提交
      for (const player of state.players.slice(1, -1)) state = applyCommand(state, player.id, { type: "play", card: player.hand[0]! });
      if (name === "submitted") state = applyCommand(state, me, { type: "play", card: state.players[0]!.hand.at(-1)! });
      return state;
    }
    case "pick":
      return buildGame({
        players: [
          { played: [12, 40, 9], sanctuaries: [16] },
          { played: [30, 52, 33], sanctuaries: [] },
          { played: [5, 45, 61], sanctuaries: [] },
          { played: [22, 3, 50], sanctuaries: [11] },
        ].slice(0, n),
        round: 3,
        phase: "resolve",
        options: opts.options ?? {},
        seed,
      });
    case "pick-keep":
      return buildGame({
        players: [
          { played: [44, 6, 15], sanctuaries: [], offer: [11, 29, 43] },
          { played: [30, 52, 33], sanctuaries: [] },
          { played: [5, 45, 61], sanctuaries: [], offer: [24, 2] },
          { played: [22, 3, 50], sanctuaries: [], offer: [7, 38, 19] },
        ].slice(0, n),
        round: 3,
        phase: "resolve",
        options: opts.options ?? {},
        seed,
      });
    case "keep-wait":
      return buildGame({
        players: [
          { played: [12, 8, 49], sanctuaries: [16], offer: [3, 22, 34, 40] },
          { played: [30, 52, 21], sanctuaries: [] },
          { played: [5, 45, 1], sanctuaries: [] },
          { played: [22, 3, 50], sanctuaries: [], offer: [9, 30] },
        ].slice(0, n),
        round: 3,
        phase: "resolve",
        options: opts.options ?? {},
        seed,
      });
    case "watch-pick":
      return buildGame({
        players: [
          { played: [12, 40, 66], sanctuaries: [] },
          { played: [30, 52, 21], sanctuaries: [] },
          { played: [5, 45, 1], sanctuaries: [] },
          { played: [22, 3, 50], sanctuaries: [], offer: [9, 30] },
        ].slice(0, n),
        round: 3,
        phase: "resolve",
        options: opts.options ?? {},
        seed,
      });
    case "round8":
      return autoAdvance(fresh(), (s) => s.round === 8 && s.phase === "play", policy);
    case "round8-keep": {
      // 第 8 轮：我比上一张大，一定能发现圣所
      let state = autoAdvance(fresh(), (s) => s.round === 8 && s.phase === "play", policy);
      const mine = state.players[0]!;
      const last = mine.played.at(-1)!;
      const bigger = mine.hand.find((card) => card > last);
      const cards = state.players.map((player, i) => (i === 0 ? bigger ?? Math.max(...player.hand) : player.hand[0]!));
      state = playRound(state, cards);
      return state;
    }
    case "short-deck":
      return buildGame({
        players: [
          { played: [15, 30], sanctuaries: [16], offer: [12, 29] },
          { played: [20, 50], sanctuaries: [], offer: [43], offerWanted: 3 },
          { played: [40, 2], sanctuaries: [] },
          { played: [33, 7], sanctuaries: [] },
        ].slice(0, n),
        round: 2,
        phase: "resolve",
        sanctuaryDeck: [],
        sanctuaryDeckExact: true,
        options: opts.options ?? {},
        seed,
      });
    case "timeout": {
      const state = autoAdvance(fresh(), (s) => s.round === 2 && s.phase === "play", policy);
      return timeoutTurn(state);
    }
    case "ended":
      return autoAdvance(fresh(), () => false, policy);
    case "ended-tie":
      // 两人都是 4 分：我出牌区最小是 1，对手最小是 19 → 我赢
      return buildGame({
        players: [
          { played: [3, 1, 2, 4, 6, 7, 8, 12], sanctuaries: [] },
          { played: [61, 22, 66, 45, 38, 19, 68, 58], sanctuaries: [] },
        ],
        phase: "ended",
        options: opts.options ?? {},
        seed,
      });
    case "full":
      return autoAdvance(fresh(), (s) => s.round === 7 && s.phase === "play", policy);
  }
}

export interface SceneRoomOptions {
  /** 从谁的视角看（默认 p1）；spectator 为 true 时看观战视角。 */
  readonly viewer?: string;
  readonly spectator?: boolean;
  readonly seeAll?: boolean;
  /** 这些座位是人机（名字换成咕噜X号）。 */
  readonly bots?: readonly string[];
  /** 这些座位托管中。 */
  readonly auto?: readonly string[];
  /** 这些座位离线。 */
  readonly offline?: readonly string[];
  /** 倒计时剩余毫秒（默认满）。 */
  readonly turnRemainingMs?: number;
}

/** 把局面包成网页收到的房间快照（预览页用）。 */
export function createSceneRoom(game: GameState, opts: SceneRoomOptions = {}): LobbyRoomSnapshot {
  const viewer = opts.viewer ?? "p1";
  let botIndex = 0;
  const members: LobbyMember[] = game.players.map((player, index) => {
    const bot = opts.bots?.includes(player.id) === true;
    return {
      id: `sock-${player.id}`,
      playerId: player.id,
      name: bot ? BOT_NAMES[botIndex++] ?? player.name : player.name,
      isHost: index === 0,
      connected: !(opts.offline?.includes(player.id) ?? false),
      ...(bot ? { bot: true } : {}),
      ...(opts.auto?.includes(player.id) ? { auto: true } : {}),
    };
  });
  const config = game.config;
  const fullMs = game.phase === "play" ? config.playTimeoutSec * 1000 : config.resolveTimeoutSec * 1000;
  const view = opts.spectator ? redactGameForSpectator(game, opts.seeAll === true) : redactGameForViewer(game, viewer);
  return {
    code: opts.spectator ? "" : "FAR299",
    spectators: opts.spectator ? [{ id: "sock-watcher", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, ...(opts.seeAll ? { spectatorsSeeAll: true } : {}) },
    options: { assist: config.assist },
    capacity: Math.max(2, game.players.length) as Capacity,
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: view,
    ...(game.phase !== "ended" ? { turnRemainingMs: opts.turnRemainingMs ?? fullMs } : {}),
    ...(game.phase === "ended"
      ? { rematch: { remainingMs: 60_000, acceptedIds: members.filter((member) => member.bot).map((member) => member.id) } }
      : {}),
  };
}
