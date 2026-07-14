// 事件记忆离线测试：node docs/memory-event-summary-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const storeMap = new Map();
const calls = [];
const listeners = new Map();
const runningLabels = [];
const settings = {
  engineEnabled: true,
  firstLayerIsAiOpening: true,
  evolveMode: 'auto',
  evolveEveryX: 2,
  evolveReadRounds: 2,
  manualReadRounds: 2,
  smallSummaryEveryX: 2,
  bigSummaryEveryX: 1,
  injectIntoPrompt: true,
  searchDepth: 5,
  maxPerCharacter: 20,
  maxTokens: 2000,
  temperature: 0.2,
  apiAutoRetries: 0,
  backfillBatchSize: 2,
  summaryBackfillSmallEveryX: 2,
  summaryBackfillBigEveryX: 1,
  backfillRetries: 0,
  backfillEndLayer: 0,
  filterRegex: ''
};
const chat = [
  { is_user: false, name: '角色', mes: '这是角色卡的开场白，不应进入纪要或批量重填。' },
  { is_user: true, name: '用户', mes: '进入城镇。' },
  { is_user: false, name: '角色', mes: '发现城门已经关闭。' },
  { is_user: true, name: '用户', mes: '询问守卫。' },
  { is_user: false, name: '角色', mes: '守卫说明北方发生叛乱。' }
];
const context = {
  chat,
  name1: '用户',
  name2: '角色',
  setExtensionPrompt() {},
  eventSource: { on(name, handler) { listeners.set(name, handler); } },
  event_types: { GENERATION_ENDED: 'generation_ended' }
};
const sandbox = {
  window: null,
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  document: { getElementById() { return null; } },
  SillyTavern: { getContext() { return context; } },
  WORLD_ENGINE_STORE: {
    getItem(key) { return storeMap.has(key) ? storeMap.get(key) : null; },
    setItem(key, value) { storeMap.set(key, String(value)); },
    removeItem(key) { storeMap.delete(key); }
  },
  WORLD_ENGINE_CORE: {
    getChatId() { return 'summary-test'; },
    filterDialogue(value) { return value; }
  },
  WORLD_ENGINE_WORLDBOOK: { async buildPromptSection() { return ''; } },
  WORLD_ENGINE_CHATCACHE: { forScope() { return { afterEvolution() {}, createSnapshot() {} }; } },
  WORLD_ENGINE_UI: { setMemoryEvolvingUI(active, label) { if (active) runningLabels.push(label); } },
  MEMORY_ENGINE_SETTINGS: { getSettings() { return { ...settings }; } },
  WORLD_ENGINE_API: {
    async callApi(prompt) {
      calls.push(prompt);
      const result = {};
      if (prompt.includes('"personal_memory": []')) {
        result.personal_memory = [{ name: ['角色'], known_by: [], memory: '角色得知北方发生叛乱。', time: '' }];
        result.entity_updates = [];
      }
      if (prompt.includes('"small_summary": ""')) result.small_summary = '角色发现城门关闭，并从守卫处得知北方发生叛乱。';
      if (prompt.includes('"big_summary": ""')) result.big_summary = '角色抵达城镇后发现城门关闭，并获悉北方叛乱正在影响当地。';
      return JSON.stringify(result);
    }
  }
};
sandbox.window = sandbox;

for (const filename of [
  'memory-engine-data.js',
  'memory-engine-prompt.js',
  'memory-engine-small-summary-prompt.js',
  'memory-engine-big-summary-prompt.js',
  'memory-engine.js'
]) {
  vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox, { filename });
}

