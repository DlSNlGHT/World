// memory-engine-data.js — 记忆引擎按聊天隔离的状态与存档点
window.MEMORY_ENGINE_DATA = (function() {
  const STATE_PREFIX = 'memory_engine_state_';
  const CHECKPOINT_PREFIX = 'memory_engine_checkpoint_';
  const VERSION = '0.2.0';
  const ENTITY_TYPES = ['organization', 'object', 'ability', 'location'];

  function getChatId() {
    return window.WORLD_ENGINE_CORE?.getChatId?.() || 'default';
  }

  function key(prefix) { return prefix + getChatId(); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function parse(raw, fallback) {
    if (!raw) return clone(fallback);
    try { return JSON.parse(raw); } catch (error) { return clone(fallback); }
  }

  function defaultState() {
    return {
      personal_memory: [],
      knowledge_index: {},
      entity_memory: { organization: [], object: [], ability: [], location: [] },
      entity_index: {},
      round: 0,
      chatLayer: null
    };
  }
  function normalizeState(state) {
    const next = state && typeof state === 'object' && !Array.isArray(state) ? clone(state) : defaultState();
    if (!Array.isArray(next.personal_memory)) next.personal_memory = [];
    if (!next.knowledge_index || typeof next.knowledge_index !== 'object' || Array.isArray(next.knowledge_index)) next.knowledge_index = {};
    // 兼容开发期曾使用的 world_memory/item 结构；对外稳定结构只保留 entity_memory/object。
    if (!next.entity_memory || typeof next.entity_memory !== 'object' || Array.isArray(next.entity_memory)) {
      const legacy = next.world_memory && typeof next.world_memory === 'object' && !Array.isArray(next.world_memory)
        ? next.world_memory : {};
      next.entity_memory = {
        organization: legacy.organization,
        object: legacy.object || legacy.item,
        ability: legacy.ability,
        location: legacy.location
      };
    }
    if (!Array.isArray(next.entity_memory.object) && Array.isArray(next.entity_memory.item)) {
      next.entity_memory.object = next.entity_memory.item;
    }
    delete next.entity_memory.item;
    for (const type of ENTITY_TYPES) {
      if (!Array.isArray(next.entity_memory[type])) next.entity_memory[type] = [];
    }
    delete next.world_memory;
    if (!next.entity_index || typeof next.entity_index !== 'object' || Array.isArray(next.entity_index)) next.entity_index = {};
    next.round = Math.max(0, parseInt(next.round) || 0);
    next.chatLayer = next.chatLayer !== null && next.chatLayer !== '' && Number.isFinite(Number(next.chatLayer))
      ? Number(next.chatLayer) : null;
    return next;
  }
  function hasState() { return window.WORLD_ENGINE_STORE?.getItem(key(STATE_PREFIX)) !== null; }
  function loadState() { return normalizeState(parse(window.WORLD_ENGINE_STORE?.getItem(key(STATE_PREFIX)), defaultState())); }
  function saveState(state) {
    const next = normalizeState(state);
    window.WORLD_ENGINE_STORE?.setItem(key(STATE_PREFIX), JSON.stringify(next));
    return clone(next);
  }

  function loadCheckpoint() {
    const checkpoint = parse(window.WORLD_ENGINE_STORE?.getItem(key(CHECKPOINT_PREFIX)), null);
    return checkpoint ? normalizeState(checkpoint) : null;
  }
  function saveCheckpoint(state) {
    const next = state === undefined ? loadState() : state;
    window.WORLD_ENGINE_STORE?.setItem(key(CHECKPOINT_PREFIX), JSON.stringify(clone(next)));
    return clone(next);
  }
  function clearCheckpoint() { window.WORLD_ENGINE_STORE?.removeItem(key(CHECKPOINT_PREFIX)); }

  function exportData() {
    return {
      __memoryEngineData: true,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      chatId: getChatId(),
      state: loadState(),
      checkpoint: loadCheckpoint()
    };
  }
  function importData(payload) {
    const state = payload?.__memoryEngineData ? payload.state : (payload?.state || payload);
    const hasPersonal = Array.isArray(state?.personal_memory);
    const hasWorld = (state?.entity_memory && typeof state.entity_memory === 'object' && !Array.isArray(state.entity_memory))
      || (state?.world_memory && typeof state.world_memory === 'object' && !Array.isArray(state.world_memory));
    if (!state || typeof state !== 'object' || Array.isArray(state)
      || (!hasPersonal && !hasWorld)) {
      throw new Error('缺少合法的记忆数据');
    }
    saveState(state);
    if (payload?.__memoryEngineData || Object.prototype.hasOwnProperty.call(payload || {}, 'checkpoint')) {
      if (payload.checkpoint) saveCheckpoint(payload.checkpoint); else clearCheckpoint();
    }
    return loadState();
  }

  return {
    VERSION, getChatId, defaultState, hasState, loadState, saveState,
    loadCheckpoint, saveCheckpoint, clearCheckpoint,
    exportData, importData
  };
})();
