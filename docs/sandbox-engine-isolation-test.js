// 多引擎故障边界离线测试：node docs/sandbox-engine-isolation-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'world-engine.js'), 'utf8');

async function testExecutionCrashDoesNotBlockMemory() {
  let memoryInitCount = 0;
  const errors = [];
  const sandbox = {
    console: { log() {}, warn() {}, error(...args) { errors.push(args); } },
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: false }),
  };
  sandbox.window = sandbox;

  const install = filename => {
    const APIs = {
      'world-engine-store.js': ['WORLD_ENGINE_STORE', { hydrate: async () => {}, getItem() { return null; }, setItem() {} }],
      'world-engine-core.js': ['WORLD_ENGINE_CORE', { getChatId() { return 'test'; }, loadState() { return {}; } }],
      'world-engine-api.js': ['WORLD_ENGINE_API', { callApi: async () => '' }],
      'world-engine-worldbook.js': ['WORLD_ENGINE_WORLDBOOK', { buildPromptSection: async () => '' }],
      'world-engine-chatcache.js': ['WORLD_ENGINE_CHATCACHE', { init() {} }],
      'world-engine-inject-inspector.js': ['WORLD_ENGINE_INJECT_INSPECTOR', { init() {} }],
      'world-engine-preset.js': ['WORLD_ENGINE_PRESET', { getActivePreset() { return null; } }],
      'world-engine-rules-loader.js': ['WORLD_ENGINE_RULES', { loadRules: async () => ({ count: 0 }) }],
      'world-engine-ledger.js': ['WORLD_ENGINE_LEDGER', { recordChanges() {} }],
      // 故意不暴露 WORLD_ENGINE_EVOLUTION：模拟脚本执行期崩溃但 script.onload 仍触发。
      'world-engine-evolution.js': null,
      'world-engine-inject.js': ['WORLD_ENGINE_INJECT', { buildContext() { return ''; } }],
      'memory-engine-settings.js': ['MEMORY_ENGINE_SETTINGS', { getSettings() { return {}; }, patchSettings() {} }],
      'memory-engine-data.js': ['MEMORY_ENGINE_DATA', { loadState() { return { personal_memory: [] }; }, saveState() {} }],
      'memory-engine-prompt.js': ['MEMORY_ENGINE_PROMPT', { buildUserPrompt() { return ''; } }],
      'memory-engine-small-summary-prompt.js': ['MEMORY_ENGINE_SMALL_SUMMARY_PROMPT', { buildUserPrompt() { return ''; } }],
      'memory-engine-big-summary-prompt.js': ['MEMORY_ENGINE_BIG_SUMMARY_PROMPT', { buildUserPrompt() { return ''; } }],
      'memory-engine.js': ['MEMORY_ENGINE', {
        init() { memoryInitCount++; }, applyInjection() {}, abort() {}, isRunning() { return false; }
      }],
      'world-engine-diag.js': ['WORLD_ENGINE_DIAG', { collect() { return {}; }, download() {} }],
      'world-engine-ui.js': ['WORLD_ENGINE_UI', {
        buildPanel() {},
        // 再注入一个世界降级 UI 错误，验证 finally 边界仍会启动记忆。
        buildInputButton() { throw new Error('simulated world UI failure'); },
        refresh() {}
      }]
    };
    const entry = APIs[filename];
    if (entry) sandbox[entry[0]] = entry[1];
  };

  sandbox.document = {
    getElementsByTagName() { return [{ src: 'https://example.test/world-engine.js' }]; },
    createElement() { return {}; },
    head: {
      appendChild(script) {
        install(script.src.split('/').pop());
        queueMicrotask(() => script.onload());
      }
    }
  };

  vm.runInNewContext(source, sandbox, { filename: 'world-engine.js' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.strictEqual(memoryInitCount, 1, '世界模块/界面失败后，记忆引擎仍应独立初始化一次');
  assert.ok(errors.some(args => String(args[0]).includes('接口契约不完整') || String(args[0]).includes('模块加载失败')),
    '世界接口契约缺失应被明确记录');
}

async function testSharedEventGuardHandlesSyncAndAsyncErrors() {
  const sandbox = { window: null, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, fetch: async () => ({ ok: false }) };
  sandbox.window = sandbox;
  sandbox.document = {
    getElementsByTagName() { return [{ src: 'https://example.test/world-engine.js' }]; },
    createElement() { return {}; },
    head: { appendChild(script) { queueMicrotask(() => script.onerror()); } }
  };
  vm.runInNewContext(source, sandbox, { filename: 'world-engine.js' });
  const guard = sandbox.WORLD_ENGINE_GUARD_EVENT;
  assert.doesNotThrow(() => guard('测试引擎', '同步', () => { throw new Error('sync'); })());
  await assert.doesNotReject(() => guard('测试引擎', '异步', async () => { throw new Error('async'); })());
}

function testChatCacheOwnsChatLifecycle() {
  const cacheSource = fs.readFileSync(path.join(root, 'world-engine-chatcache.js'), 'utf8');
  const listeners = new Map();
  const store = { setSyncSink() {}, getItem() { return null; }, setItem() {}, removeItem() {} };
  const context = {
    chatId: null,
    event_types: { CHAT_LOADED: 'chat_loaded' },
    eventSource: { on(name, handler) { listeners.set(name, handler); } }
  };
  const sandbox = {
    window: null,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    SillyTavern: { getContext() { return context; } },
    WORLD_ENGINE_STORE: store,
    WORLD_ENGINE_GUARD_EVENT: (_engine, _event, handler) => handler
  };
  sandbox.window = sandbox;
  vm.runInNewContext(cacheSource, sandbox, { filename: 'world-engine-chatcache.js' });
  sandbox.WORLD_ENGINE_CHATCACHE.init();
  assert.strictEqual(typeof listeners.get('chat_loaded'), 'function', 'ChatCache 必须自行订阅 CHAT_LOADED');
  assert.throws(() => sandbox.WORLD_ENGINE_CHATCACHE.forScope('unknown-engine'), /未知聊天缓存 scope/);
}

(async () => {
  await testExecutionCrashDoesNotBlockMemory();
  await testSharedEventGuardHandlesSyncAndAsyncErrors();
  testChatCacheOwnsChatLifecycle();
  console.log('✓ 多引擎故障隔离测试通过');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
