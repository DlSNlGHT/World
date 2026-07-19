// world-engine.js — 主入口：加载模块，绑定事件，注入推演
(function() {
  if (window.__WORLD_ENGINE_LOADED__) return;
  window.__WORLD_ENGINE_LOADED__ = true;

  // ST 会在正式组装 prompt 前 await 此函数；这里只撤下失效摘要并恢复原文，绝不调用 API。
  // 历史记忆的 API 修复统一留到本轮 AI 回复完成后执行。
  window.worldEngineMemoryGenerateInterceptor = async function(_chat, _contextSize, _abort, _type) {
    try {
      await window.MEMORY_ENGINE?.prepareHistoryForGeneration?.();
    } catch (error) {
      // 本地撤旧失败不阻断正常聊天；这里没有后台 API 请求。
      console.error('[记忆引擎] 生成前撤下失效摘要失败', error);
    }
  };

  // 所有引擎共用同一事件故障边界：同步异常与异步 rejection 都只记到所属引擎。
  window.WORLD_ENGINE_GUARD_EVENT = function(engineLabel, eventLabel, handler) {
    return function(...args) {
      try {
        const result = handler(...args);
        if (result && typeof result.then === 'function') {
          return result.catch(error => {
            console.error(`[${engineLabel}] ${eventLabel}事件处理失败`, error);
          });
        }
        return result;
      } catch (error) {
        console.error(`[${engineLabel}] ${eventLabel}事件处理失败`, error);
      }
    };
  };

  const SHARED_MODULES = [
    'world-engine-store.js',
    'world-engine-core.js',
    'world-engine-api.js',
    'world-engine-worldbook.js',
    'world-engine-chatcache.js',
    'world-engine-inject-inspector.js'
  ];
  const SHARED_CONTRACTS = {
    WORLD_ENGINE_STORE: ['hydrate', 'getItem', 'setItem'],
    WORLD_ENGINE_CORE: ['getChatId', 'loadState'],
    WORLD_ENGINE_API: ['callApi'],
    WORLD_ENGINE_WORLDBOOK: ['buildPromptSection'],
    WORLD_ENGINE_CHATCACHE: ['init'],
    WORLD_ENGINE_INJECT_INSPECTOR: ['init']
  };

  // 引擎地位并列，按注册顺序加载；世界引擎只是在发生取舍时拥有最高启动优先级。
  const ENGINE_MODULE_GROUPS = [
    {
      id: 'world', label: '世界引擎', modules: [
        'world-engine-preset.js',
        'world-engine-rules-loader.js',
        'world-engine-ledger.js',
        'world-engine-evolution.js',
        'world-engine-inject.js'
      ],
      contracts: {
        WORLD_ENGINE_PRESET: ['getActivePreset'],
        WORLD_ENGINE_RULES: ['loadRules'],
        WORLD_ENGINE_LEDGER: ['recordChanges'],
        WORLD_ENGINE_EVOLUTION: ['evolve', 'abort', 'isRunning'],
        WORLD_ENGINE_INJECT: ['buildContext']
      }
    },
    {
      id: 'memory', label: '记忆引擎', modules: [
        'memory-engine-settings.js',
        'memory-engine-data.js',
        'memory-engine-timeline.js',
        'memory-engine-prompt.js',
        'memory-engine-small-summary-prompt.js',
        'memory-engine-big-summary-prompt.js',
        'memory-engine.js'
      ],
      contracts: {
        MEMORY_ENGINE_SETTINGS: ['getSettings', 'patchSettings'],
        MEMORY_ENGINE_DATA: ['loadState', 'saveState'],
        MEMORY_ENGINE_TIMELINE: ['captureRange', 'auditRefs', 'syncHidden'],
        MEMORY_ENGINE_PROMPT: ['buildUserPrompt'],
        MEMORY_ENGINE_SMALL_SUMMARY_PROMPT: ['buildUserPrompt'],
        MEMORY_ENGINE_BIG_SUMMARY_PROMPT: ['buildUserPrompt'],
        MEMORY_ENGINE: ['init', 'applyInjection', 'abort', 'isRunning']
      }
    }
  ];

  const SHARED_UI_MODULES = ['world-engine-diag.js', 'world-engine-ui.js'];
  const SHARED_UI_CONTRACTS = {
    WORLD_ENGINE_DIAG: ['collect', 'download'],
    WORLD_ENGINE_UI: ['buildPanel', 'buildInputButton', 'refresh']
  };

  function getBaseUrl() {
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src;
      if (src && src.includes('world-engine.js')) {
        return src.substring(0, src.lastIndexOf('/'));
      }
    }
    return './plugins/world-engine';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('加载失败: ' + src));
      document.head.appendChild(s);
    });
  }

  function validateContracts(label, contracts) {
    const missing = [];
    for (const [globalName, methods] of Object.entries(contracts || {})) {
      const api = window[globalName];
      if (!api) {
        missing.push(globalName);
        continue;
      }
      for (const method of methods) {
        if (typeof api[method] !== 'function') missing.push(`${globalName}.${method}()`);
      }
    }
    if (missing.length) throw new Error(`${label}接口契约不完整: ${missing.join(', ')}`);
  }

  async function loadEngineGroup(baseUrl, group) {
    try {
      for (const mod of group.modules) {
        await loadScript(baseUrl + '/' + mod);
        console.log(`[${group.label}] 已加载:`, mod);
      }
      validateContracts(group.label, group.contracts);
      return true;
    } catch (error) {
      console.error(`[${group.label}] 模块加载失败`, error);
      return false;
    }
  }

  async function loadRequiredModules(baseUrl, modules, label) {
    for (const mod of modules) {
      await loadScript(baseUrl + '/' + mod);
      console.log(`[${label}] 已加载:`, mod);
    }
  }

  async function init() {
    const baseUrl = getBaseUrl();
    const loadedEngines = new Map();
    let sharedRuntimeReady = false;
    console.log('[世界引擎] 加载中...');

    try {
      await loadRequiredModules(baseUrl, SHARED_MODULES, '共用底座');
      validateContracts('共用底座', SHARED_CONTRACTS);
      for (const group of ENGINE_MODULE_GROUPS) {
        loadedEngines.set(group.id, await loadEngineGroup(baseUrl, group));
      }
      await loadRequiredModules(baseUrl, SHARED_UI_MODULES, '共用界面');
      validateContracts('共用界面', SHARED_UI_CONTRACTS);

      // 读取扩展版本号（来自 manifest.json，单一真相源）供 UI 显示；失败不阻断启动
      try {
        const resp = await fetch(baseUrl + '/manifest.json', { cache: 'no-cache' });
        if (resp && resp.ok) {
          const mf = await resp.json();
          if (mf && mf.version) window.WORLD_ENGINE_VERSION = String(mf.version);
        }
      } catch (e) { /* 读不到版本号不影响功能，UI 端自行降级隐藏 */ }

      // 先把存储灌入内存镜像（并迁移旧 localStorage 存档），之后所有同步读写才有数据
      if (window.WORLD_ENGINE_STORE) {
        await window.WORLD_ENGINE_STORE.hydrate();
      }

      // 酒馆缓存：装好同步槽并对当前聊天做一次恢复/收敛（须在首次注入正文之前，注入才用上同步到的状态）
      if (window.WORLD_ENGINE_CHATCACHE) {
        window.WORLD_ENGINE_CHATCACHE.init();
      }
      sharedRuntimeReady = true;

      // 注入自检查看器：只读订阅 ST prompt-ready 事件，核对世界状态是否真进了最终 prompt（解耦，订阅失败不阻断启动）
      if (window.WORLD_ENGINE_INJECT_INSPECTOR) {
        try { window.WORLD_ENGINE_INJECT_INSPECTOR.init(); } catch (e) { console.warn('[世界引擎] 注入自检初始化失败（非致命）', e); }
      }

      const core = window.WORLD_ENGINE_CORE;
      const api = window.WORLD_ENGINE_API;
      const ledger = window.WORLD_ENGINE_LEDGER;
      const evolution = window.WORLD_ENGINE_EVOLUTION;
      const inject = window.WORLD_ENGINE_INJECT;
      const ui = window.WORLD_ENGINE_UI;
      const rulesLoader = window.WORLD_ENGINE_RULES;

      // 世界组自身失败时，共用底座与其他已加载引擎仍可独立工作。
      // 世界排第一是优先级，不是其他引擎对它的运行依赖。
      if (!loadedEngines.get('world')) {
        console.error('[世界引擎] 引擎模块不可用；继续启动其他已加载引擎');
        try {
          ui?.buildPanel?.();
          ui?.buildInputButton?.();
        } catch (e) { console.warn('[共用界面] 初始化失败', e); }
        return;
      }

      // 加载活体引擎全部规则（规则已内置在 JS 中，不需要网络请求）
      let rulesCount = 0;
      try {
        const result = await rulesLoader.loadRules();
        rulesCount = result.count || 0;
        console.log('[世界引擎] 📜 活体引擎规则就绪，共', rulesCount, '条');
      } catch(e) {
        console.warn('[世界引擎] 规则加载异常（非致命）:', e.message);
      }

      let isEvolving = false;
      let autoEvolveTimer = null;
      let lastProcessedMessageKey = '';
      const AUTO_EVOLVE_DELAY = 1500;

      // ========== 注入管理 ==========
      const INJECTION_NAME = 'world-engine-world';

      // injection_position=1 为 In-Chat（插入聊天流），depth=1 为用户消息正前一位
      // 与预设 JSON 中 injection_position:1 / injection_depth:1 对应
      const INJ_POSITION = 1;
      const INJ_DEPTH = 1;

      function registerInjection(content) {
        try {
          const ctx = SillyTavern.getContext();
          if (typeof ctx.setExtensionPrompt === 'function') {
            ctx.setExtensionPrompt(INJECTION_NAME, content, INJ_POSITION, INJ_DEPTH);
            return true;
          }
          if (typeof ctx.registerInjection === 'function') {
            if (typeof ctx.unregisterInjection === 'function') {
              ctx.unregisterInjection(INJECTION_NAME);
            }
            ctx.registerInjection(INJECTION_NAME, content, { position: INJ_POSITION, depth: INJ_DEPTH, role: 'system' });
            return true;
          }
          if (Array.isArray(ctx.extensionPrompts)) {
            ctx.extensionPrompts = ctx.extensionPrompts.filter(p => p.name !== INJECTION_NAME);
            ctx.extensionPrompts.push({
              name: INJECTION_NAME, content,
              role: 'system', position: INJ_POSITION, depth: INJ_DEPTH
            });
            return true;
          }
          console.warn('[世界引擎] 所有注入方式均不可用');
          return false;
        } catch(e) {
          console.error('[世界引擎] 注入失败', e);
          return false;
        }
      }

      function unregisterInjection() {
        try {
          const ctx = SillyTavern.getContext();
          if (typeof ctx.setExtensionPrompt === 'function') {
            ctx.setExtensionPrompt(INJECTION_NAME, '', INJ_POSITION, INJ_DEPTH); // 清空内容即为取消注入
          } else if (typeof ctx.unregisterInjection === 'function') {
            ctx.unregisterInjection(INJECTION_NAME);
          } else if (Array.isArray(ctx.extensionPrompts)) {
            ctx.extensionPrompts = ctx.extensionPrompts.filter(p => p.name !== INJECTION_NAME);
          }
        } catch(e) {}
      }

      // ========== 注入世界状态到正文 prompt ==========
      // stateOverride: 传入则使用该状态（重 roll 时用存档点），否则用当前状态
      function applyInjection(stateOverride) {
        try {
          if (api.getSettings(true).injectIntoPrompt === false) {
            unregisterInjection();
            console.log('[世界引擎] 正文注入已在设置中关闭');
            return;
          }
          const ctx = SillyTavern.getContext();
          if (!ctx) return;
          const state = stateOverride || core.loadState();
          const currentRound = state.round;

          const chatHistory = ctx.chat || [];
          const recentChat = chatHistory.slice(-5);
          const recent = recentChat.map(m => (m.mes || '')).join(' ');

          const tags = [];
          const namePattern = /([一-龥]{2,4})(?:说|道|讲|问|答)/g;
          let m;
          while ((m = namePattern.exec(recent)) !== null) {
            if (!['什么','怎么','这个','那个','没有','可以','知道','但是','因为','所以'].includes(m[1])) {
              tags.push(m[1]);
            }
          }
          for (const ev of state.events || []) tags.push(ev.name);
          for (const f of state.factions || []) tags.push(f.name);

          const context = inject.buildContext(state, tags);

          // 只在使用当前状态时写回（存档点状态不应被覆盖）
          if (!stateOverride && core.hasState()) {
            state.lastInjection = { timestamp: Date.now(), round: currentRound, context, tagsUsed: tags };
            core.saveState(state);
          }

          registerInjection(context);
          console.log(`[世界引擎] 注入完成 (round ${currentRound}, ${context.length} chars)${stateOverride ? ' [存档点]' : ''}`);
        } catch(e) {
          console.error('[世界引擎] 注入处理失败', e);
        }
      }

      // 正文组装前选择注入哪份世界状态：
      //   重 roll（酒馆 type=swipe/regenerate，由调用方传 opts.isReroll）→ 注入存档点（这层正文产生前的状态）；
      //   往前删到旧层（chatLayer < state.chatLayer）→ 注入存档点；
      //   否则（新生成/新轮次/续写）→ 注入当前状态。
      function applyInjectionForCurrentRound(opts) {
        if (api.getSettings(true).engineEnabled === false) {
          unregisterInjection();
          return;
        }
        const state = core.loadState();
        const chatLayer = core.getChatLayer();
        const isReroll = !!(opts && opts.isReroll);

        // [FIX v2.3.19] 重 roll 判据改用酒馆原生 type（swipe/regenerate），不再用 chatLayer===state.chatLayer 数值。
        //   v2.3.18 的纯数值判据有回归：GENERATION_STARTED 在用户楼 push 进 chat **之前** emit，新一轮发消息时
        //   chatLayer 仍 == 上一轮 state.chatLayer，被误判成重 roll、注入了存档点（用户「没重 roll 却注入旧状态」）。
        //   真正可靠的重 roll 信号是酒馆 GENERATION_STARTED 的 type 参数（swipe/regenerate），见 onGenerationStarted。
        if (isReroll) {
          const checkpoint = core.restoreCheckpoint();
          if (checkpoint) {
            console.log('[世界引擎] 正文注入判定：重 roll（type=swipe/regenerate），注入存档点');
            applyInjection(checkpoint);
            if (ui && ui.setInjectedScope) ui.setInjectedScope('checkpoint');
          } else {
            console.log('[世界引擎] 正文注入判定：重 roll（type=swipe/regenerate），无存档点，不注入');
            unregisterInjection();
          }
          if (ui && ui.refresh) ui.refresh(true);
          return;
        }

        const stateLayer = Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : chatLayer;
        let injectedScope = 'state';
        if (chatLayer < stateLayer) {
          const checkpoint = core.restoreCheckpoint();
          if (checkpoint) {
            injectedScope = 'checkpoint';
            console.log(`[世界引擎] 正文注入判定：对话层数 ${chatLayer} < 当前状态层数 ${stateLayer}，注入存档点`);
            applyInjection(checkpoint);
          } else {
            console.warn(`[世界引擎] 正文注入判定：对话层数 ${chatLayer} < 当前状态层数 ${stateLayer}，但无存档点，回退到当前状态`);
            applyInjection();
          }
        } else {
          console.log(`[世界引擎] 正文注入判定：对话层数 ${chatLayer} >= 当前状态层数 ${stateLayer}，注入当前状态`);
          applyInjection();
        }
        // 注入正文后刷新面板，让「当前状态」跟随实际注入的那份：
        // 重 roll / 往前删旧层 → 显示存档点；否则 → 显示当前状态。
        if (ui && ui.setInjectedScope) ui.setInjectedScope(injectedScope);
        if (ui && ui.refresh) ui.refresh(true);
      }

      // ========== 收到完整回复后：世界推演 + 记录账本 ==========
      function getMessageKey(ctx, chat, message) {
        const messageId = message?.mesId ?? message?.message_id ?? message?.send_date ?? (chat.length - 1);
        const swipeId = message?.swipe_id ?? message?.swipeId ?? '';
        return [core.getChatId(), chat.length - 1, messageId, swipeId].join('|');
      }

      function clearAutoEvolveTimer() {
        if (autoEvolveTimer) {
          clearTimeout(autoEvolveTimer);
          autoEvolveTimer = null;
        }
      }

      function onMessageReceived() {
        clearAutoEvolveTimer();

        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        if (!ctx || chat.length <= 2 || !lastMsg || lastMsg.is_user || !aiMsg) return;

        const messageKey = getMessageKey(ctx, chat, lastMsg);
        autoEvolveTimer = setTimeout(
          () => runAutoEvolution(messageKey, aiMsg),
          AUTO_EVOLVE_DELAY
        );
      }

      async function runAutoEvolution(expectedKey, expectedText) {
        autoEvolveTimer = null;
        if (api.getSettings(true).engineEnabled === false) return;
        if (isEvolving || lastProcessedMessageKey === expectedKey) return;
        // 已有推演（如手动触发）在跑：跳过本次自动推演，避免 evolve() 因 busy 返回 false 被误报为「推演失败」
        if (evolution.isRunning && evolution.isRunning()) return;

        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        if (!ctx || !lastMsg || lastMsg.is_user || !aiMsg) return;

        const currentKey = getMessageKey(ctx, chat, lastMsg);
        if (currentKey !== expectedKey) return;
        if (aiMsg !== expectedText) {
          onMessageReceived();
          return;
        }

        // ===== 推演模式与计数：决定本条消息是否自动推演 =====
        const settings = api.getSettings(true);
        if (settings.evolveMode === 'manual') {
          // 手动模式：只由「手动推演」按钮触发，这里不做任何自动推演
          lastProcessedMessageKey = currentKey;
          return;
        }
        const everyX = Math.max(1, parseInt(settings.evolveEveryX) || 1);
        let timeStoryDay = null;   // 非 null = 按时间模式，推演完写入 state.time
        let timeReadRounds = null; // 时间模式：本次读取的轮数（min(经过轮数, 上限X)）

        if (settings.evolveMode === 'time') {
          // 前置：state.time 与 checkpoint.time 必须都有
          const st = core.hasState() ? core.loadState() : null;
          const cp = core.restoreCheckpoint();
          if (!st || st.time == null || !cp || cp.time == null) {
            lastProcessedMessageKey = currentKey;
            setStatus('存档点与当前状态时间为空，请在设置填写', false);
            if (ui) ui.refresh(true);
            return;
          }
          const currentDay = core.parseStoryDay(aiMsg, settings);
          if (currentDay == null) {
            core.setLastStoryDay(null);
            lastProcessedMessageKey = currentKey;
            setStatus('未获取时间', false);
            if (ui) ui.refresh(true);
            return;
          }
          core.setLastStoryDay(currentDay);
          const isNew = core.isNewRound();
          const base = isNew ? Number(st.time) : Number(cp.time);   // 重 roll → 比存档点
          const threshold = Math.max(1, parseInt(settings.evolveTimeThreshold) || 1);
          const delta = currentDay - base;
          if (delta < threshold) {
            lastProcessedMessageKey = currentKey;
            setStatus(`第 ${Math.max(0, delta)}/${threshold} 天，未到推演`);
            if (ui) ui.refresh(true);
            return;
          }
          timeStoryDay = currentDay;
          // 自上次推演经过的轮数（楼层锚点：存档点层 → 当前状态层 → 当前层），与上限 X 取小
          const Xmax = Math.max(1, parseInt(settings.evolveTimeMaxRounds) || 10);
          const Lnow = core.getChatLayer();
          let anchorL = (cp && cp.chatLayer != null) ? Number(cp.chatLayer)
                      : (st && st.chatLayer != null ? Number(st.chatLayer) : Lnow);
          if (!Number.isFinite(anchorL)) anchorL = Lnow;
          const since = Math.floor(Math.max(0, Lnow - anchorL) / 2);
          timeReadRounds = Math.max(1, Math.min(since, Xmax));
        } else {
          const L = core.getChatLayer();
          const cp = core.restoreCheckpoint();
          const storedState = core.hasState() ? core.loadState() : null;
          let anchor = null;
          if (cp && cp.chatLayer != null) {
            anchor = Number(cp.chatLayer);
          } else if (storedState && storedState.chatLayer != null && Number.isFinite(Number(storedState.chatLayer))) {
            anchor = Number(storedState.chatLayer);
          } else if (core.loadFingerprint() !== '') {
            anchor = Number(core.loadFingerprint());
          }
          // [FIX] 三级回退全空 = 该聊天从未推演过（空壳 state + 无存档点 + 无指纹）。
          //   旧逻辑兜底 anchor=L 导致 c=0 永久死锁（见 onChatLoaded 对空壳 state 不再钉 chatLayer 的配套改动）；
          //   改为认定从未推演，anchor=-1 让 c>0 触发首次推演。推演成功后 evolution 正常写 fingerprint，后续轮次走正常锚点。
          if (!Number.isFinite(anchor)) anchor = -1;
          const c = Math.floor(Math.max(0, L - anchor) / 2);
          const doEvolve = c > 0 && c % everyX === 0;

          if (!doEvolve) {
            lastProcessedMessageKey = currentKey;
            const pos = c % everyX || (c === 0 ? 0 : everyX);
            setStatus(`第 ${pos}/${everyX} 轮，未到推演`);
            if (ui) ui.refresh(true);
            return;
          }
        }

        const ok = await performEvolution(aiMsg, chat, timeStoryDay, timeReadRounds);
        if (ok) lastProcessedMessageKey = currentKey;
      }

      function setStatus(text, isErr) {
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(text, !!isErr);
      }

      function getElapsedReadRounds(baseState, maxRounds) {
        const limit = Math.max(1, parseInt(maxRounds) || 1);
        const L = core.getChatLayer();
        let anchorL = baseState && baseState.chatLayer != null ? Number(baseState.chatLayer) : L;
        if (!Number.isFinite(anchorL)) anchorL = L;
        const since = Math.floor(Math.max(0, L - anchorL) / 2);
        return Math.max(1, Math.min(since, limit));
      }

      function buildDialogueText(chat, readRounds, settings) {
        const start = Math.max(settings.firstLayerIsAiOpening !== false ? 1 : 0, chat.length - readRounds * 2);
        return chat.slice(start)
          .map(m => (m.is_user ? '用户' : 'AI') + '：' + core.filterDialogue((m.mes || '').trim(), settings))
          .filter(line => line.length > 3)
          .join('\n');
      }

      // 执行一次推演（自动按轮 / 按时间 / 设置页手填时间 共用）。
      // storyDay 非 null → 推演成功后写入 state.time（按时间模式）。
      async function performEvolution(aiMsg, chat, storyDay, readRoundsOverride, opts) {
        isEvolving = true;
        let worldUiPhaseFinished = false;
        opts = opts || {};
        try {
          const state = core.loadState();
          const isNewRound = core.isNewRound();
          setStatus('推演中...');
          // 显示基底：手动按钮显式传入；自动路径跟随 isNewRound。
          const displayScope = opts.displayScope || (isNewRound ? 'state' : 'checkpoint');
          if (ui && ui.setEvolvingUI) ui.setEvolvingUI(true, displayScope);
          if (ui && ui.refresh) ui.refresh(true);

          // 取对话喂后台；时间模式由调用方传入读取轮数，按轮模式用 a（夹紧到 X）。start 做负数保护
          const settings = api.getSettings(true);
          let readRounds;
          if (readRoundsOverride != null) {
            readRounds = Math.max(1, parseInt(readRoundsOverride) || 1);
          } else {
            readRounds = Math.max(1, parseInt(settings.evolveReadRounds) || 1);
            if (settings.evolveMode === 'auto') {
              readRounds = Math.min(Math.max(1, parseInt(settings.evolveEveryX) || 1), readRounds);
            }
          }
          const dialogueText = buildDialogueText(chat, readRounds, settings);

          const evolveOpts = { dialogueText };
          if (opts.mode) evolveOpts.mode = opts.mode;
          const success = await evolution.evolve(state, opts.userMsg || '', aiMsg, evolveOpts);
          if (success) {
            ledger.recordChanges(state);
            if (storyDay != null) { state.time = Number(storyDay); core.saveState(state); }
            // 世界 API 已经完成：先落库、更新注入并刷新世界界面，再开始记忆联动。
            // isEvolving 继续作为内部互斥锁保持 true，防止联动期间再次启动世界推演；
            // UI 运行态则在这里结束，让两个引擎的动画严格按先后阶段显示。
            if (isNewRound || opts.forceApplyInjection) applyInjection();
            setStatus('世界推演完成');
            if (ui) { ui.setEvolvingUI(false); ui.refresh(true); }
            worldUiPhaseFinished = true;
            if (settings.memoryLinkEnabled === true) {
              try {
                await window.MEMORY_ENGINE?.ingestWorldEvolution?.({
                  layer: core.getChatLayer(),
                  worldRound: state.round,
                  worldDigest: state.worldDigest,
                  worldUpdate: state.lastEvolveResult,
                  replace: !isNewRound
                });
              } catch (linkError) {
                console.error('[世界引擎] 世界→记忆联动失败（世界推演结果已保留）', linkError);
                setStatus('世界推演完成，但记忆联动失败：' + (linkError?.message || linkError), true);
              }
            }
            console.log('[世界引擎] ✅ 推演完成，当前第', state.round, '轮');
          } else {
            console.warn('[世界引擎] ⚠️ 推演失败或已中止');
          }
          const reason = !success && evolution.getLastError ? evolution.getLastError() : '';
          if (!success) setStatus(reason ? '推演失败：' + reason : '推演失败或已中止', true);
          return success;
        } catch(e) {
          console.error('[世界引擎] 处理失败', e);
          setStatus('推演异常: ' + e.message, true);
          return false;
        } finally {
          isEvolving = false;
          if (ui) {
            if (!worldUiPhaseFinished) ui.setEvolvingUI(false);
            ui.refresh(true);
          }
        }
      }

      async function manualEvolve(mode, scope) {
        if (api.getSettings(true).engineEnabled === false) { setStatus('世界引擎已关闭'); return false; }
        if (isEvolving) return false;
        if (evolution.isRunning && evolution.isRunning()) { setStatus('已有推演进行中...'); return false; }
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const userMsg = lastMsg?.is_user ? (lastMsg.mes || '') : '';
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        const settings = api.getSettings(true);
        const state = core.loadState();
        // forward 只按当前状态之后新增的轮数取最近对话；redo 则从存档点重新计算。
        // 两条路径都受 manualReadRounds 限制，buildDialogueText 最终始终取聊天末尾最新 N 轮。
        const dialogueBase = mode === 'redo' ? core.restoreCheckpoint() : state;
        const readRounds = getElapsedReadRounds(dialogueBase, settings.manualReadRounds);
        return performEvolution(aiMsg, chat, null, readRounds, {
          mode,
          displayScope: scope,
          userMsg,
          forceApplyInjection: true
        });
      }

      // 设置页「本轮对话时间」手填保存后：判断是否够时间，够则推演。
      async function manualTimeEvolve(currentDay) {
        if (api.getSettings(true).engineEnabled === false) { setStatus('世界引擎已关闭'); return; }
        if (currentDay == null || isEvolving) return;
        if (evolution.isRunning && evolution.isRunning()) { setStatus('已有推演进行中...'); return; }
        const settings = api.getSettings(true);
        const st = core.hasState() ? core.loadState() : null;
        const cp = core.restoreCheckpoint();
        if (!st || st.time == null || !cp || cp.time == null) {
          setStatus('存档点与当前状态时间为空，请在设置填写', false);
          return;
        }
        core.setLastStoryDay(currentDay);
        const isNew = core.isNewRound();
        const base = isNew ? Number(st.time) : Number(cp.time);
        const threshold = Math.max(1, parseInt(settings.evolveTimeThreshold) || 1);
        const delta = Number(currentDay) - base;
        if (delta < threshold) {
          setStatus(`第 ${Math.max(0, delta)}/${threshold} 天，未到推演`);
          if (ui) ui.refresh(true);
          return;
        }
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        // 与自动路径一致：读取 min(经过轮数, 上限X) 轮
        const readRounds = getElapsedReadRounds(cp || st, settings.evolveTimeMaxRounds);
        await performEvolution(aiMsg, chat, Number(currentDay), readRounds);
      }

      async function onChatLoaded() {
        clearAutoEvolveTimer();
        // 切聊天时，若仍有进行中的推演/批量回填，立即中止——
        // 回填捕获的是旧聊天的对话数组引用，继续跑会把旧聊天内容写进新聊天（跨聊天污染 + 旧存档已 clearState 丢失）。
        if (evolution && evolution.isRunning && evolution.isRunning()) {
          try { evolution.abort(); console.log('[世界引擎] 切聊天，中止进行中的推演/回填'); } catch (e) { console.warn('[世界引擎] 中止推演失败', e); }
        }
        // 共用 ChatCache 独立监听 CHAT_LOADED，并在各引擎回调之前完成 scope 恢复。
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const currentLayer = core.getChatLayer();
        if (chat.length === 0) {
          core.clearState();
          core.clearCheckpoint();
          core.saveFingerprint(String(currentLayer));
        }
        let storedState = null;
        if (core.hasState()) {
          storedState = core.loadState();
          // [FIX] 只对真正推演过的 state 补 chatLayer；空壳 state（round=0 且无 lastEvolveResult）保留 undefined，
          //   让 runAutoEvolution 的 anchor 兜底走「从未推演」分支（anchor=-1），避免把 anchor 钉死在当前层导致死锁。
          if (!Number.isFinite(Number(storedState.chatLayer)) && (storedState.round > 0 || storedState.lastEvolveResult)) {
            storedState.chatLayer = currentLayer;
            core.saveState(storedState);
          }
        }
        const checkpoint = core.restoreCheckpoint();
        if (checkpoint && !Number.isFinite(Number(checkpoint.chatLayer))) {
          checkpoint.chatLayer = storedState && Number.isFinite(Number(storedState.chatLayer))
            ? Number(storedState.chatLayer)
            : currentLayer;
          core.saveCheckpoint(checkpoint);
        }
        // 迁移旧版 fingerprint（旧语义为 chat.length）到统一层数（chat.length - 1）。
        const savedFingerprint = Number(core.loadFingerprint());
        if (Number.isFinite(savedFingerprint) && savedFingerprint === currentLayer + 1 &&
            (!storedState || Number(storedState.chatLayer) === currentLayer)) {
          core.saveFingerprint(String(currentLayer));
        }
        // [FIX] fingerprint 补当前层 = 在此层建立锚点（已推演过的聊天在此建立，下次有新楼层才推）。
        //   但空壳 state（round=0 且无 lastEvolveResult = 从未推演过）不能补成当前层——否则
        //   runAutoEvolution 第三级命中 anchor=L、c=0、永久死锁。只有真推演过的 state 才补；
        //   空壳 state 保留空指纹，让 auto 分支走「从未推演」兜底 anchor=-1 触发首次推演。
        //   与上方空壳 state 不钉 chatLayer 同构（同以 round>0||lastEvolveResult 区分是否推演过）。
        const reallyEvolved = storedState && (storedState.round > 0 || storedState.lastEvolveResult);
        if (chat.length > 0 && !core.restoreCheckpoint() && reallyEvolved && core.loadFingerprint() === '') {
          core.saveFingerprint(String(currentLayer));
        }
        applyInjectionForCurrentRound();
        console.log('[世界引擎] 聊天已加载，注入已更新');
      }

      function onMessageSwiped() {
        clearAutoEvolveTimer();
        // swipe（消息下方左右箭头）：明确的重 roll，注入存档点。
        applyInjectionForCurrentRound({ isReroll: true });
      }

      // 借用生成开始事件作为正文组装时机。重 roll 判据用酒馆原生 type（swipe/regenerate），
      // 不再用 chatLayer 数值——因为 GENERATION_STARTED 在用户/AI 楼 push 进 chat 之前 emit，
      // 新一轮发消息时 chatLayer 仍 == 上一轮 state.chatLayer，纯数值判据会把新轮首生成误判成重 roll（v2.3.18 回归）。
      //   type==='swipe'|'regenerate' → 重 roll，注入存档点（这层正文产生前的世界状态）。
      //   dryRun（数据库类插件的预热/算 token 生成）→ 不动注入，避免「生成完又注入一遍」。
      function onGenerationStarted(type, _opts, dryRun) {
        if (dryRun) return; // 预热轮不重判注入
        const isReroll = (type === 'swipe' || type === 'regenerate');
        applyInjectionForCurrentRound({ isReroll });
      }

      // ========== 事件绑定 ==========
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.eventSource) {
        const guard = window.WORLD_ENGINE_GUARD_EVENT;
        const autoEvolveEvent = ctx.event_types?.GENERATION_ENDED || ctx.event_types?.MESSAGE_RECEIVED || 'message_received';
        ctx.eventSource.on(autoEvolveEvent, guard('世界引擎', '生成完成', onMessageReceived));
        ctx.eventSource.on(ctx.event_types?.CHAT_LOADED || 'chat_loaded', guard('世界引擎', '聊天加载', onChatLoaded));
        ctx.eventSource.on(ctx.event_types?.MESSAGE_SWIPED || 'message_swiped', guard('世界引擎', '滑动重生成', onMessageSwiped));
        ctx.eventSource.on(ctx.event_types?.GENERATION_STARTED || 'generation_started', guard('世界引擎', '生成开始', onGenerationStarted));
        console.log('[世界引擎] 事件绑定成功，自动推演事件:', autoEvolveEvent);
      } else {
        console.warn('[世界引擎] 无法绑定事件');
      }

      // 初始化时立即按对话层数选择注入状态
      applyInjectionForCurrentRound();
      // 暴露按对话层数选择的注入入口供手动调用
      window.WORLD_ENGINE = { applyInjection: applyInjectionForCurrentRound, manualEvolve, manualTimeEvolve };

      // ========== 添加面板入口按钮到酒馆输入栏 ==========
      // 已移至 world-engine-ui.js 的 buildInputButton()

      ui.buildPanel();
      ui.buildInputButton();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ui.buildInputButton());
      }

      // 每隔 30 秒自动刷新面板（如果可见）
      setInterval(() => { if (ui) ui.refresh(true); }, 30000);

      console.log('[世界引擎] 初始化完成 ✅');

    } catch(err) {
      console.error('[世界引擎] 初始化失败', err);
    } finally {
      // 记忆初始化拥有独立收尾边界：世界运行主体或共用 UI 后半段报错，
      // 也不能阻止已经通过接口契约校验的记忆引擎启动。
      if (sharedRuntimeReady && loadedEngines.get('memory') && window.MEMORY_ENGINE) {
        try { window.MEMORY_ENGINE.init(); }
        catch (e) { console.warn('[记忆引擎] 初始化失败（非致命）', e); }
      }
    }
  }

  init();
})();
