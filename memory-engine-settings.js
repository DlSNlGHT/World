// memory-engine-settings.js — 记忆引擎独立设置（只复用 API/调度等实现，不共享配置值）
window.MEMORY_ENGINE_SETTINGS = (function() {
  const STORAGE_KEY = 'memory_engine_settings';
  const VERSION = '1.0.0';
  const DEFAULTS = Object.freeze({
    apiUrl: '',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    connectionMode: 'direct',
    temperature: 0.2,
    maxTokens: 65000,
    apiTimeoutMs: 120000,
    engineEnabled: true,
    firstLayerIsAiOpening: true,
    evolveMode: 'auto',
    evolveEveryX: 1,
    evolveReadRounds: 1,
    manualReadRounds: 1,
    smallSummaryEveryX: 1,
    bigSummaryEveryX: 5,
    bigSummaryInjectLimit: 3,
    recentRawRounds: 1,
    referenceRawRounds: 1,
    referenceSmallSummaryCount: 5,
    referenceBigSummaryCount: 1,
    injectIntoPrompt: true,
    injectIntoWorldEngine: false,
    worldEngineMemoryLimit: 5,
    searchDepth: 5,
    maxPerCharacter: 20,
    injectionDiceSides: 10000,
    apiAutoRetries: 0,
    nameBlacklist: '',
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

  // 日常记忆以一轮为最小可重放单元：人物/实体与纪要同轮联合提取。
  // 这里同时覆盖旧存档和 UI 传入值，避免历史设置中的 X 继续生效。
  function normalizeSettings(value) {
    const merged = { ...DEFAULTS, ...(value || {}) };
    const savedMaxTokens = Math.max(1, parseInt(merged.maxTokens) || 65000);
    return {
      ...merged,
      // 旧版部分预设把输出上限保存成 4096；升级后自动迁移，避免继续截断 API 返回。
      maxTokens: savedMaxTokens === 4096 ? 65000 : savedMaxTokens,
      evolveEveryX: 1,
      evolveReadRounds: 1,
      manualReadRounds: 1,
      smallSummaryEveryX: 1,
      recentRawRounds: Math.max(0, parseInt(merged.recentRawRounds) || 0),
      referenceRawRounds: Math.max(0, parseInt(merged.referenceRawRounds) || 0),
      referenceSmallSummaryCount: Math.max(0, parseInt(merged.referenceSmallSummaryCount) || 0),
      referenceBigSummaryCount: Math.max(0, parseInt(merged.referenceBigSummaryCount) || 0)
    };
  }

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
    if (!cached) cached = normalizeSettings(readStored());
    return { ...cached };
  }

  function saveSettings(next) {
    cached = normalizeSettings(next);
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
