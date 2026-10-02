const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3019);
const PUBLIC_DIR = path.join(__dirname, "public");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const rooms = new Map();
const clients = new Map();

const tileTypes = (() => {
  const tiles = [];
  for (const suit of ["m", "p", "s"]) {
    for (let number = 1; number <= 9; number += 1) tiles.push(`${suit}${number}`);
  }
  for (const honor of ["E", "S", "W", "N", "C", "F", "P"]) tiles.push(honor);
  return tiles;
})();

const tileIndex = new Map(tileTypes.map((tile, index) => [tile, index]));
const winds = ["东", "南", "西", "北"];
const botNames = ["阿庄", "小竹", "南风", "青雀"];
const patternPoints = {
  "清一色": 8,
  "七对": 4,
  "豪华七对": 6,
  "一条龙": 4,
  "十三不靠": 8,
  "十三幺": 13,
  "三碰胡": 4,
  "四碰胡": 8,
  "钻胡": 6
};

function makeId(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let index = 0; index < length; index += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function makeDeck() {
  const deck = [];
  for (const tile of tileTypes) {
    for (let copy = 0; copy < 4; copy += 1) {
      deck.push({ tile, tileId: makeId(12) });
    }
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[target]] = [deck[target], deck[index]];
  }
  return deck;
}

function sortedHand(hand) {
  return [...hand].sort((a, b) => tileIndex.get(a) - tileIndex.get(b));
}

function tileCounts(hand) {
  const counts = Array(tileTypes.length).fill(0);
  for (const tile of hand) counts[tileIndex.get(tile)] += 1;
  return counts;
}

function countTile(hand, tile) {
  return hand.reduce((total, entry) => total + Number(entry === tile), 0);
}

function hasTiles(hand, tiles) {
  const available = new Map();
  for (const tile of hand) available.set(tile, (available.get(tile) || 0) + 1);
  for (const tile of tiles) {
    const count = available.get(tile) || 0;
    if (!count) return false;
    available.set(tile, count - 1);
  }
  return true;
}

function removeTiles(hand, tiles) {
  for (const tile of tiles) {
    const index = hand.indexOf(tile);
    if (index === -1) return false;
    hand.splice(index, 1);
  }
  return true;
}

function removeHandTiles(player, tiles) {
  const removed = [];
  for (const tile of tiles) {
    const index = player.hand.indexOf(tile);
    if (index === -1) return null;
    removed.push({ tile, tileId: player.handTileIds[index] });
    player.hand.splice(index, 1);
    player.handTileIds.splice(index, 1);
  }
  return removed;
}

function sortedPhysicalHand(player) {
  return player.hand
    .map((tile, index) => ({ tile, tileId: player.handTileIds[index] }))
    .sort((a, b) => tileIndex.get(a.tile) - tileIndex.get(b.tile));
}

function snapshotMeld(meld, isOwner) {
  const concealed = meld.type === "drill" || meld.type === "concealed-pong";
  if (isOwner || !concealed) return { ...meld, hidden: false };
  return {
    ...meld,
    tiles: [null, null, null],
    tileIds: [null, null, null],
    centerTile: null,
    hidden: true
  };
}

function tileName(tile) {
  if (!tile) return "";
  const numbers = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const honors = { E: "东风", S: "南风", W: "西风", N: "北风", C: "红中", F: "发财", P: "白板" };
  if (tile.startsWith("m")) return `${numbers[Number(tile[1])]}万`;
  if (tile.startsWith("p")) return `${numbers[Number(tile[1])]}筒`;
  if (tile.startsWith("s")) return `${numbers[Number(tile[1])]}条`;
  return honors[tile] || tile;
}

function bestSetShape(counts, setsLeft) {
  const first = counts.findIndex((count) => count > 0);
  if (setsLeft === 0) return first === -1 ? { triplets: 0 } : null;
  if (first === -1) return null;

  let best = null;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    const rest = bestSetShape(counts, setsLeft - 1);
    counts[first] += 3;
    if (rest) best = { triplets: rest.triplets + 1 };
  }

  const tile = tileTypes[first];
  const suit = tile[0];
  const number = Number(tile[1]);
  if (["m", "p", "s"].includes(suit) && number <= 7) {
    const second = tileIndex.get(`${suit}${number + 1}`);
    const third = tileIndex.get(`${suit}${number + 2}`);
    if (counts[second] > 0 && counts[third] > 0) {
      counts[first] -= 1;
      counts[second] -= 1;
      counts[third] -= 1;
      const rest = bestSetShape(counts, setsLeft - 1);
      counts[first] += 1;
      counts[second] += 1;
      counts[third] += 1;
      if (rest && (!best || rest.triplets > best.triplets)) best = rest;
    }
  }
  return best;
}

