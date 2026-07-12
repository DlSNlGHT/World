// world-engine-core.js — 核心数据结构与存储（按聊天ID隔离）
window.WORLD_ENGINE_CORE = (function() {
  const STORAGE_PREFIX = 'world_engine_';
  const EVENT_TYPES = ['conflict', 'progress'];
  const EVENT_STAGE_ORDER = {
    conflict: ['萌芽', '发酵', '逼近'],
    progress: ['筹备', '执行', '关键']
  };
  const EVENT_STAGE_MAP = {
    conflict: ['萌芽', '发酵', '逼近', '已爆发', '已消散'],
    progress: ['筹备', '执行', '关键', '已完成', '已失败']
  };
  const EVENT_SUCCESS_STAGE = {
    conflict: '已爆发',
    progress: '已完成'
  };
  const EVENT_TERMINAL_STAGES = {
    conflict: ['已爆发', '已消散'],
    progress: ['已完成', '已失败']
  };

  function getSettings() {
    return window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings ? window.WORLD_ENGINE_API.getSettings() : {};
  }

  function capSetting(key, fallback) {
    const n = Number(getSettings()[key]);
    return Math.max(1, Math.round(Number.isFinite(n) ? n : fallback));
  }

  function getDefaultState() {
    return {
      round: 0,
      worldDigest: '世界正在苏醒，一切尚未可知。',
      events: [],
      factions: [],
      winds: [],
      worldTrends: [],
      reputation: {
        authority: '默默无闻',
        common: '默默无闻',
        shadow: '默默无闻',
        circuit: '默默无闻',
        lastChange: ''
      },
      economy: {
        climate: '平稳',
        signals: []
      },
      memories: [],
      enemies: [],
      influenceChain: [],
      regionalIncident: {
        active: false,
        title: '',
        type: '',
        scope: '',
        impact: '',
        cooldown: 0,
        _retry: false,
        _retryType: ''
      },
      distantEvent: {
        pending: false,
        cooldown: 0,
        sample: [],
        requestedRound: 0,
        requestedType: ''
      },
      nearEvent: {
        pending: false,
        cooldown: 0,
        requestedRound: 0,
        requestedType: ''
      },
      blackbox: {
        secretActions: [],
        secretAssets: []
      },
      lastEvolveResult: null,
      lastInjection: null,
      lastUpdated: {}
    };
  }

  /** 获取当前扮演的角色名 */
  function getUserName() {
    try {
      const ctx = SillyTavern.getContext();
      if (ctx?.name1) return ctx.name1;
      if (ctx?.name2) return ctx.name2;
      const character = ctx?.characters?.[ctx?.characterId];
      if (character?.name) return character.name;
    } catch(e) {}
    return '用户';
  }

  /** UI 渲染：替换文本中的 {{user}} 为当前角色名 */
  function renderUserName(text) {
    if (!text || typeof text !== 'string') return text;
    const name = getUserName();
    return text.replace(/\{\{user\}\}/g, name);
  }

  function getChatId() {
    try {
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.chatId) return ctx.chatId;
    } catch(e) {}
    return 'default';
  }

  // 持续实体使用分类 ID。ID 只在当前状态时间线内唯一；重 roll / 恢复存档后，
  // 后续编号自然从恢复后的数组最大值继续，不维护不可回滚的全局计数器。
  const ENTITY_ID_PREFIXES = {
    events: 'event',
    factions: 'faction',
    worldTrends: 'trend',
    winds: 'wind',
    enemies: 'enemy'
  };
  const ENTITY_LEGACY_KEYS = {
    events: 'name',
    factions: 'name',
    worldTrends: 'name',
    winds: 'topic',
    enemies: 'name'
  };

  function entityIdNumber(id, prefix) {
    const m = String(id || '').match(new RegExp(`^${prefix}_([1-9]\\d*)$`));
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }

  function nextEntityId(items, prefix) {
    let max = 0;
    for (const item of (items || [])) {
      const n = item && entityIdNumber(item.id, prefix);
      if (n !== null && n > max) max = n;
    }
    return `${prefix}_${max + 1}`;
  }

  /**
   * 旧存档迁移与损坏修复：
   * - 缺失/非法 ID 按数组现状补号；
   * - 重复 ID 只保留第一次出现的对象，后续对象获得新 ID；
   * - 合法 ID 不重排，保证存档加载、导入和 checkpoint 恢复稳定。
   */
  function ensureEntityIds(items, prefix) {
    if (!Array.isArray(items)) return items;
    let max = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const n = entityIdNumber(item.id, prefix);
      if (n !== null && n > max) max = n;
    }
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const n = entityIdNumber(item.id, prefix);
      if (n !== null && !seen.has(item.id)) {
        seen.add(item.id);
        continue;
      }
      do { max++; } while (seen.has(`${prefix}_${max}`));
      item.id = `${prefix}_${max}`;
      seen.add(item.id);
    }
    return items;
  }

  function findEntityIndex(items, incoming, prefix, legacyKey) {
    if (!Array.isArray(items) || !incoming || typeof incoming !== 'object') return -1;
    const explicitlyNew = Object.prototype.hasOwnProperty.call(incoming, 'id')
      && (incoming.id === null || incoming.id === '');
    if (explicitlyNew) return -1;
    if (entityIdNumber(incoming.id, prefix) !== null) {
      const byId = items.findIndex(item => item && item.id === incoming.id);
      if (byId !== -1) return byId;
    }
    // 兼容旧预设/旧模型：未返回 ID 或返回了未知 ID 时，仅用唯一同名项认领旧 ID。
    const value = incoming[legacyKey];
    if (!value) return -1;
    const matches = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i] && items[i][legacyKey] === value) matches.push(i);
    }
    return matches.length === 1 ? matches[0] : -1;
  }

  function assignEntityId(items, item, prefix) {
    if (!item || typeof item !== 'object') return item;
    item.id = nextEntityId(items, prefix);
    return item;
  }

  // 首次升级旧存档时，checkpoint 是祖先状态和身份基准。
  // 当前状态先按唯一旧名称继承 checkpoint ID，之后才给本轮新增实体继续补号。
  function inheritLegacyIds(targetState, referenceState) {
    if (!targetState || !referenceState) return targetState;
    for (const collection of Object.keys(ENTITY_ID_PREFIXES)) {
      const prefix = ENTITY_ID_PREFIXES[collection];
      const legacyKey = ENTITY_LEGACY_KEYS[collection];
      const targetItems = Array.isArray(targetState[collection]) ? targetState[collection] : [];
      const referenceItems = Array.isArray(referenceState[collection]) ? referenceState[collection] : [];
      ensureEntityIds(referenceItems, prefix);
      const used = new Set(targetItems
        .map(item => item && entityIdNumber(item.id, prefix) !== null ? item.id : null)
        .filter(Boolean));
      for (const item of targetItems) {
        if (!item || typeof item !== 'object' || entityIdNumber(item.id, prefix) !== null) continue;
        const matches = referenceItems.filter(ref => ref && ref[legacyKey] && ref[legacyKey] === item[legacyKey]);
        if (matches.length === 1 && !used.has(matches[0].id)) {
          item.id = matches[0].id;
          used.add(item.id);
        }
      }
    }
    return targetState;
  }

  function ensureArrays(state) {
    state.memories = state.memories || [];
    state.events = state.events || [];
    ensureEntityIds(state.events, ENTITY_ID_PREFIXES.events);
    if (state.events) {
      for (const ev of state.events) {
        if (ev.stageRound === undefined) ev.stageRound = 1;
        if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
        if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
        if (ev.stall === undefined) ev.stall = false;
        // 修复 stageRound>=9 未晋级的问题
        const successStage = EVENT_SUCCESS_STAGE[ev.type] || EVENT_SUCCESS_STAGE.conflict;
        const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;
        if (ev.stageRound >= 9 && !terminalStages.includes(ev.stage)) {
          const STAGES = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
          const idx = STAGES.indexOf(ev.stage);
          if (idx !== -1 && idx < STAGES.length - 1) {
            ev.stage = STAGES[idx + 1];
            ev.stageRound = ev.stageRound - 9 || 1;
          } else {
            ev.stage = successStage;
            ev.stageRound = 9;
          }
        }
        if (terminalStages.includes(ev.stage)) {
          ev.stageRound = 9;
          ev.stall = false;
        }
      }
    }
    state.factions = state.factions || [];
    ensureEntityIds(state.factions, ENTITY_ID_PREFIXES.factions);
    const FACTION_RELATIONS = ['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇'];
    const FACTION_STATUSES = ['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解'];
    for (const f of state.factions) {
      f.status = FACTION_STATUSES.includes(f.status) ? f.status : '稳固';
      // 八级→七级迁移：旧存档的"紧张"归并到"冷淡"
      if (f.relation === '紧张') f.relation = '冷淡';
      f.relation = FACTION_RELATIONS.includes(f.relation) ? f.relation : '中立';
      f.scope = f.scope || '';
      if (!Array.isArray(f.powerPillars)) f.powerPillars = [];
      else f.powerPillars = f.powerPillars.map(p => {
        const name = typeof p === 'string' ? p : (p.name || '');
        return name.length > 4 ? name.slice(0, 4) : name;
      }).filter(Boolean);
      if (f.powerPillars.length > 3) f.powerPillars.length = 3;
    }
    state.worldTrends = state.worldTrends || [];
    ensureEntityIds(state.worldTrends, ENTITY_ID_PREFIXES.worldTrends);
    if (state.worldTrends.length > capSetting('localCapWorldTrends', 4)) state.worldTrends.length = capSetting('localCapWorldTrends', 4);
    state.winds = state.winds || [];
    ensureEntityIds(state.winds, ENTITY_ID_PREFIXES.winds);
    state.winds = state.winds.map((wind, index) => {
      wind.topic = wind.topic || wind.content || `风声${index + 1}`;
      if (!['announcement', 'report', 'rumor', 'sentiment'].includes(wind.type)) wind.type = 'rumor';
      wind.level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
      wind.content = wind.content || '';
      wind.scope = wind.scope || '来源地';
      wind.source = wind.source || '来源不明';
      wind.quietRounds = Math.max(0, parseInt(wind.quietRounds) || 0);
      return wind;
    });
    state.reputation = state.reputation || { authority: '默默无闻', common: '默默无闻', shadow: '默默无闻', circuit: '默默无闻' };
    // 六级→五级迁移：旧存档的"小有名气"归并到"受人尊敬"
    for (const _dim of ['authority', 'common', 'shadow', 'circuit']) {
      if (state.reputation[_dim] === '小有名气') state.reputation[_dim] = '受人尊敬';
    }
    if (!state.reputation.lastChange) state.reputation.lastChange = '';
    state.economy = state.economy || { climate: '平稳', signals: [] };
    if (!state.economy.signals) state.economy.signals = [];
    state.enemies = state.enemies || [];
    ensureEntityIds(state.enemies, ENTITY_ID_PREFIXES.enemies);
    state.influenceChain = Array.isArray(state.influenceChain) ? state.influenceChain : [];
    for (const influence of state.influenceChain) {
      if (influence && typeof influence === 'object' && influence._createdRound === undefined) {
        influence._createdRound = Number(state.round) || 0;
      }
    }
    if (!state.regionalIncident) {
      state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', cooldown: 0, _retry: false, _retryType: '' };
    }
    state.regionalIncident.active = state.regionalIncident.active === true || state.regionalIncident.active === 'true';
    if (state.regionalIncident.cooldown === undefined) state.regionalIncident.cooldown = 0;
    if (state.regionalIncident.duration === undefined) state.regionalIncident.duration = 0;
    if (state.regionalIncident._retry === undefined) state.regionalIncident._retry = false;
    if (state.regionalIncident._retryType === undefined) state.regionalIncident._retryType = '';
    if (!state.distantEvent || typeof state.distantEvent !== 'object') {
      state.distantEvent = { pending: false, cooldown: 0, sample: [], requestedRound: 0, requestedType: '' };
    }
    state.distantEvent.pending = state.distantEvent.pending === true || state.distantEvent.pending === 'true';
    state.distantEvent.cooldown = Math.max(0, parseInt(state.distantEvent.cooldown) || 0);
    state.distantEvent.sample = Array.isArray(state.distantEvent.sample) ? state.distantEvent.sample : [];
    state.distantEvent.requestedRound = Math.max(0, parseInt(state.distantEvent.requestedRound) || 0);
    state.distantEvent.requestedType = ['event', 'wind'].includes(state.distantEvent.requestedType) ? state.distantEvent.requestedType : '';
    if (!state.nearEvent || typeof state.nearEvent !== 'object') {
      state.nearEvent = { pending: false, cooldown: 0, requestedRound: 0, requestedType: '' };
    }
    state.nearEvent.pending = state.nearEvent.pending === true || state.nearEvent.pending === 'true';
    state.nearEvent.cooldown = Math.max(0, parseInt(state.nearEvent.cooldown) || 0);
    state.nearEvent.requestedRound = Math.max(0, parseInt(state.nearEvent.requestedRound) || 0);
    state.nearEvent.requestedType = ['event', 'wind'].includes(state.nearEvent.requestedType) ? state.nearEvent.requestedType : '';
    if (!state.blackbox) {
      state.blackbox = { secretActions: [], secretAssets: [] };
    } else {
      state.blackbox.secretActions = state.blackbox.secretActions || [];
      state.blackbox.secretAssets = state.blackbox.secretAssets || [];
    }
    state.lastInjection = state.lastInjection || null;
    return state;
  }

  function loadState() {
    const chatId = getChatId();
    const key = STORAGE_PREFIX + chatId;
    const raw = window.WORLD_ENGINE_STORE.getItem(key);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        const def = getDefaultState();
        const merged = { ...def, ...saved };
        merged.memories = saved.memories || [];
        merged.lastInjection = saved.lastInjection || null;
        const checkpointRaw = window.WORLD_ENGINE_STORE.getItem(STORAGE_PREFIX + chatId + '_checkpoint');
        if (checkpointRaw) {
          try {
            const checkpoint = ensureArrays(JSON.parse(checkpointRaw));
            inheritLegacyIds(merged, checkpoint);
          } catch (e) {
            console.warn('[世界引擎] 旧当前状态 ID 对齐失败，将按当前状态现状补号', e);
          }
        }
        return ensureArrays(merged);
      } catch(e) { console.warn('[世界引擎] 加载状态失败', e); }
    }
    return ensureArrays(getDefaultState());
  }

  /** 是否存在真实落盘的当前状态；loadState() 在不存在时只返回临时默认状态。 */
  function hasState() {
    return window.WORLD_ENGINE_STORE.getItem(STORAGE_PREFIX + getChatId()) !== null;
  }

  function saveState(state) {
    const chatId = getChatId();
    const key = STORAGE_PREFIX + chatId;
    ensureArrays(state);
    state.lastUpdated = { chatId, timestamp: Date.now() };
    window.WORLD_ENGINE_STORE.setItem(key, JSON.stringify(state));
  }

  function clearState() {
    window.WORLD_ENGINE_STORE.removeItem(STORAGE_PREFIX + getChatId());
  }

  /** 保存状态并记录当前对话层数（evolve 完成后调用） */
  function saveStateWithLayer(state) {
    state.chatLayer = getChatLayer();
    saveState(state);
  }

  // ========== 存档点系统（a/b 双状态） ==========
  // a = 存档点，每次新对话轮次时复制 b
  // b = 工作区，UI 显示这个

  function getCheckpointKey() {
    return STORAGE_PREFIX + getChatId() + '_checkpoint';
  }

  function getAnchorLayerKey() {
    return STORAGE_PREFIX + getChatId() + '_anchorLayer';
  }

  function getFingerprintKey() {
    return STORAGE_PREFIX + getChatId() + '_fingerprint';
  }

  /** 保存存档点 a（完整复制当前 state） */
  function saveCheckpoint(state) {
    const key = getCheckpointKey();
    const cp = JSON.parse(JSON.stringify(state));
    ensureArrays(cp);
    window.WORLD_ENGINE_STORE.setItem(key, JSON.stringify(cp));
  }

  /** 从存档点 a 恢复状态 */
  function restoreCheckpoint() {
    const key = getCheckpointKey();
    const raw = window.WORLD_ENGINE_STORE.getItem(key);
    if (raw) {
      try {
        const cp = JSON.parse(raw);
        return ensureArrays(cp);
      } catch(e) { console.warn('[世界引擎] 存档点读取失败', e); }
    }
    return null;
  }

  /** 删除存档点 */
  function clearCheckpoint() {
    window.WORLD_ENGINE_STORE.removeItem(getCheckpointKey());
  }

  /** 旧版独立锚点接口（层数语义统一为 chat.length - 1；当前计数不使用它）。 */
  function getAnchorLayer() {
    const saved = window.WORLD_ENGINE_STORE.getItem(getAnchorLayerKey());
    return saved !== null ? Number(saved) : null;
  }

  /** 设置计数锚点 */
  function setAnchorLayer(l) {
    window.WORLD_ENGINE_STORE.setItem(getAnchorLayerKey(), String(l));
  }

  /** 获取当前对话层数（从 0 开始计数） */
  function getChatLayer() {
    try {
      const ctx = SillyTavern.getContext();
      const chat = ctx?.chat || [];
      return Math.max(0, chat.length - 1);
    } catch(e) { return 0; }
  }

  /** 获取当前对话的指纹（对话层数，用于判断是否重roll） */
  function getChatFingerprint() {
    return String(getChatLayer());
  }

  /** 保存指纹到 localStorage */
  function saveFingerprint(fp) {
    window.WORLD_ENGINE_STORE.setItem(getFingerprintKey(), fp);
  }

  /** 读取上次保存的指纹 */
  function loadFingerprint() {
    return window.WORLD_ENGINE_STORE.getItem(getFingerprintKey()) || '';
  }

  /** 判断是否为新对话轮次（指纹变了 → 新轮次；没变 → 重roll） */
  function isNewRound() {
    const oldFp = loadFingerprint();
    const newFp = getChatFingerprint();
    if (!oldFp) return true;
    return oldFp !== newFp;
  }

  function addMemory(state, memory) {
    if (!state) return;
    state.memories.unshift(memory);
    if (state.memories.length > 200) state.memories.pop();
    saveState(state);
  }

  // 输入输出过滤器：按 settings.evolveFilterRegex（每行一条正则）把匹配内容删掉。
  // 用于喂后台推演前清洗对话文本（思维链、状态栏、HTML 等）。
  //
  // 每行一条正则，支持两种写法：
  //   1. 纯 pattern（如 `ゐ<details>[\s\S]*?</details>`）—— 自动按 g 全局替换（向后兼容老写法）；
  //   2. JS 字面量 `/pattern/flags`（如 `/<details>[\s\S]*?<\/details>/g`）—— 自动剥掉定界符取 flags，
  //      flags 不含 g 则补 g（用户写 `/pat/` 或 `/pat/i` 都按全局删除语义执行）。
  // 空行忽略；单条非法不抛错（生产路径静默），仅当调用方传 onError 时回调报告。

  // 把一行文本剥成 {pattern, flags}。纯 pattern → flags 默认 'g'；/pat/flags 字面量 → 取其 flags 并保证 g。
  function stripRegexLine(pat) {
    const m = /^\/(.+)\/([a-z]*)$/i.exec(pat);
    if (m) {
      let flags = m[2] || '';
      if (flags.indexOf('g') < 0) flags += 'g';
      return { pattern: m[1], flags: flags };
    }
    return { pattern: pat, flags: 'g' };
  }

  // 纯校验：逐行解析 raw，返回 { ok, bad, entries }。不调 replace、无副作用。
  //   ok      —— 合法条数
  //   bad     —— [{ line: 1-based 行号, raw: 原始行文本(截断 60), reason: 错误消息 }]
  //   entries —— [{ line, pattern, flags }] 合法条目（供测试按钮/诊断复用）
  function validateFilterRegex(raw) {
    const out = { ok: 0, bad: [], entries: [] };
    if (!raw) return out;
    const lines = String(raw).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const pat = lines[i].trim();
      if (!pat) continue;
      const lineNo = i + 1;
      const stripped = stripRegexLine(pat);
      try {
        new RegExp(stripped.pattern, stripped.flags);   // 仅试编译，不 replace
        out.ok++;
        out.entries.push({ line: lineNo, pattern: stripped.pattern, flags: stripped.flags });
      } catch (e) {
        out.bad.push({ line: lineNo, raw: pat.slice(0, 60), reason: String(e && e.message || e) });
      }
    }
    return out;
  }

  // 过滤对话文本。第三参 onError(lineNo, rawLine, reason) 可选——传入则在单条非法时回调（保存/测试用），
  // 不传则静默（生产推演路径，绝不打断）。三处生产调用点均不传第三参，行为与旧版一致。
  function filterDialogue(text, settings, onError) {
    if (!text) return text || '';
    const raw = (settings && settings.evolveFilterRegex) || '';
    if (!raw.trim()) return text;
    const v = validateFilterRegex(raw);
    let out = text;
    for (let i = 0; i < v.entries.length; i++) {
      const e = v.entries[i];
      // validateFilterRegex 已试编译过，这里必然成功；保留 try 仅为防御性兜底
      try { out = out.replace(new RegExp(e.pattern, e.flags), ''); } catch (err) { /* 不会进入 */ }
    }
    if (typeof onError === 'function' && v.bad.length) {
      const lines = String(raw).split('\n');
      for (let i = 0; i < v.bad.length; i++) {
        const b = v.bad[i];
        onError(b.line, lines[b.line - 1] || '', b.reason);
      }
    }
    return out;
  }

  // ========== 故事时间解析（按时间推演模式用） ==========
  // 中文数字 → 阿拉伯数字（阿拉伯数字原样返回，空 → 0）
  function cnToNum(s) {
    if (s == null) return 0;
    s = String(s).trim();
    if (s === '') return 0;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    const D = { 零:0, 〇:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
    s = s.replace(/^初/, '');               // 初九 → 九
    // 含「万」：拆高低两段递归（万前空按 1 算，即「万」=10000）
    if (s.includes('万')) {
      const idx = s.indexOf('万');
      return cnToNum(s.slice(0, idx) || '一') * 10000 + cnToNum(s.slice(idx + 1));
    }
    // 廿/卅 简写：廿=20、廿三=23、廿十=20（后接非个位忽略）
    if (s.includes('廿')) return 20 + (D[s.replace('廿', '')] || 0);
    if (s.includes('卅')) return 30 + (D[s.replace('卅', '')] || 0);
    // 千/百/十 位值 + 个位（零作占位跳过）：一千二百=1200、二十七=27、十一=11
    let total = 0, num = 0;
    const UNIT = { 十:10, 百:100, 千:1000 };
    for (const ch of s) {
      if (ch === '零' || ch === '〇') continue;
      if (D[ch] != null) num = D[ch];
      else if (UNIT[ch] != null) { total += (num === 0 ? 1 : num) * UNIT[ch]; num = 0; }
    }
    total += num;
    // 整段没解析出任何中文数字 → 阿拉伯兜底
    if (total === 0 && !/[零〇一二两三四五六七八九十百千]/.test(s)) {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : 0;
    }
    return total;
  }

  // 模块级：最近一次从正文解析到的故事天数（供 UI「本轮对话时间」回显）
  let _lastStoryDay = null;
  function getLastStoryDay() { return _lastStoryDay; }
  function setLastStoryDay(v) { _lastStoryDay = (v == null ? null : Number(v)); }

  /**
   * 从正文按设置解析故事「总天数」。解析不到返回 null。
   * 规则：取窗口（前 front 字 + 后 back 字，都 0 则全文）→ 用 6 框拼正则
   * （奇数框非空成捕获组，偶数框字面量）→ 取最后一个匹配 → 各捕获组 cnToNum × 乘数求和。
   */
  function parseStoryDay(text, settings) {
    if (!text || !settings) return null;
    const front = Math.max(0, parseInt(settings.evolveTimeFront) || 0);
    const back = Math.max(0, parseInt(settings.evolveTimeBack) || 0);
    let win;
    if (front === 0 && back === 0) win = text;
    else win = (front > 0 ? text.slice(0, front) : '') + '\n' + (back > 0 ? text.slice(-back) : '');

    const boxes = [1, 2, 3, 4, 5, 6].map(i => settings['evolveTimeRe' + i] || '');
    const muls = [
      parseFloat(settings.evolveTimeMul1),
      parseFloat(settings.evolveTimeMul2),
      parseFloat(settings.evolveTimeMul3)
    ];
    let pattern = '';
    const activeMuls = [];
    for (let i = 0; i < 6; i++) {
      const b = boxes[i];
      if (i % 2 === 0) {                      // 数字框 1/3/5
        if (b) { pattern += '(' + b + ')'; activeMuls.push(muls[i / 2]); }
      } else {                               // 单位框 2/4/6（字面量，可空）
        pattern += b;
      }
    }
    if (!pattern || activeMuls.length === 0) return null;

    let re;
    try { re = new RegExp(pattern, 'g'); } catch (e) { return null; }
    let m, last = null;
    while ((m = re.exec(win)) !== null) {
      last = m;
      if (m.index === re.lastIndex) re.lastIndex++;   // 防零宽死循环
    }
    if (!last) return null;

    let total = 0;
    for (let k = 0; k < activeMuls.length; k++) {
      const mul = Number.isFinite(activeMuls[k]) ? activeMuls[k] : 0;
      total += cnToNum(last[k + 1]) * mul;
    }
    return total;
  }

  function ensureEventFields(ev) {
    if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
    if (ev.stageRound === undefined) ev.stageRound = 1;
    if (ev.level === undefined) ev.level = 1;
    if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
    if (ev.stall === undefined) ev.stall = false;
    // 阶段常量
    const STAGES = EVENT_STAGE_MAP[ev.type] || EVENT_STAGE_MAP.conflict;
    const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
    const successStage = EVENT_SUCCESS_STAGE[ev.type] || EVENT_SUCCESS_STAGE.conflict;
    const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;
    if (!ev.stage || !STAGES.includes(ev.stage)) ev.stage = STAGES[0];
    // stageRound >= 9 自动晋级
    if (ev.stageRound >= 9 && !terminalStages.includes(ev.stage)) {
      const idx = stageOrder.indexOf(ev.stage);
      if (idx !== -1 && idx < stageOrder.length - 1) {
        ev.stage = stageOrder[idx + 1];
        ev.stageRound = ev.stageRound - 9 || 1;
      } else {
        ev.stage = successStage;
        ev.stageRound = 9;
      }
    }
    // 终局阶段锁定 9/9
    if (terminalStages.includes(ev.stage)) {
      ev.stageRound = 9;
      ev.stall = false;
    }
    return ev;
  }

  function addEvent(state, event) {
    if (!state.events) state.events = [];
    ensureEntityIds(state.events, ENTITY_ID_PREFIXES.events);
    ensureEventFields(event);
    const idx = findEntityIndex(state.events, event, ENTITY_ID_PREFIXES.events, 'name');
    if (idx !== -1) {
      event.id = state.events[idx].id;
      state.events[idx] = { ...state.events[idx], ...event };
      ensureEventFields(state.events[idx]);
    } else {
      assignEntityId(state.events, event, ENTITY_ID_PREFIXES.events);
      state.events.unshift(event);
    }
    if (state.events.length > capSetting('localCapEvents', 16)) state.events.length = capSetting('localCapEvents', 16);
    saveState(state);
  }

  function addFaction(state, faction) {
    if (!state.factions) state.factions = [];
    ensureEntityIds(state.factions, ENTITY_ID_PREFIXES.factions);
    const FACTION_RELATIONS = ['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇'];
    const FACTION_STATUSES = ['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解'];
    if (!FACTION_STATUSES.includes(faction.status)) faction.status = '稳固';
    if (faction.relation === '紧张') faction.relation = '冷淡';
    if (!FACTION_RELATIONS.includes(faction.relation)) faction.relation = '中立';
    faction.scope = faction.scope || '';
    if (!Array.isArray(faction.powerPillars)) faction.powerPillars = [];
    else faction.powerPillars = faction.powerPillars.map(p => {
      const name = typeof p === 'string' ? p : (p.name || '');
      return name.length > 4 ? name.slice(0, 4) : name;
    }).filter(Boolean);
    if (faction.powerPillars.length > 3) faction.powerPillars.length = 3;
    const idx = findEntityIndex(state.factions, faction, ENTITY_ID_PREFIXES.factions, 'name');
    if (idx !== -1) {
      faction.id = state.factions[idx].id;
      state.factions[idx] = { ...state.factions[idx], ...faction };
    } else {
      assignEntityId(state.factions, faction, ENTITY_ID_PREFIXES.factions);
      state.factions.unshift(faction);
    }
    if (state.factions.length > capSetting('localCapFactions', 15)) state.factions.length = capSetting('localCapFactions', 15);
    saveState(state);
  }

  function addWorldTrend(state, trend) {
    if (!state.worldTrends) state.worldTrends = [];
    ensureEntityIds(state.worldTrends, ENTITY_ID_PREFIXES.worldTrends);
    if (!trend || !trend.name) return;
    trend.status = trend.status === '已结束' ? '已结束' : '持续中';
    trend.scope = trend.scope || '天下';
    trend.description = trend.description || '';
    trend.source = trend.source || '';
    const idx = findEntityIndex(state.worldTrends, trend, ENTITY_ID_PREFIXES.worldTrends, 'name');
    if (idx !== -1) {
      trend.id = state.worldTrends[idx].id;
      if (state.worldTrends[idx].status === '已结束') trend.status = '已结束';
      state.worldTrends[idx] = { ...state.worldTrends[idx], ...trend };
    } else {
      assignEntityId(state.worldTrends, trend, ENTITY_ID_PREFIXES.worldTrends);
      state.worldTrends.unshift(trend);
      if (state.worldTrends.length > capSetting('localCapWorldTrends', 4)) state.worldTrends.length = capSetting('localCapWorldTrends', 4);
    }
    saveState(state);
  }

  function addWind(state, wind) {
    if (!state.winds) state.winds = [];
    ensureEntityIds(state.winds, ENTITY_ID_PREFIXES.winds);
    delete wind.quietRounds;
    wind.topic = wind.topic || wind.content || `风声${Date.now()}`;
    if (!['announcement', 'report', 'rumor', 'sentiment'].includes(wind.type)) wind.type = 'rumor';
    wind.level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
    wind.scope = wind.scope || '来源地';
    wind.source = wind.source || '来源不明';
    wind.quietRounds = 0;
    const idx = findEntityIndex(state.winds, wind, ENTITY_ID_PREFIXES.winds, 'topic');
    if (idx !== -1) {
      wind.id = state.winds[idx].id;
      state.winds[idx] = { ...state.winds[idx], ...wind };
    } else {
      assignEntityId(state.winds, wind, ENTITY_ID_PREFIXES.winds);
      state.winds.unshift(wind);
    }
    if (state.winds.length > capSetting('localCapWinds', 12)) state.winds.length = capSetting('localCapWinds', 12);
    saveState(state);
  }

  function addEnemy(state, enemy) {
    if (!state.enemies) state.enemies = [];
    ensureEntityIds(state.enemies, ENTITY_ID_PREFIXES.enemies);
    const idx = findEntityIndex(state.enemies, enemy, ENTITY_ID_PREFIXES.enemies, 'name');
    if (idx !== -1) {
      enemy.id = state.enemies[idx].id;
      state.enemies[idx] = { ...state.enemies[idx], ...enemy };
    } else {
      assignEntityId(state.enemies, enemy, ENTITY_ID_PREFIXES.enemies);
      state.enemies.unshift(enemy);
    }
    if (state.enemies.length > capSetting('localCapEnemies', 8)) state.enemies.length = capSetting('localCapEnemies', 8);
    return enemy.id;
  }

  // ========== 导出/导入清理 ==========

  /** 清理后的导出数据（去掉调试/内部字段） */
  function getCleanExport(state) {
    const s = JSON.parse(JSON.stringify(state));

    // 去掉调试/内部字段
    delete s.lastEvolveResult;
    delete s.lastInjection;
    delete s.lastUpdated;
    delete s._terminalEventsThisRound;

    // 修复事件 stageRound>=9
    if (s.events) {
      for (const ev of s.events) {
        ensureEventFields(ev);
      }
    }

    return ensureArrays(s);
  }

  /** 导入时合并到当前状态 */
  function importState(importedState) {
    const clean = JSON.parse(JSON.stringify(importedState));
    // 去掉导入数据里的内部字段
    delete clean.lastEvolveResult;
    delete clean.lastInjection;
    delete clean.lastUpdated;
    delete clean._terminalEventsThisRound;
    // 修复事件
    if (clean.events) {
      for (const ev of clean.events) ensureEventFields(ev);
    }
    // 确保必要字段
    clean.memories = clean.memories || [];
    clean.lastEvolveResult = null;
    clean.lastInjection = null;
    clean.chatLayer = getChatLayer();
    const chatId = getChatId();
    clean.lastUpdated = { chatId, timestamp: Date.now() };
    ensureArrays(clean);
    saveState(clean);
    return clean;
  }

  return {
    getDefaultState, getChatId, loadState, hasState, saveState, clearState, saveStateWithLayer,
    addMemory, addEvent, addFaction, addWorldTrend, addWind, addEnemy,
    ENTITY_ID_PREFIXES, entityIdNumber, nextEntityId, ensureEntityIds, findEntityIndex, assignEntityId,
    inheritLegacyIds,
    ensureEventFields, getUserName, renderUserName,
    saveCheckpoint, restoreCheckpoint, clearCheckpoint, getAnchorLayer, setAnchorLayer,
    getChatLayer, getChatFingerprint, saveFingerprint, loadFingerprint, isNewRound,
    getCleanExport, importState,
    cnToNum, parseStoryDay, getLastStoryDay, setLastStoryDay, filterDialogue,
    validateFilterRegex
  };
})();
