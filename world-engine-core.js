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

  // [移植 v2.4.1] 容量上限调参读取（设置缺失/非法时回退出厂值）
  function _capSettings() {
    return window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings ? window.WORLD_ENGINE_API.getSettings() : {};
  }

  function capSetting(key, fallback) {
    const n = Number(_capSettings()[key]);
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

  /** 获取当前用户 persona 描述文本（来自 SillyTavern 用户设定管理） */
  function getUserPersona() {
    try {
      const ctx = SillyTavern.getContext();
      // SillyTavern 通过 powerUserSettings 暴露 power_user 对象
      // persona_description 是当前激活 persona 的描述文本
      if (ctx?.powerUserSettings?.persona_description) {
        return ctx.powerUserSettings.persona_description.trim();
      }
    } catch(e) {
      console.warn('[世界引擎] 读取用户 persona 失败', e);
    }
    return '';
  }

  /** UI 渲染：替换文本中的 {{user}} 为当前角色名 */
  function renderUserName(text) {
    if (!text || typeof text !== 'string') return text;
    const name = getUserName();
    return text.replace(/\{\{user\}\}/g, name);
  }

  /** 发给模型前替换 SillyTavern 宏（{{user}}/{{char}} 等）为真实值。
   *  插件自有 API 调用不走 ST 的提示词管线，所以 {{user}} 不会被自动替换，
   *  必须在这里手动处理，否则模型会把 {{user}} 原样写成 "user"。 */
  function substituteMacros(text) {
    if (!text || typeof text !== 'string') return text;
    try {
      const ctx = SillyTavern.getContext();
      if (ctx && typeof ctx.substituteParams === 'function') return ctx.substituteParams(text);
    } catch (e) {}
    return renderUserName(text);
  }

  function getChatId() {
    try {
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.chatId) return ctx.chatId;
    } catch(e) {}
    return 'default';
  }

  function getCustomModuleStateKey(chatId) {
    return STORAGE_PREFIX + (chatId || getChatId()) + '_customModuleState';
  }

  function readActiveModuleDescriptors() {
    try {
      const rules = window.WORLD_ENGINE_RULES;
      if (rules && typeof rules.getActiveModuleDescriptors === 'function') {
        const descriptors = rules.getActiveModuleDescriptors();
        return Array.isArray(descriptors) ? descriptors : [];
      }
    } catch (e) {}
    return null;
  }

  function getReservedStateFields() {
    const reserved = new Set(Object.keys(getDefaultState()));
    reserved.add('world_digest');
    reserved.add('_terminalEventsThisRound');
    return reserved;
  }

  function isSafeCustomStateField(field) {
    return typeof field === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(field);
  }

  function getCustomModuleStatePlan(descriptors) {
    if (!Array.isArray(descriptors)) return { available: false, valid: [], warnings: [] };
    const reserved = getReservedStateFields();
    const seen = new Set();
    const valid = [];
    const warnings = [];
    descriptors.forEach(descriptor => {
      if (!descriptor || descriptor.kind !== 'custom' || descriptor.enabled === false || descriptor.container === 'none') return;
      const field = descriptor.field || descriptor.id;
      const name = descriptor.name || descriptor.id || field || 'custom';
      if (!isSafeCustomStateField(field)) {
        warnings.push('自定义模块「' + name + '」的 state 字段名非法：' + (field || '(空)'));
        return;
      }
      if (reserved.has(field)) {
        warnings.push('自定义模块「' + name + '」的 state 字段名与内置字段冲突：' + field);
        return;
      }
      if (seen.has(field)) {
        warnings.push('自定义模块「' + name + '」的 state 字段名重复：' + field);
        return;
      }
      seen.add(field);
      valid.push({ descriptor, field });
    });
    return { available: true, valid, warnings };
  }

  function validateCustomModuleStateFields(descriptors) {
    return getCustomModuleStatePlan(descriptors).warnings;
  }

  function defaultCustomModuleValue(descriptor) {
    if (descriptor.container === 'array') return [];
    if (descriptor.container === 'object') return {};
    return null;
  }

  function ensureCustomModuleState(state, descriptors) {
    const plan = getCustomModuleStatePlan(descriptors || readActiveModuleDescriptors());
    if (!plan.available) return state;
    plan.valid.forEach(entry => {
      const descriptor = entry.descriptor;
      const field = entry.field;
      if (descriptor.container === 'array') {
        if (!Array.isArray(state[field])) state[field] = [];
      } else if (descriptor.container === 'object') {
        if (!state[field] || typeof state[field] !== 'object' || Array.isArray(state[field])) state[field] = {};
      } else if (!Object.prototype.hasOwnProperty.call(state, field)) {
        state[field] = defaultCustomModuleValue(descriptor);
      }
    });
    return state;
  }

  function readStoredCustomModuleState(descriptors) {
    const plan = getCustomModuleStatePlan(descriptors || readActiveModuleDescriptors());
    if (!plan.available || !plan.valid.length) return null;
    const raw = window.WORLD_ENGINE_STORE.getItem(getCustomModuleStateKey());
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      console.warn('[WorldEngine] Failed to parse custom module state', e);
      return null;
    }
  }

  function pruneStoredCustomModuleState(stored, plan) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !plan || !plan.valid) return stored;
    const allowed = new Set(plan.valid.map(entry => entry.field));
    const pruned = {};
    Object.keys(stored).forEach(field => {
      if (allowed.has(field)) pruned[field] = stored[field];
    });
    const changed = Object.keys(stored).length !== Object.keys(pruned).length;
    if (changed) {
      const key = getCustomModuleStateKey();
      if (Object.keys(pruned).length) window.WORLD_ENGINE_STORE.setItem(key, JSON.stringify(pruned));
      else window.WORLD_ENGINE_STORE.removeItem(key);
    }
    return pruned;
  }

  function mergeStoredCustomModuleState(state, descriptors) {
    const plan = getCustomModuleStatePlan(descriptors || readActiveModuleDescriptors());
    if (!plan.available || !plan.valid.length) return state;
    const storedRaw = readStoredCustomModuleState(plan.valid.map(entry => entry.descriptor));
    const stored = pruneStoredCustomModuleState(storedRaw, plan);
    if (!stored) return state;
    plan.valid.forEach(entry => {
      if (Object.prototype.hasOwnProperty.call(stored, entry.field)) state[entry.field] = stored[entry.field];
    });
    return ensureCustomModuleState(state, plan.valid.map(entry => entry.descriptor));
  }

  function saveCustomModuleState(state, descriptors) {
    const plan = getCustomModuleStatePlan(descriptors || readActiveModuleDescriptors());
    if (!plan.available) return;
    const payload = {};
    plan.valid.forEach(entry => {
      if (Object.prototype.hasOwnProperty.call(state, entry.field)) payload[entry.field] = state[entry.field];
    });
    const key = getCustomModuleStateKey();
    if (Object.keys(payload).length) window.WORLD_ENGINE_STORE.setItem(key, JSON.stringify(payload));
    else window.WORLD_ENGINE_STORE.removeItem(key);
  }
  function getFactionSchemaEnum(field, fallback) {
    try {
      const rules = window.WORLD_ENGINE_RULES;
      const schema = rules && typeof rules.getModuleOutputSchema === 'function'
        ? rules.getModuleOutputSchema('factions')
        : null;
      const values = schema && schema.fields && schema.fields[field] && schema.fields[field].enum;
      return Array.isArray(values) && values.length ? values : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getEnumDefault(values, fallback) {
    return values.includes(fallback) ? fallback : values[0];
  }
  // ========== [移植 v2.4.0] 持续实体稳定 ID ==========
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
    const FACTION_RELATIONS = getFactionSchemaEnum('relation', ['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇']);
    const FACTION_STATUSES = getFactionSchemaEnum('status', ['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解']);
    for (const f of state.factions) {
      f.status = FACTION_STATUSES.includes(f.status) ? f.status : getEnumDefault(FACTION_STATUSES, '稳固');
      // 八级→七级迁移：旧存档的"紧张"归并到"冷淡"
      if (f.relation === '紧张') f.relation = '冷淡';
      f.relation = FACTION_RELATIONS.includes(f.relation) ? f.relation : getEnumDefault(FACTION_RELATIONS, '中立');
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
    if (!state.distantEvent || typeof state.distantEvent !== 'object' || Array.isArray(state.distantEvent)) {
      state.distantEvent = { pending: false, cooldown: 0, sample: [], requestedRound: 0, requestedType: '' };
    }
    state.distantEvent.pending = state.distantEvent.pending === true || state.distantEvent.pending === 'true';
    state.distantEvent.cooldown = Math.max(0, parseInt(state.distantEvent.cooldown) || 0);
    state.distantEvent.sample = Array.isArray(state.distantEvent.sample) ? state.distantEvent.sample : [];
    state.distantEvent.requestedRound = Math.max(0, parseInt(state.distantEvent.requestedRound) || 0);
    state.distantEvent.requestedType = ['event', 'wind'].includes(state.distantEvent.requestedType) ? state.distantEvent.requestedType : '';
    if (!state.nearEvent || typeof state.nearEvent !== 'object' || Array.isArray(state.nearEvent)) {
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
    ensureCustomModuleState(state);
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
        // [移植 v2.4.0] 首次升级旧存档：先按唯一旧名称从 checkpoint 继承 ID，再给新实体补号
        const checkpointRaw = window.WORLD_ENGINE_STORE.getItem(STORAGE_PREFIX + chatId + '_checkpoint');
        if (checkpointRaw) {
          try {
            const checkpoint = ensureArrays(JSON.parse(checkpointRaw));
            inheritLegacyIds(merged, checkpoint);
          } catch (e) {
            console.warn('[世界引擎] 旧当前状态 ID 对齐失败，将按当前状态现状补号', e);
          }
        }
        const ensured = ensureArrays(merged);
        mergeStoredCustomModuleState(ensured);
        return ensureArrays(ensured);
      } catch(e) { console.warn('[世界引擎] 加载状态失败', e); }
    }
    const def = ensureArrays(getDefaultState());
    mergeStoredCustomModuleState(def);
    return ensureArrays(def);
  }

  /** 是否存在真实落盘的当前状态；loadState() 在不存在时只返回临时默认状态。 */
  function hasState() {
    return window.WORLD_ENGINE_STORE.getItem(STORAGE_PREFIX + getChatId()) !== null;
  }

  function saveState(state) {
    const chatId = getChatId();
    const key = STORAGE_PREFIX + chatId;
    ensureArrays(state);
    saveCustomModuleState(state);
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
  // 支持纯 pattern 和 /pattern/flags 两种写法；非法条目默认静默，UI/诊断可用 validateFilterRegex 报错。
  function stripRegexLine(rawLine) {
    const line = String(rawLine || '').trim();
    const match = /^\/(.+)\/([a-z]*)$/i.exec(line);
    if (match) {
      let flags = match[2] || '';
      if (flags.indexOf('g') < 0) flags += 'g';
      return { pattern: match[1], flags };
    }
    return { pattern: line, flags: 'g' };
  }

  function validateFilterRegex(raw) {
    const out = { ok: 0, bad: [], entries: [] };
    if (!raw) return out;
    const lines = String(raw).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const stripped = stripRegexLine(line);
      try {
        new RegExp(stripped.pattern, stripped.flags);
        out.ok += 1;
        out.entries.push({ line: i + 1, pattern: stripped.pattern, flags: stripped.flags });
      } catch (e) {
        out.bad.push({ line: i + 1, raw: line.slice(0, 60), reason: String(e && e.message || e) });
      }
    }
    return out;
  }

  function filterDialogue(text, settings, onError) {
    if (!text) return text || '';
    const raw = (settings && settings.evolveFilterRegex) || '';
    if (!raw.trim()) return text;
    const validation = validateFilterRegex(raw);
    let out = text;
    for (const entry of validation.entries) {
      try { out = out.replace(new RegExp(entry.pattern, entry.flags), ''); } catch (e) {}
    }
    if (typeof onError === 'function' && validation.bad.length) {
      const lines = String(raw).split('\n');
      validation.bad.forEach(function(item) {
        onError(item.line, lines[item.line - 1] || '', item.reason);
      });
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
    const FACTION_RELATIONS = getFactionSchemaEnum('relation', ['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇']);
    const FACTION_STATUSES = getFactionSchemaEnum('status', ['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解']);
    if (!FACTION_STATUSES.includes(faction.status)) faction.status = getEnumDefault(FACTION_STATUSES, '稳固');
    if (faction.relation === '紧张') faction.relation = '冷淡';
    if (!FACTION_RELATIONS.includes(faction.relation)) faction.relation = getEnumDefault(FACTION_RELATIONS, '中立');
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

  // [移植 v2.4.0] 仇敌合并入口：按 id（旧存档按唯一同名）认领，新仇敌分配 id 并压顶
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
    validateCustomModuleStateFields, getCustomModuleStateKey, pruneStoredCustomModuleState,
    addMemory, addEvent, addFaction, addWorldTrend, addWind, addEnemy,
    ENTITY_ID_PREFIXES, ensureEntityIds, findEntityIndex, assignEntityId,
    ensureEventFields, getUserName, getUserPersona, renderUserName, substituteMacros,
    saveCheckpoint, restoreCheckpoint, clearCheckpoint, getAnchorLayer, setAnchorLayer,
    getChatLayer, getChatFingerprint, saveFingerprint, loadFingerprint, isNewRound,
    getCleanExport, importState,
    cnToNum, parseStoryDay, getLastStoryDay, setLastStoryDay, filterDialogue, validateFilterRegex
  };
})();
