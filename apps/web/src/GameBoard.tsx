/**
 * 遥远之地的牌桌。
 *
 * 桌面：顶栏 | 对手条 | 中间行（轮到谁 / 倒计时 / 挑牌顺序 + 公共牌）| 我的出牌区 8 格（辅助显示：每张按现在算几分）|
 *       手牌行（手牌 3 张 + 操作按钮 + 我的圣所）。抽到圣所时上方弹出「选 1 张留下」面板（不挡公共牌和手牌）。
 * 手机：竖排，第一屏是状态条、手牌、按钮、公共牌、我的出牌区；对手、聊天在下面。
 * 操作都是两步：点一下选中（显示说明和后果），再点同一张或「确认」才提交；Esc 取消。出了不能撤回。
 * 终局：所有人的出牌区同时从右往左一张张翻开计分（约 12 秒，可以跳过），最后加圣所分、排名次。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  botHint,
  currentPicker,
  discoveryFor,
  legalActions,
  region,
  sanctuary,
  scorePlayer,
  stepKey,
  waitingFor,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Player,
} from "@faraway/game";
import { seatColor } from "./art.js";
import { describeRegion, describeSanctuary, RegionCardView, RegionChip, SanctuaryCardView, SanctuaryChip } from "./cards.js";
import { confirmSound, gameOverSound, pickSound, scoreTick, useGameSfx } from "./game-sfx.js";
import GameRules from "./GameRules.js";
import { useSfxCountdown } from "./gm-sound.js";
import { pickFinalCw, pickLayout } from "./layout.js";
import { socket } from "./socket.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, TIPS } from "./tutorial/tutorialGame.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly themeToggle: ReactNode;
  readonly theme?: "day" | "night";
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  readonly onLeave: () => void;
  /** 预览页用：强制显示「提示」按钮。正常只在练习局和「只有自己和人机」的房间里有。 */
  readonly showHint?: boolean;
  /** 自己在 room.members 里的 id；默认 socket.id。新手教程在本地拼房间，传固定值。 */
  readonly selfMemberId?: string;
  /** online：真实对局；tutorial：教程剧本中（不出提示）；practice：教程后的练习局（随时能用「提示」）。 */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 终局面板里替代「再来一局」的按钮（练习局）。 */
  readonly finalActions?: ReactNode;
  /** 预览页、教程用：终局停在翻牌的第几步（0–10，10 = 翻完）。 */
  readonly finalStep?: number;
  /** 教程用：这一步能不能提交（返回 false 时只选中不提交）。 */
  readonly allowCommand?: (command: GameCommand) => boolean;
  /** 教程用：顶栏右边额外的按钮（退出教程等），替代托管 / 解散。 */
  readonly extraTop?: ReactNode;
}

function useViewport(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () => setSize(read());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

function useReducedMotion(): boolean {
  const [reduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  return reduced;
}

type Selection = { kind: "play" | "take"; card: number } | { kind: "keep"; sanctuary: number } | null;
type Detail = { kind: "region"; id: number } | { kind: "sanctuary"; id: number } | null;

function sameSelection(a: Selection, b: Selection): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "keep" && b.kind === "keep") return a.sanctuary === b.sanctuary;
  return (a as { card: number }).card === (b as { card: number }).card;
}

function memberTags(member: LobbyMember | undefined): ReactNode {
  if (!member) return null;
  return (
    <>
      {member.bot && <em className="fa-tag bot">人机</em>}
      {member.auto && <em className="fa-tag auto">托管</em>}
      {!member.connected && !member.bot && <em className="fa-tag warn">离线</em>}
    </>
  );
}

