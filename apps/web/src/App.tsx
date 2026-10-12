import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  CAPACITY_OPTIONS,
  DEFAULT_OPTIONS,
  type Capacity,
  type GameCommand,
  type GameOptions,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
} from "@faraway/game";
import { avatarArt, iconArt, seatColor } from "./art.js";
import { RegionCardView, SanctuaryCardView } from "./cards.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import OnlineRooms from "./OnlineRooms.js";
import RoomChat from "./RoomChat.js";
import { roomRole, RoomSettingsPanel, SeatSwitch } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { ThemeToggle, useTheme, type Theme } from "./theme.js";
import { type BgmTrack, SoundToggle, sfx, useBgm, useRoomSfx } from "./gm-sound.js";
import { TutorialInvite } from "./tutorial/Invite.js";
import { readTutorial } from "./tutorial/storage.js";
import { GAME_ID } from "./tutorial/tutorialGame.js";
import TutorialMode from "./tutorial/TutorialMode.js";
import "./tutorial/tutorial.css";
import { useVoice } from "./voice.js";

type EntryMode = "create" | "join";

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

/** 同一局里版本更低的快照是旧的（再来一局后 game 换了一局，版本从头算，不算旧）。 */
function isStale(next: LobbyRoomSnapshot, current: LobbyRoomSnapshot | null): boolean {
  const a = next.game;
  const b = current?.game;
  if (!a || !b || next.code !== current?.code) return false;
  if (a.version >= b.version) return false;
  // 新开的一局：版本一下子变得很小
  return a.version + 10 > b.version;
}

type Confirm = (request: { title: string; detail: string; confirmLabel: string }) => Promise<boolean>;

/** 服务器拒绝了操作。「这一手已经结算」是点晚了（不算错），不响。 */
function errorSound(message: string) {
  if (!message.includes("已经结算")) sfx.error();
}

