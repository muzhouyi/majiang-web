const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function websocketClient(url) {
  const socket = new WebSocket(url);
  const queued = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    const waiterIndex = waiters.findIndex((waiter) => waiter.match(payload));
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(payload);
    else queued.push(payload);
  });
  return {
    socket,
    opened: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    send(payload) { socket.send(JSON.stringify(payload)); },
    waitFor(match, timeout = 4000) {
      const queuedIndex = queued.findIndex(match);
      if (queuedIndex >= 0) return Promise.resolve(queued.splice(queuedIndex, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WebSocket message timeout")), timeout);
        waiters.push({ match, resolve: (payload) => { clearTimeout(timer); resolve(payload); } });
      });
    },
    close() { socket.close(); }
  };
}

test("大厅、房主踢人、托管重连和全员重开可以连贯完成", async (context) => {
  const port = 32619;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "majiang-v26-"));
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, ADMIN_PASSWORD: "test-admin-password", PORT: String(port), DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("test server start timeout")), 4000);
    child.stdout.on("data", (chunk) => {
      if (!chunk.toString().includes("Mahjong web game running")) return;
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", (code) => reject(new Error(`test server exited ${code}`)));
  });

  const host = websocketClient(`ws://127.0.0.1:${port}`);
  const guest = websocketClient(`ws://127.0.0.1:${port}`);
  await Promise.all([host.opened, guest.opened]);

  host.send({ type: "create", mode: "online", name: "房主", profileId: "profile-host" });
  const created = await host.waitFor((payload) => payload.type === "state" && payload.state.phase === "waiting");
  const roomId = created.state.roomId;

  guest.send({ type: "listRooms", profileId: "profile-guest" });
  const directory = await guest.waitFor((payload) => payload.type === "lobbyRooms");
  assert.equal(directory.rooms.find((room) => room.id === roomId).canJoin, true);

  guest.send({ type: "join", roomId, name: "客人", profileId: "profile-guest" });
  const joined = await guest.waitFor((payload) => payload.type === "state" && payload.state.roomId === roomId);
  const guestSeat = joined.state.viewerSeat;

  host.send({ type: "kick", seat: guestSeat });
  assert.equal((await guest.waitFor((payload) => payload.type === "kicked")).type, "kicked");

  guest.send({ type: "join", roomId, name: "客人", profileId: "profile-guest" });
  await guest.waitFor((payload) => payload.type === "state" && payload.state.viewerSeat === guestSeat);
  host.send({ type: "addBots" });
  await host.waitFor((payload) => payload.type === "state" && payload.state.players.filter(Boolean).length === 4);
  host.send({ type: "start" });
  const started = await host.waitFor((payload) => payload.type === "state" && payload.state.phase === "discard");
  assert.ok(Number.isInteger(started.state.dealerSeat));
  assert.equal(started.state.diceRounds.at(-1).winners.length, 1);
  assert.equal(started.state.currentSeat, started.state.dealerSeat);

  guest.close();
  await host.waitFor((payload) => payload.type === "state" && payload.state.players[guestSeat]?.delegated === true);

  const returningGuest = websocketClient(`ws://127.0.0.1:${port}`);
  await returningGuest.opened;
  returningGuest.send({ type: "join", roomId, name: "客人", profileId: "profile-guest" });
  const rejoined = await returningGuest.waitFor((payload) => payload.type === "state" && payload.state.viewerSeat === guestSeat);
  assert.equal(rejoined.state.players[guestSeat].delegated, false);

  host.send({ type: "requestRestart" });
  await returningGuest.waitFor((payload) => payload.type === "state" && payload.state.restartVote && !payload.state.restartVote.viewerApproved);
  returningGuest.send({ type: "respondRestart", approved: true });
  const restarted = await returningGuest.waitFor((payload) => payload.type === "state" && payload.state.phase === "discard" && !payload.state.restartVote);
  assert.equal(restarted.state.wallCount, 83);

  const sourcePlayer = websocketClient(`ws://127.0.0.1:${port}`);
  const admin = websocketClient(`ws://127.0.0.1:${port}`);
  await Promise.all([sourcePlayer.opened, admin.opened]);
  sourcePlayer.send({ type: "create", mode: "online", name: "待合并", profileId: "profile-source" });
  const sourceRoom = await sourcePlayer.waitFor((payload) => payload.type === "state" && payload.state.phase === "waiting");
  sourcePlayer.send({ type: "adminDeleteRoom", roomId: sourceRoom.state.roomId });
  await sourcePlayer.waitFor((payload) => payload.type === "adminError");
  admin.send({ type: "adminLogin", password: "test-admin-password" });
  await admin.waitFor((payload) => payload.type === "adminData");
  admin.send({ type: "adminUpdatePlayer", playerId: "profile-guest", score: 5 });
  await admin.waitFor((payload) => payload.type === "adminData" && payload.message === "玩家积分已更新。");
  admin.send({ type: "adminUpdatePlayer", playerId: "profile-source", score: 7 });
  await admin.waitFor((payload) => payload.type === "adminData" && payload.message === "玩家积分已更新。");
  admin.send({ type: "adminRenamePlayer", playerId: "profile-guest", name: "新客人" });
  await admin.waitFor((payload) => payload.type === "adminData" && payload.message === "玩家昵称已重命名。");
  const renamed = await returningGuest.waitFor((payload) => payload.type === "state" && payload.state.players[guestSeat]?.name === "新客人");
  assert.equal(renamed.state.players[guestSeat].name, "新客人");
  const sameNamePlayer = websocketClient(`ws://127.0.0.1:${port}`);
  await sameNamePlayer.opened;
  sameNamePlayer.send({ type: "create", mode: "online", name: "新客人", profileId: "profile-same-name" });
  const sameNameRoom = await sameNamePlayer.waitFor((payload) => payload.type === "state" && payload.state.phase === "waiting");
  assert.equal(sameNameRoom.state.viewerProfileId, "profile-guest");
  admin.send({ type: "adminGet" });
  const deduplicated = await admin.waitFor((payload) => payload.type === "adminData");
  assert.equal(deduplicated.data.players.filter((player) => player.name === "新客人").length, 1);
  admin.send({ type: "adminMergePlayers", sourcePlayerId: "profile-source", targetPlayerId: "profile-guest" });
  const merged = await admin.waitFor((payload) => payload.type === "adminData" && payload.message?.startsWith("玩家记录已合并"));
  assert.equal(merged.data.players.find((player) => player.id === "profile-guest").score, 12);
  assert.equal(merged.data.players.some((player) => player.id === "profile-source"), false);
  admin.send({ type: "adminDeleteRoom", roomId: sourceRoom.state.roomId });
  await sourcePlayer.waitFor((payload) => payload.type === "roomClosed");
  const afterRoomDelete = await admin.waitFor((payload) => payload.type === "lobbyRooms");
  assert.equal(afterRoomDelete.rooms.some((room) => room.id === sourceRoom.state.roomId), false);

  host.close();
  returningGuest.close();
  sourcePlayer.close();
  sameNamePlayer.close();
  admin.close();
});

test("waiting room dissolves after the last real player has been gone for the configured minute", async (context) => {
  const port = 32620;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "majiang-v27-cleanup-"));
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, ADMIN_PASSWORD: "test-admin-password", PORT: String(port), DATA_DIR: dataDir, EMPTY_ROOM_TTL_MS: "120" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("test server start timeout")), 4000);
    child.stdout.on("data", (chunk) => {
      if (!chunk.toString().includes("Mahjong web game running")) return;
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", (code) => reject(new Error(`test server exited ${code}`)));
  });

  const owner = websocketClient(`ws://127.0.0.1:${port}`);
  await owner.opened;
  owner.send({ type: "create", mode: "online", name: "临时房主", profileId: "cleanup-owner" });
  const created = await owner.waitFor((payload) => payload.type === "state" && payload.state.phase === "waiting");
  owner.close();
  await new Promise((resolve) => setTimeout(resolve, 260));

  const observer = websocketClient(`ws://127.0.0.1:${port}`);
  await observer.opened;
  observer.send({ type: "listRooms", profileId: "cleanup-observer" });
  const directory = await observer.waitFor((payload) => payload.type === "lobbyRooms");
  assert.equal(directory.rooms.some((room) => room.id === created.state.roomId), false);
  observer.close();
});
