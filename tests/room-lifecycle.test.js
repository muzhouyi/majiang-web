const test = require("node:test");
const assert = require("node:assert/strict");

const { makePlayer, delegatedSeatForProfile, roomDirectory, roomCleanupDeadline, sweepExpiredRooms, rooms } = require("../server");

function seat(name, profileId, options = {}) {
  const player = makePlayer({ id: options.id || profileId, name, isBot: Boolean(options.isBot) });
  player.profileId = profileId;
  player.delegated = Boolean(options.delegated);
  return player;
}

test("大厅区分可加入房间和原玩家可接管的托管座位", () => {
  rooms.clear();
  const host = seat("房主", "host-profile");
  const ordinaryBot = seat("小竹", null, { isBot: true, id: "bot-1" });
  const delegated = seat("离线玩家", "return-profile", { isBot: true, delegated: true, id: "bot-2" });
  rooms.set("ABC123", {
    id: "ABC123", mode: "online", phase: "waiting", hostProfileId: "host-profile",
    seats: [host, ordinaryBot, null, null]
  });
  rooms.set("PLAY88", {
    id: "PLAY88", mode: "online", phase: "discard", hostProfileId: "host-profile",
    seats: [host, delegated, ordinaryBot, ordinaryBot]
  });

  const directory = roomDirectory("return-profile");
  const waiting = directory.find((room) => room.id === "ABC123");
  const playing = directory.find((room) => room.id === "PLAY88");
  assert.equal(waiting.canJoin, true);
  assert.equal(waiting.hostName, "房主");
  assert.equal(playing.canJoin, false);
  assert.equal(playing.canRejoin, true);
  assert.equal(playing.humanSeats, 1);
  assert.match(playing.players[1], /托管/);
  assert.equal(delegatedSeatForProfile(rooms.get("PLAY88"), "return-profile"), 1);
  rooms.clear();
});

test("empty and ended rooms use different inactivity deadlines", () => {
  const now = 10_000_000;
  const emptyRoom = {
    phase: "discard",
    seats: [seat("托管玩家", "profile-a", { isBot: true, delegated: true })],
    emptySince: now - 15_000,
    lastActivity: now
  };
  const endedRoom = {
    phase: "ended",
    seats: [seat("真人玩家", "profile-b")],
    emptySince: null,
    lastActivity: now - 25_000
  };

  assert.equal(roomCleanupDeadline(emptyRoom, now).deadline, now + 45_000);
  assert.match(roomCleanupDeadline(emptyRoom, now).reason, /一分钟没有真人玩家/);
  assert.equal(roomCleanupDeadline(endedRoom, now).deadline, now + 155_000);
  assert.match(roomCleanupDeadline(endedRoom, now).reason, /三分钟没有操作/);
});

test("room sweeper removes stale empty and ended rooms", () => {
  rooms.clear();
  const now = 20_000_000;
  rooms.set("EMPTY1", {
    id: "EMPTY1", mode: "online", phase: "waiting", seats: [],
    emptySince: now - 60_001, lastActivity: now - 60_001, timer: null, cleanupTimer: null
  });
  rooms.set("ENDED1", {
    id: "ENDED1", mode: "online", phase: "ended", seats: [seat("真人", "live-profile")],
    emptySince: null, lastActivity: now - 180_001, timer: null, cleanupTimer: null
  });

  sweepExpiredRooms(now);
  assert.equal(rooms.has("EMPTY1"), false);
  assert.equal(rooms.has("ENDED1"), false);
});
