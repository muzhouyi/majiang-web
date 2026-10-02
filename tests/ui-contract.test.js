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
  assert.match(appSource, /class="brand-mark">\$\{renderTile\("C"\)\}/);
  assert.match(appSource, /class="mini-mark">\$\{renderTile\("C", \{ size: "micro" \}\)\}/);
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
  assert.match(serverSource, /room\.log = \[\];\s*room\.logSequence = 0;\s*room\.wall = makeDeck\(\)/);
  assert.match(serverSource, /room\.log\.unshift\(\{ step: room\.logSequence/);
  assert.doesNotMatch(serverSource, /room\.log = room\.log\.slice\(0, 24\)/);
  assert.match(appSource, /<ol reversed>/);
  assert.match(appSource, /<li value="\$\{entry\.step/);
});
