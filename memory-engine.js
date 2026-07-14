// 记忆引擎运行链：复用世界引擎的 API、过滤、世界书、存档和注入机制。
window.MEMORY_ENGINE = (function() {
  const INJECTION_NAME = 'memory-engine-memory';
  const SENTINEL = '【记忆信息】';
  const ENTITY_TYPES = ['organization', 'object', 'ability', 'location'];
  const ENTITY_LABELS = { organization: '组织', object: '物件', ability: '能力', location: '地点' };
  let initialized = false, running = false, backfillRunning = false;
  let abortController = null, autoTimer = null, lastEventKey = '';
  let lastDebug = { prompt: '', rawResult: '', parsed: null, error: '' };
  let backfillStatus = { running: false, current: 0, total: 0, message: '' };

  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const clean = v => String(v == null ? '' : v).trim();
  const unique = list => Array.from(new Set((list || []).map(clean).filter(Boolean)));
  const normalized = v => clean(v).toLocaleLowerCase();
  const settings = () => window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {};
  const data = () => window.MEMORY_ENGINE_DATA;
  function context() { try { return SillyTavern.getContext(); } catch (_) { return null; } }
  const chat = () => context()?.chat || [];
  const currentLayer = () => Math.max(0, chat().length - 1);

  function formatMessages(messages, startLayer) {
    const ctx = context();
    return (messages || []).map((message, i) => {
      const fallback = message?.is_user ? (ctx?.name1 || '用户') : (ctx?.name2 || '角色');
      return `[楼层 ${Number(startLayer || 0) + i}]【${clean(message?.name) || fallback}】\n${clean(message?.mes)}`;
    }).filter(Boolean).join('\n\n');
  }

  function recentConversation(rounds) {
    const all = chat(), count = Math.max(1, parseInt(rounds) || 1) * 2;
    const start = Math.max(0, all.length - count);
    return formatMessages(all.slice(start), start);
  }

  function extractStoryTime(text) {
    const found = Array.from(String(text || '').matchAll(/『([^』]*(?:年|月|日|时|刻)[^』]*)』/g));
    return found.length ? clean(found.at(-1)[1].split('丨').slice(0, 3).join(' ')) : '';
  }

  async function buildRequestPrompt(conversation, state, st) {
    const filtered = window.WORLD_ENGINE_CORE?.filterDialogue?.(
      conversation, { evolveFilterRegex: st.filterRegex || '' }
    ) || conversation;
    let worldbook = '';
    if (st.worldbookEnabled && window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection) {
      worldbook = await window.WORLD_ENGINE_WORLDBOOK.buildPromptSection(filtered, 'memory');
    }
    const user = window.MEMORY_ENGINE_PROMPT.buildUserPrompt({
      currentStoryTime: extractStoryTime(filtered),
      knownPeople: (state.personal_memory || []).map(character => unique(character.names)),
      knownEntities: ENTITY_TYPES.flatMap(type => (state.entity_memory?.[type] || []).map(entity => ({
        type: ENTITY_LABELS[type],
        name: entity.name,
        description: entity.description
      }))),
      worldbook,
      conversation: filtered
    });
    const tone = clean(st.tonePrompt);
    return `${window.MEMORY_ENGINE_PROMPT.SYSTEM_PROMPT}\n\n${user}${tone ? `\n\n【附加要求】\n${tone}` : ''}`;
  }

  function parseResponse(raw) {
    const text = clean(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let value;
    try { value = JSON.parse(text); }
    catch (_) {
      const objectStart = text.indexOf('{'), objectEnd = text.lastIndexOf('}');
      const arrayStart = text.indexOf('['), arrayEnd = text.lastIndexOf(']');
      if (arrayStart >= 0 && arrayStart < objectStart && arrayEnd > arrayStart) value = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
      else if (objectStart >= 0 && objectEnd > objectStart) value = JSON.parse(text.slice(objectStart, objectEnd + 1));
      else if (arrayStart >= 0 && arrayEnd > arrayStart) value = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
      else throw new Error('API 返回中没有合法 JSON 对象或数组');
    }
    // 兼容 0.1.x：旧 API 只返回人物记忆数组。
    const personalSource = Array.isArray(value)
      ? value
      : (value?.personal_memory || value?.memories || value?.memory || value?.data || []);
    if (!Array.isArray(personalSource)) throw new Error('personal_memory 必须是 JSON 数组');
    const counts = new Map(), personal = [];
    for (const item of personalSource) {
      if (!item || typeof item !== 'object') continue;
      const names = unique(Array.isArray(item.name) ? item.name : []), memory = clean(item.memory);
      if (!names.length || !memory) continue;
      if (Array.from(memory).length > 50) throw new Error(`记忆超过 50 字：${memory}`);
      const holder = normalized(names[0]), count = counts.get(holder) || 0;
      if (count >= 3) continue;
      counts.set(holder, count + 1);
      let time = clean(item.time);
      if (/^(昨晚|昨天|三天前|刚才|不久前|宴会之后)$/.test(time)) time = '';
      personal.push({
        name: names,
        known_by: unique(Array.isArray(item.known_by) ? item.known_by : [])
          .filter(name => !names.some(holderName => normalized(holderName) === normalized(name))),
        memory,
        time
      });
      if (personal.length >= 8) break;
    }
    const entitySource = !Array.isArray(value) && Array.isArray(value?.entity_updates)
      ? value.entity_updates : [];
    const entities = {};
    for (const type of ENTITY_TYPES) entities[type] = [];
    const perEntityCounts = new Map();
    let entityUpdateCount = 0;
    for (const item of entitySource) {
      if (entityUpdateCount >= 8) break;
      if (!item || typeof item !== 'object') continue;
      if (!ENTITY_TYPES.includes(item.type) || typeof item.name !== 'string'
        || typeof item.description !== 'string' || typeof item.event !== 'string' || typeof item.time !== 'string') continue;
      const type = item.type, name = clean(item.name), description = clean(item.description), event = clean(item.event);
      if (!name) continue;
      if (Array.from(description).length > 200) throw new Error(`${ENTITY_LABELS[type]}“${name}”的描述超过 200 字`);
      if (Array.from(event).length > 50) throw new Error(`${ENTITY_LABELS[type]}“${name}”的事件超过 50 字`);
      const key = `${type}:${normalized(name)}`, count = perEntityCounts.get(key) || 0;
      if (count >= 3) continue;
      perEntityCounts.set(key, count + 1);
      entities[type].push({ name, description, event, time: event ? sanitizeTime(item.time) : '' });
      entityUpdateCount++;
    }
    return { personal, entities };
  }

  function sanitizeTime(value) {
    const time = clean(value);
    return /^(昨晚|昨天|三天前|刚才|不久前|宴会之后)$/.test(time) ? '' : time;
  }

  function nextCharacterId(state) {
    const max = (state.personal_memory || []).reduce((n, character) => {
      const match = /^char_(\d+)$/.exec(clean(character.id));
      return Math.max(n, match ? Number(match[1]) : 0);
    }, 0);
    return `char_${String(max + 1).padStart(6, '0')}`;
  }

  function findCharacter(state, names) {
    const wanted = new Set(unique(names).map(normalized));
    return (state.personal_memory || []).find(character =>
      (character.names || []).some(name => wanted.has(normalized(name))));
  }

  function addKnowledge(index, names, record) {
    for (const name of unique(names)) {
      const key = normalized(name);
      if (!Array.isArray(index[key])) index[key] = [];
      if (!index[key].some(item => item.ownerId === record.ownerId && item.time === record.time && item.memory === record.memory)) {
        index[key].push(clone(record));
      }
    }
  }

  function rebuildKnowledgeIndex(state) {
    const index = {};
    for (const character of state.personal_memory || []) {
      for (const [time, memories] of Object.entries(character.memory || {})) {
        for (const memory of Array.isArray(memories) ? memories : []) {
          addKnowledge(index, character.names, { ownerId: character.id, time, memory });
        }
      }
    }
    state.knowledge_index = index;
  }

  function ensureEntityState(state) {
    if (!state.entity_memory || typeof state.entity_memory !== 'object' || Array.isArray(state.entity_memory)) state.entity_memory = {};
    for (const type of ENTITY_TYPES) if (!Array.isArray(state.entity_memory[type])) state.entity_memory[type] = [];
    if (!state.entity_index || typeof state.entity_index !== 'object' || Array.isArray(state.entity_index)) state.entity_index = {};
  }

  function nextEntityId(state, type) {
    ensureEntityState(state);
    const prefix = { organization: 'org', object: 'obj', ability: 'ability', location: 'location' }[type];
    const pattern = new RegExp(`^${prefix}_(\\d+)$`);
    const max = state.entity_memory[type].reduce((number, entity) => {
      const match = pattern.exec(clean(entity.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `${prefix}_${String(max + 1).padStart(6, '0')}`;
  }

  function rebuildEntityIndex(state) {
    ensureEntityState(state);
    const index = {};
    for (const type of ENTITY_TYPES) {
      for (const entity of state.entity_memory[type]) {
        if (!clean(entity.id)) entity.id = nextEntityId(state, type);
        const name = clean(entity.name);
        if (name) index[`${type}:${normalized(name)}`] = entity.id;
      }
    }
    state.entity_index = index;
  }

  function findEntity(state, type, name) {
    ensureEntityState(state);
    const key = `${type}:${normalized(name)}`;
    let id = state.entity_index[key];
    let entity = id && state.entity_memory[type].find(item => item.id === id);
    if (!entity) entity = state.entity_memory[type].find(item => normalized(item.name) === normalized(name));
    if (entity) {
      if (!clean(entity.id)) entity.id = nextEntityId(state, type);
      state.entity_index[key] = entity.id;
    }
    return entity;
  }

  function mergeEntityMemories(state, groups) {
    ensureEntityState(state);
    if (!Object.keys(state.entity_index).length) rebuildEntityIndex(state);
    const result = { entities: 0, history: 0, descriptions: 0 };
    for (const type of ENTITY_TYPES) {
      for (const item of groups?.[type] || []) {
        let entity = findEntity(state, type, item.name);
        let isNew = false;
        if (!entity) {
          entity = { id: nextEntityId(state, type), name: item.name, description: '', history: [] };
          state.entity_memory[type].push(entity);
          state.entity_index[`${type}:${normalized(item.name)}`] = entity.id;
          result.entities++;
          isNew = true;
        }
        if (item.description && entity.description !== item.description) {
          entity.description = item.description;
          if (!isNew) result.descriptions++;
        }
        if (!Array.isArray(entity.history)) entity.history = [];
        if (item.event && !entity.history.some(old => clean(old.time) === clean(item.time) && clean(old.event) === clean(item.event))) {
          entity.history.push({ time: clean(item.time), event: clean(item.event) });
          result.history++;
        }
      }
    }
    return result;
  }

  function mergeMemories(state, items) {
    if (!state.knowledge_index || typeof state.knowledge_index !== 'object') rebuildKnowledgeIndex(state);
    let added = 0;
    for (const item of items) {
      let character = findCharacter(state, item.name);
      if (!character) {
        character = { id: nextCharacterId(state), names: [], memory: {} };
        state.personal_memory.push(character);
      }
      character.names = unique([...(character.names || []), ...item.name]);
      if (!character.memory || typeof character.memory !== 'object' || Array.isArray(character.memory)) character.memory = {};
      const time = item.time || '';
      if (!Array.isArray(character.memory[time])) character.memory[time] = [];
      const exists = Object.values(character.memory).some(list => Array.isArray(list) && list.includes(item.memory));
      if (!exists) { character.memory[time].push(item.memory); added++; }
      const record = { ownerId: character.id, time, memory: item.memory };
      addKnowledge(state.knowledge_index, character.names, record); // 持有者本人自动补入
      for (const knowerName of item.known_by) {
        let knower = findCharacter(state, [knowerName]);
        if (!knower) {
          knower = { id: nextCharacterId(state), names: [knowerName], memory: {} };
          state.personal_memory.push(knower);
        }
        addKnowledge(state.knowledge_index, knower.names, record);
      }
    }
    return added;
  }

  async function requestExtraction(conversation, options) {
    const st = settings(), state = options?.baseState ? clone(options.baseState) : data().loadState();
    const prompt = await buildRequestPrompt(conversation, state, st);
    lastDebug = { prompt, requestPrompt: prompt, rawResult: '', apiResponse: '', parsed: null, error: '' };
    const retries = Math.max(0, Number(options?.retries ?? st.apiAutoRetries) || 0);
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await window.WORLD_ENGINE_API.callApi(
          prompt, st.maxTokens, st.temperature, abortController?.signal, st
        );
        lastDebug.rawResult = lastDebug.apiResponse = raw;
        const parsed = parseResponse(raw);
        lastDebug.parsed = clone(parsed);
        return parsed;
      } catch (error) {
        lastDebug.error = String(error?.message || error);
        if (abortController?.signal?.aborted || attempt >= retries) throw error;
      }
    }
    return { personal: [], entities: Object.fromEntries(ENTITY_TYPES.map(type => [type, []])) };
  }

  async function extractConversation(conversation, options) {
    if (running && !options?.allowWhileBackfill) return { skipped: true, reason: 'running' };
    running = true;
    abortController = new AbortController();
    window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(true);
    try {
      const before = options?.baseState ? clone(options.baseState) : data().loadState();
      const extracted = await requestExtraction(conversation, { ...options, baseState: before });
      if (options?.saveCheckpoint !== false) data().saveCheckpoint(before);
      const next = clone(before), addedPersonal = mergeMemories(next, extracted.personal);
      const entityChanges = mergeEntityMemories(next, extracted.entities);
      const added = addedPersonal + entityChanges.entities + entityChanges.history + entityChanges.descriptions;
      next.round = Math.max(0, Number(next.round) || 0) + 1;
      next.chatLayer = Number.isFinite(Number(options?.layer)) ? Number(options.layer) : currentLayer();
      data().saveState(next);
      window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.afterEvolution?.();
      applyInjection();
      return {
        added,
        extracted: extracted.personal.length + ENTITY_TYPES.reduce((sum, type) => sum + extracted.entities[type].length, 0),
        addedPersonal,
        entityChanges,
        state: next
      };
    } finally {
      running = false;
      abortController = null;
      window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(false);
    }
  }

  function countAiSince(layer) {
    return chat().reduce((count, message, index) => count + (index > layer && message && !message.is_user ? 1 : 0), 0);
  }

  // 手动向前提取与重新推演共用：读取轮数 = min(配置上限, 基底状态至今的实际 AI 轮数)。
  function getElapsedReadRounds(baseState, maxRounds) {
    const limit = Math.max(1, parseInt(maxRounds) || 1);
    const anchor = baseState?.chatLayer !== null && baseState?.chatLayer !== '' && Number.isFinite(Number(baseState?.chatLayer))
      ? Number(baseState.chatLayer) : -1;
    return Math.max(1, Math.min(countAiSince(anchor), limit));
  }

  async function autoExtract() {
    const st = settings();
    if (st.engineEnabled === false || st.evolveMode !== 'auto' || running || backfillRunning) return;
    const state = data().loadState();
    const anchor = state.chatLayer !== null && state.chatLayer !== '' && Number.isFinite(Number(state.chatLayer))
      ? Number(state.chatLayer) : -1;
    if (countAiSince(anchor) < Math.max(1, parseInt(st.evolveEveryX) || 1)) return;
    return extractConversation(recentConversation(st.evolveReadRounds), { layer: currentLayer() });
  }

  async function manualExtract() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const state = data().loadState();
    const readRounds = getElapsedReadRounds(state, st.manualReadRounds);
    return extractConversation(recentConversation(readRounds), { layer: currentLayer(), baseState: state });
  }

  async function manualReextract() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const checkpoint = data().loadCheckpoint();
    if (!checkpoint) throw new Error('没有可用于重新推演的记忆存档点');
    const readRounds = getElapsedReadRounds(checkpoint, st.manualReadRounds);
    return extractConversation(recentConversation(readRounds), {
      layer: currentLayer(),
      baseState: checkpoint
    });
  }

  function abort() {
    backfillRunning = false;
    abortController?.abort();
  }

  function clearInjection() {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_NAME, '', 1, 1);
    else if (typeof ctx?.unregisterInjection === 'function') ctx.unregisterInjection(INJECTION_NAME);
  }

  function registerInjection(content) {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_NAME, content, 1, 1);
    else if (typeof ctx?.registerInjection === 'function') {
      ctx.unregisterInjection?.(INJECTION_NAME);
      ctx.registerInjection(INJECTION_NAME, content, { position: 1, depth: 1, role: 'system' });
    }
  }

  function applyInjection(options) {
    const st = settings();
    if (st.engineEnabled === false || st.injectIntoPrompt === false) { clearInjection(); return ''; }
    const state = (options?.isReroll && data().loadCheckpoint()) || data().loadState();
    ensureEntityState(state);
    const hasPeople = Boolean(state?.personal_memory?.length);
    const hasEntities = ENTITY_TYPES.some(type => state.entity_memory[type].length);
    if (!hasPeople && !hasEntities) { clearInjection(); return ''; }
    if (!state.knowledge_index || !Object.keys(state.knowledge_index).length) rebuildKnowledgeIndex(state);
    const scan = chat().slice(-Math.max(1, parseInt(st.searchDepth) || 5)).map(message => clean(message?.mes)).join('\n');
    const appearsInScan = name => {
      if (!name) return false;
      return new RegExp(String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u').test(scan);
    };
    const matched = (state.personal_memory || []).filter(character => (character.names || []).some(appearsInScan));
    const matchedEntities = ENTITY_TYPES.flatMap(type => state.entity_memory[type]
      .filter(entity => appearsInScan(entity.name))
      .map(entity => ({ type, entity })));
    if (!matched.length && !matchedEntities.length) { clearInjection(); return ''; }
    const sections = [], globalSeen = new Set(), limit = Math.max(1, parseInt(st.maxPerCharacter) || 20);
    for (const character of matched) {
      const records = [];
      for (const name of character.names || []) records.push(...(state.knowledge_index[normalized(name)] || []));
      const selected = records.filter(record => {
        const key = `${record.ownerId}\u0000${record.time}\u0000${record.memory}`;
        if (globalSeen.has(key)) return false;
        globalSeen.add(key); return true;
      }).slice(-limit);
      if (selected.length) sections.push(`【${character.names?.[0] || character.id}】\n` +
        selected.map(record => `- [${record.time || '时间未明'}] ${record.memory}`).join('\n'));
    }
    if (matchedEntities.length) {
      const entitySections = matchedEntities.map(({ type, entity }) => {
        const lines = [`【${ENTITY_LABELS[type]}：${entity.name}】`, entity.description];
        const history = (Array.isArray(entity.history) ? entity.history : []).slice(-limit);
        if (history.length) lines.push(...history.map(entry => `- [${entry.time || '时间未明'}] ${entry.event}`));
        return lines.filter(Boolean).join('\n');
      });
      sections.push(`【相关世界实体】\n${entitySections.join('\n\n')}`);
    }
    if (!sections.length) { clearInjection(); return ''; }
    const content = `${SENTINEL}\n人物条目是当前场景人物持有或明确知晓的主观记忆，允许彼此矛盾；实体条目记录相关组织、物件、能力与地点的当前描述和本地历史。\n\n${sections.join('\n\n')}`;
    registerInjection(content);
    return content;
  }

  function setBackfillStatus(current, total, message) {
    backfillStatus = { running: backfillRunning, current, total, message: message || '' };
    const element = document.getElementById('we-memory-backfill-status');
    if (element) element.textContent = backfillStatus.message;
  }

  async function backfill() {
    if (backfillRunning || running) return;
    const st = settings(), all = chat();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const configuredEnd = Math.max(0, parseInt(st.backfillEndLayer) || 0);
    const end = Math.min(all.length - 1, configuredEnd || all.length - 1);
    const aiLayers = all.map((message, index) => (!message?.is_user && index <= end ? index : -1)).filter(i => i >= 0);
    const size = Math.max(1, parseInt(st.backfillBatchSize) || 5), batches = [];
    for (let i = 0; i < aiLayers.length; i += size) batches.push(aiLayers.slice(i, i + size));
    if (!batches.length) { setBackfillStatus(0, 0, '没有可重填的 AI 楼层'); return; }
    backfillRunning = true;
    window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.createSnapshot?.('记忆重填前自动备份');
    data().saveCheckpoint(data().loadState());
    data().saveState(data().defaultState());
    try {
      for (let i = 0; i < batches.length && backfillRunning; i++) {
        const layers = batches[i], start = Math.max(0, layers[0] - 1), finish = layers.at(-1);
        setBackfillStatus(i, batches.length, `正在重填 ${i + 1} / ${batches.length}`);
        await extractConversation(formatMessages(all.slice(start, finish + 1), start), {
          layer: finish, retries: st.backfillRetries, saveCheckpoint: true, allowWhileBackfill: true
        });
      }
      setBackfillStatus(batches.length, batches.length, backfillRunning ? '记忆重填完成' : '记忆重填已停止');
    } catch (error) {
      setBackfillStatus(backfillStatus.current, batches.length, `重填失败：${error?.message || error}`);
      throw error;
    } finally { backfillRunning = false; backfillStatus.running = false; applyInjection(); }
  }

  function stopBackfill() {
    backfillRunning = false;
    abortController?.abort();
    setBackfillStatus(backfillStatus.current, backfillStatus.total, '正在停止…');
  }

  function onMessageReceived() {
    const key = `${currentLayer()}:${clean(chat().at(-1)?.mes).slice(-80)}`;
    if (key === lastEventKey) return;
    lastEventKey = key;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => autoExtract().catch(error => console.error('[记忆引擎] 自动提取失败', error)), 1500);
  }

  function guardEvent(label, handler) {
    if (typeof window.WORLD_ENGINE_GUARD_EVENT === 'function') {
      return window.WORLD_ENGINE_GUARD_EVENT('记忆引擎', label, handler);
    }
    return function(...args) {
      try {
        const result = handler(...args);
        if (result && typeof result.then === 'function') {
          return result.catch(error => console.error(`[记忆引擎] ${label}事件处理失败`, error));
        }
        return result;
      }
      catch (error) { console.error(`[记忆引擎] ${label}事件处理失败`, error); }
    };
  }

  function init() {
    if (initialized) return;
    initialized = true;
    const ctx = context(), types = ctx?.event_types || {};
    if (ctx?.eventSource) {
      ctx.eventSource.on(types.GENERATION_ENDED || types.MESSAGE_RECEIVED || 'message_received', guardEvent('生成完成', onMessageReceived));
      ctx.eventSource.on(types.CHAT_LOADED || 'chat_loaded', guardEvent('聊天加载', () => { clearTimeout(autoTimer); abortController?.abort(); lastEventKey = ''; applyInjection(); }));
      ctx.eventSource.on(types.MESSAGE_SWIPED || 'message_swiped', guardEvent('滑动重生成', () => { clearTimeout(autoTimer); abortController?.abort(); applyInjection({ isReroll: true }); }));
      ctx.eventSource.on(types.GENERATION_STARTED || 'generation_started', guardEvent('生成开始', (type, _opts, dryRun) => {
        if (!dryRun) applyInjection({ isReroll: type === 'swipe' || type === 'regenerate' });
      }));
    }
    try { applyInjection(); }
    catch (error) { console.error('[记忆引擎] 首次注入失败', error); }
  }

  return {
    init, applyInjection, manualExtract, manualReextract, extractNow: manualExtract,
    backfill, stopBackfill, abort,
    getLastDebug: () => clone(lastDebug), getBackfillStatus: () => clone(backfillStatus),
    isRunning: () => running || backfillRunning
  };
})();
