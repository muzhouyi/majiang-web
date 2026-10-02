const tileLabels = {
  m1: "一万", m2: "二万", m3: "三万", m4: "四万", m5: "五万", m6: "六万", m7: "七万", m8: "八万", m9: "九万",
  p1: "一筒", p2: "二筒", p3: "三筒", p4: "四筒", p5: "五筒", p6: "六筒", p7: "七筒", p8: "八筒", p9: "九筒",
  s1: "一条", s2: "二条", s3: "三条", s4: "四条", s5: "五条", s6: "六条", s7: "七条", s8: "八条", s9: "九条",
  E: "东风", S: "南风", W: "西风", N: "北风", C: "红中", F: "发财", P: "白板"
};

const tileAssetMap = {
  E: "MJf1-.svg", S: "MJf2-.svg", W: "MJf3-.svg", N: "MJf4-.svg",
  C: "MJd1-.svg", F: "MJd2-.svg", P: "MJd3-.svg"
};

const LAYOUT_KEY = "majiang:layoutMode";
const PROFILE_KEY = "majiang:profileId";
const DISCARD_SLOTS = 30;
let socket;
let state = null;
let toast = "";
let connection = "连接中";
let reconnectTimer = null;
let latestDiscardTileId = null;
let drawnTileId = null;
let selectedTileId = null;
let adminOpen = false;
let adminUnlocked = false;
let adminData = null;
let adminTab = "scoring";
let adminReplay = null;
let replayFrameIndex = 0;
let adminScoreDetailsOpen = false;
let adminSuggestion = null;
let adminTapCount = 0;
let adminTapStartedAt = 0;
let lobbyDirectoryOpen = false;
let lobbyRooms = [];
let lobbyRefreshTimer = null;
let name = localStorage.getItem("majiang:name") || `玩家${Math.floor(Math.random() * 90) + 10}`;
let profileId = localStorage.getItem(PROFILE_KEY);
if (!profileId) {
  profileId = globalThis.crypto?.randomUUID?.() || `player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(PROFILE_KEY, profileId);
}
let layoutMode = ["landscape", "portrait"].includes(localStorage.getItem(LAYOUT_KEY))
  ? localStorage.getItem(LAYOUT_KEY)
  : (window.innerWidth >= window.innerHeight ? "landscape" : "portrait");

const app = document.querySelector("#app");

function connect() {
  clearTimeout(reconnectTimer);
  connection = "连接中";
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  socket.addEventListener("open", () => {
    connection = "已连接";
    if (state?.roomId) send({ type: "join", roomId: state.roomId, name, profileId });
    render();
  });
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "state") {
      state = payload.state;
      adminSuggestion = null;
      setLobbyDirectoryOpen(false);
      if (state.viewerProfileId && state.viewerProfileId !== profileId) {
        profileId = state.viewerProfileId;
        localStorage.setItem(PROFILE_KEY, profileId);
      }
      const selfPlayer = state.players[state.viewerSeat];
      if (selfPlayer?.name && selfPlayer.name !== name) {
        name = selfPlayer.name;
        localStorage.setItem("majiang:name", name);
      }
      latestDiscardTileId = state.latestDiscardTileId || null;
      drawnTileId = state.drawnTileId || null;
      const handIds = new Set(state.players[state.viewerSeat]?.hand?.map((entry) => entry.tileId) || []);
      if (selectedTileId && !handIds.has(selectedTileId)) selectedTileId = null;
      toast = "";
    } else if (payload.type === "left") {
      state = null;
      latestDiscardTileId = null;
      drawnTileId = null;
      selectedTileId = null;
      toast = "已退出房间";
    } else if (payload.type === "kicked") {
      state = null;
      latestDiscardTileId = null;
      drawnTileId = null;
      selectedTileId = null;
      toast = payload.message || "你已被移出房间。";
    } else if (payload.type === "roomClosed") {
      state = null;
      latestDiscardTileId = null;
      drawnTileId = null;
      selectedTileId = null;
      toast = payload.message || "房间已自动解散。";
    } else if (payload.type === "lobbyRooms") {
      lobbyRooms = payload.rooms || [];
    } else if (payload.type === "error") {
      toast = payload.message;
      if (state?.roomId && payload.message === "没有找到这个房间。") state = null;
    } else if (payload.type === "adminData") {
      adminUnlocked = true;
      adminOpen = true;
      adminData = payload.data;
      if (payload.message) toast = payload.message;
    } else if (payload.type === "adminReplay") {
      adminReplay = payload.replay;
      replayFrameIndex = 0;
      adminTab = "replay";
      adminOpen = true;
    } else if (payload.type === "adminSuggestion") {
      adminSuggestion = payload.suggestion;
      toast = payload.suggestion.text;
    } else if (payload.type === "adminError") {
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

function setLobbyDirectoryOpen(open) {
  lobbyDirectoryOpen = open;
  clearInterval(lobbyRefreshTimer);
  lobbyRefreshTimer = null;
  if (open) {
    lobbyRefreshTimer = setInterval(() => {
      if (lobbyDirectoryOpen) send({ type: "listRooms", profileId });
    }, 5_000);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function tileValue(entry) {
  return typeof entry === "string" ? entry : entry?.tile;
}

function tileId(entry) {
  return typeof entry === "string" ? "" : entry?.tileId || "";
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

function renderTile(entry, options = {}) {
  const tile = tileValue(entry);
  const id = tileId(entry);
  const tag = options.clickable ? "button" : "span";
  const attrs = options.clickable
    ? `type="button" data-hand-tile-id="${id}" data-tile="${tile}" aria-label="选择${tileLabels[tile] || tile}，再次点击打出"`
    : `role="img" aria-label="${tileLabels[tile] || tile}"`;
  const classes = [
    "tile", `tile-${tileKind(tile)}`,
    options.size ? `tile-${options.size}` : "",
    options.clickable ? "tile-clickable" : "",
    id && id === selectedTileId ? "is-selected" : "",
    id && id === drawnTileId ? "is-drawn" : ""
  ].filter(Boolean).join(" ");
  const drawnBadge = id && id === drawnTileId ? `<span class="draw-badge" aria-hidden="true">摸</span>` : "";
  return `<${tag} class="${classes}" ${attrs} data-tile-id="${id}">${tileImage(tile)}${drawnBadge}</${tag}>`;
}

function renderBackTiles(count) {
  const slots = Array.from({ length: 13 }, (_, index) => (
    `<span class="opponent-slot">${index < Math.min(count, 13) ? '<span class="tile-back" aria-hidden="true"></span>' : ""}</span>`
  ));
  return slots.join("");
}

function renderRevealedOpponentTiles(hand = []) {
  return Array.from({ length: 13 }, (_, index) => (
    `<span class="opponent-slot">${hand[index] ? `<span class="tile-back tile-back-revealed" role="img" aria-label="${tileLabels[tileValue(hand[index])] || tileValue(hand[index])}">${tileImage(tileValue(hand[index]))}</span>` : ""}</span>`
  )).join("");
}

function renderMeld(meld) {
  if (meld.hidden) {
    const back = '<span class="meld-back tile-back" aria-hidden="true"></span>';
    if (meld.type === "concealed-kong") {
      return `<div class="meld meld-row meld-kong meld-hidden" aria-label="暗杠四张牌背">${meld.tiles.map(() => back).join("")}</div>`;
    }
    return `<div class="meld meld-stacked meld-hidden" aria-label="暗置上摞">
      <span class="stack-tile stack-left">${back}</span>
      <span class="stack-tile stack-right">${back}</span>
      <span class="stack-tile stack-upper">${back}</span>
    </div>`;
  }
  const instances = meld.tiles.map((tile, index) => ({ tile, tileId: meld.tileIds?.[index] || `${meld.id}-${index}` }));
  if (!meld.stacked) {
    const actionName = meld.type?.includes("kong") ? "杠牌" : "碰牌";
    return `<div class="meld meld-row ${meld.type?.includes("kong") ? "meld-kong" : ""}" aria-label="${actionName} ${tileLabels[meld.tiles[0]]}">${instances.map((entry) => renderTile(entry, { size: "micro" })).join("")}</div>`;
  }
  const centerIndex = Math.max(0, meld.tiles.indexOf(meld.centerTile));
  const upper = instances[centerIndex];
  const sides = instances.filter((_, index) => index !== centerIndex);
  return `<div class="meld meld-stacked" aria-label="摞牌 ${meld.tiles.map((tile) => tileLabels[tile]).join("、")}">
    <span class="stack-tile stack-left">${renderTile(sides[0], { size: "micro" })}</span>
    <span class="stack-tile stack-right">${renderTile(sides[1], { size: "micro" })}</span>
    <span class="stack-tile stack-upper">${renderTile(upper, { size: "micro" })}</span>
  </div>`;
}

function renderMelds(melds) {
  return melds?.length ? `<div class="meld-shelf">${melds.map(renderMeld).join("")}</div>` : "";
}

function renderLobbyDirectory() {
  if (!lobbyDirectoryOpen) return "";
  const rooms = lobbyRooms.length ? lobbyRooms.map((room) => {
    const status = room.status === "waiting" ? "等待开局" : room.status === "ended" ? "本局结束" : "进行中";
    const action = room.canRejoin
      ? `<button class="primary" type="button" data-directory-join="${escapeHtml(room.id)}">重新加入</button>`
      : room.canJoin
        ? `<button type="button" data-directory-join="${escapeHtml(room.id)}">加入</button>`
        : '<button type="button" disabled>不可加入</button>';
    const deleteAction = adminUnlocked
      ? `<button class="danger-quiet" type="button" data-directory-delete="${escapeHtml(room.id)}">删除</button>`
      : "";
    return `<div class="directory-row"><div class="directory-room"><strong>${escapeHtml(room.id)}</strong><span class="directory-status status-${room.status}">${status}</span><small>房主 ${escapeHtml(room.hostName)} · 真人 ${room.humanSeats}/4</small><small>${escapeHtml(room.players.join(" / ") || "暂无玩家")}</small></div><div class="directory-actions">${action}${deleteAction}</div></div>`;
  }).join("") : '<p class="admin-empty">当前还没有在线房间。</p>';
  return `<div class="directory-backdrop"><section class="directory-dialog" role="dialog" aria-modal="true" aria-labelledby="directoryTitle"><header><div><p class="eyebrow">在线房间</p><h2 id="directoryTitle">麻将大厅</h2></div><button type="button" data-directory-close aria-label="关闭">×</button></header><div class="directory-toolbar"><span>${lobbyRooms.length} 个房间</span><button type="button" data-directory-refresh>刷新</button></div><div class="directory-list">${rooms}</div></section></div>`;
}

function renderLobby() {
  app.innerHTML = `<section class="lobby">
    <div class="lobby-brand">
      <button class="brand-mark admin-trigger" type="button" data-admin-trigger aria-label="青桌麻将">${renderTile("C")}</button>
      <div><p class="eyebrow">东光规则 · v3.4</p><h1>青桌麻将</h1><p class="lede">摸牌有声，落牌有数。坐下开一桌。</p></div>
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
        <button type="button" id="directoryBtn">查看大厅</button>
      </div>
    </form>
  </section>${renderLobbyDirectory()}${renderAdminLayer()}`;

  app.querySelector("#nameInput").addEventListener("input", (event) => {
    name = event.target.value.trim() || "玩家";
    localStorage.setItem("majiang:name", name);
  });
  app.querySelector("#soloBtn").addEventListener("click", () => send({ type: "create", mode: "solo", name, profileId }));
  app.querySelector("#createBtn").addEventListener("click", () => send({ type: "create", mode: "online", name, profileId }));
  app.querySelector("#directoryBtn").addEventListener("click", () => { setLobbyDirectoryOpen(true); render(); send({ type: "listRooms", profileId }); });
  app.querySelector("[data-directory-close]")?.addEventListener("click", () => { setLobbyDirectoryOpen(false); render(); });
  app.querySelector("[data-directory-refresh]")?.addEventListener("click", () => send({ type: "listRooms", profileId }));
  app.querySelectorAll("[data-directory-join]").forEach((button) => button.addEventListener("click", () => send({ type: "join", roomId: button.dataset.directoryJoin, name, profileId })));
  app.querySelectorAll("[data-directory-delete]").forEach((button) => button.addEventListener("click", () => {
    if (window.confirm(`确定删除房间 ${button.dataset.directoryDelete} 吗？房间内的牌局会立即结束。`)) {
      send({ type: "adminDeleteRoom", roomId: button.dataset.directoryDelete });
    }
  }));
  app.querySelector("#lobbyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const roomId = app.querySelector("#roomInput").value.trim().toUpperCase();
    if (roomId) send({ type: "join", roomId, name, profileId });
  });
  bindAdminEvents();
}

function renderGame() {
  const self = state.players[state.viewerSeat];
  app.innerHTML = `<section class="game layout-${layoutMode}">
    <header class="gamebar">
      <div class="game-identity">
        <button class="mini-mark admin-trigger" type="button" data-admin-trigger aria-label="青桌麻将">${renderTile("C", { size: "micro" })}</button>
        <div><strong>青桌麻将</strong><small>${state.mode === "solo" ? "单人局" : `房间 ${state.roomId}`} · v${state.version}</small></div>
      </div>
      <div class="round-stats"><span>余牌 <b>${state.wallCount}</b></span><span>${connection}</span></div>
    </header>
    <details class="mobile-info"><summary>牌局</summary>${renderInfoContent()}</details>

    <details class="layout-menu">
      <summary aria-label="切换屏幕布局" title="切换屏幕布局"><span class="screen-icon" aria-hidden="true"></span><span class="layout-label">${layoutMode === "landscape" ? "横屏" : "竖屏"}</span></summary>
      <div class="layout-options" role="group" aria-label="屏幕模式">
        <button type="button" data-layout-mode="landscape" aria-pressed="${layoutMode === "landscape"}">横屏模式</button>
        <button type="button" data-layout-mode="portrait" aria-pressed="${layoutMode === "portrait"}">竖屏兼容模式</button>
      </div>
    </details>

    <div class="play-layout">
      <div class="table-stage">
        <main class="table" aria-label="麻将牌桌">
          <div class="table-center"><div class="turn-marker"><strong>${centerGlyph()}</strong><span>${centerText()}</span></div></div>
          ${state.players.filter(Boolean).map(renderSeat).join("")}
          ${state.players.filter(Boolean).map(renderDiscardZone).join("")}
        </main>
      </div>
      <aside class="info-rail">${renderInfoContent()}</aside>
    </div>

    <section class="hand-console">
      <div class="action-dock">
        <div class="turn-copy"><strong>${handHint()}</strong><span>${self.routeLabel || "尚未明示路线"}</span></div>
        <div class="action-buttons">${renderActions()}</div>
      </div>
      ${toast ? `<p class="toast game-toast" role="status">${escapeHtml(toast)}</p>` : ""}
      <div class="self-melds">${renderMelds(self.melds)}</div>
      ${renderHand(self)}
      <div class="tile-preview ${selectedTileId ? "is-visible" : ""}" aria-hidden="${!selectedTileId}">${renderSelectedPreview(self)}</div>
    </section>
  </section>${renderAdminLayer()}`;
  bindGameEvents();
}

function renderHand(self) {
  const hand = self.hand || [];
  const slots = Array.from({ length: 14 }, (_, index) => (
    `<span class="hand-slot">${hand[index] ? renderTile(hand[index], { clickable: state.canDiscard }) : ""}</span>`
  )).join("");
  return `<div class="hand-rack" aria-label="自己的手牌"><div class="hand-main-slots">${slots}</div></div>`;
}

function renderSelectedPreview(self) {
  const entry = self.hand?.find((tile) => tile.tileId === selectedTileId);
  return entry ? `${renderTile(entry, { size: "preview-size" })}<span>再次点击打出</span>` : "";
}

function numberField(label, key, value, group = "root", note = "") {
  return `<label class="admin-number"><span>${label}${note ? `<small>${note}</small>` : ""}</span><input type="number" min="0" max="999" inputmode="numeric" data-score-group="${group}" data-score-key="${key}" value="${Number(value) || 0}" /></label>`;
}

function renderAdminScoring() {
  const scoring = adminData.scoring;
  const patterns = ["清一色", "七对", "豪华七对", "一条龙", "十三不靠", "十三幺", "三碰胡", "四碰胡", "钻胡", "杠上开花"];
  return `<form class="admin-form" id="adminScoringForm">
    <section class="admin-section"><h3>基础结算</h3><div class="admin-number-grid">
      ${numberField("庄家底分", "dealerBase", scoring.dealerBase)}
      ${numberField("闲家底分", "nonDealerBase", scoring.nonDealerBase)}
      ${numberField("自摸倍数", "selfDrawMultiplier", scoring.selfDrawMultiplier)}
      ${numberField("点炮包付倍数", "discardMultiplier", scoring.discardMultiplier)}
    </div><label class="admin-toggle scoring-toggle"><span><strong>仅点炮者扣分</strong><small>开启后由打出胡牌张的玩家按点炮倍数包付；关闭后其余三家各付一份基础牌分。</small></span><input type="checkbox" data-discard-payer-only ${scoring.discardPayerOnly !== false ? "checked" : ""} /></label></section>
    <section class="admin-section"><h3>胡牌积分</h3><div class="admin-number-grid">${patterns.map((name) => numberField(name, name, scoring.patterns[name], "patterns")).join("")}</div></section>
    <section class="admin-section"><h3>杠牌积分</h3><p class="admin-note">每次杠牌即时结算，其余三家各支付所填分值；填 0 表示只记录、不计分。</p><div class="admin-number-grid">
      ${numberField("明杠", "明杠", scoring.actions["明杠"], "actions")}
      ${numberField("暗杠", "暗杠", scoring.actions["暗杠"], "actions")}
    </div></section>
    <div class="admin-savebar"><button class="primary" type="submit">保存积分设置</button></div>
  </form>`;
}

function renderReplayViewer() {
  if (!adminReplay?.frames?.length) return "";
  const frame = adminReplay.frames[replayFrameIndex] || adminReplay.frames[0];
  return `<section class="replay-viewer">
    <header><button type="button" data-close-replay aria-label="返回回放列表">‹</button><div><strong>${escapeHtml(adminReplay.roomId)} · 第 ${frame.step} 步</strong><small>${escapeHtml(frame.text)}</small></div><b>余牌 ${frame.wallCount}</b></header>
    <div class="replay-table">${frame.players.map((player) => `<section class="replay-seat replay-seat-${player.seat}">
      <div class="replay-player"><span class="wind">${player.wind}</span><strong>${escapeHtml(player.name)}</strong><em>${player.score}</em></div>
      <div class="replay-hand" aria-label="${escapeHtml(player.name)}的手牌">${(player.hand || []).map((entry) => renderTile(entry, { size: "micro" })).join("")}</div>
      <div class="replay-melds">${(player.melds || []).map((meld) => renderMeld({ ...meld, hidden: false })).join("")}</div>
      <div class="replay-discards">${(player.discards || []).map((entry) => renderTile(entry, { size: "micro" })).join("")}</div>
    </section>`).join("")}</div>
    <div class="replay-controls">
      <button type="button" data-replay-previous ${replayFrameIndex <= 0 ? "disabled" : ""} aria-label="上一步">‹ <span>上一步</span></button>
      <label class="replay-scrubber"><span>${replayFrameIndex + 1} / ${adminReplay.frames.length}</span><input type="range" min="0" max="${adminReplay.frames.length - 1}" value="${replayFrameIndex}" data-replay-frame /></label>
      <button type="button" data-replay-next ${replayFrameIndex >= adminReplay.frames.length - 1 ? "disabled" : ""} aria-label="下一步"><span>下一步</span> ›</button>
    </div>
  </section>`;
}

function renderAdminReplay() {
  const records = adminData.replays || [];
  return `<section class="admin-section replay-settings">
    <label class="admin-toggle"><span><strong>记录牌局</strong><small>关闭后不再保存新牌局，已有回放保留。</small></span><input type="checkbox" data-replay-enabled ${adminData.replay.enabled ? "checked" : ""} /></label>
  </section>${renderReplayViewer() || `<section class="admin-section"><h3>牌局回放</h3><div class="replay-list">${records.length ? records.map((replay) => `<div class="replay-list-row"><button class="replay-open" type="button" data-replay-id="${escapeHtml(replay.id)}"><span><strong>${escapeHtml(replay.roomId)} · ${escapeHtml(replay.players.join(" / "))}</strong><small>${new Date(replay.createdAt).toLocaleString()} · ${escapeHtml(replay.result)}</small></span><b>${replay.frameCount}步</b></button><button class="danger-quiet replay-delete" type="button" data-delete-replay="${escapeHtml(replay.id)}" aria-label="删除 ${escapeHtml(replay.roomId)} 的牌局回放">删除</button></div>`).join("") : '<p class="admin-empty">还没有保存的牌局回放。</p>'}</div></section>`}`;
}

function renderAdminPlayers() {
  const players = adminData.players || [];
  const history = adminData.playerScores?.history || [];
  const mergeOptions = players.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${player.score}分</option>`).join("");
  const historyPanel = adminScoreDetailsOpen ? `<section class="admin-section score-history"><header><div><h3>玩家积分明细</h3><small>最近 ${history.length} 条，最多保留 500 条</small></div>${history.length ? '<button class="danger-quiet" type="button" data-clear-score-history>清空明细</button>' : ""}</header><div class="score-history-list">${history.length ? history.map((entry) => `<div class="score-history-row"><time>${new Date(entry.createdAt).toLocaleString()}</time><strong>${escapeHtml(entry.name)}</strong><span>房间 ${escapeHtml(entry.roomId)} · ${escapeHtml(entry.reason)}</span><b class="${entry.delta > 0 ? "score-up" : "score-down"}">${entry.delta > 0 ? "+" : ""}${entry.delta}</b><em>余额 ${entry.scoreAfter}</em></div>`).join("") : '<p class="admin-empty">暂无玩家积分变动记录。</p>'}</div></section>` : "";
  return `<section class="admin-section gameplay-settings"><label class="admin-toggle"><span><strong>真人掉线后由电脑接管</strong><small>默认关闭。关闭时保留真人座位，轮到该玩家时等待本人重新加入；开启后立即转为电脑托管。</small></span><input type="checkbox" data-bot-takeover ${adminData.gameplay?.botTakeoverOnDisconnect ? "checked" : ""} /></label></section>
  <section class="admin-section player-score-settings"><div class="player-score-heading"><label class="admin-toggle"><span><strong>记录玩家积分变动清单</strong><small>关闭后仍会正常结算并累计玩家总分，只是不再新增积分明细。</small></span><input type="checkbox" data-player-scores-enabled ${adminData.playerScores?.enabled !== false ? "checked" : ""} /></label><button type="button" data-score-details aria-expanded="${adminScoreDetailsOpen}">${adminScoreDetailsOpen ? "收起积分明细" : "玩家积分明细"}</button></div></section>${historyPanel}
  <section class="admin-section"><h3>合并玩家记录</h3><p class="admin-note">来源账号的积分会累加到保留账号，随后删除来源记录。</p>${players.length >= 2 ? `<form class="merge-player-form" id="mergePlayerForm"><label><span>来源账号</span><select data-merge-source>${mergeOptions}</select></label><span aria-hidden="true">→</span><label><span>保留账号</span><select data-merge-target>${mergeOptions}</select></label><button class="danger-quiet" type="submit">合并</button></form>` : '<p class="admin-empty">至少需要两条玩家记录才能合并。</p>'}</section>
  <section class="admin-section"><h3>真实玩家积分</h3><div class="player-admin-list">${players.length ? players.map((player) => `<form class="player-admin-row" data-player-form="${escapeHtml(player.id)}"><div class="player-admin-meta"><strong>${escapeHtml(player.name)}</strong><small>${new Date(player.updatedAt).toLocaleString()}</small></div><label><span>昵称</span><input type="text" maxlength="12" value="${escapeHtml(player.name)}" data-player-name-input /></label><label><span>积分</span><input type="number" value="${player.score}" data-player-score /></label><div class="player-admin-actions"><button type="submit">改分</button><button type="button" data-rename-player="${escapeHtml(player.id)}">改名</button><button type="button" class="danger-quiet" data-reset-player="${escapeHtml(player.id)}">重置</button><button type="button" class="danger-quiet" data-delete-player="${escapeHtml(player.id)}" data-player-name="${escapeHtml(player.name)}">删除</button></div></form>`).join("") : '<p class="admin-empty">暂无真实玩家记录。</p>'}</div></section>`;
}

