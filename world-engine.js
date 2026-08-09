// world-engine.js — 主入口：加载模块，绑定事件，注入推演
(function() {
  if (window.__WORLD_ENGINE_LOADED__) return;
  window.__WORLD_ENGINE_LOADED__ = true;

  const MODULES = [
    'world-engine-store.js',
    'world-engine-presets.js',      // ← 新增：世界观预设系统（需在 core/rules/inject/evolution 之前加载）
    'world-engine-core.js',
    'world-engine-api.js',
    'world-engine-rules-loader.js',
    'world-engine-worldbook.js',
    'world-engine-ledger.js',
    'world-engine-evolution.js',
    'world-engine-diag.js',
    'world-engine-backup.js',       // ← 新增：本地滚动存档备份（防丢存档），需在 ui 之前加载
    'world-engine-inject.js',
    'world-engine-inject-inspector.js', // ← 新增：注入自检查看器（解耦/只读，订阅 prompt-ready 事件核对注入是否真进正文）
    'world-engine-ui.js',
    'world-engine-preset-ui.js'     // ← 新增：预设管理界面（需在 ui 之后加载）
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

      // 先把存储灌入内存镜像（并迁移旧 localStorage 存档），之后所有同步读写才有数据
      if (window.WORLD_ENGINE_STORE) {
        await window.WORLD_ENGINE_STORE.hydrate();
      }

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
      //   往前删到旧层（chatLayer < stateLayer）→ 注入存档点；
      //   否则（新生成/新轮次/续写）→ 注入当前状态。
      function applyInjectionForCurrentRound(opts) {
        const state = core.loadState();
        const chatLayer = core.getChatLayer();
        const stateLayer = Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : chatLayer;
        const isReroll = !!(opts && opts.isReroll);

        // [FIX v2.3.17→19 移植] 重 roll 判据改用酒馆原生 type（swipe/regenerate，见 onGenerationStarted/onMessageSwiped），
        //   不再靠楼层数值推断——GENERATION_STARTED 在用户楼 push 进 chat **之前** emit，新一轮发消息时 chatLayer 仍 == 上一轮
        //   stateLayer，纯数值判据会把新轮首生成误判成重 roll、注入旧存档点（"没重 roll 却注入旧状态"，与双生成插件叠加时每轮必现）。
        //   真重 roll（同层 swipe/regenerate）→ 注入存档点（这层正文产生前的世界状态），无存档点才不注入。
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
        let timeStoryDay = null;
        let timeReadRounds = null;

        if (settings.evolveMode === 'time') {
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
          const base = isNew ? Number(st.time) : Number(cp.time);
          const threshold = Math.max(1, parseInt(settings.evolveTimeThreshold) || 1);
          const delta = currentDay - base;
          if (delta < threshold) {
            lastProcessedMessageKey = currentKey;
            setStatus(`第 ${Math.max(0, delta)}/${threshold} 天，未到推演`);
            if (ui) ui.refresh(true);
            return;
          }
          timeStoryDay = currentDay;
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
          } else if (storedState && storedState.chatLayer != null) {
            anchor = Number(storedState.chatLayer);
          } else if (core.loadFingerprint() !== '') {
            anchor = Number(core.loadFingerprint());
          }
          if (!Number.isFinite(anchor)) anchor = L;
          const c = Math.floor(Math.max(0, L - anchor) / 2);
          const doEvolve = c > 0 && c % everyX === 0;

          if (!doEvolve) {
            lastProcessedMessageKey = currentKey;
            const pos = c % everyX || (c === 0 ? 0 : everyX);
            if (window.__WE_SetExternalStatus) {
              window.__WE_SetExternalStatus(`第 ${pos}/${everyX} 轮，未到推演`);
            }
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

      // [移植上游 c233bef] 按调用路径显式传入锚点：
      // forward 从当前状态继续，redo/time 从存档点重算，避免 forward 错读旧 checkpoint。
      function getElapsedReadRounds(baseState, maxRounds) {
        const limit = Math.max(1, parseInt(maxRounds) || 1);
        const L = core.getChatLayer();
        let anchorL = baseState && baseState.chatLayer != null ? Number(baseState.chatLayer) : L;
        if (!Number.isFinite(anchorL)) anchorL = L;
        const since = Math.floor(Math.max(0, L - anchorL) / 2);
        return Math.max(1, Math.min(since, limit));
      }

      function buildDialogueText(chat, readRounds, settings) {
        const start = Math.max(0, chat.length - readRounds * 2);
        return chat.slice(start)
          .map(m => (m.is_user ? '用户' : 'AI') + '：' + core.filterDialogue((m.mes || '').trim(), settings))
          .filter(line => line.length > 3)
          .join('\n');
      }

      async function performEvolution(aiMsg, chat, storyDay, readRoundsOverride, opts) {
        isEvolving = true;
        opts = opts || {};
        try {
          const state = core.loadState();
          const isNewRound = core.isNewRound();
          setStatus('推演中...');
          // 显示基底：手动按钮显式传入；自动路径跟随 isNewRound。
          const displayScope = opts.displayScope || (isNewRound ? 'state' : 'checkpoint');
          if (ui && ui.setEvolvingUI) ui.setEvolvingUI(true, displayScope);
          if (ui && ui.refresh) ui.refresh(true);

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
            // 重 roll 时正文已按楼层注入存档点，推演完成后不覆盖
            if (isNewRound || opts.forceApplyInjection) applyInjection();
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

      // [移植 v2.3.20 区间] 手动推演统一入口：向前推进(forward)/重新推进(redo)。
      //   读取轮数 = min(自上次推演经过轮数, manualReadRounds 上限)，与 UI 解耦。
      async function manualEvolve(mode, scope) {
        if (isEvolving) return false;
        if (evolution.isRunning && evolution.isRunning()) { setStatus('已有推演进行中...'); return false; }
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const userMsg = lastMsg?.is_user ? (lastMsg.mes || '') : '';
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        const settings = api.getSettings(true);
        const state = core.loadState();
        const dialogueBase = mode === 'redo' ? core.restoreCheckpoint() : state;
        const readRounds = getElapsedReadRounds(dialogueBase, settings.manualReadRounds);
        return performEvolution(aiMsg, chat, null, readRounds, {
          mode,
          displayScope: scope,
          userMsg,
          forceApplyInjection: true
        });
      }

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
        const readRounds = getElapsedReadRounds(cp || st, settings.evolveTimeMaxRounds);
        await performEvolution(aiMsg, chat, Number(currentDay), readRounds);
      }

      async function onChatLoaded() {
        clearAutoEvolveTimer();
        // 切聊天时，若仍有进行中的推演，立即中止——
        // 推演捕获的是旧聊天的对话数组引用，继续跑会把旧聊天内容写进新聊天（跨聊天污染 + 旧存档已 clearState 丢失）。
        if (evolution && evolution.isRunning && evolution.isRunning()) {
          try { evolution.abort(); console.log('[世界引擎] 切聊天，中止进行中的推演'); } catch (e) { console.warn('[世界引擎] 中止推演失败', e); }
        }
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
          if (!Number.isFinite(Number(storedState.chatLayer))) {
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
        if (chat.length > 0 && !core.restoreCheckpoint() && !core.hasState() && core.loadFingerprint() === '') {
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

      // 借用生成开始事件作为正文组装时机。重 roll 判据用酒馆原生 type（swipe/regenerate），不再靠楼层数值——
      //   GENERATION_STARTED 在用户/AI 楼 push 进 chat 之前 emit，新一轮发消息时 chatLayer 仍 == 上一轮 stateLayer，
      //   纯数值判据会把新轮首生成误判成重 roll（v2.3.18 回归）。dryRun（数据库类插件的预热/算 token 生成）跳过，避免"生成完又注入一遍"。
      function onGenerationStarted(type, _opts, dryRun) {
        if (dryRun) return; // 预热轮不重判注入
        const isReroll = (type === 'swipe' || type === 'regenerate');
        applyInjectionForCurrentRound({ isReroll });
      }

      // ========== 事件绑定 ==========
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.eventSource) {
        const autoEvolveEvent = ctx.event_types?.GENERATION_ENDED || ctx.event_types?.MESSAGE_RECEIVED || 'message_received';
        ctx.eventSource.on(autoEvolveEvent, onMessageReceived);
        ctx.eventSource.on(ctx.event_types?.CHAT_LOADED || 'chat_loaded', onChatLoaded);
        ctx.eventSource.on(ctx.event_types?.MESSAGE_SWIPED || 'message_swiped', onMessageSwiped);
        ctx.eventSource.on(ctx.event_types?.GENERATION_STARTED || 'generation_started', onGenerationStarted);
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

      // ── 初始化预设管理界面 ──
      if (window.WORLD_ENGINE_PRESET_UI && typeof window.WORLD_ENGINE_PRESET_UI.init === 'function') {
        window.WORLD_ENGINE_PRESET_UI.init();
        console.log('[世界引擎] 预设管理界面已初始化');
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
