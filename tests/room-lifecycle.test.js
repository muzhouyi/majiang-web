const test = require("node:test");
const assert = require("node:assert/strict");

const { makePlayer, delegatedSeatForProfile, roomDirectory, rooms } = require("../server");

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
  assert.equal(delegatedSeatForProfile(rooms.get("PLAY88"), "return-profile"), 1);
  rooms.clear();
});
