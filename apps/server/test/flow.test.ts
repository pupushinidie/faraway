/**
 * 服务器全流程：建房（开房选项）→ 改选项 → 加入 → 开局 → 同时出牌（别人只看到「已出」）→ 翻牌 → 按编号挑公共牌、同时留圣所
 * → 第 8 轮 → 终局 → 再来一局；计时 key（别人出牌 / 留圣所不重置倒计时）、超时代打和转托管、原昵称重连、迟到的点击、
 * 管理员解散、首页列表、每个连接收到的数据里没有别人的暗牌。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGame, stepKey, type GameState, type LobbyRoomSnapshot, type PublicRoomSummary } from "@faraway/game";
import { call, command, delay, join, ok, seatOf, startServer, updateWhere, type Harness, type TestSocket } from "./harness.js";

// 管理员口令、人机立刻行动要在服务器 import 之前设好。不设 TURN_MS：用真实限时，超时用 testHooks 触发。
process.env.ADMIN_TOKEN = "flow-test-token";
process.env.BOT_DELAY_SCALE = "0";
delete process.env.TURN_MS;

let h: Harness;
let nameSeq = 0;
const nick = (prefix: string) => `${prefix}${++nameSeq}`;

beforeAll(async () => {
  h = await startServer();
});
afterAll(async () => {
  await h.close();
});

async function threeSeats(options: Record<string, unknown> = {}): Promise<{ code: string; host: TestSocket; a: TestSocket; b: TestSocket; names: string[] }> {
  const host = await h.connect();
  const names = [nick("房主"), nick("阿远"), nick("小溪")];
  const created = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: names[0]!, capacity: 3, options } as never, ack)));
  const a = await h.connect();
  const b = await h.connect();
  await ok(join(a, { name: names[1]!, code: created.code }));
  await ok(join(b, { name: names[2]!, code: created.code }));
  return { code: created.code, host, a, b, names };
}

async function started(): Promise<Awaited<ReturnType<typeof threeSeats>>> {
  const room = await threeSeats();
  await ok(call<LobbyRoomSnapshot>((ack) => room.host.emit("room:start", ack)));
  for (const client of [room.host, room.a, room.b]) await updateWhere(h, client, (snapshot) => snapshot.game !== undefined);
  return room;
}

const gameOf = (client: TestSocket): GameState => h.latest.get(client)!.game!;
const meIn = (client: TestSocket) => gameOf(client).players.find((player) => player.id === seatOf(h, client))!;
const dissolve = (host: TestSocket) => ok(call<void>((ack) => host.emit("room:dissolve", ack)));

/** 把房间换成精确局面（玩家 id 用座位 p1–p3、名字用房间里的）。 */
function inject(code: string, names: string[], spec: Omit<Parameters<typeof buildGame>[0], "players"> & { players: Record<string, unknown>[] }): GameState {
  const game = buildGame({ ...spec, players: spec.players.map((player, index) => ({ ...player, id: `p${index + 1}`, name: names[index]! })) } as Parameters<typeof buildGame>[0]);
  h.server.testHooks.setGame(code, game);
  return game;
}

