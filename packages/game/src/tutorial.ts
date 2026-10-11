/**
 * 新手教程的剧本（遥远之地，规则书 §9.8）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：2 人局（你 + 咕噜一号），开局手牌、每轮公共牌、圣所牌堆都按剧本摆好（不洗牌），
 * 8 轮你和咕噜一号出什么、挑什么、留哪张圣所都由剧本定。你最后正好是规则书例 1 的 80 分；
 * 咕噜一号的 66（要 4 个奇石）右边一个奇石都没有，终局得 0 分，用来讲「前置条件不够就 0 分」。
 * 剧本走完可以和人机打一局练习（新开一局，随机发牌）。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，test/tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { createGame, currentPicker, waitingFor } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/** 剧本里的一步棋：谁、做什么（同时出牌的游戏，要写明是谁）。 */
export interface TutorialMove {
  readonly player: string;
  readonly command: GameCommand;
}

interface StepBase {
  readonly id: string;
  /** 进度点里这一课叫什么；同一课的后几步不写。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px），最多两句。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值；写成数组时按顺序用页面上看得见的第一个。
   * 固定的有 hand、market、my-row、my-score、order、status、action、my-sanctuaries、offer、final；
   * 一张手牌是 hand:<编号>，公共牌 market:<编号>，抽到的圣所 offer:<编号>，出牌区 played:<编号>，终局一行 final:<玩家 id>。
   */
  readonly anchor?: string | readonly string[];
  /** 两步操作的第二步（do 步骤用）：选中 anchor 那张以后，高亮挪到这里（confirm）。 */
  readonly then?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: TutorialMove })
  /** 咕噜一号按剧本自动走这几步，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialMove[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_BOT = { id: "p2", name: "咕噜一号" } as const;
const BOT = TUTORIAL_BOT.id;

/**
 * 固定发牌（规则书 §9.8 的表）：开局手牌、7 轮公共牌（每轮 3 张，从牌堆顶依次翻）、圣所牌堆从顶往下。
 * 圣所按本轮编号从小到大发：你 16→S11、S05；咕噜一号 66→S27、S36；你 23→S03、S24；咕噜一号 52→S14、S17、S41、S19；
 * 你 18→S22、S30；你 28→S40、S12；咕噜一号 57→S45、S31、S18、S32；你 35→S44、S06；咕噜一号 60→S29、S13、S20、S21、S25。
 * （咕噜一号的 12、33、60 和圣所 S27 上有线索，所以他抽得多。）
 */
export const TUTORIAL_DEAL = {
  hands: [[45, 8, 16], [30, 12, 66]],
  regionDeck: [23, 60, 9, 1, 52, 14, 18, 33, 6, 28, 47, 2, 35, 57, 11, 50, 4, 63, 61, 22, 43],
  sanctuaryDeck: [11, 5, 27, 36, 3, 24, 14, 17, 41, 19, 22, 30, 40, 12, 45, 31, 18, 32, 44, 6, 29, 13, 20, 21, 25],
} as const;

