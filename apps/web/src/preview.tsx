/**
 * 预览页（提交进仓库，界面维护；教程、自测可以往里加场景，不要删别人的场景，也不要整个删掉）。
 * 不连服务器：用规则包的预览局面工厂造局面，渲染真正的 GameBoard / 首页 / 等候房间。在牌桌上点的动作直接在浏览器里跑引擎。
 * 生产构建只打包 index.html，不会带上它。打开：http://localhost:5299/preview.html?s=<场景>
 *
 * 参数（都可以不写）：
 *   ?s=<场景>     牌桌场景用规则包 SCENE_NAMES（start、play、submitted、pick、pick-keep、keep-wait、watch-pick、round8、round8-keep、
 *                 short-deck、timeout、ended、ended-tie、full），另外有：
 *                 picked（出牌时选中一张还没确认）、picked-take（挑公共牌时选中一张）、max（6 人第 8 轮、我有 7 张出牌 + 7 张圣所，最挤的样子）、
 *                 max-ended（6 人终局，出牌区铺满）、home、home-rooms、waiting-1 / waiting-full / waiting-bots / waiting-guest / waiting-spec
 *   &n=<人数>      2–6
 *   &v=<座位>      从哪个座位看，默认 p1
 *   &bots=p2,p3   人机座位    &auto=p1  托管中    &offline=p3  离线
 *   &spec=1       观战（&all=1 观战能看手牌）
 *   &t=<毫秒>      倒计时剩余；t=none 不显示
 *   &chat=1       带几条聊天（&chatopen=1 打开聊天抽屉）
 *   &step=<0-10>  终局翻牌停在第几步（默认翻完；不给且 &anim=1 时从头放动画）
 *   &live=1       别人由人机自动走，可以一直玩下去
 *   &seed=<数>     发牌种子
 *   &hint=1       显示「提示」按钮      &assist=0  关掉辅助显示
 *   &err=<文字>    模拟服务器拒绝了动作（看非法操作提示）
 *   &rules=1      打开规则弹窗    &detail=<编号>  打开一张区域卡的详情
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactDOM from "react-dom/client";
import {
  applyCommand,
  botCommand,
  buildGame,
  createScene,
  createSceneRoom,
  DEFAULT_OPTIONS,
  DEFAULT_ROOM_ACCESS,
  redactGameForViewer,
  SCENE_NAMES,
  waitingFor,
  type Capacity,
  type GameCommand,
  type GameOptions,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomChatMessage,
  type SceneName,
} from "@faraway/game";
import { Brand, ConnectionStatus, HomeScreen, RoomScreen } from "./App.js";
import { installArtVars } from "./art.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import { SoundToggle } from "./gm-sound.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./fa-pages.css";
import "./faraway.css";
import "./theme-day.css";

applyTheme(readTheme());
installArtVars();

const params = new URLSearchParams(location.search);
const sceneName = params.get("s") ?? "start";
const players = Math.min(6, Math.max(2, Number(params.get("n") ?? (sceneName.startsWith("max") ? 6 : 4))));
const viewer = params.get("v") ?? (sceneName === "waiting-guest" ? "p2" : "p1");
const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
const spectator = params.get("spec") === "1";
const seeAll = params.get("all") === "1";
const seed = Number(params.get("seed") ?? 11);
const live = params.get("live") === "1";
const timeParam = params.get("t");
const turnRemainingMs = timeParam === "none" ? undefined : timeParam ? Number(timeParam) : undefined;
const stepParam = params.get("step");
const finalStep = stepParam !== null ? Number(stepParam) : params.get("anim") === "1" ? undefined : 10;
const options: Partial<GameOptions> = params.get("assist") === "0" ? { assist: false } : {};

Object.defineProperty(socket, "id", { get: () => (spectator ? "sock-watcher" : `sock-${viewer}`), configurable: true });
// 预览页不连服务器：发出去的房间操作直接回一个失败，界面上看得到提示。
socket.emit = ((event: string, ...args: unknown[]) => {
  const ack = args[args.length - 1];
  if (typeof ack === "function") (ack as (response: unknown) => void)({ ok: false, error: `预览页不连服务器（${event}）` });
  return socket;
}) as typeof socket.emit;
socket.connect = (() => socket) as typeof socket.connect;

const CHAT: RoomChatMessage[] = [
  { id: "c1", senderId: "sock-p2", name: "阿远", message: "我这把要凑灵兽", createdAt: "2026-10-11T20:01:00.000Z" },
  { id: "c2", senderId: "sock-p1", name: "我", message: "68 留到最左边才有用", createdAt: "2026-10-11T20:01:30.000Z" },
  { id: "c3", senderId: "sock-watcher", name: "看客", message: "圣所堆快没了", createdAt: "2026-10-11T20:02:00.000Z", spectator: true },
];

/* ---------- 额外场景（规则包的命名场景之外） ---------- */