// 背景音乐：进了房间（等候房间、对局、观战）和新手教程里放，首页和房间列表不放。gain / start / end 按这首曲子量（见 gm-sound.tsx）。
const BGM: BgmTrack = { src: `${import.meta.env.BASE_URL}bgm/faraway.mp3`, gain: 0.89, start: 0.05, end: 195.5 };

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [confirmAction, confirmDialog] = useConfirm();
  // 白天 / 夜间画面：首页、等候房间、牌桌共用，顶栏按钮随时切换；和游戏中心、其他游戏共用同一个选择。
  const [theme, toggleTheme] = useTheme();
  const themeToggle = <><ThemeToggle theme={theme} onToggle={toggleTheme} /><SoundToggle /></>;
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  // 观战时从谁的座位看（默认第一位玩家）。
  const [watchId, setWatchId] = useState("");
  const voice = useVoice(room);
  // 新手教程：首页或等候房间点进来（地址带 ?tutorial 时直接打开，游戏中心可以直接链过来）
  const [tutorialOpen, setTutorialOpen] = useState(() => new URLSearchParams(window.location.search).has("tutorial"));
  // 声音：进了房间（等候房间、对局、观战）和新手教程里顶栏有 ♪ 面板（音效、语音音量）；这款还没有背景音乐。
  useBgm(room || tutorialOpen ? BGM : null);
  // 房间里的提示音：有人进出、开局、收到别人的聊天。聊天只留最近几十条，按最后一条的 id 变了几次来数。
  const chatSeen = useRef({ id: "", count: 0 });
  const lastChat = room?.chat[room.chat.length - 1];
  if (lastChat && lastChat.id !== chatSeen.current.id) chatSeen.current = { id: lastChat.id, count: chatSeen.current.count + 1 };
  useRoomSfx(room ? { members: room.members.length, playing: room.status === "playing", chatCount: chatSeen.current.count, lastChatMine: lastChat?.senderId === socket.id } : null);
  function closeTutorial() {
    setTutorialOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has("tutorial")) {
      params.delete("tutorial");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }
  // 在等候房间里看教程时，房主一开局就回到牌桌（不然这一步会超时、转成托管）
  useEffect(() => {
    if (tutorialOpen && room?.status === "playing") {
      closeTutorial();
      setNotice("对局开始了，教程先停在这里。");
    }
  }, [tutorialOpen, room?.status]);

  // 在房间里时服务端不推送在线牌桌列表；回到首页时主动拉一次最新的。
  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  // 断线重连：新连接服务器不认识，用原昵称和房间码重新加入，回到自己的座位（服务器重启、房间没了就回首页说明原因）
  const seatRef = useRef<{ name: string; code: string } | null>(null);
  const roomRef = useRef<LobbyRoomSnapshot | null>(null);
  roomRef.current = room;
  const wasDisconnected = useRef(false);
  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
      if (!wasDisconnected.current || !roomRef.current) return;
      wasDisconnected.current = false;
      const seat = seatRef.current;
      if (!seat || !seat.code) {
        setRoom(null);
        setNotice("连接断了一下，请重新进入房间。");
        return;
      }
      socket.emit("room:join", { name: seat.name, code: seat.code }, (response) => {
        if (response.ok) {
          setRoom(response.data);
          setNotice("连接断了一下，已经回到座位。");
        } else {
          setRoom(null);
          setNotice(`连接断开期间房间没了：${response.error}`);
        }
      });
    };
    const handleDisconnect = () => {
      setConnected(false);
      wasDisconnected.current = true;
    };
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom((current) => (isStale(snapshot, current) ? current : snapshot));
    const handleRoomError = (message: string) => {
      setError(message);
      errorSound(message);
    };
    const handleLobbyUpdate = (rooms: PublicRoomSummary[]) => setLobbyRooms(rooms);
    const handleRoomClosed = ({ reason }: { reason: string }) => {
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("lobby:updated", handleLobbyUpdate);
    socket.on("room:closed", handleRoomClosed);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("lobby:updated", handleLobbyUpdate);
      socket.off("room:closed", handleRoomClosed);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  /** 从首页列表加入空座位或进去观战（用上面填的昵称）。 */
  function joinListed(roomId: string, spectate: boolean) {
    const nickname = name.trim();
    if (nickname.length < 2 || nickname.length > 18) {
      setNotice("");
      setError("先在上面填好你的昵称（2–18 个字符）。");
      document.getElementById("player-name")?.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    socket.emit("room:join", { name: nickname, roomId, spectate }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      seatRef.current = { name: nickname, code: response.data.code };
      setNotice(spectate ? "正在观战。" : "已加入房间。");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();

    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      seatRef.current = { name: nickname, code: response.data.code };
      setNotice(mode === "create"
        ? "房间已创建，可以邀请朋友加入。"
        : response.data.status === "playing" ? "已回到对局，继续游戏吧。" : "已加入房间。");
    };

    if (mode === "create") {
      socket.emit("room:create", { name: nickname, capacity, options }, complete);
    } else {
      socket.emit("room:join", { name: nickname, code: roomCode }, complete);
    }
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("");
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(null);
      setError("");
      setNotice("已离开房间。");
    });
  }

  function submitGameCommand(command: GameCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:command", command, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        errorSound(response.error);
        return;
      }
      // 回执里的房间可能比已经收到的广播旧（人机在这期间又动了一步）：旧的不要盖掉新的
      setRoom((current) => (isStale(response.data, current) ? current : response.data));
    });
  }

  /** 房间管理类操作：只关心成败，界面更新由服务端广播。 */
  function roomCommand(send: (ack: (response: { ok: true; data: void } | { ok: false; error: string }) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) {
        setError(response.error);
        errorSound(response.error);
      }
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const addBot = () => roomCommand((ack) => socket.emit("room:add-bot", ack));
  const setAuto = (enabled: boolean) => roomCommand((ack) => socket.emit("room:auto", enabled, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  const changeOptions = (patch: Partial<GameOptions>) => roomCommand((ack) => socket.emit("room:options", patch, ack));
  async function dissolveRoom() {
    const ok = await confirmAction({
      title: "解散房间？",
      detail: "所有玩家都会被移出，当前对局也会结束。",
      confirmLabel: "解散",
    });
    if (ok) roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。");
    } catch {
      setNotice("请手动复制房间码。");
    }
  }


  if (tutorialOpen && room?.status !== "playing") {
    return (
      <main data-gc-table className="app-shell fa-game tut-on">
        <TutorialMode name={name} brand={<Brand />} themeToggle={themeToggle} theme={theme} waitingRoom={room?.code} onExit={closeTutorial} />
        {confirmDialog}
      </main>
    );
  }

  if (room?.status === "playing" && room.game) {
    const players = room.game.players;
    const watched = players.some((player) => player.id === watchId) ? watchId : players[0]!.id;
    return (
      <main data-gc-table className="app-shell fa-game">
        <GameBoard
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          themeToggle={themeToggle}
          theme={theme}
          chat={<RoomChat room={room} voice={voice} />}
          onCommand={submitGameCommand}
          onRematch={voteRematch}
          onAuto={setAuto}
          onDissolve={dissolveRoom}
          watchId={watched}
          onWatch={setWatchId}
          onLeave={leaveRoom}
        />
        {confirmDialog}
      </main>
    );
  }

  if (room) {
    return (
      <>
        <RoomScreen
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          connected={connected}
          themeToggle={themeToggle}
          chat={<RoomChat room={room} voice={voice} />}
          onCopyCode={copyRoomCode}
          onLeave={leaveRoom}
          onStart={startGame}
          onKick={kickMember}
          onAddBot={addBot}
          onDissolve={dissolveRoom}
          onOptions={changeOptions}
          tutorialEntry={
            <TutorialInvite
              record={readTutorial(GAME_ID)}
              title="等人的时候，先学一下？"
              text="咕噜嘎带你在真牌桌上打一局，不会离开房间，房主一开局就自动回来。"
              again="再看一遍新手教程"
              onOpen={() => setTutorialOpen(true)}
            />
          }
        />
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <HomeScreen
        theme={theme}
        themeToggle={themeToggle}
        connected={connected}
        mode={mode}
        onMode={(next) => { setMode(next); setError(""); }}
        name={name}
        onName={setName}
        capacity={capacity}
        onCapacity={setCapacity}
        options={options}
        onOptions={(patch) => setOptions({ ...options, ...patch })}
        roomCode={roomCode}
        onRoomCode={(value) => setRoomCode(normalizeRoomCode(value))}
        canSubmit={canSubmit}
        busy={busy}
        error={error}
        notice={notice}
        onSubmit={handleSubmit}
        lobbyRooms={lobbyRooms}
        onJoinListed={joinListed}
        confirm={confirmAction}
        tutorialEntry={
          <TutorialInvite
            record={readTutorial(GAME_ID)}
            title="第一次玩？5 分钟学会"
            text="咕噜嘎在真牌桌上带你打一局，学完和人机练一局。"
            again="再看一遍新手教程"
            onOpen={() => setTutorialOpen(true)}
          />
        }
      />
      {confirmDialog}
    </>
  );
}

export function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="遥远之地首页">
      <img className="fa-brand-icon" src={iconArt("clue")} alt="" width={24} height={24} />
      <span className="brand-name">遥远之地</span>
    </a>
  );
}

