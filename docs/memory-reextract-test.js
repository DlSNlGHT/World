const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const store = new Map();
const calls = [];
const uiStates = [];
const chat = [
  { is_user: false, name: '角色', mes: '开场白' },
  { is_user: true, name: '用户', mes: '第一轮用户正文' },
  { is_user: false, name: '角色', mes: '第一轮角色正文' },
  { is_user: true, name: '用户', mes: '辅助轮用户正文' },
  { is_user: false, name: '角色', mes: '辅助轮角色正文' },
  { is_user: true, name: '用户', mes: '目标轮用户正文' },
  { is_user: false, name: '角色', mes: '目标轮角色正文' }
];
const settings = {
  engineEnabled: true,
  firstLayerIsAiOpening: true,
  referenceRawRounds: 1,
  referenceSmallSummaryCount: 2,
  referenceBigSummaryCount: 1,
  bigSummaryEveryX: 1,
  bigSummaryInjectLimit: 3,
  maxTokens: 2000,
  temperature: 0.2,
  apiAutoRetries: 0,
  worldbookEnabled: false,
  injectIntoPrompt: true,
  searchDepth: 5,
  maxPerCharacter: 20,
  filterRegex: ''
};

const refs = (start, end) => chat.slice(start, end + 1).map((message, offset) => ({
  chatId: 'reextract-test',
  messageId: `floor-${start + offset}`,
  layer: start + offset,
  role: message.is_user ? 'user' : 'assistant',
  hash: `hash-${start + offset}`
}));
const digestRefs = list => (list || []).map(item => item.messageId).join('|');
const hashText = text => `digest:${text}`;
const refsToConversation = list => (list || []).map(ref => {
  const message = chat[ref.layer];
  return `【${message.is_user ? '用户' : '角色'}】${message.mes}`;
}).join('\n');

const sandbox = {
  window: null,
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  document: { getElementById() { return null; } },
  SillyTavern: { getContext() { return { chat, name1: '用户', name2: '角色', setExtensionPrompt() {} }; } },
  WORLD_ENGINE_STORE: {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  },
  WORLD_ENGINE_CORE: {
    getChatId() { return 'reextract-test'; },
    getChatLayer() { return chat.length - 1; },
    filterDialogue(value) { return value; }
  },
  WORLD_ENGINE_CHATCACHE: { forScope() { return { afterEvolution() {} }; } },
  WORLD_ENGINE_UI: {
    setMemoryEvolvingUI(active, label) {
      uiStates.push({ active, label, running: sandbox.MEMORY_ENGINE?.isRunning?.() || false });
    },
    refresh() {}
  },
  MEMORY_ENGINE_SETTINGS: { getSettings() { return { ...settings }; } },
  MEMORY_ENGINE_TIMELINE: {
    captureRange(start, end) { return refs(start, end); },
    auditRefs(list) { return { valid: true, refs: JSON.parse(JSON.stringify(list || [])), missing: [], changed: [] }; },
    digestRefs,
    refsToConversation,
    unionRefs(groups) { return groups.flat(); },
    hashText,
    syncHidden() { return Promise.resolve(); }
  },
  WORLD_ENGINE_API: { async callApi() { throw new Error('test API not configured'); } }
};
sandbox.window = sandbox;

for (const filename of [
  'memory-engine-data.js',
  'memory-engine-prompt.js',
  'memory-engine-small-summary-prompt.js',
  'memory-engine-big-summary-prompt.js',
  'memory-engine.js'
]) vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox, { filename });

