/**
 * 人机（占位）：从自己能做的合法动作里随机挑一个。人机阶段换成正式策略。
 * 输入只能是 redactGameForViewer 处理过的状态。
 */
import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

export function botCommand(view: GameState, playerId: string): GameCommand | null {
  const actions = legalActions(view, playerId);
  if (!actions.length) return null;
  return actions[Math.floor(Math.random() * actions.length)]!;
}
