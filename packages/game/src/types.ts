/** 地形颜色：红＝菌林、绿＝溪谷、蓝＝石原、黄＝岩城。 */
export type Color = "red" | "green" | "blue" | "yellow";
/** 三种奇观（资源）：奇石、灵兽（规则书叫奇美拉）、蓟草。 */
export type Wonder = "stone" | "chimera" | "thistle";
/** 任务「每个 X」能数的东西。 */
export type Icon = Wonder | "clue" | "night";

export const COLORS: readonly Color[] = ["red", "green", "blue", "yellow"];
export const WONDERS: readonly Wonder[] = ["stone", "chimera", "thistle"];

/** 任务（规则书 §6.1 的四种参数化类型）。 */
export type Quest =
  | { readonly type: "flat"; readonly points: number }
  | { readonly type: "perIcon"; readonly points: number; readonly icon: Icon }
  | { readonly type: "perColor"; readonly points: number; readonly colors: readonly Color[] }
  | { readonly type: "perColorSet"; readonly points: number };

export interface RegionCard {
  /** 1–68，也是探索时间。 */
  readonly id: number;
  readonly color: Color;
  readonly night: boolean;
  readonly clues: number;
  readonly wonders: Partial<Record<Wonder, number>>;
  /** 前置条件（至少要有的资源）；空对象 = 没有。 */
  readonly prereq: Partial<Record<Wonder, number>>;
  readonly quest: Quest | null;
}

export interface SanctuaryCard {
  /** 1–45（界面写成 S01–S45）。 */
  readonly id: number;
  /** null = 无色。 */
  readonly color: Color | null;
  readonly night: boolean;
  readonly clues: number;
  readonly wonders: Partial<Record<Wonder, number>>;
  readonly quest: Quest | null;
}

/** 可见集合里各种东西的个数（规则书 §6.1 的 t）。 */
export type Tally = Record<Wonder | "clue" | "night" | Color, number>;

/** 开房选项（开工拍板：辅助显示默认开，开房时可以关；进阶开局不做）。 */
export interface GameOptions {
  /** 辅助显示：手牌标能不能拿圣所、能抽几张；出牌区每张卡标按现在算能得几分。 */
  readonly assist: boolean;
}

export interface Config extends GameOptions {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 一局几轮（8）。 */
  readonly rounds: number;
  /** 出牌限时（秒）。 */
  readonly playTimeoutSec: number;
  /** 挑公共牌 / 留圣所限时（秒）。 */
  readonly resolveTimeoutSec: number;
}

/**
 * play：所有人同时从手牌里选 1 张打出（提交后不能撤回），最后一人提交的瞬间同时翻开；
 * resolve：按这一轮打出的编号从小到大轮流挑公共牌（第 8 轮不挑），抽到圣所的人同时各留 1 张；
 * ended：8 轮打完，已经倒序计分，finalResult 有名次。
 */
export type Phase = "play" | "resolve" | "ended";

/** 终局一位玩家的计分明细。 */
export interface PlayerScore {
  /** 区域卡得分，下标对应 played（从左到右）。 */
  readonly regions: number[];
  /** 区域卡计分时前置条件满不满足（没有前置条件算满足），下标对应 played。 */
  readonly prereqOk: boolean[];
  /** 圣所卡得分，下标对应 sanctuaries。 */
  readonly sanctuaries: number[];
  readonly regionTotal: number;
  readonly sanctuaryTotal: number;
  readonly total: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 座位序号（入座顺序）。 */
  readonly seat: number;
  /** 手牌（区域卡编号，从小到大）。**隐藏**：别人看到空数组，张数看 handCount。已提交的那张不在这里，在 pendingPlay。 */
  hand: number[];
  /** 手牌张数（公开，不含已提交的那张）。 */
  handCount: number;
  /** 出牌区，左 → 右（公开）。 */
  played: number[];
  /** 留下的圣所卡（公开，计分时一直可见）。 */
  sanctuaries: number[];
  /** 这一轮已经提交出牌（公开）。 */
  submitted: boolean;
  /** 这一轮提交的那张。**隐藏**：只有自己看得到，别人看到 null；翻开时进 played。 */
  pendingPlay: number | null;
  /** 阶段②抽到、还没选的圣所卡。**隐藏**：别人看到空数组，张数看 offerCount。 */
  offer: number[];
  /** 抽到待选的圣所张数（公开）。 */
  offerCount: number;
  /** 这一轮发现圣所时本来要抽几张（1 + 线索）；牌堆不够时实际抽到的会比它少。没发现是 0。公开。 */
  offerWanted: number;
  /** 这一轮挑过公共牌了（公开）。 */
  tookMarket: boolean;
}

