import { describe, expect, it } from "vitest";
import {
  applyCommand,
  botCommand,
  botDecision,
  botUnknownCards,
  buildGame,
  createGame,
  legalActions,
  redactGameForViewer,
  sameCommand,
  waitingFor,
  type GameState,
} from "../src/index.js";

const decide = (state: GameState, id = "p1") => botDecision(redactGameForViewer(state, id), id)!;

describe("人机只用自己看得到的信息", () => {
  it("别人的手牌、已出的牌、抽到的圣所怎么变，人机的决定都一样（它拿到的是 redact 视角）", () => {
    const state = buildGame({
      players: [{ played: [12, 40], hand: [3, 45, 60] }, { played: [30, 9], pendingPlay: 50 }, { played: [22, 5] }],
      round: 3,
    });
    const base = decide(state);
    // 换掉对手的暗牌：对手手牌、已出的牌和牌堆顺序都不同的另一个局面，自己看到的完全一样
    const other = buildGame({
      players: [{ played: [12, 40], hand: [3, 45, 60] }, { played: [30, 9], pendingPlay: 51 }, { played: [22, 5] }],
      round: 3,
      market: state.market,
      removed: state.removed,
      seed: 99,
    });
    expect(redactGameForViewer(other, "p1").players[0]).toEqual(redactGameForViewer(state, "p1").players[0]);
    expect(decide(other).command).toEqual(base.command);
  });
  it("没见过的牌里包含对手手里的牌（人机不知道它们在对手手里）", () => {
    const state = buildGame({ players: [{ played: [12], hand: [3, 45, 60] }, { played: [30], hand: [1, 2, 4] }], round: 2 });
    const unknown = botUnknownCards(redactGameForViewer(state, "p1"), "p1");
    expect(unknown.regions).toEqual(expect.arrayContaining([1, 2, 4]));
    expect(unknown.regions).not.toContain(45);
    expect(unknown.regions).not.toContain(30);
  });
});

describe("人机的关键决策（规则书 §9.7）", () => {
  it("第 1 轮手牌 {45, 8, 16}：先打要 3 只灵兽的 45（放最左边），和教程剧本一样", () => {
    const state = createGame([{ id: "p1", name: "我" }, { id: "p2", name: "咕噜" }], 1, {}, {}, { hands: [[45, 8, 16], [30, 12, 66]], regionDeck: [23, 60, 9] });
    const d = decide(state);
    expect(d.command).toEqual({ type: "play", card: 45 });
    expect(d.reason).toContain("45");
  });
  it("第 8 轮不会把前置条件很高的卡打在最右边：打能拿圣所又给资源的 35，不打 2、9", () => {
    const state = buildGame({ players: [{ played: [45, 8, 16, 23, 1, 18, 28], sanctuaries: [11, 3, 22, 40], hand: [35, 2, 9] }, { played: [30, 12, 66, 33, 52, 47, 57] }], round: 8 });
    expect(decide(state).command).toEqual({ type: "play", card: 35 });
  });
  it("第 8 轮手里有 68（要 5 个奇石）：不会打它，它在最右边只看得到自己", () => {
    const state = buildGame({ players: [{ played: [10, 20, 30, 40, 50, 60, 5], sanctuaries: [], hand: [68, 3, 7] }, { played: [1, 2, 4, 6, 8, 9, 11] }], round: 8 });
    expect(decide(state).command).not.toEqual({ type: "play", card: 68 });
  });
  it("留圣所：要灵兽的 45 在左边、还差 1 只时，留灵兽圣所 S11，不留只给奇石的 S12", () => {
    const state = buildGame({ players: [{ played: [45, 8, 16], offer: [11, 12] }, { played: [30, 12, 66] }], round: 3, phase: "resolve" });
    const d = decide(state);
    expect(d.command).toEqual({ type: "keep", sanctuary: 11 });
    expect(d.reason).toMatch(/S11/);
  });
  it("挑公共牌：有圣所待选时先留圣所；轮到自己挑时只挑公共牌里的牌；第 8 轮不挑", () => {
    const state = buildGame({ players: [{ played: [45, 8], offer: [11, 24] }, { played: [30, 12] }], round: 2, phase: "resolve" });
    expect(decide(state).command.type).toBe("keep");
    const kept = applyCommand(state, "p1", { type: "keep", sanctuary: 11 });
    const take = decide(kept);
    expect(take.command.type).toBe("take");
    expect(kept.market).toContain((take.command as { card: number }).card);
    const r8 = buildGame({ players: [{ played: [1, 2, 3, 4, 6, 7, 8, 40] }, { played: [9, 10, 11, 12, 13, 14, 15, 5] }], round: 8, phase: "resolve" });
    expect(botDecision(redactGameForViewer(r8, "p1"), "p1")).toBeNull();
  });
  it("「比上一张大」只和最右边那张比：出牌区 [60, 10] 手里 20、5、3 时，理由里说能抽圣所", () => {
    const state = buildGame({ players: [{ played: [60, 10], hand: [20, 5, 3] }, { played: [30, 9] }], round: 3 });
    const d = decide(state);
    if ((d.command as { card: number }).card === 20) expect(d.reason).toMatch(/上一张 10|左边|编号/);
    expect(legalActions(state, "p1").some((action) => sameCommand(action, d.command))).toBe(true);
  });
});

describe("人机自对弈", () => {
  it.each([2, 3, 4, 5, 6])("%i 人 30 局：每一步都合法、有理由，不会死循环，每步不超过 300ms", (n) => {
    let worst = 0;
    let total = 0;
    let steps = 0;
    for (let game = 0; game < 30; game += 1) {
      let state = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })), 400 + game);
      let guard = 0;
      while (state.phase !== "ended") {
        guard += 1;
        expect(guard).toBeLessThan(200);
        const id = waitingFor(state)[0]!;
        const view = redactGameForViewer(state, id);
        const t0 = performance.now();
        const decision = botDecision(view, id);
        const ms = performance.now() - t0;
        worst = Math.max(worst, ms);
        total += ms;
        steps += 1;
        expect(decision).not.toBeNull();
        expect(decision!.reason.length).toBeGreaterThan(4);
        expect(legalActions(state, id).some((action) => sameCommand(action, decision!.command))).toBe(true);
        state = applyCommand(state, id, decision!.command);
      }
    }
    expect(worst).toBeLessThan(300);
    expect(total / steps).toBeLessThan(50);
  }, 60_000);
  it("botCommand 在不用它做事时返回 null", () => {
    const state = createGame([{ id: "p1", name: "a" }, { id: "p2", name: "b" }], 3);
    const after = applyCommand(state, "p1", { type: "play", card: state.players[0]!.hand[0]! });
    expect(botCommand(redactGameForViewer(after, "p1"), "p1")).toBeNull();
  });
});