const me = (command: GameCommand): TutorialMove => ({ player: TUTORIAL_SELF, command });
const bot = (command: GameCommand): TutorialMove => ({ player: BOT, command });
const play = (card: number): GameCommand => ({ type: "play", card });
const take = (card: number): GameCommand => ({ type: "take", card });
const keep = (sanctuary: number): GameCommand => ({ type: "keep", sanctuary });

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // ---------- 目标和读卡 ----------
  {
    kind: "info", id: "hello", lesson: "目标",
    say: "欢迎来到遥远之地！8 轮出 8 张卡，总分高的赢。",
    note: "我是咕噜嘎。这一局你和咕噜一号对打，我一步一步带你。",
    face: "happy",
  },
  {
    kind: "info", id: "read-card", lesson: "读卡",
    say: "先认一张卡：左上是编号，右上是它给的资源。",
    note: "右下是任务（怎么得分），上面的小框是前置条件：45 要先有 3 只灵兽，才得 13 分。",
    anchor: "hand:45",
  },
  {
    kind: "info", id: "reverse",
    say: "终局从最右边往左翻牌，每张只看得到自己和右边的卡。",
    note: "所以要资源多的卡早打，放在最左边；只给资源的卡晚打，放在右边。",
    anchor: "my-row", face: "think",
  },
  // ---------- 第 1 轮：同时出牌、编号小先挑 ----------
  {
    kind: "do", id: "r1-play", lesson: "同时出牌",
    say: "把 45 打出去：点一下选中，再点一下确认。",
    note: "大家同时出牌，出了不能撤回。",
    anchor: "hand:45", then: "confirm",
    expect: me(play(45)),
  },
  {
    kind: "watch", id: "r1-bot", say: "咕噜一号也出好了，两张一起翻开。",
    anchor: "status",
    moves: [bot(play(30))],
  },
  {
    kind: "info", id: "r1-order", lesson: "编号小先挑",
    say: "编号小的先挑公共牌：咕噜一号的 30 比你的 45 小，他先挑。",
    note: "第 1 轮没有上一张，谁都没有圣所。",
    anchor: "order",
  },
  { kind: "watch", id: "r1-bot-take", say: "咕噜一号挑走了 60。", anchor: "market", moves: [bot(take(60))] },
  {
    kind: "do", id: "r1-take",
    say: "轮到你：挑 23，它给灵兽，以后帮 45 凑条件。",
    note: "挑完手牌回到 3 张。剩下的那张移出游戏，下一轮翻新的公共牌。",
    anchor: "market:23", then: "confirm",
    expect: me(take(23)),
  },
  // ---------- 第 2 轮：小编号抢先 ----------
  {
    kind: "do", id: "r2-play",
    say: "这轮出 8：编号小，你能先挑公共牌。",
    note: "8 号卡上有个线索（地图），以后抽圣所会多抽一张。",
    anchor: "hand:8", then: "confirm",
    expect: me(play(8)),
  },
  { kind: "watch", id: "r2-bot", say: "咕噜一号出了 12，比你的 8 大。", anchor: "order", moves: [bot(play(12))] },
  {
    kind: "do", id: "r2-take",
    say: "你先挑：拿 1，它给奇石和灵兽。",
    anchor: "market:1", then: "confirm",
    expect: me(take(1)),
  },
  { kind: "watch", id: "r2-bot-take", say: "咕噜一号拿了 52。", anchor: "market", moves: [bot(take(52))] },
  // ---------- 第 3 轮：发现圣所、线索 ----------
  {
    kind: "info", id: "r3-discover", lesson: "发现圣所",
    say: "比自己上一张大，就能发现圣所。",
    note: "16 比你上一张 8 大。手牌下面的「圣所×2」就是打它能抽几张。",
    anchor: "hand:16",
  },
  {
    kind: "do", id: "r3-play", say: "出 16。",
    anchor: "hand:16", then: "confirm",
    expect: me(play(16)),
  },
  { kind: "watch", id: "r3-bot", say: "咕噜一号出了 66，他也比上一张 12 大。", anchor: "order", moves: [bot(play(66))] },
  {
    kind: "info", id: "r3-clue", lesson: "线索",
    say: "抽几张看线索：1 张，加上出牌区和圣所里的线索数。",
    note: "你的 8 有 1 个线索，所以抽了 2 张。只能留 1 张，其余放回牌堆底。",
    anchor: "offer",
  },
  {
    kind: "do", id: "r3-keep",
    say: "留下给灵兽的这张：圣所的资源计分时一直算。",
    anchor: "offer:11", then: "confirm",
    expect: me(keep(11)),
  },
  {
    kind: "do", id: "r3-take", say: "再挑公共牌：拿 18。",
    note: "留圣所和挑牌两件事，先做哪件都行。",
    anchor: "market:18", then: "confirm",
    expect: me(take(18)),
  },
  { kind: "watch", id: "r3-bot-done", say: "咕噜一号留好圣所，拿了 33。", anchor: "market", moves: [bot(keep(27)), bot(take(33))] },
  // ---------- 第 4 轮：有颜色的圣所 ----------
  {
    kind: "do", id: "r4-play", lesson: "有颜色的圣所",
    say: "出 23：比 16 大，又能发现圣所。",
    anchor: "hand:23", then: "confirm",
    expect: me(play(23)),
  },
  { kind: "watch", id: "r4-bot", say: "咕噜一号出了 33，比他上一张 66 小，这轮没有圣所。", anchor: "order", moves: [bot(play(33))] },
  {
    kind: "info", id: "r4-color",
    say: "有颜色的圣所也算一张那种地形的卡。",
    note: "这张蓝色圣所算一张石原卡，「每张蓝色」的任务也数它。",
    anchor: "offer:3",
  },
  { kind: "do", id: "r4-keep", say: "留下这张蓝色圣所。", anchor: "offer:3", then: "confirm", expect: me(keep(3)) },
  { kind: "do", id: "r4-take", say: "挑 28。", anchor: "market:28", then: "confirm", expect: me(take(28)) },
  { kind: "watch", id: "r4-bot-take", say: "咕噜一号拿了 47。", anchor: "market", moves: [bot(take(47))] },
  // ---------- 第 5 轮：资源不会用掉、辅助显示 ----------
  {
    kind: "info", id: "r5-reuse", lesson: "资源不会用掉",
    say: "资源用了不会消失，一只灵兽可以同时帮好几张卡。",
    note: "出牌区卡下面的数字是按现在算能得几分；红色「缺条件」是资源还不够。",
    anchor: "my-row", face: "think",
  },
  {
    kind: "do", id: "r5-play",
    say: "这轮出 1：它只给资源，正好放在右边。",
    note: "1 比上一张 23 小，这轮没有圣所，但你能先挑公共牌。",
    anchor: "hand:1", then: "confirm",
    expect: me(play(1)),
  },
  { kind: "watch", id: "r5-bot", say: "咕噜一号出了 52，他发现了圣所。", anchor: "order", moves: [bot(play(52))] },
  { kind: "do", id: "r5-take", say: "你先挑：拿 35。", anchor: "market:35", then: "confirm", expect: me(take(35)) },
  { kind: "watch", id: "r5-bot-done", say: "咕噜一号留好圣所，拿了 57。", anchor: "market", moves: [bot(keep(14)), bot(take(57))] },
  // ---------- 第 6 轮：四色套 ----------
  {
    kind: "do", id: "r6-play", lesson: "四色套",
    say: "出 18：比 1 大，发现圣所。",
    anchor: "hand:18", then: "confirm",
    expect: me(play(18)),
  },
  { kind: "watch", id: "r6-bot", say: "咕噜一号出了 47。", anchor: "order", moves: [bot(play(47))] },
  {
    kind: "info", id: "r6-set",
    say: "四色套：菌林、溪谷、石原、岩城各 1 张算一套。",
    note: "这张黄色圣所每凑一套给 4 分，它自己也算一张岩城。",
    anchor: "offer:22",
  },
  { kind: "do", id: "r6-keep", say: "留下这张四色套圣所。", anchor: "offer:22", then: "confirm", expect: me(keep(22)) },
  { kind: "do", id: "r6-take", say: "挑 50。", anchor: "market:50", then: "confirm", expect: me(take(50)) },
  { kind: "watch", id: "r6-bot-take", say: "咕噜一号拿了 4。", anchor: "market", moves: [bot(take(4))] },
  // ---------- 第 7 轮 ----------
  { kind: "do", id: "r7-play", say: "出 28：比 18 大，再拿一张圣所。", anchor: "hand:28", then: "confirm", expect: me(play(28)) },
  { kind: "watch", id: "r7-bot", say: "咕噜一号出了 57。", anchor: "order", moves: [bot(play(57))] },
  {
    kind: "do", id: "r7-keep",
    say: "留下这张：每只灵兽 1 分，你的灵兽很多。",
    anchor: "offer:40", then: "confirm",
    expect: me(keep(40)),
  },
  { kind: "do", id: "r7-take", say: "挑 61。", anchor: "market:61", then: "confirm", expect: me(take(61)) },
  { kind: "watch", id: "r7-bot-done", say: "咕噜一号留好圣所，拿了 22。", anchor: "market", moves: [bot(keep(31)), bot(take(22))] },
  // ---------- 第 8 轮：不挑公共牌 ----------
  {
    kind: "info", id: "r8-last", lesson: "最后一轮",
    say: "第 8 轮是最后一轮，不再挑公共牌。",
    note: "打完手里还剩 2 张，它们不计分。比上一张大照样能拿圣所。",
    anchor: "market",
  },
  {
    kind: "do", id: "r8-play",
    say: "出 35：它给灵兽，又是夜，放在最右边正好。",
    anchor: "hand:35", then: "confirm",
    expect: me(play(35)),
  },
  { kind: "watch", id: "r8-bot", say: "咕噜一号出了 60。", anchor: "order", moves: [bot(play(60))] },
  { kind: "do", id: "r8-keep", say: "留下这张：一个月亮和一只灵兽。", note: "圣所上的月亮算 1 个夜。", anchor: "offer:44", then: "confirm", expect: me(keep(44)) },
  { kind: "watch", id: "r8-bot-keep", say: "咕噜一号也留好了，开始计分！", anchor: "status", moves: [bot(keep(29))] },
  // ---------- 倒序计分 ----------
  {
    kind: "info", id: "score-reverse", lesson: "倒序计分",
    say: "从右往左翻：每张只看得到自己、右边的卡和全部圣所。",
    note: "你的 45 在最左边，右边的灵兽它全看得到，拿到 13 分。",
    anchor: "final:p1",
  },
  {
    kind: "info", id: "score-prereq",
    say: "咕噜一号的 66 要 4 个奇石，右边一个都没有，只能得 0 分。",
    note: "前置条件不够，任务再值钱也是 0 分。要求高的卡一定要早打。",
    anchor: "final:p2", face: "surprised",
  },
  {
    kind: "info", id: "score-total",
    say: "8 张翻完再算圣所的任务，你一共 80 分，赢了！",
    note: "总分一样时，出牌区里有编号最小那张卡的人赢。",
    anchor: "final:p1", face: "happy",
  },
  {
    kind: "info", id: "end", lesson: "开打",
    say: "学会了！和咕噜一号打一局练习吧。",
    note: "练习局里拿不准就点「提示」。真实对局超时会由人机代打，连续两次就转托管，点「取消托管」交还。",
    face: "happy", finale: true,
  },
];

