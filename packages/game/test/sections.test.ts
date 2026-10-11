/** 规则书每一节的场景测试：精确局面 → 精确结果。测试名带章节号。 */
import { describe, expect, it } from "vitest";
import {
  apply,
  applyCommand,
  buildGame,
  createGame,
  discoveryFor,
  keepAll,
  legalActions,
  playRound,
  scorePlayer,
  stepKey,
  takeAll,
  timeoutTurn,
  waitingFor,
  type GameState,
} from "../src/index.js";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));
const P = (state: GameState, id: string) => state.players.find((player) => player.id === id)!;

describe("§3 开局", () => {
  it.each([2, 3, 4, 5, 6])("§3 %i 人：每人 3 张、公共牌人数+1、牌堆 68−3N−(N+1)、圣所 45；没人出过牌", (n) => {
    const state = createGame(players(n), n);
    expect(state.players.every((player) => player.hand.length === 3 && player.played.length === 0)).toBe(true);
    expect(state.market.length).toBe(n + 1);
    expect(state.regionDeck!.length).toBe(68 - 3 * n - (n + 1));
    expect(state.sanctuaryDeckCount).toBe(45);
    expect(waitingFor(state).length).toBe(n);
  });
  it("§3 1 人或 7 人不能开局", () => {
    expect(() => createGame(players(1), 1)).toThrow();
    expect(() => createGame(players(7), 1)).toThrow();
  });
  it("§3 同一种子发同样的牌；不同种子不同", () => {
    expect(createGame(players(3), "ab".repeat(16)).players[0]!.hand).toEqual(createGame(players(3), "ab".repeat(16)).players[0]!.hand);
    const a = createGame(players(4), 1);
    const b = createGame(players(4), 2);
    expect(JSON.stringify(a.regionDeck)).not.toBe(JSON.stringify(b.regionDeck));
  });
});

describe("§4.1 同时出牌", () => {
  it("§4.1 提交后不能撤回、不能再出；不在手里的牌不能出；出牌阶段不能挑公共牌", () => {
    let state = createGame(players(2), 5, {}, {}, { hands: [[10, 20, 30], [11, 21, 31]] });
    expect(() => applyCommand(state, "p1", { type: "play", card: 11 })).toThrow();
    expect(() => applyCommand(state, "p1", { type: "take", card: state.market[0]! })).toThrow();
    state = applyCommand(state, "p1", { type: "play", card: 20 });
    expect(() => applyCommand(state, "p1", { type: "play", card: 10 })).toThrow();
    expect(legalActions(state, "p1")).toEqual([]);
  });
  it("§4.1 最后一人提交前谁的出牌区都不变；最后一人提交时同时翻开、各自放到最右边", () => {
    let state = buildGame({ players: [{ played: [5], hand: [10, 20, 30] }, { played: [6], hand: [11, 21, 31] }, { played: [7], hand: [12, 22, 32] }], round: 2 });
    state = applyCommand(state, "p1", { type: "play", card: 30 });
    state = applyCommand(state, "p2", { type: "play", card: 11 });
    expect(state.players.map((player) => player.played.length)).toEqual([1, 1, 1]);
    expect(state.phase).toBe("play");
    state = applyCommand(state, "p3", { type: "play", card: 22 });
    expect(state.players.map((player) => player.played)).toEqual([[5, 30], [6, 11], [7, 22]]);
    expect(state.phase).toBe("resolve");
    expect(state.events.map((event) => event.type)).toContain("Revealed");
    expect(state.lastReveal!.plays.map((play) => play.card)).toEqual([11, 22, 30]);
  });
});

