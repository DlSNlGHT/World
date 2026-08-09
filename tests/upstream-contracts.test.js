const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const main = read('world-engine.js');
const elapsedBody = main.match(/function getElapsedReadRounds[\s\S]*?\n\s*}\n\n\s*function buildDialogueText/);
assert(elapsedBody, '应找到读取轮数锚点函数');
assert(!elapsedBody[0].includes('restoreCheckpoint'), '锚点函数不得暗中读取 checkpoint');
assert(main.includes("const dialogueBase = mode === 'redo' ? core.restoreCheckpoint() : state;"));
assert(main.includes('getElapsedReadRounds(cp || st, settings.evolveTimeMaxRounds)'));

const api = read('world-engine-api.js');
assert(api.includes('maxTokens: 8000'), 'Pigment 的 8000 token 默认值必须保留');
assert(!api.includes('maxTokens: 65000'), '不得移植上游 65000 token 默认值');
assert(api.includes('apiAutoRetries: 0'));
assert(api.includes('injectAllLevels: false'));

const evolution = read('world-engine-evolution.js');
assert(evolution.includes('attempt <= maxRetries'));
assert(evolution.includes('const distantEventRoll = rollDistantEvent(state)'));
assert(evolution.includes('const nearEventRoll = rollNearEvent(state)'));
assert(evolution.includes("localDistantEventCooldown', 5, 0"), 'Pigment 应允许随机事件冷却为 0');
assert(evolution.includes("localNearEventCooldown', 5, 0"), 'Pigment 应允许随机事件冷却为 0');
assert(evolution.includes('筹划、试探、调查起步或矛盾初现'));
assert(evolution.includes('传播可以处于起始阶段'));

const rules = read('world-engine-rules-loader.js');
assert(rules.includes('事项即使仍处于筹划、试探、调查起步或矛盾初现阶段'));
assert(rules.includes('不要求预先证明会持续多个轮次'));
assert(!rules.includes('只有同时满足以下条件，才允许创建事件链'));

const ui = read('world-engine-ui.js');
for (const id of [
  'we-api-auto-retries', 'we-inject-all-levels', 'we-local-near-chance',
  'we-local-near-cooldown', 'we-local-distant-threshold', 'we-local-distant-chance',
  'we-local-distant-cooldown'
]) assert(ui.includes(id), `设置 UI 缺少 ${id}`);

const css = read('style.css');
assert(css.includes(':root[data-we-theme="paper"]'));
assert(css.includes('.we-event-level-badge'));
assert(css.includes('--we-text3: #687481'));

console.log('upstream-contracts tests: anchor / exclusions / settings / prompts / themes passed');
