const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tileTypes,
  standardShape,
  isSevenPairs,
  isLuxurySevenPairs,
  isThirteenBuKao,
  isThirteenOrphans,
  isPureOneSuit,
  hasOneDragon,
  evaluateWin,
  drillCompletionOptions,
  concealedKongOptions,
  supplementalKongOptions,
  rollForDealer,
  recommendDiscard,
  makePlayer,
  makeDeck,
  sortedPhysicalHand,
  snapshotMeld
} = require("../server");

function playerWith(hand, options = {}) {
  const player = makePlayer({ id: "test", name: "测试玩家", isBot: false });
  player.hand = [...hand];
  player.melds = options.melds || [];
  player.route = options.route || null;
  player.drawnTile = options.drawnTile || null;
  return player;
}

function pong(tile, stacked = false) {
  return { id: `pong-${tile}`, type: "pong", tiles: [tile, tile, tile], centerTile: tile, stacked };
}

function drill(tiles) {
  return { id: `drill-${tiles.join("")}`, type: "drill", tiles, centerTile: tiles[1], stacked: true };
}

test("每一张实体牌都有唯一 tileId，同时保留规则使用的牌值", () => {
  const deck = makeDeck();
  assert.equal(deck.length, 136);
  assert.equal(new Set(deck.map((entry) => entry.tileId)).size, 136);
  assert.ok(deck.every((entry) => tileTypes.includes(entry.tile)));
});

test("摸到的牌按牌值进入手牌顺序，同时由 tileId 保留摸牌标记", () => {
  const player = makePlayer({ id: "sort", name: "排序测试", isBot: false });
  player.hand = ["m9", "m1", "p3"];
  player.handTileIds = ["nine", "drawn-one", "pin-three"];
  player.drawnTileId = "drawn-one";
  assert.deepEqual(sortedPhysicalHand(player).map((entry) => entry.tileId), ["drawn-one", "nine", "pin-three"]);
});

test("钻牌只亮钻入张，自摸上摞牌面隐藏，碰来的上摞保持亮牌", () => {
  const drillMeld = drill(["m1", "m2", "m3"]);
  const concealed = { id: "concealed", type: "concealed-pong", tiles: ["p5", "p5", "p5"], tileIds: ["a", "b", "c"], centerTile: "p5", stacked: true };
  const exposed = pong("s7", true);
  assert.deepEqual(snapshotMeld(drillMeld, false).tiles, [null, "m2", null]);
  assert.deepEqual(snapshotMeld(concealed, false).tiles, [null, null, null]);
  assert.deepEqual(snapshotMeld(exposed, false).tiles, ["s7", "s7", "s7"]);
  assert.deepEqual(snapshotMeld(drillMeld, true).tiles, ["m1", "m2", "m3"]);
});

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

test("只有自摸第三张组成完整边或钻顺子后才能明示", () => {
  const completedEdge = playerWith(["m1", "m2", "m3", "p5"], { drawnTile: "m3" });
  assert.ok(drillCompletionOptions(completedEdge).some((option) => option.kind === "edge" && option.waitingTile === "m3"));

  const completedDrill = playerWith(["m1", "m3", "m2", "p5"], { drawnTile: "m2" });
  assert.ok(drillCompletionOptions(completedDrill).some((option) => option.kind === "drill" && option.waitingTile === "m2"));

  const onlyMadePair = playerWith(["m1", "m3", "p5", "p5"], { drawnTile: "m3" });
  assert.equal(drillCompletionOptions(onlyMadePair).length, 0);

  const openingSequence = playerWith(["m1", "m2", "m3", "p5"]);
  assert.equal(drillCompletionOptions(openingSequence).length, 0);
});

test("暗杠必须由手中四张相同牌组成", () => {
  const player = playerWith(["m3", "m3", "m3", "m3", "p5"]);
  assert.deepEqual(concealedKongOptions(player).map((option) => option.tile), ["m3"]);
  player.hand.pop();
  player.hand.pop();
  assert.equal(concealedKongOptions(player).length, 0);
});

test("补杠只在碰牌后自己新摸到第四张时出现", () => {
  const player = playerWith(["m4", "p2"], {
    melds: [{ id: "pong-m4", type: "pong", tiles: ["m4", "m4", "m4"], tileIds: ["a", "b", "c"] }],
    drawnTile: "m4"
  });
  player.handTileIds = ["drawn-m4", "p2-id"];
  player.drawnTileId = "drawn-m4";
  assert.deepEqual(supplementalKongOptions(player).map((option) => option.tile), ["m4"]);

  player.drawnTileId = null;
  assert.deepEqual(supplementalKongOptions(player), []);
});

