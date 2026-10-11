import { useEffect, useRef } from "react";
import { currentPicker, stepKey, type GameState } from "@faraway/game";
import { sfx, synth } from "./gm-sound.js";

/**
 * 遥远之地的动作音效。gm-sound.tsx 是全站共用的音效库，这里只管「什么时候响哪个」：看引擎的 events。
 * 第一次拿到对局（进房间、重连、观战刚进来）不响；版本一下跳了很多步（重连）也不响；再来一局 / 教程重开（版本变小）重新算起。
 * 自己的动作 mine=true，别人的减半；观战时都算别人的。
 * 招牌声音：发现圣所的「风铃」、终局每翻开一张卡的「叮」（在 FinalScoring 里按翻牌节奏调 scoreTick）。
 */

declare global {
  interface Window {
    /** 开发时自测脚本用：记下响过的音效名字。 */
    __sfxLog?: string[];
  }
}

function log(name: string) {
  if (import.meta.env.DEV) window.__sfxLog?.push(name);
}

const { tone, noise, level } = synth;

/** 发现圣所：一串上行的风铃。 */
function chime(mine: boolean, count: number) {
  const v = level(mine);
  const notes = [1047, 1319, 1568, 2093, 2637];
  for (let i = 0; i < Math.min(5, Math.max(2, count + 1)); i += 1) {
    tone(notes[i]!, { at: i * 0.07, duration: 0.22, volume: 0.08 * v, type: "triangle" });
  }
  noise({ duration: 0.25, volume: 0.03 * v, filter: "highpass", freq: 5000 });
  log("chime");
}

/** 终局翻开一张卡：得分越高音越高；0 分是一声闷响。 */
export function scoreTick(points: number, mine: boolean) {
  const v = level(mine);
  if (points <= 0) {
    tone(180, { duration: 0.1, volume: 0.08 * v, type: "triangle", glideTo: 140 });
    log("tick0");
    return;
  }
  const pitch = 660 * Math.pow(2, Math.min(points, 24) / 24);
  tone(pitch, { duration: 0.12, volume: 0.1 * v, type: "triangle" });
  tone(pitch * 1.5, { at: 0.05, duration: 0.14, volume: 0.06 * v, type: "triangle" });
  log("tick");
}

/** 选中一张牌（还没确认）。 */
export function pickSound(on: boolean) {
  sfx.select(on);
  log(on ? "select" : "unselect");
}

/** 确认（再点一下、点按钮）：轻点，结果音等服务器回来再响。 */
export function confirmSound() {
  sfx.tap();
  log("tap");
}

function play(name: string, fn: () => void, delay = 0) {
  window.setTimeout(() => {
    fn();
    log(name);
  }, Math.max(0, delay));
}

interface Options {
  readonly game: GameState;
  /** 自己的玩家 id；观战时传空字符串（全都算别人的）。 */
  readonly selfId: string;
}

/** 现在该我动手的那一步（出牌、挑公共牌、留圣所），没有就是 null。 */
function myStep(game: GameState, selfId: string): string | null {
  if (!selfId || game.phase === "ended") return null;
  const me = game.players.find((player) => player.id === selfId);
  if (!me) return null;
  if (game.phase === "play") return me.submitted ? null : `${stepKey(game)}:play`;
  if (me.offerCount > 0) return `${game.round}:keep`;
  if (currentPicker(game) === selfId) return `${stepKey(game)}:take`;
  return null;
}

export function useGameSfx({ game, selfId }: Options) {
  const prev = useRef<GameState | null>(null);
  /** 已经提示过「该你了」的那一步。 */
  const announced = useRef<string | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before) {
      announced.current = myStep(game, selfId);
      return;
    }
    if (game.version === before.version) return;
    if (game.version < before.version) {
      announced.current = myStep(game, selfId);
      if (game.round === 1 && game.phase === "play") {
        play("gameStart", () => sfx.gameStart(), 100);
        play("deal", () => sfx.deal(3), 700);
      }
      return;
    }
    if (game.version - before.version > 4) {
      announced.current = myStep(game, selfId);
      return;
    }
    const mineOf = (id: string) => selfId !== "" && id === selfId;
    let gap = 0;
    for (const event of game.events) {
      switch (event.type) {
        case "Submitted": {
          const mine = mineOf(event.player);
          play("card", () => sfx.card(mine), gap);
          gap += 80;
          break;
        }
        case "Revealed":
          play("reveal", () => sfx.flip(true), gap + 150);
          play("reveal2", () => sfx.card(true, event.plays.length), gap + 450);
          gap += 700;
          break;
        case "SanctuariesDrawn": {
          const mine = mineOf(event.player);
          if (event.count > 0) play("chime", () => chime(mine, event.count), gap);
          gap += 200;
          break;
        }
        case "MarketTaken": {
          const mine = mineOf(event.player);
          play("draw", () => sfx.draw(mine), gap);
          gap += 100;
          break;
        }
        case "SanctuaryKept": {
          const mine = mineOf(event.player);
          play("place", () => sfx.place(mine), gap);
          gap += 100;
          break;
        }
        case "RoundStarted":
          play("deal", () => sfx.deal(game.market.length || 1), gap + 300);
          play("roundStart", () => sfx.roundStart(), gap + 900);
          break;
        case "GameEnded":
          // 终局的翻牌声在结算动画里按节奏响；这里只给一声「开始计分」
          play("score", () => sfx.score(true, true), gap + 300);
          break;
        case "TimedOut":
          if (selfId && event.players.includes(selfId)) play("timeout", () => sfx.timeout(), 0);
          break;
        default:
          break;
      }
    }
    const step = myStep(game, selfId);
    if (step && step !== announced.current) play("yourTurn", () => sfx.yourTurn(), gap + 500);
    announced.current = step;
  }, [game.version]);
}

export function gameOverSound(won: boolean) {
  sfx.gameOver(won);
  log("gameOver");
}
