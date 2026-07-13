// memory-engine-data.js — 记忆引擎按聊天隔离的数据、存档点与命名存档
window.MEMORY_ENGINE_DATA = (function() {
  const STATE_PREFIX = 'memory_engine_state_';
  const CHECKPOINT_PREFIX = 'memory_engine_checkpoint_';
  const SNAPSHOTS_PREFIX = 'memory_engine_snapshots_';
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

  function defaultState() { return { personal_memory: [] }; }
  function hasState() { return window.WORLD_ENGINE_STORE?.getItem(key(STATE_PREFIX)) !== null; }
  function loadState() { return parse(window.WORLD_ENGINE_STORE?.getItem(key(STATE_PREFIX)), defaultState()); }
  function saveState(state) {
    const next = state && typeof state === 'object' && !Array.isArray(state) ? clone(state) : defaultState();
    if (!Array.isArray(next.personal_memory)) next.personal_memory = [];
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

  function listSnapshots() {
    const list = parse(window.WORLD_ENGINE_STORE?.getItem(key(SNAPSHOTS_PREFIX)), []);
    return Array.isArray(list) ? list : [];
  }
  function writeSnapshots(list) {
    window.WORLD_ENGINE_STORE?.setItem(key(SNAPSHOTS_PREFIX), JSON.stringify(list.slice(0, 30)));
  }
  function createSnapshot(name) {
    const item = {
      id: 'memory_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: String(name || '记忆存档').trim() || '记忆存档',
      createdAt: Date.now(),
      state: loadState(),
      checkpoint: loadCheckpoint()
    };
    writeSnapshots([item, ...listSnapshots()]);
    return clone(item);
  }
  function restoreSnapshot(id) {
    const item = listSnapshots().find(entry => entry.id === id);
    if (!item) return false;
    saveState(item.state);
    if (item.checkpoint) saveCheckpoint(item.checkpoint); else clearCheckpoint();
    return true;
  }
  function renameSnapshot(id, name) {
    const list = listSnapshots();
    const item = list.find(entry => entry.id === id);
    if (!item) return false;
    item.name = String(name || '').trim() || item.name;
    writeSnapshots(list);
    return true;
  }
  function deleteSnapshot(id) {
    const list = listSnapshots();
    const next = list.filter(entry => entry.id !== id);
    if (next.length === list.length) return false;
    writeSnapshots(next);
    return true;
  }
  function importSnapshot(payload) {
    const source = payload?.__memoryEngineSnapshot ? payload.snapshot : payload?.snapshot;
    if (!source || !source.state || !Array.isArray(source.state.personal_memory)) {
      throw new Error('不是合法的记忆存档');
    }
    const item = {
      id: 'memory_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: String(source.name || '导入的记忆存档'),
      createdAt: Number(source.createdAt) || Date.now(),
      state: clone(source.state),
      checkpoint: clone(source.checkpoint || null)
    };
    writeSnapshots([item, ...listSnapshots()]);
    return clone(item);
  }

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
    listSnapshots, createSnapshot, restoreSnapshot, renameSnapshot, deleteSnapshot, importSnapshot,
    exportData, importData
  };
})();
