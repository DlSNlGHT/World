const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// —— 全等级注入开关 ——
let injectSettings = { injectAllLevels: false, injectMaxChars: 0 };
globalThis.window = {
  WORLD_ENGINE_CORE: {},
  WORLD_ENGINE_LEDGER: {},
  WORLD_ENGINE_API: { getSettings: () => injectSettings },
  WORLD_ENGINE_RULES: { getCoreRulesSummary: () => '' }
};
eval(fs.readFileSync(path.join(root, 'world-engine-inject.js'), 'utf8'));

const worldState = {
  round: 1,
  worldDigest: '测试',
  events: [
    { name: '低阶事件', type: 'conflict', level: 1, stage: '萌芽', stageRound: 1 },
    { name: '高阶事件', type: 'conflict', level: 3, stage: '发酵', stageRound: 2 }
  ],
  winds: [
    { topic: '低阶风声', type: 'report', level: 1, content: '低阶消息', scope: '村落' },
    { topic: '高阶风声', type: 'report', level: 3, content: '高阶消息', scope: '郡城' }
  ],
  factions: [], worldTrends: [], enemies: [], influenceChain: [],
  reputation: {}, economy: { climate: '平稳', signals: [] },
  regionalIncident: {}, blackbox: { secretActions: [], secretAssets: [] }
};

let context = window.WORLD_ENGINE_INJECT.buildContext(worldState, []);
assert(!context.includes('低阶事件'));
assert(!context.includes('低阶消息'));
assert(context.includes('高阶事件'));
assert(context.includes('高阶消息'));

injectSettings = { injectAllLevels: true, injectMaxChars: 0 };
context = window.WORLD_ENGINE_INJECT.buildContext(worldState, []);
assert(context.includes('低阶事件'));
assert(context.includes('低阶消息'));

// —— API fault 自动重试：通过真实 evolve() 验证尝试次数和终态 ——
const mem = {};
globalThis.SillyTavern = { getContext: () => ({ chat: [], characters: [], characterId: 0, name1: 'User', name2: 'Char' }) };
globalThis.window = {
  SillyTavern: globalThis.SillyTavern,
  WORLD_ENGINE_STORE: {
    hydrate: async () => {}, keys: () => Object.keys(mem),
    getItem: key => mem[key] !== undefined ? mem[key] : null,
    setItem: (key, value) => { mem[key] = value; },
    removeItem: key => { delete mem[key]; }
  }
};
const load = file => eval.call(globalThis, fs.readFileSync(path.join(root, file), 'utf8'));
load('world-engine-core.js');
load('world-engine-presets.js');
load('world-engine-rules-loader.js');

const core = window.WORLD_ENGINE_CORE;
core.hasState = () => true;
core.isNewRound = () => true;
core.restoreCheckpoint = () => null;
core.saveCheckpoint = () => {};
core.saveFingerprint = () => {};
core.getChatFingerprint = () => 'fp';
core.saveStateWithLayer = () => {};
core.saveState = () => {};
core.getUserPersona = () => '';
core.getUserName = () => 'User';

let apiCalls = 0;
let failuresBeforeSuccess = 2;
window.WORLD_ENGINE_API = {
  async callApi() {
    apiCalls++;
    if (apiCalls <= failuresBeforeSuccess) throw new Error('mock fault');
    return JSON.stringify({ winds: [] });
  },
  parseJSON: JSON.parse,
  getSettings: () => ({
    apiAutoRetries: 2,
    localNearEventChancePercent: 0,
    localDistantEventChancePercent: 0,
    localRegionalIncidentChancePercent: 0
  })
};
window.WORLD_ENGINE_WORLDBOOK = undefined;
load('world-engine-evolution.js');
const evolution = window.WORLD_ENGINE_EVOLUTION;

(async () => {
  let state = core.getDefaultState();
  assert.strictEqual(await evolution.evolve(state, 'u', 'a', { mode: 'forward', dialogueText: '' }), true);
  assert.strictEqual(apiCalls, 3, '两次 fault 后第三次应成功');

  apiCalls = 0;
  failuresBeforeSuccess = 99;
  state = core.getDefaultState();
  assert.strictEqual(await evolution.evolve(state, 'u', 'a', { mode: 'forward', dialogueText: '' }), false);
  assert.strictEqual(apiCalls, 3, '首次请求加两次自动重试后应停止');
  assert(/已自动重试 2 次/.test(evolution.getLastError() || ''));

  console.log('injection-retry tests: level filter / retry success / retry exhaustion passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
