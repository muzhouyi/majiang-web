const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3019);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_DATA_FILE = path.join(DATA_DIR, "admin-data.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const EMPTY_ROOM_TTL_MS = Number(process.env.EMPTY_ROOM_TTL_MS || 60_000);
const ENDED_ROOM_TTL_MS = Number(process.env.ENDED_ROOM_TTL_MS || 180_000);
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
const defaultPatternPoints = {
  "清一色": 8,
  "七对": 4,
  "豪华七对": 6,
  "一条龙": 4,
  "十三不靠": 8,
  "十三幺": 13,
  "三碰胡": 4,
  "四碰胡": 8,
  "钻胡": 6,
  "杠上开花": 0
};

const defaultAdminData = {
  scoring: {
    dealerBase: 2,
    nonDealerBase: 1,
    selfDrawMultiplier: 2,
    discardMultiplier: 3,
    discardPayerOnly: true,
    patterns: defaultPatternPoints,
    actions: { "明杠": 0, "暗杠": 0 }
  },
  replay: { enabled: true },
  gameplay: { botTakeoverOnDisconnect: false },
  playerScores: { enabled: true, history: [] },
  players: {},
  replays: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadAdminData() {
  try {
    const saved = JSON.parse(fs.readFileSync(ADMIN_DATA_FILE, "utf8"));
    return {
      ...clone(defaultAdminData),
      ...saved,
      scoring: {
        ...clone(defaultAdminData.scoring),
        ...(saved.scoring || {}),
        patterns: { ...defaultPatternPoints, ...(saved.scoring?.patterns || {}) },
        actions: { ...defaultAdminData.scoring.actions, ...(saved.scoring?.actions || {}) }
      },
      replay: { ...defaultAdminData.replay, ...(saved.replay || {}) },
      gameplay: { ...defaultAdminData.gameplay, ...(saved.gameplay || {}) },
      playerScores: {
        ...defaultAdminData.playerScores,
        ...(saved.playerScores || {}),
        history: Array.isArray(saved.playerScores?.history) ? saved.playerScores.history : []
      },
      players: saved.players || {},
      replays: Array.isArray(saved.replays) ? saved.replays : []
    };
  } catch {
    return clone(defaultAdminData);
  }
}

const adminData = loadAdminData();

function normalizedPlayerName(name) {
  return String(name || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function deduplicatePlayerProfiles() {
  adminData.profileAliases ||= {};
  const canonicalByName = new Map();
  let changed = false;
  for (const [profileId, player] of Object.entries(adminData.players)) {
    const key = normalizedPlayerName(player.name);
    if (!key) continue;
    const canonicalId = canonicalByName.get(key);
    if (!canonicalId) {
      canonicalByName.set(key, profileId);
      continue;
    }
    const canonical = adminData.players[canonicalId];
    canonical.score = (Number(canonical.score) || 0) + (Number(player.score) || 0);
    canonical.updatedAt = Math.max(Number(canonical.updatedAt) || 0, Number(player.updatedAt) || 0, Date.now());
    adminData.profileAliases[profileId] = canonicalId;
    delete adminData.players[profileId];
    for (const entry of adminData.playerScores.history || []) {
      if (entry.profileId === profileId) entry.profileId = canonicalId;
    }
    changed = true;
  }
  return changed;
}

function resolveProfileId(profileId, name) {
  adminData.profileAliases ||= {};
  let resolved = String(profileId || "");
  const visited = new Set();
  while (adminData.profileAliases[resolved] && !visited.has(resolved)) {
    visited.add(resolved);
    resolved = adminData.profileAliases[resolved];
  }
  const key = normalizedPlayerName(name);
  const matched = Object.entries(adminData.players)
    .find(([, player]) => normalizedPlayerName(player.name) === key)?.[0];
  if (matched && resolved && matched !== resolved) adminData.profileAliases[resolved] = matched;
  return matched || resolved;
}

if (deduplicatePlayerProfiles()) saveAdminData();

function saveAdminData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${ADMIN_DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(adminData, null, 2), "utf8");
  fs.renameSync(temporary, ADMIN_DATA_FILE);
}

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
  const concealed = meld.type === "drill" || meld.type === "concealed-pong" || meld.type === "concealed-kong";
  if (isOwner || !concealed) return { ...meld, hidden: false };
  const tileCount = meld.tiles.length;
  return {
    ...meld,
    tiles: Array(tileCount).fill(null),
    tileIds: Array(tileCount).fill(null),
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
  const tripletMeldTypes = new Set(["pong", "concealed-pong", "exposed-kong", "concealed-kong"]);
  const exposedTriplets = melds.filter((meld) => tripletMeldTypes.has(meld.type)).length;
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

function concealedKongOptions(player) {
  if (!player) return [];
  return tileTypes
    .filter((tile) => countTile(player.hand, tile) === 4)
    .map((tile) => ({ key: `concealed-kong:${tile}`, tile, label: `暗杠 · ${tileName(tile)}` }));
}

function settleKongPoints(room, winnerSeat, kind) {
  const points = Number(adminData.scoring.actions[kind]) || 0;
  if (!points) return;
  const winner = room.seats[winnerSeat];
  const scoreChanges = [0, 0, 0, 0];
  for (let seat = 0; seat < 4; seat += 1) {
    if (seat === winnerSeat) continue;
    room.seats[seat].score -= points;
    room.seats[seat].roundDelta -= points;
    winner.score += points;
    winner.roundDelta += points;
    scoreChanges[seat] -= points;
    scoreChanges[winnerSeat] += points;
  }
  persistHumanScores(room, scoreChanges, kind);
  addLog(room, `${winner.name} ${kind}结算，每家支付${points}分。`);
}

function declareConcealedKong(room, seat, key) {
  if (room.winner || room.phase !== "discard" || room.currentSeat !== seat) return false;
  const player = room.seats[seat];
  const option = concealedKongOptions(player).find((entry) => entry.key === key);
  if (!option) return false;
  pushUndoCheckpoint(room, "暗杠");
  const removed = removeHandTiles(player, [option.tile, option.tile, option.tile, option.tile]);
  if (!removed) return false;
  player.melds.push({
    id: makeId(8),
    type: "concealed-kong",
    tiles: [option.tile, option.tile, option.tile, option.tile],
    tileIds: removed.map((entry) => entry.tileId),
    stacked: false,
    fromSeat: seat
  });
  player.drawnTile = null;
  player.drawnTileId = null;
  player.lastDrawnTile = null;
  player.drewAfterKong = false;
  addLog(room, `${player.name} 明示暗杠，牌面保持隐藏。`);
  settleKongPoints(room, seat, "暗杠");
  drawForCurrent(room, true);
  return true;
}

function calculateResult(room, winnerSeat, method, winningTile, fromSeat, gangShangKaiHua = false) {
  const winner = room.seats[winnerSeat];
  const evaluation = evaluateWin(winner, winner.hand);
  const scoring = adminData.scoring;
  const isDealer = winnerSeat === room.dealerSeat;
  const base = isDealer ? scoring.dealerBase : scoring.nonDealerBase;
  const items = [{ name: isDealer ? "庄家底分" : "闲家底分", points: base }];
  let handPoints = base;
  for (const pattern of evaluation.patterns) {
    const points = scoring.patterns[pattern] || 0;
    handPoints += points;
    items.push({ name: pattern, points });
  }
  if (gangShangKaiHua) {
    const points = scoring.patterns["杠上开花"] || 0;
    handPoints += points;
    items.push({ name: "杠上开花", points });
    evaluation.patterns.push("杠上开花");
  }

  let payment = handPoints;
  if (method === "自摸") {
    payment *= scoring.selfDrawMultiplier;
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
    if (scoring.discardPayerOnly !== false) {
      const totalPayment = payment * scoring.discardMultiplier;
      deltas[payer] -= totalPayment;
      deltas[winnerSeat] += totalPayment;
      items.push({ name: "仅点炮者扣分", points: totalPayment });
    } else {
      for (let seat = 0; seat < 4; seat += 1) {
        if (seat === winnerSeat) continue;
        deltas[seat] -= payment;
        deltas[winnerSeat] += payment;
      }
      items.push({ name: "其余三家各付", points: payment });
    }
  }

  for (let seat = 0; seat < 4; seat += 1) {
    room.seats[seat].score += deltas[seat];
    room.seats[seat].roundDelta = deltas[seat];
  }
  persistHumanScores(room, deltas, `${method}胡牌`);

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
    profileId: null,
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
    drewAfterKong: false,
    route: null,
    stackWindowMeldId: null,
    pungRouteClosed: false,
    delegated: false,
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
    hostProfileId: hostClient.profileId,
    seats: [null, null, null, null],
    wall: [],
    dealerSeat: null,
    diceRounds: [],
    currentSeat: 0,
    phase: "waiting",
    lastDiscard: null,
    winner: null,
    roundResult: null,
    pendingClaim: null,
    log: [],
    logSequence: 0,
    replayFrames: [],
    replaySaved: false,
    restartVote: null,
    undoVote: null,
    undoStack: [],
    timer: null,
    cleanupTimer: null,
    emptySince: null,
    lastActivity: Date.now()
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
  client.profileId = resolveProfileId(client.profileId, client.name);
  const replaceable = (entry) => !entry || (room.phase === "waiting" && entry.isBot && !entry.delegated);
  const seat = preferredSeat >= 0 && replaceable(room.seats[preferredSeat])
    ? preferredSeat
    : room.seats.findIndex(replaceable);
  if (seat === -1) throw new Error("房间已满");
  room.seats[seat] = makePlayer({
    id: client.id,
    name: client.name || `玩家${seat + 1}`,
    isBot: false
  });
  room.seats[seat].profileId = client.profileId;
  if (client.profileId) {
    const existingProfile = adminData.players[client.profileId];
    const profile = existingProfile || { name: room.seats[seat].name, score: 0, updatedAt: Date.now() };
    if (existingProfile) room.seats[seat].name = profile.name;
    else profile.name = room.seats[seat].name;
    profile.updatedAt = Date.now();
    adminData.players[client.profileId] = profile;
    room.seats[seat].score = Number(profile.score) || 0;
    client.name = room.seats[seat].name;
    saveAdminData();
  }
  client.roomId = room.id;
  client.seat = seat;
  if (!room.hostProfileId) {
    room.hostId = client.id;
    room.hostProfileId = client.profileId;
  }
  addLog(room, `${room.seats[seat].name} 坐到了${windName(seat)}位。`);
  markRoomActivity(room);
  return seat;
}

function delegatedSeatForProfile(room, profileId) {
  if (!profileId) return -1;
  return room.seats.findIndex((seat) => seat?.profileId === profileId && (seat.delegated || !seat.connected));
}

function reconnectClient(room, client) {
  const seatIndex = delegatedSeatForProfile(room, client.profileId);
  if (seatIndex === -1) return false;
  const player = room.seats[seatIndex];
  if ((room.phase === "discard" && room.currentSeat === seatIndex)
    || (room.phase === "claim" && room.pendingClaim?.responders.includes(seatIndex))) clearRoomTimer(room);
  player.id = client.id;
  player.name = adminData.players[client.profileId]?.name || client.name || player.name;
  player.isBot = false;
  player.connected = true;
  player.delegated = false;
  client.name = player.name;
  client.roomId = room.id;
  client.seat = seatIndex;
  addLog(room, `${player.name} 重新加入并接管了${windName(seatIndex)}位。`);
  markRoomActivity(room);
  broadcastRoom(room);
  resumeRoomFlow(room);
  return true;
}

function roomDirectory(profileId) {
  sweepExpiredRooms();
  return [...rooms.values()]
    .filter((room) => room.mode === "online")
    .map((room) => {
      const hostSeat = room.seats.findIndex((seat) => seat?.profileId === room.hostProfileId);
      const occupied = room.seats.filter(Boolean).length;
      const humanSeats = connectedHumanCount(room);
      const canRejoin = delegatedSeatForProfile(room, profileId) !== -1;
      const canJoin = room.phase === "waiting" && room.seats.some((seat) => !seat || (seat.isBot && !seat.delegated));
      return {
        id: room.id,
        status: room.phase === "waiting" ? "waiting" : room.phase === "ended" ? "ended" : "playing",
        hostName: room.seats[hostSeat]?.name || "房主暂离",
        occupied,
        humanSeats,
        canJoin,
        canRejoin,
        players: room.seats.filter(Boolean).map((seat) => seat.isBot
          ? `${seat.name}${seat.delegated ? "（托管）" : "（人机）"}`
          : `${seat.name}${seat.connected ? "" : "（掉线）"}`)
      };
    })
    .sort((a, b) => Number(b.canRejoin) - Number(a.canRejoin) || Number(b.canJoin) - Number(a.canJoin) || a.id.localeCompare(b.id));
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

  const previousPhase = room.phase;
  const previousWinner = room.winner;
  clearRoomTimer(room);
  clearRoomCleanupTimer(room);
  room.emptySince = room.seats.some((seat) => seat && !seat.isBot) ? null : (room.emptySince || Date.now());
  room.lastActivity = Date.now();
  room.log = [];
  room.logSequence = 0;
  room.replayFrames = [];
  room.replaySaved = false;
  room.wall = makeDeck();
  if (room.dealerSeat === null) {
    room.diceRounds = rollForDealer(room);
    room.dealerSeat = room.diceRounds.at(-1).winners[0];
  } else if (previousPhase === "ended" && previousWinner?.seat !== undefined && previousWinner.seat !== room.dealerSeat) {
    room.dealerSeat = (room.dealerSeat + 1) % 4;
    room.diceRounds = [];
  } else {
    room.diceRounds = [];
  }
  room.currentSeat = room.dealerSeat;
  room.phase = "playing";
  room.lastDiscard = null;
  room.winner = null;
  room.roundResult = null;
  room.pendingClaim = null;
  room.restartVote = null;
  room.undoVote = null;
  room.undoStack = [];
  for (const seat of room.seats) {
    seat.hand = [];
    seat.handTileIds = [];
    seat.discards = [];
    seat.melds = [];
    seat.drawnTile = null;
    seat.drawnTileId = null;
    seat.lastDrawnTile = null;
    seat.drewAfterKong = false;
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
  if (room.diceRounds.length) {
    const rounds = room.diceRounds.map((round, index) => `第${index + 1}轮：${round.rolls.map((roll) => `${room.seats[roll.seat].name}${roll.dice[0]}+${roll.dice[1]}=${roll.total}`).join("，")}`).join("；");
    addLog(room, `开局掷骰定庄。${rounds}。${room.seats[room.dealerSeat].name} 点数最高成为庄家。`);
  } else if (previousWinner?.seat === room.dealerSeat) {
    addLog(room, `${room.seats[room.dealerSeat].name} 胡牌，继续连庄。`);
  } else {
    addLog(room, `庄家逆时针移到 ${room.seats[room.dealerSeat].name}。`);
  }
  addLog(room, `牌局开始，${room.seats[room.dealerSeat].name}（庄家）先摸牌。`);
  drawForCurrent(room);
  scheduleRoomCleanup(room);
}

function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

function rollForDealer(room) {
  let contenders = room.seats.map((_, seat) => seat);
  const rounds = [];
  do {
    const rolls = contenders.map((seat) => {
      const dice = [rollDie(), rollDie()];
      return { seat, dice, total: dice[0] + dice[1] };
    });
    const highest = Math.max(...rolls.map((roll) => roll.total));
    contenders = rolls.filter((roll) => roll.total === highest).map((roll) => roll.seat);
    rounds.push({ rolls, highest, winners: [...contenders] });
  } while (contenders.length > 1);
  return rounds;
}

function drawForCurrent(room, afterKong = false) {
  if (room.winner) return;
  const player = room.seats[room.currentSeat];
  const instance = room.wall.pop();
  if (!instance) {
    room.phase = "ended";
    room.winner = { type: "draw", text: "荒庄，牌墙摸完了。" };
    room.roundResult = { text: "荒庄，本局不结算。", deltas: [0, 0, 0, 0], items: [] };
    addLog(room, room.winner.text);
    finalizeReplay(room);
    room.lastActivity = Date.now();
    scheduleRoomCleanup(room);
    broadcastRoom(room);
    return;
  }
  player.hand.push(instance.tile);
  player.handTileIds.push(instance.tileId);
  player.drawnTile = instance.tile;
  player.drawnTileId = instance.tileId;
  player.lastDrawnTile = instance.tile;
  player.drewAfterKong = afterKong;
  player.stackWindowMeldId = null;
  room.phase = "discard";
  addLog(room, `${player.name}${afterKong ? " 杠后补牌。" : " 摸牌。"}`);

  if (player.isBot) makeBotDeclarations(room, room.currentSeat);
  if (evaluateWin(player, player.hand).valid && player.isBot) {
    endWithWinner(room, room.currentSeat, "自摸", player.lastDrawnTile, null, player.drewAfterKong);
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

function pushUndoCheckpoint(room, label) {
  const profileScores = {};
  for (const player of room.seats) {
    if (player?.profileId && adminData.players[player.profileId]) {
      profileScores[player.profileId] = clone(adminData.players[player.profileId]);
    }
  }
  room.undoStack ||= [];
  room.undoStack.push({
    label,
    state: clone({
      wall: room.wall,
      currentSeat: room.currentSeat,
      phase: room.phase,
      lastDiscard: room.lastDiscard,
      winner: room.winner,
      roundResult: room.roundResult,
      pendingClaim: room.pendingClaim,
      log: room.log,
      logSequence: room.logSequence,
      replayFrames: room.replayFrames,
      replaySaved: room.replaySaved,
      seats: room.seats
    }),
    profileScores,
    scoreHistoryIds: (adminData.playerScores.history || []).filter((entry) => entry.roomId === room.id).map((entry) => entry.id)
  });
  room.undoStack = room.undoStack.slice(-20);
}

function declareCompletedDrill(room, seat, key, silent = false) {
  if (room.winner || room.phase !== "discard" || room.currentSeat !== seat) return false;
  const player = room.seats[seat];
  const option = drillCompletionOptions(player).find((entry) => entry.key === key);
  if (!option) return false;
  pushUndoCheckpoint(room, "钻了");
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
  pushUndoCheckpoint(room, "上摞");
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
  pushUndoCheckpoint(room, "出牌");

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
    room.pendingClaim = {
      stage: "pong",
      tile,
      tileId,
      fromSeat,
      responders: [nearest],
      passed: [],
      kongResponders: countTile(room.seats[nearest].hand, tile) >= 3 ? [nearest] : []
    };
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
    else if (claim.kongResponders?.includes(botSeat) && Math.random() < 0.32) claimKong(room, botSeat);
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

function claimKong(room, seat) {
  const claim = room.pendingClaim;
  if (!claim || claim.stage !== "pong" || !claim.kongResponders?.includes(seat)) return false;
  const player = room.seats[seat];
  const removed = removeHandTiles(player, [claim.tile, claim.tile, claim.tile]);
  if (!removed) return false;
  const discarder = room.seats[claim.fromSeat];
  if (discarder.discards.at(-1)?.tileId === claim.tileId) discarder.discards.pop();
  player.melds.push({
    id: makeId(8),
    type: "exposed-kong",
    tiles: [claim.tile, claim.tile, claim.tile, claim.tile],
    tileIds: [...removed.map((entry) => entry.tileId), claim.tileId],
    stacked: false,
    fromSeat: claim.fromSeat
  });
  player.drawnTile = null;
  player.drawnTileId = null;
  player.lastDrawnTile = null;
  room.currentSeat = seat;
  room.phase = "discard";
  room.pendingClaim = null;
  room.lastDiscard = null;
  addLog(room, `${player.name} 明杠了${tileName(claim.tile)}，四张牌亮出。`);
  settleKongPoints(room, seat, "明杠");
  drawForCurrent(room, true);
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

function endWithWinner(room, seat, method, winningTile, fromSeat, gangShangKaiHua = false) {
  const player = room.seats[seat];
  if (!evaluateWin(player, player.hand).valid) return false;
  clearRoomTimer(room);
  room.phase = "ended";
  room.pendingClaim = null;
  for (const seatPlayer of room.seats) {
    seatPlayer.drawnTile = null;
    seatPlayer.drawnTileId = null;
  }
  room.roundResult = calculateResult(room, seat, method, winningTile, fromSeat, gangShangKaiHua);
  room.winner = { seat, name: player.name, method, text: `${player.name} ${method}胡牌！` };
  addLog(room, room.roundResult.text);
  finalizeReplay(room);
  room.lastActivity = Date.now();
  scheduleRoomCleanup(room);
  broadcastRoom(room);
  return true;
}

function botDiscard(room) {
  if (room.winner || room.phase !== "discard") return;
  const player = room.seats[room.currentSeat];
  if (!player || !player.isBot) return;
  if (evaluateWin(player, player.hand).valid) {
    endWithWinner(room, room.currentSeat, "自摸", player.lastDrawnTile, null, player.drewAfterKong);
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

function handStructureScore(player, hand) {
  const counts = tileCounts(hand);
  let score = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index];
    if (count >= 2) score += player.route === "pung" ? 10 : 7;
    if (count >= 3) score += player.route === "pung" ? 24 : 17;
    const tile = tileTypes[index];
    if (!["m", "p", "s"].includes(tile[0])) continue;
    const number = Number(tile[1]);
    if (number <= 8 && counts[tileIndex.get(`${tile[0]}${number + 1}`)] > 0) score += 5;
    if (number <= 7 && counts[tileIndex.get(`${tile[0]}${number + 2}`)] > 0) score += 3;
  }
  if (!player.route) {
    const pairCount = counts.filter((count) => count >= 2).length;
    score += pairCount * 5;
    const orphanTiles = new Set(["m1", "m9", "p1", "p9", "s1", "s9", "E", "S", "W", "N", "C", "F", "P"]);
    score += new Set(hand.filter((tile) => orphanTiles.has(tile))).size * 2;
    for (const suit of ["m", "p", "s"]) {
      const suited = hand.filter((tile) => tile[0] === suit);
      score += new Set(suited.map((tile) => tile[1])).size;
      score += suited.length * 0.6;
    }
    const suitCounts = ["m", "p", "s"].map((suit) => hand.filter((tile) => tile[0] === suit).length);
    score += Math.max(...suitCounts) * 0.8;
  }
  return score;
}

function standardShanten(hand, exposedMelds = 0) {
  const counts = tileCounts(hand);
  let minimum = 8;

  function search(start, melds, pairs, partials) {
    while (start < counts.length && counts[start] === 0) start += 1;
    if (start >= counts.length) {
      const usablePartials = Math.min(partials, Math.max(0, 4 - melds));
      minimum = Math.min(minimum, 8 - melds * 2 - usablePartials - pairs);
      return;
    }
    if (melds > 4 || pairs > 1) return;

    const tile = tileTypes[start];
    const suit = tile[0];
    const number = Number(tile[1]);

    if (counts[start] >= 3) {
      counts[start] -= 3;
      search(start, melds + 1, pairs, partials);
      counts[start] += 3;
    }
    if (["m", "p", "s"].includes(suit) && number <= 7) {
      const second = tileIndex.get(`${suit}${number + 1}`);
      const third = tileIndex.get(`${suit}${number + 2}`);
      if (counts[second] && counts[third]) {
        counts[start] -= 1;
        counts[second] -= 1;
        counts[third] -= 1;
        search(start, melds + 1, pairs, partials);
        counts[start] += 1;
        counts[second] += 1;
        counts[third] += 1;
      }
    }
    if (counts[start] >= 2) {
      counts[start] -= 2;
      if (!pairs) search(start, melds, 1, partials);
      search(start, melds, pairs, partials + 1);
      counts[start] += 2;
    }
    if (["m", "p", "s"].includes(suit)) {
      for (const offset of [1, 2]) {
        if (number + offset > 9) continue;
        const neighbor = tileIndex.get(`${suit}${number + offset}`);
        if (!counts[neighbor]) continue;
        counts[start] -= 1;
        counts[neighbor] -= 1;
        search(start, melds, pairs, partials + 1);
        counts[start] += 1;
        counts[neighbor] += 1;
      }
    }
    counts[start] -= 1;
    search(start, melds, pairs, partials);
    counts[start] += 1;
  }

  search(0, exposedMelds, 0, 0);
  return minimum;
}

function sevenPairsShanten(hand) {
  const counts = tileCounts(hand);
  const pairs = counts.filter((count) => count >= 2).length;
  const unique = counts.filter(Boolean).length;
  return 6 - pairs + Math.max(0, 7 - unique);
}

function thirteenOrphansShanten(hand) {
  const required = ["m1", "m9", "p1", "p9", "s1", "s9", "E", "S", "W", "N", "C", "F", "P"];
  const counts = new Map(required.map((tile) => [tile, countTile(hand, tile)]));
  const unique = required.filter((tile) => counts.get(tile) > 0).length;
  const pair = required.some((tile) => counts.get(tile) > 1) ? 1 : 0;
  return 13 - unique - pair;
}

const spacedSuitSubsets = (() => {
  const subsets = [];
  for (let mask = 0; mask < 2 ** 9; mask += 1) {
    const numbers = [];
    for (let index = 0; index < 9; index += 1) {
      if (mask & (1 << index)) numbers.push(index + 1);
    }
    if (numbers.every((number, index) => index === 0 || number - numbers[index - 1] >= 3)) subsets.push(numbers);
  }
  return subsets;
})();

const thirteenBuKaoTargets = (() => {
  const targets = [];
  for (const man of spacedSuitSubsets) {
    for (const pin of spacedSuitSubsets) {
      for (const sou of spacedSuitSubsets) {
        const suitedCount = man.length + pin.length + sou.length;
        if (suitedCount >= 7 && suitedCount <= 9) {
          const mask = (numbers) => numbers.reduce((value, number) => value | (1 << (number - 1)), 0);
          targets.push({ manMask: mask(man), pinMask: mask(pin), souMask: mask(sou), honorSlots: 14 - suitedCount });
        }
      }
    }
  }
  return targets;
})();

function thirteenBuKaoShanten(hand) {
  const uniqueHand = new Set(hand);
  const honorMatches = ["E", "S", "W", "N", "C", "F", "P"].filter((tile) => uniqueHand.has(tile)).length;
  const suitMask = (suit) => [...uniqueHand]
    .filter((tile) => tile[0] === suit)
    .reduce((value, tile) => value | (1 << (Number(tile[1]) - 1)), 0);
  const masks = { m: suitMask("m"), p: suitMask("p"), s: suitMask("s") };
  const bitCount = (value) => {
    let count = 0;
    for (let bits = value; bits; bits &= bits - 1) count += 1;
    return count;
  };
  let bestOverlap = 0;
  for (const target of thirteenBuKaoTargets) {
    const overlap = bitCount(masks.m & target.manMask)
      + bitCount(masks.p & target.pinMask)
      + bitCount(masks.s & target.souMask)
      + Math.min(honorMatches, target.honorSlots);
    bestOverlap = Math.max(bestOverlap, overlap);
  }
  return 13 - bestOverlap;
}

function handDistance(player, hand) {
  const melds = player.melds || [];
  if (evaluateWin(player, hand).valid) return { shanten: -1, shape: player.route === "drill" ? "钻胡" : player.route === "pung" ? "三碰/四碰" : "成胡" };
  const standard = standardShanten(hand, melds.length);
  if (player.route === "drill") {
    const drillsNeeded = Math.max(0, 3 - melds.filter((meld) => meld.type === "drill").length);
    return { shanten: standard + drillsNeeded, shape: "钻胡" };
  }
  if (player.route === "pung") {
    const tripletTypes = new Set(["pong", "concealed-pong", "exposed-kong", "concealed-kong"]);
    const fixedTriplets = melds.filter((meld) => tripletTypes.has(meld.type)).length;
    const handTriplets = tileCounts(hand).filter((count) => count >= 3).length;
    const tripletsNeeded = Math.max(0, 3 - fixedTriplets - handTriplets);
    return { shanten: standard + tripletsNeeded, shape: "三碰/四碰" };
  }
  if (melds.length) return { shanten: standard, shape: "普通胡" };
  const options = [
    { shanten: standard, shape: "普通胡" },
    { shanten: sevenPairsShanten(hand), shape: "七对" },
    { shanten: thirteenOrphansShanten(hand), shape: "十三幺" },
    { shanten: thirteenBuKaoShanten(hand), shape: "十三不靠" }
  ];
  return options.sort((a, b) => a.shanten - b.shanten)[0];
}

function distanceForShape(player, hand, shape) {
  if (evaluateWin(player, hand).valid) return -1;
  if (shape === "七对") return sevenPairsShanten(hand);
  if (shape === "十三幺") return thirteenOrphansShanten(hand);
  if (shape === "十三不靠") return thirteenBuKaoShanten(hand);
  const melds = player.melds || [];
  const standard = standardShanten(hand, melds.length);
  if (shape === "钻胡") return standard + Math.max(0, 3 - melds.filter((meld) => meld.type === "drill").length);
  if (shape === "三碰/四碰") {
    const tripletTypes = new Set(["pong", "concealed-pong", "exposed-kong", "concealed-kong"]);
    const triplets = melds.filter((meld) => tripletTypes.has(meld.type)).length
      + tileCounts(hand).filter((count) => count >= 3).length;
    return standard + Math.max(0, 3 - triplets);
  }
  return standard;
}

function distanceAfterDraw(player, hand, draw, shape) {
  const drawn = [...hand, draw];
  return { shanten: distanceForShape(player, drawn, shape), shape };
}

function visibleTileCount(room, viewerSeat, tile) {
  let count = room.seats[viewerSeat].hand.filter((entry) => entry === tile).length;
  for (const player of room.seats) {
    count += player.discards.filter((entry) => entry.tile === tile).length;
    for (const meld of player.melds) {
      if (["drill", "concealed-pong", "concealed-kong"].includes(meld.type) && player !== room.seats[viewerSeat]) continue;
      count += meld.tiles.filter((entry) => entry === tile).length;
    }
  }
  return Math.min(4, count);
}

function recommendDiscard(room, seat) {
  const player = room.seats[seat];
  if (!player || room.phase !== "discard" || room.currentSeat !== seat || player.hand.length < 2) return null;
  const candidates = [...new Set(player.hand)];
  const ranked = candidates.map((discard) => {
    const hand = [...player.hand];
    hand.splice(hand.indexOf(discard), 1);
    const distance = handDistance(player, hand);
    const patternTieBreak = handStructureScore(player, hand);
    const allTiles = playerTiles(player, hand);
    const patternBonus = (isPureOneSuit(allTiles) ? 5 : 0) + (hasOneDragon(allTiles) ? 4 : 0);
    return { discard, hand, distance, winningCopies: 0, effectiveCopies: 0, effectiveTiles: [], patternTieBreak, patternBonus };
  });
  const bestShanten = Math.min(...ranked.map((entry) => entry.distance.shanten));
  for (const entry of ranked) {
    if (entry.distance.shanten !== bestShanten) continue;
    for (const draw of tileTypes) {
      const copies = Math.max(0, 4 - visibleTileCount(room, seat, draw));
      if (!copies) continue;
      const nextDistance = distanceAfterDraw(player, entry.hand, draw, entry.distance.shape);
      if (nextDistance.shanten === -1) {
        entry.winningCopies += copies;
        entry.effectiveCopies += copies;
        entry.effectiveTiles.push(draw);
      } else if (nextDistance.shanten < entry.distance.shanten) {
        entry.effectiveCopies += copies;
        entry.effectiveTiles.push(draw);
      }
    }
  }
  ranked.sort((a, b) => a.distance.shanten - b.distance.shanten
    || b.winningCopies - a.winningCopies
    || b.effectiveCopies - a.effectiveCopies
    || b.patternBonus - a.patternBonus
    || b.patternTieBreak - a.patternTieBreak
    || tileIndex.get(b.discard) - tileIndex.get(a.discard));
  const best = ranked[0];
  const draws = best.effectiveTiles.slice(0, 6).map(tileName).join("、");
  return {
    tile: best.discard,
    tileName: tileName(best.discard),
    winningCopies: best.winningCopies,
    effectiveCopies: best.effectiveCopies,
    effectiveTiles: best.effectiveTiles,
    shanten: best.distance.shanten,
    shape: best.distance.shape,
    text: best.winningCopies
      ? `建议打出${tileName(best.discard)}。按${best.distance.shape}分析，当前有${best.winningCopies}张可见余量的直接胡牌进张${draws ? `（${draws}）` : ""}。`
      : `建议打出${tileName(best.discard)}。按${best.distance.shape}分析，当前为${best.distance.shanten}向听，保留${best.effectiveCopies}张可见余量的有效进张${draws ? `（${draws}）` : ""}。`
  };
}

function addLog(room, text) {
  room.logSequence = (room.logSequence || 0) + 1;
  room.log.unshift({ step: room.logSequence, time: Date.now(), text });
  if (adminData.replay.enabled) captureReplayFrame(room, text);
}

function captureReplayFrame(room, text) {
  room.replayFrames ||= [];
  room.replayFrames.push({
    step: room.logSequence,
    time: Date.now(),
    text,
    phase: room.phase,
    currentSeat: room.currentSeat,
    wallCount: room.wall.length,
    latestDiscardTileId: room.lastDiscard?.tileId || null,
    players: room.seats.filter(Boolean).map((player, seat) => ({
      seat,
      wind: windName(seat),
      name: player.name,
      score: player.score,
      hand: sortedPhysicalHand(player),
      discards: clone(player.discards),
      melds: clone(player.melds),
      routeLabel: routeLabel(player)
    }))
  });
}

function finalizeReplay(room) {
  if (!adminData.replay.enabled || room.replaySaved || !room.replayFrames?.length) return;
  room.replaySaved = true;
  adminData.replays.unshift({
    id: `${room.id}-${Date.now()}`,
    roomId: room.id,
    mode: room.mode,
    createdAt: Date.now(),
    result: room.roundResult?.text || room.winner?.text || "牌局结束",
    players: room.seats.filter(Boolean).map((player) => player.name),
    frames: room.replayFrames
  });
  adminData.replays = adminData.replays.slice(0, 20);
  saveAdminData();
}

function persistHumanScores(room, changes = null, reason = "牌局结算") {
  let changed = false;
  for (let seat = 0; seat < room.seats.length; seat += 1) {
    const player = room.seats[seat];
    if (!player || (player.isBot && !player.delegated) || !player.profileId) continue;
    adminData.players[player.profileId] = {
      name: player.name,
      score: player.score,
      updatedAt: Date.now()
    };
    const delta = Number(changes?.[seat]) || 0;
    if (adminData.playerScores.enabled && delta) {
      adminData.playerScores.history.unshift({
        id: `${room.id}-${Date.now()}-${seat}-${makeId(4)}`,
        roomId: room.id,
        profileId: player.profileId,
        name: player.name,
        reason,
        delta,
        scoreAfter: player.score,
        createdAt: Date.now()
      });
    }
    changed = true;
  }
  adminData.playerScores.history = adminData.playerScores.history.slice(0, 500);
  if (changed) saveAdminData();
}

function publicAdminData() {
  return {
    scoring: clone(adminData.scoring),
    replay: clone(adminData.replay),
    gameplay: clone(adminData.gameplay),
    playerScores: clone(adminData.playerScores),
    players: Object.entries(adminData.players).map(([id, player]) => ({ id, ...player })),
    replays: adminData.replays.map(({ frames, ...replay }) => ({ ...replay, frameCount: frames.length }))
  };
}

function windName(seat) {
  return winds[seat];
}

function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function clearRoomCleanupTimer(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
}

function connectedHumanCount(room) {
  return room.seats.filter((seat) => seat && !seat.isBot && seat.connected).length;
}

function roomCleanupDeadline(room, now = Date.now()) {
  if (connectedHumanCount(room) === 0) {
    const since = room.emptySince || now;
    return { reason: "房间连续一分钟没有真人玩家，已自动解散。", deadline: since + EMPTY_ROOM_TTL_MS };
  }
  if (room.phase === "ended") {
    return { reason: "牌局结束后三分钟没有操作，房间已自动解散。", deadline: (room.lastActivity || now) + ENDED_ROOM_TTL_MS };
  }
  return null;
}

function dissolveRoom(room, reason) {
  clearRoomTimer(room);
  clearRoomCleanupTimer(room);
  for (const seat of room.seats) {
    if (!seat || seat.isBot) continue;
    const client = clients.get(seat.id);
    if (!client) continue;
    client.roomId = null;
    client.seat = -1;
    sendJson(client.socket, { type: "roomClosed", message: reason });
  }
  rooms.delete(room.id);
}

function sweepExpiredRooms(now = Date.now()) {
  for (const room of [...rooms.values()]) {
    if (connectedHumanCount(room) === 0 && !room.emptySince) {
      room.emptySince = room.lastActivity || now;
    }
    const cleanup = roomCleanupDeadline(room, now);
    if (cleanup && cleanup.deadline <= now) dissolveRoom(room, cleanup.reason);
  }
}

function scheduleRoomCleanup(room) {
  clearRoomCleanupTimer(room);
  const noHumans = connectedHumanCount(room) === 0;
  if (noHumans) room.emptySince ||= Date.now();
  else room.emptySince = null;
  const cleanup = roomCleanupDeadline(room);
  if (!cleanup) return;
  const delay = Math.max(0, cleanup.deadline - Date.now());
  room.cleanupTimer = setTimeout(() => {
    const current = rooms.get(room.id);
    if (current !== room) return;
    const latest = roomCleanupDeadline(room);
    if (!latest) return;
    if (latest.deadline > Date.now()) {
      scheduleRoomCleanup(room);
      return;
    }
    dissolveRoom(room, latest.reason);
  }, delay);
}

function markRoomActivity(room) {
  room.lastActivity = Date.now();
  scheduleRoomCleanup(room);
}

function isRoomHost(room, client) {
  return Boolean(client.profileId && room.hostProfileId === client.profileId);
}

function transferWaitingHost(room) {
  const nextHost = room.seats.find((seat) => seat && !seat.isBot);
  room.hostId = nextHost?.id || null;
  room.hostProfileId = nextHost?.profileId || null;
}

function removeWaitingSeat(room, seatIndex, message) {
  const player = room.seats[seatIndex];
  if (!player) return;
  room.seats[seatIndex] = null;
  if (player.profileId === room.hostProfileId) transferWaitingHost(room);
  addLog(room, message || `${player.name} 离开了房间。`);
  broadcastRoom(room);
  scheduleRoomCleanup(room);
}

function completeRestartVoteIfReady(room) {
  const vote = room.restartVote;
  if (!vote) return false;
  const required = room.seats
    .map((seat, index) => seat && !seat.isBot ? index : -1)
    .filter((seat) => seat >= 0);
  if (!required.every((seat) => vote.approvedSeats.includes(seat))) return false;
  addLog(room, "所有玩家已同意，牌局重新开始。");
  startGame(room);
  return true;
}

function resumeRoomFlow(room) {
  clearRoomTimer(room);
  if (room.phase === "discard" && room.seats[room.currentSeat]?.isBot) {
    room.timer = setTimeout(() => botDiscard(room), 360);
  } else if (room.phase === "claim") {
    scheduleBotClaim(room);
  }
}

function restoreUndoCheckpoint(room, checkpoint) {
  clearRoomTimer(room);
  const currentSeats = room.seats.filter(Boolean);
  Object.assign(room, clone(checkpoint.state));
  for (const player of room.seats) {
    if (!player?.profileId) continue;
    const current = currentSeats.find((entry) => entry.profileId === player.profileId);
    if (!current) continue;
    player.id = current.id;
    player.isBot = current.isBot;
    player.connected = current.connected;
    player.delegated = current.delegated;
  }
  for (const [profileId, profile] of Object.entries(checkpoint.profileScores || {})) {
    adminData.players[profileId] = clone(profile);
  }
  const retainedIds = new Set(checkpoint.scoreHistoryIds || []);
  adminData.playerScores.history = (adminData.playerScores.history || []).filter((entry) => entry.roomId !== room.id || retainedIds.has(entry.id));
  room.undoVote = null;
  room.restartVote = null;
  addLog(room, `全体玩家同意悔棋，已退回“${checkpoint.label}”之前。`);
  saveAdminData();
  resumeRoomFlow(room);
  scheduleRoomCleanup(room);
  broadcastRoom(room);
}

function completeUndoVoteIfReady(room) {
  const vote = room.undoVote;
  if (!vote) return false;
  const required = room.seats
    .map((seat, index) => seat && !seat.isBot ? index : -1)
    .filter((seat) => seat >= 0);
  if (!required.every((seat) => vote.approvedSeats.includes(seat))) return false;
  const checkpoint = room.undoStack.pop();
  if (!checkpoint) {
    room.undoVote = null;
    resumeRoomFlow(room);
    broadcastRoom(room);
    return false;
  }
  restoreUndoCheckpoint(room, checkpoint);
  return true;
}

function requestUndo(room, client) {
  if (client.seat < 0 || room.phase === "waiting" || room.phase === "ended" || room.undoVote || room.restartVote || !room.undoStack?.length) return false;
  clearRoomTimer(room);
  room.undoVote = { requestedBySeat: client.seat, approvedSeats: [client.seat], createdAt: Date.now() };
  addLog(room, `${room.seats[client.seat].name} 发起悔棋，等待其他真人玩家同意。`);
  if (!completeUndoVoteIfReady(room)) broadcastRoom(room);
  return true;
}

function respondUndo(room, client, approved) {
  const vote = room.undoVote;
  if (!vote || client.seat < 0) return false;
  if (!approved) {
    const name = room.seats[client.seat]?.name || "玩家";
    room.undoVote = null;
    addLog(room, `${name} 拒绝悔棋，本次请求已取消。`);
    resumeRoomFlow(room);
    broadcastRoom(room);
    return true;
  }
  if (!vote.approvedSeats.includes(client.seat)) vote.approvedSeats.push(client.seat);
  addLog(room, `${room.seats[client.seat].name} 同意悔棋。`);
  if (!completeUndoVoteIfReady(room)) broadcastRoom(room);
  return true;
}

function delegateSeat(room, seatIndex, reason = "离开") {
  const player = room.seats[seatIndex];
  if (!player || player.isBot) return;
  if ((room.phase === "discard" && room.currentSeat === seatIndex)
    || (room.phase === "claim" && room.pendingClaim?.responders.includes(seatIndex))) clearRoomTimer(room);
  player.id = `bot-${room.id}-${seatIndex}-${makeId(4)}`;
  player.isBot = true;
  player.connected = true;
  player.delegated = true;
  scheduleRoomCleanup(room);
  addLog(room, `${player.name} ${reason}，已由电脑托管。`);
  if (completeUndoVoteIfReady(room)) return;
  if (completeRestartVoteIfReady(room)) return;
  broadcastRoom(room);
  if (room.phase === "discard" && room.currentSeat === seatIndex) {
    room.timer = setTimeout(() => botDiscard(room), 360);
  } else if (room.phase === "claim") {
    scheduleBotClaim(room);
  }
}

function disconnectSeat(room, seatIndex, reason = "掉线") {
  const player = room.seats[seatIndex];
  if (!player || player.isBot) return;
  if (adminData.gameplay.botTakeoverOnDisconnect) {
    delegateSeat(room, seatIndex, reason);
    return;
  }
  if ((room.phase === "discard" && room.currentSeat === seatIndex)
    || (room.phase === "claim" && room.pendingClaim?.responders.includes(seatIndex))) clearRoomTimer(room);
  player.connected = false;
  player.delegated = false;
  room.emptySince = connectedHumanCount(room) === 0 ? (room.emptySince || Date.now()) : null;
  scheduleRoomCleanup(room);
  addLog(room, `${player.name} ${reason}，不会由电脑接管；轮到该玩家时将等待本人重新加入。`);
  broadcastRoom(room);
}

function leaveRoom(client) {
  const room = rooms.get(client.roomId);
  if (!room || client.seat < 0) return;
  const seatIndex = client.seat;
  client.roomId = null;
  client.seat = -1;
  if (room.phase === "waiting") removeWaitingSeat(room, seatIndex);
  else disconnectSeat(room, seatIndex, "离开");
  sendJson(client.socket, { type: "left" });
}

function requestRestart(room, client) {
  if (!isRoomHost(room, client) || room.phase === "waiting") return false;
  if (room.restartVote || room.undoVote) return false;
  room.restartVote = {
    requestedBySeat: client.seat,
    approvedSeats: [client.seat],
    createdAt: Date.now()
  };
  addLog(room, `${room.seats[client.seat].name} 发起重新开局，等待其他玩家同意。`);
  if (!completeRestartVoteIfReady(room)) broadcastRoom(room);
  return true;
}

function respondRestart(room, client, approved) {
  const vote = room.restartVote;
  if (!vote || room.phase === "waiting" || client.seat < 0) return false;
  if (!approved) {
    const name = room.seats[client.seat]?.name || "玩家";
    room.restartVote = null;
    addLog(room, `${name} 拒绝重新开局，本次请求已取消。`);
    broadcastRoom(room);
    return true;
  }
  if (!vote.approvedSeats.includes(client.seat)) vote.approvedSeats.push(client.seat);
  addLog(room, `${room.seats[client.seat].name} 同意重新开局。`);
  if (!completeRestartVoteIfReady(room)) broadcastRoom(room);
  return true;
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
  const viewerIsHost = viewer?.profileId === room.hostProfileId;
  const waitingForReconnect = room.phase === "discard" && !room.seats[room.currentSeat]?.connected
    ? { seats: [room.currentSeat], names: [room.seats[room.currentSeat].name] }
    : room.phase === "claim"
      ? (() => {
        const seats = claim.responders.filter((seat) => !claim.passed.includes(seat) && !room.seats[seat]?.connected);
        return seats.length ? { seats, names: seats.map((seat) => room.seats[seat].name) } : null;
      })()
      : null;
  return {
    version: "3.5",
    roomId: room.id,
    mode: room.mode,
    hostSeat: room.seats.findIndex((seat) => seat?.profileId === room.hostProfileId),
    viewerSeat,
    viewerProfileId: viewer?.profileId || null,
    viewerIsHost,
    phase: room.phase,
    claimStage: claim?.stage || null,
    currentSeat: room.currentSeat,
    waitingForReconnect,
    dealerSeat: room.dealerSeat,
    diceRounds: clone(room.diceRounds || []),
    wallCount: room.wall.length,
    lastDiscard: room.lastDiscard,
    latestDiscardTileId: room.lastDiscard?.tileId || null,
    drawnTileId: viewer?.drawnTileId || null,
    winner: room.winner,
    roundResult: room.roundResult,
    canRon: isResponder && claim.stage === "ron",
    canPong: isResponder && claim.stage === "pong",
    canKong: isResponder && claim.stage === "pong" && claim.kongResponders?.includes(viewerSeat),
    canPass: isResponder,
    canDiscard: viewerTurn,
    canKick: viewerIsHost && room.phase === "waiting",
    canRequestRestart: viewerIsHost && room.phase !== "waiting" && !room.restartVote && !room.undoVote,
    canRequestUndo: room.phase !== "waiting" && room.phase !== "ended" && Boolean(room.undoStack?.length) && !room.undoVote,
    undoVote: room.undoVote ? {
      requestedBySeat: room.undoVote.requestedBySeat,
      approvedSeats: [...room.undoVote.approvedSeats],
      viewerApproved: room.undoVote.approvedSeats.includes(viewerSeat)
    } : null,
    restartVote: room.restartVote ? {
      requestedBySeat: room.restartVote.requestedBySeat,
      approvedSeats: [...room.restartVote.approvedSeats],
      viewerApproved: room.restartVote.approvedSeats.includes(viewerSeat)
    } : null,
    canSelfWin: viewerTurn && evaluateWin(viewer, viewer?.hand || []).valid,
    concealedKongOptions: viewerTurn ? concealedKongOptions(viewer) : [],
    drillOptions: viewerTurn ? drillCompletionOptions(viewer) : [],
    stackOptions: !room.winner && room.phase !== "waiting" ? stackOptions(viewer) : [],
    players: room.seats.map((seat, index) => seat ? {
      seat: index,
      wind: windName(index),
      name: seat.name,
      isBot: seat.isBot,
      delegated: seat.delegated,
      connected: seat.connected,
      score: seat.score,
      roundDelta: seat.roundDelta,
      handCount: seat.hand.length,
      discards: seat.discards,
      melds: seat.melds.map((meld) => snapshotMeld(meld, index === viewerSeat || room.phase === "ended")),
      route: seat.route,
      routeLabel: routeLabel(seat),
      hand: index === viewerSeat || room.winner ? sortedPhysicalHand(seat) : null
    } : null),
    log: room.log
  };
}

function passwordMatches(value) {
  if (!ADMIN_PASSWORD) return false;
  const supplied = Buffer.from(String(value || ""));
  const expected = Buffer.from(ADMIN_PASSWORD);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function numericSetting(value, fallback, minimum = 0, maximum = 999) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

function handleAdminMessage(client, data) {
  if (data.type === "adminLogin") {
    if (!passwordMatches(data.password)) {
      sendJson(client.socket, { type: "adminError", message: "管理者密码不正确。" });
      return true;
    }
    client.adminAuthenticated = true;
    sendJson(client.socket, { type: "adminData", data: publicAdminData() });
    return true;
  }
  if (!String(data.type || "").startsWith("admin")) return false;
  if (!client.adminAuthenticated) {
    sendJson(client.socket, { type: "adminError", message: "管理者身份已失效，请重新输入密码。" });
    return true;
  }
  if (data.type === "adminGet") {
    sendJson(client.socket, { type: "adminData", data: publicAdminData() });
  } else if (data.type === "adminDeleteRoom") {
    const roomId = String(data.roomId || "").trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room) {
      sendJson(client.socket, { type: "adminError", message: "没有找到这个房间。" });
      return true;
    }
    dissolveRoom(room, "管理员已解散房间。");
    sendJson(client.socket, { type: "lobbyRooms", rooms: roomDirectory(client.profileId) });
  } else if (data.type === "adminUpdateScoring") {
    const incoming = data.scoring || {};
    adminData.scoring.dealerBase = numericSetting(incoming.dealerBase, adminData.scoring.dealerBase);
    adminData.scoring.nonDealerBase = numericSetting(incoming.nonDealerBase, adminData.scoring.nonDealerBase);
    adminData.scoring.selfDrawMultiplier = numericSetting(incoming.selfDrawMultiplier, adminData.scoring.selfDrawMultiplier, 1, 20);
    adminData.scoring.discardMultiplier = numericSetting(incoming.discardMultiplier, adminData.scoring.discardMultiplier, 1, 20);
    adminData.scoring.discardPayerOnly = incoming.discardPayerOnly !== false;
    for (const key of Object.keys(defaultPatternPoints)) {
      adminData.scoring.patterns[key] = numericSetting(incoming.patterns?.[key], adminData.scoring.patterns[key]);
    }
    for (const key of ["明杠", "暗杠"]) {
      adminData.scoring.actions[key] = numericSetting(incoming.actions?.[key], adminData.scoring.actions[key]);
    }
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "积分设置已保存。" });
  } else if (data.type === "adminUpdateReplay") {
    adminData.replay.enabled = Boolean(data.enabled);
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "回放设置已保存。" });
  } else if (data.type === "adminUpdateGameplay") {
    adminData.gameplay.botTakeoverOnDisconnect = Boolean(data.botTakeoverOnDisconnect);
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "掉线接管设置已保存。" });
  } else if (data.type === "adminSuggestDiscard") {
    const room = rooms.get(client.roomId);
    const suggestion = room ? recommendDiscard(room, client.seat) : null;
    sendJson(client.socket, suggestion
      ? { type: "adminSuggestion", suggestion }
      : { type: "adminError", message: "当前不是你的出牌回合，暂时无法分析。" });
  } else if (data.type === "adminUpdatePlayerScores") {
    adminData.playerScores.enabled = Boolean(data.enabled);
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "玩家积分记录设置已保存。" });
  } else if (data.type === "adminClearPlayerScoreHistory") {
    adminData.playerScores.history = [];
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "玩家积分明细已清空。" });
  } else if (data.type === "adminGetReplay") {
    const replay = adminData.replays.find((entry) => entry.id === data.replayId);
    sendJson(client.socket, replay ? { type: "adminReplay", replay } : { type: "adminError", message: "没有找到这局回放。" });
  } else if (data.type === "adminDeleteReplay") {
    const replayIndex = adminData.replays.findIndex((entry) => entry.id === String(data.replayId || ""));
    if (replayIndex === -1) {
      sendJson(client.socket, { type: "adminError", message: "没有找到这局回放。" });
      return true;
    }
    adminData.replays.splice(replayIndex, 1);
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "牌局回放已删除。" });
  } else if (data.type === "adminDeletePlayer") {
    const playerId = String(data.playerId || "");
    if (!adminData.players[playerId]) {
      sendJson(client.socket, { type: "adminError", message: "没有找到这个真实玩家。" });
      return true;
    }
    delete adminData.players[playerId];
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "玩家积分记录已删除。" });
  } else if (data.type === "adminRenamePlayer") {
    const playerId = String(data.playerId || "");
    const newName = String(data.name || "").trim().slice(0, 12);
    const player = adminData.players[playerId];
    if (!player || !newName) {
      sendJson(client.socket, { type: "adminError", message: "玩家不存在或新昵称无效。" });
      return true;
    }
    player.name = newName;
    player.updatedAt = Date.now();
    const duplicateId = Object.entries(adminData.players)
      .find(([id, entry]) => id !== playerId && normalizedPlayerName(entry.name) === normalizedPlayerName(newName))?.[0];
    if (duplicateId) {
      const target = adminData.players[duplicateId];
      target.score = (Number(target.score) || 0) + (Number(player.score) || 0);
      target.updatedAt = Date.now();
      adminData.profileAliases[playerId] = duplicateId;
      delete adminData.players[playerId];
      for (const entry of adminData.playerScores.history || []) {
        if (entry.profileId === playerId) entry.profileId = duplicateId;
      }
      for (const room of rooms.values()) {
        for (const seated of room.seats) {
          if (seated?.profileId !== playerId) continue;
          seated.profileId = duplicateId;
          seated.name = target.name;
          seated.score = target.score;
        }
        if (room.hostProfileId === playerId) room.hostProfileId = duplicateId;
        broadcastRoom(room);
      }
      for (const connectedClient of clients.values()) {
        if (connectedClient.profileId !== playerId) continue;
        connectedClient.profileId = duplicateId;
        connectedClient.name = target.name;
      }
      saveAdminData();
      sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "昵称与已有玩家相同，记录已自动合并。" });
      return true;
    }
    for (const room of rooms.values()) {
      const seated = room.seats.find((entry) => entry?.profileId === playerId);
      if (seated) seated.name = newName;
      if (seated) broadcastRoom(room);
    }
    for (const connectedClient of clients.values()) {
      if (connectedClient.profileId === playerId) connectedClient.name = newName;
    }
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "玩家昵称已重命名。" });
  } else if (data.type === "adminMergePlayers") {
    const sourceId = String(data.sourcePlayerId || "");
    const targetId = String(data.targetPlayerId || "");
    const source = adminData.players[sourceId];
    const target = adminData.players[targetId];
    if (!source || !target || sourceId === targetId) {
      sendJson(client.socket, { type: "adminError", message: "请选择两个不同的有效玩家记录。" });
      return true;
    }
    const conflict = [...rooms.values()].some((room) => {
      const profileIds = room.seats.filter(Boolean).map((seat) => seat.profileId);
      return profileIds.includes(sourceId) && profileIds.includes(targetId);
    });
    if (conflict) {
      sendJson(client.socket, { type: "adminError", message: "这两个玩家当前同时在同一房间，暂时不能合并。" });
      return true;
    }
    target.score = (Number(target.score) || 0) + (Number(source.score) || 0);
    target.updatedAt = Date.now();
    delete adminData.players[sourceId];
    adminData.profileAliases[sourceId] = targetId;
    for (const room of rooms.values()) {
      let changed = false;
      for (const seated of room.seats) {
        if (!seated || ![sourceId, targetId].includes(seated.profileId)) continue;
        seated.profileId = targetId;
        seated.name = target.name;
        seated.score = target.score;
        changed = true;
      }
      if (room.hostProfileId === sourceId) room.hostProfileId = targetId;
      if (changed) broadcastRoom(room);
    }
    for (const connectedClient of clients.values()) {
      if (connectedClient.profileId !== sourceId) continue;
      connectedClient.profileId = targetId;
      connectedClient.name = target.name;
    }
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "玩家记录已合并，来源积分已并入保留账号。" });
  } else if (data.type === "adminUpdatePlayer" || data.type === "adminResetPlayer") {
    const player = adminData.players[String(data.playerId || "")];
    if (!player) {
      sendJson(client.socket, { type: "adminError", message: "没有找到这个真实玩家。" });
      return true;
    }
    player.score = data.type === "adminResetPlayer" ? 0 : numericSetting(data.score, player.score, -999999, 999999);
    player.updatedAt = Date.now();
    for (const room of rooms.values()) {
      const seated = room.seats.find((entry) => entry?.profileId === data.playerId && !entry.isBot);
      if (seated) seated.score = player.score;
      if (seated) broadcastRoom(room);
    }
    saveAdminData();
    sendJson(client.socket, { type: "adminData", data: publicAdminData(), message: "玩家积分已更新。" });
  }
  return true;
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
    if (handleAdminMessage(client, data)) return;
    if (data.type === "listRooms") {
      const profileId = String(data.profileId || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
      sendJson(client.socket, { type: "lobbyRooms", rooms: roomDirectory(profileId) });
      return;
    }
    if (data.type === "create") {
      client.name = String(data.name || "玩家").slice(0, 12);
      client.profileId = String(data.profileId || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || client.id;
      client.profileId = resolveProfileId(client.profileId, client.name);
      createRoom(client, data.mode === "solo" ? "solo" : "online");
      return;
    }
    if (data.type === "join") {
      client.name = String(data.name || "玩家").slice(0, 12);
      client.profileId = String(data.profileId || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || client.id;
      client.profileId = resolveProfileId(client.profileId, client.name);
      const room = rooms.get(String(data.roomId || "").trim().toUpperCase());
      if (!room) return sendJson(client.socket, { type: "error", message: "没有找到这个房间。" });
      if (reconnectClient(room, client)) return;
      if (room.seats.some((seat) => seat?.profileId === client.profileId)) return sendJson(client.socket, { type: "error", message: "这个玩家已经在房间中。" });
      if (room.phase !== "waiting") return sendJson(client.socket, { type: "error", message: "牌局已经开始，只有原座位玩家可以重新加入。" });
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
    markRoomActivity(room);
    if (room.undoVote && !["respondUndo", "leave"].includes(data.type)) return;
    if (data.type === "addBots" && isRoomHost(room, client) && room.phase === "waiting") {
      fillBots(room);
      broadcastRoom(room);
    } else if (data.type === "start" && isRoomHost(room, client) && room.phase === "waiting") {
      startGame(room);
    } else if (data.type === "kick" && isRoomHost(room, client) && room.phase === "waiting") {
      const targetSeat = Number(data.seat);
      const target = room.seats[targetSeat];
      if (!target || target.isBot || target.profileId === room.hostProfileId) return;
      const targetClient = clients.get(target.id);
      if (targetClient) {
        targetClient.roomId = null;
        targetClient.seat = -1;
        sendJson(targetClient.socket, { type: "kicked", message: "房主已将你移出房间。" });
      }
      removeWaitingSeat(room, targetSeat, `${target.name} 被房主移出房间。`);
    } else if (data.type === "discard") {
      discardTile(room, client.seat, String(data.tileId || ""), String(data.tile || ""));
    } else if (data.type === "declareDrill") {
      declareCompletedDrill(room, client.seat, String(data.key || ""));
    } else if (data.type === "declarePung") {
      declarePungStack(room, client.seat, String(data.key || ""));
    } else if (data.type === "concealedKong") {
      declareConcealedKong(room, client.seat, String(data.key || ""));
    } else if (data.type === "selfWin" && room.currentSeat === client.seat) {
      const player = room.seats[client.seat];
      endWithWinner(room, client.seat, "自摸", player.lastDrawnTile, null, player.drewAfterKong);
    } else if (data.type === "ron") {
      claimRon(room, client.seat);
    } else if (data.type === "pong") {
      claimPong(room, client.seat);
    } else if (data.type === "kong") {
      claimKong(room, client.seat);
    } else if (data.type === "pass") {
      passClaim(room, client.seat);
    } else if (data.type === "requestRestart") {
      requestRestart(room, client);
    } else if (data.type === "respondRestart") {
      respondRestart(room, client, Boolean(data.approved));
    } else if (data.type === "requestUndo") {
      requestUndo(room, client);
    } else if (data.type === "respondUndo") {
      respondUndo(room, client, Boolean(data.approved));
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

  const client = {
    id: crypto.randomUUID(), socket, name: "玩家", profileId: null,
    roomId: null, seat: -1, adminAuthenticated: false
  };
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
      if (room.phase === "waiting") removeWaitingSeat(room, client.seat, `${seat.name} 断开连接并让出了座位。`);
      else disconnectSeat(room, client.seat, "断开连接");
    }
  });
});

const roomSweepTimer = setInterval(() => sweepExpiredRooms(), 5_000);
roomSweepTimer.unref?.();

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
  concealedKongOptions,
  rollForDealer,
  recommendDiscard,
  makePlayer,
  delegatedSeatForProfile,
  roomDirectory,
  roomCleanupDeadline,
  sweepExpiredRooms,
  rooms
};
