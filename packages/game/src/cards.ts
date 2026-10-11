import { REGION_CARDS, SANCTUARY_CARDS } from "./cards-data.js";
import { COLORS, WONDERS, type PlayerScore, type Quest, type RegionCard, type SanctuaryCard, type Tally } from "./types.js";

export { REGION_CARDS, SANCTUARY_CARDS };

export const REGION_COUNT = 68;
export const SANCTUARY_COUNT = 45;
export const HAND_SIZE = 3;
export const ROUNDS = 8;

export function region(id: number): RegionCard {
  const card = REGION_CARDS[id - 1];
  if (!card || card.id !== id) throw new Error(`没有 ${id} 号区域卡。`);
  return card;
}

export function sanctuary(id: number): SanctuaryCard {
  const card = SANCTUARY_CARDS[id - 1];
  if (!card || card.id !== id) throw new Error(`没有 S${id} 圣所卡。`);
  return card;
}

export function emptyTally(): Tally {
  return { stone: 0, chimera: 0, thistle: 0, clue: 0, night: 0, red: 0, green: 0, blue: 0, yellow: 0 };
}

/** 往 tally 里加一张卡（区域或圣所；无色圣所不加颜色）。 */
export function addToTally(tally: Tally, card: RegionCard | SanctuaryCard): void {
  for (const wonder of WONDERS) tally[wonder] += card.wonders[wonder] ?? 0;
  tally.clue += card.clues;
  if (card.night) tally.night += 1;
  if (card.color) tally[card.color] += 1;
}

/** 数一组区域卡 + 圣所卡里的东西（规则书 §6.1 的 t）。 */
export function tally(regions: readonly number[], sanctuaries: readonly number[]): Tally {
  const t = emptyTally();
  for (const id of regions) addToTally(t, region(id));
  for (const id of sanctuaries) addToTally(t, sanctuary(id));
  return t;
}

/** 任务按可见计数 t 得几分。 */
export function questScore(quest: Quest | null, t: Tally): number {
  if (!quest) return 0;
  switch (quest.type) {
    case "flat":
      return quest.points;
    case "perIcon":
      return quest.points * t[quest.icon];
    case "perColor":
      return quest.points * quest.colors.reduce((sum, color) => sum + t[color], 0);
    case "perColorSet":
      return quest.points * Math.min(...COLORS.map((color) => t[color]));
  }
}

/** 前置条件满不满足（没有前置条件算满足）。 */
export function prereqMet(card: RegionCard, t: Tally): boolean {
  return WONDERS.every((wonder) => t[wonder] >= (card.prereq[wonder] ?? 0));
}

/**
 * 倒序计分（规则书 §6.2）：第 i 张区域卡（从左数）的可见集合 = played[i..] + 全部圣所。
 * 左边的卡（还没翻开）不算。8 张都翻完后用全部区域卡 + 圣所算圣所卡的任务。
 * 出牌区不满 8 张也能算（界面的「按现在算」就是用当前出牌区算的）。
 */
export function scorePlayer(played: readonly number[], sanctuaries: readonly number[]): PlayerScore {
  const regions = new Array<number>(played.length).fill(0);
  const prereqOk = new Array<boolean>(played.length).fill(true);
  const visible = tally([], sanctuaries);
  for (let i = played.length - 1; i >= 0; i -= 1) {
    const card = region(played[i]!);
    addToTally(visible, card);
    const ok = prereqMet(card, visible);
    prereqOk[i] = ok;
    regions[i] = ok ? questScore(card.quest, visible) : 0;
  }
  const scores = sanctuaries.map((id) => questScore(sanctuary(id).quest, visible));
  const regionTotal = regions.reduce((a, b) => a + b, 0);
  const sanctuaryTotal = scores.reduce((a, b) => a + b, 0);
  return { regions, prereqOk, sanctuaries: scores, regionTotal, sanctuaryTotal, total: regionTotal + sanctuaryTotal };
}

/** 出牌区 + 圣所上的线索总数。 */
export function clueCount(played: readonly number[], sanctuaries: readonly number[]): number {
  let clues = 0;
  for (const id of played) clues += region(id).clues;
  for (const id of sanctuaries) clues += sanctuary(id).clues;
  return clues;
}

/**
 * 打出 card 以后能不能发现圣所、要抽几张（规则书 §4.2）：编号比**上一张**（出牌区最右边那张）大才发现；
 * 抽 1 + 线索数张，线索算上刚打出的这张。第 1 轮（出牌区空）不发现。
 */
export function discoveryFor(played: readonly number[], sanctuaries: readonly number[], card: number): { discovered: boolean; count: number } {
  const last = played[played.length - 1];
  if (last === undefined || card <= last) return { discovered: false, count: 0 };
  return { discovered: true, count: 1 + clueCount(played, sanctuaries) + region(card).clues };
}

/** 出牌区里编号最小的那张（平局规则）；空的算无穷大。 */
export function smallestCard(played: readonly number[]): number {
  return played.length ? Math.min(...played) : Number.POSITIVE_INFINITY;
}
