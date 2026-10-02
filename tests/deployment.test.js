const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");

test("1Panel Compose uses the local Dockerfile instead of an application image pull", () => {
  assert.match(compose, /build:\s*\n\s+context: \.\s*\n\s+dockerfile: Dockerfile/);
  assert.doesNotMatch(compose, /^\s+image:/m);
  assert.match(compose, /container_name: dongguang-mahjong-v30/);
});

test("Docker keeps admin records in a writable persistent volume", () => {
  assert.match(dockerfile, /mkdir -p \/app\/data/);
  assert.match(compose, /majiang-data:\/app\/data/);
  assert.match(compose, /MAJIANG_DATA_VOLUME:-dongguang-mahjong-v30-data/);
  assert.match(dockerignore, /^data$/m);
});