/** 教程开局：2 人，固定发牌。 */
export function createTutorialGame(selfName: string): GameState {
  return createGame(
    [{ id: TUTORIAL_SELF, name: selfName }, { id: BOT, name: TUTORIAL_BOT.name }],
    20261011,
    { assist: true },
    {},
    {
      hands: TUTORIAL_DEAL.hands.map((hand) => [...hand]),
      regionDeck: [...TUTORIAL_DEAL.regionDeck],
      sanctuaryDeck: [...TUTORIAL_DEAL.sanctuaryDeck],
    },
  );
}

/** 练习局：你 + 咕噜一号，随机发牌，辅助显示开。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: BOT, name: TUTORIAL_BOT.name }], seed, { assist: true });
}

/** 现在轮到谁（练习局里人机替它走）：等着的人里先是人机，再是你；对局结束返回 null。 */
export function tutorialActor(state: GameState, self: string = TUTORIAL_SELF): string | null {
  const waiting = waitingFor(state);
  return waiting.find((id) => id !== self) ?? waiting[0] ?? null;
}

/** 你现在能不能动（出牌、挑牌、留圣所都看引擎的 waitingFor）。 */
export function selfCanAct(state: GameState, self: string = TUTORIAL_SELF): boolean {
  return waitingFor(state).includes(self);
}

