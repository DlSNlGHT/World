// memory-engine-data.js — 记忆引擎按聊天隔离的状态与存档点
window.MEMORY_ENGINE_DATA = (function() {
  const STATE_PREFIX = 'memory_engine_state_';
  const CHECKPOINT_PREFIX = 'memory_engine_checkpoint_';
  const VERSION = '0.1.0';

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
    return { personal_memory: [], knowledge_index: {}, round: 0, chatLayer: null };
  }
  function hasState() { return window.WORLD_ENGINE_STORE?.getItem(key(STATE_PREFIX)) !== null; }
  function loadState() { return parse(window.WORLD_ENGINE_STORE?.getItem(key(STATE_PREFIX)), defaultState()); }
  function saveState(state) {
    const next = state && typeof state === 'object' && !Array.isArray(state) ? clone(state) : defaultState();
    if (!Array.isArray(next.personal_memory)) next.personal_memory = [];
    if (!next.knowledge_index || typeof next.knowledge_index !== 'object' || Array.isArray(next.knowledge_index)) next.knowledge_index = {};
    next.round = Math.max(0, parseInt(next.round) || 0);
    next.chatLayer = next.chatLayer !== null && next.chatLayer !== '' && Number.isFinite(Number(next.chatLayer))
      ? Number(next.chatLayer) : null;
    window.WORLD_ENGINE_STORE?.setItem(key(STATE_PREFIX), JSON.stringify(next));
    return clone(next);
  }

  function loadCheckpoint() {
    return parse(window.WORLD_ENGINE_STORE?.getItem(key(CHECKPOINT_PREFIX)), null);
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
    if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.personal_memory)) {
      throw new Error('缺少合法的 personal_memory 数组');
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