describe("§4.2 发现圣所", () => {
  it("§4.2 第 1 轮没有上一张，不发现", () => {
    expect(discoveryFor([], [], 68)).toEqual({ discovered: false, count: 0 });
  });
  it("§4.2 两人都触发：按这一轮的编号从小到大，从牌堆顶依次发", () => {
    let state = buildGame({
      players: [{ played: [10], hand: [40, 1, 2] }, { played: [5], hand: [19, 3, 4] }],
      round: 2,
      sanctuaryDeck: [31, 32, 33, 34],
    });
    state = playRound(state, [40, 19]);
    // p2 打 19 先发（S31），p1 打 40 后发（S32）；两人都没有线索，各 1 张
    expect(P(state, "p2").offer).toEqual([31]);
    expect(P(state, "p1").offer).toEqual([32]);
    expect(state.sanctuaryDeck!.slice(0, 2)).toEqual([33, 34]);
    const drawn = state.events.filter((event) => event.type === "SanctuariesDrawn");
    expect(drawn.map((event) => event.type === "SanctuariesDrawn" && event.player)).toEqual(["p2", "p1"]);
  });
  it("§4.2 圣所上的线索从下一轮起算进抽牌数", () => {
    // 第 2 轮：p1 留下 S16（线索）；第 3 轮再发现时抽 1 + 1 = 2 张
    let state = buildGame({ players: [{ played: [10], hand: [19, 30, 1] }, { played: [50], hand: [3, 4, 5] }], round: 2, sanctuaryDeck: [16, 2, 3, 4] });
    state = playRound(state, [19, 3]);
    expect(P(state, "p1").offer).toEqual([16]);
    state = keepAll(takeAll(state), { 0: 16 });
    state = applyCommand(state, "p1", { type: "play", card: 30 });
    state = applyCommand(state, "p2", { type: "play", card: P(state, "p2").hand[0]! });
    expect(P(state, "p1").offerCount).toBe(2);
  });
});

describe("§4.3 结束探索", () => {
  const resolveState = () =>
    buildGame({
      players: [
        { played: [3, 30], offer: [1, 2] },
        { played: [4, 10] },
        { played: [5, 20], offer: [3] },
      ],
      round: 2,
      phase: "resolve",
    });
  it("§4.3 顺序按这一轮编号从小到大；没轮到不能挑；挑完手牌回到 3 张", () => {
    let state = resolveState();
    expect(state.resolveOrder).toEqual(["p2", "p3", "p1"]);
    expect(() => applyCommand(state, "p1", { type: "take", card: state.market[0]! })).toThrow();
    state = applyCommand(state, "p2", { type: "take", card: state.market[0]! });
    expect(P(state, "p2").hand.length).toBe(3);
    expect(state.market.length).toBe(3);
  });
  it("§4.3 留圣所不用排队：轮到别人挑公共牌时也能留；等所有人都留好、挑完才进下一轮", () => {
    let state = resolveState();
    state = applyCommand(state, "p1", { type: "keep", sanctuary: 2 });
    expect(P(state, "p1").sanctuaries).toEqual([2]);
    state = takeAll(state);
    expect(state.phase).toBe("resolve");
    expect(waitingFor(state)).toEqual(["p3"]);
    state = applyCommand(state, "p3", { type: "keep", sanctuary: 3 });
    expect(state.phase).toBe("play");
    expect(state.round).toBe(3);
    expect(state.removed.length).toBe(2); // 第 1 轮 1 张 + 这一轮剩下的 1 张
  });
  it("§4.3 只抽到 1 张也必须留下（只能留这 1 张）", () => {
    const state = resolveState();
    expect(legalActions(state, "p3").filter((action) => action.type === "keep")).toEqual([{ type: "keep", sanctuary: 3 }]);
  });
  it("§4.3 计时 key 只在换人挑公共牌、换阶段时变；带旧 step 的挑牌会被拒，带旧 step 的留圣所照收", () => {
    let state = resolveState();
    const key = stepKey(state);
    state = applyCommand(state, "p1", { type: "keep", sanctuary: 1 });
    expect(stepKey(state)).toBe(key);
    const next = applyCommand(state, "p2", { type: "take", card: state.market[0]! });
    expect(stepKey(next)).not.toBe(key);
    expect(() => applyCommand(next, "p3", { type: "take", card: next.market[0]!, step: key })).toThrow();
    expect(() => applyCommand(next, "p3", { type: "keep", sanctuary: 3, step: key })).not.toThrow();
  });
});