/** 6 人第 8 轮出牌：我出牌区 7 张、7 张圣所（手牌行最挤），别人也都有好几张圣所。 */
function maxScene(phase: "play" | "ended"): GameState {
  const rows = [
    { played: [45, 8, 16, 23, 1, 18, 28], sanctuaries: [11, 3, 22, 40, 44, 33, 16], hand: [35, 62, 9] },
    { played: [30, 12, 66, 33, 52, 47, 57], sanctuaries: [24, 29] },
    { played: [5, 14, 20, 37, 40, 61, 64], sanctuaries: [42, 43, 34] },
    { played: [50, 4, 53, 7, 19, 26, 60], sanctuaries: [18, 13, 1] },
    { played: [68, 2, 6, 17, 51, 13, 25], sanctuaries: [12, 15, 19, 20, 26] },
    { played: [21, 10, 24, 41, 32, 31, 11], sanctuaries: [35] },
  ].slice(0, players);
  if (phase === "ended") {
    const tails = [35, 58, 67, 63, 65, 59];
    return buildGame({ players: rows.map((row, i) => ({ played: [...row.played, tails[i]!], sanctuaries: row.sanctuaries })), phase: "ended", options, seed });
  }
  return buildGame({ players: rows, round: 8, options, seed });
}

function buildScene(): GameState {
  if (sceneName === "max") return maxScene("play");
  if (sceneName === "max-ended") return maxScene("ended");
  if (sceneName === "picked") return createScene("play", { players, seed, options });
  if (sceneName === "picked-take") return createScene("pick", { players, seed, options });
  if ((SCENE_NAMES as readonly string[]).includes(sceneName)) return createScene(sceneName as SceneName, { players, seed, options });
  return createScene("start", { players, seed, options });
}

/* ---------- 牌桌 ---------- */