function seedState() {
  const state = sandbox.MEMORY_ENGINE_DATA.defaultState();
  const oldSmallRefs = refs(1, 2), targetRefs = refs(5, 6);
  state.event_memory.small_summaries = [
    {
      id: 'small_000001', startLayer: 1, endLayer: 2, content: '更早纪要内容',
      sourceRefs: oldSmallRefs, sourceDigest: digestRefs(oldSmallRefs), originChatId: 'reextract-test', status: 'valid', revision: 1
    },
    {
      id: 'small_000002', startLayer: 5, endLayer: 6, content: '旧目标纪要',
      sourceRefs: targetRefs, sourceDigest: digestRefs(targetRefs), originChatId: 'reextract-test', status: 'valid', revision: 1
    }
  ];
  state.event_memory.small_summary_layer = 6;
  state.event_memory.big_summary_cursor = 1;
  state.event_memory.big_summaries = [{
    id: 'big_000001', startLayer: 1, endLayer: 2, content: '更早总述内容',
    childIds: ['small_000001'],
    childDigest: hashText(`small_000001:1:${digestRefs(oldSmallRefs)}`),
    sourceRefs: oldSmallRefs, originChatId: 'other-chat', status: 'valid', revision: 1
  }];
  state.timeline = {
    originChatId: 'reextract-test',
    root: {
      id: 'root:reextract-test', originChatId: 'reextract-test', createdAt: 1,
      base: { personal_memory: [], knowledge_index: {}, entity_memory: {}, entity_index: {}, round: 0, chatLayer: null }
    },
    nodes: [{
    id: 'memory_000001', kind: 'memory', originChatId: 'reextract-test', startLayer: 5, endLayer: 6,
    sourceRefs: targetRefs, sourceDigest: digestRefs(targetRefs),
    personal: [{ name: ['角色'], known_by: [], memory: '旧记忆', time: '' }], entities: {},
    status: 'valid', revision: 1, createdAt: 1, updatedAt: 1
    }]
  };
  sandbox.MEMORY_ENGINE_DATA.saveState(state);
}

(async () => {
  seedState();
  let activeSignal;
  sandbox.WORLD_ENGINE_API.callApi = async (_prompt, _maxTokens, _temperature, signal) => {
    activeSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true }));
  };
  const pending = sandbox.MEMORY_ENGINE.manualReextract();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(sandbox.MEMORY_ENGINE.isRunning(), true, '点击重新推演后必须立即进入运行态');
  assert.ok(activeSignal, '重新推演 API 必须收到可中止 signal');
  sandbox.MEMORY_ENGINE.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  const rolledBack = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(rolledBack.timeline.nodes[0].status, 'valid', '中止后必须恢复旧人物实体节点');
  assert.strictEqual(rolledBack.event_memory.small_summaries[1].status, 'valid', '中止后必须恢复旧纪要');

  calls.length = 0;
  sandbox.WORLD_ENGINE_API.callApi = async (prompt, _maxTokens, _temperature, signal) => {
    calls.push({ prompt, signal });
    if (prompt.includes('"big_summary": ""')) return JSON.stringify({ big_summary: '重新生成的总述' });
    return JSON.stringify({
      personal_memory: [{ name: ['角色'], known_by: [], memory: '重新生成的记忆', time: '' }],
      entity_updates: [],
      small_summary: '重新生成的目标纪要'
    });
  };
  const result = await sandbox.MEMORY_ENGINE.manualReextract();
  assert.strictEqual(calls.length, 2, '重新推演后满足阈值时必须继续执行总述推演');
  assert.ok(calls[0].prompt.includes('目标轮用户正文') && calls[0].prompt.includes('目标轮角色正文'), '必须重做刚才的目标正文');
  assert.ok(calls[0].prompt.includes('辅助轮用户正文') && calls[0].prompt.includes('辅助轮角色正文'), '必须按 X 设置携带辅助正文');
  assert.ok(calls[0].prompt.includes('更早纪要内容'), '必须按 Y 设置携带前置纪要');
  assert.ok(calls[0].prompt.includes('更早总述内容'), '必须按 Z 设置携带前置总述');
  assert.ok(calls.every(call => call.signal), '重新推演和后续总述都必须可中止');
  assert.ok(result.added >= 3, '成功结果必须返回人物记忆、纪要和总述的真实更新数');
  assert.strictEqual(result.updatedBig, 1);
  assert.ok(uiStates.some(item => item.active && item.running), '重新推演必须立即刷新运行动效');
  console.log('memory reextract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
