const tileLabels = {
  m1: "一万", m2: "二万", m3: "三万", m4: "四万", m5: "五万", m6: "六万", m7: "七万", m8: "八万", m9: "九万",
  p1: "一筒", p2: "二筒", p3: "三筒", p4: "四筒", p5: "五筒", p6: "六筒", p7: "七筒", p8: "八筒", p9: "九筒",
  s1: "一条", s2: "二条", s3: "三条", s4: "四条", s5: "五条", s6: "六条", s7: "七条", s8: "八条", s9: "九条",
  E: "东风", S: "南风", W: "西风", N: "北风", C: "红中", F: "发财", P: "白板"
};

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

function dot(x, y, color, r = 7) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#fff7e6" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="${Math.max(2, r - 4)}" fill="none" stroke="#fff7e6" stroke-width="1.1"/>`;
}

function bamboo(x, y, color = "#16885f") {
  return `<g stroke="${color}" stroke-width="4.8" stroke-linecap="round"><path d="M${x} ${y - 10}v20"/><path d="M${x - 5} ${y - 4}h10"/><path d="M${x - 5} ${y + 4}h10"/></g>`;
}

function tilePositions(number) {
  const map = {
    1: [[32, 52]],
    2: [[22, 34], [42, 70]],
    3: [[22, 30], [32, 52], [42, 74]],
    4: [[22, 30], [42, 30], [22, 74], [42, 74]],
    5: [[22, 30], [42, 30], [32, 52], [22, 74], [42, 74]],
    6: [[22, 28], [42, 28], [22, 52], [42, 52], [22, 76], [42, 76]],
    7: [[22, 24], [42, 24], [32, 40], [22, 56], [42, 56], [22, 78], [42, 78]],
    8: [[22, 22], [42, 22], [22, 42], [42, 42], [22, 62], [42, 62], [22, 82], [42, 82]],
    9: [[20, 22], [32, 22], [44, 22], [20, 52], [32, 52], [44, 52], [20, 82], [32, 82], [44, 82]]
  };
  return map[number] || [];
}

function wanMarks(number) {
  const lines = [];
  const y0 = 18;
  for (let i = 0; i < Math.min(number, 5); i += 1) {
    lines.push(`<path d="M19 ${y0 + i * 7}c8-3 18-3 26 0" stroke="#b82f2f" stroke-width="4" stroke-linecap="round" fill="none"/>`);
  }
  if (number > 5) {
    for (let i = 0; i < number - 5; i += 1) {
      lines.push(`<path d="M${19 + i * 7} 57v20" stroke="#b82f2f" stroke-width="4" stroke-linecap="round"/>`);
    }
  }
  return `
    <g>${lines.join("")}</g>
    <g stroke="#1f2722" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M22 87h22"/>
      <path d="M27 75l5 12 5-12"/>
      <path d="M21 66c8 4 19 4 27 0"/>
    </g>
  `;
}

function honorArt(tile) {
  const wind = {
    E: `<path d="M32 19v66M20 42l12-18 12 18" stroke="#147c60" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M20 68h24" stroke="#147c60" stroke-width="5" stroke-linecap="round"/>`,
    S: `<path d="M18 25h28M21 25c20 12 20 30 0 42M46 25c-20 12-20 30 0 42" stroke="#147c60" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    W: `<path d="M20 22h24v20c0 23-24 23-24 0V22zM26 48h12" stroke="#147c60" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    N: `<path d="M32 20v64M20 64l12 20 12-20M21 36h22" stroke="#147c60" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  };
  if (wind[tile]) return wind[tile];
  if (tile === "C") {
    return `<circle cx="32" cy="52" r="21" fill="none" stroke="#bd2c2c" stroke-width="6"/><path d="M32 28v48M18 52h28" stroke="#bd2c2c" stroke-width="5" stroke-linecap="round"/>`;
  }
  if (tile === "F") {
    return `<g stroke="#148657" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M18 30h28M22 44h20M24 58h16"/><path d="M32 30v48M22 78c8-8 12-8 20 0"/></g>`;
  }
  return `<rect x="19" y="25" width="26" height="54" rx="2" fill="none" stroke="#2b6fac" stroke-width="5"/><rect x="25" y="34" width="14" height="36" fill="rgba(43,111,172,.1)" stroke="#2b6fac" stroke-width="2"/>`;
}

function tileArt(tile) {
  if (!tile) return "";
  const kind = tileKind(tile);
  const number = Number(tile[1]);
  let inner = "";
  if (kind === "pin") {
    const colors = ["#2475b7", "#be3333", "#16885f"];
    inner = tilePositions(number).map(([x, y], i) => dot(x, y, colors[i % colors.length])).join("");
  } else if (kind === "suo") {
    inner = tilePositions(number).map(([x, y], i) => bamboo(x, y, i % 3 === 1 ? "#bd2c2c" : "#16885f")).join("");
  } else if (kind === "wan") {
    inner = wanMarks(number);
  } else {
    inner = honorArt(tile);
  }
  return `
    <svg class="tile-face" viewBox="0 0 64 104" aria-hidden="true">
      <rect class="tile-body" x="3" y="3" width="58" height="96" rx="8"/>
      <rect class="tile-inner" x="9" y="9" width="46" height="82" rx="5"/>
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
          <p class="eyebrow">东光/沧州规则试做版 · v1.1</p>
          <h1>青桌麻将</h1>
          <p class="lede">牌面改成图案牌，桌面优先留给手牌和出牌河；积分按当前沧州系规则先跑起来，后面可以继续校准三边、三钻和地方细节。</p>
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
