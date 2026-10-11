import { HAND_SIZE, REGION_COUNT, SANCTUARY_COUNT } from "./cards.js";
import { marketSize, waitingFor } from "./engine.js";
import type { GameState } from "./types.js";

/**
 * 检查一个完整的服务端局面是否自洽，返回问题列表（空 = 没问题）。随机对局测试、预览局面测试都用它。
 * - 区域卡 68 张、圣所卡 45 张守恒，不重复；
 * - 出牌区、手牌、公共牌、移出的张数和轮次、阶段对得上；
 * - 公开的张数字段和实际一致；非终局时一定在等某个人（不会卡死）。
 */
export function stateProblems(state: GameState): string[] {
  const problems: string[] = [];
  const n = state.players.length;
  const regions: number[] = [...state.market, ...state.removed, ...(state.regionDeck ?? [])];
  const sanctuaries: number[] = [...(state.sanctuaryDeck ?? [])];
  for (const player of state.players) {
    regions.push(...player.hand, ...player.played);
    if (player.pendingPlay !== null) regions.push(player.pendingPlay);
    sanctuaries.push(...player.sanctuaries, ...player.offer);
    if (player.handCount !== player.hand.length) problems.push(`${player.id} handCount 不对`);
    if (player.offerCount !== player.offer.length) problems.push(`${player.id} offerCount 不对`);
    if (player.submitted !== (state.phase !== "play" || player.pendingPlay !== null)) problems.push(`${player.id} submitted 和 pendingPlay 对不上`);
    const playedLen = state.phase === "play" ? state.round - 1 : state.phase === "resolve" ? state.round : state.config.rounds;
    if (player.played.length !== playedLen) problems.push(`${player.id} 出牌区 ${player.played.length} 张，应为 ${playedLen}`);
    let handLen: number;
    if (state.phase === "play") handLen = HAND_SIZE - (player.submitted ? 1 : 0);
    else if (state.phase === "resolve") handLen = HAND_SIZE - 1 + (player.tookMarket ? 1 : 0);
    else handLen = HAND_SIZE - 1;
    if (player.hand.length !== handLen) problems.push(`${player.id} 手牌 ${player.hand.length} 张，应为 ${handLen}`);
    if (player.sanctuaries.length > Math.max(0, state.round - 1)) problems.push(`${player.id} 圣所太多`);
  }
  if (regions.length !== REGION_COUNT || new Set(regions).size !== REGION_COUNT) problems.push(`区域卡不守恒：${regions.length} 张，${new Set(regions).size} 种`);
  if (sanctuaries.length !== SANCTUARY_COUNT || new Set(sanctuaries).size !== SANCTUARY_COUNT) {
    problems.push(`圣所卡不守恒：${sanctuaries.length} 张，${new Set(sanctuaries).size} 种`);
  }
  if (state.regionDeck && state.regionDeckCount !== state.regionDeck.length) problems.push("regionDeckCount 不对");
  if (state.sanctuaryDeck && state.sanctuaryDeckCount !== state.sanctuaryDeck.length) problems.push("sanctuaryDeckCount 不对");
  const finishedMarkets = state.phase === "ended" ? state.config.rounds - 1 : Math.min(state.round - 1, state.config.rounds - 1);
  if (state.removed.length !== finishedMarkets) problems.push(`移出 ${state.removed.length} 张，应为 ${finishedMarkets}`);
  if (state.phase === "play") {
    const expected = state.round < state.config.rounds ? marketSize(n) : 0;
    if (state.market.length !== expected) problems.push(`出牌时公共牌 ${state.market.length} 张，应为 ${expected}`);
  }
  if (state.phase === "resolve") {
    const expected = state.round < state.config.rounds ? marketSize(n) - state.resolveIndex : 0;
    if (state.market.length !== expected) problems.push(`阶段③公共牌 ${state.market.length} 张，应为 ${expected}`);
    const order = state.resolveOrder.map((id) => state.players.find((player) => player.id === id)!.played.at(-1)!);
    if (order.some((card, i) => i > 0 && card < order[i - 1]!)) problems.push("阶段③顺序不是从小到大");
  }
  if (state.phase === "ended") {
    if (!state.finalResult) problems.push("终局没有计分");
  } else if (waitingFor(state).length === 0) {
    problems.push(`卡住了：${state.phase} 阶段没人要行动`);
  }
  return problems;
}
