// 持续实体 ID 回归测试：node docs/sandbox-entity-id-test.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const storage = new Map();
global.window = global;
global.WORLD_ENGINE_STORE = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};

const coreSource = fs.readFileSync(path.join(__dirname, '..', 'world-engine-core.js'), 'utf8');
vm.runInThisContext(coreSource, { filename: 'world-engine-core.js' });
const core = global.WORLD_ENGINE_CORE;
const ledgerSource = fs.readFileSync(path.join(__dirname, '..', 'world-engine-ledger.js'), 'utf8');
vm.runInThisContext(ledgerSource, { filename: 'world-engine-ledger.js' });
const ledger = global.WORLD_ENGINE_LEDGER;

function legacyState() {
  const state = core.getDefaultState();
  state.events = [{ name: '旧事件甲' }, { name: '旧事件乙' }];
  state.factions = [{ name: '旧势力' }];
  state.worldTrends = [{ name: '旧大势' }];
  state.winds = [{ topic: '旧风声' }];
  state.enemies = [{ name: '旧仇敌' }];
  return state;
}

// 旧存档稳定补号，重复加载不改号。
const migrated = legacyState();
core.saveState(migrated);
assert.deepStrictEqual(migrated.events.map(x => x.id), ['event_1', 'event_2']);
assert.strictEqual(migrated.factions[0].id, 'faction_1');
assert.strictEqual(migrated.worldTrends[0].id, 'trend_1');
assert.strictEqual(migrated.winds[0].id, 'wind_1');
assert.strictEqual(migrated.enemies[0].id, 'enemy_1');
core.saveState(migrated);
assert.deepStrictEqual(migrated.events.map(x => x.id), ['event_1', 'event_2']);

// 旧版 current/checkpoint 顺序不同时，以 checkpoint 为祖先基准，current 继承其 ID。
storage.set('world_engine_default', JSON.stringify({
  ...core.getDefaultState(),
  events: [{ name: '当前新增' }, { name: '共同事件甲' }, { name: '共同事件乙' }]
}));
storage.set('world_engine_default_checkpoint', JSON.stringify({
  ...core.getDefaultState(),
  events: [{ name: '共同事件甲' }, { name: '共同事件乙' }]
}));
const alignedCheckpoint = core.restoreCheckpoint();
assert.strictEqual(alignedCheckpoint.events.find(x => x.name === '共同事件甲').id, 'event_1');
assert.strictEqual(alignedCheckpoint.events.find(x => x.name === '共同事件乙').id, 'event_2');
const alignedCurrent = core.loadState();
assert.strictEqual(alignedCurrent.events.find(x => x.name === '共同事件甲').id, 'event_1');
assert.strictEqual(alignedCurrent.events.find(x => x.name === '共同事件乙').id, 'event_2');
assert.strictEqual(alignedCurrent.events.find(x => x.name === '当前新增').id, 'event_3');

// 重复/非法 ID 修复，合法 ID 不重排。
migrated.events = [
  { id: 'event_7', name: '甲' },
  { id: 'event_7', name: '乙' },
  { id: 'wrong_9', name: '丙' }
];
core.saveState(migrated);
assert.deepStrictEqual(migrated.events.map(x => x.id), ['event_7', 'event_8', 'event_9']);

// 按 ID 更新允许改名；错误 ID 不得覆盖本地身份。
core.addEvent(migrated, { id: 'event_7', name: '甲改名', desc: '推进' });
assert.strictEqual(migrated.events.find(x => x.id === 'event_7').name, '甲改名');
core.addEvent(migrated, { id: 'event_999', name: '甲改名', desc: '兼容认领' });
assert.strictEqual(migrated.events.find(x => x.name === '甲改名').id, 'event_7');

// id:null 明确表示新对象；即使同名也不能误覆盖。
core.addEvent(migrated, { id: null, name: '甲改名', desc: '同名但不同事件' });
assert.strictEqual(migrated.events.filter(x => x.name === '甲改名').length, 2);
assert.ok(migrated.events.some(x => x.id === 'event_10'));

// 删除当前最大号后按当前时间线最大值继续，允许重 roll/恢复后的编号复用。
migrated.events = [{ id: 'event_1', name: '基底' }, { id: 'event_2', name: '将被撤销' }];
core.saveCheckpoint(migrated);
core.addEvent(migrated, { id: null, name: '第一次结果' });
assert.ok(migrated.events.some(x => x.id === 'event_3'));
const restored = core.restoreCheckpoint();
core.addEvent(restored, { id: null, name: '重 roll 后结果' });
assert.strictEqual(restored.events.find(x => x.name === '重 roll 后结果').id, 'event_3');

// 五类实体均按自身前缀独立递增。
const typed = core.getDefaultState();
core.addFaction(typed, { id: null, name: '势力甲' });
core.addWorldTrend(typed, { id: null, name: '大势甲' });
core.addWind(typed, { id: null, topic: '风声甲' });
core.addEnemy(typed, { id: null, name: '仇敌甲' });
assert.strictEqual(typed.factions[0].id, 'faction_1');
assert.strictEqual(typed.worldTrends[0].id, 'trend_1');
assert.strictEqual(typed.winds[0].id, 'wind_1');
assert.strictEqual(typed.enemies[0].id, 'enemy_1');

// 账本按 ID 识别改名：同一事件改名仍是推进，同一风声改 topic 不应记为新增。
const before = core.getDefaultState();
before.round = 4;
before.events = [{ id: 'event_1', name: '旧标题', type: 'conflict', level: 3, stage: '萌芽', desc: '旧' }];
before.winds = [{ id: 'wind_1', topic: '旧话题', level: 3, content: '旧' }];
core.saveCheckpoint(before);
const after = JSON.parse(JSON.stringify(before));
after.round = 5;
after.events[0].name = '新标题';
after.events[0].stage = '发酵';
after.winds[0].topic = '新话题';
ledger.recordChanges(after);
const ledgerChanges = after.memories[0].changes;
assert.strictEqual(ledgerChanges.filter(x => x.type === 'event_advance').length, 1);
assert.strictEqual(ledgerChanges.filter(x => x.type === 'wind_new').length, 0);

// evolution 必须把身份协议置于不可被自定义预设覆盖的主 prompt 中。
const evolutionSource = fs.readFileSync(path.join(__dirname, '..', 'world-engine-evolution.js'), 'utf8');
assert.match(evolutionSource, /ENTITY_ID_PROTOCOL/);
assert.match(evolutionSource, /id: e\.id/);
assert.match(evolutionSource, /id: f\.id/);

console.log('entity id tests passed');