export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "已连接" : "连接中…"}
    </div>
  );
}

/** 卡面一览（首页、等候房间）：要求高的卡、给资源的卡、圣所。 */
export function CardKinds({ cw = 96 }: { cw?: number }) {
  return (
    <div className="fa-kinds" aria-label="卡面一览">
      <figure><RegionCardView id={45} cw={cw} /><figcaption>要 3 只灵兽，早打放左边</figcaption></figure>
      <figure><RegionCardView id={7} cw={cw} /><figcaption>只给资源，晚打放右边</figcaption></figure>
      <figure><SanctuaryCardView id={22} sw={Math.round(cw * 0.625)} sh={cw} /><figcaption>圣所：一直算</figcaption></figure>
    </div>
  );
}

/* ---------- 首页 ---------- */

export function HomeScreen(props: {
  theme: Theme;
  themeToggle: ReactNode;
  connected: boolean;
  mode: EntryMode;
  onMode: (mode: EntryMode) => void;
  name: string;
  onName: (name: string) => void;
  capacity: Capacity;
  onCapacity: (capacity: Capacity) => void;
  options: GameOptions;
  onOptions: (patch: Partial<GameOptions>) => void;
  roomCode: string;
  onRoomCode: (code: string) => void;
  canSubmit: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  lobbyRooms: PublicRoomSummary[];
  onJoinListed: (roomId: string, spectate: boolean) => void;
  confirm: Confirm;
  /** 新手教程入口（邀请卡或「再看一遍」小按钮）。 */
  tutorialEntry?: ReactNode;
}) {
  const { mode, busy } = props;
  return (
    <main className="app-shell fa-page fa-home-page">
      <header className="topbar fa-pagebar">
        <Brand />
        <div className="topbar-right">
          <a className="center-link" href={CENTER_URL}>← 游戏中心</a>
          <GameRules />
          {props.themeToggle}
          <ConnectionStatus connected={props.connected} />
        </div>
      </header>

      <div className="fa-home">
        <section className="fa-home-hero">
          <div className="fa-hero-art" role="img" aria-label="晴空奇境：蘑菇林、溪谷和岩城">
            <h1>遥远之地</h1>
          </div>
          <p className="fa-lead">
            8 轮里大家<b>同时</b>从 3 张手牌打出 1 张，排成自己的探险路线。编号小的先挑公共牌，比上一张大就能发现<b>圣所</b>。
            终局<b>从最右边往左</b>翻开计分，每张卡只看得到自己和右边的卡：要求高的卡早打，给资源的卡晚打。
          </p>
          <div className="fa-home-facts">
            <span>2–6 人</span><span>一局约 20 分钟</span><span>人不够可以加人机</span>
          </div>
          <CardKinds />
          {props.tutorialEntry}
        </section>

        <section className="entry-card fa-entry" aria-labelledby="entry-title">
          <div className="entry-card-heading">
            <h2 id="entry-title">进入牌桌</h2>
          </div>

          <div className="mode-switch" role="tablist" aria-label="选择房间操作">
            <button className={mode === "create" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "create"} onClick={() => props.onMode("create")}>
              创建房间
            </button>
            <button className={mode === "join" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "join"} onClick={() => props.onMode("join")}>
              加入房间
            </button>
          </div>

          <form className="entry-form" onSubmit={props.onSubmit}>
            <label className="field-label" htmlFor="player-name">你的昵称</label>
            <input
              id="player-name"
              className="text-input"
              value={props.name}
              onChange={(event) => props.onName(event.target.value)}
              placeholder="输入 2–18 个字符"
              minLength={2}
              maxLength={18}
              autoComplete="nickname"
              required
            />

            {mode === "create" ? (
              <>
                <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数</label>
                <div className="fa-capacity" id="room-capacity" role="group" aria-label="选择房间人数">
                  {CAPACITY_OPTIONS.map((seats) => (
                    <button
                      key={seats}
                      type="button"
                      className={props.capacity === seats ? "capacity-option selected" : "capacity-option"}
                      aria-pressed={props.capacity === seats}
                      onClick={() => props.onCapacity(seats)}
                    >
                      <strong>{seats}</strong>
                    </button>
                  ))}
                </div>
                <label className="field-label field-label-spaced">开房选项 <small className="fa-muted">都可以不动</small></label>
                <OptionsEditor options={props.options} editable onChange={props.onOptions} />
              </>
            ) : (
              <>
                <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                <input
                  id="room-code"
                  className="text-input room-code-input"
                  value={props.roomCode}
                  onChange={(event) => props.onRoomCode(event.target.value)}
                  placeholder="例如：7KQ2TX"
                  autoComplete="off"
                  maxLength={6}
                  required
                />
                <p className="field-hint">6 位字母或数字。掉线了用原昵称和房间码进来，会回到自己的座位。</p>
              </>
            )}

            {props.error && <p className="feedback feedback-error" role="alert">{props.error}</p>}
            {props.notice && <p className="feedback feedback-success" role="status">{props.notice}</p>}

            <button className="primary-button fa-entry-submit" type="submit" disabled={!props.canSubmit}>
              {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建房间" : "加入牌桌"}
            </button>
          </form>
        </section>

        <div className="fa-home-rooms">
          <OnlineRooms rooms={props.lobbyRooms} connected={props.connected} busy={busy} onJoin={props.onJoinListed} confirm={props.confirm} />
        </div>
      </div>
    </main>
  );
}

/* ---------- 等候房间 ---------- */

export function RoomScreen({ room, busy, error, notice, connected, themeToggle, chat, onCopyCode, onLeave, onStart, onKick, onAddBot, onDissolve, onOptions, tutorialEntry }: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  connected: boolean;
  themeToggle: ReactNode;
  chat: ReactNode;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
  onKick: (memberId: string) => void;
  onAddBot: () => void;
  onDissolve: () => void;
  onOptions: (patch: Partial<GameOptions>) => void;
  /** 新手教程入口（观战的人不显示）。 */
  tutorialEntry?: ReactNode;
}) {
  const { isHost, spectating } = roomRole(room);
  const openSeats = Math.max(0, room.capacity - room.members.length);
  const two = room.capacity > 5;

  return (
    <main className="app-shell fa-page fa-room-page">
      <header className="topbar fa-pagebar">
        <Brand />
        <div className="topbar-right">
          <GameRules />
          {themeToggle}
          <ConnectionStatus connected={connected} />
        </div>
      </header>

      <div className="fa-room">
        <section className="fa-room-info">
          <div className="room-panel fa-code-panel">
            <div className="panel-label">{spectating ? "你在观战" : room.status === "waiting" ? "牌桌准备中" : "马上开始"}</div>
            {room.code ? (
              <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码" data-tutorial="room-code">
                {room.code}<span aria-hidden="true">⧉</span>
              </button>
            ) : (
              <div className="room-code-caption">从首页列表进来观战，看不到房间码</div>
            )}
            <div className="room-code-caption">{room.code ? "点一下复制，发给朋友" : ""}</div>
            <div className="fa-room-buttons">
              {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve} disabled={busy}>解散房间</button>}
              <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || (room.status === "playing" && !spectating)}>
                {spectating ? "离开观战" : "离开房间"}
              </button>
            </div>
          </div>
          <div className="room-panel fa-options-panel">
            <div className="panel-label">开房选项 <span>{isHost ? "开局前房主可以改" : "只有房主能改"}</span></div>
            <OptionsEditor options={room.options} editable={isHost} onChange={onOptions} />
            <RoomSettingsPanel room={room} />
          </div>
        </section>

        <section className="room-panel fa-room-players" data-tutorial="room-players">
          <div className="panel-topline">
            <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
            <span className="waiting-pill"><i /> 等待中</span>
          </div>
          <div className={two ? "fa-seat-grid two" : "fa-seat-grid"}>
            {room.members.map((member, index) => (
              <div className="fa-room-seat" key={member.id} style={{ "--seat": seatColor(index) } as CSSProperties}>
                <span className="fa-mini-avatar"><img src={avatarArt(index)} alt="" width={32} height={32} /></span>
                <div className="fa-room-seat-name">
                  <strong>{member.name}</strong>
                  <span>
                    {member.id === socket.id && <em className="fa-tag you">你</em>}
                    {member.isHost && <em className="fa-tag">房主</em>}
                    {member.bot && <em className="fa-tag bot">人机</em>}
                    {!member.connected && !member.bot && <em className="fa-tag warn">离线</em>}
                  </span>
                </div>
                {isHost && !member.isHost && (
                  <button className="kick-button" type="button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
                )}
              </div>
            ))}
            {Array.from({ length: openSeats }, (_, index) => (
              <div className="fa-room-seat open" key={`open-${index}`}>
                <span className="empty-avatar"><span>＋</span></span>
                <div className="fa-room-seat-name"><strong>空座位</strong><span>{room.access.open ? "公开房间" : "等朋友加入"}</span></div>
                {isHost && <button className="quiet-button add-bot-button" type="button" onClick={onAddBot} disabled={busy} data-tutorial="add-bot">加人机</button>}
              </div>
            ))}
          </div>
          <SeatSwitch room={room} />
          <div className="fa-start">
            {isHost ? (
              <button className="primary-button fa-start-button" type="button" onClick={onStart} disabled={busy || room.members.length < 2} data-tutorial="start">
                {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}
              </button>
            ) : (
              <div className="host-wait-note"><span className="pulse-dot" /> {spectating ? "等房主开始，开始后在这里观战" : "等房主开始对局"}</div>
            )}
            <p className="field-hint">
              {isHost && room.members.length < 2 ? `还差 ${2 - room.members.length} 位玩家，可以点空座位上的「加人机」。` : "出牌 60 秒、挑牌 30 秒；超时人机替你做，连续 2 次转托管。"}
            </p>
          </div>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {notice && !error && <p className="feedback feedback-success" role="status">{notice}</p>}
        </section>

        <section className="fa-room-side">
          {!spectating && tutorialEntry}
          <div className="room-panel fa-room-kinds">
            <div className="panel-label">卡面一览 <span>左吃右给</span></div>
            <CardKinds cw={72} />
          </div>
          <div className="fa-room-chat">{chat}</div>
        </section>
      </div>
    </main>
  );
}

/** 开房选项：辅助显示（开工拍板：默认开，开房时可以关）。 */
export function OptionsEditor({ options, editable, onChange }: {
  options: GameOptions;
  editable: boolean;
  onChange: (patch: Partial<GameOptions>) => void;
}) {
  return (
    <div className="fa-options" data-tutorial="room-options">
      <div className="fa-option">
        <span className="fa-option-name">辅助显示</span>
        <button type="button" className={options.assist ? "room-setting on" : "room-setting"} aria-pressed={options.assist} disabled={!editable} onClick={() => onChange({ assist: !options.assist })}
          title="手牌下标能不能拿圣所、能抽几张；出牌区每张卡下标按现在算几分">
          <i aria-hidden="true" />{options.assist ? "开：标出能不能拿圣所、每张卡现在几分" : "关：自己心算"}
        </button>
      </div>
    </div>
  );
}

export default App;
