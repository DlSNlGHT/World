// memory-engine-settings.js — 记忆引擎独立设置（只复用 API/调度等实现，不共享配置值）
window.MEMORY_ENGINE_SETTINGS = (function() {
  const STORAGE_KEY = 'memory_engine_settings';
  const VERSION = '0.4.4';
  const DEFAULTS = Object.freeze({
    apiUrl: '',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    connectionMode: 'direct',
    temperature: 0.2,
    maxTokens: 2000,
    apiTimeoutMs: 120000,
    engineEnabled: true,
    firstLayerIsAiOpening: true,
    evolveMode: 'auto',
    evolveEveryX: 5,
    evolveReadRounds: 5,
    manualReadRounds: 5,
    smallSummaryEveryX: 5,
    bigSummaryEveryX: 5,
    injectIntoPrompt: true,
    searchDepth: 5,
    maxPerCharacter: 20,
    apiAutoRetries: 0,
    filterRegex: '',
    tonePrompt: '',
    worldbookEnabled: false,
    worldbookTrigger: false,
    syncToChat: false,
    autoBackup: false,
    backfillBatchSize: 5,
    summaryBackfillSmallEveryX: 5,
    summaryBackfillBigEveryX: 5,
    backfillRetries: 2,
    backfillEndLayer: 0
  });

  let cached = null;

  function readStored() {
    try {
      const raw = window.WORLD_ENGINE_STORE?.getItem(STORAGE_KEY);
      if (!raw) {
        // test 分支早期版本曾把 memory* 字段误放进 world_engine_settings；仅首次读取时迁移。
        const worldRaw = window.WORLD_ENGINE_STORE?.getItem('world_engine_settings');
        const world = worldRaw ? JSON.parse(worldRaw) : {};
        const migrated = {
          evolveMode: world.memoryEvolveMode,
          evolveEveryX: world.memoryEvolveEveryX,
          evolveReadRounds: world.memoryEvolveReadRounds,
          manualReadRounds: world.memoryManualReadRounds,
          injectIntoPrompt: world.memoryInjectIntoPrompt,
          searchDepth: world.memorySearchDepth,
          maxPerCharacter: world.memoryMaxPerCharacter,
          worldbookEnabled: world.memoryWorldbookEnabled,
          backfillBatchSize: world.memoryBackfillBatchSize,
          backfillRetries: world.memoryBackfillRetries,
          backfillEndLayer: world.memoryBackfillEndLayer
        };
        const clean = Object.fromEntries(Object.entries(migrated).filter(([, value]) => value !== undefined));
        if (Object.keys(clean).length) return clean;
      }
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      console.warn('[记忆引擎] 读取设置失败，使用默认值', error);
      return {};
    }
  }

  function getSettings(forceRefresh) {
    if (forceRefresh) cached = null;
    if (!cached) cached = { ...DEFAULTS, ...readStored() };
    return { ...cached };
  }

  function saveSettings(next) {
    cached = { ...DEFAULTS, ...(next || {}) };
    window.WORLD_ENGINE_STORE?.setItem(STORAGE_KEY, JSON.stringify(cached));
    return { ...cached };
  }

  function patchSettings(patch) {
    return saveSettings({ ...getSettings(true), ...(patch || {}) });
  }

  return {
    STORAGE_KEY,
    VERSION,
    DEFAULTS,
    getSettings,
    saveSettings,
    patchSettings
  };
})();
