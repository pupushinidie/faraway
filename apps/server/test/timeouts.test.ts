/** 真实计时的超时（TURN_MS=500）：没人动也能一直走到终局，连续超时 2 次转托管后由人机打完。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LobbyRoomSnapshot } from "@faraway/game";
import { call, join, ok, startServer, updateWhere, type Harness } from "./harness.js";

process.env.TURN_MS = "500";
process.env.BOT_DELAY_SCALE = "0";

let h: Harness;
beforeAll(async () => {
  h = await startServer();
});
afterAll(async () => {
  await h.close();
});

describe("超时（TURN_MS=500）", () => {
  it("两个真人都不动：到点由系统代打，连续 2 次后转托管，人机把整局打完", async () => {
    const host = await h.connect();
    const guest = await h.connect();
    const room = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: "发呆甲", capacity: 2 } as never, ack)));
    await ok(join(guest, { name: "发呆乙", code: room.code }));
    const t0 = Date.now();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const first = await updateWhere(h, guest, (snapshot) => snapshot.game?.events.some((event) => event.type === "TimedOut") === true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(450);
    expect(first.game!.phase).toBe("resolve");
    const auto = await updateWhere(h, guest, (snapshot) => snapshot.members.every((member) => member.auto === true));
    expect(auto.game!.round).toBeLessThanOrEqual(3);
    const over = await updateWhere(h, guest, (snapshot) => snapshot.game?.phase === "ended", 20_000);
    expect(over.game!.players.every((player) => player.played.length === 8)).toBe(true);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  }, 30_000);
});
