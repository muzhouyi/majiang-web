const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const rooms = new Map();
const clients = new Map();

const tileTypes = (() => {
  const tiles = [];
  for (const suit of ["m", "p", "s"]) {
    for (let n = 1; n <= 9; n += 1) tiles.push(`${suit}${n}`);
  }
  for (const honor of ["E", "S", "W", "N", "C", "F", "P"]) tiles.push(honor);
  return tiles;
})();

const tileIndex = new Map(tileTypes.map((tile, index) => [tile, index]));
const winds = ["东", "南", "西", "北"];
const botNames = ["阿庄", "小竹", "南风", "青雀"];

function makeId(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < length; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

function makeDeck() {
  const deck = [];
  for (const tile of tileTypes) {
    for (let copy = 0; copy < 4; copy += 1) deck.push(tile);
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
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

function canWin(hand) {
  return canStandardWin(hand) || isSevenPairs(hand) || isThirteenBuKaoLite(hand);
}

function canStandardWin(hand) {
  if (hand.length % 3 !== 2) return false;
  const counts = tileCounts(hand);
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] < 2) continue;
    counts[i] -= 2;
    if (canFormSets(counts)) {
      counts[i] += 2;
      return true;
    }
    counts[i] += 2;
  }
  return false;
}

function canFormSets(counts) {
  const first = counts.findIndex((count) => count > 0);
  if (first === -1) return true;

  if (counts[first] >= 3) {
    counts[first] -= 3;
    if (canFormSets(counts)) {
      counts[first] += 3;
      return true;
    }
    counts[first] += 3;
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
      if (canFormSets(counts)) {
        counts[first] += 1;
        counts[second] += 1;
        counts[third] += 1;
        return true;
      }
      counts[first] += 1;
      counts[second] += 1;
      counts[third] += 1;
    }
  }
  return false;
}

function isSevenPairs(hand) {
  if (hand.length !== 14) return false;
  return tileCounts(hand).every((count) => count === 0 || count === 2 || count === 4);
}

function isLuxurySevenPairs(hand) {
  return isSevenPairs(hand) && tileCounts(hand).some((count) => count === 4);
}

function isThirteenBuKaoLite(hand) {
  if (hand.length !== 14) return false;
  const required = ["m1", "m9", "p1", "p9", "s1", "s9", "E", "S", "W", "N", "C", "F", "P"];
  const counts = tileCounts(hand);
  const hasAll = required.every((tile) => counts[tileIndex.get(tile)] >= 1);
  const pairCount = counts.filter((count) => count === 2).length;
  const overCount = counts.some((count) => count > 2);
  return hasAll && pairCount === 1 && !overCount;
}

function isPureOneSuit(hand) {
  const suited = hand.filter((tile) => ["m", "p", "s"].includes(tile[0]));
  if (!suited.length || suited.length !== hand.length) return false;
  return new Set(suited.map((tile) => tile[0])).size === 1;
}

function hasOneDragon(hand) {
  for (const suit of ["m", "p", "s"]) {
    let ok = true;
    for (let n = 1; n <= 9; n += 1) {
      if (!hand.includes(`${suit}${n}`)) ok = false;
    }
    if (ok) return true;
  }
  return false;
}

function isAllTriplets(hand) {
  if (!canStandardWin(hand)) return false;
  const counts = tileCounts(hand);
  let pairs = 0;
  for (const count of counts) {
    if (count === 1) return false;
    if (count === 2) pairs += 1;
  }
  return pairs === 1;
}

function isTerminalEdgeWait(hand, winningTile) {
  if (!winningTile || !["m", "p", "s"].includes(winningTile[0])) return false;
  const suit = winningTile[0];
  const number = Number(winningTile[1]);
  const rest = [...hand];
  const index = rest.indexOf(winningTile);
  if (index >= 0) rest.splice(index, 1);
  if (number === 3) return rest.includes(`${suit}1`) && rest.includes(`${suit}2`);
  if (number === 7) return rest.includes(`${suit}8`) && rest.includes(`${suit}9`);
  return false;
}

