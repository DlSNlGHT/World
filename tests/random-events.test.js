const assert = require('assert');
const fs = require('fs');
const path = require('path');

let settings = {};
let descriptors = [];

globalThis.window = {
  WORLD_ENGINE_CORE: {},
  WORLD_ENGINE_API: { getSettings: () => settings },
  WORLD_ENGINE_RULES: { getActiveModuleDescriptors: () => descriptors },
  WORLD_ENGINE_PRESETS: {
    _VERDICT_ENGINE: {
      normalizeSingleAxis(config, value, fallback) {
        const result = {};
        for (const level of config.levels || []) result[level] = value && value[level] || fallback && fallback[level] || '';
        return result;
      }
    }
  }
};

const source = fs.readFileSync(path.join(__dirname, '..', 'world-engine-evolution.js'), 'utf8');
eval(source);

const randomEvents = window.WORLD_ENGINE_EVOLUTION._RANDOM_EVENTS;
assert(randomEvents, '随机事件测试接口应存在');

const builtin = (id, field) => ({ id, field, kind: 'builtin', enabled: true, container: 'array' });
const ledgerState = () => ({
  round: 8,
  memories: Array.from({ length: 10 }, (_, index) => ({
    type: 'ledger',
    round: 10 - index,
    changes: [{ type: 'event_new', summary: `旧记录${index}` }]
  })),
  distantEvent: { pending: false, cooldown: 0, sample: [], requestedRound: 0, requestedType: '' },
  nearEvent: { pending: false, cooldown: 0, requestedRound: 0, requestedType: '' }
});

// 纯自定义预设不能凭空写入 canonical events/winds。
descriptors = [{ id: 'cultivation', field: 'cultivation', kind: 'custom', enabled: true, container: 'array' }];
assert.deepStrictEqual(randomEvents.getRandomEventTargets(), { event: false, wind: false });
assert.strictEqual(randomEvents.rollNearEvent(ledgerState(), () => 0).reason, 'modules-disabled');

// 只启用事件链时，无论占比设置为何都只能选 event。
descriptors = [builtin('events', 'events')];
settings = { localNearEventChancePercent: 100, localNearEventEventPercent: 0 };
const eventOnly = ledgerState();
const eventOnlyRoll = randomEvents.rollNearEvent(eventOnly, () => 0);
assert.strictEqual(eventOnlyRoll.triggered, true);
assert.strictEqual(eventOnlyRoll.requestedType, 'event');

// 远端命中后固定样本和类型；合规对象被接纳、临时标记被清除，且允许 Pigment 冷却为 0。
descriptors = [builtin('events', 'events'), builtin('winds', 'winds')];
settings = {
  localDistantEventLedgerThreshold: 10,
  localDistantEventChancePercent: 100,
  localDistantEventEventPercent: 100,
  localDistantEventCooldown: 0
};
const distantState = ledgerState();
const distantRoll = randomEvents.rollDistantEvent(distantState, () => 0);
assert.strictEqual(distantRoll.triggered, true);
assert.strictEqual(distantRoll.requestedType, 'event');
assert.strictEqual(distantState.distantEvent.sample.length, 5);
const distantUpdate = {
  events: [{ id: 'invented', name: '北海港罢工', type: 'conflict', level: 2, _distanceGenerated: true }],
  winds: []
};
assert.strictEqual(randomEvents.acceptDistantEventResult(distantState, distantUpdate), true);
assert.strictEqual(distantUpdate.events[0].id, null);
assert.strictEqual('_distanceGenerated' in distantUpdate.events[0], false);
assert.strictEqual(distantState.distantEvent.pending, false);
assert.strictEqual(distantState.distantEvent.cooldown, 0);

// 类型或结构不匹配时丢弃伪结果并保持 pending，供下一轮重试。
const invalidState = ledgerState();
invalidState.distantEvent = {
  pending: true,
  cooldown: 0,
  sample: [{ round: 1, changes: [] }],
  requestedRound: 8,
  requestedType: 'event'
};
const invalidUpdate = {
  events: [],
  winds: [{ id: null, topic: '错误类型', content: '不应接纳', level: 2, _distanceGenerated: true }]
};
assert.strictEqual(randomEvents.acceptDistantEventResult(invalidState, invalidUpdate), false);
assert.strictEqual(invalidUpdate.winds.length, 0);
assert.strictEqual(invalidState.distantEvent.pending, true);

// 双标记对象必须被两套机制共同拒绝，不能因先清理一个标记而被后者误接纳。
const dualState = ledgerState();
dualState.nearEvent = { pending: true, cooldown: 0, requestedRound: 8, requestedType: 'event' };
const dualUpdate = {
  events: [{ id: null, name: '双标记', type: 'conflict', level: 2, _distanceGenerated: true, _nearGenerated: true }],
  winds: []
};
assert.strictEqual(randomEvents.acceptDistantEventResult(dualState, dualUpdate), false);
assert.strictEqual(randomEvents.acceptNearEventResult(dualState, dualUpdate), false);
assert.strictEqual(dualUpdate.events.length, 0);
assert.strictEqual(dualState.nearEvent.pending, true);

// 近端风声成功路径。
settings = {
  localNearEventChancePercent: 100,
  localNearEventEventPercent: 0,
  localNearEventCooldown: 0
};
const nearState = ledgerState();
const nearRoll = randomEvents.rollNearEvent(nearState, () => 0);
assert.strictEqual(nearRoll.requestedType, 'wind');
const nearUpdate = {
  events: [],
  winds: [{ id: 'invented', topic: '码头议论', content: '工钱将调整', level: 3, _nearGenerated: true }]
};
assert.strictEqual(randomEvents.acceptNearEventResult(nearState, nearUpdate), true);
assert.strictEqual(nearUpdate.winds[0].id, null);
assert.strictEqual('_nearGenerated' in nearUpdate.winds[0], false);
assert.strictEqual(nearState.nearEvent.cooldown, 0);

console.log('random-events tests: module gating / distant / near / validation passed');
