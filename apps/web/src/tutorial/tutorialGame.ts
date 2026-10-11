/**
 * 遥远之地和教程有关的部分（共用的 Coach / useTutorial / tips / storage 之外，本游戏自己写的）：
 * 游戏 id、「第一次遇到」小贴士什么时候出。「提示」直接用人机的 botHint（带理由）。
 */
import { region, type GameState } from "@faraway/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "faraway";

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "discover-self": {
    title: "你发现了圣所",
    text: "这一轮你出的编号比上一张大，抽 1 + 线索数张，留 1 张。圣所的资源、颜色、月亮计分时一直算。",
  },
  "short-deck": {
    title: "圣所牌堆不够了",
    text: "按这一轮出的编号从小到大发，发完为止，后面的人少拿或拿不到。",
  },
  "auto-self": {
    title: "你进入了托管",
    text: "连续 2 次超时，现在由人机替你打。点「取消托管」就拿回来。",
  },
  timeout: {
    title: "你超时了",
    text: "系统替你做了这一步。再连续超时一次就会进入托管，由人机替你打。",
  },
  "pick-first": {
    title: "编号小先挑",
    text: "公共牌按这一轮出的编号从小到大轮流挑，挑走的不补；最后剩的那张移出游戏。",
  },
  "prereq-red": {
    title: "红色「缺条件」是什么",
    text: "这张卡的前置条件现在还不够。终局从右往左计分，右边以后打出的卡和圣所都能帮它凑。",
  },
  "last-round": {
    title: "最后一轮",
    text: "第 8 轮出完就计分，不再挑公共牌；手里剩的 2 张不算分。比上一张大照样能拿圣所。",
  },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。auto：自己正被托管。 */
export function detectTips(game: GameState, selfId: string, auto: boolean): string[] {
  const ids: string[] = [];
  if (!selfId) return ids;
  for (const event of game.events) {
    if (event.type === "SanctuariesDrawn" && event.player === selfId && event.count > 0) ids.push("discover-self");
    if (event.type === "SanctuariesDrawn" && event.count < event.wanted) ids.push("short-deck");
  }
  if (auto) ids.push("auto-self");
  for (const event of game.events) {
    if (event.type === "TimedOut" && event.players.includes(selfId)) ids.push("timeout");
    if (event.type === "Revealed" && game.round === 1) ids.push("pick-first");
    if (event.type === "RoundStarted" && event.round === game.config.rounds) ids.push("last-round");
  }
  const me = game.players.find((player) => player.id === selfId);
  if (me && game.events.some((event) => event.type === "Revealed") && me.played.some((card) => Object.keys(region(card).prereq).length > 0) && game.config.assist) {
    ids.push("prereq-red");
  }
  return ids;
}