/** 两步是不是同一步（同一个人、同一个动作；不看 step 字段）。 */
export function sameMove(a: TutorialMove, b: TutorialMove): boolean {
  if (a.player !== b.player || a.command.type !== b.command.type) return false;
  if (a.command.type === "keep" && b.command.type === "keep") return a.command.sanctuary === b.command.sanctuary;
  if (a.command.type === "keep" || b.command.type === "keep") return false;
  return a.command.card === b.command.card;
}

/** 这一步的锚点候选（按顺序）。 */
export function anchorCandidates(step: TutorialStep): readonly string[] {
  if (!step.anchor) return [];
  return typeof step.anchor === "string" ? [step.anchor] : step.anchor;
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件；不考虑动画中途）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string = TUTORIAL_SELF): boolean {
  const mine = state.players.find((player) => player.id === viewer);
  if (!mine) return false;
  if (["hand", "market", "my-row", "my-score", "status", "action", "my-sanctuaries", "opponents"].includes(anchor)) return state.phase !== "ended";
  if (anchor === "order") return state.phase === "resolve" || state.phase === "play";
  if (anchor === "offer") return state.phase === "resolve" && mine.offer.length > 0;
  if (anchor === "confirm") return state.phase !== "ended";
  if (anchor === "final") return state.phase === "ended";
  if (anchor.startsWith("final:")) return state.phase === "ended" && state.players.some((player) => player.id === anchor.slice(6));
  const [kind, raw] = anchor.split(":");
  const id = Number(raw);
  if (kind === "hand") return state.phase !== "ended" && mine.hand.includes(id);
  if (kind === "market") return state.phase !== "ended" && state.market.includes(id);
  if (kind === "offer") return state.phase === "resolve" && mine.offer.includes(id);
  if (kind === "played") return state.phase !== "ended" && mine.played.includes(id);
  if (kind === "seat") return raw !== viewer && state.players.some((player) => player.id === raw);
  return false;
}

/** 剧本里这一步该谁动（单测和网页都用）：阶段③先是挑公共牌的人。 */
export function scriptPicker(state: GameState): string | null {
  return currentPicker(state);
}
