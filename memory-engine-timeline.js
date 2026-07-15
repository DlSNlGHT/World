// 记忆引擎时间链：为正文、纪要和实体更新提供稳定来源身份、哈希校验与安全隐藏。
window.MEMORY_ENGINE_TIMELINE = (function() {
  const SOURCE_ID_KEY = 'world_engine_memory_source_id';
  const HIDDEN_KEY = 'world_engine_memory_hidden';
  let idCounter = 0;
  let saveTimer = null;

  const clean = value => String(value == null ? '' : value).trim();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function context() { try { return SillyTavern.getContext(); } catch (_) { return null; } }
  function chatId() {
    return clean(window.WORLD_ENGINE_CORE?.getChatId?.() || context()?.chatId || 'default');
  }
  function chat() { return context()?.chat || []; }

  // 同步、稳定且足够便宜；哈希只用于变化检测，不承担安全用途。
  function hashText(value) {
    const text = String(value == null ? '' : value);
    let first = 0x811c9dc5, second = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      first ^= code;
      first = Math.imul(first, 0x01000193) >>> 0;
      second ^= code + ((second << 6) >>> 0) + (second >>> 2);
      second >>>= 0;
    }
    return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
  }

  function messageHash(message) {
    return hashText(JSON.stringify({
      role: message?.is_user ? 'user' : 'assistant',
      name: clean(message?.name),
      mes: String(message?.mes || '')
    }));
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const ctx = context();
      try {
        if (typeof ctx?.saveChatConditional === 'function') ctx.saveChatConditional();
        else if (typeof ctx?.saveChat === 'function') ctx.saveChat();
      } catch (_) { /* 来源 ID 已在内存中生效；保存失败不阻断记忆流程。 */ }
    }, 250);
  }

  function ensureMessageId(message) {
    if (!message) return '';
    if (!message.extra || typeof message.extra !== 'object' || Array.isArray(message.extra)) message.extra = {};
    let id = clean(message.extra[SOURCE_ID_KEY]);
    if (!id) {
      id = `wem_${Date.now().toString(36)}_${(++idCounter).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      message.extra[SOURCE_ID_KEY] = id;
      scheduleSave();
    }
    return id;
  }

  function sourceRef(message, layer, sourceChatId) {
    if (!message) return null;
    return {
      chatId: clean(sourceChatId || chatId()),
      messageId: ensureMessageId(message),
      layer: Number(layer) || 0,
      role: message.is_user ? 'user' : 'assistant',
      swipeId: Number.isFinite(Number(message.swipe_id)) ? Number(message.swipe_id) : 0,
      hash: messageHash(message)
    };
  }

  function captureRange(startLayer, endLayer) {
    const all = chat(), start = Math.max(0, Number(startLayer) || 0);
    const end = Math.min(all.length - 1, Math.max(start, Number(endLayer) || 0));
    const refs = [];
    for (let i = start; i <= end; i++) {
      const ref = sourceRef(all[i], i);
      if (ref) refs.push(ref);
    }
    return refs;
  }

  function digestRefs(refs) {
    return hashText((refs || []).map(ref => [
      clean(ref.chatId), clean(ref.messageId), Number(ref.swipeId) || 0, clean(ref.hash)
    ].join(':')).join('|'));
  }

  function currentMessageMap() {
    const map = new Map(), all = chat();
    all.forEach((message, layer) => {
      const id = ensureMessageId(message);
      if (id) map.set(id, { message, layer });
    });
    return map;
  }

  function auditRefs(refs) {
    const source = Array.isArray(refs) ? refs : [];
    if (!source.length) return { valid: false, reason: 'no_sources', refs: [], changed: [], missing: [] };
    if (source.every(ref => ref?.synthetic === true)) {
      return { valid: true, synthetic: true, refs: clone(source), changed: [], missing: [] };
    }
    const currentChatId = chatId();
    // 继承自其它聊天的节点属于 Root 之前的已封存历史，不拿当前聊天楼层重复校验。
    if (source.every(ref => clean(ref.chatId) && clean(ref.chatId) !== currentChatId)) {
      return { valid: true, inherited: true, refs: clone(source), changed: [], missing: [] };
    }
    const map = currentMessageMap(), current = [], changed = [], missing = [];
    for (const oldRef of source) {
      if (clean(oldRef.chatId) !== currentChatId) {
        missing.push(oldRef);
        continue;
      }
      const found = map.get(clean(oldRef.messageId));
      if (!found) {
        missing.push(oldRef);
        continue;
      }
      const next = sourceRef(found.message, found.layer, currentChatId);
      current.push(next);
      if (clean(next.hash) !== clean(oldRef.hash) || Number(next.swipeId) !== Number(oldRef.swipeId)) {
        changed.push({ before: oldRef, after: next });
      }
    }
    current.sort((a, b) => a.layer - b.layer);
    return {
      valid: missing.length === 0 && changed.length === 0,
      inherited: false,
      refs: current,
      changed,
      missing,
      startLayer: current.length ? current[0].layer : null,
      endLayer: current.length ? current[current.length - 1].layer : null
    };
  }

  function refsToConversation(refs) {
    const audit = auditRefs(refs);
    const map = currentMessageMap(), ctx = context();
    return audit.refs.map(ref => {
      const found = map.get(clean(ref.messageId));
      if (!found) return '';
      const message = found.message;
      const fallback = message?.is_user ? (ctx?.name1 || '用户') : (ctx?.name2 || '角色');
      return `[楼层 ${found.layer}]【${clean(message?.name) || fallback}】\n${clean(message?.mes)}`;
    }).filter(Boolean).join('\n\n');
  }

  function unionRefs(groups) {
    const seen = new Set(), result = [];
    for (const ref of (groups || []).flatMap(group => Array.isArray(group) ? group : [])) {
      const key = `${clean(ref.chatId)}:${clean(ref.messageId)}`;
      if (!clean(ref.messageId) || seen.has(key)) continue;
      seen.add(key);
      result.push(clone(ref));
    }
    return result.sort((a, b) => Number(a.layer) - Number(b.layer));
  }

  function coalesceRanges(indices) {
    const ranges = [];
    for (const index of [...new Set(indices)].sort((a, b) => a - b)) {
      const last = ranges[ranges.length - 1];
      if (last && index === last[1] + 1) last[1] = index;
      else ranges.push([index, index]);
    }
    return ranges;
  }

  async function syncHidden(coveredMessageIds) {
    const wanted = coveredMessageIds instanceof Set ? coveredMessageIds : new Set(coveredMessageIds || []);
    const all = chat(), toHide = [], toUnhide = [];
    all.forEach((message, layer) => {
      const id = ensureMessageId(message);
      if (wanted.has(id)) {
        if (message.extra?.[HIDDEN_KEY] !== true || message.is_system !== true) toHide.push(layer);
      } else if (message.extra?.[HIDDEN_KEY] === true) toUnhide.push(layer);
    });
    if (!toHide.length && !toUnhide.length) return { hidden: 0, unhidden: 0 };

    const ctx = context(), exec = ctx?.executeSlashCommandsWithOptions;
    const mark = (layer, hidden) => {
      const message = all[layer];
      if (!message) return;
      if (!message.extra || typeof message.extra !== 'object') message.extra = {};
      if (hidden) message.extra[HIDDEN_KEY] = true;
      else delete message.extra[HIDDEN_KEY];
    };
    if (typeof exec === 'function') {
      for (const [start, end] of coalesceRanges(toUnhide)) {
        for (let i = start; i <= end; i++) mark(i, false);
        const arg = start === end ? `${start}` : `${start}-${end}`;
        try { await exec(`/unhide ${arg}`); }
        catch (_) { for (let i = start; i <= end; i++) if (all[i]) all[i].is_system = false; }
      }
      for (const [start, end] of coalesceRanges(toHide)) {
        for (let i = start; i <= end; i++) mark(i, true);
        const arg = start === end ? `${start}` : `${start}-${end}`;
        try { await exec(`/hide ${arg}`); }
        catch (_) { for (let i = start; i <= end; i++) if (all[i]) all[i].is_system = true; }
      }
    } else {
      for (const layer of toUnhide) { mark(layer, false); if (all[layer]) all[layer].is_system = false; }
      for (const layer of toHide) { mark(layer, true); if (all[layer]) all[layer].is_system = true; }
      try {
        if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
        if (typeof ctx?.reloadCurrentChat === 'function') await ctx.reloadCurrentChat();
      } catch (_) { /* 内存态已经同步。 */ }
    }
    scheduleSave();
    return { hidden: toHide.length, unhidden: toUnhide.length };
  }

  return {
    SOURCE_ID_KEY, HIDDEN_KEY,
    hashText, messageHash, ensureMessageId, sourceRef, captureRange, digestRefs,
    auditRefs, refsToConversation, unionRefs, syncHidden, chatId
  };
})();
