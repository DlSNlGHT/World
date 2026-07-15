// memory-engine-data.js — 记忆引擎按聊天隔离的状态与存档点
window.MEMORY_ENGINE_DATA = (function() {
  const STATE_PREFIX = 'memory_engine_state_';
  const CHECKPOINT_PREFIX = 'memory_engine_checkpoint_';
  const LINK_CHECKPOINT_PREFIX = 'memory_engine_link_checkpoint_';
  const VERSION = '1.0.0';
  const ENTITY_TYPES = ['organization', 'object', 'ability', 'location'];

  function getChatId() {
    return window.WORLD_ENGINE_CORE?.getChatId?.() || 'default';
  }

  function key(prefix) { return prefix + getChatId(); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  const clean = value => String(value == null ? '' : value).trim();
  const normalized = value => clean(value).toLocaleLowerCase();
  const unique = values => Array.from(new Set((Array.isArray(values) ? values : [values]).map(clean).filter(Boolean)));
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
      event_memory: {
        small_summaries: [],
        big_summaries: [],
        small_summary_layer: null,
        big_summary_cursor: 0
      },
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
    if (!next.event_memory || typeof next.event_memory !== 'object' || Array.isArray(next.event_memory)) next.event_memory = {};
    if (!Array.isArray(next.event_memory.small_summaries)) next.event_memory.small_summaries = [];
    next.event_memory.small_summaries = next.event_memory.small_summaries.map((item, index) => {
      const normalizedItem = {
        id: String(item?.id || `small_${String(index + 1).padStart(6, '0')}`),
        startLayer: Number.isFinite(Number(item?.startLayer)) ? Number(item.startLayer) : 0,
        endLayer: Number.isFinite(Number(item?.endLayer)) ? Number(item.endLayer) : 0,
        content: String(item?.content || '').trim()
      };
      // 联动来源只用于同楼层重 roll 识别；普通纪要不携带这些字段。
      if (item?.source === 'world_engine') normalizedItem.source = 'world_engine';
      if (item?.sourceKey) normalizedItem.sourceKey = String(item.sourceKey);
      return normalizedItem;
    }).filter(item => item.content);
    // 0.4.x 只有一条滚动 big_summary；升级后迁移成可追加的 big_summaries。
    const legacyBig = next.event_memory.big_summary;
    const bigSource = Array.isArray(next.event_memory.big_summaries)
      ? next.event_memory.big_summaries
      : (legacyBig && typeof legacyBig === 'object' ? [legacyBig] : []);
    next.event_memory.big_summaries = bigSource.map((item, index) => ({
      id: String(item?.id || `big_${String(index + 1).padStart(6, '0')}`),
      startLayer: Number.isFinite(Number(item?.startLayer)) ? Number(item.startLayer) : 0,
      endLayer: Number.isFinite(Number(item?.endLayer)) ? Number(item.endLayer) : 0,
      content: String(item?.content || '').trim()
    })).filter(item => item.content);
    delete next.event_memory.big_summary;
    next.event_memory.small_summary_layer = next.event_memory.small_summary_layer !== null
      && next.event_memory.small_summary_layer !== ''
      && Number.isFinite(Number(next.event_memory.small_summary_layer))
      ? Number(next.event_memory.small_summary_layer) : null;
    next.event_memory.big_summary_cursor = Math.min(
      next.event_memory.small_summaries.length,
      Math.max(0, parseInt(next.event_memory.big_summary_cursor) || 0)
    );
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

  // 与普通“重新提取”checkpoint 分离：这里只保存当前世界联动楼层第一次写入前的记忆基底。
  function loadLinkCheckpoint() {
    const value = parse(window.WORLD_ENGINE_STORE?.getItem(key(LINK_CHECKPOINT_PREFIX)), null);
    if (!value || typeof value !== 'object' || !value.baseState) return null;
    return {
      layer: Number.isFinite(Number(value.layer)) ? Number(value.layer) : null,
      rolledBack: value.rolledBack === true,
      baseState: normalizeState(value.baseState)
    };
  }
  function saveLinkCheckpoint(value) {
    if (!value || !value.baseState) return null;
    const next = {
      layer: Number(value.layer),
      rolledBack: value.rolledBack === true,
      baseState: normalizeState(value.baseState)
    };
    window.WORLD_ENGINE_STORE?.setItem(key(LINK_CHECKPOINT_PREFIX), JSON.stringify(next));
    return clone(next);
  }
  function clearLinkCheckpoint() { window.WORLD_ENGINE_STORE?.removeItem(key(LINK_CHECKPOINT_PREFIX)); }

  function recordMatches(record, ownerId, time, memory) {
    return record?.ownerId === ownerId && clean(record?.time) === clean(time) && clean(record?.memory) === clean(memory);
  }
  function portableState(state) {
    const current = normalizeState(state);
    const people = current.personal_memory || [];
    return {
      personal_memory: people.map(person => ({
        id: person.id,
        names: clone(person.names || []),
        memories: Object.entries(person.memory || {}).flatMap(([time, memories]) =>
          (Array.isArray(memories) ? memories : []).map(memory => ({
            time,
            memory,
            known_by: people.filter(knower => knower.id !== person.id && (knower.names || []).some(name =>
              (current.knowledge_index?.[normalized(name)] || []).some(record => recordMatches(record, person.id, time, memory))
            )).map(knower => knower.names?.[0] || knower.id)
          }))
        )
      })),
      entity_memory: clone(current.entity_memory),
      event_memory: clone(current.event_memory),
      round: current.round,
      chatLayer: current.chatLayer
    };
  }
  function portableCounts(state) {
    if (!state) return null;
    return {
      people: state.personal_memory?.length || 0,
      entities: ENTITY_TYPES.reduce((sum, type) => sum + (state.entity_memory?.[type]?.length || 0), 0),
      minutes: state.event_memory?.small_summaries?.length || 0,
      overviews: state.event_memory?.big_summaries?.length || 0
    };
  }
  function exportData() {
    const state = portableState(loadState());
    const rawCheckpoint = loadCheckpoint();
    const checkpoint = rawCheckpoint ? portableState(rawCheckpoint) : null;
    return {
      __memoryEngineData: true,
      format: 'portable-full-backup',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      chatId: getChatId(),
      counts: {
        state: portableCounts(state),
        checkpoint: portableCounts(checkpoint)
      },
      state,
      checkpoint
    };
  }
  function currentChatLayer() {
    const fromCore = window.WORLD_ENGINE_CORE?.getChatLayer?.();
    if (Number.isFinite(Number(fromCore))) return Math.max(0, Number(fromCore));
    try { return Math.max(0, (SillyTavern.getContext()?.chat || []).length - 1); }
    catch (_) { return 0; }
  }
  function rebaseImportedState(state) {
    const next = normalizeState(state);
    const layer = currentChatLayer();
    // 导入是把既有记忆接到当前聊天；楼层游标必须从当前聊天重新起步。
    next.chatLayer = layer;
    next.event_memory.small_summary_layer = layer;
    return next;
  }
  function nextImportedCharacterId(people) {
    const max = (people || []).reduce((number, person) => {
      const match = /^char_(\d+)$/.exec(clean(person?.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `char_${String(max + 1).padStart(6, '0')}`;
  }
  function internalizePortableState(input) {
    const raw = clone(input);
    const source = Array.isArray(raw?.personal_memory) ? raw.personal_memory : [];
    if (!source.some(person => Array.isArray(person?.memories))) return raw;
    const people = source.map(person => ({
      id: clean(person?.id),
      names: unique(person?.names),
      memory: Array.isArray(person?.memories) ? {} : clone(person?.memory || {})
    }));
    for (const person of people) if (!person.id) person.id = nextImportedCharacterId(people);
    const index = {};
    const addIndex = (names, record) => {
      for (const name of unique(names)) {
        const keyName = normalized(name);
        if (!Array.isArray(index[keyName])) index[keyName] = [];
        if (!index[keyName].some(old => recordMatches(old, record.ownerId, record.time, record.memory))) index[keyName].push(clone(record));
      }
    };
    const findOrCreateKnower = name => {
      const wanted = normalized(name);
      let person = people.find(candidate => (candidate.names || []).some(alias => normalized(alias) === wanted));
      if (!person) {
        person = { id: nextImportedCharacterId(people), names: [clean(name)], memory: {} };
        people.push(person);
      }
      return person;
    };
    source.forEach((sourcePerson, personIndex) => {
      const owner = people[personIndex];
      const records = Array.isArray(sourcePerson?.memories) ? sourcePerson.memories : [];
      for (const item of records) {
        const time = clean(item?.time), memory = clean(item?.memory ?? item?.content);
        if (!memory) continue;
        if (!Array.isArray(owner.memory[time])) owner.memory[time] = [];
        if (!owner.memory[time].includes(memory)) owner.memory[time].push(memory);
        const record = { ownerId: owner.id, time, memory };
        addIndex(owner.names, record);
        for (const knowerName of unique(item?.known_by)) addIndex(findOrCreateKnower(knowerName).names, record);
      }
    });
    raw.personal_memory = people;
    raw.knowledge_index = index;
    return raw;
  }
  function importData(payload) {
    const selected = payload?.__memoryEngineData ? (payload.state || payload.current_state || payload.data || payload) : (payload?.state || payload);
    const state = internalizePortableState(selected);
    const hasPersonal = Array.isArray(state?.personal_memory);
    const hasWorld = (state?.entity_memory && typeof state.entity_memory === 'object' && !Array.isArray(state.entity_memory))
      || (state?.world_memory && typeof state.world_memory === 'object' && !Array.isArray(state.world_memory));
    if (!state || typeof state !== 'object' || Array.isArray(state)
      || (!hasPersonal && !hasWorld)) {
      throw new Error('缺少合法的记忆数据');
    }
    saveState(rebaseImportedState(state));
    if (payload?.format === 'portable-current-state') {
      clearCheckpoint();
    } else if (payload?.__memoryEngineData || Object.prototype.hasOwnProperty.call(payload || {}, 'checkpoint')) {
      if (payload.checkpoint) saveCheckpoint(rebaseImportedState(internalizePortableState(payload.checkpoint))); else clearCheckpoint();
    }
    return loadState();
  }

  return {
    VERSION, getChatId, defaultState, hasState, loadState, saveState,
    loadCheckpoint, saveCheckpoint, clearCheckpoint,
    loadLinkCheckpoint, saveLinkCheckpoint, clearLinkCheckpoint,
    exportData, importData
  };
})();