describe("§4.4 隐藏信息不进事件", () => {
  it("§4.4 抽圣所的事件只有张数；留圣所的事件只说留了哪张和放回几张", () => {
    let state = buildGame({ players: [{ played: [10], hand: [40, 1, 2] }, { played: [5], hand: [20, 3, 4] }], round: 2, sanctuaryDeck: [31, 32, 33] });
    state = playRound(state, [40, 20]);
    const drawn = JSON.stringify(state.events.filter((event) => event.type === "SanctuariesDrawn"));
    expect(drawn).not.toMatch(/31|32/);
    state = buildGame({ players: [{ played: [5, 9], offer: [11, 29, 43] }, { played: [10, 3] }], round: 2, phase: "resolve" });
    state = applyCommand(state, "p1", { type: "keep", sanctuary: 29 });
    expect(state.events).toEqual([{ type: "SanctuaryKept", player: "p1", sanctuary: 29, returned: 2 }]);
  });
});

describe("§5 特殊情况（计分）", () => {
  it("§5 倒序计分：左边还没翻开的卡不可见——[13, 2] 里 13 看得到 2 的两个奇石得 4，[2, 13] 里只看得到自己得 0", () => {
    expect(scorePlayer([13, 2], []).regions).toEqual([4, 0]);
    expect(scorePlayer([2, 13], []).regions).toEqual([0, 0]);
  });
  it("§5 倒序计分：左边卡的奇观不能满足右边卡的前置条件——[2, 21] 里 21（要 2 奇石）得 0，[21, 2] 得 8", () => {
    expect(scorePlayer([2, 21], []).regions).toEqual([0, 0]);
    expect(scorePlayer([21, 2], []).regions).toEqual([8, 0]);
  });
  it("§5 圣所计分时一直可见：最右边的卡也看得到全部圣所", () => {
    // 21 要 2 个奇石，自己没有；圣所 S12、S15 各 1 奇石
    expect(scorePlayer([1, 21], [12, 15]).regions).toEqual([0, 8]);
  });
  it("§5 资源不会被消耗：一个奇石同时满足好几张卡", () => {
    // 21、32 都看得到 2 号的两个奇石（32 加上自己的 1 个 = 3）
    expect(scorePlayer([21, 32, 2], []).regions).toEqual([8, 7, 0]);
  });
  it("§5 有颜色的圣所算一张那种颜色的卡；无色圣所不算颜色、不算四色套", () => {
    // 53：每张红色 4，要 2 蓟草。圣所 S18（红，蓟）、S28（无色，蓟） → 红 = 53 右边 0 + S18 = 1 张（53 自己是黄）
    expect(scorePlayer([53], [18, 28]).regions).toEqual([4]);
    // 四色套：18（绿）+ S02 红 + S03 蓝 + S04 黄 = 1 套 → 10；换成无色 S05 S06 S07 → 0
    expect(scorePlayer([18], [2, 3, 4]).regions).toEqual([10]);
    expect(scorePlayer([18], [5, 6, 7]).regions).toEqual([0]);
  });
  it("§5 圣所上的月亮算 1 个夜", () => {
    // 10：每个夜 3。自己是白天；S43 夜 → 3
    expect(scorePlayer([10], [43]).regions).toEqual([3]);
    expect(scorePlayer([10], [42, 43, 44]).regions).toEqual([9]);
  });
  it("§5 前置条件要求多种资源时每种都要够", () => {
    // 40：要 石 1 兽 1 蓟 1，每个夜 3。S43（石）S44（兽）没有蓟 → 0；加 S45（蓟）→ 夜 = 40 自己 + 3 张圣所 = 4 → 12
    expect(scorePlayer([40], [43, 44]).regions).toEqual([0]);
    expect(scorePlayer([40], [43, 44, 45]).regions).toEqual([12]);
  });
});

describe("§6.1 四种任务", () => {
  it("§6.1 固定 / 每个X / 每张两色之一 / 每套四色", () => {
    expect(scorePlayer([9], []).regions).toEqual([5]);
    expect(scorePlayer([19, 4, 7], []).regions).toEqual([6, 0, 0]); // 每个蓟草 2：19、4、7 各 1
    expect(scorePlayer([25, 12, 3], []).regions).toEqual([3, 0, 4]); // 25 每张黄/绿 1：25 黄、12 黄、3 绿
    expect(scorePlayer([23, 3, 2, 12], []).regions).toEqual([10, 4, 0, 0]); // 23 四色套：红23 绿3 蓝2 黄12
  });
  it("§6.2 圣所任务在 8 张全翻完后用全部区域卡算", () => {
    // S30 每个奇石 2：区域 2（2 个）+ 4（1 个）= 3 个 → 6
    expect(scorePlayer([2, 4], [30]).sanctuaries).toEqual([6]);
  });
});