function renderAdminLayer() {
  if (!adminOpen) return "";
  if (!adminUnlocked || !adminData) {
    return `<div class="admin-backdrop"><section class="admin-dialog admin-login" role="dialog" aria-modal="true" aria-labelledby="adminTitle"><button class="admin-close" type="button" data-admin-close aria-label="关闭">×</button><p class="eyebrow">管理者验证</p><h2 id="adminTitle">管理者设置</h2><form id="adminLoginForm"><label for="adminPassword">密码</label><input id="adminPassword" type="password" inputmode="numeric" autocomplete="current-password" required autofocus /><button class="primary" type="submit">进入设置</button></form>${toast ? `<p class="toast">${escapeHtml(toast)}</p>` : ""}</section></div>`;
  }
  const content = adminTab === "replay" ? renderAdminReplay() : adminTab === "players" ? renderAdminPlayers() : renderAdminScoring();
  return `<div class="admin-backdrop"><section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="adminTitle"><header class="admin-header"><div><p class="eyebrow">青桌麻将 · v3.4</p><h2 id="adminTitle">管理者设置</h2></div><button class="admin-close" type="button" data-admin-close aria-label="关闭">×</button></header><nav class="admin-tabs" aria-label="管理设置分类">
    <button type="button" data-admin-tab="scoring" aria-current="${adminTab === "scoring"}">积分</button>
    <button type="button" data-admin-tab="replay" aria-current="${adminTab === "replay"}">回放</button>
    <button type="button" data-admin-tab="players" aria-current="${adminTab === "players"}">玩家</button>
  </nav><div class="admin-body">${toast ? `<p class="toast admin-toast">${escapeHtml(toast)}</p>` : ""}${content}</div></section></div>`;
}