function standardShape(hand, meldCount = 0) {
  const setsNeeded = 4 - meldCount;
  if (setsNeeded < 0 || hand.length !== setsNeeded * 3 + 2) return null;
  const counts = tileCounts(hand);
  let best = null;
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] < 2) continue;
    counts[index] -= 2;
    const sets = bestSetShape(counts, setsNeeded);
    counts[index] += 2;
    if (sets && (!best || sets.triplets > best.triplets)) {
      best = { pair: tileTypes[index], triplets: sets.triplets };
    }
  }
  return best;
}

function isSevenPairs(hand) {
  if (hand.length !== 14) return false;
  const counts = tileCounts(hand);
  return counts.every((count) => count === 0 || count === 2 || count === 4)
    && counts.reduce((pairs, count) => pairs + count / 2, 0) === 7;
}

function isLuxurySevenPairs(hand) {
  return isSevenPairs(hand) && tileCounts(hand).some((count) => count === 4);
}

function isThirteenBuKao(hand) {
  if (hand.length !== 14 || new Set(hand).size !== 14) return false;
  for (const suit of ["m", "p", "s"]) {
    const numbers = hand
      .filter((tile) => tile.startsWith(suit))
      .map((tile) => Number(tile[1]))
      .sort((a, b) => a - b);
    for (let index = 1; index < numbers.length; index += 1) {
      if (numbers[index] - numbers[index - 1] < 3) return false;
    }
  }
  return true;
}

function isThirteenOrphans(hand) {
  if (hand.length !== 14) return false;
  const required = ["m1", "m9", "p1", "p9", "s1", "s9", "E", "S", "W", "N", "C", "F", "P"];
  const counts = tileCounts(hand);
  if (!required.every((tile) => counts[tileIndex.get(tile)] >= 1)) return false;
  if (hand.some((tile) => !required.includes(tile))) return false;
  return required.filter((tile) => counts[tileIndex.get(tile)] === 2).length === 1
    && !counts.some((count) => count > 2);
}

function playerTiles(player, concealedHand = player.hand) {
  return [...concealedHand, ...(player.melds || []).flatMap((meld) => meld.tiles)];
}

function isPureOneSuit(tiles) {
  return tiles.length > 0
    && tiles.every((tile) => ["m", "p", "s"].includes(tile[0]))
    && new Set(tiles.map((tile) => tile[0])).size === 1;
}

function hasOneDragon(tiles) {
  return ["m", "p", "s"].some((suit) => {
    for (let number = 1; number <= 9; number += 1) {
      if (!tiles.includes(`${suit}${number}`)) return false;
    }
    return true;
  });
}

function evaluateWin(player, concealedHand) {
  const melds = player.melds || [];
  const shape = standardShape(concealedHand, melds.length);
  const exposedTriplets = melds.filter((meld) => meld.type === "pong" || meld.type === "concealed-pong").length;
  const tripletCount = shape ? shape.triplets + exposedTriplets : 0;
  const allTiles = playerTiles(player, concealedHand);

  if (player.route === "drill") {
    const drillCount = melds.filter((meld) => meld.type === "drill").length;
    return {
      valid: Boolean(shape && drillCount >= 3),
      patterns: drillCount >= 3 ? ["钻胡"] : [],
      tripletCount,
      drillCount
    };
  }

  if (player.route === "pung") {
    const pungName = tripletCount >= 4 ? "四碰胡" : "三碰胡";
    return {
      valid: Boolean(shape && tripletCount >= 3),
      patterns: tripletCount >= 3 ? [pungName] : [],
      tripletCount,
      drillCount: 0
    };
  }

  const noMelds = melds.length === 0;
  const sevenPairs = noMelds && isSevenPairs(concealedHand);
  const luxurySevenPairs = sevenPairs && isLuxurySevenPairs(concealedHand);
  const thirteenBuKao = noMelds && isThirteenBuKao(concealedHand);
  const thirteenOrphans = noMelds && isThirteenOrphans(concealedHand);
  const valid = Boolean(shape || sevenPairs || thirteenBuKao || thirteenOrphans);
  const patterns = [];
  if (thirteenOrphans) patterns.push("十三幺");
  else if (thirteenBuKao) patterns.push("十三不靠");
  else if (luxurySevenPairs) patterns.push("豪华七对");
  else if (sevenPairs) patterns.push("七对");
  if (valid && isPureOneSuit(allTiles)) patterns.push("清一色");
  if (valid && hasOneDragon(allTiles)) patterns.push("一条龙");
  return { valid, patterns, tripletCount, drillCount: 0 };
}

