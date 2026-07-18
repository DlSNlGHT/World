const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

assert.match(ui, /_memorySeenRecords = new Set\(\)/, '记忆数据需要记录首次展示状态');
assert.match(ui, /_memoryCollapsedRecords\.add\(key\)/, '记忆数据首次展示必须默认折叠');
assert.match(ui, /entity-category:\$\{type\}/, '实体必须按类型生成独立分类');
for (const label of ['组织', '物品', '能力', '地点']) assert.ok(ui.includes(label), `缺少实体分类：${label}`);
assert.match(ui, /items\.at\(-1\).*index: items\.length - 1/, '纪要和总述必须只选择最新一条');
assert.match(ui, /当前仅展示最新一条/, '纪要和总述应提示仅展示最新数据');
assert.match(css, /\.we-memory-entity-group > \.we-memory-record-body/, '实体分类需要独立布局样式');

console.log('memory UI layout tests passed');
