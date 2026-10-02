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

test("the title uses a transparent glyph instead of a complete tile SVG", () => {
  assert.match(appSource, /function renderBrandGlyph\(\)/);
  assert.match(appSource, /class="brand-mark">\$\{renderBrandGlyph\(\)\}/);
  assert.match(appSource, /class="mini-mark">\$\{renderBrandGlyph\(\)\}/);
  assert.doesNotMatch(appSource, /class="brand-mark">\$\{renderTile\("C"\)/);
});