function makeDrillOption(kind, pattern, waitingTile) {
  const option = { kind, pattern, waitingTile };
  option.key = `${kind}:${waitingTile}:${pattern.join(",")}`;
  option.label = `${kind === "edge" ? "边" : "钻"} · 等${tileName(waitingTile)}`;
  return option;
}

function drillCompletionOptions(player) {
  const drawnTile = player?.drawnTile;
  if (!drawnTile || player.route === "pung") return [];
  if (!["m", "p", "s"].includes(drawnTile[0])) return [];

  const suit = drawnTile[0];
  const handBeforeDraw = [...player.hand];
  handBeforeDraw.splice(handBeforeDraw.lastIndexOf(drawnTile), 1);
  const options = [];
  const addWhenDrawCompletesSequence = (kind, pattern, waitingTile) => {
    if (drawnTile === waitingTile && hasTiles(handBeforeDraw, pattern)) {
      options.push(makeDrillOption(kind, pattern, waitingTile));
    }
  };

  addWhenDrawCompletesSequence("edge", [`${suit}1`, `${suit}2`], `${suit}3`);
  addWhenDrawCompletesSequence("edge", [`${suit}8`, `${suit}9`], `${suit}7`);
  for (let number = 1; number <= 7; number += 1) {
    addWhenDrawCompletesSequence("drill", [`${suit}${number}`, `${suit}${number + 2}`], `${suit}${number + 1}`);
  }
  return options;
}

function stackOptions(player) {
  if (!player || player.route === "drill") return [];
  if (player.pungRouteClosed && !player.route) return [];
  const options = [];
  if (player.stackWindowMeldId) {
    const meld = player.melds.find((entry) => entry.id === player.stackWindowMeldId && !entry.stacked);
    if (meld) options.push({ key: `meld:${meld.id}`, tile: meld.tiles[0], label: `上摞 · ${tileName(meld.tiles[0])}` });
  }
  for (const tile of tileTypes) {
    if (countTile(player.hand, tile) >= 3) {
      options.push({ key: `concealed:${tile}`, tile, label: `上摞 · ${tileName(tile)}` });
    }
  }
  return options;
}

function calculateResult(room, winnerSeat, method, winningTile, fromSeat) {
  const winner = room.seats[winnerSeat];
  const evaluation = evaluateWin(winner, winner.hand);
  const base = winnerSeat === 0 ? 2 : 1;
  const items = [{ name: winnerSeat === 0 ? "庄家底分" : "闲家底分", points: base }];
  let handPoints = base;
  for (const pattern of evaluation.patterns) {
    const points = patternPoints[pattern] || 0;
    handPoints += points;
    items.push({ name: pattern, points });
  }

  let payment = handPoints;
  if (method === "自摸") {
    payment *= 2;
    items.push({ name: "自摸翻倍", points: payment });
  }

  const deltas = [0, 0, 0, 0];
  if (method === "自摸") {
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat === winnerSeat) continue;
      deltas[seat] -= payment;
      deltas[winnerSeat] += payment;
    }
  } else {
    const payer = typeof fromSeat === "number" ? fromSeat : room.pendingClaim?.fromSeat;
    const totalPayment = payment * 3;
    deltas[payer] -= totalPayment;
    deltas[winnerSeat] += totalPayment;
    items.push({ name: "点炮包三家", points: totalPayment });
  }

  for (let seat = 0; seat < 4; seat += 1) {
    room.seats[seat].score += deltas[seat];
    room.seats[seat].roundDelta = deltas[seat];
  }

  return {
    winnerSeat,
    fromSeat: method === "点炮" ? fromSeat : null,
    method,
    winningTile,
    patterns: evaluation.patterns,
    base,
    payment,
    deltas,
    items,
    text: `${winner.name} ${method}胡牌，${evaluation.patterns.join("、") || "普通胡"}`
  };
}

function makePlayer({ id, name, isBot }) {
  return {
    id,
    name,
    isBot,
    connected: true,
    score: 0,
    roundDelta: 0,
    hand: [],
    handTileIds: [],
    discards: [],
    melds: [],
    drawnTile: null,
    drawnTileId: null,
    lastDrawnTile: null,
    route: null,
    stackWindowMeldId: null,
    pungRouteClosed: false,
    ready: true
  };
}