function calculateResult(room, winnerSeat, method, winningTile, fromSeat) {
  const winner = room.seats[winnerSeat];
  const hand = sortedHand(winner.hand);
  const base = winnerSeat === 0 ? 2 : 1;
  const items = [{ name: winnerSeat === 0 ? "庄家底分" : "闲家底分", points: base }];
  let bonus = 0;

  function add(name, points) {
    bonus += points;
    items.push({ name, points });
  }

  if (isPureOneSuit(hand)) add("清一色", 8);
  if (isLuxurySevenPairs(hand)) add("豪华七对", 6);
  else if (isSevenPairs(hand)) add("七对", 4);
  if (isAllTriplets(hand)) add("碰碰胡", 2);
  if (hasOneDragon(hand)) add("一条龙", 4);
  if (winningTile && ["m5", "p5", "s5"].includes(winningTile)) add("捉五魁", 2);
  if (isTerminalEdgeWait(hand, winningTile)) {
    add("三边/边张（暂定）", 4);
    add("三钻（暂定）", 2);
  }
  if (isThirteenBuKaoLite(hand)) add("十三不靠（暂定）", 8);

  let total = base + bonus;
  if (method === "自摸") {
    total *= 2;
    items.push({ name: "自摸翻番", points: total });
  }

  const deltas = [0, 0, 0, 0];
  if (method === "自摸") {
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat === winnerSeat) continue;
      deltas[seat] -= total;
      deltas[winnerSeat] += total;
    }
  } else {
    const payer = typeof fromSeat === "number" ? fromSeat : room.pendingRon?.fromSeat;
    const pay = total * 3;
    deltas[payer] -= pay;
    deltas[winnerSeat] += pay;
    items.push({ name: "点炮包三家", points: pay });
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
    base,
    total,
    deltas,
    items,
    text: `${winner.name} ${method}胡牌，结算 ${method === "自摸" ? total : total * 3} 分`
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
    pendingRon: null,
    log: [],
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
  room.seats[seat] = {
    id: client.id,
    name: client.name || `玩家${seat + 1}`,
    isBot: false,
    connected: true,
    score: 0,
    roundDelta: 0,
    hand: [],
    discards: [],
    drawnTile: null,
    ready: true
  };
  client.roomId = room.id;
  client.seat = seat;
  addLog(room, `${room.seats[seat].name} 坐到了${windName(seat)}位。`);
  return seat;
}

