import { describe, expect, it } from "vitest";
import {
  buildGame,
  createScene,
  createSceneRoom,
  SCENE_NAMES,
  stateProblems,
  waitingFor,
  type SceneName,
} from "../src/index.js";

const EXPECT: Record<SceneName, { phase: string; round?: number }> = {
  start: { phase: "play", round: 1 },
  play: { phase: "play", round: 4 },
  submitted: { phase: "play", round: 4 },
  pick: { phase: "resolve", round: 3 },
  "pick-keep": { phase: "resolve", round: 3 },
  "keep-wait": { phase: "resolve", round: 3 },
  "watch-pick": { phase: "resolve", round: 3 },
  round8: { phase: "play", round: 8 },
  "round8-keep": { phase: "resolve", round: 8 },
  "short-deck": { phase: "resolve", round: 2 },
  timeout: { phase: "resolve", round: 2 },
  ended: { phase: "ended" },
  "ended-tie": { phase: "ended" },
  full: { phase: "play", round: 7 },
};

describe("预览局面工厂", () => {
  it.each(SCENE_NAMES.map((name) => [name]))("%s：阶段对、局面自洽", (name) => {
    const state = createScene(name);
    expect(state.phase).toBe(EXPECT[name].phase);
    if (EXPECT[name].round) expect(state.round).toBe(EXPECT[name].round);
    // short-deck 故意只留了指定的圣所，圣所不守恒
    const problems = stateProblems(state).filter((problem) => name !== "short-deck" || !problem.startsWith("圣所卡不守恒"));
    expect(problems).toEqual([]);
  });
  it("各场景的关键点", () => {
    expect(createScene("submitted").players[0]!.submitted).toBe(true);
    expect(createScene("play").players[0]!.submitted).toBe(false);
    const pick = createScene("pick");
    expect(pick.resolveOrder[0]).toBe("p1");
    const pickKeep = createScene("pick-keep");
    expect(pickKeep.resolveOrder[0]).toBe("p1");
    expect(pickKeep.players[0]!.offer.length).toBe(3);
    const keepWait = createScene("keep-wait");
    expect(keepWait.resolveOrder[0]).not.toBe("p1");
    expect(waitingFor(keepWait)).toContain("p1");
    expect(createScene("round8-keep").players[0]!.offerCount).toBeGreaterThan(0);
    expect(createScene("timeout").events[0]!.type).toBe("TimedOut");
    expect(createScene("full").players.length).toBe(6);
    expect(createScene("short-deck").players[1]!.offerWanted).toBe(3);
    for (const n of [2, 3, 4, 5, 6]) expect(createScene("ended", { players: n }).finalResult!.ranking.length).toBe(n);
  });
  it("createSceneRoom：只给自己的手牌；可以标人机、托管、离线", () => {
    const room = createSceneRoom(createScene("play"), { bots: ["p2"], auto: ["p3"], offline: ["p4"] });
    expect(room.game!.players[1]!.hand).toEqual([]);
    expect(room.game!.players[0]!.hand.length).toBe(3);
    expect(room.members[1]!.bot).toBe(true);
    expect(room.members[1]!.name).toBe("咕噜一号");
    expect(room.members[2]!.auto).toBe(true);
    expect(room.members[3]!.connected).toBe(false);
    expect(room.game!.regionDeck).toBeUndefined();
  });
  it("buildGame 拒绝重复的牌；stateProblems 查得出坏局面", () => {
    expect(() => buildGame({ players: [{ hand: [1, 2, 3] }, { hand: [3, 4, 5] }] })).toThrow();
    const state = buildGame({ players: 3, round: 3 });
    expect(stateProblems(state)).toEqual([]);
    state.players[0]!.hand.push(state.regionDeck!.pop()!);
    expect(stateProblems(state).length).toBeGreaterThan(0);
  });
});