function createRoom(hostClient, mode) {
  let id = makeId();
  while (rooms.has(id)) id = makeId();
  const room = {
    id,
    mode,
    hostId: hostClient.id,
    seats: [null, null, null, null],
    wall: [],
    currentSeat: 0,
    phase: "waiting",
    lastDiscard: null,
    winner: null,
    roundResult: null,
    pendingClaim: null,
    log: [],
    logSequence: 0,
    timer: null
  };
  rooms.set(id, room);
  sitClient(room, hostClient, 0);
  if (mode === "solo") {
    fillBots(room);
    startGame(room);
  } else {
    addLog(room, "房间已创建，等待玩家加入。");
    broadcastRoom(room);
  }
  return room;
}

function sitClient(room, client, preferredSeat = -1) {
  const seat = preferredSeat >= 0 && !room.seats[preferredSeat]
    ? preferredSeat
    : room.seats.findIndex((entry) => !entry);
  if (seat === -1) throw new Error("房间已满");
  room.seats[seat] = makePlayer({
    id: client.id,
    name: client.name || `玩家${seat + 1}`,
    isBot: false
  });
  client.roomId = room.id;
  client.seat = seat;
  addLog(room, `${room.seats[seat].name} 坐到了${windName(seat)}位。`);
  return seat;
}

function fillBots(room) {
  for (let seat = 0; seat < 4; seat += 1) {
    if (!room.seats[seat]) {
      room.seats[seat] = makePlayer({
        id: `bot-${room.id}-${seat}`,
        name: botNames[seat],
        isBot: true
      });
    }
  }
  addLog(room, "空位已由电脑玩家补齐。");
}

function startGame(room) {
  if (room.seats.some((seat) => !seat)) {
    addLog(room, "还差玩家，无法开局。");
    broadcastRoom(room);
    return;
  }

  clearRoomTimer(room);
  room.log = [];
  room.logSequence = 0;
  room.wall = makeDeck();
  room.currentSeat = 0;
  room.phase = "playing";
  room.lastDiscard = null;
  room.winner = null;
  room.roundResult = null;
  room.pendingClaim = null;
  for (const seat of room.seats) {
    seat.hand = [];
    seat.handTileIds = [];
    seat.discards = [];
    seat.melds = [];
    seat.drawnTile = null;
    seat.drawnTileId = null;
    seat.lastDrawnTile = null;
    seat.route = null;
    seat.stackWindowMeldId = null;
    seat.pungRouteClosed = false;
    seat.roundDelta = 0;
  }

  for (let round = 0; round < 13; round += 1) {
    for (const seat of room.seats) {
      const instance = room.wall.pop();
      seat.hand.push(instance.tile);
      seat.handTileIds.push(instance.tileId);
    }
  }
  addLog(room, "牌局开始，东风位先摸牌。");
  drawForCurrent(room);
}

function drawForCurrent(room) {
  if (room.winner) return;
  const player = room.seats[room.currentSeat];
  const instance = room.wall.pop();
  if (!instance) {
    room.phase = "ended";
    room.winner = { type: "draw", text: "荒庄，牌墙摸完了。" };
    room.roundResult = { text: "荒庄，本局不结算。", deltas: [0, 0, 0, 0], items: [] };
    addLog(room, room.winner.text);
    broadcastRoom(room);
    return;
  }
  player.hand.push(instance.tile);
  player.handTileIds.push(instance.tileId);
  player.drawnTile = instance.tile;
  player.drawnTileId = instance.tileId;
  player.lastDrawnTile = instance.tile;
  player.stackWindowMeldId = null;
  room.phase = "discard";
  addLog(room, `${player.name} 摸牌。`);

  if (player.isBot) makeBotDeclarations(room, room.currentSeat);
  if (evaluateWin(player, player.hand).valid && player.isBot) {
    endWithWinner(room, room.currentSeat, "自摸", player.lastDrawnTile, null);
    return;
  }

  broadcastRoom(room);
  if (player.isBot) room.timer = setTimeout(() => botDiscard(room), 420 + Math.random() * 360);
}

function makeBotDeclarations(room, seat) {
  const player = room.seats[seat];
  const drillOptions = drillCompletionOptions(player);
  if (drillOptions.length && (player.route === "drill" || (!player.route && Math.random() < 0.28))) {
    declareCompletedDrill(room, seat, drillOptions[0].key, true);
  }

  const concealedStack = stackOptions(player).find((option) => option.key.startsWith("concealed:"));
  if (concealedStack && (player.route === "pung" || (!player.route && Math.random() < 0.18))) {
    declarePungStack(room, seat, concealedStack.key, true);
  }
}

