// 抓包：连上真实的服务器，检查服务器发给每个人的数据里有没有不该看到的东西。
//   node scripts/spy.mjs [人数=4]            （先 npm run dev；或者 SERVER_URL=http://localhost:<端口> 指向别的服务）
// 房主 A、间谍 B 和其余座位都是这个脚本里的 socket，按简单基线打完整一局；另有一个观战的人。
// 每收到一条 room:updated 就检查：
//   1. 任何深度都没有 regionDeck / sanctuaryDeck / seed / rngState / log 字段（牌堆顺序、种子、随机数状态、动作序列）；
//   2. 别人的 hand、offer 是空数组、pendingPlay 是 null（只知道张数和「已出」）；
//   3. 拿 A 在同一版本里自己的暗牌（手牌、已出未翻开的牌、抽到待选的圣所）对照：这些牌一张都不出现在 B 能看到的任何地方
//      （公共牌、移出的牌、出牌区、留下的圣所、翻牌记录、事件）。A 从公共牌里挑走的牌大家都看见了，不算暗牌；
//   4. 观战的人谁的暗牌都看不到。
// 有泄露就打印并以退出码 1 结束。
import { io } from "socket.io-client";
import { baselineCommand, redactGameForViewer, stepKey, waitingFor } from "../packages/game/dist/index.js";

const COUNT = Number(process.argv[2] ?? 4);
const URL = process.env.SERVER_URL ?? "http://localhost:3028";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const BANNED = new Set(["regionDeck", "sanctuaryDeck", "seed", "rngState", "log"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(name) {
  const socket = io(URL, { path: PATH, transports: ["websocket"], reconnection: false });
  const client = { name, socket, latest: null, updates: [] };
  client.emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  socket.on("room:updated", (room) => {
    client.latest = room;
    client.updates.push({ selfId: socket.id, room });
  });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(client));
    socket.once("connect_error", (error) => reject(new Error(`连不上 ${URL}：${error.message}`)));
  });
}

function bannedKeys(value, path = "", found = []) {
  if (Array.isArray(value)) value.forEach((item, index) => bannedKeys(item, `${path}[${index}]`, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (BANNED.has(key)) found.push(`${path}.${key}`);
      bannedKeys(child, `${path}.${key}`, found);
    }
  }
  return found;
}

/** 这份状态里所有看得到的区域卡和圣所卡（两种编号分开记）。 */
function visibleCards(game) {
  const regions = new Set();
  const sanctuaries = new Set();
  const addR = (list) => list?.forEach((card) => regions.add(card));
  addR(game.market);
  addR(game.removed);
  for (const player of game.players) {
    addR(player.played);
    player.sanctuaries.forEach((card) => sanctuaries.add(card));
  }
  game.lastReveal?.plays.forEach((play) => regions.add(play.card));
  for (const event of game.events) {
    if (typeof event.card === "number") regions.add(event.card);
    if (typeof event.sanctuary === "number") sanctuaries.add(event.sanctuary);
    addR(event.market);
    event.plays?.forEach((play) => regions.add(play.card));
  }
  return { regions, sanctuaries };
}

const leaks = [];
const leak = (text) => {
  if (leaks.length < 30) console.log("泄露：", text);
  leaks.push(text);
};

const host = await connect("房主A");
const spy = await connect("间谍B");
const others = [];
for (let index = 2; index < COUNT; index += 1) others.push(await connect(`玩家${index + 1}`));
const viewer = await connect("观战");
const players = [host, spy, ...others];

const created = await host.emit("room:create", { name: host.name, capacity: COUNT });
if (!created.ok) throw new Error(created.error);
const code = created.data.code;
for (const client of [spy, ...others]) {
  const joined = await client.emit("room:join", { name: client.name, code });
  if (!joined.ok) throw new Error(joined.error);
}
const watching = await viewer.emit("room:join", { name: viewer.name, code, spectate: true });
if (!watching.ok) throw new Error(watching.error);
const started = await host.emit("room:start");
if (!started.ok) throw new Error(started.error);
console.log(`房间 ${code}，${COUNT} 人开局；间谍是 B，另有一个观战的人`);