function handleAdminTrigger() {
  const now = Date.now();
  if (now - adminTapStartedAt > 4000) {
    adminTapCount = 0;
    adminTapStartedAt = now;
  }
  adminTapCount += 1;
  if (adminTapCount < 6) return;
  adminTapCount = 0;
  adminOpen = true;
  if (adminUnlocked) send({ type: "adminGet" });
  else render();
}

function bindAdminEvents() {
  app.querySelectorAll("[data-admin-trigger]").forEach((button) => button.addEventListener("click", handleAdminTrigger));
  app.querySelector("[data-admin-close]")?.addEventListener("click", () => { adminOpen = false; adminReplay = null; toast = ""; render(); });
  app.querySelector("#adminLoginForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    send({ type: "adminLogin", password: app.querySelector("#adminPassword").value });
  });
  app.querySelectorAll("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => { adminTab = button.dataset.adminTab; adminReplay = null; toast = ""; render(); }));
  app.querySelector("#adminScoringForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const scoring = { patterns: {}, actions: {} };
    event.currentTarget.querySelectorAll("[data-score-key]").forEach((input) => {
      const group = input.dataset.scoreGroup;
      if (group === "root") scoring[input.dataset.scoreKey] = Number(input.value);
      else scoring[group][input.dataset.scoreKey] = Number(input.value);
    });
    scoring.discardPayerOnly = Boolean(event.currentTarget.querySelector("[data-discard-payer-only]")?.checked);
    send({ type: "adminUpdateScoring", scoring });
  });
  app.querySelector("[data-replay-enabled]")?.addEventListener("change", (event) => send({ type: "adminUpdateReplay", enabled: event.target.checked }));
  app.querySelectorAll("[data-replay-id]").forEach((button) => button.addEventListener("click", () => send({ type: "adminGetReplay", replayId: button.dataset.replayId })));
  app.querySelector("[data-close-replay]")?.addEventListener("click", () => { adminReplay = null; render(); });
  app.querySelector("[data-replay-frame]")?.addEventListener("input", (event) => { replayFrameIndex = Number(event.target.value); render(); });
  app.querySelector("[data-replay-previous]")?.addEventListener("click", () => { replayFrameIndex = Math.max(0, replayFrameIndex - 1); render(); });
  app.querySelector("[data-replay-next]")?.addEventListener("click", () => { replayFrameIndex = Math.min(adminReplay.frames.length - 1, replayFrameIndex + 1); render(); });
  app.querySelector("[data-player-scores-enabled]")?.addEventListener("change", (event) => send({ type: "adminUpdatePlayerScores", enabled: event.target.checked }));
  app.querySelector("[data-bot-takeover]")?.addEventListener("change", (event) => send({ type: "adminUpdateGameplay", botTakeoverOnDisconnect: event.target.checked }));
  app.querySelector("[data-score-details]")?.addEventListener("click", () => { adminScoreDetailsOpen = !adminScoreDetailsOpen; render(); });
  app.querySelector("[data-clear-score-history]")?.addEventListener("click", () => {
    if (window.confirm("确定清空全部玩家积分明细吗？清空后无法恢复。")) send({ type: "adminClearPlayerScoreHistory" });
  });
  app.querySelectorAll("[data-delete-replay]").forEach((button) => button.addEventListener("click", () => {
    if (window.confirm("确定删除这局牌局回放吗？删除后无法恢复。")) send({ type: "adminDeleteReplay", replayId: button.dataset.deleteReplay });
  }));
  app.querySelectorAll("[data-player-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    send({ type: "adminUpdatePlayer", playerId: form.dataset.playerForm, score: Number(form.querySelector("[data-player-score]").value) });
  }));
  const mergeForm = app.querySelector("#mergePlayerForm");
  if (mergeForm) {
    const target = mergeForm.querySelector("[data-merge-target]");
    if (target.options.length > 1) target.selectedIndex = 1;
    mergeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const sourceSelect = mergeForm.querySelector("[data-merge-source]");
      const targetSelect = mergeForm.querySelector("[data-merge-target]");
      if (sourceSelect.value === targetSelect.value) { toast = "来源账号和保留账号不能相同。"; render(); return; }
      const sourceName = sourceSelect.options[sourceSelect.selectedIndex].text;
      const targetName = targetSelect.options[targetSelect.selectedIndex].text;
      if (window.confirm(`确定将 ${sourceName} 合并到 ${targetName} 吗？来源记录会被删除。`)) {
        send({ type: "adminMergePlayers", sourcePlayerId: sourceSelect.value, targetPlayerId: targetSelect.value });
      }
    });
  }
  app.querySelectorAll("[data-rename-player]").forEach((button) => button.addEventListener("click", () => {
    const form = button.closest("[data-player-form]");
    const newName = form.querySelector("[data-player-name-input]").value.trim();
    if (!newName) { toast = "昵称不能为空。"; render(); return; }
    if (window.confirm(`确定将玩家昵称改为“${newName}”吗？`)) send({ type: "adminRenamePlayer", playerId: button.dataset.renamePlayer, name: newName });
  }));
  app.querySelectorAll("[data-reset-player]").forEach((button) => button.addEventListener("click", () => send({ type: "adminResetPlayer", playerId: button.dataset.resetPlayer })));
  app.querySelectorAll("[data-delete-player]").forEach((button) => button.addEventListener("click", () => {
    if (window.confirm(`确定删除 ${button.dataset.playerName} 的积分记录吗？`)) send({ type: "adminDeletePlayer", playerId: button.dataset.deletePlayer });
  }));
}

