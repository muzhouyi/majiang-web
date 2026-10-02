const test = require("node:test");
const assert = require("node:assert/strict");

const {
  standardShape,
  isSevenPairs,
  isLuxurySevenPairs,
  isThirteenBuKao,
  isThirteenOrphans,
  isPureOneSuit,
  hasOneDragon,
  evaluateWin,
  drillWaitOptions,
  canCompleteDrill,
  makePlayer
} = require("../server");

function playerWith(hand, options = {}) {
  const player = makePlayer({ id: "test", name: "测试玩家", isBot: false });
  player.hand = [...hand];
  player.melds = options.melds || [];
  player.route = options.route || null;
  player.drawnTile = options.drawnTile || null;
  player.activeDrillWait = options.activeDrillWait || null;
  return player;
}

function pong(tile, stacked = false) {
  return { id: `pong-${tile}`, type: "pong", tiles: [tile, tile, tile], centerTile: tile, stacked };
}

function drill(tiles) {
  return { id: `drill-${tiles.join("")}`, type: "drill", tiles, centerTile: tiles[1], stacked: true };
}

test("普通胡支持顺子、刻子和一对将", () => {
  const hand = ["m1", "m2", "m3", "m4", "m5", "m6", "p2", "p3", "p4", "s7", "s7", "s7", "E", "E"];
  assert.ok(standardShape(hand));
  assert.equal(evaluateWin(playerWith(hand), hand).valid, true);
});

test("七对与豪华七对按四张相同牌区分", () => {
  const sevenPairs = ["m1", "m1", "m2", "m2", "p3", "p3", "p4", "p4", "s5", "s5", "s6", "s6", "E", "E"];
  const luxury = ["m1", "m1", "m1", "m1", "p3", "p3", "p4", "p4", "s5", "s5", "s6", "s6", "E", "E"];
  assert.equal(isSevenPairs(sevenPairs), true);
  assert.equal(isLuxurySevenPairs(sevenPairs), false);
  assert.equal(isSevenPairs(luxury), true);
  assert.equal(isLuxurySevenPairs(luxury), true);
  assert.deepEqual(evaluateWin(playerWith(luxury), luxury).patterns, ["豪华七对"]);
});

test("十三不靠要求十四张不同且同花色数字至少相隔三", () => {
  const valid = ["m1", "m4", "m8", "p1", "p4", "p9", "s2", "s5", "E", "S", "W", "N", "C", "F"];
  const adjacent = ["m1", "m3", "m8", "p1", "p4", "p9", "s2", "s5", "E", "S", "W", "N", "C", "F"];
  const pair = ["m1", "m1", "m8", "p1", "p4", "p9", "s2", "s5", "E", "S", "W", "N", "C", "F"];
  assert.equal(isThirteenBuKao(valid), true);
  assert.equal(isThirteenBuKao(adjacent), false);
  assert.equal(isThirteenBuKao(pair), false);
});

test("十三幺必须具备十三种幺九字牌并有一对", () => {
  const hand = ["m1", "m9", "p1", "p9", "s1", "s9", "E", "S", "W", "N", "C", "F", "P", "P"];
  assert.equal(isThirteenOrphans(hand), true);
  assert.deepEqual(evaluateWin(playerWith(hand), hand).patterns, ["十三幺"]);
});

test("清一色与一条龙读取完整手牌及副露牌", () => {
  const tiles = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m2", "m3", "m4", "m5", "m5"];
  assert.equal(isPureOneSuit(tiles), true);
  assert.equal(hasOneDragon(tiles), true);
  assert.deepEqual(evaluateWin(playerWith(tiles), tiles).patterns, ["清一色", "一条龙"]);
});

test("上摞后只按三碰胡或四碰胡路线判定", () => {
  const threePungHand = ["m1", "m1", "m1", "m2", "m3", "m4", "p5", "p5"];
  const threePungPlayer = playerWith(threePungHand, {
    route: "pung",
    melds: [pong("E", true), pong("F")]
  });
  const three = evaluateWin(threePungPlayer, threePungHand);
  assert.equal(three.valid, true);
  assert.deepEqual(three.patterns, ["三碰胡"]);

  const fourPungHand = ["m1", "m1", "m1", "p5", "p5"];
  const fourPungPlayer = playerWith(fourPungHand, {
    route: "pung",
    melds: [pong("E", true), pong("F"), pong("P")]
  });
  const four = evaluateWin(fourPungPlayer, fourPungHand);
  assert.equal(four.valid, true);
  assert.deepEqual(four.patterns, ["四碰胡"]);

  const notEnough = playerWith(["m1", "m2", "m3", "m4", "m5", "m6", "p5", "p5"], {
    route: "pung",
    melds: [pong("E", true), pong("F")]
  });
  assert.equal(evaluateWin(notEnough, notEnough.hand).valid, false);
});

test("钻了后必须有三组已摞钻/边牌才能胡", () => {
  const hand = ["E", "E", "F", "F", "F"];
  const player = playerWith(hand, {
    route: "drill",
    melds: [
      drill(["m1", "m2", "m3"]),
      drill(["p3", "p4", "p5"]),
      drill(["s7", "s8", "s9"])
    ]
  });
  assert.equal(evaluateWin(player, hand).valid, true);
  assert.deepEqual(evaluateWin(player, hand).patterns, ["钻胡"]);

  player.melds.pop();
  const longerHand = ["E", "E", "F", "F", "F", "m4", "m5", "m6"];
  player.hand = longerHand;
  assert.equal(evaluateWin(player, longerHand).valid, false);
});

test("钻牌搭子必须由开局后的本次摸牌形成", () => {
  const madeNow = playerWith(["m1", "m3", "p5", "p5"], { drawnTile: "m3" });
  assert.ok(drillWaitOptions(madeNow).some((option) => option.waitingTile === "m2"));

  const existedBefore = playerWith(["m1", "m1", "m3", "p5"], { drawnTile: "m1" });
  assert.equal(drillWaitOptions(existedBefore).some((option) => option.waitingTile === "m2"), false);

  madeNow.activeDrillWait = { kind: "drill", pattern: ["m1", "m3"], waitingTile: "m2" };
  madeNow.hand.push("m2");
  madeNow.drawnTile = "m2";
  assert.equal(canCompleteDrill(madeNow), true);
});