/** 一次翻牌里的一个人：打出的牌、有没有发现圣所。 */
export interface RoundPlay {
  readonly player: string;
  readonly card: number;
  /** 比上一张大，发现了圣所。 */
  readonly discovered: boolean;
}

export interface FinalResult {
  /** 名次从高到低（总分高的在前；并列时出牌区里编号最小的那张更小的在前）。 */
  readonly ranking: string[];
  /** 第一名（平局规则一定能分出来，所以只有一个人；留数组给界面统一处理）。 */
  readonly winners: string[];
  readonly scores: Record<string, PlayerScore>;
  /** 第一名是不是靠平局规则（最小编号）赢的。 */
  readonly tieBreak: boolean;
}

/**
 * 玩家的动作。每个动作都可以带 step：发出时自己看到的 stepKey(game)。
 * 带了而且和服务器当前的对不上（这一步已经超时代做了、点击才到），就拒绝，免得迟到的点击落到下一步。
 */
export type GameCommand =
  /** 阶段①：打出一张手牌（提交后不能撤回）。 */
  | { readonly type: "play"; readonly card: number; readonly step?: string }
  /** 阶段③：轮到自己时挑一张公共牌。 */
  | { readonly type: "take"; readonly card: number; readonly step?: string }
  /** 阶段③：从抽到的圣所里留一张（其余放回圣所牌堆底）。不用排队。 */
  | { readonly type: "keep"; readonly sanctuary: number; readonly step?: string };

export type GameEvent =
  /** 有人提交了出牌（不含牌面）。 */
  | { readonly type: "Submitted"; readonly player: string }
  /** 所有人都提交了，同时翻开；plays 按编号从小到大。 */
  | { readonly type: "Revealed"; readonly round: number; readonly plays: RoundPlay[] }
  /** 发现圣所：抽到 count 张（本来要 wanted 张；牌堆不够时少拿）。不含牌面。 */
  | { readonly type: "SanctuariesDrawn"; readonly player: string; readonly count: number; readonly wanted: number }
  /** 挑了一张公共牌。 */
  | { readonly type: "MarketTaken"; readonly player: string; readonly card: number }
  /** 留下一张圣所（正面朝上，公开）；returned 张放回牌堆底（不公开是哪几张）。 */
  | { readonly type: "SanctuaryKept"; readonly player: string; readonly sanctuary: number; readonly returned: number }
  /** 公共牌剩下的那张移出游戏。 */
  | { readonly type: "MarketRemoved"; readonly card: number }
  /** 新一轮开始；market 是新翻的公共牌（第 8 轮是空的）。 */
  | { readonly type: "RoundStarted"; readonly round: number; readonly market: number[] }
  | { readonly type: "GameEnded"; readonly ranking: string[]; readonly totals: Record<string, number> }
  /** 超时：这些人由系统代做了这一步。 */
  | { readonly type: "TimedOut"; readonly phase: Phase; readonly players: string[] };

/** 服务端记的动作序列（不含 step）：同一种子按顺序重放就能复现整局。auto = 超时 / 托管 / 离线时代做。 */
export interface LogEntry {
  readonly player: string;
  readonly command: GameCommand;
  readonly auto?: true;
}

export interface GameState {
  readonly config: Config;
  phase: Phase;
  players: Player[];
  /** 第几轮（1–8）。 */
  round: number;
  /** 公共牌（公开）。第 8 轮是空的。 */
  market: number[];
  /** 移出游戏的公共牌（公开）。 */
  removed: number[];
  /** 区域牌堆、圣所牌堆还剩几张（公开；顺序只在服务端）。 */
  regionDeckCount: number;
  sanctuaryDeckCount: number;
  /** 本轮阶段③的顺序（按打出的编号从小到大），play 阶段是空的。 */
  resolveOrder: string[];
  /** 现在轮到 resolveOrder 里第几个人挑公共牌；= resolveOrder.length 表示挑完了（第 8 轮一开始就是）。 */
  resolveIndex: number;
  /** 本轮翻开的牌（公开）；下一轮翻牌前一直留着，给界面放动画、重连的人补看。 */
  lastReveal: { readonly round: number; readonly plays: RoundPlay[] } | null;
  /** 最近一步产生的事件。 */
  events: GameEvent[];
  finalResult?: FinalResult;
  /** 每个动作 +1；界面看它变没变触发动画。 */
  version: number;
  /** 以下只在服务端：区域牌堆（下标 0 是顶）、圣所牌堆（下标 0 是顶，放回的进末尾 = 底）、种子、随机数状态、动作序列。 */
  regionDeck?: number[];
  sanctuaryDeck?: number[];
  seed?: number | string;
  rngState?: number | string;
  log?: LogEntry[];
}