(async () => {
  const combined = await sandbox.MEMORY_ENGINE.manualSmallSummary();
  assert.strictEqual(calls.length, 2, '达到阈值时应先生成并保存小总结，再独立请求大总结');
  assert.ok(calls[0].includes('事件记忆的小总结器'));
  assert.ok(!calls[0].includes('这是角色卡的开场白'), '初始化纪要必须忽略第 0 层 AI 开场白');
  assert.ok(calls[0].includes('守卫说明北方发生叛乱'), '忽略开场白后仍应读取窗口内最新的 AI 回复');
  assert.ok(!calls[0].includes('事件记忆的大总结器'));
  assert.ok(!calls[0].includes('"personal_memory": []'), '未到人物实体任务时不应携带人物实体输出字段');
  assert.ok(calls[1].includes('事件记忆的大总结器'));
  assert.ok(!calls[1].includes('事件记忆的小总结器'));
  assert.ok(!calls[1].includes('【最新对话片段】'), '大总结只能读取已落库的小总结与既有大总结');
  assert.deepStrictEqual(runningLabels.slice(0, 2), ['小总结', '大总结']);
  assert.strictEqual(combined.addedSmall, 1);
  assert.strictEqual(combined.updatedBig, 1);
  let state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(state.event_memory.small_summaries.length, 1);
  assert.strictEqual(state.event_memory.big_summary_cursor, 1);
  const checkpointAfterCombined = sandbox.MEMORY_ENGINE_DATA.loadCheckpoint();
  assert.strictEqual(checkpointAfterCombined.event_memory.small_summaries.length, 0,
    '链式大总结不得覆盖小总结请求之前建立的 checkpoint');

  settings.firstLayerIsAiOpening = false;
  sandbox.MEMORY_ENGINE_DATA.saveState(sandbox.MEMORY_ENGINE_DATA.defaultState());
  calls.length = 0;
  await sandbox.MEMORY_ENGINE.manualSmallSummary();
  assert.ok(calls[0].includes('这是角色卡的开场白'), '取消“首楼为 AI 开场白”后，第 0 层必须正常参与纪要');
  settings.firstLayerIsAiOpening = true;

  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  state.personal_memory = [{ id: 'char_000001', names: ['保留人物'], memory: {}, }];
  sandbox.MEMORY_ENGINE_DATA.saveState(state);
  calls.length = 0;
  runningLabels.length = 0;
  await sandbox.MEMORY_ENGINE.backfillSummaries();
  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(state.personal_memory[0].names[0], '保留人物', '大小总结回填不得清理人物实体');
  assert.ok(state.event_memory.small_summaries.length > 0);

  const summaryBeforePersonBackfill = JSON.stringify(state.event_memory);
  calls.length = 0;
  await sandbox.MEMORY_ENGINE.backfill();
  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(JSON.stringify(state.event_memory), summaryBeforePersonBackfill, '人物实体回填不得清理大小总结');
  assert.ok(state.personal_memory.some(item => item.names.includes('角色')));

  state.event_memory.big_summary_cursor = Math.max(0, state.event_memory.small_summaries.length - 1);
  sandbox.MEMORY_ENGINE_DATA.saveState(state);
  calls.length = 0;
  await sandbox.MEMORY_ENGINE.manualBigSummary();
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].includes('事件记忆的大总结器'));
  assert.ok(!calls[0].includes('事件记忆的小总结器'), '手动大总结只应携带大总结 Prompt');
  assert.ok(!calls[0].includes('"personal_memory": []'));

  sandbox.MEMORY_ENGINE_DATA.saveState(sandbox.MEMORY_ENGINE_DATA.defaultState());
  calls.length = 0;
  runningLabels.length = 0;
  sandbox.MEMORY_ENGINE.init();
  listeners.get('generation_ended')();
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.strictEqual(calls.length, 2, '人物实体与小总结同轮合并一次，大总结随后独立请求');
  assert.ok(calls[0].includes('"personal_memory": []'));
  assert.ok(calls[0].includes('事件记忆的小总结器'));
  assert.ok(!calls[0].includes('事件记忆的大总结器'));
  assert.ok(calls[1].includes('事件记忆的大总结器'));
  assert.ok(!calls[1].includes('"personal_memory": []'));
  assert.deepStrictEqual(runningLabels, ['人物/实体与小总结', '大总结']);

  console.log('✓ 事件记忆大小总结测试通过');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
