const tileLabels = {
  m1: "一万", m2: "二万", m3: "三万", m4: "四万", m5: "五万", m6: "六万", m7: "七万", m8: "八万", m9: "九万",
  p1: "一筒", p2: "二筒", p3: "三筒", p4: "四筒", p5: "五筒", p6: "六筒", p7: "七筒", p8: "八筒", p9: "九筒",
  s1: "一条", s2: "二条", s3: "三条", s4: "四条", s5: "五条", s6: "六条", s7: "七条", s8: "八条", s9: "九条",
  E: "东风", S: "南风", W: "西风", N: "北风", C: "红中", F: "发财", P: "白板"
};

const tileAssetMap = {
  E: "MJf1-.svg",
  S: "MJf2-.svg",
  W: "MJf3-.svg",
  N: "MJf4-.svg",
  C: "MJd1-.svg",
  F: "MJd2-.svg",
  P: "MJd3-.svg"
};

let socket;
let state = null;
let toast = "";
let connection = "连接中";
let reconnectTimer = null;
let name = localStorage.getItem("majiang:name") || `玩家${Math.floor(Math.random() * 90) + 10}`;

const app = document.querySelector("#app");

function connect() {
  clearTimeout(reconnectTimer);
  connection = "连接中";
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  socket.addEventListener("open", () => {
    connection = "已连接";
    render();
  });
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "state") {
      state = payload.state;
      toast = "";
    } else if (payload.type === "error") {
      toast = payload.message;
    }
    render();
  });
  socket.addEventListener("close", () => {
    connection = "重连中";
    toast = "连接断开，正在重连。";
    render();
    reconnectTimer = setTimeout(connect, 1200);
  });
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  else {
    toast = "还没有连上服务器，请稍等。";
    render();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
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

function tileAssetPath(tile) {
  if (!tile) return "";
  if (tile.startsWith("m")) return `/tiles/MJw${tile[1]}-.svg`;
  if (tile.startsWith("p")) return `/tiles/MJt${tile[1]}-.svg`;
  if (tile.startsWith("s")) return `/tiles/MJs${tile[1]}-.svg`;
  return tileAssetMap[tile] ? `/tiles/${tileAssetMap[tile]}` : "";
}

function tileImage(tile) {
  const src = tileAssetPath(tile);
  return src ? `<img class="tile-face" src="${src}" alt="" aria-hidden="true" draggable="false" />` : "";
}

function renderTile(tile, options = {}) {
  const tag = options.clickable ? "button" : "span";
  const attrs = options.clickable
    ? `type="button" data-discard="${tile}" aria-label="打出${tileLabels[tile] || tile}"`
    : `role="img" aria-label="${tileLabels[tile] || tile}"`;
  const classes = [
    "tile",
    `tile-${tileKind(tile)}`,
    options.mini ? "tile-mini" : "",
    options.micro ? "tile-micro" : "",
    options.clickable ? "tile-clickable" : "",
    options.locked ? "tile-locked" : ""
  ].filter(Boolean).join(" ");
  return `<${tag} class="${classes}" ${attrs}>${tileImage(tile)}</${tag}>`;
}

function renderBackTiles(count) {
  const shown = Math.min(count, 13);
  return Array.from({ length: shown }, () => `<span class="tile-back" aria-hidden="true"></span>`).join("");
}

function renderDiscards(discards) {
  if (!discards.length) return `<span class="empty-discard">暂无弃牌</span>`;
  return discards.map((tile) => renderTile(tile, { micro: true })).join("");
}

function renderMeld(meld) {
  if (!meld.stacked) {
    return `<div class="meld meld-row" aria-label="碰牌 ${tileLabels[meld.tiles[0]]}">${meld.tiles.map((tile) => renderTile(tile, { micro: true })).join("")}</div>`;
  }
  const sides = [...meld.tiles];
  const centerIndex = sides.indexOf(meld.centerTile);
  const [upper] = sides.splice(centerIndex < 0 ? 1 : centerIndex, 1);
  return `
    <div class="meld meld-stacked" aria-label="上摞 ${meld.tiles.map((tile) => tileLabels[tile]).join("、")}">
      <span class="stack-tile stack-left">${renderTile(sides[0], { micro: true })}</span>
      <span class="stack-tile stack-right">${renderTile(sides[1], { micro: true })}</span>
      <span class="stack-tile stack-upper">${renderTile(upper, { micro: true })}</span>
    </div>
  `;
}

function renderMelds(melds) {
  if (!melds?.length) return "";
  return `<div class="meld-shelf">${melds.map(renderMeld).join("")}</div>`;
}

function scoreClass(value) {
  if (value > 0) return "score-up";
  if (value < 0) return "score-down";
  return "";
}

function renderLobby() {
  app.innerHTML = `
    <section class="lobby">
      <div class="lobby-brand">
        <div class="brand-mark">${renderTile("C")}</div>
        <div>
          <p class="eyebrow">东光规则 · v1.6</p>
          <h1>青桌麻将</h1>
          <p class="lede">摸牌有声，落牌有数。坐下开一桌。</p>
        </div>
      </div>

      <form class="join-panel" id="lobbyForm">
        <div class="connection-line"><span class="status-dot"></span>${connection}</div>
        <label for="nameInput">昵称</label>
        <input id="nameInput" maxlength="12" value="${escapeHtml(name)}" autocomplete="nickname" />
        <label for="roomInput">房间号</label>
        <input id="roomInput" maxlength="6" placeholder="输入六位房间号" autocomplete="off" inputmode="text" />
        ${toast ? `<p class="toast" role="status">${escapeHtml(toast)}</p>` : ""}
        <div class="lobby-actions">
          <button class="primary" type="button" id="soloBtn">单人开局</button>
          <button type="button" id="createBtn">创建房间</button>
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
      <header class="gamebar">
        <div class="game-identity">
          <span class="mini-mark">${renderTile("C", { micro: true })}</span>
          <div><strong>青桌麻将</strong><small>${state.mode === "solo" ? "单人局" : `房间 ${state.roomId}`} · v${state.version}</small></div>
        </div>
        <div class="round-stats" aria-label="牌局状态">
          <span>余牌 <b>${state.wallCount}</b></span>
          <span>${connection}</span>
        </div>
        <details class="mobile-info">
          <summary>牌局</summary>
          ${renderInfoContent()}
        </details>
      </header>

      <div class="play-layout">
        <main class="table" aria-label="麻将牌桌">
          <div class="table-center">
            <div class="turn-marker">
              <strong>${centerGlyph()}</strong>
              <span>${centerText()}</span>
            </div>
            ${state.lastDiscard ? `<div class="last-discard"><span>上张</span>${renderTile(state.lastDiscard.tile, { mini: true })}</div>` : ""}
          </div>
          ${seats.map(renderSeat).join("")}
        </main>

        <aside class="info-rail">
          ${renderInfoContent()}
        </aside>
      </div>

      <section class="hand-console">
        <div class="action-dock">
          <div class="turn-copy"><strong>${handHint()}</strong><span>${self.routeLabel || "尚未明示路线"}</span></div>
          <div class="action-buttons">${renderActions()}</div>
        </div>
        ${toast ? `<p class="toast game-toast" role="status">${escapeHtml(toast)}</p>` : ""}
        <div class="self-melds">${renderMelds(self.melds)}</div>
        <div class="hand" style="--hand-count:${Math.max(self.hand?.length || 1, 1)}">${renderHand(self)}</div>
      </section>
    </section>
  `;

  bindGameEvents();
}

function renderHand(self) {
  return (self.hand || []).map((tile) => renderTile(tile, { clickable: state.canDiscard })).join("");
}

function renderActions() {
  const buttons = [];
  if (state.phase === "waiting" && state.viewerSeat === state.hostSeat) {
    buttons.push(`<button type="button" data-action="addBots">补电脑</button>`);
    buttons.push(`<button class="primary" type="button" data-action="start">开始</button>`);
  }
  if (state.winner && state.viewerSeat === state.hostSeat) {
    buttons.push(`<button class="primary" type="button" data-action="restart">再来一局</button>`);
  }
  if (state.canSelfWin) buttons.push(`<button class="win" type="button" data-action="selfWin">自摸</button>`);
  if (state.canRon) buttons.push(`<button class="win" type="button" data-action="ron">胡</button>`);
  if (state.canPong) buttons.push(`<button class="call" type="button" data-action="pong">碰</button>`);
  if (state.canPass) buttons.push(`<button type="button" data-action="pass">过</button>`);
  for (const option of state.drillOptions || []) {
    buttons.push(`<button class="declare" type="button" data-declare-drill="${escapeHtml(option.key)}">钻了 · ${option.kind === "edge" ? "边" : "钻"}${escapeHtml(tileLabels[option.waitingTile])}</button>`);
  }
  for (const option of state.stackOptions || []) {
    buttons.push(`<button class="declare" type="button" data-declare-pung="${escapeHtml(option.key)}">${escapeHtml(option.label)}</button>`);
  }
  if (!buttons.length) return `<span class="action-idle">${state.winner ? "本局已结算" : "等待牌局动作"}</span>`;
  return buttons.join("");
}

function renderInfoContent() {
  return `
    <section class="room-panel">
      <div><small>房间号</small><strong>${state.roomId}</strong></div>
      <button type="button" data-action="copy">复制</button>
    </section>
    ${renderResult()}
    <section class="score-panel">
      <h2>积分</h2>
      ${state.players.filter(Boolean).map(renderScore).join("")}
    </section>
    <details class="log-panel" open>
      <summary>牌局记录</summary>
      <ol>${state.log.map((entry) => `<li>${escapeHtml(entry.text)}</li>`).join("")}</ol>
    </details>
  `;
}

function renderScore(player) {
  return `
    <div class="score-line ${player.seat === state.viewerSeat ? "score-self" : ""}">
      <span class="wind">${player.wind}</span>
      <span><strong>${escapeHtml(player.name)}</strong><small>${player.routeLabel || (player.isBot ? "电脑" : "玩家")}</small></span>
      <b>${player.score}</b>
      <em class="${scoreClass(player.roundDelta)}">${player.roundDelta > 0 ? "+" : ""}${player.roundDelta}</em>
    </div>
  `;
}

function renderResult() {
  if (!state.roundResult?.items?.length) return "";
  return `
    <section class="result-panel">
      <h2>本局结算</h2>
      <p>${escapeHtml(state.roundResult.text)}</p>
      <ul>${state.roundResult.items.map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>${item.points}</strong></li>`).join("")}</ul>
    </section>
  `;
}

function renderSeat(player) {
  const position = relativeSeat(player.seat);
  const active = state.currentSeat === player.seat && !state.winner;
  const isSelf = player.seat === state.viewerSeat;
  const route = player.routeLabel ? `<span class="route-badge route-${player.route}">${player.routeLabel}</span>` : "";
  return `
    <section class="seat seat-${position} ${active ? "seat-active" : ""} ${isSelf ? "seat-self" : ""}">
      <div class="seat-head">
        <span class="wind">${player.wind}</span>
        <strong>${escapeHtml(player.name)}</strong>
        ${route}
        <em>${player.score}</em>
      </div>
      ${renderMelds(player.melds)}
      ${isSelf ? "" : `<div class="opponent-hand">${renderBackTiles(player.handCount)}</div>`}
      <div class="discard-river">${renderDiscards(player.discards)}</div>
    </section>
  `;
}

function centerGlyph() {
  if (state.winner) return "胡";
  if (state.phase === "claim") return state.claimStage === "ron" ? "胡" : "碰";
  if (state.phase === "waiting") return "等";
  return state.players[state.currentSeat]?.wind || "东";
}

function centerText() {
  if (state.winner) return state.roundResult?.text || state.winner.text;
  if (state.phase === "claim") return state.claimStage === "ron" ? "等待胡牌回应" : "等待碰牌回应";
  if (state.phase === "waiting") return "等待开局";
  return `${state.players[state.currentSeat]?.name || ""} 行牌`;
}

function handHint() {
  if (state.canRon) return "可以胡这张牌";
  if (state.canPong) return "可以碰这张牌";
  if (state.canDiscard) return "请选择一张牌打出";
  if (state.winner) return "本局结束";
  return "等待其他玩家";
}

function bindGameEvents() {
  app.querySelectorAll("[data-discard]").forEach((button) => {
    button.addEventListener("click", () => send({ type: "discard", tile: button.dataset.discard }));
  });
  app.querySelectorAll("[data-declare-drill]").forEach((button) => {
    button.addEventListener("click", () => send({ type: "declareDrill", key: button.dataset.declareDrill }));
  });
  app.querySelectorAll("[data-declare-pung]").forEach((button) => {
    button.addEventListener("click", () => send({ type: "declarePung", key: button.dataset.declarePung }));
  });
  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      if (action === "copy") {
        try {
          await navigator.clipboard.writeText(state.roomId);
          toast = "房间号已复制。";
        } catch {
          toast = `房间号：${state.roomId}`;
        }
        render();
        return;
      }
      const messages = {
        addBots: { type: "addBots" },
        start: { type: "start" },
        restart: { type: "restart" },
        selfWin: { type: "selfWin" },
        ron: { type: "ron" },
        pong: { type: "pong" },
        pass: { type: "pass" }
      };
      if (messages[action]) send(messages[action]);
    });
  });
}

function render() {
  if (!state) renderLobby();
  else renderGame();
}

connect();
render();