function declareCompletedDrill(room, seat, key, silent = false) {
  if (room.winner || room.phase !== "discard" || room.currentSeat !== seat) return false;
  const player = room.seats[seat];
  const option = drillCompletionOptions(player).find((entry) => entry.key === key);
  if (!option) return false;
  const tiles = sortedHand([...option.pattern, option.waitingTile]);
  const removed = removeHandTiles(player, tiles);
  if (!removed) return false;
  player.route = "drill";
  player.melds.push({
    id: makeId(8),
    type: "drill",
    kind: option.kind,
    tiles,
    tileIds: removed.map((entry) => entry.tileId),
    centerTile: tiles[1],
    stacked: true,
    fromSeat: seat
  });
  player.drawnTile = null;
  player.drawnTileId = null;
  addLog(room, `${player.name} 明示钻了，将刚摸成的钻/边牌暗置上摞。`);
  if (!silent) broadcastRoom(room);
  return true;
}

function declarePungStack(room, seat, key, silent = false) {
  if (room.winner || room.phase === "waiting" || room.phase === "ended") return false;
  const player = room.seats[seat];
  const option = stackOptions(player).find((entry) => entry.key === key);
  if (!option) return false;
  player.route = "pung";

  if (key.startsWith("meld:")) {
    const meld = player.melds.find((entry) => entry.id === key.slice(5));
    if (!meld) return false;
    meld.stacked = true;
    player.stackWindowMeldId = null;
  } else {
    const tile = key.slice("concealed:".length);
    const removed = removeHandTiles(player, [tile, tile, tile]);
    if (!removed) return false;
    player.melds.push({
      id: makeId(8),
      type: "concealed-pong",
      tiles: [tile, tile, tile],
      tileIds: removed.map((entry) => entry.tileId),
      centerTile: tile,
      stacked: true,
      fromSeat: seat
    });
  }

  addLog(room, `${player.name} 明示上摞，走三碰胡/四碰胡路线。`);
  if (!silent) broadcastRoom(room);
  return true;
}

function discardTile(room, seatIndex, tileId, fallbackTile = "") {
  if (room.winner || room.phase !== "discard" || room.currentSeat !== seatIndex) return false;
  const player = room.seats[seatIndex];
  const index = tileId
    ? player.handTileIds.indexOf(tileId)
    : player.hand.indexOf(fallbackTile);
  if (index === -1) return false;

  const [discarded] = player.hand.splice(index, 1);
  const [discardedTileId] = player.handTileIds.splice(index, 1);
  player.drawnTile = null;
  player.drawnTileId = null;
  player.lastDrawnTile = null;
  if (player.stackWindowMeldId && !player.route) player.pungRouteClosed = true;
  player.stackWindowMeldId = null;
  player.discards.push({ tile: discarded, tileId: discardedTileId });
  room.lastDiscard = { tile: discarded, tileId: discardedTileId, fromSeat: seatIndex };
  addLog(room, `${player.name} 打出${tileName(discarded)}。`);
  offerRonClaims(room, seatIndex, discarded, discardedTileId);
  return true;
}

function sortedResponders(fromSeat, responders) {
  return [...responders].sort((a, b) => ((a - fromSeat + 4) % 4) - ((b - fromSeat + 4) % 4));
}

function offerRonClaims(room, fromSeat, tile, tileId) {
  const responders = [];
  for (let seat = 0; seat < 4; seat += 1) {
    if (seat === fromSeat) continue;
    if (evaluateWin(room.seats[seat], [...room.seats[seat].hand, tile]).valid) responders.push(seat);
  }
  if (responders.length) {
    room.phase = "claim";
    room.pendingClaim = { stage: "ron", tile, tileId, fromSeat, responders: sortedResponders(fromSeat, responders), passed: [] };
    broadcastRoom(room);
    scheduleBotClaim(room);
    return;
  }
  offerPongClaim(room, fromSeat, tile, tileId);
}

function offerPongClaim(room, fromSeat, tile, tileId = room.lastDiscard?.tileId) {
  const responders = [];
  for (let seat = 0; seat < 4; seat += 1) {
    if (seat !== fromSeat && countTile(room.seats[seat].hand, tile) >= 2) responders.push(seat);
  }
  const nearest = sortedResponders(fromSeat, responders)[0];
  if (nearest !== undefined) {
    room.phase = "claim";
    room.pendingClaim = { stage: "pong", tile, tileId, fromSeat, responders: [nearest], passed: [] };
    broadcastRoom(room);
    scheduleBotClaim(room);
    return;
  }
  nextTurn(room);
}

