// world-engine.js — 主入口：加载模块，绑定事件，注入推演
(function() {
  if (window.__WORLD_ENGINE_LOADED__) return;
  window.__WORLD_ENGINE_LOADED__ = true;

  const MODULES = [
    'world-engine-store.js',
    'world-engine-preset.js',       // ← 新增：引擎预设系统（紧跟 store，在 evolution 之前；运行时引用 evolution 默认段）
    'world-engine-core.js',
    'world-engine-api.js',
    'world-engine-rules-loader.js',
    'world-engine-worldbook.js',
    'world-engine-chatcache.js',
    'world-engine-ledger.js',
    'world-engine-evolution.js',
    'world-engine-inject.js',
    'world-engine-diag.js',
    'world-engine-ui.js'
  ];

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

  async function init() {
    const baseUrl = getBaseUrl();
    console.log('[世界引擎] 加载中...');

    try {
      for (const mod of MODULES) {
        await loadScript(baseUrl + '/' + mod);
        console.log('[世界引擎] 已加载:', mod);
      }

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

      const core = window.WORLD_ENGINE_CORE;
      const api = window.WORLD_ENGINE_API;
      const ledger = window.WORLD_ENGINE_LEDGER;
      const evolution = window.WORLD_ENGINE_EVOLUTION;
      const inject = window.WORLD_ENGINE_INJECT;
      const ui = window.WORLD_ENGINE_UI;
      const rulesLoader = window.WORLD_ENGINE_RULES;

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

      // 正文组装前直接比较注入当下的对话层数和当前状态记录的层数：
      // 对话层数更小 = 重 roll，注入存档点；否则注入当前状态。
      function applyInjectionForCurrentRound() {
        const state = core.loadState();
        const chatLayer = core.getChatLayer();

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
        // 重 roll（对话层数 < 状态层数）→ 显示存档点；否则 → 显示当前状态。
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
          }
          // 两级回退全空 = 该聊天从未推演过。
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

      // 执行一次推演（自动按轮 / 按时间 / 设置页手填时间 共用）。
      // storyDay 非 null → 推演成功后写入 state.time（按时间模式）。
      async function performEvolution(aiMsg, chat, storyDay, readRoundsOverride) {
        isEvolving = true;
        try {
          const state = core.loadState();
          const isNewRound = core.isNewRound();
          setStatus('推演中...');
          // 显示基底跟随 isNewRound：新轮次→当前状态，重 roll→存档点
          if (ui && ui.setEvolvingUI) ui.setEvolvingUI(true, isNewRound ? 'state' : 'checkpoint');
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
          const start = Math.max(0, chat.length - readRounds * 2);
          const dialogueText = chat.slice(start)
            .map(m => (m.is_user ? '用户' : 'AI') + '：' + core.filterDialogue((m.mes || '').trim(), settings))
            .filter(line => line.length > 3)
            .join('\n');

          const success = await evolution.evolve(state, '', aiMsg, { dialogueText });
          if (success) {
            ledger.recordChanges(state);
            if (storyDay != null) { state.time = Number(storyDay); core.saveState(state); }
            // 重 roll 时正文已按楼层注入存档点，推演完成后不覆盖
            if (isNewRound) applyInjection();
            console.log('[世界引擎] ✅ 推演完成，当前第', state.round, '轮');
          } else {
            console.warn('[世界引擎] ⚠️ 推演失败或已中止');
          }
          const reason = !success && evolution.getLastError ? evolution.getLastError() : '';
          setStatus(success ? '推演完成' : (reason ? '推演失败：' + reason : '推演失败或已中止'), !success);
          return success;
        } catch(e) {
          console.error('[世界引擎] 处理失败', e);
          setStatus('推演异常: ' + e.message, true);
          return false;
        } finally {
          isEvolving = false;
          if (ui) { ui.setEvolvingUI(false); ui.refresh(true); }
        }
      }

      // 设置页「本轮对话时间」手填保存后：判断是否够时间，够则推演。
      async function manualTimeEvolve(currentDay) {
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
        const Xmax = Math.max(1, parseInt(settings.evolveTimeMaxRounds) || 10);
        const Lnow = core.getChatLayer();
        let anchorL = (cp && cp.chatLayer != null) ? Number(cp.chatLayer)
                    : (st && st.chatLayer != null ? Number(st.chatLayer) : Lnow);
        if (!Number.isFinite(anchorL)) anchorL = Lnow;
        const since = Math.floor(Math.max(0, Lnow - anchorL) / 2);
        const readRounds = Math.max(1, Math.min(since, Xmax));
        await performEvolution(aiMsg, chat, Number(currentDay), readRounds);
      }

      async function onChatLoaded() {
        clearAutoEvolveTimer();
        // 切聊天时，若仍有进行中的推演/批量回填，立即中止——
        // 回填捕获的是旧聊天的对话数组引用，继续跑会把旧聊天内容写进新聊天（跨聊天污染 + 旧存档已 clearState 丢失）。
        if (evolution && evolution.isRunning && evolution.isRunning()) {
          try { evolution.abort(); console.log('[世界引擎] 切聊天，中止进行中的推演/回填'); } catch (e) { console.warn('[世界引擎] 中止推演失败', e); }
        }
        // 酒馆缓存：切聊天时先做实时同步的恢复/收敛（须在读取本地状态之前，本地才拿到云端较新存档）
        if (window.WORLD_ENGINE_CHATCACHE) {
          try { window.WORLD_ENGINE_CHATCACHE.onChatLoaded(); } catch (e) { console.warn('[世界引擎] 酒馆缓存恢复失败', e); }
        }
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const currentLayer = core.getChatLayer();
        if (chat.length === 0) {
          core.clearState();
          core.clearCheckpoint();
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
        applyInjectionForCurrentRound();
        console.log('[世界引擎] 聊天已加载，注入已更新');
      }

      function onMessageSwiped() {
        clearAutoEvolveTimer();
        applyInjectionForCurrentRound();
      }

      function onMessageDeleted() {
        clearAutoEvolveTimer();
        applyInjectionForCurrentRound();
      }

      // 只借用生成开始事件作为正文组装时机；注入哪份状态仍完全由楼层数判断。
      function onGenerationStarted() {
        applyInjectionForCurrentRound();
      }

      // ========== 事件绑定 ==========
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.eventSource) {
        const autoEvolveEvent = ctx.event_types?.GENERATION_ENDED || ctx.event_types?.MESSAGE_RECEIVED || 'message_received';
        ctx.eventSource.on(autoEvolveEvent, onMessageReceived);
        ctx.eventSource.on(ctx.event_types?.CHAT_LOADED || 'chat_loaded', onChatLoaded);
        ctx.eventSource.on(ctx.event_types?.MESSAGE_SWIPED || 'message_swiped', onMessageSwiped);
        ctx.eventSource.on(ctx.event_types?.MESSAGE_DELETED || 'message_deleted', onMessageDeleted);
        ctx.eventSource.on(ctx.event_types?.GENERATION_STARTED || 'generation_started', onGenerationStarted);
        console.log('[世界引擎] 事件绑定成功，自动推演事件:', autoEvolveEvent);
      } else {
        console.warn('[世界引擎] 无法绑定事件');
      }

      // 初始化时立即按对话层数选择注入状态
      applyInjectionForCurrentRound();
      // 暴露按对话层数选择的注入入口供手动调用
      window.WORLD_ENGINE = { applyInjection: applyInjectionForCurrentRound, manualTimeEvolve };

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
    }
  }

  init();
})();
