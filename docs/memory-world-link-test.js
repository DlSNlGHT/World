// 世界→记忆联动与指数注入离线测试：node docs/memory-world-link-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const store = new Map();
let version = 'A';
const chat = [{ is_user: false, name: '角色', mes: '测试场景' }];
const memorySettings = {
  engineEnabled: true,
  bigSummaryEveryX: 1,
  injectIntoPrompt: false,
  maxTokens: 2000,
  temperature: 0.2,
  apiAutoRetries: 0,
  filterRegex: ''
};

const sandbox = {
  window: null,
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  document: { getElementById() { return null; } },
  SillyTavern: { getContext() { return { chat }; } },
  WORLD_ENGINE_STORE: {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  },
  WORLD_ENGINE_CORE: {
    getChatId() { return 'world-link-test'; },
    getChatLayer() { return 20; },
    filterDialogue(value) { return value; }
  },
  WORLD_ENGINE_CHATCACHE: { forScope() { return { afterEvolution() {} }; } },
  WORLD_ENGINE_UI: { setMemoryEvolvingUI() {} },
  MEMORY_ENGINE_SETTINGS: { getSettings() { return { ...memorySettings }; } },
  WORLD_ENGINE_API: {
    getSettings() { return { memoryLinkEnabled: true }; },
    async callApi(prompt) {
      if (prompt.includes('"big_summary": ""')) {
        return JSON.stringify({ big_summary: `总述${version}` });
      }
      return JSON.stringify({
        personal_memory: [{ name: ['甲'], known_by: [], memory: `甲记住世界版本${version}。`, time: '' }],
        entity_updates: [{
          type: 'location', name: '城门', description: `城门状态${version}`, event: `城门发生变化${version}。`, time: ''
        }]
      });
    }
  }
};
sandbox.window = sandbox;

for (const file of [
  'memory-engine-data.js', 'memory-engine-prompt.js', 'memory-engine-small-summary-prompt.js',
  'memory-engine-big-summary-prompt.js', 'memory-engine.js'
]) {
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

(async () => {
  await sandbox.MEMORY_ENGINE.ingestWorldEvolution({
    layer: 20, worldDigest: '世界摘要A', worldUpdate: { world_digest: '世界摘要A' }, replace: false
  });
  let state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(state.event_memory.small_summaries.length, 1);
  assert.strictEqual(state.event_memory.small_summaries[0].content, '世界摘要A');
  assert.strictEqual(state.event_memory.small_summaries[0].source, 'world_engine');
  assert.strictEqual(state.event_memory.big_summaries[0].content, '总述A');
  assert.ok(JSON.stringify(state).includes('版本A'));

  assert.strictEqual(sandbox.MEMORY_ENGINE._test.rollbackLinkedLayer(20), true);
  version = 'B';
  await sandbox.MEMORY_ENGINE.ingestWorldEvolution({
    layer: 20, worldDigest: '世界摘要B', worldUpdate: { world_digest: '世界摘要B' }, replace: true
  });
  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes('摘要A') && !serialized.includes('版本A') && !serialized.includes('总述A'),
    '同楼层重 roll 后不得残留旧人物、实体、纪要或总述');
  assert.ok(serialized.includes('摘要B') && serialized.includes('版本B') && serialized.includes('总述B'));
  assert.strictEqual(state.event_memory.small_summaries.length, 1, '重 roll 应替换而不是追加世界摘要纪要');
  assert.strictEqual(state.event_memory.big_summaries.length, 1, '受影响总述应重算而不是追加');

  const items = Array.from({ length: 5 }, (_, index) => `记忆${index}`); // 旧 → 新
  const newest = sandbox.MEMORY_ENGINE._test.exponentialMemorySample(items, 1, () => 0.5, 10000);
  assert.deepStrictEqual(Array.from(newest), ['记忆4'], '相同骰值下，指数权重必须优先选择最新记忆');
  let rollIndex = 0;
  const oldestWins = sandbox.MEMORY_ENGINE._test.exponentialMemorySample(
    items, 1, () => (rollIndex++ === 0 ? 0.9999 : 0), 10000
  );
  assert.deepStrictEqual(Array.from(oldestWins), ['记忆0'], '最旧记忆必须保留可由 1d10000 命中的非零机会');

  console.log('memory world link tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
