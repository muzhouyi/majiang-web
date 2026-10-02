const tileLabels = {
  m1: "一万", m2: "二万", m3: "三万", m4: "四万", m5: "五万", m6: "六万", m7: "七万", m8: "八万", m9: "九万",
  p1: "一筒", p2: "二筒", p3: "三筒", p4: "四筒", p5: "五筒", p6: "六筒", p7: "七筒", p8: "八筒", p9: "九筒",
  s1: "一条", s2: "二条", s3: "三条", s4: "四条", s5: "五条", s6: "六条", s7: "七条", s8: "八条", s9: "九条",
  E: "东风", S: "南风", W: "西风", N: "北风", C: "红中", F: "发财", P: "白板"
};

const wanNumbers = ["", "一", "二", "三", "四", "伍", "六", "七", "八", "九"];

let socket;
let state = null;
let toast = "";
let name = localStorage.getItem("majiang:name") || `玩家${Math.floor(Math.random() * 90) + 10}`;

const app = document.querySelector("#app");

function connect() {
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "state") {
      state = payload.state;
      toast = "";
      render();
    } else if (payload.type === "error") {
      toast = payload.message;
      render();
    }
  });
  socket.addEventListener("close", () => {
    toast = "连接断开，正在重连...";
    render();
    setTimeout(connect, 1200);
  });
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function relativeSeat(seat) {
  const delta = (seat - state.viewerSeat + 4) % 4;
  return ["bottom", "right", "top", "left"][delta];
}

function tileKind(tile) {
  if (!tile) return "back";
  if (tile.startsWith("m")) return "wan";
  if (tile.startsWith("p")) return "pin";
  if (tile.startsWith("s")) return "suo";
  return "honor";
}

function renderTile(tile, options = {}) {
  const tag = options.clickable ? "button" : "span";
  const attrs = options.clickable
    ? `type="button" data-discard="${tile}" aria-label="打出${tileLabels[tile] || tile}"`
    : `role="img" aria-label="${tileLabels[tile] || tile}"`;
  return `
    <${tag} class="tile tile-${tileKind(tile)} ${options.mini ? "tile-mini" : ""} ${options.clickable ? "tile-clickable" : ""}" ${attrs}>
      ${tileArt(tile)}
    </${tag}>
  `;
}

function renderBackTiles(count) {
  return Array.from({ length: count }, () => `<span class="tile-back" aria-hidden="true"></span>`).join("");
}

function renderDiscards(discards) {
  if (!discards.length) return `<span class="empty-discard">未出牌</span>`;
  return discards.map((tile) => renderTile(tile, { mini: true })).join("");
}

function pinDot(x, y, color = "#1f1f1f", scale = 1) {
  const r = 6.3 * scale;
  return `
    <g class="pin-dot">
      <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="${2.1 * scale}"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.58}" fill="none" stroke="${color}" stroke-width="${1.5 * scale}"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.2}" fill="${color}"/>
    </g>
  `;
}

function tilePositions(number) {
  const map = {
    1: [[32, 52]],
    2: [[24, 35], [40, 69]],
    3: [[24, 30], [32, 52], [40, 74]],
    4: [[24, 31], [40, 31], [24, 73], [40, 73]],
    5: [[24, 30], [40, 30], [32, 52], [24, 74], [40, 74]],
    6: [[24, 28], [40, 28], [24, 52], [40, 52], [24, 76], [40, 76]],
    7: [[24, 24], [40, 24], [32, 40], [24, 56], [40, 56], [24, 78], [40, 78]],
    8: [[24, 23], [40, 23], [24, 43], [40, 43], [24, 63], [40, 63], [24, 83], [40, 83]],
    9: [[20, 24], [32, 24], [44, 24], [20, 52], [32, 52], [44, 52], [20, 80], [32, 80], [44, 80]]
  };
  return map[number] || [];
}

