// 遥远之地人机强度：人机（普通）对随机、对 greedy-now 基线（规则书 §9.7），以及自对弈耗时。
// 用法：npx tsx scripts/sim-faraway.ts [局数=300]
// 每局里人机坐一个座位（轮流换座），其余座位是对手策略；胜 = 第一名（平局规则一定分得出），报胜率、平均名次、平均分。
import {
  applyCommand,
  botCommand,
  createGame,
  currentPicker,
  legalActions,
  redactGameForViewer,
  region,
  scorePlayer,
  waitingFor,
  type GameCommand,
  type GameState,
} from "../packages/game/src/index.ts";

type Policy = (view: GameState, id: string) => GameCommand;
let r = 12345;
const rand = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;

export const randomPolicy: Policy = (view, id) => {
  const actions = legalActions(view, id);
  return actions[Math.floor(rand() * actions.length)]!;
};

/** greedy-now：出牌选「放在最右边立刻能得几分」最高的；挑公共牌选单张潜在分最高的；留圣所选让当前总分涨最多的。 */
export const greedyNow: Policy = (view, id) => {
  const me = view.players.find((p) => p.id === id)!;
  if (view.phase === "play") {
    let best = me.hand[0]!, bestScore = -1;
    for (const card of me.hand) {
      const s = scorePlayer([...me.played, card], me.sanctuaries).regions.at(-1)!;
      if (s > bestScore) { bestScore = s; best = card; }
    }
    return { type: "play", card: best };
  }
  if (me.offer.length) {
    let best = me.offer[0]!, bestScore = -1;
    for (const s of me.offer) {
      const v = scorePlayer(me.played, [...me.sanctuaries, s]).total;
      if (v > bestScore) { bestScore = v; best = s; }
    }
    return { type: "keep", sanctuary: best };
  }
  if (currentPicker(view) === id) {
    // 单张潜在分：这张放在最左边能看到全部已打出的卡时的任务分
    let best = view.market[0]!, bestScore = -1;
    for (const card of view.market) {
      const s = scorePlayer([card, ...me.played], me.sanctuaries).regions[0]!;
      const potential = s + (region(card).quest?.type === "flat" ? 0 : 0);
      if (potential > bestScore) { bestScore = potential; best = card; }
    }
    return { type: "take", card: best };
  }
  return legalActions(view, id)[0]!;
};

const timings: number[] = [];
const botPolicy: Policy = (view, id) => {
  const t0 = performance.now();
  const command = botCommand(view, id)!;
  timings.push(performance.now() - t0);
  return command;
};

export function playGame(policies: Policy[], seed: number): { ranking: number[]; scores: number[]; steps: number } {
  let state = createGame(policies.map((_, i) => ({ id: `p${i}`, name: `P${i}` })), seed);
  let steps = 0;
  while (state.phase !== "ended") {
    if (++steps > 200) throw new Error("步数超限");
    const id = waitingFor(state)[0]!;
    const seat = Number(id.slice(1));
    const command = policies[seat]!(redactGameForViewer(state, id), id);
    state = applyCommand(state, id, command);
  }
  const result = state.finalResult!;
  return { ranking: result.ranking.map((id) => Number(id.slice(1))), scores: state.players.map((p) => result.scores[p.id]!.total), steps };
}

function match(name: string, a: Policy, b: Policy, games: number, players: number): void {
  let wins = 0, rank = 0, sa = 0, sb = 0;
  for (let i = 0; i < games; i += 1) {
    const seat = i % players;
    const policies = Array.from({ length: players }, (_, k) => (k === seat ? a : b));
    const res = playGame(policies, 1000 + i);
    if (res.ranking[0] === seat) wins += 1;
    rank += res.ranking.indexOf(seat) + 1;
    sa += res.scores[seat]!;
    sb += res.scores.filter((_, k) => k !== seat).reduce((x, y) => x + y, 0) / (players - 1);
  }
  console.log(`${name}（${players} 人，${games} 局）：胜率 ${(100 * wins / games).toFixed(1)}%（公平 ${(100 / players).toFixed(0)}%），平均名次 ${(rank / games).toFixed(2)}，平均分 ${(sa / games).toFixed(1)} 对 ${(sb / games).toFixed(1)}`);
}

const GAMES = Number(process.argv[2] ?? 300);
const only = process.argv[3];
if (!only || only === "random") {
  match("人机 vs 随机", botPolicy, randomPolicy, GAMES, 2);
  match("greedy-now vs 随机", greedyNow, randomPolicy, GAMES, 2);
}
if (!only || only === "greedy") {
  for (const n of [2, 3, 4, 6]) match("人机 vs greedy-now", botPolicy, greedyNow, GAMES, n);
}
if (!only || only === "self") {
  for (const n of [2, 3, 4, 5, 6]) {
    let total = 0;
    for (let i = 0; i < GAMES; i += 1) total += playGame(Array.from({ length: n }, () => botPolicy), 5000 + i).scores.reduce((x, y) => x + y, 0) / n;
    console.log(`自对弈 ${n} 人 ${GAMES} 局：平均每人 ${(total / GAMES).toFixed(1)} 分`);
  }
}
timings.sort((x, y) => x - y);
console.log(`人机决策 ${timings.length} 步：平均 ${(timings.reduce((x, y) => x + y, 0) / timings.length).toFixed(1)}ms，P99 ${timings[Math.floor(timings.length * 0.99)]?.toFixed(1)}ms，最坏 ${timings.at(-1)?.toFixed(1)}ms`);
