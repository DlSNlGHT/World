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
const startSignals = [];
let injectionContent = '';
const settings = {
  engineEnabled: true,
  firstLayerIsAiOpening: true,
  evolveMode: 'auto',
  evolveEveryX: 2,
  evolveReadRounds: 2,
  manualReadRounds: 2,
  smallSummaryEveryX: 2,
  bigSummaryEveryX: 1,
  bigSummaryInjectLimit: 3,
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
  setExtensionPrompt(_name, content) { injectionContent = content; },
  eventSource: { on(name, handler) { listeners.set(name, handler); } },
  event_types: { GENERATION_ENDED: 'generation_ended' }
};
const sandbox = {
  window: null,
  __WE_SetExternalStatus(text) { if (String(text).startsWith('正在进行')) startSignals.push('status'); },
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
    getChatLayer() { return chat.length - 1; },
    filterDialogue(value) { return value; }
  },
  WORLD_ENGINE_WORLDBOOK: { async buildPromptSection() { return ''; } },
  WORLD_ENGINE_CHATCACHE: { forScope() { return { afterEvolution() {}, createSnapshot() {} }; } },
  WORLD_ENGINE_UI: { setMemoryEvolvingUI(active, label) { if (active) { runningLabels.push(label); startSignals.push('ui'); } } },
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
  assert.ok(!calls[1].includes('既有故事总览'), '总述只能读取本批尚未整理的纪要');
  assert.ok(!calls[1].includes('事件记忆的小总结器'));
  assert.ok(!calls[1].includes('【最新对话片段】'), '大总结只能读取已落库的小总结与既有大总结');
  assert.deepStrictEqual(runningLabels.slice(0, 2), ['小总结', '大总结']);
  assert.deepStrictEqual(startSignals.slice(0, 4), ['status', 'ui', 'status', 'ui'],
    '顶部提示必须先于记忆球运行态刷新，否则会清除自动动画类');
  assert.strictEqual(combined.addedSmall, 1);
  assert.strictEqual(combined.updatedBig, 1);
  let state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(state.event_memory.small_summaries.length, 1);
  assert.strictEqual(state.event_memory.big_summary_cursor, 1);
  assert.strictEqual(state.event_memory.big_summaries.length, 1);
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
  assert.strictEqual(state.event_memory.big_summaries.length, state.event_memory.small_summaries.length,
    '每批一条纪要时应逐条追加总述，不得滚动覆盖');

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

  const legacy = sandbox.MEMORY_ENGINE_DATA.defaultState();
  delete legacy.event_memory.big_summaries;
  legacy.event_memory.big_summary = { startLayer: 1, endLayer: 4, content: '旧版滚动总述' };
  sandbox.MEMORY_ENGINE_DATA.saveState(legacy);
  assert.strictEqual(sandbox.MEMORY_ENGINE_DATA.loadState().event_memory.big_summaries[0].content, '旧版滚动总述',
    '旧版单条总述必须自动迁移为总述列表');

  const portable = sandbox.MEMORY_ENGINE_DATA.defaultState();
  portable.chatLayer = 99;
  portable.event_memory.small_summary_layer = 88;
  portable.event_memory.small_summaries = [
    { id: 'small_000001', startLayer: 1, endLayer: 2, content: '旧纪要一' },
    { id: 'small_000002', startLayer: 3, endLayer: 4, content: '旧纪要二' },
    { id: 'small_000003', startLayer: 5, endLayer: 6, content: '尚未整理纪要' }
  ];
  const importedLongSummary = '用户手工合并：' + '长'.repeat(700);
  portable.event_memory.big_summaries = [
    { id: 'big_000001', startLayer: 1, endLayer: 2, content: '旧总述' },
    { id: 'big_000002', startLayer: 3, endLayer: 4, content: importedLongSummary }
  ];
  portable.event_memory.big_summary_cursor = 2;
  const imported = sandbox.MEMORY_ENGINE_DATA.importData({
    __memoryEngineData: true,
    chatId: 'another-chat',
    state: portable,
    checkpoint: portable
  });
  assert.strictEqual(imported.chatLayer, chat.length - 1, '跨聊天导入的人物实体进度必须衔接当前最后一层');
  assert.strictEqual(imported.event_memory.small_summary_layer, chat.length - 1, '跨聊天导入的纪要进度必须衔接当前最后一层');
  assert.strictEqual(imported.event_memory.big_summary_cursor, 2, '总述整理游标对应导入纪要，不能按聊天楼层重置');
  assert.strictEqual(imported.event_memory.big_summaries[1].content, importedLongSummary, 'JSON 导入的超长总述不得截断');
  assert.strictEqual(sandbox.MEMORY_ENGINE_DATA.loadCheckpoint().chatLayer, chat.length - 1, '导入存档点也必须重定位到当前聊天');

  settings.bigSummaryInjectLimit = 1;
  sandbox.MEMORY_ENGINE.applyInjection();
  assert.ok(injectionContent.includes(importedLongSummary), '应完整注入最新总述');
  assert.ok(!injectionContent.includes('旧总述'), '超过上限的旧总述不应注入');
  assert.ok(injectionContent.includes('尚未整理纪要'), '未整理纪要不受总述条数上限影响');
  settings.bigSummaryInjectLimit = 3;

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