// 所有座位按基线打：每次醒来看一眼最新状态，要自己做决定就做（A 的出牌稍微晚一点，让间谍有机会看到「A 已出」之前和之后）
const deadline = Date.now() + 5 * 60_000;
while (Date.now() < deadline) {
  await sleep(25);
  const game = host.latest?.game;
  if (!game) continue;
  if (game.phase === "ended") break;
  for (const client of players) {
    const room = client.latest;
    const view = room?.game;
    if (!view || view.phase === "ended") continue;
    const seat = room.members.find((member) => member.id === client.socket.id)?.playerId;
    if (!seat || !waitingFor(view).includes(seat)) continue;
    const command = baselineCommand(redactGameForViewer(view, seat), seat);
    if (command) await client.emit("game:command", { ...command, step: stepKey(view) });
  }
}
await sleep(300);

// ---- 检查 ----
const hostSeat = host.latest.members.find((member) => member.id === host.socket.id).playerId;
/** A 在每个版本里自己的暗牌。 */
const hostSecrets = new Map();
for (const { room } of host.updates) {
  if (!room.game) continue;
  const me = room.game.players.find((player) => player.id === hostSeat);
  hostSecrets.set(room.game.version, { regions: [...me.hand, ...(me.pendingPlay !== null ? [me.pendingPlay] : [])], sanctuaries: [...me.offer] });
}

let checked = 0;
let compared = 0;
let offersSeen = 0;
for (const client of [spy, ...others, viewer]) {
  /** 这个人亲眼看到 A 从公共牌挑走的牌（公开信息）。 */
  const publicTaken = new Set();
  for (const { selfId, room } of client.updates) {
    const banned = bannedKeys(room);
    if (banned.length) leak(`${client.name} 收到了 ${banned.join("、")}`);
    const game = room.game;
    if (!game) continue;
    checked += 1;
    const seat = room.members.find((member) => member.id === selfId)?.playerId;
    const godView = !seat && room.access.spectatorsSeeAll;
    for (const player of game.players) {
      if (player.offerCount > 0) offersSeen += 1;
      if (player.id === seat || godView) continue;
      if (player.hand.length > 0) leak(`${client.name} 看到了 ${player.name} 的手牌（v${game.version}）`);
      if (player.pendingPlay !== null) leak(`${client.name} 看到了 ${player.name} 已出的牌（v${game.version}）`);
      if (player.offer.length > 0) leak(`${client.name} 看到了 ${player.name} 抽到的圣所（v${game.version}）`);
    }
    for (const event of game.events) {
      if (event.type === "Submitted" && Object.keys(event).length !== 2) leak(`${client.name} 的出牌事件带了多余字段`);
      if (event.type === "SanctuariesDrawn" && Object.keys(event).length !== 4) leak(`${client.name} 的抽圣所事件带了多余字段`);
    }
    for (const event of game.events) if (event.type === "MarketTaken" && event.player === hostSeat) publicTaken.add(event.card);
    const secret = hostSecrets.get(game.version);
    if (secret && !godView) {
      compared += 1;
      const visible = visibleCards(game);
      for (const card of secret.regions) if (!publicTaken.has(card) && visible.regions.has(card)) leak(`${client.name} 在 v${game.version} 看到了 A 手里的 ${card}`);
      for (const card of secret.sanctuaries) if (visible.sanctuaries.has(card)) leak(`${client.name} 在 v${game.version} 看到了 A 抽到的圣所 S${card}`);
    }
  }
}
const final = host.latest.game;
console.log(`检查了 ${checked} 条房间更新（其中 ${compared} 条和 A 同版本的暗牌逐张对照；有人抽圣所待选的 ${offersSeen} 人次），第 ${final.round} 轮，结束：${final.phase}`);
for (const client of [...players, viewer]) client.socket.disconnect();
if (final.phase !== "ended") leak("5 分钟内没打完");
console.log(leaks.length === 0 ? "没有发现泄露" : `发现 ${leaks.length} 处泄露`);
process.exit(leaks.length === 0 ? 0 : 1);
