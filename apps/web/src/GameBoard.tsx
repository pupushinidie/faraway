/**
 * 调试牌桌（引擎阶段用）：把局面和每个合法动作列出来，界面阶段换成正式牌桌。
 */
import type { ReactNode } from "react";
import { legalActions, scorePlayer, stepKey, type GameCommand, type LobbyRoomSnapshot } from "@faraway/game";
import { socket } from "./socket.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  readonly onLeave: () => void;
}

function label(command: GameCommand): string {
  if (command.type === "play") return `出 ${command.card}`;
  if (command.type === "take") return `挑 ${command.card}`;
  return `留 S${command.sanctuary}`;
}

export default function GameBoard(props: GameBoardProps) {
  const { room } = props;
  const game = room.game!;
  const me = room.members.find((member) => member.id === socket.id);
  const seat = me?.playerId ?? "";
  const actions = seat ? legalActions(game, seat) : [];
  return (
    <div className="debug-board">
      <header>{props.brand} {props.connection} {props.themeToggle}</header>
      <p>第 {game.round} 轮 · {game.phase} · 公共牌 {game.market.join(" ")} · 移出 {game.removed.join(" ")} · 牌堆 {game.regionDeckCount} / 圣所 {game.sanctuaryDeckCount}</p>
      <p>顺序 {game.resolveOrder.join(" → ")}（第 {game.resolveIndex + 1} 个）</p>
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            {player.name}：出牌区 {player.played.join(" ")} · 圣所 {player.sanctuaries.map((id) => `S${id}`).join(" ")} · 手牌 {player.hand.join(" ") || `${player.handCount} 张`}
            {player.submitted ? " · 已出" : ""}{player.offer.length ? ` · 待选 ${player.offer.map((id) => `S${id}`).join(" ")}` : player.offerCount ? ` · 待选 ${player.offerCount} 张` : ""}
            {" · 现在 "}{scorePlayer(player.played, player.sanctuaries).total} 分
          </li>
        ))}
      </ul>
      <div>
        {actions.map((action) => (
          <button key={label(action)} type="button" disabled={props.busy} onClick={() => props.onCommand({ ...action, step: stepKey(game) })}>
            {label(action)}
          </button>
        ))}
      </div>
      {game.finalResult && (
        <p>
          终局：{game.finalResult.ranking.map((id) => `${game.players.find((player) => player.id === id)!.name} ${game.finalResult!.scores[id]!.total}`).join(" · ")}
          {room.rematch && <button type="button" onClick={() => props.onRematch(true)}>再来一局</button>}
        </p>
      )}
      {props.error && <p className="error">{props.error}</p>}
      {props.chat}
    </div>
  );
}
