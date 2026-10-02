const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

test("手机布局状态只通过共享根容器类切换", () => {
  assert.match(appSource, /layout-landscape/);
  assert.match(appSource, /layout-portrait/);
  assert.match(appSource, /localStorage\.setItem\(LAYOUT_KEY, mode\)/);
  assert.match(appSource, /game\.classList\.toggle/);
});

test("手牌与四家弃牌使用固定槽位", () => {
  assert.match(appSource, /DISCARD_SLOTS = 30/);
  assert.match(appSource, /length: 13/);
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