function GameBoard(props: GameBoardProps) {
  const { room, busy, error, notice, brand, connection, themeToggle, chat, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave } = props;
  const { selfMemberId, mode = "online", finalActions } = props;
  const game = room.game!;
  const viewport = useViewport();
  const n = game.players.length;
  const layout = useMemo(() => pickLayout(viewport.w, viewport.h, n), [viewport.w, viewport.h, n]);
  const reduced = useReducedMotion();
  const member = room.members.find((candidate) => candidate.id === (selfMemberId ?? socket.id));
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const me = game.players.find((player) => player.id === myId) ?? game.players[0]!;
  const autoPlaying = member?.auto === true;
  const assist = game.config.assist;
  const secondsLeft = useCountdown(room);
  const waiting = waitingFor(game);
  const picker = currentPicker(game);
  const actions = spectating ? [] : legalActions(game, myId);
  const canAct = !spectating && !autoPlaying && !busy;
  const nameOf = (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const step = stepKey(game);

  useGameSfx({ game, selfId });
  const needMe = canAct && actions.length > 0;
  useSfxCountdown(needMe && mode !== "tutorial", secondsLeft);

  // ---------- 选中 → 确认 ----------
  const [selection, setSelection] = useState<Selection>(null);
  useEffect(() => setSelection(null), [step, me.offerCount]);
  const canPlay = canAct && actions.some((action) => action.type === "play");
  const canTake = canAct && actions.some((action) => action.type === "take");
  const canKeep = canAct && actions.some((action) => action.type === "keep");
  const [detail, setDetail] = useState<Detail>(null);

  function send(command: GameCommand) {
    if (props.allowCommand && !props.allowCommand(command)) return;
    props.onCommand({ ...command, step: stepKey(game) });
    setSelection(null);
  }
  function confirm(sel: Selection = selection) {
    if (!sel) return;
    if (sel.kind === "play" && canPlay) send({ type: "play", card: sel.card });
    else if (sel.kind === "take" && canTake) send({ type: "take", card: sel.card });
    else if (sel.kind === "keep" && canKeep) send({ type: "keep", sanctuary: sel.sanctuary });
  }
  function choose(next: NonNullable<Selection>) {
    if (sameSelection(selection, next)) {
      confirmSound();
      confirm(next);
      return;
    }
    pickSound(true);
    setSelection(next);
  }
  function clickHand(card: number) {
    if (!canPlay) {
      setDetail({ kind: "region", id: card });
      return;
    }
    choose({ kind: "play", card });
  }
  function clickMarket(card: number) {
    if (!canTake) {
      setDetail({ kind: "region", id: card });
      return;
    }
    choose({ kind: "take", card });
  }
  function clickOffer(id: number) {
    if (!canKeep) return;
    choose({ kind: "keep", sanctuary: id });
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea")) return;
      if (event.key === "Escape") {
        setSelection(null);
        setDetail(null);
      }
      if ((event.key === "Enter" || event.key === " ") && selection) {
        event.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 提示（练习局、只有自己和人机的房间） ----------
  const botsOnly = !spectating && room.members.length > 1 && room.members.every((candidate) => candidate.id === member?.id || candidate.bot === true);
  const hintAllowed = props.showHint === true || mode === "practice" || (mode === "online" && botsOnly);
  // 提示跟着「这一步」走：别人出牌、留圣所（version 变了）不收起，轮到下一步才收起
  const hintKey = `${step}:${me.submitted}:${me.offerCount}:${me.handCount}`;
  const [hint, setHint] = useState<{ key: string; say: string; reason: string; anchor: string } | null>(null);
  const shownHint = hint && hint.key === hintKey ? hint : null;
  function askHint() {
    if (shownHint) {
      setHint(null);
      return;
    }
    const decision = botHint(game, myId);
    if (!decision) return;
    const command = decision.command;
    let anchor = "";
    if (command.type === "keep") {
      setSelection({ kind: "keep", sanctuary: command.sanctuary });
      anchor = `offer:${command.sanctuary}`;
    } else {
      setSelection({ kind: command.type, card: command.card });
      anchor = command.type === "play" ? `hand:${command.card}` : `market:${command.card}`;
    }
    const say = command.type === "play" ? `我会出 ${command.card}。` : command.type === "take" ? `我会挑 ${command.card}。` : "我会留这张圣所。";
    setHint({ key: hintKey, say, reason: decision.reason.replace(/^[^：]*：/, ""), anchor });
    pickSound(true);
  }
  useEffect(() => {
    if (!hintAllowed) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea")) return;
      if ((event.key === "h" || event.key === "H") && needMe) askHint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, selfId, autoPlaying), TIPS, mode === "online" && !spectating);

  // ---------- 聊天抽屉、圣所面板 ----------
  const [chatOpen, setChatOpen] = useState(false);
  const hasOffer = me.offer.length > 0;

  // 这一轮刚翻开的牌：出牌区最右边那张放入场动画（只看 version；持久计时器，不在 version 变化时清掉）
  const [freshRound, setFreshRound] = useState(0);
  const freshTimer = useRef<number | undefined>(undefined);
  const lastVersion = useRef(game.version);
  useEffect(() => {
    const prev = lastVersion.current;
    lastVersion.current = game.version;
    if (game.version <= prev || game.version - prev > 4) return;
    if (game.events.some((event) => event.type === "Revealed")) {
      setFreshRound(game.round);
      window.clearTimeout(freshTimer.current);
      freshTimer.current = window.setTimeout(() => setFreshRound(0), 2000);
    }
  }, [game.version]);
  useEffect(() => () => window.clearTimeout(freshTimer.current), []);

  const timedOut = game.events[0]?.type === "TimedOut" && selfId !== "" && game.events[0].players.includes(selfId);
  const myScore = useMemo(() => scorePlayer(me.played, me.sanctuaries), [me.played.join(","), me.sanctuaries.join(",")]);
  const others = game.players.filter((player) => player.id !== me.id);

  // ---------- 状态文字 ----------
  let headline = "";
  let subline = "";
  const notPlayed = game.phase === "play" ? waiting.length : 0;
  if (game.phase === "play") {
    if (spectating) {
      headline = "大家同时出牌";
      subline = `还有 ${notPlayed} 人没出`;
    } else if (!me.submitted) {
      headline = "选一张打出";
      subline = game.round === 1 ? "大家同时出；编号小的先挑公共牌" : "比上一张大能发现圣所；编号小先挑公共牌";
    } else {
      headline = "已出，等别人";
      subline = `还有 ${notPlayed} 人没出（出了不能撤回）`;
    }
  } else if (game.phase === "resolve") {
    const iPick = picker === myId && !spectating;
    if (hasOffer && !spectating) {
      headline = iPick ? "留圣所、挑牌" : "选 1 张圣所";
      subline = iPick ? "发现了圣所，也轮到你挑公共牌；先做哪件都行" : picker ? `发现了圣所！${nameOf(picker)} 在挑公共牌` : "发现了圣所！留好就进下一轮";
    } else if (iPick) {
      headline = "轮到你挑牌";
      subline = "挑 1 张补回手里，剩下的给后面的人";
    } else if (picker) {
      headline = `${nameOf(picker)} 挑牌中`;
      subline = "按这一轮出的编号，从小到大轮流挑";
    } else {
      headline = game.round >= game.config.rounds ? "第 8 轮不挑" : "等人留圣所";
      subline = `等 ${waiting.map(nameOf).join("、")} 选圣所`;
    }
  } else {
    headline = "倒序计分";
  }

  const style = {
    "--cw": `${layout.cw}px`,
    "--hand-cw": `${layout.handCw}px`,
    "--market-cw": `${layout.marketCw}px`,
    "--row-cw": `${layout.rowCw}px`,
    "--sw": `${layout.sw}px`,
    "--sh": `${layout.sh}px`,
    "--opp-cols": layout.oppColumns,
    "--status-w": `${layout.statusW}px`,
    "--action-w": `${layout.actionW}px`,
  } as CSSProperties;

  const timer = secondsLeft !== null && game.phase !== "ended" && mode !== "tutorial" ? (
    <span className={`fa-timer${needMe && secondsLeft <= 10 ? " hurry" : ""}`} data-tutorial="timer">{secondsLeft}<small>秒</small></span>
  ) : null;

  const topbar = (
    <header className="topbar fa-topbar">
      {brand}
      <span className="fa-round" data-tutorial="round">{layout.mode === "desk" && "第 "}<b>{game.round}</b>/8 轮</span>
      <span className="fa-decks" title="区域牌堆、圣所牌堆还剩几张">牌堆 {game.regionDeckCount} · 圣所堆 {game.sanctuaryDeckCount}</span>
      {autoPlaying && layout.mode === "desk" && <span className="fa-banner" role="status">托管中：人机在替你打</span>}
      <div className="topbar-right">
        {spectating && <span className="fa-tag watch">观战中</span>}
        {props.extraTop}
        {!spectating && game.phase !== "ended" && mode === "online" && layout.mode === "desk" && (
          <button className="quiet-button" type="button" onClick={() => onAuto(!autoPlaying)}>{autoPlaying ? "取消托管" : "托管"}</button>
        )}
        <GameRules />
        {mode === "online" && (
          <button className={`quiet-button fa-chat-toggle${chatOpen ? " on" : ""}`} type="button" onClick={() => setChatOpen(!chatOpen)} aria-expanded={chatOpen}>聊天</button>
        )}
        {themeToggle}
        {mode === "online" && isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
        {mode === "online" && spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开</button>}
        {connection}
      </div>
    </header>
  );

  const status = (
    <section className={`fa-status${needMe ? " mine" : ""}${layout.mode === "desk" && layout.cw < 100 ? " tight" : ""}`} data-tutorial="status">
      <div className="fa-status-head">
        <strong>{headline}</strong>
        {timer}
      </div>
      {subline && <p>{subline}</p>}
      <OrderStrip game={game} selfId={selfId} nameOf={nameOf} />
    </section>
  );

  const market = (
    <section className="fa-market" data-tutorial="market" aria-label="公共牌">
      <div className="fa-label">公共牌<small>{game.round >= game.config.rounds ? "第 8 轮不挑" : "按编号从小到大轮流挑"}</small>
        {game.removed.length > 0 && (
          <span className="fa-removed" title="每轮公共牌剩下的那张移出游戏">
            移出{game.removed.map((card) => <button key={card} type="button" onClick={() => setDetail({ kind: "region", id: card })}>{card}</button>)}
          </span>
        )}
      </div>
      <div className="fa-cards">
        {game.market.map((card) => (
          <RegionCardView
            key={card}
            id={card}
            cw={layout.marketCw}
            className={`${canTake ? "can" : ""}${selection?.kind === "take" && selection.card === card ? " picked" : ""}`}
            onClick={() => clickMarket(card)}
            tutorial={`market:${card}`}
          />
        ))}
        {game.market.length === 0 && <div className="fa-empty">{game.round >= game.config.rounds ? "最后一轮没有公共牌" : "挑完了"}</div>}
      </div>
    </section>
  );

  const myRow = (
    <section className="fa-mine" data-tutorial="my-row" aria-label="出牌区">
      <div className="fa-mine-head">
        <span className="fa-who" style={{ "--seat": seatColor(me.seat) } as CSSProperties}>{me.id === selfId ? "我的出牌区" : `${me.name} 的出牌区`}</span>
        {assist && (
          <span className="fa-score" data-tutorial="my-score" title="按现在的出牌区和圣所倒序计分">
            <b>{myScore.total}</b>分<small>按现在算</small>
          </span>
        )}
      </div>
      <div className="fa-row">
        {Array.from({ length: 8 }, (_, index) => {
          const card = me.played[index];
          if (card === undefined) {
            const pending = index === me.played.length && me.pendingPlay !== null;
            return (
              <div key={index} className={`fa-slot${pending ? " pending" : ""}`}>
                {pending ? <RegionCardView id={me.pendingPlay!} cw={layout.rowCw} className="ghost" /> : <span>{index + 1}</span>}
              </div>
            );
          }
          const ok = myScore.prereqOk[index]!;
          return (
            <div key={index} className="fa-played">
              <RegionCardView
                id={card}
                cw={layout.rowCw}
                className={freshRound === game.round && index === me.played.length - 1 && !reduced ? "fresh" : ""}
                onClick={() => setDetail({ kind: "region", id: card })}
                tutorial={`played:${card}`}
              />
              {assist && region(card).quest && (
                <span className={`fa-pts${ok ? "" : " bad"}`} data-tutorial={`pts:${card}`}>{ok ? myScore.regions[index] : <>0<small>缺条件</small></>}</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  // 发现圣所：在操作区里摆出抽到的几张，选 1 张留下（不挡公共牌、手牌和出牌区）
  const offerSw = Math.min(80, layout.sw + 16);
  const offer = !spectating && hasOffer && game.phase === "resolve" ? (
    <div className="fa-offer" data-tutorial="offer">
      <div className="fa-offer-head">
        <span className="fa-fx-sanct" aria-hidden="true" />
        <div>
          <strong>发现圣所！选 1 张留下</strong>
          <p>其余放回牌堆底。圣所的资源、颜色、夜计分时一直算。</p>
        </div>
      </div>
      <div className="fa-cards">
        {me.offer.map((id) => {
          const gain = scorePlayer(me.played, [...me.sanctuaries, id]).total - myScore.total;
          return (
            <div key={id} className="fa-played">
              <SanctuaryCardView
                id={id}
                sw={offerSw}
                sh={layout.sh}
                className={`${canKeep ? "can" : ""}${selection?.kind === "keep" && selection.sanctuary === id ? " picked" : ""}`}
                onClick={() => clickOffer(id)}
                tutorial={`offer:${id}`}
              />
              {assist && <span className={`fa-pts${gain > 0 ? " good" : " off"}`}>+{gain}</span>}
            </div>
          );
        })}
      </div>
      {me.offerWanted > me.offer.length && <p className="fa-note">牌堆不够：本来能抽 {me.offerWanted} 张，只抽到 {me.offer.length} 张。</p>}
    </div>
  ) : null;

  const handRow = (
    <section className="fa-handrow">
      <div className="fa-hand" data-tutorial="hand" aria-label="手牌">
        <div className="fa-label">{spectating ? `${me.name} 的手牌` : "手牌"}<small>{spectating ? `${me.handCount} 张` : canPlay ? "点一张选中，再点一下打出" : ""}</small></div>
        <div className="fa-cards">
          {spectating
            ? Array.from({ length: me.handCount }, (_, index) => <RegionCardView key={index} id={1} back cw={layout.handCw} />)
            : me.hand.map((card) => {
              const discovery = discoveryFor(me.played, me.sanctuaries, card);
              return (
                <div key={card} className="fa-played">
                  <RegionCardView
                    id={card}
                    cw={layout.handCw}
                    className={`${canPlay ? "can" : ""}${selection?.kind === "play" && selection.card === card ? " picked" : ""}`}
                    onClick={() => clickHand(card)}
                    tutorial={`hand:${card}`}
                  />
                  {assist && game.phase === "play" && !me.submitted && (
                    <span className={`fa-pts${discovery.discovered ? " good" : " off"}`}>{discovery.discovered ? `圣所×${discovery.count}` : me.played.length ? "无圣所" : "首轮"}</span>
                  )}
                </div>
              );
            })}
          {!spectating && me.hand.length === 0 && <div className="fa-empty">没有手牌</div>}
        </div>
      </div>
      <ActionBox
        game={game}
        selection={selection}
        canConfirm={(selection?.kind === "play" && canPlay) || (selection?.kind === "take" && canTake) || (selection?.kind === "keep" && canKeep)}
        onConfirm={() => confirm()}
        onCancel={() => setSelection(null)}
        hint={hintAllowed && needMe ? { text: shownHint ? shownHint.say : null, onAsk: askHint } : null}
        autoPlaying={autoPlaying}
        onCancelAuto={() => onAuto(false)}
        timedOut={timedOut}
        spectating={spectating}
        offer={offer}
        onAuto={!spectating && game.phase !== "ended" && mode === "online" && layout.mode === "phone" && !autoPlaying ? () => onAuto(true) : undefined}
      />
      <div className="fa-sancts" data-tutorial="my-sanctuaries" aria-label="圣所">
        <div className="fa-label">圣所<small>{me.sanctuaries.length ? "一直算" : "比上一张大才有"}</small></div>
        <div className="fa-cards">
          {me.sanctuaries.map((id, index) => (
            <div key={id} className="fa-played">
              <SanctuaryCardView id={id} sw={layout.sw} sh={layout.sh} onClick={() => setDetail({ kind: "sanctuary", id })} tutorial={`sanct:${id}`} />
              {assist && sanctuary(id).quest && <span className="fa-pts">{myScore.sanctuaries[index]}</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const opps = (
    <section className="fa-opps" data-tutorial="opponents">
      {others.map((player) => (
        <OppPanel
          key={player.id}
          player={player}
          member={memberOf(player.id)}
          game={game}
          assist={assist}
          picking={picker === player.id}
          waiting={waiting.includes(player.id)}
          onDetail={setDetail}
          onWatch={spectating ? () => onWatch(player.id) : undefined}
        />
      ))}
    </section>
  );

  return (
    <div className={`fa-board ${layout.mode}${game.phase === "ended" ? " ended" : ""}`} style={style}>
      {topbar}
      {layout.mode === "desk" ? (
        <>
          {opps}
          <div className="fa-center">{status}{market}</div>
          {myRow}
          {handRow}
        </>
      ) : (
        <>
          {status}
          {handRow}
          {market}
          {myRow}
          {opps}
        </>
      )}
      {(error || notice) && <div className={`fa-toast${error ? " error" : ""}`} role="status">{error || notice}</div>}
      {mode === "online" && (
        <aside className={`fa-chat${chatOpen ? " open" : ""}`} aria-hidden={!chatOpen}>
          <div className="fa-chat-head">
            <strong>聊天和语音</strong>
            <button className="quiet-button" type="button" onClick={() => setChatOpen(false)}>收起</button>
          </div>
          {chat}
        </aside>
      )}
      {detail && <DetailDialog detail={detail} onClose={() => setDetail(null)} />}
      {shownHint && (
        <Coach
          bubble
          view={{
            key: `hint-${hintKey}`,
            say: shownHint.say,
            note: shownHint.reason,
            anchor: shownHint.anchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setHint(null)}>知道了</button>,
          }}
        />
      )}
      {tips.tip && game.phase !== "ended" && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
      {game.phase === "ended" && (
        <FinalPanel
          game={game}
          room={room}
          myId={myId}
          selfId={selfId}
          memberId={member?.id ?? ""}
          spectating={spectating}
          onRematch={onRematch}
          onLeave={onLeave}
          actions={finalActions}
          viewport={viewport}
          reduced={reduced}
          fixedStep={props.finalStep}
        />
      )}
    </div>
  );
}

/** 阶段③的顺序条：按这一轮出的编号从小到大，轮到谁高亮；出牌阶段显示谁已出。 */
function OrderStrip({ game, selfId, nameOf }: { game: GameState; selfId: string; nameOf: (id: string) => string }) {
  const picker = currentPicker(game);
  if (game.phase === "resolve" && game.lastReveal) {
    return (
      <ol className="fa-order" data-tutorial="order" aria-label="这一轮的挑牌顺序">
        {game.lastReveal.plays.map((play, index) => {
          const player = game.players.find((candidate) => candidate.id === play.player)!;
          const done = game.round < game.config.rounds && index < game.resolveIndex;
          return (
            <li key={play.player} className={`${picker === play.player ? "now" : ""}${done ? " done" : ""}${play.player === selfId ? " me" : ""}`} style={{ "--seat": seatColor(player.seat) } as CSSProperties}>
              <b>{play.card}</b>
              <span>{nameOf(play.player)}</span>
              {play.discovered && <i title="发现圣所">圣</i>}
            </li>
          );
        })}
      </ol>
    );
  }
  if (game.phase === "play") {
    return (
      <ol className="fa-order submitted" aria-label="谁已出牌">
        {game.players.map((player) => (
          <li key={player.id} className={`${player.submitted ? "done" : ""}${player.id === selfId ? " me" : ""}`} style={{ "--seat": seatColor(player.seat) } as CSSProperties}>
            <b>{player.submitted ? "✓" : "…"}</b>
            <span>{nameOf(player.id)}</span>
          </li>
        ))}
      </ol>
    );
  }
  return null;
}

function OppPanel({ player, member, game, assist, picking, waiting, onDetail, onWatch }: {
  player: Player;
  member: LobbyMember | undefined;
  game: GameState;
  assist: boolean;
  picking: boolean;
  waiting: boolean;
  onDetail: (detail: Detail) => void;
  onWatch: (() => void) | undefined;
}) {
  let state = "";
  if (game.phase === "play") state = player.submitted ? "已出" : "思考中";
  else if (game.phase === "resolve") state = picking ? "挑牌中" : player.offerCount > 0 ? `选圣所` : "";
  const score = assist ? scorePlayer(player.played, player.sanctuaries).total : null;
  return (
    <div className={`fa-opp${waiting ? " busy" : ""}${picking ? " picking" : ""}`} style={{ "--seat": seatColor(player.seat) } as CSSProperties} data-tutorial={`seat:${player.id}`}>
      <div className="fa-opp-head">
        <button type="button" className="fa-opp-name" onClick={onWatch} disabled={!onWatch} title={onWatch ? "从他的座位看" : undefined}>{member?.name ?? player.name}</button>
        {memberTags(member)}
        {state && <span className={`fa-opp-state${waiting ? " live" : ""}`}>{state}</span>}
        {score !== null && <span className="fa-opp-score"><b>{score}</b>分</span>}
      </div>
      <div className="fa-opp-cards">
        {player.played.map((card) => <RegionChip key={card} id={card} onClick={() => onDetail({ kind: "region", id: card })} />)}
        {Array.from({ length: Math.max(0, 8 - player.played.length) }, (_, index) => <span key={index} className="fa-chip empty" />)}
        <span className="fa-opp-sancts">
          {player.sanctuaries.map((id) => <SanctuaryChip key={id} id={id} onClick={() => onDetail({ kind: "sanctuary", id })} />)}
        </span>
      </div>
    </div>
  );
}

function ActionBox({ game, selection, canConfirm, onConfirm, onCancel, hint, autoPlaying, onCancelAuto, timedOut, spectating, offer, onAuto }: {
  game: GameState;
  selection: Selection;
  canConfirm: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  hint: { text: string | null; onAsk: () => void } | null;
  autoPlaying: boolean;
  onCancelAuto: () => void;
  timedOut: boolean;
  spectating: boolean;
  /** 抽到的圣所（选 1 张留下），没有就是 null。 */
  offer: ReactNode;
  /** 手机上「托管」按钮放在操作区（顶栏放不下）。 */
  onAuto: (() => void) | undefined;
}) {
  let label = "";
  let text = "";
  if (selection?.kind === "play") {
    label = `打出 ${selection.card}`;
    text = describeRegion(selection.card);
  } else if (selection?.kind === "take") {
    label = `挑 ${selection.card}`;
    text = describeRegion(selection.card);
  } else if (selection?.kind === "keep") {
    label = "留这张圣所";
    text = describeSanctuary(selection.sanctuary);
  }
  return (
    <div className={`fa-action${offer ? " has-offer" : ""}`} data-tutorial="action">
      {offer && !autoPlaying && offer}
      {spectating ? (
        <p className="fa-action-text">观战中：只看公开信息，点对手的名字换座位看。</p>
      ) : autoPlaying ? (
        <>
          <p className="fa-action-text">托管中，人机在替你出牌。</p>
          <button className="primary-button fa-confirm" type="button" onClick={onCancelAuto}>取消托管</button>
        </>
      ) : selection ? (
        <>
          <p className="fa-action-text">{text}</p>
          <div className="fa-action-buttons">
            <button className="quiet-button" type="button" onClick={onCancel}>取消</button>
            <button className="primary-button fa-confirm" type="button" disabled={!canConfirm} onClick={onConfirm} data-tutorial="confirm">{label}</button>
          </div>
        </>
      ) : offer ? null : (
        <p className="fa-action-text">{timedOut ? "刚才超时了，系统替你做了这一步。" : game.phase === "ended" ? "" : "点卡片看说明；能选的卡会亮起来。"}</p>
      )}
      {onAuto && <button className="quiet-button fa-auto-phone" type="button" onClick={onAuto}>托管（人机代打）</button>}
      {hint && !autoPlaying && (
        <div className="fa-hint">
          <button className="quiet-button" type="button" onClick={hint.onAsk} data-tutorial="hint">{hint.text ? "收起提示" : "提示"}</button>
        </div>
      )}
    </div>
  );
}

function DetailDialog({ detail, onClose }: { detail: NonNullable<Detail>; onClose: () => void }) {
  return (
    <div className="gm-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="gm-panel fa-detail" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        {detail.kind === "region" ? <RegionCardView id={detail.id} cw={256} /> : <SanctuaryCardView id={detail.id} sw={160} sh={240} />}
        <p>{detail.kind === "region" ? describeRegion(detail.id) : describeSanctuary(detail.id)}</p>
        <button className="primary-button" type="button" onClick={onClose}>知道了</button>
      </section>
    </div>
  );
}

function useRematchSeconds(remainingMs: number | undefined): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState(() => ({ at: Date.now(), ms: remainingMs }));
  useEffect(() => setAnchor({ at: Date.now(), ms: remainingMs }), [remainingMs]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

const FINAL_STEPS = 10; // 8 张区域卡 + 圣所 + 名次

/** 终局：所有人的出牌区同时从右往左翻开计分，最后加圣所分、排名次。 */
function FinalPanel({ game, room, myId, selfId, memberId, spectating, onRematch, onLeave, actions, viewport, reduced, fixedStep }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  selfId: string;
  memberId: string;
  spectating: boolean;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
  actions?: ReactNode;
  viewport: { w: number; h: number };
  reduced: boolean;
  fixedStep: number | undefined;
}) {
  const result = game.finalResult!;
  // 刚结束（这一步的事件里有 GameEnded）才放动画；重连、刷新进来直接看结果
  const animate = !reduced && game.events.some((event) => event.type === "GameEnded");
  const [stepNow, setStepNow] = useState(animate ? 0 : FINAL_STEPS);
  const step = fixedStep ?? stepNow;
  useEffect(() => {
    if (fixedStep !== undefined || stepNow >= FINAL_STEPS) return;
    const timer = window.setTimeout(() => setStepNow(stepNow + 1), stepNow === 0 ? 800 : 1100);
    return () => window.clearTimeout(timer);
  }, [stepNow, fixedStep]);
  useEffect(() => {
    if (fixedStep !== undefined || stepNow === 0 || stepNow > 8) return;
    scoreTick(result.scores[myId]?.regions[8 - stepNow] ?? 0, true);
  }, [stepNow]);
  useEffect(() => {
    if (fixedStep === undefined && stepNow === FINAL_STEPS && animate) gameOverSound(selfId === "" || result.winners.includes(selfId));
  }, [stepNow === FINAL_STEPS]);
  const done = step >= FINAL_STEPS;
  const cw = pickFinalCw(viewport.w, viewport.h, game.players.length);
  const order = done ? result.ranking : game.players.map((player) => player.id);
  const accepted = room.rematch?.acceptedIds.includes(memberId) ?? false;
  const rematchSeconds = useRematchSeconds(room.rematch?.remainingMs);
  const winner = game.players.find((player) => player.id === result.winners[0])!;
  const title = !done ? "从右往左翻开计分…" : spectating ? `${winner.name} 获胜` : result.winners.includes(myId) ? "你赢了！" : `${winner.name} 获胜`;
  const small = cw < 64;
  const opened = Math.min(step, 8);
  return (
    <div className="gm-modal-backdrop fa-final-backdrop" role="presentation">
      <section className={`gm-panel fa-final${small ? " compact" : ""}${viewport.w < 900 ? " phone" : ""}`} role="dialog" aria-modal="true" aria-labelledby="fa-final-title" data-tutorial="final" style={{ "--fcw": `${cw}px` } as CSSProperties}>
        <div className="fa-final-head">
          <h2 id="fa-final-title">{title}</h2>
          <p>{done ? (result.tieBreak ? "总分并列：出牌区里编号最小的那张更小的人赢" : "区域卡分 + 圣所分，总分最高的人赢") : "每张卡只看得到自己、右边已翻开的卡和全部圣所"}</p>
          {!done && fixedStep === undefined && <button className="quiet-button" type="button" onClick={() => setStepNow(FINAL_STEPS)}>跳过</button>}
        </div>
        <div className="fa-final-rows">
          {order.map((id, rank) => {
            const player = game.players.find((candidate) => candidate.id === id)!;
            const score = result.scores[id]!;
            const shownRegions = score.regions.reduce((sum, value, index) => sum + (index >= 8 - opened ? value : 0), 0);
            const total = step >= 9 ? score.total : shownRegions;
            return (
              <div key={id} className={`fa-final-row${id === myId ? " me" : ""}${done && rank === 0 ? " winner" : ""}`} style={{ "--seat": seatColor(player.seat) } as CSSProperties} data-tutorial={`final:${id}`}>
                <div className="fa-final-who">
                  {done && <span className="fa-rank">{rank + 1}</span>}
                  <span className="fa-final-name">{id === selfId ? `${player.name}（你）` : player.name}</span>
                  <span className="fa-final-total"><b>{total}</b>分</span>
                </div>
                <div className="fa-final-cards">
                  {player.played.map((card, index) => {
                    const open = index >= 8 - opened;
                    const justOpened = open && index === 8 - step && fixedStep === undefined;
                    return (
                      <div key={card} className="fa-played">
                        {small ? <RegionChip id={card} className={open ? "" : "hidden"} /> : <RegionCardView id={card} back={!open} cw={cw} />}
                        <span className={`fa-pts${open ? (score.prereqOk[index] ? "" : " bad") : " wait"}`}>
                          {open ? score.regions[index] : "?"}
                          {justOpened && <i className="fa-fx-score" aria-hidden="true" />}
                        </span>
                      </div>
                    );
                  })}
                  <div className="fa-final-sancts">
                    {player.sanctuaries.map((sid, index) => (
                      <span key={sid} className="fa-final-sanct">
                        <SanctuaryChip id={sid} />
                        <em>{step >= 9 ? score.sanctuaries[index] : "·"}</em>
                      </span>
                    ))}
                    {step >= 9 && <span className="fa-final-sum">圣所 <b>{score.sanctuaryTotal}</b></span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {done && (actions ? (
          <div className="fa-rematch" data-tutorial="final-actions"><span>练习局打完了</span><div className="gm-panel-actions">{actions}</div></div>
        ) : spectating ? (
          <div className="fa-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onLeave}>离开观战</button></div>
          </div>
        ) : room.rematch && (
          <div className="fa-rematch" data-tutorial="rematch">
            <span>再来一局？还剩 {rematchSeconds ?? Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button fa-confirm" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export default GameBoard;
