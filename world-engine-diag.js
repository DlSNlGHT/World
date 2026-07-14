// world-engine-diag.js — 诊断包（一键导出运行状态供排错）
// [FIX] 纯只读模块：仅调用各模块已暴露的 getter 汇总状态，不改任何现有逻辑、不写存储、不动数据结构。
//   导出 { collect, download }；UI 调试区一个按钮调用 download() 即可。
//   撤回成本：删本文件 + 删 world-engine.js MODULES 里一行 + 删 UI 按钮与事件。
window.WORLD_ENGINE_DIAG = (function() {

  // 安全执行：任一区块抛错/模块缺失都不影响整体，记为 { error }
  function safe(fn) {
    try {
      const v = fn();
      return v === undefined ? null : v;
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  }

  // 设置脱敏：apiKey 绝不外泄；apiUrl 只报是否已填（host 不外泄）；其余原样
  function sanitizeSettings(s) {
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const k in s) {
      if (k === 'apiKey') {
        const v = s[k];
        out[k] = (v && String(v).length) ? ('***已设置(len=' + String(v).length + ')') : '(空)';
      } else if (k === 'apiUrl') {
        out[k] = (s[k] && String(s[k]).length) ? '(已填)' : '(空)';
      } else {
        out[k] = s[k];
      }
    }
    return out;
  }

  // 统计聊天中 user / ai 条数
  function countChat(chat) {
    let user = 0, ai = 0;
    for (let i = 0; i < chat.length; i++) {
      const m = chat[i];
      if (!m) continue;
      if (m.is_user) user++; else ai++;
    }
    return { total: chat.length, user, ai };
  }

  function collect(scope) {
    if (scope === 'memory') return collectMemory();
    if (scope != null && scope !== '' && scope !== 'world') throw new Error(`未知诊断 scope: ${scope}`);
    const core = window.WORLD_ENGINE_CORE;
    const api = window.WORLD_ENGINE_API;
    const store = window.WORLD_ENGINE_STORE;
    const evo = window.WORLD_ENGINE_EVOLUTION;
    const chatcache = window.WORLD_ENGINE_CHATCACHE;
    const worldbook = window.WORLD_ENGINE_WORLDBOOK;
    const rules = window.WORLD_ENGINE_RULES;
    const preset = window.WORLD_ENGINE_PRESET;
    const inspector = window.WORLD_ENGINE_INJECT_INSPECTOR;

    const diag = {};

    // —— 元信息 ——
    diag.meta = safe(function () {
      return {
        extVersion: window.WORLD_ENGINE_VERSION || '未知（未读到 manifest 版本）',
        collectedAt: new Date().toISOString(),
        userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || '未知'
      };
    });

    // —— 运行环境 ——
    diag.env = safe(function () {
      const ctx = SillyTavern.getContext();
      const chat = (ctx && ctx.chat) || [];
      return {
        chatId: (ctx && ctx.chatId) || null,
        chat: countChat(chat),
        name1: (ctx && ctx.name1) || null,
        name2: (ctx && ctx.name2) || null,
        characterId: (ctx && ctx.characterId != null) ? ctx.characterId : null,
        hasChatMetadata: !!(ctx && ctx.chatMetadata),
        tavernApi: {
          updateChatMetadata: !!(ctx && typeof ctx.updateChatMetadata === 'function'),
          saveMetadataDebounced: !!(ctx && typeof ctx.saveMetadataDebounced === 'function'),
          saveMetadata: !!(ctx && typeof ctx.saveMetadata === 'function'),
          saveChat: !!(ctx && typeof ctx.saveChat === 'function')
        }
      };
    });

    // —— 设置（脱敏）——
    diag.settings = safe(function () {
      if (!api || !api.getSettings) return { error: 'api 模块不可用' };
      return sanitizeSettings(api.getSettings(true));
    });

    // —— 世界状态摘要 ——
    diag.worldState = safe(function () {
      if (!core || !core.loadState) return { error: 'core 模块不可用' };
      const st = core.loadState() || {};
      const len = function (a) { return Array.isArray(a) ? a.length : 0; };
      return {
        round: st.round,
        chatLayer: st.chatLayer,
        worldDigestLen: (st.worldDigest || '').length,
        counts: {
          events: len(st.events),
          factions: len(st.factions),
          winds: len(st.winds),
          worldTrends: len(st.worldTrends),
          memories: len(st.memories),
          enemies: len(st.enemies),
          influenceChain: len(st.influenceChain),
          economySignals: len(st.economy && st.economy.signals),
          secretActions: len(st.blackbox && st.blackbox.secretActions),
          secretAssets: len(st.blackbox && st.blackbox.secretAssets)
        },
        regionalIncidentActive: !!(st.regionalIncident && st.regionalIncident.active),
        hasLastInjection: !!st.lastInjection,
        hasLastEvolveResult: !!st.lastEvolveResult,
        hasState: core.hasState ? core.hasState() : null
      };
    });

    // —— 存档点 ——
    diag.checkpoint = safe(function () {
      if (!core || !core.restoreCheckpoint) return { error: 'core 模块不可用' };
      const cp = core.restoreCheckpoint();
      if (!cp) return { exists: false };
      return { exists: true, round: cp.round, chatLayer: cp.chatLayer };
    });

    // —— 指纹 / 层数 ——
    diag.fingerprint = safe(function () {
      if (!core) return { error: 'core 模块不可用' };
      return {
        fingerprint: core.loadFingerprint ? core.loadFingerprint() : null,
        chatLayer: core.getChatLayer ? core.getChatLayer() : null,
        isNewRound: core.isNewRound ? core.isNewRound() : null,
        lastStoryDay: core.getLastStoryDay ? core.getLastStoryDay() : null,
        anchorLayer: core.getAnchorLayer ? core.getAnchorLayer() : null
      };
    });

    // —— 推演状态（含完整 prompt / 原始返回，用户已同意含对话原文）——
    diag.evolution = safe(function () {
      if (!evo) return { error: 'evolution 模块不可用' };
      const dbg = evo.getLastDebug ? evo.getLastDebug() : {};
      // [FIX] 补采 PR#12 的 prompt 分段结构：只存 key/label/长度，不重复存完整文本
      //   （完整内容已在 lastPrompt；分段用于核对哪段被预设覆盖、各段占比）。
      const segs = (dbg && Array.isArray(dbg.segments)) ? dbg.segments : [];
      return {
        isRunning: evo.isRunning ? evo.isRunning() : null,
        lastError: evo.getLastError ? evo.getLastError() : null,
        lastPrompt: (dbg && dbg.prompt) || '',
        lastRawResult: (dbg && dbg.rawResult) || '',
        lastPromptLen: ((dbg && dbg.prompt) || '').length,
        lastRawResultLen: ((dbg && dbg.rawResult) || '').length,
        segmentCount: segs.length,
        segments: segs.map(function (s) {
          return { key: (s && s.key) || null, label: (s && s.label) || null, contentLen: ((s && s.content) || '').length };
        })
      };
    });

    // —— 酒馆缓存 ——
    diag.chatcache = safe(function () {
      if (!chatcache || !chatcache.getStatus) return { error: 'chatcache 模块不可用' };
      const status = chatcache.getStatus();
      const snaps = chatcache.listSnapshots ? chatcache.listSnapshots() : [];
      return {
        status: status,
        snapshots: snaps.map(function (s) {
          return { id: s.id, name: s.name, auto: !!s.auto, round: s.round, createdAt: s.createdAt, v: s.v };
        })
      };
    });

    // —— 世界书 ——
    diag.worldbook = safe(function () {
      if (!worldbook) return { error: 'worldbook 模块不可用' };
      const ids = worldbook.getSelectedIds ? worldbook.getSelectedIds() : [];
      return {
        selectedCount: Array.isArray(ids) ? ids.length : 0,
        hasSelection: worldbook.hasSelection ? worldbook.hasSelection() : null,
        triggerEnabled: worldbook.triggerEnabled ? worldbook.triggerEnabled() : null
      };
    });

    // —— 存储键（仅 key 名，不导 value：避免泄露与体积膨胀）——
    diag.store = safe(function () {
      if (!store || !store.keys) return { error: 'store 模块不可用' };
      const keys = store.keys();
      return { count: keys.length, keys: keys };
    });

    // —— 规则 ——
    diag.rules = safe(function () {
      if (!rules || !rules.getRuleCount) return { error: 'rules 模块不可用' };
      return { ruleCount: rules.getRuleCount() };
    });

    // —— 引擎预设（PR#13 引入；诊断包此前未采集——排错时看不到当前预设与覆盖段）——
    diag.preset = safe(function () {
      if (!preset) return { error: 'preset 模块不可用' };
      const active = preset.getActivePreset ? preset.getActivePreset() : null;
      const overridden = preset.getOverriddenSegKeys ? preset.getOverriddenSegKeys() : [];
      const custom = preset.getCustomPresets ? preset.getCustomPresets() : [];
      const all = preset.getAllPresets ? preset.getAllPresets() : [];
      return {
        activeId: preset.getActivePresetId ? preset.getActivePresetId() : null,
        activeName: (active && (active.name || active.id)) || null,
        activeIsBuiltin: !!(active && active.builtin),
        overriddenSegKeys: Array.isArray(overridden) ? overridden.slice() : [],
        overriddenCount: Array.isArray(overridden) ? overridden.length : 0,
        presetCount: Array.isArray(all) ? all.length : 0,
        customPresetCount: Array.isArray(custom) ? custom.length : 0,
        // 仅列 id+name+builtin，不导出完整段文本（避免体积膨胀与潜在泄露）
        customPresetList: Array.isArray(custom) ? custom.map(function (p) {
          return { id: (p && p.id) || null, name: (p && p.name) || null, builtin: !!(p && p.builtin) };
        }) : []
      };
    });

    // —— 注入自检快照（解耦只读模块；排错时直接看上轮世界状态有没有真进最终 prompt）——
    //   客户报「注入失败」时，这里能区分 SUCCESS / MISSING（真失败）/ SKIPPED_*（按设计跳过/自己关了）。
    diag.injectInspector = safe(function () {
      if (!inspector || !inspector.getLastSnapshot) return { error: 'inspector 模块不可用' };
      const snap = inspector.getLastSnapshot();
      if (!snap) return { hasSnapshot: false, status: 'NOT_YET' };
      const out = {
        hasSnapshot: true,
        status: snap.status,
        statusText: inspector.statusText ? inspector.statusText(snap.status) : null,
        apiType: snap.apiType,
        round: snap.round,
        ts: snap.ts,
        injectEnabled: snap.injectEnabled,
        registeredAtSend: snap.registeredAtSend,
        sameLayerReroll: snap.sameLayerReroll,
        landed: snap.landed
      };
      if (snap.apiType === 'chat') {
        out.messageCount = snap.messageCount;
        out.ourIndex = snap.ourIndex;
        out.ourContentLen = (snap.ourContent || '').length;
        // role 链只报 role+长度+isOurs，不导正文（避免体积膨胀与泄露聊天上下文）
        out.roleChain = Array.isArray(snap.messages)
          ? snap.messages.map(function (m) { return { role: m.role, length: m.length, isOurs: !!m.isOurs }; })
          : [];
      } else {
        out.promptLength = snap.promptLength;
        out.ourExcerptLen = (snap.ourExcerpt || '').length;
      }
      return out;
    });

    // —— 过滤正则诊断（复用 core.validateFilterRegex：支持 /pat/flags 与纯 pattern 两种写法）——
    //   排错时无需猜测用户填的正则是否生效——这里逐行报出合法/非法条目与原因。
    diag.filterRegex = safe(function () {
      if (!core || !core.validateFilterRegex) return { error: 'core.validateFilterRegex 不可用' };
      const s = (api && api.getSettings) ? api.getSettings(true) : {};
      let raw = '';
      try { raw = s && s.evolveFilterRegex ? String(s.evolveFilterRegex) : ''; } catch (e) { raw = ''; }
      const v = core.validateFilterRegex(raw);
      return {
        rawTextLength: raw.length,
        rawLineCount: raw ? raw.split('\n').length : 0,
        nonEmptyCount: v.ok + v.bad.length,
        validCount: v.ok,
        invalidCount: v.bad.length,
        // 非法条目原样报出原因；raw 已在 validateFilterRegex 内截断 60 字
        invalidList: v.bad,
        // 合法条目只报 line + flags（不重复 pattern，避免体积膨胀）
        validList: v.entries.map(function (e) { return { line: e.line, flags: e.flags }; }),
        // raw 预览截断 200，便于一眼看出用户填了什么
        rawPreview: raw.slice(0, 200)
      };
    });

    return diag;
  }

  function collectMemory() {
    const data = window.MEMORY_ENGINE_DATA;
    const engine = window.MEMORY_ENGINE;
    const cache = window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory');
    const debug = safe(function () { return engine?.getLastDebug?.() || {}; });
    const state = safe(function () { return data?.loadState?.() || {}; });
    const characters = Array.isArray(state?.personal_memory) ? state.personal_memory : [];
    const entityTypes = ['organization', 'object', 'ability', 'location'];
    const entities = entityTypes.flatMap(function (type) { return Array.isArray(state?.entity_memory?.[type]) ? state.entity_memory[type] : []; });
    return {
      meta: safe(function () { return { engine: 'memory', extVersion: window.MEMORY_ENGINE_SETTINGS?.VERSION || '0.4.0', collectedAt: new Date().toISOString(), userAgent: navigator.userAgent }; }),
      env: safe(function () { const ctx = SillyTavern.getContext(); return { chatId: ctx?.chatId || null, chatCount: ctx?.chat?.length || 0, hasChatMetadata: !!ctx?.chatMetadata }; }),
      settings: safe(function () { return sanitizeSettings(window.MEMORY_ENGINE_SETTINGS?.getSettings?.(true) || {}); }),
      memoryState: safe(function () {
        return {
          hasState: data?.hasState?.() || false,
          round: state?.round || 0,
          characterCount: characters.length,
          memoryCount: characters.reduce(function (total, character) {
            return total + Object.values(character.memory || {}).reduce(function (sum, list) { return sum + (Array.isArray(list) ? list.length : 0); }, 0);
          }, 0),
          entityCount: entities.length,
          entityHistoryCount: entities.reduce(function (total, entity) { return total + (Array.isArray(entity.history) ? entity.history.length : 0); }, 0),
          smallSummaryCount: Array.isArray(state?.event_memory?.small_summaries) ? state.event_memory.small_summaries.length : 0,
          bigSummaryExists: !!state?.event_memory?.big_summary?.content,
          bigSummaryCursor: Number(state?.event_memory?.big_summary_cursor) || 0
        };
      }),
      checkpoint: safe(function () { const cp = data?.loadCheckpoint?.(); return { exists: !!cp, characterCount: Array.isArray(cp?.personal_memory) ? cp.personal_memory.length : 0, entityCount: entityTypes.reduce(function (sum, type) { return sum + (Array.isArray(cp?.entity_memory?.[type]) ? cp.entity_memory[type].length : 0); }, 0), smallSummaryCount: Array.isArray(cp?.event_memory?.small_summaries) ? cp.event_memory.small_summaries.length : 0, bigSummaryExists: !!cp?.event_memory?.big_summary?.content }; }),
      extraction: safe(function () { return { isRunning: engine?.isRunning?.() ?? null, lastError: engine?.getLastError?.() || null, lastPrompt: debug?.prompt || debug?.requestPrompt || '', lastRawResult: debug?.rawResult || debug?.apiResponse || debug?.response || '' }; }),
      injectionInspector: safe(function () { return window.WORLD_ENGINE_INJECT_INSPECTOR?.getLastSnapshot?.('memory') || engine?.getLastInjectionDebug?.() || debug?.injection || { hasSnapshot: false }; }),
      chatcache: safe(function () { return { status: cache?.getStatus?.() || null, snapshots: (cache?.listSnapshots?.() || []).map(function (item) { return { id: item.id, name: item.name, auto: !!item.auto, round: item.round, characters: item.characters, entities: item.entities, createdAt: item.createdAt }; }) }; }),
      worldbook: safe(function () { return { selectedCount: window.WORLD_ENGINE_WORLDBOOK?.getSelectedIds?.('memory')?.length || 0, triggerEnabled: window.WORLD_ENGINE_WORLDBOOK?.triggerEnabled?.('memory') || false }; }),
      filterRegex: safe(function () {
        const raw = window.MEMORY_ENGINE_SETTINGS?.getSettings?.().filterRegex || '';
        const result = window.WORLD_ENGINE_CORE?.validateFilterRegex?.(raw);
        return result ? { validCount: result.ok, invalidCount: result.bad.length, invalidList: result.bad, rawPreview: raw.slice(0, 200) } : { error: '校验器不可用' };
      })
    };
  }

  // 下载诊断包为 JSON 文件
  function download(scope) {
    const diag = collect(scope);
    const content = JSON.stringify(diag, null, 2);
    let chatId = 'unknown';
    try {
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.chatId) chatId = String(ctx.chatId).replace(/[^\w.-]+/g, '_').slice(0, 40);
    } catch (e) {}
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (scope === 'memory' ? 'memory-engine-diag-' : 'world-engine-diag-') + chatId + '-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    return content;
  }

  return { collect, download };
})();
