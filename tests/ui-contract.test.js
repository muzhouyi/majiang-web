const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("手机布局状态只通过共享根容器类切换", () => {
  assert.match(appSource, /layout-landscape/);
  assert.match(appSource, /layout-portrait/);
  assert.match(appSource, /localStorage\.setItem\(LAYOUT_KEY, mode\)/);
  assert.match(appSource, /game\.classList\.toggle/);
});

test("手牌与四家弃牌使用固定槽位", () => {
  assert.match(appSource, /DISCARD_SLOTS = 30/);
  assert.match(appSource, /length: 14/);
  assert.match(cssSource, /grid-template-columns: repeat\(6, var\(--discard-tile-width\)\)/);
  assert.match(cssSource, /flex-shrink: 0/);
  assert.doesNotMatch(cssSource, /margin:\s*-\d/);
});

test("最新弃牌、摸牌和选牌均按 tileId 追踪", () => {
  assert.match(appSource, /latestDiscardTileId/);
  assert.match(appSource, /drawnTileId/);
  assert.match(appSource, /selectedTileId/);
  assert.match(appSource, /data-discard-tile-id/);
});

test("弃牌使用透明外壳并从每行中央向两侧固定填充", () => {
  assert.match(appSource, /centeredSlot = \[3, 4, 2, 5, 1, 6\]/);
  assert.match(cssSource, /\.tile-discard\s*\{/);
  assert.match(cssSource, /border: 0; border-radius: 0; background: transparent; box-shadow: none/);
  assert.doesNotMatch(appSource, /discard-tiles/);
});

test("discard faces stay inside fixed slots and rotation preserves grid occupancy", () => {
  assert.match(cssSource, /\.discard-slot\s*\{[\s\S]*?overflow: hidden;[\s\S]*?contain: layout paint;/);
  assert.match(cssSource, /\.discard-face\s*\{[^}]*overflow: hidden;/);
  assert.match(cssSource, /\.tile-discard\s*\{[\s\S]*?overflow: hidden;/);
  assert.match(cssSource, /\.tile-discard\s*\{[\s\S]*?position: absolute; left: 50%; top: 50%;/);
  assert.match(cssSource, /\.discard-left \.tile-discard\s*\{ transform: translate\(-50%, -50%\) rotate\(90deg\); \}/);
  assert.match(cssSource, /\.discard-right \.tile-discard\s*\{ transform: translate\(-50%, -50%\) rotate\(-90deg\); \}/);
  assert.doesNotMatch(cssSource, /\.discard-(?:top|left|right) \.discard-face\s*\{[^}]*transform/);
});

test("标题恢复 v1.6 的红中麻将 SVG 且不叠加 CSS 白色牌身", () => {
  assert.match(appSource, /class="brand-mark admin-trigger"[^>]*>\$\{renderTile\("C"\)\}/);
  assert.match(appSource, /class="mini-mark admin-trigger"[^>]*>\$\{renderTile\("C", \{ size: "micro" \}\)\}/);
  assert.match(cssSource, /\.brand-mark \.tile\s*\{[\s\S]*?border: 0; background: transparent; box-shadow: none;/);
});

test("四家弃牌区的外框互不相交且所有横屏尺寸提供牌局按钮", () => {
  assert.match(cssSource, /\.discard-left\s*\{[\s\S]*?var\(--discard-tile-width\)[\s\S]*?9px/);
  assert.match(cssSource, /\.layout-landscape \.mobile-info\s*\{[\s\S]*?display: block/);
});

test("碰、钻了和上摞动作都会写入牌局记录", () => {
  assert.match(serverSource, /addLog\(room, `\$\{player\.name\} 碰了\$\{tileName\(claim\.tile\)\}/);
  assert.match(serverSource, /addLog\(room, `\$\{player\.name\} 明示钻了/);
  assert.match(serverSource, /addLog\(room, `\$\{player\.name\} 明示上摞/);
  assert.match(serverSource, /if \(meld\.stacked\) addLog\(room, `\$\{player\.name\} 按上摞路线/);
});

test("三名对手的信息条、牌背和明示牌使用独立定位层", () => {
  assert.match(appSource, /class="opponent-rack"/);
  assert.match(appSource, /class="opponent-melds"/);
  assert.match(cssSource, /\.seat-top \.seat-head\s*\{[^}]*left: 50%;[^}]*top: 0/);
  assert.match(cssSource, /\.seat-left \.opponent-hand, \.seat-right \.opponent-hand\s*\{[\s\S]*?grid-template-rows: repeat\(13/);
  assert.match(cssSource, /\.seat-left \.opponent-melds\s*\{[\s\S]*?rotate\(90deg\)/);
  assert.match(cssSource, /\.seat-right \.opponent-melds\s*\{[\s\S]*?rotate\(-90deg\)/);
});

test("横屏牌局内容只通过点击浮层显示", () => {
  assert.match(cssSource, /\.info-rail\s*\{ display: none; \}/);
  assert.doesNotMatch(cssSource, /\.layout-landscape \.info-rail\s*\{ display: block/);
  assert.match(cssSource, /\.layout-landscape \.mobile-info\s*\{[\s\S]*?display: block/);
});

test("牌局记录保留时间步骤号并将最新消息显示在上方", () => {
  assert.match(serverSource, /logSequence: 0/);
  assert.match(serverSource, /room\.log = \[\];\s*room\.logSequence = 0;[\s\S]*?room\.wall = makeDeck\(\)/);
  assert.match(serverSource, /room\.log\.unshift\(\{ step: room\.logSequence/);
  assert.doesNotMatch(serverSource, /room\.log = room\.log\.slice\(0, 24\)/);
  assert.match(appSource, /<ol reversed>/);
  assert.match(appSource, /<li value="\$\{entry\.step/);
});

test("管理入口必须六击红中并由服务端校验密码", () => {
  assert.match(appSource, /adminTapCount < 6/);
  assert.match(appSource, /type: "adminLogin"/);
  assert.match(serverSource, /ADMIN_PASSWORD = process\.env\.ADMIN_PASSWORD \|\| ""/);
  assert.match(serverSource, /crypto\.timingSafeEqual/);
});

test("管理面板包含积分、回放和真实玩家积分设置", () => {
  assert.match(appSource, /data-admin-tab="scoring"/);
  assert.match(appSource, /data-admin-tab="replay"/);
  assert.match(appSource, /data-admin-tab="players"/);
  assert.match(serverSource, /adminUpdateScoring/);
  assert.match(serverSource, /adminUpdateReplay/);
  assert.match(serverSource, /adminUpdatePlayer/);
});

test("管理者回放展示完整牌面并支持逐步前后切换", () => {
  assert.match(appSource, /class="replay-hand"/);
  assert.match(appSource, /renderMeld\(\{ \.\.\.meld, hidden: false \}\)/);
  assert.match(appSource, /data-replay-previous/);
  assert.match(appSource, /data-replay-next/);
  assert.match(appSource, /replayFrameIndex = 0/);
});

test("玩家积分累计可由管理者独立关闭", () => {
  assert.match(appSource, /data-player-scores-enabled/);
  assert.match(serverSource, /adminUpdatePlayerScores/);
  assert.match(serverSource, /if \(!adminData\.playerScores\.enabled\) return/);
});

test("管理者可以删除单局回放和单个玩家积分记录", () => {
  assert.match(appSource, /data-delete-replay/);
  assert.match(appSource, /data-delete-player/);
  assert.match(appSource, /window\.confirm\("确定删除这局牌局回放吗/);
  assert.match(serverSource, /data\.type === "adminDeleteReplay"/);
  assert.match(serverSource, /data\.type === "adminDeletePlayer"/);
  assert.match(serverSource, /adminData\.replays\.splice/);
  assert.match(serverSource, /delete adminData\.players\[playerId\]/);
});

test("明杠暗杠使用四张并进入现有明示牌架", () => {
  assert.match(appSource, /data-action="kong"/);
  assert.match(appSource, /data-concealed-kong/);
  assert.match(appSource, /meld-kong/);
  assert.match(serverSource, /type: "exposed-kong"/);
  assert.match(serverSource, /type: "concealed-kong"/);
  assert.match(serverSource, /drawForCurrent\(room, true\)/);
});

test("主界面大厅支持发现房间和原玩家重新加入", () => {
  assert.match(appSource, /id="directoryBtn">查看大厅/);
  assert.match(appSource, /type: "listRooms"/);
  assert.match(appSource, /data-directory-join/);
  assert.match(serverSource, /function roomDirectory/);
  assert.match(serverSource, /reconnectClient\(room, client\)/);
  assert.match(serverSource, /delegatedSeatForProfile/);
});

test("房主开局前可踢人且重新开局需要真人投票", () => {
  assert.match(appSource, /data-kick-seat/);
  assert.match(appSource, /type: "requestRestart"/);
  assert.match(appSource, /type: "respondRestart"/);
  assert.match(serverSource, /room\.phase === "waiting"[\s\S]*?data\.type === "kick"/);
  assert.match(serverSource, /function completeRestartVoteIfReady/);
  assert.match(serverSource, /seat && !seat\.isBot/);
});

test("管理员重命名和合并玩家前均要求二次确认", () => {
  assert.match(appSource, /data-rename-player/);
  assert.match(appSource, /id="mergePlayerForm"/);
  assert.match(appSource, /确定将玩家昵称改为/);
  assert.match(appSource, /来源记录会被删除/);
  assert.match(serverSource, /adminRenamePlayer/);
  assert.match(serverSource, /adminMergePlayers/);
  assert.match(serverSource, /target\.score = \(Number\(target\.score\)/);
});

test("横屏长动作文字保持完整并在空间不足时横向滚动", () => {
  assert.match(cssSource, /\.action-buttons\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-width:\s*max-content;/);
  assert.match(cssSource, /\.action-buttons button\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-width:\s*max-content;/);
  assert.match(cssSource, /\.layout-landscape \.action-dock\s*\{[\s\S]*?width:\s*min\(72dvw, 680px\);[\s\S]*?overflow-x:\s*auto;/);
  assert.doesNotMatch(cssSource, /max-width:\s*190px/);
});

test("空房间和结束房间由服务端定时解散并通知客户端", () => {
  assert.match(serverSource, /EMPTY_ROOM_TTL_MS[\s\S]*?60_000/);
  assert.match(serverSource, /ENDED_ROOM_TTL_MS[\s\S]*?180_000/);
  assert.match(serverSource, /function scheduleRoomCleanup/);
  assert.match(serverSource, /type: "roomClosed"/);
  assert.match(appSource, /payload\.type === "roomClosed"/);
});

test("当前玩家信息靠左且管理员可在大厅删除房间", () => {
  assert.match(cssSource, /\.seat-bottom\s*\{[^}]*left:\s*4%;[^}]*transform:\s*none;/);
  assert.match(appSource, /adminUnlocked[\s\S]*?data-directory-delete/);
  assert.match(appSource, /type: "adminDeleteRoom"/);
  assert.match(serverSource, /data\.type === "adminDeleteRoom"/);
  assert.match(serverSource, /const roomSweepTimer = setInterval/);
  assert.match(appSource, /lobbyRefreshTimer = setInterval/);
});

test("重新开局藏入牌局且横屏即时操作区固定右对齐", () => {
  const actionsSource = appSource.slice(appSource.indexOf("function renderActions()"), appSource.indexOf("function renderInfoContent()"));
  const infoSource = appSource.slice(appSource.indexOf("function renderInfoContent()"), appSource.indexOf("function renderScore("));
  assert.doesNotMatch(actionsSource, /data-action="requestRestart"/);
  assert.match(infoSource, /data-action="requestRestart"/);
  assert.match(cssSource, /\.layout-landscape \.action-dock\s*\{[\s\S]*?position:\s*fixed;[^}]*right:\s*max\(8px, env\(safe-area-inset-right\)\);[^}]*justify-content:\s*flex-end;/);
  assert.match(cssSource, /\.layout-landscape \.action-buttons\s*\{[^}]*margin-left:\s*auto;[^}]*justify-content:\s*flex-end;/);
  assert.match(cssSource, /\.layout-landscape \.turn-copy\s*\{\s*display:\s*none;/);
});