function renderSeat(player) {
  const position = relativeSeat(player.seat);
  const active = state.currentSeat === player.seat && !state.winner;
  const isSelf = player.seat === state.viewerSeat;
  const route = player.routeLabel ? `<span class="route-badge route-${player.route}">${player.routeLabel}</span>` : "";
  const dealer = player.seat === state.dealerSeat ? '<span class="dealer-badge">庄</span>' : "";
  const opponentTiles = state.winner && player.hand
    ? renderRevealedOpponentTiles(player.hand)
    : renderBackTiles(player.handCount);
  const head = `<div class="seat-head"><span class="wind">${player.wind}</span><strong>${escapeHtml(player.name)}</strong>${dealer}${route}<em>${player.score}</em></div>`;
  return `<section class="seat seat-${position} ${active ? "seat-active" : ""} ${isSelf ? "seat-self" : ""}">
    ${isSelf ? head : `<div class="opponent-rack">${head}<div class="opponent-melds">${renderMelds(player.melds)}</div><div class="opponent-hand ${state.winner ? "is-revealed" : ""}">${opponentTiles}</div></div>`}
  </section>`;
}

function renderDiceSummary() {
  const rounds = state.diceRounds || [];
  if (!rounds.length) return "";
  const result = rounds.map((round, roundIndex) => `<div class="dice-round"><small>第 ${roundIndex + 1} 轮</small>${round.rolls.map((roll) => `<span><b>${escapeHtml(state.players[roll.seat]?.name || "")}</b><i>${roll.dice[0]}</i><i>${roll.dice[1]}</i><em>${roll.total}</em></span>`).join("")}</div>`).join("");
  return `<section class="dice-summary" aria-label="开局掷骰结果"><header><strong>掷骰定庄</strong><small>${rounds.length > 1 ? `同点加掷 ${rounds.length - 1} 次` : "一次定庄"}</small></header>${result}</section>`;
}

