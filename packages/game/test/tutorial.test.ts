/**
 * 新手教程剧本（packages/game/src/tutorial.ts）的单测，照欲罢不能的五项：
 * 从头走到尾、关键几幕一定发生、剧本自身、剧本发牌、走完接练习局能打完。
 */
import { describe, expect, it } from "vitest";
import {
  anchorCandidates,
  anchorVisible,
  apply,
  botCommand,
  createPracticeGame,
  createTutorialGame,
  legalActions,
  redactGameForViewer,
  sameCommand,
  selfCanAct,
  stateProblems,
  TUTORIAL_BOT,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type GameState,
  type TutorialMove,
} from "../src/index.js";

const BOT = TUTORIAL_BOT.id;
const run = (game: GameState, move: TutorialMove) => apply(game, move.player, move.command).state;

function playScript(upTo = TUTORIAL_STEPS.length): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = run(game, step.expect);
    if (step.kind === "watch") for (const move of step.moves) game = run(game, move);
  }
  return game;
}
const stepIndex = (id: string) => {
  const index = TUTORIAL_STEPS.findIndex((step) => step.id === id);
  if (index < 0) throw new Error(`没有 ${id} 这一步`);
  return index;
};
const after = (id: string) => playScript(stepIndex(id) + 1);
const P = (game: GameState, id: string) => game.players.find((player) => player.id === id)!;

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法，咕噜一号的走法轮得到它，高亮的东西在界面上看得见", () => {
    let game = createTutorialGame("小蒲");
    for (const step of TUTORIAL_STEPS) {
      const candidates = anchorCandidates(step);
      if (candidates.length > 0) expect(anchorVisible(game, candidates[0]!), `「${step.id}」高亮的 ${candidates[0]} 看不见`).toBe(true);
      if (step.kind === "do") {
        expect(step.expect.player).toBe(TUTORIAL_SELF);
        expect(selfCanAct(game), `「${step.id}」这时你还不能动`).toBe(true);
        expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect.command)), `「${step.id}」这一步不合法`).toBe(true);
        if (step.then) expect(anchorVisible(game, step.then), `「${step.id}」第二步的 ${step.then} 看不见`).toBe(true);
        game = run(game, step.expect);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          expect(tutorialActor(game), `「${step.id}」里 ${JSON.stringify(move)} 还没轮到它`).toBe(move.player);
          expect(legalActions(game, move.player).some((command) => sameCommand(command, move.command)), `「${step.id}」里 ${JSON.stringify(move)} 不合法`).toBe(true);
          game = run(game, move);
        }
      }
      expect(stateProblems(game), `「${step.id}」之后局面不一致`).toEqual([]);
    }
    expect(game.phase).toBe("ended");
  });

  it("关键的几幕一定发生：编号小先挑、发现圣所抽 2 张、有颜色的圣所、第 8 轮不挑、你 80 分赢、咕噜一号的 66 得 0 分", () => {
    const r1 = after("r1-bot");
    expect(r1.resolveOrder).toEqual([BOT, TUTORIAL_SELF]);
    expect(r1.players.every((player) => player.offerCount === 0)).toBe(true);
    expect(after("r1-take").removed).toEqual([9]);
    const r3 = after("r3-bot");
    expect(P(r3, TUTORIAL_SELF).offer).toEqual([11, 5]);
    expect(P(r3, BOT).offerCount).toBe(2);
    expect(r3.resolveOrder).toEqual([TUTORIAL_SELF, BOT]);
    expect(P(after("r4-bot"), TUTORIAL_SELF).offer).toEqual([3, 24]);
    expect(P(after("r5-bot"), BOT).offerCount).toBe(4);
    expect(P(after("r6-bot"), TUTORIAL_SELF).offer).toEqual([22, 30]);
    const r8 = after("r8-bot");
    expect(r8.market).toEqual([]);
    expect(P(r8, BOT).offerCount).toBe(5);
    const end = playScript();
    const result = end.finalResult!;
    expect(P(end, TUTORIAL_SELF).played).toEqual([45, 8, 16, 23, 1, 18, 28, 35]);
    expect(P(end, TUTORIAL_SELF).sanctuaries).toEqual([11, 3, 22, 40, 44]);
    expect(result.scores[TUTORIAL_SELF]!.total).toBe(80);
    expect(result.winners).toEqual([TUTORIAL_SELF]);
    const botScore = result.scores[BOT]!;
    const at66 = P(end, BOT).played.indexOf(66);
    expect(botScore.prereqOk[at66]).toBe(false);
    expect(botScore.regions[at66]).toBe(0);
    expect(botScore.total).toBeLessThan(80);
  });

  it("剧本自身：id 不重复，finale 唯一且在最后，每句都有话，课名不重复", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales.length).toBe(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.length).toBeGreaterThan(2);
      expect(step.say.length, `「${step.id}」主句太长`).toBeLessThanOrEqual(34);
    }
    const lessons = TUTORIAL_STEPS.filter((step) => step.lesson).map((step) => step.lesson);
    expect(new Set(lessons).size).toBe(lessons.length);
  });

  it("走完接练习局：你和咕噜一号都交给人机，150 局都能打完", () => {
    let stuck = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
      let game = createPracticeGame("小蒲", seed);
      for (let guard = 0; guard < 120 && game.phase !== "ended"; guard += 1) {
        const actor = tutorialActor(game);
        if (!actor) break;
        const command = botCommand(redactGameForViewer(game, actor), actor, { samples: 12 });
        if (!command) break;
        game = apply(game, actor, command).state;
      }
      if (game.phase !== "ended") stuck += 1;
    }
    expect(stuck).toBe(0);
  }, 60_000);
});