function scheduleBotClaim(room) {
  const claim = room.pendingClaim;
  if (!claim) return;
  const botSeat = claim.responders.find((seat) => room.seats[seat].isBot);
  if (botSeat === undefined) return;
  room.timer = setTimeout(() => {
    if (!room.pendingClaim || !room.pendingClaim.responders.includes(botSeat)) return;
    if (room.pendingClaim.stage === "ron") claimRon(room, botSeat);
    else if (room.seats[botSeat].route !== "drill" && Math.random() < 0.72) claimPong(room, botSeat);
    else passClaim(room, botSeat);
  }, 360 + Math.random() * 320);
}

function passClaim(room, seat) {
  const claim = room.pendingClaim;
  if (!claim || !claim.responders.includes(seat)) return false;
  if (!claim.passed.includes(seat)) claim.passed.push(seat);
  const allPassed = claim.responders.every((candidate) => claim.passed.includes(candidate));
  if (!allPassed) {
    broadcastRoom(room);
    return true;
  }
  if (claim.stage === "ron") offerPongClaim(room, claim.fromSeat, claim.tile, claim.tileId);
  else nextTurn(room);
  return true;
}

function claimPong(room, seat) {
  const claim = room.pendingClaim;
  if (!claim || claim.stage !== "pong" || !claim.responders.includes(seat)) return false;
  const player = room.seats[seat];
  const removed = removeHandTiles(player, [claim.tile, claim.tile]);
  if (!removed) return false;
  const discarder = room.seats[claim.fromSeat];
  if (discarder.discards.at(-1)?.tileId === claim.tileId) discarder.discards.pop();

  const meld = {
    id: makeId(8),
    type: "pong",
    tiles: [claim.tile, claim.tile, claim.tile],
    tileIds: [...removed.map((entry) => entry.tileId), claim.tileId],
    centerTile: claim.tile,
    stacked: player.route === "pung",
    fromSeat: claim.fromSeat
  };
  player.melds.push(meld);
  player.stackWindowMeldId = meld.stacked ? null : meld.id;
  player.drawnTile = null;
  player.drawnTileId = null;
  player.lastDrawnTile = null;
  room.currentSeat = seat;
  room.phase = "discard";
  room.pendingClaim = null;
  room.lastDiscard = null;
  addLog(room, `${player.name} 碰了${tileName(claim.tile)}。`);
  if (meld.stacked) addLog(room, `${player.name} 按上摞路线将这组碰牌摞起。`);
  broadcastRoom(room);
  if (player.isBot) {
    if (!player.route && Math.random() < 0.38) declarePungStack(room, seat, `meld:${meld.id}`, true);
    room.timer = setTimeout(() => botDiscard(room), 420 + Math.random() * 320);
  }
  return true;
}

function claimRon(room, seat) {
  const claim = room.pendingClaim;
  if (!claim || claim.stage !== "ron" || !claim.responders.includes(seat)) return false;
  const tile = claim.tile;
  const fromSeat = claim.fromSeat;
  room.seats[seat].hand.push(tile);
  room.seats[seat].handTileIds.push(claim.tileId);
  endWithWinner(room, seat, "点炮", tile, fromSeat);
  return true;
}

function nextTurn(room) {
  const fromSeat = room.lastDiscard?.fromSeat ?? room.pendingClaim?.fromSeat ?? room.currentSeat;
  room.pendingClaim = null;
  room.currentSeat = (fromSeat + 1) % 4;
  drawForCurrent(room);
}

function endWithWinner(room, seat, method, winningTile, fromSeat) {
  const player = room.seats[seat];
  if (!evaluateWin(player, player.hand).valid) return false;
  clearRoomTimer(room);
  room.phase = "ended";
  room.pendingClaim = null;
  for (const seatPlayer of room.seats) {
    seatPlayer.drawnTile = null;
    seatPlayer.drawnTileId = null;
  }
  room.roundResult = calculateResult(room, seat, method, winningTile, fromSeat);
  room.winner = { seat, name: player.name, method, text: `${player.name} ${method}胡牌！` };
  addLog(room, room.roundResult.text);
  broadcastRoom(room);
  return true;
}

function botDiscard(room) {
  if (room.winner || room.phase !== "discard") return;
  const player = room.seats[room.currentSeat];
  if (!player || !player.isBot) return;
  if (evaluateWin(player, player.hand).valid) {
    endWithWinner(room, room.currentSeat, "自摸", player.lastDrawnTile, null);
    return;
  }
  const tile = chooseBotDiscard(player);
  const tileIndexInHand = player.hand.indexOf(tile);
  discardTile(room, room.currentSeat, player.handTileIds[tileIndexInHand]);
}