function renderDiscardZone(player) {
  const position = relativeSeat(player.seat);
  const count = Math.max(DISCARD_SLOTS, player.discards.length);
  const slots = Array.from({ length: count }, (_, index) => {
    const entry = player.discards[index];
    const placement = discardPlacement(position, index);
    if (!entry) return `<span class="discard-slot" style="${placement}" aria-hidden="true"></span>`;
    const latest = entry.tileId === latestDiscardTileId;
    return `<span class="discard-slot ${latest ? "is-latest" : ""}" style="${placement}" data-discard-tile-id="${entry.tileId}">
      <span class="discard-face">${renderTile(entry, { size: "discard" })}</span>
      ${latest ? '<span class="latest-arrow" aria-label="最新弃牌"></span>' : ""}
    </span>`;
  }).join("");
  return `<section class="discard-zone discard-${position}" aria-label="${player.name}的弃牌"><div class="discard-grid">${slots}</div></section>`;
}

function discardPlacement(position, index) {
  const group = Math.floor(index / 6);
  const offset = index % 6;
  const centeredSlot = [3, 4, 2, 5, 1, 6][offset];
  if (position === "top") return `grid-row:${5 - group};grid-column:${centeredSlot}`;
  if (position === "left") return `grid-row:${centeredSlot};grid-column:${5 - group}`;
  if (position === "right") return `grid-row:${centeredSlot};grid-column:${group + 1}`;
  return `grid-row:${group + 1};grid-column:${centeredSlot}`;
}

