import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildGame,
  createGame,
  createScene,
  keepAll,
  playRound,
  rankPlayers,
  redactGameForSpectator,
  redactGameForViewer,
  scorePlayer,
  takeAll,
  type GameState,
} from "../src/index.js";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));
const P = (state: GameState, id: string) => state.players.find((player) => player.id === id)!;

describe("规则书§10 测试用例", () => {
  it("规则书#T1 开局（4 人）：手牌 3、公共牌 5、区域牌堆 51、圣所牌堆 45、第 1 轮出牌", () => {
    const state = createGame(players(4), 1);
    for (const player of state.players) expect(player.hand.length).toBe(3);
    expect(state.market.length).toBe(5);
    expect(state.regionDeck!.length).toBe(51);
    expect(state.regionDeckCount).toBe(51);
    expect(state.sanctuaryDeck!.length).toBe(45);
    expect(state.round).toBe(1);
    expect(state.phase).toBe("play");
  });

  it("规则书#T2 开局（6 人）：公共牌 7、牌堆 43；整局打完牌堆剩 1、移出 7 张", () => {
    let state = createGame(players(6), 2);
    expect(state.market.length).toBe(7);
    expect(state.regionDeck!.length).toBe(43);
    for (let round = 1; round <= 8; round += 1) {
      state = playRound(state, state.players.map((player) => player.hand[0]!));
      state = takeAll(state);
      state = keepAll(state);
    }
    expect(state.phase).toBe("ended");
    expect(state.regionDeck!.length).toBe(1);
    expect(state.removed.length).toBe(7);
  });

  it("规则书#T3 第 1 轮不发现圣所；阶段③按编号从小到大；剩下的公共牌移出游戏，翻新的 4 张进第 2 轮", () => {
    let state = createGame(players(3), 3, {}, {}, { hands: [[22, 1, 2], [7, 3, 4], [45, 5, 6]], regionDeck: [11, 30, 52, 64] });
    expect(state.market).toEqual([11, 30, 52, 64]);
    state = playRound(state, [22, 7, 45]);
    expect(state.phase).toBe("resolve");
    expect(state.players.every((player) => player.offerCount === 0 && player.offerWanted === 0)).toBe(true);
    expect(state.resolveOrder).toEqual(["p2", "p1", "p3"]);
    state = applyCommand(state, "p2", { type: "take", card: 64 });
    state = applyCommand(state, "p1", { type: "take", card: 11 });
    state = applyCommand(state, "p3", { type: "take", card: 52 });
    expect(state.removed).toEqual([30]);
    expect(state.regionDeck!.includes(30)).toBe(false);
    expect(state.market.length).toBe(4);
    expect(state.round).toBe(2);
    expect(state.phase).toBe("play");
    expect(P(state, "p2").hand).toContain(64);
  });

  it("规则书#T4 比上一张大发现圣所，抽 1 + 线索（算上刚打出的那张）= 4 张；打 12 就不抽", () => {
    const build = () => buildGame({ players: [{ played: [15], sanctuaries: [16], hand: [49, 12, 1] }, { played: [30], hand: [2, 3, 4] }], round: 2 });
    let state = playRound(build(), [49, 2]);
    expect(P(state, "p1").offerCount).toBe(4);
    expect(P(state, "p1").offerWanted).toBe(4);
    state = playRound(build(), [12, 2]);
    expect(P(state, "p1").offerCount).toBe(0);
    expect(state.lastReveal!.plays.find((play) => play.player === "p1")!.discovered).toBe(false);
  });

  it("规则书#T5 只和上一张比：[60, 10] 后打 20 也发现，抽 1 + 线索（60、20 各 1）= 3", () => {
    const state = playRound(buildGame({ players: [{ played: [60, 10], hand: [20, 1, 2] }, { played: [3, 4], hand: [5, 6, 7] }], round: 3 }), [20, 5]);
    expect(state.lastReveal!.plays.find((play) => play.player === "p1")!.discovered).toBe(true);
    expect(P(state, "p1").offerCount).toBe(3);
  });

  it("规则书#T6 留 S29：进圣所区，S11、S43 放到圣所牌堆底，待选清空；留不在待选里的 S05 报错", () => {
    const state = buildGame({ players: [{ played: [5, 9], offer: [11, 29, 43] }, { played: [10, 3] }], round: 2, phase: "resolve" });
    expect(() => applyCommand(state, "p1", { type: "keep", sanctuary: 5 })).toThrow();
    const next = applyCommand(state, "p1", { type: "keep", sanctuary: 29 });
    expect(P(next, "p1").sanctuaries).toEqual([29]);
    expect(next.sanctuaryDeck!.slice(-2)).toEqual([11, 43]);
    expect(P(next, "p1").offer).toEqual([]);
    expect(P(next, "p1").offerCount).toBe(0);
  });

  it("规则书#T7 第 8 轮不挑公共牌：发 take 报错；A 留好圣所后进入终局；第 8 轮公共牌是空的", () => {
    let state = buildGame({
      players: [
        { played: [1, 2, 3, 4, 6, 7, 33], hand: [40, 50, 60] },
        { played: [8, 9, 10, 11, 12, 13, 14], hand: [5, 61, 62] },
      ],
      round: 8,
    });
    expect(state.market).toEqual([]);
    state = playRound(state, [40, 5]);
    expect(state.phase).toBe("resolve");
    expect(() => applyCommand(state, "p2", { type: "take", card: 1 })).toThrow();
    expect(P(state, "p1").offerCount).toBeGreaterThan(0);
    expect(P(state, "p2").offerCount).toBe(0);
    state = applyCommand(state, "p1", { type: "keep", sanctuary: P(state, "p1").offer[0]! });
    expect(state.phase).toBe("ended");
    expect(state.finalResult).toBeDefined();
  });

  it("规则书#T7b 真打一局：第 7 轮结束时不翻新的公共牌", () => {
    let state = createGame(players(2), 77);
    for (let round = 1; round <= 7; round += 1) {
      state = keepAll(takeAll(playRound(state, state.players.map((player) => player.hand[0]!))));
    }
    expect(state.round).toBe(8);
    expect(state.market).toEqual([]);
    expect(state.regionDeck!.length).toBe(68 - 6 - 7 * 3);
  });

  it("规则书#T8 完整计分例 1：80 分", () => {
    const score = scorePlayer([45, 8, 16, 23, 1, 18, 28, 35], [11, 3, 22, 40, 44]);
    expect(score.regions).toEqual([13, 0, 16, 10, 0, 10, 12, 0]);
    expect(score.sanctuaries).toEqual([0, 2, 8, 9, 0]);
    expect(score.total).toBe(80);
  });

  it("规则书#T9 完整计分例 2（夜晚、前置条件失败）：49 分", () => {
    const score = scorePlayer([20, 10, 24, 37, 4, 40, 14, 41], [42, 34, 43, 16]);
    expect(score.regions).toEqual([12, 15, 0, 12, 0, 0, 4, 0]);
    expect(score.prereqOk).toEqual([true, true, false, true, true, false, true, false]);
    expect(score.sanctuaries).toEqual([0, 6, 0, 0]);
    expect(score.total).toBe(49);
  });

  it("规则书#T10 完整计分例 3（颜色、蓟草）：45 分", () => {
    const score = scorePlayer([50, 12, 4, 53, 7, 19, 26, 62], [18, 13, 1, 29]);
    expect(score.regions).toEqual([4, 0, 0, 16, 0, 6, 6, 0]);
    expect(score.sanctuaries).toEqual([0, 0, 1, 12]);
    expect(score.total).toBe(45);
  });

  it("规则书#T11 顺序决定前置条件：同样 8 张，甲 33 分、乙 9 分", () => {
    const a = scorePlayer([68, 2, 6, 17, 30, 51, 9, 13], []);
    expect(a.regions).toEqual([24, 0, 0, 0, 4, 0, 5, 0]);
    expect(a.total).toBe(33);
    const b = scorePlayer([2, 6, 17, 30, 51, 9, 13, 68], []);
    expect(b.regions).toEqual([0, 0, 0, 4, 0, 5, 0, 0]);
    expect(b.total).toBe(9);
  });

  it("规则书#T12 前置条件算上卡自己的奇观：[32, 2] 得 7；只有 [32] 得 0", () => {
    expect(scorePlayer([32, 2], []).regions).toEqual([7, 0]);
    expect(scorePlayer([32, 2], []).total).toBe(7);
    expect(scorePlayer([32], []).total).toBe(0);
  });

  it("规则书#T13 平局：都是 52 分，A 最小编号 3、B 最小 7 → A 赢", () => {
    expect(rankPlayers([
      { id: "B", played: [7, 20, 30], total: 52 },
      { id: "A", played: [40, 3, 50], total: 52 },
    ])).toEqual(["A", "B"]);
    const state = createScene("ended-tie");
    expect(state.finalResult!.scores.p1!.total).toBe(state.finalResult!.scores.p2!.total);
    expect(state.finalResult!.winners).toEqual(["p1"]);
    expect(state.finalResult!.tieBreak).toBe(true);
  });

  it("规则书#T14 圣所牌堆只剩 3 张：A（30，要 2）拿前 2 张，B（50，要 3）只拿到 1 张；A 放回的不补给 B", () => {
    let state = buildGame({
      players: [{ played: [15], hand: [30, 1, 2] }, { played: [22], sanctuaries: [16], hand: [50, 3, 4] }],
      round: 2,
      sanctuaryDeck: [5, 6, 7],
      sanctuaryDeckExact: true,
    });
    state = playRound(state, [30, 50]);
    expect(P(state, "p1").offer).toEqual([5, 6]);
    expect(P(state, "p2").offer).toEqual([7]);
    expect(P(state, "p2").offerWanted).toBe(3);
    expect(state.sanctuaryDeck).toEqual([]);
    state = applyCommand(state, "p1", { type: "keep", sanctuary: 5 });
    expect(P(state, "p2").offer).toEqual([7]);
    expect(state.sanctuaryDeck).toEqual([6]);
  });

  it("规则书#T14b 牌堆空了：发现圣所的人一张都拿不到，这一轮就没有圣所（不会卡住）", () => {
    let state = buildGame({
      players: [{ played: [15], hand: [30, 1, 2] }, { played: [22], hand: [50, 3, 4] }],
      round: 2,
      sanctuaryDeck: [],
      sanctuaryDeckExact: true,
    });
    state = playRound(state, [30, 50]);
    expect(P(state, "p1").offerCount).toBe(0);
    expect(P(state, "p1").offerWanted).toBe(2);
    state = takeAll(state);
    expect(state.round).toBe(3);
  });

  it("规则书#T15 隐藏信息：A 已提交、B 未提交时 B 看不到 A 的牌；别人的手牌和待选圣所只给张数；观战谁的手牌都看不到", () => {
    let state = buildGame({ players: [{ played: [10], sanctuaries: [], offer: [] }, { played: [20] }], round: 2 });
    state = applyCommand(state, "p1", { type: "play", card: P(state, "p1").hand[0]! });
    const bView = redactGameForViewer(state, "p2");
    expect(P(bView, "p1").submitted).toBe(true);
    expect(P(bView, "p1").pendingPlay).toBeNull();
    expect(P(bView, "p1").hand).toEqual([]);
    expect(P(bView, "p1").handCount).toBe(2);
    expect(P(bView, "p2").hand.length).toBe(3);
    const spectator = redactGameForSpectator(state, false);
    for (const player of spectator.players) {
      expect(player.hand).toEqual([]);
      expect(player.pendingPlay).toBeNull();
    }
    const offerState = buildGame({ players: [{ played: [5, 9], offer: [11, 29, 43] }, { played: [10, 3] }], round: 2, phase: "resolve" });
    const other = redactGameForViewer(offerState, "p2");
    expect(P(other, "p1").offer).toEqual([]);
    expect(P(other, "p1").offerCount).toBe(3);
    for (const view of [bView, spectator, other]) {
      expect(view.regionDeck).toBeUndefined();
      expect(view.sanctuaryDeck).toBeUndefined();
      expect(view.seed).toBeUndefined();
      expect(view.rngState).toBeUndefined();
      expect(view.log).toBeUndefined();
    }
  });
});