function pinArt(number) {
  if (number === 1) {
    return `
      <circle cx="32" cy="52" r="17" fill="none" stroke="#1c6d52" stroke-width="3.8"/>
      <circle cx="32" cy="52" r="12" fill="none" stroke="#bd2c2c" stroke-width="2.2"/>
      <circle cx="32" cy="52" r="7" fill="none" stroke="#1f1f1f" stroke-width="2.2"/>
      <circle cx="32" cy="52" r="2.8" fill="#1f1f1f"/>
    `;
  }
  const colors = ["#1f1f1f", "#bd2c2c", "#1c6d52"];
  return tilePositions(number).map(([x, y], i) => {
    const centerRed = number === 5 && i === 2;
    return pinDot(x, y, centerRed ? "#bd2c2c" : colors[i % colors.length], number >= 8 ? 0.78 : 0.9);
  }).join("");
}

function bamboo(x, y, color = "#1b7659", scale = 1) {
  const h = 16 * scale;
  const w = 5 * scale;
  return `
    <g class="bamboo" stroke="${color}" stroke-width="${3.4 * scale}" stroke-linecap="round" fill="none">
      <path d="M${x} ${y - h / 2}v${h}"/>
      <path d="M${x - w} ${y - h * 0.18}h${w * 2}"/>
      <path d="M${x - w} ${y + h * 0.18}h${w * 2}"/>
    </g>
  `;
}

function birdArt() {
  return `
    <g class="bird-art" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 62c11-2 20-13 21-27 8 8 9 20 1 31-6 8-15 10-22 7" stroke="#1f1f1f" stroke-width="3.3"/>
      <path d="M26 45c-8 5-10 13-6 24" stroke="#1b7659" stroke-width="3"/>
      <path d="M41 32l10-6-5 12" stroke="#bd2c2c" stroke-width="2.6"/>
      <circle cx="38" cy="31" r="2.2" fill="#1f1f1f" stroke="none"/>
      <path d="M23 75c-6 3-10 6-13 11M28 77c-4 5-7 8-11 13" stroke="#1b7659" stroke-width="2.6"/>
      <path d="M18 61c-5-5-7-10-6-16" stroke="#bd2c2c" stroke-width="2.6"/>
    </g>
  `;
}

function bambooArt(number) {
  if (number === 1) return birdArt();
  return tilePositions(number).map(([x, y], i) => {
    const redAccent = number >= 5 && (i === 2 || i === 5);
    return bamboo(x, y, redAccent ? "#bd2c2c" : "#1b7659", number >= 8 ? 0.78 : 0.9);
  }).join("");
}

function wanArt(number) {
  return `
    <text class="wan-number" x="32" y="36" text-anchor="middle">${wanNumbers[number]}</text>
    <text class="wan-mark" x="32" y="78" text-anchor="middle">萬</text>
  `;
}

function honorArt(tile) {
  if (tile === "P") {
    return `
      <rect x="19" y="24" width="26" height="56" rx="1.5" fill="none" stroke="#1f1f1f" stroke-width="4.2"/>
      <rect x="25" y="34" width="14" height="36" fill="none" stroke="#1f1f1f" stroke-width="1.9"/>
    `;
  }
  const glyphs = { E: "東", S: "南", W: "西", N: "北", C: "中", F: "發" };
  const className = tile === "C" ? "honor-red" : tile === "F" ? "honor-green" : "honor-black";
  return `<text class="honor-glyph ${className}" x="32" y="70" text-anchor="middle">${glyphs[tile]}</text>`;
}

function tileArt(tile) {
  if (!tile) return "";
  const kind = tileKind(tile);
  const number = Number(tile[1]);
  let inner = "";
  if (kind === "pin") inner = pinArt(number);
  else if (kind === "suo") inner = bambooArt(number);
  else if (kind === "wan") inner = wanArt(number);
  else inner = honorArt(tile);

  return `
    <svg class="tile-face" viewBox="0 0 64 104" aria-hidden="true">
      <defs>
        <linearGradient id="tileFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#fffdf4"/>
          <stop offset="1" stop-color="#f4e6c9"/>
        </linearGradient>
      </defs>
      <rect class="tile-side-fill" x="5" y="8" width="55" height="92" rx="7"/>
      <rect class="tile-body" x="3" y="3" width="55" height="91" rx="7"/>
      <rect class="tile-inner" x="8" y="8" width="45" height="80" rx="3"/>
      ${inner}
    </svg>
  `;
}

