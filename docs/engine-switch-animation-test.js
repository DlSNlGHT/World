const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

assert.match(
  ui,
  /targetActive\s*=\s*Boolean\(callEngineFace\(target,\s*'isRunning'/,
  '右下角入口必须读取另一引擎的运行状态'
);
assert.match(
  ui,
  /classList\.toggle\('we-sat-engine-running',\s*targetActive\)/,
  '右下角入口必须随另一引擎状态切换运行动效类'
);
assert.match(
  css,
  /we-sat-target-memory\.we-sat-engine-running::before/,
  '记忆引擎入口必须有独立运行动效'
);
assert.match(
  css,
  /we-sat-target-world\.we-sat-engine-running::after/,
  '世界引擎入口必须有独立运行动效'
);

console.log('engine switch animation tests passed');