test("明杠和暗杠均按三碰四碰路线中的一组刻子计算", () => {
  const hand = ["m1", "m1", "m1", "m2", "m3", "m4", "p5", "p5"];
  const player = playerWith(hand, {
    route: "pung",
    melds: [
      { type: "exposed-kong", tiles: ["E", "E", "E", "E"] },
      { type: "concealed-kong", tiles: ["F", "F", "F", "F"] }
    ]
  });
  assert.deepEqual(evaluateWin(player, hand).patterns, ["三碰胡"]);
});

test("暗杠对其他玩家显示四张牌背", () => {
  const meld = { type: "concealed-kong", tiles: ["s8", "s8", "s8", "s8"], tileIds: ["a", "b", "c", "d"] };
  assert.deepEqual(snapshotMeld(meld, false).tiles, [null, null, null, null]);
  assert.deepEqual(snapshotMeld(meld, true).tiles, ["s8", "s8", "s8", "s8"]);
});

test("开局掷骰每人使用两枚骰子，同点时只让最高点玩家继续加掷", () => {
  const room = { seats: Array.from({ length: 4 }, (_, seat) => ({ name: `玩家${seat + 1}` })) };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rounds = rollForDealer(room);
    assert.ok(rounds.length >= 1);
    assert.equal(rounds[0].rolls.length, 4);
    assert.equal(rounds.at(-1).winners.length, 1);
    for (let index = 0; index < rounds.length; index += 1) {
      assert.ok(rounds[index].rolls.every((roll) => roll.dice.length === 2 && roll.dice.every((die) => die >= 1 && die <= 6)));
      if (index > 0) assert.deepEqual(rounds[index].rolls.map((roll) => roll.seat), rounds[index - 1].winners);
    }
  }
});

test("最佳出牌建议按当前规则保留直接胡牌进张", () => {
  const player = playerWith(["m1", "m2", "m3", "m4", "m5", "m6", "p2", "p3", "p4", "s7", "s8", "E", "E", "C"]);
  player.handTileIds = player.hand.map((_, index) => `tile-${index}`);
  const room = {
    phase: "discard",
    currentSeat: 0,
    seats: [
      player,
      playerWith([]),
      playerWith([]),
      playerWith([])
    ]
  };
  for (const seat of room.seats) {
    seat.discards ||= [];
    seat.melds ||= [];
  }
  const suggestion = recommendDiscard(room, 0);
  assert.equal(suggestion.tile, "C");
  assert.ok(suggestion.winningCopies > 0);
  assert.ok(suggestion.effectiveTiles.includes("s6") || suggestion.effectiveTiles.includes("s9"));
});

test("最佳出牌建议不会为了局部搭子拆掉七对骨架", () => {
  const player = playerWith(["m1", "m1", "m2", "m2", "p3", "p3", "p4", "p4", "s5", "s5", "E", "E", "F", "C"]);
  player.handTileIds = player.hand.map((_, index) => `pair-${index}`);
  const room = { phase: "discard", currentSeat: 0, seats: [player, playerWith([]), playerWith([]), playerWith([])] };
  for (const seat of room.seats) { seat.discards ||= []; seat.melds ||= []; }
  const suggestion = recommendDiscard(room, 0);
  assert.equal(player.hand.filter((tile) => tile === suggestion.tile).length, 1);
  assert.equal(suggestion.shape, "七对");
});

test("最佳出牌建议识别十三幺并优先打出无关数牌", () => {
  const player = playerWith(["m1", "m9", "p1", "p9", "s1", "s9", "E", "S", "W", "N", "C", "F", "P", "m5"]);
  player.handTileIds = player.hand.map((_, index) => `orphan-${index}`);
  const room = { phase: "discard", currentSeat: 0, seats: [player, playerWith([]), playerWith([]), playerWith([])] };
  for (const seat of room.seats) { seat.discards ||= []; seat.melds ||= []; }
  const suggestion = recommendDiscard(room, 0);
  assert.equal(suggestion.tile, "m5");
  assert.equal(suggestion.shape, "十三幺");
});

test("最佳出牌建议会列出打九万后摸七万暗杠并补牌的路线", () => {
  const player = playerWith(["m3", "m4", "m5", "m7", "m7", "m7", "m8", "m8", "m9", "s3", "s4", "s5", "S", "S"]);
  player.handTileIds = player.hand.map((_, index) => `kong-choice-${index}`);
  const room = {
    phase: "discard",
    currentSeat: 0,
    dealerSeat: 0,
    wall: Array(60),
    seats: [player, playerWith([]), playerWith([]), playerWith([])]
  };
  for (const seat of room.seats) { seat.discards ||= []; seat.melds ||= []; }
  const suggestion = recommendDiscard(room, 0);
  const discardNine = suggestion.alternatives.find((entry) => entry.tile === "m9");
  assert.ok(discardNine);
  assert.deepEqual(discardNine.winningTiles, ["m8", "S"]);
  assert.equal(discardNine.kongPaths[0].tile, "m7");
  assert.deepEqual(discardNine.kongPaths[0].supplementTiles, ["m8", "S"]);
});