function chooseBotDiscard(player) {
  const candidates = sortedHand(player.hand);
  const counts = new Map();
  for (const tile of candidates) counts.set(tile, (counts.get(tile) || 0) + 1);
  const scored = candidates.map((tile) => {
    const suit = tile[0];
    const number = Number(tile[1]);
    let score = counts.get(tile) > 1 ? 4 : 0;
    if (!["m", "p", "s"].includes(suit)) score += 3;
    else {
      if (number === 1 || number === 9) score += 2;
      if (player.hand.includes(`${suit}${number - 1}`) || player.hand.includes(`${suit}${number + 1}`)) score -= 2;
      if (player.hand.includes(`${suit}${number - 2}`) || player.hand.includes(`${suit}${number + 2}`)) score -= 1;
    }
    return { tile, score: score + Math.random() };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.tile || player.hand[0];
}

function addLog(room, text) {
  room.logSequence = (room.logSequence || 0) + 1;
  room.log.unshift({ step: room.logSequence, time: Date.now(), text });
}

function windName(seat) {
  return winds[seat];
}

function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function leaveRoom(client) {
  const room = rooms.get(client.roomId);
  if (!room || client.seat < 0) return;
  const seatIndex = client.seat;
  const player = room.seats[seatIndex];
  client.roomId = null;
  client.seat = -1;

  if (room.phase === "waiting") {
    room.seats[seatIndex] = null;
  } else if (player) {
    player.id = `bot-${room.id}-${seatIndex}-${makeId(4)}`;
    player.name = `${player.name}（托管）`;
    player.isBot = true;
    player.connected = true;
  }

  const humans = room.seats.filter((seat) => seat && !seat.isBot);
  if (!humans.length) {
    clearRoomTimer(room);
    rooms.delete(room.id);
  } else {
    if (room.hostId === player?.id || !humans.some((seat) => seat.id === room.hostId)) {
      room.hostId = humans[0].id;
    }
    addLog(room, `${player?.name || "玩家"} 退出了房间。`);
    broadcastRoom(room);
    if (room.phase === "discard" && room.currentSeat === seatIndex && room.seats[seatIndex]?.isBot) {
      clearRoomTimer(room);
      room.timer = setTimeout(() => botDiscard(room), 360);
    } else if (room.phase === "claim" && room.pendingClaim?.responders.includes(seatIndex)) {
      scheduleBotClaim(room);
    }
  }
  sendJson(client.socket, { type: "left" });
}

function routeLabel(player) {
  if (player.route === "drill") return "钻了";
  if (player.route === "pung") return "上摞";
  return "";
}

function roomSnapshot(room, viewerSeat) {
  const viewer = room.seats[viewerSeat];
  const claim = room.pendingClaim;
  const isResponder = Boolean(claim && claim.responders.includes(viewerSeat) && !claim.passed.includes(viewerSeat));
  const viewerTurn = room.phase === "discard" && room.currentSeat === viewerSeat && !room.winner;
  return {
    version: "2.2",
    roomId: room.id,
    mode: room.mode,
    hostSeat: room.seats.findIndex((seat) => seat && seat.id === room.hostId),
    viewerSeat,
    phase: room.phase,
    claimStage: claim?.stage || null,
    currentSeat: room.currentSeat,
    wallCount: room.wall.length,
    lastDiscard: room.lastDiscard,
    latestDiscardTileId: room.lastDiscard?.tileId || null,
    drawnTileId: viewer?.drawnTileId || null,
    winner: room.winner,
    roundResult: room.roundResult,
    canRon: isResponder && claim.stage === "ron",
    canPong: isResponder && claim.stage === "pong",
    canPass: isResponder,
    canDiscard: viewerTurn,
    canSelfWin: viewerTurn && evaluateWin(viewer, viewer?.hand || []).valid,
    drillOptions: viewerTurn ? drillCompletionOptions(viewer) : [],
    stackOptions: !room.winner && room.phase !== "waiting" ? stackOptions(viewer) : [],
    players: room.seats.map((seat, index) => seat ? {
      seat: index,
      wind: windName(index),
      name: seat.name,
      isBot: seat.isBot,
      connected: seat.connected,
      score: seat.score,
      roundDelta: seat.roundDelta,
      handCount: seat.hand.length,
      discards: seat.discards,
      melds: seat.melds.map((meld) => snapshotMeld(meld, index === viewerSeat)),
      route: seat.route,
      routeLabel: routeLabel(seat),
      hand: index === viewerSeat || room.winner ? sortedPhysicalHand(seat) : null
    } : null),
    log: room.log
  };
}

function broadcastRoom(room) {
  for (const seat of room.seats) {
    if (!seat || seat.isBot) continue;
    const client = clients.get(seat.id);
    if (client) sendJson(client.socket, { type: "state", state: roomSnapshot(room, client.seat) });
  }
}

function sendJson(socket, payload) {
  if (!socket.writable) return;
  const data = Buffer.from(JSON.stringify(payload));
  const header = [0x81];
  if (data.length < 126) header.push(data.length);
  else if (data.length < 65536) header.push(126, (data.length >> 8) & 255, data.length & 255);
  else header.push(127, 0, 0, 0, 0, (data.length >> 24) & 255, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255);
  socket.write(Buffer.concat([Buffer.from(header), data]));
}

function parseFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) return { close: true };
  let offset = 2;
  let length = buffer[1] & 0x7f;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 2 ** 32 + low;
    offset += 8;
  }
  const masked = Boolean(buffer[1] & 0x80);
  const mask = masked ? buffer.slice(offset, offset + 4) : null;
  offset += masked ? 4 : 0;
  const payload = buffer.slice(offset, offset + length);
  if (masked) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { text: payload.toString("utf8") };
}