describe("服务器全流程", () => {
  it("昵称（I10）：零宽 / 方向控制字符去掉后同名就拒绝；「咕噜X号」留给人机", async () => {
    const room = await threeSeats();
    const late = await h.connect();
    // 满座了，换一个 4 人房测同名
    const host = await h.connect();
    const hostName = nick("张三");
    const created = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: hostName, capacity: 4 } as never, ack)));
    const twin = await join(late, { name: `${hostName}\u200b`, code: created.code });
    expect(twin.ok).toBe(false);
    const rlo = await join(late, { name: `\u202e${hostName}`, code: created.code });
    expect(rlo.ok).toBe(false);
    const fake = await join(late, { name: "咕噜一号", code: created.code });
    expect(fake.ok).toBe(false);
    expect((await join(late, { name: nick("李四"), code: created.code })).ok).toBe(true);
    expect(room.code).toBeTruthy();
  });

  it("猜房间码限速（I9）：同一条连接 10 秒内第 11 次加入起被拒", async () => {
    const guesser = await h.connect();
    const replies: string[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const reply = await join(guesser, { name: nick("路人"), code: "ZZZZZ2" });
      replies.push(reply.ok ? "ok" : reply.error);
    }
    expect(replies.slice(0, 10).every((reply) => reply.includes("找不到"))).toBe(true);
    expect(replies.slice(10).every((reply) => reply.includes("频繁"))).toBe(true);
  });

  it("发牌密钥（I7）：每场 256 位、两场不一样；发给每个人的数据里都没有密钥和随机数状态", async () => {
    const one = await threeSeats();
    const two = await threeSeats();
    for (const room of [one, two]) {
      await ok(call<LobbyRoomSnapshot>((ack) => room.host.emit("room:start", ack)));
      for (const client of [room.host, room.a, room.b]) await updateWhere(h, client, (snapshot) => snapshot.game !== undefined);
    }
    const first = h.server.testHooks.rngOf(one.code);
    const second = h.server.testHooks.rngOf(two.code);
    expect(first.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(String(first.rngState)).toMatch(/^c20:[0-9a-f]{64}:\d+$/);
    expect(second.seed).not.toBe(first.seed);
    for (const client of [one.host, one.a, one.b]) {
      const text = JSON.stringify(h.latest.get(client));
      expect(text).not.toContain(String(first.seed));
      expect(text).not.toContain("c20:");
    }
  });


  it("客户端漏发回执、参数个数不对，服务器不会崩", async () => {
    const rude = await h.connect();
    const raw = rude as unknown as { emit: (...args: unknown[]) => void };
    raw.emit("lobby:get");
    raw.emit("game:command", { type: "play", card: 1 });
    raw.emit("room:create", { name: "无礼的人", capacity: 2 });
    raw.emit("room:start", "多余", "参数");
    raw.emit("room:kick");
    raw.emit("voice:signal");
    await delay(200);
    const still = await h.connect();
    const rooms = await ok(call<import("@faraway/game").PublicRoomSummary[]>((ack) => still.emit("lobby:get", ack)));
    expect(Array.isArray(rooms)).toBe(true);
    expect(h.server.httpServer.listening).toBe(true);
  });

  it("建房带开房选项（辅助显示）；只有房主能在等候时改；不合法的拒绝；人数只能 2–6", async () => {
    const host = await h.connect();
    const bad = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 4, options: { assist: "关" } } as never, ack));
    expect(bad.ok).toBe(false);
    const tooMany = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 7 } as never, ack));
    expect(tooMany.ok).toBe(false);
    const room = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 2, options: { assist: false } } as never, ack)));
    expect(room.options).toEqual({ assist: false });
    const guest = await h.connect();
    await ok(join(guest, { name: nick("客人"), code: room.code }));
    expect((await call<void>((ack) => guest.emit("room:options", { assist: true }, ack))).ok).toBe(false);
    await ok(call<void>((ack) => host.emit("room:options", { assist: true }, ack)));
    expect((await updateWhere(h, guest, (snapshot) => snapshot.options.assist === true)).options).toEqual({ assist: true });
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const game = (await updateWhere(h, guest, (snapshot) => snapshot.game !== undefined)).game!;
    expect(game.config.assist).toBe(true);
    expect((await call<void>((ack) => host.emit("room:options", { assist: false }, ack))).ok).toBe(false);
    await dissolve(host);
  });

  it("开局 → 同时出牌（别人只看到已出）→ 翻牌发圣所 → 按编号挑牌、同时留圣所 → 第 8 轮 → 终局 → 再来一局", async () => {
    const { code, host, a, b, names } = await started();
    expect(gameOf(host)).toMatchObject({ phase: "play", round: 1 });
    expect(meIn(host).hand.length).toBe(3);
    expect(gameOf(host).players[1]!.hand).toEqual([]);
    expect(gameOf(host).market.length).toBe(4);
    // 出牌：别人只看到「已出」
    await ok(command(host, { type: "play", card: meIn(host).hand[0]! }, h));
    const seen = await updateWhere(h, a, (snapshot) => snapshot.game?.players[0]!.submitted === true);
    expect(seen.game!.players[0]!.pendingPlay).toBeNull();
    expect((await command(host, { type: "play", card: meIn(host).hand[0]! }, h)).ok).toBe(false);

    // 精确局面：第 2 轮，甲 [10] 打 40（发现，抽 1 张），乙 [5] 打 20（20 有线索 → 抽 2 张），丙 [30] 打 3（不发现）
    inject(code, names, {
      players: [{ played: [10], hand: [40, 1, 2] }, { played: [5], hand: [20, 4, 6] }, { played: [30], hand: [3, 7, 8] }],
      round: 2,
      market: [50, 51, 52, 53],
      sanctuaryDeck: [11, 12, 13, 14],
    });
    await updateWhere(h, host, (snapshot) => snapshot.game?.round === 2 && snapshot.game.players[0]!.played.length === 1);
    await ok(command(host, { type: "play", card: 40 }, h));
    await ok(command(a, { type: "play", card: 20 }, h));
    await ok(command(b, { type: "play", card: 3 }, h));
    const revealed = await updateWhere(h, a, (snapshot) => snapshot.game?.phase === "resolve");
    expect(revealed.game!.resolveOrder).toEqual(["p3", "p2", "p1"]);
    // 乙（20）先发：S11、S12；甲（40）后发：S13
    expect(revealed.game!.players[1]!.offer).toEqual([11, 12]);
    expect(revealed.game!.players[0]!.offer).toEqual([]);
    expect(revealed.game!.players[0]!.offerCount).toBe(1);
    // 没轮到不能挑；留圣所不用排队
    expect((await command(host, { type: "take", card: 50 }, h)).ok).toBe(false);
    await ok(command(host, { type: "keep", sanctuary: 13 }, h));
    await ok(command(b, { type: "take", card: 53 }, h));
    await ok(command(a, { type: "take", card: 50 }, h));
    await ok(command(host, { type: "take", card: 51 }, h));
    expect(gameOf(host).phase).toBe("resolve");
    await ok(command(a, { type: "keep", sanctuary: 12 }, h));
    const round3 = await updateWhere(h, host, (snapshot) => snapshot.game?.round === 3);
    expect(round3.game!.removed).toContain(52);
    expect(round3.game!.players[1]!.sanctuaries).toEqual([12]);
    expect(round3.game!.market.length).toBe(4);

    // 第 8 轮：不挑公共牌，甲发现圣所留一张后终局
    inject(code, names, {
      players: [
        { played: [1, 2, 3, 4, 6, 7, 33], hand: [40, 41, 42] },
        { played: [8, 9, 10, 11, 12, 13, 14], hand: [5, 15, 16] },
        { played: [17, 18, 19, 21, 22, 23, 24], hand: [25, 26, 27] },
      ],
      round: 8,
    });
    await updateWhere(h, host, (snapshot) => snapshot.game?.round === 8 && snapshot.game.phase === "play");
    expect(gameOf(host).market).toEqual([]);
    await ok(command(host, { type: "play", card: 40 }, h));
    await ok(command(a, { type: "play", card: 5 }, h));
    await ok(command(b, { type: "play", card: 25 }, h));
    const last = await updateWhere(h, host, (snapshot) => snapshot.game?.phase === "resolve" && snapshot.game.round === 8);
    expect((await command(a, { type: "take", card: 1 }, h)).ok).toBe(false);
    await ok(command(host, { type: "keep", sanctuary: last.game!.players[0]!.offer[0]! }, h));
    // 丙 24 → 25 也发现了圣所（只有他自己看得到抽到哪几张）
    await updateWhere(h, b, (snapshot) => snapshot.game?.phase === "resolve" && snapshot.game.round === 8);
    await ok(command(b, { type: "keep", sanctuary: gameOf(b).players[2]!.offer[0]! }, h));
    const over = await updateWhere(h, host, (snapshot) => snapshot.game?.phase === "ended");
    expect(over.game!.finalResult!.ranking.length).toBe(3);
    expect(over.rematch).toBeDefined();
    expect(over.turnRemainingMs).toBeUndefined();
    // 终局也不公开别人剩下的 2 张手牌
    expect(over.game!.players[1]!.hand).toEqual([]);
    const summary = await ok(call<PublicRoomSummary[]>((ack) => h.connect().then((spy) => spy.emit("lobby:get", ack))));
    const listed = summary.find((room) => room.players[0]?.name === names[0])!;
    expect(listed.status).toBe("finished");
    expect(listed.players.filter((player) => player.isWinner).length).toBe(1);
    expect(listed.players[0]!.score).toBe(over.game!.finalResult!.scores.p1!.total);
    for (const client of [host, a, b]) await ok(call<void>((ack) => client.emit("room:rematch", true, ack)));
    const again = await updateWhere(h, host, (snapshot) => !snapshot.rematch && snapshot.game?.phase === "play" && snapshot.game?.round === 1);
    expect(again.game!.players.every((player) => player.played.length === 0 && player.sanctuaries.length === 0)).toBe(true);
    await dissolve(host);
  }, 30_000);

  it("计时 key：别人出牌、留圣所都不重置倒计时；翻牌、轮到下一个人挑才重新计时", async () => {
    const { code, host, a, names } = await started();
    const first = h.server.testHooks.deadline(code)!;
    expect(first.key).toBe("1:play");
    expect(first.deadline - Date.now()).toBeGreaterThan(59_000);
    await delay(30);
    await ok(command(a, { type: "play", card: meIn(a).hand[0]! }, h));
    await ok(command(host, { type: "play", card: meIn(host).hand[0]! }, h));
    expect(h.server.testHooks.deadline(code)).toEqual(first);
    const snap = await updateWhere(h, a, (snapshot) => snapshot.game?.players[0]!.submitted === true);
    expect(snap.turnRemainingMs!).toBeLessThan(60_000);
    inject(code, names, {
      players: [{ played: [3, 30], offer: [1, 2] }, { played: [4, 10] }, { played: [5, 20], offer: [3] }],
      round: 2,
      phase: "resolve",
    });
    const resolve0 = h.server.testHooks.deadline(code)!;
    expect(resolve0.key).toBe("2:resolve:0");
    expect(resolve0.deadline - Date.now()).toBeGreaterThan(29_000);
    expect(resolve0.deadline - Date.now()).toBeLessThan(31_000);
    await delay(30);
    await ok(command(host, { type: "keep", sanctuary: 1 }, h));
    expect(h.server.testHooks.deadline(code)).toEqual(resolve0);
    await ok(command(a, { type: "take", card: gameOf(a).market[0]! }, h));
    expect(h.server.testHooks.deadline(code)!.key).toBe("2:resolve:1");
    await dissolve(host);
  });

  it("超时（testHooks 触发）：出牌、挑公共牌、留圣所都由系统代做；真人连续 2 次转托管，托管后人机替他打", async () => {
    const { code, host, a, b, names } = await started();
    await ok(command(b, { type: "play", card: meIn(b).hand[0]! }, h));
    h.server.testHooks.expireTurn(code);
    const after = await updateWhere(h, host, (snapshot) => snapshot.game?.phase === "resolve");
    expect(after.game!.events[0]).toMatchObject({ type: "TimedOut", phase: "play", players: ["p1", "p2"] });
    expect(after.members.every((member) => !member.auto)).toBe(true);
    // 阶段③：轮到的人（和有圣所待选的人）超时
    inject(code, names, {
      players: [{ played: [3, 30], offer: [1, 2] }, { played: [4, 10] }, { played: [5, 20] }],
      round: 2,
      phase: "resolve",
    });
    await updateWhere(h, host, (snapshot) => snapshot.game?.players[0]!.offerCount === 2);
    h.server.testHooks.expireTurn(code);
    const second = await updateWhere(h, host, (snapshot) => snapshot.game?.players[0]!.sanctuaries.length === 1);
    expect(second.game!.events[0]).toMatchObject({ type: "TimedOut", phase: "resolve", players: ["p2", "p1"] });
    // 甲乙都超时 2 次 → 托管；托管后人机马上替他们做（BOT_DELAY_SCALE=0）
    const auto = await updateWhere(h, b, (snapshot) => snapshot.members.filter((member) => member.auto).length === 2);
    expect(auto.members.filter((member) => member.auto).map((member) => member.playerId).sort()).toEqual(["p1", "p2"]);
    await ok(command(b, { type: "take", card: gameOf(b).market[0]! }, h));
    await updateWhere(h, b, (snapshot) => snapshot.game?.round === 3 && snapshot.game.players[0]!.submitted === true);
    // 自己动一下就交还
    await ok(call<void>((ack) => a.emit("room:auto", false, ack)));
    await updateWhere(h, host, (snapshot) => snapshot.members.find((member) => member.playerId === "p2")!.auto !== true);
    await dissolve(host);
  });

  it("掉线后用原昵称回到原座位，还是自己的牌（离线时人机替他出，不算超时）", async () => {
    const { code, host, a, names } = await started();
    const cards = [...meIn(a).hand];
    a.disconnect();
    await updateWhere(h, host, (snapshot) => snapshot.members.find((member) => member.playerId === "p2")!.connected === false);
    const other = await h.connect();
    expect((await join(other, { name: nick("陌生"), code })).ok).toBe(false);
    const back = await h.connect();
    const rejoined = await ok(join(back, { name: names[1]!, code }));
    expect(rejoined.members.find((member) => member.id === back.id)).toMatchObject({ playerId: "p2", connected: true });
    const me = rejoined.game!.players.find((player) => player.id === "p2")!;
    expect([...me.hand, ...(me.pendingPlay !== null ? [me.pendingPlay] : [])].sort((x, y) => x - y)).toEqual(cards);
    expect(rejoined.game!.players.find((player) => player.id === "p1")!.hand).toEqual([]);
    expect(rejoined.members.every((member) => !member.auto)).toBe(true);
    await dissolve(host);
  });

  it("迟到的点击：带着上一个人的 step 发来的挑牌被拒绝；留圣所带旧 step 照收", async () => {
    const { code, host, a, b, names } = await started();
    inject(code, names, {
      players: [{ played: [3, 30], offer: [1, 2] }, { played: [4, 10] }, { played: [5, 20] }],
      round: 2,
      phase: "resolve",
    });
    const before = await updateWhere(h, host, (snapshot) => snapshot.game?.players[0]!.offerCount === 2);
    for (const client of [a, b]) await updateWhere(h, client, (snapshot) => snapshot.game?.phase === "resolve" && snapshot.game.round === 2);
    const seen = stepKey(before.game!);
    await ok(command(a, { type: "take", card: gameOf(a).market[0]!, step: seen }, h));
    const late = await command(b, { type: "take", card: gameOf(b).market[0]!, step: seen }, h);
    expect(late.ok).toBe(false);
    expect(late.ok ? "" : late.error).toContain("已经过去");
    await ok(command(host, { type: "keep", sanctuary: 2, step: seen }, h));
    await ok(command(b, { type: "take", card: gameOf(b).market[0]!, step: stepKey(gameOf(b)) }, h));
    await dissolve(host);
  });

  it("管理员解散：口令不对拒绝；对了房间关闭，所有人和观战的人都收到通知", async () => {
    const { host, a, b, names } = await threeSeats();
    const viewer = await h.connect();
    await ok(join(viewer, { name: nick("看客"), code: h.latest.get(host)!.code, spectate: true }));
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const admin = await h.connect();
    const rooms = await ok(call<PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack)));
    const target = rooms.find((room) => room.players[0]?.name === names[0])!;
    expect(target.status).toBe("playing");
    expect(target.options).toEqual({ assist: true });
    expect(target.players.every((player) => player.isActive)).toBe(true);
    expect((await call<void>((ack) => admin.emit("admin:dissolve", { roomId: target.id, token: "wrong" }, ack))).ok).toBe(false);
    const closed = Promise.all([host, a, b, viewer].map((client) => new Promise<string>((resolve) => client.once("room:closed", ({ reason }) => resolve(reason)))));
    await delay(2_100); // 口令错一次后要等 2 秒
    await ok(call<void>((ack) => admin.emit("admin:dissolve", { roomId: target.id, token: "flow-test-token" }, ack)));
    expect((await closed).every((reason) => reason.includes("管理员"))).toBe(true);
    const after = await ok(call<PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack)));
    expect(after.some((room) => room.id === target.id)).toBe(false);
  });

  it("刷动作限速：同一个连接一秒内超过 20 个动作就拒绝", async () => {
    const { host } = await started();
    const results = await Promise.all(Array.from({ length: 30 }, () => command(host, { type: "take", card: 1 })));
    expect(results.filter((result) => !result.ok && result.error.includes("太快")).length).toBeGreaterThan(0);
    await delay(1_100);
    await dissolve(host);
  });

  it("抓包：整个流程里每个连接收到的数据都没有别人的手牌、已出未翻的牌、抽到的圣所、牌堆和种子", () => {
    let checked = 0;
    for (const updates of h.received.values()) {
      for (const { selfId, room } of updates) {
        const game = room.game;
        if (!game) continue;
        const raw = game as unknown as Record<string, unknown>;
        for (const key of ["regionDeck", "sanctuaryDeck", "seed", "rngState", "log"]) expect(raw[key], key).toBeUndefined();
        const seat = room.members.find((member) => member.id === selfId)?.playerId;
        for (const player of game.players) {
          if (player.id === seat) continue;
          if (room.access.spectatorsSeeAll && !seat) continue;
          expect(player.hand).toEqual([]);
          expect(player.pendingPlay).toBeNull();
          expect(player.offer).toEqual([]);
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