function renderActions() {
  const buttons = [];
  if (state.phase === "waiting" && state.viewerSeat === state.hostSeat) {
    buttons.push('<button type="button" data-action="addBots">补电脑</button>');
    buttons.push('<button class="primary" type="button" data-action="start">开始</button>');
  }
  if (state.restartVote && !state.restartVote.viewerApproved) {
    buttons.push('<button class="primary" type="button" data-action="approveRestart">同意重开</button>');
    buttons.push('<button class="danger-quiet" type="button" data-action="rejectRestart">拒绝</button>');
  }
  if (state.undoVote && !state.undoVote.viewerApproved) {
    buttons.push('<button class="primary" type="button" data-action="approveUndo">同意悔棋</button>');
    buttons.push('<button class="danger-quiet" type="button" data-action="rejectUndo">拒绝悔棋</button>');
  }
  if (state.canSelfWin) buttons.push('<button class="win" type="button" data-action="selfWin">自摸</button>');
  if (state.canRon) buttons.push('<button class="win" type="button" data-action="ron">胡</button>');
  if (state.canKong) buttons.push('<button class="call" type="button" data-action="kong">明杠</button>');
  if (state.canPong) buttons.push('<button class="call" type="button" data-action="pong">碰</button>');
  if (state.canPass) buttons.push('<button type="button" data-action="pass">过</button>');
  for (const option of state.drillOptions || []) {
    buttons.push(`<button class="declare" type="button" data-declare-drill="${escapeHtml(option.key)}">钻了 · ${option.kind === "edge" ? "边" : "钻"}${escapeHtml(tileLabels[option.waitingTile])}</button>`);
  }
  for (const option of state.stackOptions || []) {
    buttons.push(`<button class="declare" type="button" data-declare-pung="${escapeHtml(option.key)}">${escapeHtml(option.label)}</button>`);
  }
  for (const option of state.concealedKongOptions || []) {
    buttons.push(`<button class="declare kong" type="button" data-concealed-kong="${escapeHtml(option.key)}">${escapeHtml(option.label)}</button>`);
  }
  return buttons.length ? buttons.join("") : `<span class="action-idle">${state.winner ? "本局已结算" : "等待牌局动作"}</span>`;
}