function handleMessage(client, message) {
  let data;
  try {
    data = JSON.parse(message);
  } catch {
    return;
  }

  try {
    if (data.type === "create") {
      client.name = String(data.name || "玩家").slice(0, 12);
      createRoom(client, data.mode === "solo" ? "solo" : "online");
      return;
    }
    if (data.type === "join") {
      client.name = String(data.name || "玩家").slice(0, 12);
      const room = rooms.get(String(data.roomId || "").trim().toUpperCase());
      if (!room) return sendJson(client.socket, { type: "error", message: "没有找到这个房间。" });
      if (room.phase !== "waiting") return sendJson(client.socket, { type: "error", message: "牌局已经开始。" });
      sitClient(room, client);
      broadcastRoom(room);
      return;
    }

    if (data.type === "leave") {
      leaveRoom(client);
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) return;
    if (data.type === "addBots" && client.id === room.hostId && room.phase === "waiting") {
      fillBots(room);
      broadcastRoom(room);
    } else if (data.type === "start" && client.id === room.hostId && room.phase === "waiting") {
      startGame(room);
    } else if (data.type === "discard") {
      discardTile(room, client.seat, String(data.tileId || ""), String(data.tile || ""));
    } else if (data.type === "declareDrill") {
      declareCompletedDrill(room, client.seat, String(data.key || ""));
    } else if (data.type === "declarePung") {
      declarePungStack(room, client.seat, String(data.key || ""));
    } else if (data.type === "selfWin" && room.currentSeat === client.seat) {
      endWithWinner(room, client.seat, "自摸", room.seats[client.seat].lastDrawnTile, null);
    } else if (data.type === "ron") {
      claimRon(room, client.seat);
    } else if (data.type === "pong") {
      claimPong(room, client.seat);
    } else if (data.type === "pass") {
      passClaim(room, client.seat);
    } else if (data.type === "restart" && client.id === room.hostId) {
      startGame(room);
    }
  } catch (error) {
    sendJson(client.socket, { type: "error", message: error.message });
  }
}

function serveStatic(req, res) {
  const requested = decodeURIComponent(req.url.split("?")[0]);
  const safePath = requested === "/" ? "/index.html" : requested;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": filePath.endsWith(".svg") ? "public, max-age=604800" : "no-cache"
    });
    res.end(content);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

const server = http.createServer(serveStatic);

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(req.headers["sec-websocket-key"] + WS_GUID)
    .digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));

  const client = { id: crypto.randomUUID(), socket, name: "玩家", roomId: null, seat: -1 };
  clients.set(client.id, client);
  socket.on("data", (buffer) => {
    const frame = parseFrame(buffer);
    if (!frame) return;
    if (frame.close) return socket.end();
    handleMessage(client, frame.text);
  });
  socket.on("close", () => {
    clients.delete(client.id);
    const room = rooms.get(client.roomId);
    if (!room || client.seat < 0) return;
    const seat = room.seats[client.seat];
    if (seat && !seat.isBot) {
      seat.connected = false;
      addLog(room, `${seat.name} 断开连接。`);
      broadcastRoom(room);
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Mahjong web game running at http://localhost:${PORT}`);
  });
}

module.exports = {
  tileTypes,
  makeDeck,
  sortedPhysicalHand,
  snapshotMeld,
  standardShape,
  isSevenPairs,
  isLuxurySevenPairs,
  isThirteenBuKao,
  isThirteenOrphans,
  isPureOneSuit,
  hasOneDragon,
  evaluateWin,
  drillCompletionOptions,
  makePlayer
};