describe("§7 终局与胜负", () => {
  it("§7 真打完一局：phase = ended，名次按总分从高到低，分数等于 scorePlayer", () => {
    let state = createGame(players(3), 99);
    for (let round = 1; round <= 8; round += 1) state = keepAll(takeAll(playRound(state, state.players.map((player) => player.hand.at(-1)!))));
    expect(state.phase).toBe("ended");
    const result = state.finalResult!;
    for (const player of state.players) expect(result.scores[player.id]).toEqual(scorePlayer(player.played, player.sanctuaries));
    const totals = result.ranking.map((id) => result.scores[id]!.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    expect(result.winners).toEqual([result.ranking[0]]);
    expect(() => applyCommand(state, "p1", { type: "play", card: 1 })).toThrow();
    expect(state.events.at(-1)!.type).toBe("GameEnded");
  });
});

describe("§9.4 超时自动行动", () => {
  it("§9.4 出牌超时：没提交的人代打手里编号最小的，最后一人代打完就翻牌", () => {
    let state = createGame(players(3), 4, {}, {}, { hands: [[10, 20, 30], [11, 21, 31], [12, 22, 32]] });
    state = applyCommand(state, "p1", { type: "play", card: 30 });
    state = timeoutTurn(state);
    expect(state.events[0]).toEqual({ type: "TimedOut", phase: "play", players: ["p2", "p3"] });
    expect(state.players.map((player) => player.played)).toEqual([[30], [11], [12]]);
    expect(state.phase).toBe("resolve");
  });
  it("§9.4 阶段③超时：轮到的人代挑最小的公共牌，到点时有圣所待选的人代留第一张；到点后才轮到的人不代做", () => {
    let state = buildGame({
      players: [{ played: [3, 30], offer: [7, 8] }, { played: [4, 10] }, { played: [5, 20] }],
      round: 2,
      phase: "resolve",
    });
    const lowest = Math.min(...state.market);
    state = timeoutTurn(state);
    expect(state.events[0]).toEqual({ type: "TimedOut", phase: "resolve", players: ["p2", "p1"] });
    expect(P(state, "p2").hand).toContain(lowest);
    expect(P(state, "p1").sanctuaries).toEqual([7]);
    expect(P(state, "p3").tookMarket).toBe(false);
    expect(waitingFor(state)).toEqual(["p3"]);
  });
  it("§9.4 policy 给了不合法的动作就退回基线", () => {
    const state = createGame(players(2), 4, {}, {}, { hands: [[10, 20, 30], [11, 21, 31]] });
    const next = timeoutTurn(state, () => ({ type: "play", card: 99 }));
    expect(next.players.map((player) => player.played)).toEqual([[10], [11]]);
  });
});

describe("引擎通用", () => {
  it("apply 不改输入", () => {
    const state = buildGame({ players: [{ played: [3, 30], offer: [7, 8] }, { played: [4, 10] }], round: 2, phase: "resolve" });
    const before = JSON.stringify(state);
    apply(state, "p1", { type: "keep", sanctuary: 7 });
    apply(state, "p2", { type: "take", card: state.market[0]! });
    expect(JSON.stringify(state)).toBe(before);
  });
  it("每一步 version + 1", () => {
    const state = createGame(players(2), 4);
    expect(applyCommand(state, "p1", { type: "play", card: state.players[0]!.hand[0]! }).version).toBe(state.version + 1);
  });
  it("客户端多塞的字段不进动作序列；未知动作报错", () => {
    const state = createGame(players(2), 4);
    const next = applyCommand(state, "p1", { type: "play", card: state.players[0]!.hand[0]!, extra: 1 } as never);
    expect(Object.keys(next.log!.at(-1)!.command)).toEqual(["type", "card"]);
    expect(() => applyCommand(state, "p1", { type: "pass" } as never)).toThrow();
    expect(() => applyCommand(state, "p9", { type: "play", card: 1 })).toThrow();
  });
});