function fillBots(room) {
  for (let seat = 0; seat < 4; seat += 1) {
    if (!room.seats[seat]) {
      room.seats[seat] = {
        id: `bot-${room.id}-${seat}`,
        name: botNames[seat],
        isBot: true,
        connected: true,
        score: 0,
        roundDelta: 0,
        hand: [],
        discards: [],
        drawnTile: null,
        ready: true
      };
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
  room.wall = makeDeck();
  room.currentSeat = 0;
  room.phase = "playing";
  room.lastDiscard = null;
  room.winner = null;
  room.roundResult = null;
  room.pendingRon = null;
  for (const seat of room.seats) {
    seat.hand = [];
    seat.discards = [];
    seat.drawnTile = null;
    seat.roundDelta = 0;
  }

  for (let round = 0; round < 13; round += 1) {
    for (const seat of room.seats) seat.hand.push(room.wall.pop());
  }
  addLog(room, "牌局开始，东风位先摸牌。");
  drawForCurrent(room);
}

function drawForCurrent(room) {
  if (room.winner) return;
  const player = room.seats[room.currentSeat];
  const tile = room.wall.pop();
  if (!tile) {
    room.phase = "ended";
    room.winner = { type: "draw", text: "荒庄，牌墙摸完了。" };
    room.roundResult = { text: "荒庄，本局不结算。", deltas: [0, 0, 0, 0], items: [] };
    addLog(room, room.winner.text);
    broadcastRoom(room);
    return;
  }
  player.hand.push(tile);
  player.drawnTile = tile;
  room.phase = "discard";
  room.lastDiscard = null;
  addLog(room, `${player.name} 摸牌。`);

  if (canWin(player.hand) && player.isBot) {
    endWithWinner(room, room.currentSeat, "自摸", tile, null);
    return;
  }

  broadcastRoom(room);
  if (player.isBot) {
    room.timer = setTimeout(() => botDiscard(room), 650 + Math.random() * 500);
  }
}

function discardTile(room, seatIndex, tile) {
  if (room.winner || room.phase !== "discard" || room.currentSeat !== seatIndex) return;
  const player = room.seats[seatIndex];
  const index = player.hand.indexOf(tile);
  if (index === -1) return;

  const [discarded] = player.hand.splice(index, 1);
  player.drawnTile = null;
  player.discards.push(discarded);
  room.lastDiscard = { tile: discarded, fromSeat: seatIndex };
  addLog(room, `${player.name} 打出一张牌。`);

  const responders = [];
  for (let seat = 0; seat < 4; seat += 1) {
    if (seat === seatIndex) continue;
    if (canWin([...room.seats[seat].hand, discarded])) responders.push(seat);
  }

  if (responders.length > 0) {
    room.phase = "ron";
    room.pendingRon = { tile: discarded, fromSeat: seatIndex, responders, passed: [] };
    broadcastRoom(room);
    const botWinner = responders.find((seat) => room.seats[seat].isBot);
    if (botWinner !== undefined) {
      room.timer = setTimeout(() => endWithWinner(room, botWinner, "点炮", discarded, seatIndex), 650);
    }
    return;
  }

  nextTurn(room);
}

function nextTurn(room) {
  room.pendingRon = null;
  room.currentSeat = (room.currentSeat + 1) % 4;
  drawForCurrent(room);
}

function passRon(room, seat) {
  if (!room.pendingRon || !room.pendingRon.responders.includes(seat)) return;
  if (!room.pendingRon.passed.includes(seat)) room.pendingRon.passed.push(seat);
  const allPassed = room.pendingRon.responders.every((candidate) => room.pendingRon.passed.includes(candidate));
  if (allPassed) nextTurn(room);
  else broadcastRoom(room);
}

function claimRon(room, seat) {
  if (!room.pendingRon || !room.pendingRon.responders.includes(seat)) return;
  const tile = room.pendingRon.tile;
  const fromSeat = room.pendingRon.fromSeat;
  room.seats[seat].hand.push(tile);
  endWithWinner(room, seat, "点炮", tile, fromSeat);
}

function endWithWinner(room, seat, method, winningTile, fromSeat) {
  clearRoomTimer(room);
  const player = room.seats[seat];
  room.phase = "ended";
  room.pendingRon = null;
  room.roundResult = calculateResult(room, seat, method, winningTile, fromSeat);
  room.winner = {
    seat,
    name: player.name,
    method,
    text: `${player.name} ${method}胡牌！`
  };
  addLog(room, room.roundResult.text);
  broadcastRoom(room);
}

function botDiscard(room) {
  if (room.winner || room.phase !== "discard") return;
  const player = room.seats[room.currentSeat];
  if (!player || !player.isBot) return;
  const tile = chooseBotDiscard(player.hand);
  discardTile(room, room.currentSeat, tile);
}

function chooseBotDiscard(hand) {
  const counts = new Map();
  for (const tile of hand) counts.set(tile, (counts.get(tile) || 0) + 1);
  const candidates = sortedHand(hand).map((tile) => {
    const suit = tile[0];
    const number = Number(tile[1]);
    let score = counts.get(tile) > 1 ? 4 : 0;
    if (!["m", "p", "s"].includes(suit)) score += 3;
    else {
      if (number === 1 || number === 9) score += 2;
      if (hand.includes(`${suit}${number - 1}`) || hand.includes(`${suit}${number + 1}`)) score -= 2;
      if (hand.includes(`${suit}${number - 2}`) || hand.includes(`${suit}${number + 2}`)) score -= 1;
    }
    return { tile, score: score + Math.random() };
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].tile;
}

function addLog(room, text) {
  room.log.unshift({ time: Date.now(), text });
  room.log = room.log.slice(0, 18);
}

function windName(seat) {
  return winds[seat];
}

function clearRoomTimer(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
}

function roomSnapshot(room, viewerSeat) {
  return {
    roomId: room.id,
    mode: room.mode,
    hostSeat: room.seats.findIndex((seat) => seat && seat.id === room.hostId),
    viewerSeat,
    phase: room.phase,
    currentSeat: room.currentSeat,
    wallCount: room.wall.length,
    lastDiscard: room.lastDiscard,
    winner: room.winner,
    roundResult: room.roundResult,
    canRon: Boolean(room.pendingRon && room.pendingRon.responders.includes(viewerSeat) && !room.pendingRon.passed.includes(viewerSeat)),
    canDiscard: room.phase === "discard" && room.currentSeat === viewerSeat && !room.winner,
    canSelfWin: room.phase === "discard" && room.currentSeat === viewerSeat && canWin(room.seats[viewerSeat]?.hand || []),
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
      hand: index === viewerSeat || room.winner ? sortedHand(seat.hand) : null
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
  const header = [];
  header.push(0x81);
  if (data.length < 126) {
    header.push(data.length);
  } else if (data.length < 65536) {
    header.push(126, (data.length >> 8) & 255, data.length & 255);
  } else {
    header.push(127, 0, 0, 0, 0, (data.length >> 24) & 255, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255);
  }
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
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
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

    const room = rooms.get(client.roomId);
    if (!room) return;

    if (data.type === "addBots" && client.id === room.hostId && room.phase === "waiting") {
      fillBots(room);
      broadcastRoom(room);
    } else if (data.type === "start" && client.id === room.hostId && room.phase === "waiting") {
      startGame(room);
    } else if (data.type === "discard") {
      discardTile(room, client.seat, data.tile);
    } else if (data.type === "selfWin" && room.currentSeat === client.seat && canWin(room.seats[client.seat].hand)) {
      endWithWinner(room, client.seat, "自摸", room.seats[client.seat].drawnTile, null);
    } else if (data.type === "ron") {
      claimRon(room, client.seat);
    } else if (data.type === "pass") {
      passRon(room, client.seat);
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
    res.writeHead(200, { "Content-Type": contentType(filePath) });
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
    if (frame.close) {
      socket.end();
      return;
    }
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

server.listen(PORT, () => {
  console.log(`Mahjong web game running at http://localhost:${PORT}`);
});
