// world-engine-bookinject.js — 注入世界状态为世界书条目（与黑科技同策略：constant 类型条目，绝对兼容）
//
// 策略：优先写入角色已有主世界书，没有才创建辅助世界书。
//   - 角色有主世界书 → 在其中加一条 constant 条目
//   - 角色无主世界书 → 新建「🌍 世界引擎 — {{char}}」辅助世界书
//   - 条目按 comment 标识查找，不存在则创建，关了就打开，内容全量更新
window.WORLD_ENGINE_BOOKINJECT = (function() {
  const BOOK_PREFIX = '🌍 世界引擎';
  const ENTRY_COMMENT = 'WorldEngine-LiveState';

  let _lastContent = '';
  let _refreshTimer = null;
  const REFRESH_DELAY = 800;

  function core() { return window.WORLD_ENGINE_CORE; }
  function injectMod() { return window.WORLD_ENGINE_INJECT; }
  function store() { return window.WORLD_ENGINE_STORE; }

  let _wiModule = null;
  async function wi() {
    if (_wiModule) return _wiModule;
    _wiModule = await import('/scripts/world-info.js');
    return _wiModule;
  }

  function getCtx() {
    try { return SillyTavern.getContext(); } catch (e) { return null; }
  }

  function getCharName() {
    try {
      const ctx = getCtx();
      // name2 = 角色名（卡的名字），name1 = 用户名
      if (ctx?.name2) return ctx.name2;
      const chid = ctx && ctx.characterId !== undefined ? ctx.characterId : undefined;
      const characters = ctx?.characters || {};
      const char = chid !== undefined ? characters[chid] : null;
      if (char?.name) return char.name;
    } catch (e) {}
    return '未知角色';
  }

  function getCharPrimaryWorld() {
    try {
      const ctx = getCtx();
      if (!ctx || ctx.characterId == null) return null;
      const characters = ctx.characters || {};
      const char = characters[ctx.characterId];
      return char?.data?.extensions?.world || null;
    } catch (e) { return null; }
  }

  function getCharFileName() {
    try {
      const ctx = getCtx();
      const chid = ctx && ctx.characterId !== undefined ? ctx.characterId : undefined;
      if (chid === undefined) return null;
      if (typeof getCharaFilename === 'function') return getCharaFilename(chid);
      return null;
    } catch (e) { return null; }
  }

  function fallbackBookName() {
    return BOOK_PREFIX + ' — ' + getCharName();
  }

  // ========== 核心 ==========

  // 决定用哪个世界书：优先角色主世界书，否则新建辅助世界书
  // 返回 { bookName, data, entry }
  async function ensureEntry() {
    const m = await wi();
    const ctx = getCtx();
    if (!ctx || !ctx.chatId) return null;

    const primaryWorld = getCharPrimaryWorld();
    let bookName;
    let isNewBook = false;

    if (primaryWorld) {
      // 角色有主世界书 → 直接用
      bookName = primaryWorld;
    } else {
      // 无主世界书 → 新建辅助世界书
      bookName = fallbackBookName();
    }

    // 1. 加载世界书
    let data = (m.worldInfoCache && m.worldInfoCache.has(bookName))
      ? m.worldInfoCache.get(bookName) : null;
    if (!data) data = await m.loadWorldInfo(bookName);

    // 2. 不存在则创建
    if (!data) {
      console.log('[世界引擎][书注] 创建世界书:', bookName);
      data = { entries: {} };
      await m.saveWorldInfo(bookName, data, true);
      try { await m.updateWorldInfoList(); } catch (e) {}
      isNewBook = true;
    }

    // 3. 新建的辅助世界书需绑定角色
    if (!primaryWorld && isNewBook) {
      const charFile = getCharFileName();
      if (charFile) {
        try { await m.charUpdateAddAuxWorld(charFile, bookName); } catch (e) {}
      }
    }

    // 4. 查找或创建条目
    let entry = Object.values(data.entries || {}).find(e => e && e.comment === ENTRY_COMMENT);
    if (!entry) {
      entry = m.createWorldInfoEntry(bookName, data);
      if (!entry) return null;
      entry.comment = ENTRY_COMMENT;
      entry.constant = true;
      entry.disable = false;
      entry.preventRecursion = true;
      entry.order = 1;
      entry.position = 0;            // before chat
      entry.depth = m.DEFAULT_DEPTH || 4;
      entry.key = ['WorldEngine-LiveState-Key'];
      entry.selective = false;
      console.log('[世界引擎][书注] 在「' + bookName + '」中创建条目 uid=' + entry.uid);
      // 新建条目后保存，确保下次 loadWorldInfo 能读到
      await m.saveWorldInfo(bookName, data, true);
    }

    // 5. 条目关了则打开
    if (entry.disable) {
      entry.disable = false;
    }

    return { bookName, data, entry };
  }

  // ========== 公开 API ==========

  async function inject(content) {
    if (!content || content === _lastContent) return false;
    try {
      const res = await ensureEntry();
      if (!res) return false;
      if (res.entry.content === content) { _lastContent = content; return true; }

      res.entry.content = content;
      const m = await wi();
      await m.saveWorldInfo(res.bookName, res.data, true);
      // 自动刷新世界书 UI 列表
      try { await m.updateWorldInfoList(); } catch (e) {}
      _lastContent = content;
      console.log('[世界引擎][书注] 注入完成 (' + content.length + ' chars) → ' + res.bookName);
      return true;
    } catch (e) {
      console.warn('[世界引擎][书注] 注入失败:', e.message);
      return false;
    }
  }

  async function remove() {
    try {
      const m = await wi();
      const primaryWorld = getCharPrimaryWorld();
      const bookName = primaryWorld || fallbackBookName();
      let data = (m.worldInfoCache && m.worldInfoCache.has(bookName)) ? m.worldInfoCache.get(bookName) : null;
      if (!data) data = await m.loadWorldInfo(bookName);
      if (!data) return;
      const entry = Object.values(data.entries || {}).find(e => e && e.comment === ENTRY_COMMENT);
      if (entry && !entry.disable) {
        entry.disable = true;
        entry.content = '';
        await m.saveWorldInfo(bookName, data, true);
        _lastContent = '';
      }
    } catch (e) {}
  }

  async function refreshNow() {
    try {
      const ctx = getCtx();
      if (!ctx) return;
      const state = core().hasState() ? core().loadState() : null;

      // 新聊天未推演 → 清掉旧聊天残留的条目
      if (!state || state.round === 0) {
        await remove();
        return;
      }

      const tags = [];
      for (const ev of state.events || []) tags.push(ev.name);
      for (const f of state.factions || []) tags.push(f.name);

      const context = injectMod().buildContext(state, tags);
      await inject(context);
    } catch (e) {
      console.warn('[世界引擎][书注] 刷新失败:', e.message);
    }
  }

  function scheduleRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => { _refreshTimer = null; refreshNow(); }, REFRESH_DELAY);
  }

  function onStoreWrite(key, value) {
    try {
      const ctx = getCtx();
      if (!ctx || !ctx.chatId) return;
      const stateKey = 'world_engine_' + ctx.chatId;
      const cpKey = stateKey + '_checkpoint';
      if (key === stateKey || key === cpKey) scheduleRefresh();
    } catch (e) {}
  }

  function installStoreListener() {
    const st = store();
    if (!st) return;
    const origSetItem = st.setItem.bind(st);
    st.setItem = function(key, value) { origSetItem(key, value); onStoreWrite(key, value); };
  }

  return { inject, remove, refreshNow, scheduleRefresh, installStoreListener };
})();