function renderInfoContent() {
  const fallbackStep = state.log.length;
  const restartButton = state.canRequestRestart
    ? '<button class="primary" type="button" data-action="requestRestart">重新开局</button>'
    : "";
  const undoButton = state.canRequestUndo
    ? '<button type="button" data-action="requestUndo">悔棋</button>'
    : "";
  const suggestionButton = adminUnlocked && state.canDiscard
    ? '<button class="suggestion-button" type="button" data-action="suggestDiscard">建议</button>'
    : "";
  return `<section class="room-panel"><div><small>房间号</small><strong>${state.roomId}</strong></div><button type="button" data-action="copy">复制</button>${suggestionButton}${undoButton}${restartButton}<button class="danger-quiet" type="button" data-action="leave">退出房间</button></section>
    ${adminSuggestion ? `<section class="suggestion-panel"><strong>推荐打 ${escapeHtml(adminSuggestion.tileName)}</strong><span>${escapeHtml(adminSuggestion.text)}</span></section>` : ""}
    ${state.waitingForReconnect ? `<section class="restart-status"><strong>等待真人玩家重新加入</strong><span>${escapeHtml(state.waitingForReconnect.names.join("、"))} 的座位不会由电脑接管</span></section>` : ""}
    ${renderDiceSummary()}
    ${state.restartVote ? `<section class="restart-status"><strong>重新开局确认中</strong><span>${state.restartVote.approvedSeats.length} 个真人座位已同意，人机默认同意</span></section>` : ""}
    ${state.undoVote ? `<section class="restart-status"><strong>悔棋确认中</strong><span>${state.undoVote.approvedSeats.length} 个真人座位已同意，人机默认同意</span></section>` : ""}
    ${renderResult()}
    <section class="score-panel"><h2>积分</h2>${state.players.filter(Boolean).map(renderScore).join("")}</section>
    <details class="log-panel" open><summary>牌局记录</summary><ol reversed>${state.log.map((entry, index) => `<li value="${entry.step || fallbackStep - index}">${escapeHtml(entry.text)}</li>`).join("")}</ol></details>`;
}