function scoreClass(value) {
  if (value > 0) return "score-up";
  if (value < 0) return "score-down";
  return "";
}

function renderLobby() {
  app.innerHTML = `
    <section class="lobby">
      <div class="brand-panel">
        <div class="brand-mark">${tileArt("C")}</div>
        <div>
          <p class="eyebrow">东光/沧州规则试做版 · v1.2</p>
          <h1>青桌麻将</h1>
          <p class="lede">牌面按真实麻将图标重画：万子、筒子、条子、风牌、箭牌都采用参考图里的视觉语言，手机端继续优先保证手牌操作空间。</p>
        </div>
      </div>

      <form class="join-panel" id="lobbyForm">
        <label>
          昵称
          <input id="nameInput" maxlength="12" value="${escapeHtml(name)}" />
        </label>
        <label>
          房间号
          <input id="roomInput" maxlength="6" placeholder="输入好友给你的房间号" />
        </label>
        ${toast ? `<p class="toast">${escapeHtml(toast)}</p>` : ""}
        <div class="lobby-actions">
          <button class="primary" type="button" id="soloBtn">单人开局</button>
          <button type="button" id="createBtn">创建联机房</button>
          <button type="submit">加入房间</button>
        </div>
      </form>
    </section>
  `;

  document.querySelector("#nameInput").addEventListener("input", (event) => {
    name = event.target.value.trim() || "玩家";
    localStorage.setItem("majiang:name", name);
  });
  document.querySelector("#soloBtn").addEventListener("click", () => send({ type: "create", mode: "solo", name }));
  document.querySelector("#createBtn").addEventListener("click", () => send({ type: "create", mode: "online", name }));
  document.querySelector("#lobbyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const roomId = document.querySelector("#roomInput").value.trim().toUpperCase();
    if (roomId) send({ type: "join", roomId, name });
  });
}

function renderGame() {
  const self = state.players[state.viewerSeat];
  const seats = state.players.filter(Boolean);
  app.innerHTML = `
    <section class="game">
      <header class="topbar">
        <div>
          <p class="eyebrow">房间 ${state.roomId} · ${state.mode === "solo" ? "单人局" : "联机房"}</p>
          <h1>${gameTitle()}</h1>
        </div>
        <div class="table-stats">
          <span>牌墙 ${state.wallCount}</span>
          <span>东光/沧州暂定积分</span>
        </div>
      </header>

      <section class="score-strip">
        ${seats.map(renderScore).join("")}
      </section>

      <div class="table">
        <div class="table-center">
          <div class="round-disc">
            <strong>${state.winner ? "胡" : state.phase === "ron" ? "听" : state.phase === "waiting" ? "等" : "摸"}</strong>
            <span>${centerText()}</span>
          </div>
          ${state.lastDiscard ? `<div class="last-discard"><span>上张</span>${renderTile(state.lastDiscard.tile, { mini: true })}</div>` : ""}
        </div>
        ${seats.map(renderSeat).join("")}
      </div>

      <aside class="side-panel">
        <section class="room-card">
          <div class="room-code">
            <span>房间号</span>
            <strong>${state.roomId}</strong>
            <button id="copyBtn" type="button">复制</button>
          </div>
          <div class="action-row">
            ${state.phase === "waiting" && state.viewerSeat === state.hostSeat ? `<button id="addBotsBtn" type="button">补电脑</button><button class="primary" id="startBtn" type="button">开始</button>` : ""}
            ${state.winner && state.viewerSeat === state.hostSeat ? `<button class="primary" id="restartBtn" type="button">再来一局</button>` : ""}
            ${state.canSelfWin ? `<button class="gold" id="selfWinBtn" type="button">自摸胡</button>` : ""}
            ${state.canRon ? `<button class="gold" id="ronBtn" type="button">胡这张</button><button id="passBtn" type="button">过</button>` : ""}
          </div>
          ${toast ? `<p class="toast">${escapeHtml(toast)}</p>` : ""}
        </section>

        ${renderResult()}

        <section class="log-card">
          <h2>牌局记录</h2>
          <ol>${state.log.map((entry) => `<li>${escapeHtml(entry.text)}</li>`).join("")}</ol>
        </section>
      </aside>

      <section class="hand-tray">
        <div class="hand-title">
          <div>
            <p class="eyebrow">${self.wind}位 · ${escapeHtml(self.name)}</p>
            <h2>${handHint()}</h2>
          </div>
          <span class="hand-count">${self.hand?.length || 0} 张</span>
        </div>
        <div class="hand">${(self.hand || []).map((tile) => renderTile(tile, { clickable: state.canDiscard })).join("")}</div>
      </section>
    </section>
  `;

  app.querySelectorAll("[data-discard]").forEach((button) => {
    button.addEventListener("click", () => send({ type: "discard", tile: button.dataset.discard }));
  });
  app.querySelector("#copyBtn")?.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(state.roomId);
    toast = "房间号已复制。";
    render();
  });
  app.querySelector("#addBotsBtn")?.addEventListener("click", () => send({ type: "addBots" }));
  app.querySelector("#startBtn")?.addEventListener("click", () => send({ type: "start" }));
  app.querySelector("#restartBtn")?.addEventListener("click", () => send({ type: "restart" }));
  app.querySelector("#selfWinBtn")?.addEventListener("click", () => send({ type: "selfWin" }));
  app.querySelector("#ronBtn")?.addEventListener("click", () => send({ type: "ron" }));
  app.querySelector("#passBtn")?.addEventListener("click", () => send({ type: "pass" }));
}

