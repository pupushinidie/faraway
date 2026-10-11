/** 每种人数 300 局随机对局：随机挑一个要行动的人、随机挑一个合法动作，走到终局。不变量用普通代码查，最后汇总断言。 */
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createGame,
  createRng,
  legalActions,
  redactGameForSpectator,
  redactGameForViewer,
  scorePlayer,
  stateProblems,
  timeoutTurn,
  waitingFor,
  type GameState,
} from "../src/index.js";

const GAMES = 300;
const MAX_STEPS = 400;

function leakProblems(state: GameState): string[] {
  const out: string[] = [];
  const views = [...state.players.map((player) => ({ who: player.id, view: redactGameForViewer(state, player.id) })), { who: "观战", view: redactGameForSpectator(state, false) }];
  for (const { who, view } of views) {
    if (view.regionDeck || view.sanctuaryDeck || view.seed !== undefined || view.rngState !== undefined || view.log) out.push(`${who} 看到了服务端字段`);
    for (const player of view.players) {
      if (player.id === who) continue;
      if (player.hand.length || player.offer.length || player.pendingPlay !== null) out.push(`${who} 看到了 ${player.id} 的暗牌`);
    }
  }
  return out;
}

function runGame(n: number, seed: number): string[] {
  const rng = createRng(seed * 7919 + n);
  let state = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })), seed);
  const problems: string[] = [];
  let lastRound = 1;
  let steps = 0;
  for (; steps < MAX_STEPS && state.phase !== "ended"; steps += 1) {
    const waiting = waitingFor(state);
    if (waiting.length === 0) {
      problems.push(`卡住：${state.phase} 第 ${state.round} 轮`);
      break;
    }
    // 偶尔用超时推进，测超时也不会卡
    if (rng.next() < 0.05) {
      state = timeoutTurn(state);
    } else {
      const playerId = rng.pick(waiting);
      const actions = legalActions(state, playerId);
      if (actions.length === 0) {
        problems.push(`${playerId} 在等他却没有合法动作`);
        break;
      }
      state = applyCommand(state, playerId, rng.pick(actions));
    }
    problems.push(...stateProblems(state));
    if (state.round < lastRound || state.round > lastRound + 1) problems.push(`轮次跳了：${lastRound} → ${state.round}`);
    lastRound = state.round;
    if (steps % 5 === 0) problems.push(...leakProblems(state));
    if (problems.length) break;
  }
  if (state.phase !== "ended") problems.push(`${MAX_STEPS} 步还没打完`);
  else {
    const result = state.finalResult!;
    for (const player of state.players) {
      if (player.played.length !== 8) problems.push(`${player.id} 出牌区不是 8 张`);
      if (result.scores[player.id]!.total !== scorePlayer(player.played, player.sanctuaries).total) problems.push("终局分数和 scorePlayer 不一致");
    }
    if (n === 6 && state.regionDeck!.length !== 1) problems.push(`6 人局牌堆应剩 1 张，剩 ${state.regionDeck!.length}`);
    if (state.removed.length !== 7) problems.push(`移出 ${state.removed.length} 张`);
  }
  return problems.map((problem) => `${n} 人 种子 ${seed}：${problem}`);
}

describe("随机对局", () => {
  it.each([2, 3, 4, 5, 6])("%i 人各 300 局：守恒、轮次、终局、不卡死、不泄露", (n) => {
    const problems: string[] = [];
    for (let seed = 1; seed <= GAMES && problems.length < 5; seed += 1) problems.push(...runGame(n, seed));
    expect(problems).toEqual([]);
  }, 60_000);
});