function renderScore(player) {
  const deltaClass = player.roundDelta > 0 ? "score-up" : player.roundDelta < 0 ? "score-down" : "";
  const role = player.delegated ? "电脑托管" : player.isBot ? "电脑" : "玩家";
  const kick = state.canKick && !player.isBot && player.seat !== state.viewerSeat
    ? `<button class="danger-quiet score-kick" type="button" data-kick-seat="${player.seat}" data-player-name="${escapeHtml(player.name)}">踢出</button>` : "";
  return `<div class="score-line ${kick ? "has-control" : ""} ${player.seat === state.viewerSeat ? "score-self" : ""}"><span class="wind">${player.wind}</span><span><strong>${escapeHtml(player.name)}</strong><small>${player.routeLabel || role}</small></span><b>${player.score}</b><em class="${deltaClass}">${player.roundDelta > 0 ? "+" : ""}${player.roundDelta}</em>${kick}</div>`;
}

function renderResult() {
  if (!state.roundResult?.items?.length) return "";
  return `<section class="result-panel"><h2>本局结算</h2><p>${escapeHtml(state.roundResult.text)}</p><ul>${state.roundResult.items.map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>${item.points}</strong></li>`).join("")}</ul></section>`;
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
  if (state.canKong) return "可以明杠这张牌";
  if (state.canPong) return "可以碰这张牌";
  if (state.canDiscard) return selectedTileId ? "再次点击选中的牌打出" : "选择一张牌";
  if (state.winner) return "本局结束";
  return "等待其他玩家";
}

function setLayoutMode(mode) {
  if (!["landscape", "portrait"].includes(mode)) return;
  layoutMode = mode;
  localStorage.setItem(LAYOUT_KEY, mode);
  const game = app.querySelector(".game");
  if (!game) return;
  game.classList.toggle("layout-landscape", mode === "landscape");
  game.classList.toggle("layout-portrait", mode === "portrait");
  game.querySelector(".layout-label").textContent = mode === "landscape" ? "横屏" : "竖屏";
  game.querySelectorAll("[data-layout-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.layoutMode === mode));
  });
  game.querySelector(".layout-menu").open = false;
}

function selectHandTile(button) {
  const id = button.dataset.handTileId;
  if (selectedTileId === id) {
    send({ type: "discard", tileId: id, tile: button.dataset.tile });
    return;
  }
  selectedTileId = id;
  app.querySelectorAll("[data-hand-tile-id]").forEach((tile) => tile.classList.toggle("is-selected", tile.dataset.handTileId === id));
  const preview = app.querySelector(".tile-preview");
  preview.innerHTML = `${renderTile({ tile: button.dataset.tile, tileId: id }, { size: "preview-size" })}<span>再次点击打出</span>`;
  preview.classList.add("is-visible");
  preview.setAttribute("aria-hidden", "false");
  const hint = app.querySelector(".turn-copy strong");
  if (hint) hint.textContent = "再次点击选中的牌打出";
}

function bindGameEvents() {
  app.querySelectorAll("[data-hand-tile-id]").forEach((button) => button.addEventListener("click", () => selectHandTile(button)));
  app.querySelectorAll("[data-layout-mode]").forEach((button) => button.addEventListener("click", () => setLayoutMode(button.dataset.layoutMode)));
  app.querySelectorAll("[data-declare-drill]").forEach((button) => button.addEventListener("click", () => send({ type: "declareDrill", key: button.dataset.declareDrill })));
  app.querySelectorAll("[data-declare-pung]").forEach((button) => button.addEventListener("click", () => send({ type: "declarePung", key: button.dataset.declarePung })));
  app.querySelectorAll("[data-concealed-kong]").forEach((button) => button.addEventListener("click", () => send({ type: "concealedKong", key: button.dataset.concealedKong })));
  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      if (action === "copy") {
        try { await navigator.clipboard.writeText(state.roomId); toast = "房间号已复制。"; }
        catch { toast = `房间号：${state.roomId}`; }
        render();
        return;
      }
      if (action === "requestRestart" && !window.confirm("确定发起重新开局吗？所有真人玩家同意后才会重开。")) return;
      if (action === "requestUndo" && !window.confirm("确定发起悔棋吗？所有真人玩家同意后才会退回上一操作节点。")) return;
      const messages = {
        leave: { type: "leave" }, addBots: { type: "addBots" }, start: { type: "start" }, requestRestart: { type: "requestRestart" }, requestUndo: { type: "requestUndo" },
        approveRestart: { type: "respondRestart", approved: true }, rejectRestart: { type: "respondRestart", approved: false },
        approveUndo: { type: "respondUndo", approved: true }, rejectUndo: { type: "respondUndo", approved: false },
        selfWin: { type: "selfWin" }, ron: { type: "ron" }, pong: { type: "pong" }, kong: { type: "kong" }, pass: { type: "pass" }
        , suggestDiscard: { type: "adminSuggestDiscard" }
      };
      if (messages[action]) send(messages[action]);
    });
  });
  app.querySelectorAll("[data-kick-seat]").forEach((button) => button.addEventListener("click", () => {
    if (window.confirm(`确定在开局前将 ${button.dataset.playerName} 移出房间吗？`)) send({ type: "kick", seat: Number(button.dataset.kickSeat) });
  }));
  bindAdminEvents();
}

function render() {
  if (!state) renderLobby();
  else renderGame();
}

connect();
render();