function BoardPreview() {
  const [theme, toggleTheme] = useTheme();
  const [full, setFull] = useState<GameState>(buildScene);
  const [error, setError] = useState(params.get("err") ?? "");
  const [autoIds, setAutoIds] = useState(list("auto"));
  const [confirm, confirmDialog] = useConfirm();
  const room = useMemo(() => {
    const base = createSceneRoom(full, {
      viewer,
      spectator,
      seeAll,
      offline: list("offline"),
      bots: list("bots"),
      auto: autoIds,
      ...(turnRemainingMs !== undefined ? { turnRemainingMs } : {}),
    });
    const withChat = params.get("chat") === "1" ? { ...base, chat: CHAT } : base;
    return timeParam === "none" ? (({ turnRemainingMs: _drop, ...rest }) => rest)(withChat) as LobbyRoomSnapshot : withChat;
  }, [full, autoIds]);
  const voice = useVoice(room);
  const [watchId, setWatchId] = useState(full.players[0]!.id);

  function command(cmd: GameCommand, as = viewer) {
    try {
      const { step: _step, ...clean } = cmd as GameCommand & { step?: string };
      setFull((state) => applyCommand(state, as, clean as GameCommand));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  // 进来就点一下（选中一张、打开规则、打开详情、打开聊天）
  useEffect(() => {
    const me = full.players.find((player) => player.id === viewer)!;
    const selector = sceneName === "picked" ? `[data-card="${me.hand.at(-1)}"]`
      : sceneName === "picked-take" ? `.fa-market [data-card="${full.market[1] ?? full.market[0]}"]`
      : params.get("rules") === "1" ? ".fa-rules-button"
      : params.get("detail") ? `.fa-row [data-card="${params.get("detail")}"]`
      : params.get("chatopen") === "1" ? ".fa-chat-toggle" : null;
    if (!selector) return;
    const timer = window.setTimeout(() => (document.querySelector(selector) as HTMLElement | null)?.click(), 150);
    return () => window.clearTimeout(timer);
  }, []);

  // 别人（live=1）：人机按自己能看到的信息走
  const fullRef = useRef(full);
  fullRef.current = full;
  useEffect(() => {
    if (!live || full.phase === "ended") return;
    const actor = waitingFor(full).find((id) => id !== viewer || autoIds.includes(viewer));
    if (!actor) return;
    const timer = window.setTimeout(() => {
      const cmd = botCommand(redactGameForViewer(fullRef.current, actor), actor);
      if (cmd) command(cmd, actor);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [full, autoIds]);

  return (
    <main data-gc-table className="app-shell fa-game">
      <GameBoard
        room={room}
        busy={false}
        error={error}
        notice=""
        brand={<Brand />}
        connection={<ConnectionStatus connected />}
        themeToggle={<><ThemeToggle theme={theme} onToggle={toggleTheme} /><SoundToggle /></>}
        theme={theme}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={(cmd) => command(cmd)}
        onRematch={() => setFull(buildScene())}
        onAuto={(enabled) => setAutoIds((ids) => (enabled ? [...ids, viewer] : ids.filter((id) => id !== viewer)))}
        onDissolve={() => void confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" })}
        watchId={watchId}
        onWatch={setWatchId}
        onLeave={() => setError("预览页：离开观战只在真房间里有效")}
        showHint={params.get("hint") === "1"}
        {...(finalStep !== undefined ? { finalStep } : {})}
      />
      {confirmDialog}
    </main>
  );
}

/* ---------- 首页 ---------- */

const LOBBY: PublicRoomSummary[] = [
  {
    id: "r1", status: "playing", capacity: 5, options: DEFAULT_OPTIONS, open: false, allowSpectators: true, spectators: 1,
    players: [
      { name: "阿远", isHost: true, connected: true, score: 23, isActive: true },
      { name: "小溪", isHost: false, connected: true, score: 41 },
      { name: "咕噜一号", isHost: false, connected: true, bot: true, score: 12 },
      { name: "石头", isHost: false, connected: false, score: 30 },
      { name: "岩岩", isHost: false, connected: true, score: 8 },
    ],
  },
  {
    id: "r2", status: "waiting", capacity: 6, options: { assist: false }, open: true, allowSpectators: true, spectators: 0,
    players: [{ name: "菌菌", isHost: true, connected: true }, { name: "行者", isHost: false, connected: true }],
  },
  {
    id: "r3", status: "finished", capacity: 3, options: DEFAULT_OPTIONS, open: false, allowSpectators: true, spectators: 0,
    players: [{ name: "阿远", isHost: true, connected: true, score: 81, isWinner: true }, { name: "小溪", isHost: false, connected: true, score: 70 }, { name: "咕噜二号", isHost: false, connected: true, bot: true, score: 65 }],
  },
];

function HomePreview() {
  const [theme, toggleTheme] = useTheme();
  const [name, setName] = useState("小明");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [opts, setOpts] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [code, setCode] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <HomeScreen
        theme={theme}
        themeToggle={<><ThemeToggle theme={theme} onToggle={toggleTheme} /><SoundToggle /></>}
        connected
        mode={mode}
        onMode={setMode}
        name={name}
        onName={setName}
        capacity={capacity}
        onCapacity={setCapacity}
        options={opts}
        onOptions={(patch) => setOpts({ ...opts, ...patch })}
        roomCode={code}
        onRoomCode={(value) => setCode(value.toUpperCase().slice(0, 6))}
        canSubmit={name.trim().length >= 2}
        busy={false}
        error=""
        notice=""
        onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
        lobbyRooms={sceneName === "home-rooms" ? LOBBY : []}
        onJoinListed={() => undefined}
        confirm={confirm}
      />
      {confirmDialog}
    </>
  );
}

/* ---------- 等候房间 ---------- */

const NAMES = ["我", "阿远", "小溪", "石头", "岩岩", "菌菌"];

function waitingRoom(): LobbyRoomSnapshot {
  const kind = sceneName.slice("waiting-".length);
  const capacity = (kind === "full" ? 6 : kind === "1" ? 4 : kind === "bots" ? 5 : players) as Capacity;
  const seats = kind === "1" ? 1 : kind === "full" ? 6 : kind === "bots" ? 4 : kind === "spec" ? 3 : 2;
  let botNo = 0;
  const members: LobbyMember[] = Array.from({ length: seats }, (_, index) => {
    const bot = (kind === "bots" && index > 0) || (kind === "full" && index >= 4);
    return {
      id: `sock-p${index + 1}`,
      playerId: `p${index + 1}`,
      name: bot ? `咕噜${["一", "二", "三", "四", "五"][botNo++]}号` : NAMES[index]!,
      isHost: index === 0,
      connected: !(kind === "full" && index === 2),
      ...(bot ? { bot: true } : {}),
    };
  });
  return {
    code: kind === "spec" ? "" : "FAR299",
    spectators: kind === "full" || kind === "spec" ? [{ id: "sock-watcher", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, ...(kind === "full" ? { open: true } : {}) },
    options: kind === "full" ? { assist: false } : DEFAULT_OPTIONS,
    capacity,
    status: "waiting",
    members,
    chat: params.get("chat") === "1" ? CHAT : [],
    voice: [],
  };
}

function RoomPreview() {
  const [theme, toggleTheme] = useTheme();
  const [room, setRoom] = useState(waitingRoom);
  const voice = useVoice(room);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <RoomScreen
        room={room}
        busy={false}
        error=""
        notice=""
        connected
        themeToggle={<><ThemeToggle theme={theme} onToggle={toggleTheme} /><SoundToggle /></>}
        chat={<RoomChat room={room} voice={voice} />}
        onCopyCode={() => undefined}
        onLeave={() => undefined}
        onStart={() => undefined}
        onKick={() => undefined}
        onAddBot={() => undefined}
        onDissolve={() => void confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" })}
        onOptions={(patch) => setRoom((current) => ({ ...current, options: { ...current.options, ...patch } }))}
      />
      {confirmDialog}
    </>
  );
}

function Preview() {
  if (sceneName.startsWith("home")) return <HomePreview />;
  if (sceneName.startsWith("waiting")) {
    if (sceneName === "waiting-spec") Object.defineProperty(socket, "id", { get: () => "sock-watcher", configurable: true });
    return <RoomPreview />;
  }
  return <BoardPreview />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
