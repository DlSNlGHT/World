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
  injectIntoWorldEngine: false,
  worldEngineMemoryLimit: 1,
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

  const latest = sandbox.MEMORY_ENGINE_DATA.defaultState();
  latest.personal_memory = [
    { id: 'char_000001', names: ['甲'], memory: { '': ['甲掌握秘密。'] } },
    { id: 'char_000002', names: ['乙'], memory: {} }
  ];
  const secretRecord = { ownerId: 'char_000001', time: '', memory: '甲掌握秘密。' };
  latest.knowledge_index = { '甲': [secretRecord], '乙': [secretRecord] };
  latest.event_memory.small_summaries = Array.from({ length: 12 }, (_, index) => ({
    id: `small_${String(index + 1).padStart(6, '0')}`, startLayer: index * 2 + 1, endLayer: index * 2 + 2, content: `纪要${index + 1}`
  }));
  latest.event_memory.big_summaries = [
    { id: 'big_000001', startLayer: 1, endLayer: 10, content: '总述一' },
    { id: 'big_000002', startLayer: 11, endLayer: 20, content: '总述二' }
  ];
  latest.event_memory.big_summary_cursor = 10;
  latest.entity_memory.organization = [{
    id: 'org_000001', name: '青石盟', description: '控制青石城商路。',
    history: [{ time: '昨日', event: '青石盟封锁北门。' }, { time: '今日', event: '青石盟开始盘查行人。' }]
  }];
  sandbox.MEMORY_ENGINE_DATA.saveState(latest);
  const oldCheckpoint = JSON.parse(JSON.stringify(latest));
  oldCheckpoint.event_memory.small_summaries = oldCheckpoint.event_memory.small_summaries.slice(0, 5);
  oldCheckpoint.event_memory.big_summaries = oldCheckpoint.event_memory.big_summaries.slice(0, 1);
  oldCheckpoint.event_memory.big_summary_cursor = 5;
  sandbox.MEMORY_ENGINE_DATA.saveCheckpoint(oldCheckpoint);
  const exported = sandbox.MEMORY_ENGINE_DATA.exportData();
  assert.strictEqual(exported.counts.state.minutes, 12, '完整 JSON 的 state 必须是最新当前纪要');
  assert.strictEqual(exported.counts.state.overviews, 2, '完整 JSON 的 state 必须是最新当前总述');
  assert.strictEqual(exported.counts.checkpoint.minutes, 5, '完整 JSON 必须同时保留并明确标记旧 checkpoint 纪要数');
  assert.strictEqual(exported.counts.checkpoint.overviews, 1, '完整 JSON 必须同时保留并明确标记旧 checkpoint 总述数');
  assert.strictEqual(JSON.stringify(exported.state.personal_memory[0].memories[0].known_by), JSON.stringify(['乙']), '当前状态导出必须把内部知识索引还原成 known_by');
  assert.strictEqual(JSON.stringify(exported.checkpoint.personal_memory[0].memories[0].known_by), JSON.stringify(['乙']), '存档点导出也必须保留 known_by');
  const roundTripped = sandbox.MEMORY_ENGINE_DATA.importData(exported);
  assert.ok(roundTripped.knowledge_index['乙'].some(record => record.memory === '甲掌握秘密。'), '导入 portable JSON 必须重建 knowledge_index');
  assert.strictEqual(sandbox.MEMORY_ENGINE_DATA.loadCheckpoint().event_memory.small_summaries.length, 5, '完整 JSON 导入必须恢复 checkpoint');
  sandbox.MEMORY_ENGINE.replaceKnownByRecords(roundTripped, 'char_000001', [
    { time: '', memory: '甲掌握秘密。', known_by: ['丙'] }
  ]);
  assert.ok(!roundTripped.knowledge_index['乙'], 'UI 修改知情人后必须移除旧 known_by 索引');
  assert.ok(roundTripped.knowledge_index['丙'].some(record => record.memory === '甲掌握秘密。'), 'UI 修改知情人后必须建立新 known_by 索引');
  sandbox.MEMORY_ENGINE_DATA.saveState(roundTripped);
  settings.injectIntoWorldEngine = true;
  const worldMemory = sandbox.MEMORY_ENGINE.buildWorldEngineContext({
    factions: [{ name: '青石盟', core_person: '丙' }],
    world_digest: '青石盟正在搜寻丙。'
  });
  assert.ok(worldMemory.includes('甲掌握秘密。'), '世界状态命中的人物必须注入其知晓的记忆');
  assert.ok(worldMemory.includes('青石盟开始盘查行人。'), '世界状态命中的实体必须注入最近历史');
  assert.ok(!worldMemory.includes('青石盟封锁北门。'), '世界引擎每个匹配条目的注入上限必须生效');
  assert.ok(!worldMemory.includes('纪要1') && !worldMemory.includes('总述一'), '注入世界引擎时不得携带纪要或总述');
  settings.injectIntoWorldEngine = false;
  assert.strictEqual(sandbox.MEMORY_ENGINE.buildWorldEngineContext({ factions: [{ name: '青石盟' }] }), '', '关闭跨引擎注入后必须返回空内容');

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