function gameTitle() {
  if (state.phase === "waiting") return "等待开局";
  if (state.winner) return "牌局结束";
  return `${state.players[state.currentSeat]?.name || ""} 行牌中`;
}

function centerText() {
  if (state.winner) return state.roundResult?.text || state.winner.text;
  if (state.phase === "ron") return "有人可胡这张牌";
  if (state.phase === "waiting") return "补齐玩家后开始";
  return "摸打进行中";
}

function handHint() {
  if (state.canDiscard) return "点一张牌打出";
  if (state.canRon) return "可以胡牌或选择过";
  if (state.winner) return "本局结算完成";
  return "等待其他玩家";
}

function renderScore(player) {
  return `
    <article class="score-card ${player.seat === state.viewerSeat ? "score-self" : ""} ${state.currentSeat === player.seat && !state.winner ? "score-active" : ""}">
      <span class="wind">${player.wind}</span>
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <em>${player.isBot ? "电脑" : "玩家"}</em>
      </div>
      <b>${player.score}</b>
      <small class="${scoreClass(player.roundDelta)}">${player.roundDelta > 0 ? "+" : ""}${player.roundDelta}</small>
    </article>
  `;
}

function renderResult() {
  if (!state.roundResult?.items?.length) return "";
  return `
    <section class="result-card">
      <h2>本局结算</h2>
      <ul>${state.roundResult.items.map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>${item.points}</strong></li>`).join("")}</ul>
    </section>
  `;
}

function renderSeat(player) {
  const position = relativeSeat(player.seat);
  const active = state.currentSeat === player.seat && !state.winner;
  const isSelf = player.seat === state.viewerSeat;
  return `
    <section class="seat seat-${position} ${active ? "seat-active" : ""}">
      <div class="seat-head">
        <span class="wind">${player.wind}</span>
        <strong>${escapeHtml(player.name)}</strong>
        <em>${player.score}</em>
      </div>
      ${isSelf ? "" : `<div class="opponent-hand">${renderBackTiles(player.handCount)}</div>`}
      <div class="discard-river">${renderDiscards(player.discards)}</div>
    </section>
  `;
}

function render() {
  if (!state) renderLobby();
  else renderGame();
}

connect();
render();
