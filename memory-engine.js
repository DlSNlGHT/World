// 记忆引擎运行链：复用世界引擎的 API、过滤、世界书、存档和注入机制。
window.MEMORY_ENGINE = (function() {
  const INJECTION_NAME = 'memory-engine-memory';
  const SENTINEL = '【记忆信息】';
  const DEFAULT_INJECTION_DICE_SIDES = 10000;
  const RECENT_RAW_ROUND_COUNT = 3;
  const ENTITY_TYPES = ['organization', 'object', 'ability', 'location'];
  const ENTITY_LABELS = { organization: '组织', object: '物件', ability: '能力', location: '地点' };
  let initialized = false, running = false, backfillRunning = false, reconciling = false;
  let runningLabel = '';
  let abortController = null, autoTimer = null, lastEventKey = '';
  let hiddenSyncPromise = Promise.resolve();
  let lastDebug = { prompt: '', rawResult: '', parsed: null, error: '' };
  let backfillStatus = { running: false, current: 0, total: 0, message: '' };
  let summaryBackfillStatus = { running: false, current: 0, total: 0, message: '' };

  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const clean = v => String(v == null ? '' : v).trim();
  const unique = list => Array.from(new Set((list || []).map(clean).filter(Boolean)));
  const normalized = v => clean(v).toLocaleLowerCase();
  const settings = () => window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {};
  const data = () => window.MEMORY_ENGINE_DATA;
  const timelineApi = () => window.MEMORY_ENGINE_TIMELINE;
  function setExternalStatus(text, isError) {
    window.__WE_SetExternalStatus?.(text, !!isError);
  }
  function context() { try { return SillyTavern.getContext(); } catch (_) { return null; } }
  const chat = () => context()?.chat || [];
  const currentLayer = () => Math.max(0, chat().length - 1);
  const ignoreFirstLayer = st => st?.firstLayerIsAiOpening !== false;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function configuredNameBlacklist(st) {
    return new Set(clean(st?.nameBlacklist).split(/\r?\n/).map(normalized).filter(Boolean));
  }

  function nameIsBlacklisted(value, blacklist) {
    const names = Array.isArray(value) ? value : [value];
    return names.some(name => blacklist.has(normalized(name)));
  }

  function worldLinkEnabled() {
    return window.WORLD_ENGINE_API?.getSettings?.(true)?.memoryLinkEnabled === true;
  }

  function ensureLinkCheckpoint(layer, baseState) {
    if (!worldLinkEnabled() || !Number.isFinite(Number(layer)) || !data()?.saveLinkCheckpoint) return null;
    const numericLayer = Number(layer);
    const existing = data().loadLinkCheckpoint?.();
    if (existing?.layer === numericLayer) return existing;
    return data().saveLinkCheckpoint({
      layer: numericLayer,
      rolledBack: false,
      baseState: clone(baseState || data().loadState())
    });
  }

  function rollbackLinkedLayer(layer) {
    if (!worldLinkEnabled()) return false;
    const checkpoint = data()?.loadLinkCheckpoint?.();
    if (!checkpoint || checkpoint.layer !== Number(layer)) return false;
    data().saveState(checkpoint.baseState);
    data().saveLinkCheckpoint({ ...checkpoint, rolledBack: true });
    applyInjection();
    return true;
  }

  // 每条候选记录各掷一次离散骰子，再按指数衰减权重计算优先级。
  // 最新记录权重最高；最旧记录的权重至少为 1 / 骰子面数，因此始终保留非零机会。
  function exponentialMemorySample(items, limit, randomFn = Math.random, diceSides = DEFAULT_INJECTION_DICE_SIDES) {
    const source = Array.isArray(items) ? items : [];
    const take = Math.max(0, Math.min(source.length, parseInt(limit) || 0));
    if (!take || !source.length) return [];
    if (source.length <= take) return source.slice();
    const sides = Math.max(1000, Math.min(10000, parseInt(diceSides) || DEFAULT_INJECTION_DICE_SIDES));
    const scale = Math.max(1, take);
    return source.map((item, index) => {
      const age = source.length - 1 - index;
      const weight = Math.max(1 / sides, Math.exp(-age / scale));
      const roll = Math.max(1, Math.min(sides, Math.floor(Number(randomFn()) * sides) + 1));
      const unit = roll / (sides + 1);
      return { item, index, priority: -Math.log(unit) / weight };
    }).sort((a, b) => a.priority - b.priority)
      .slice(0, take)
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.item);
  }

  function formatMessages(messages, startLayer) {
    const ctx = context();
    return (messages || []).map((message, i) => {
      const fallback = message?.is_user ? (ctx?.name1 || '用户') : (ctx?.name2 || '角色');
      return `[楼层 ${Number(startLayer || 0) + i}]【${clean(message?.name) || fallback}】\n${clean(message?.mes)}`;
    }).filter(Boolean).join('\n\n');
  }

  function recentConversation(rounds) {
    return recentConversationBatch(rounds).conversation;
  }

  function recentConversationBatch(rounds) {
    const all = chat(), count = Math.max(1, parseInt(rounds) || 1) * 2;
    const start = Math.max(ignoreFirstLayer(settings()) ? 1 : 0, all.length - count);
    const end = Math.max(start, all.length - 1);
    return {
      startLayer: start,
      endLayer: end,
      conversation: formatMessages(all.slice(start), start),
      sourceRefs: timelineApi()?.captureRange?.(start, end) || []
    };
  }

  function extractStoryTime(text) {
    const found = Array.from(String(text || '').matchAll(/『([^』]*(?:年|月|日|时|刻)[^』]*)』/g));
    return found.length ? clean(found.at(-1)[1].split('丨').slice(0, 3).join(' ')) : '';
  }

  function filterConversation(conversation, st) {
    return window.WORLD_ENGINE_CORE?.filterDialogue?.(
      conversation, { evolveFilterRegex: st.filterRegex || '' }
    ) || conversation;
  }

  function buildSmallHistoryContext(state, task) {
    const eventMemory = ensureEventState(state);
    const startLayer = Number.isFinite(Number(task?.startLayer)) ? Number(task.startLayer) : Infinity;
    const currentChatId = clean(data()?.getChatId?.());
    const valid = item => item?.status !== 'stale' && item?.status !== 'failed' && clean(item?.content);
    const beforeTask = item => {
      const originChatId = clean(item?.originChatId);
      if (originChatId && currentChatId && originChatId !== currentChatId) return true;
      return Number(item?.endLayer) < startLayer;
    };
    const eligibleBig = eventMemory.big_summaries.filter(item => valid(item) && beforeTask(item));
    const historyBigSummaries = eligibleBig.slice(-1);
    const historySmallSummaries = eventMemory.small_summaries
      .filter(item => valid(item) && beforeTask(item)).slice(-4);
    return { historyBigSummaries, historySmallSummaries };
  }

  async function buildRequestPrompt(tasks, state, st) {
    const segments = [];
    if (tasks.memory) {
      const filtered = filterConversation(tasks.memory.conversation, st);
      let worldbook = '';
      if (st.worldbookEnabled && window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection) {
        worldbook = await window.WORLD_ENGINE_WORLDBOOK.buildPromptSection(filtered, 'memory');
      }
      const user = window.MEMORY_ENGINE_PROMPT.buildUserPrompt({
        currentStoryTime: extractStoryTime(filtered),
        knownPeople: (state.personal_memory || []).map(character => unique(character.names)),
        knownEntities: ENTITY_TYPES.flatMap(type => (state.entity_memory?.[type] || []).map(entity => ({
          type: ENTITY_LABELS[type], name: entity.name, description: entity.description
        }))),
        worldbook,
        conversation: filtered
      });
      segments.push(`【任务说明】\n${window.MEMORY_ENGINE_PROMPT.TASK_PROMPT || window.MEMORY_ENGINE_PROMPT.SYSTEM_PROMPT}\n\n${user}`);
    }
    if (tasks.small) {
      segments.push(`【任务说明】\n${window.MEMORY_ENGINE_SMALL_SUMMARY_PROMPT.SYSTEM_PROMPT}\n\n${window.MEMORY_ENGINE_SMALL_SUMMARY_PROMPT.buildUserPrompt({
        ...tasks.small,
        ...buildSmallHistoryContext(state, tasks.small),
        conversation: filterConversation(tasks.small.conversation, st)
      })}`);
    }
    if (tasks.big) {
      segments.push(`【任务说明】\n${window.MEMORY_ENGINE_BIG_SUMMARY_PROMPT.SYSTEM_PROMPT}\n\n${window.MEMORY_ENGINE_BIG_SUMMARY_PROMPT.buildUserPrompt({
        ...tasks.big
      })}`);
    }
    const fields = [];
    if (tasks.memory) fields.push('"personal_memory": []', '"entity_updates": []');
    if (tasks.small) fields.push('"small_summary": ""');
    if (tasks.big) fields.push('"big_summary": ""');
    const tone = clean(st.tonePrompt);
    return `${segments.join('\n\n=====\n\n')}\n\n【统一输出要求】\n只输出一个合法 JSON 对象，不要输出 Markdown、代码围栏或解释。对象包含本次要求的字段：\n{\n  ${fields.join(',\n  ')}\n}${tone ? `\n\n【附加要求】\n${tone}` : ''}`;
  }

  function parseResponse(raw, tasks) {
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
    const nameBlacklist = configuredNameBlacklist(settings());
    // 兼容 0.1.x：旧 API 只返回人物记忆数组。
    const personalSource = tasks.memory ? (Array.isArray(value)
      ? value
      : (value?.personal_memory || value?.memories || value?.memory || value?.data || [])) : [];
    if (tasks.memory && !Array.isArray(personalSource)) throw new Error('personal_memory 必须是 JSON 数组');
    const counts = new Map(), personal = [];
    for (const item of personalSource) {
      if (!item || typeof item !== 'object') continue;
      if (nameIsBlacklisted(item.name, nameBlacklist)) continue;
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
    const entitySource = tasks.memory && !Array.isArray(value) && Array.isArray(value?.entity_updates)
      ? value.entity_updates : [];
    const entities = {};
    for (const type of ENTITY_TYPES) entities[type] = [];
    const perEntityCounts = new Map();
    let entityUpdateCount = 0;
    for (const item of entitySource) {
      if (entityUpdateCount >= 8) break;
      if (!item || typeof item !== 'object') continue;
      if (nameIsBlacklisted(item.name, nameBlacklist)) continue;
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
    let smallSummary = '';
    if (tasks.small) {
      if (Array.isArray(value) || typeof value?.small_summary !== 'string') throw new Error('small_summary 必须是字符串');
      smallSummary = clean(value.small_summary);
    }
    let bigSummary = '';
    if (tasks.big) {
      if (Array.isArray(value) || typeof value?.big_summary !== 'string') throw new Error('big_summary 必须是字符串');
      bigSummary = clean(value.big_summary);
    }
    return { personal, entities, smallSummary, bigSummary };
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

  function repairStateIndexes(state, previousState) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
    const oldState = previousState && typeof previousState === 'object' ? previousState : state;
    const oldIndex = clone(oldState.knowledge_index || {});
    const aliasTargets = {};
    const removedAliases = new Set();
    for (const oldPerson of oldState.personal_memory || []) {
      const current = (state.personal_memory || []).find(person => person.id === oldPerson.id);
      if (!current) {
        for (const oldName of oldPerson.names || []) removedAliases.add(normalized(oldName));
        continue;
      }
      for (const oldName of oldPerson.names || []) aliasTargets[normalized(oldName)] = unique(current.names || []);
    }
    rebuildKnowledgeIndex(state);
    const validRecords = new Set();
    for (const person of state.personal_memory || []) {
      for (const [time, memories] of Object.entries(person.memory || {})) {
        for (const memory of Array.isArray(memories) ? memories : []) validRecords.add(`${person.id}\u0000${time}\u0000${memory}`);
      }
    }
    for (const [oldName, records] of Object.entries(oldIndex)) {
      if (removedAliases.has(normalized(oldName))) continue;
      const targets = aliasTargets[normalized(oldName)] || [oldName];
      for (const record of Array.isArray(records) ? records : []) {
        if (!validRecords.has(`${record.ownerId}\u0000${record.time}\u0000${record.memory}`)) continue;
        addKnowledge(state.knowledge_index, targets, record);
      }
    }
    rebuildEntityIndex(state);
    return state;
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

  function replaceKnownByRecords(state, ownerId, records) {
    if (!state || typeof state !== 'object') return state;
    if (!state.knowledge_index || typeof state.knowledge_index !== 'object' || Array.isArray(state.knowledge_index)) state.knowledge_index = {};
    const owner = (state.personal_memory || []).find(character => character.id === ownerId);
    if (!owner) return state;
    for (const [name, indexed] of Object.entries(state.knowledge_index)) {
      state.knowledge_index[name] = (Array.isArray(indexed) ? indexed : []).filter(record => record.ownerId !== ownerId);
      if (!state.knowledge_index[name].length) delete state.knowledge_index[name];
    }
    for (const item of records || []) {
      const time = clean(item?.time), memory = clean(item?.memory ?? item?.content);
      if (!memory) continue;
      const record = { ownerId, time, memory };
      addKnowledge(state.knowledge_index, owner.names, record);
      for (const knowerName of unique(item?.known_by).filter(name => !(owner.names || []).some(alias => normalized(alias) === normalized(name)))) {
        let knower = findCharacter(state, [knowerName]);
        if (!knower) {
          knower = { id: nextCharacterId(state), names: [knowerName], memory: {} };
          state.personal_memory.push(knower);
        }
        addKnowledge(state.knowledge_index, knower.names, record);
      }
    }
    return state;
  }

  function ensureEventState(state) {
    if (!state.event_memory || typeof state.event_memory !== 'object' || Array.isArray(state.event_memory)) state.event_memory = {};
    if (!Array.isArray(state.event_memory.small_summaries)) state.event_memory.small_summaries = [];
    if (!Array.isArray(state.event_memory.big_summaries)) {
      state.event_memory.big_summaries = state.event_memory.big_summary?.content ? [state.event_memory.big_summary] : [];
    }
    delete state.event_memory.big_summary;
    if (!Number.isFinite(Number(state.event_memory.big_summary_cursor))) state.event_memory.big_summary_cursor = 0;
    state.event_memory.big_summary_cursor = Math.max(0, Math.min(
      state.event_memory.small_summaries.length, Number(state.event_memory.big_summary_cursor) || 0
    ));
    return state.event_memory;
  }

  function ensureTimelineState(state) {
    if (!state.timeline || typeof state.timeline !== 'object' || Array.isArray(state.timeline)) {
      // MEMORY_ENGINE_DATA.normalizeState normally creates this; the fallback protects tests and partial imports.
      const originChatId = data()?.getChatId?.() || 'default';
      state.timeline = {
        version: 1,
        originChatId,
        root: {
          id: `root:${originChatId}`,
          originChatId,
          createdAt: Date.now(),
          base: {
            personal_memory: clone(state.personal_memory || []),
            knowledge_index: clone(state.knowledge_index || {}),
            entity_memory: clone(state.entity_memory || {}),
            entity_index: clone(state.entity_index || {}),
            round: Math.max(0, Number(state.round) || 0),
            chatLayer: state.chatLayer ?? null
          }
        },
        nodes: []
      };
    }
    if (!Array.isArray(state.timeline.nodes)) state.timeline.nodes = [];
    return state.timeline;
  }

  function nextTimelineNodeId(timeline) {
    const max = (timeline.nodes || []).reduce((number, node) => {
      const match = /^memory_(\d+)$/.exec(clean(node?.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `memory_${String(max + 1).padStart(6, '0')}`;
  }

  function sourceBounds(refs, fallbackLayer) {
    const layers = (refs || []).map(ref => Number(ref?.layer)).filter(Number.isFinite);
    const fallback = Number.isFinite(Number(fallbackLayer)) ? Number(fallbackLayer) : currentLayer();
    return {
      startLayer: layers.length ? Math.min(...layers) : fallback,
      endLayer: layers.length ? Math.max(...layers) : fallback
    };
  }

  function appendTimelineNode(state, extracted, task, options) {
    const timeline = ensureTimelineState(state), api = timelineApi();
    let refs = Array.isArray(task?.sourceRefs) ? clone(task.sourceRefs) : [];
    if (!refs.length && Number.isFinite(Number(task?.startLayer)) && Number.isFinite(Number(task?.endLayer))) {
      refs = api?.captureRange?.(Number(task.startLayer), Number(task.endLayer)) || [];
    }
    // 世界引擎联动等合成输入没有真实聊天正文，用跨聊天唯一的合成来源记录身份。
    if (!refs.length) {
      const originChatId = data()?.getChatId?.() || 'default';
      const layer = Number.isFinite(Number(options?.layer)) ? Number(options.layer) : currentLayer();
      const sourceText = clean(task?.conversation);
      refs = [{
        chatId: originChatId,
        messageId: clean(task?.sourceKey) || `synthetic:${originChatId}:${layer}:${api?.hashText?.(sourceText) || sourceText.length}`,
        layer,
        role: 'synthetic',
        swipeId: 0,
        hash: api?.hashText?.(sourceText) || String(sourceText.length),
        synthetic: true
      }];
    }
    const digest = api?.digestRefs?.(refs) || '';
    const existing = timeline.nodes.find(node => node.sourceDigest && node.sourceDigest === digest && node.status !== 'stale');
    if (existing) return existing;
    const bounds = sourceBounds(refs, options?.layer);
    const node = {
      id: nextTimelineNodeId(timeline),
      kind: task?.kind || 'memory',
      originChatId: data()?.getChatId?.() || 'default',
      startLayer: bounds.startLayer,
      endLayer: bounds.endLayer,
      sourceRefs: refs,
      sourceDigest: digest,
      personal: clone(extracted?.personal || []),
      entities: clone(extracted?.entities || {}),
      status: 'valid',
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    timeline.nodes.push(node);
    return node;
  }

  function replayTimeline(state, stopBeforeId) {
    const timeline = ensureTimelineState(state), root = clone(timeline.root?.base || {});
    const derived = {
      personal_memory: clone(root.personal_memory || []),
      knowledge_index: clone(root.knowledge_index || {}),
      entity_memory: clone(root.entity_memory || {}),
      entity_index: clone(root.entity_index || {}),
      round: Math.max(0, Number(root.round) || 0),
      chatLayer: root.chatLayer ?? null,
      event_memory: clone(state.event_memory || {}),
      timeline: clone(timeline)
    };
    ensureEntityState(derived);
    for (const node of timeline.nodes) {
      if (stopBeforeId && node.id === stopBeforeId) break;
      if (node.status !== 'valid') continue;
      if (node.kind === 'manual_snapshot' && node.snapshot) {
        derived.personal_memory = clone(node.snapshot.personal_memory || []);
        derived.knowledge_index = clone(node.snapshot.knowledge_index || {});
        derived.entity_memory = clone(node.snapshot.entity_memory || {});
        derived.entity_index = clone(node.snapshot.entity_index || {});
        derived.round = Math.max(derived.round, Number(node.snapshot.round) || 0);
        derived.chatLayer = node.snapshot.chatLayer ?? derived.chatLayer;
        ensureEntityState(derived);
        continue;
      }
      mergeMemories(derived, clone(node.personal || []));
      mergeEntityMemories(derived, clone(node.entities || {}));
      derived.round += 1;
      if (Number.isFinite(Number(node.endLayer))) derived.chatLayer = Number(node.endLayer);
    }
    repairStateIndexes(derived, derived);
    return derived;
  }

  function commitManualState(nextState, previousState) {
    if (!nextState || !previousState) return nextState;
    const memoryView = state => JSON.stringify({
      personal_memory: state.personal_memory || [],
      knowledge_index: state.knowledge_index || {},
      entity_memory: state.entity_memory || {},
      entity_index: state.entity_index || {}
    });
    if (memoryView(nextState) === memoryView(previousState)) return nextState;
    const timeline = ensureTimelineState(previousState), api = timelineApi();
    const layer = currentLayer(), originChatId = data()?.getChatId?.() || 'default';
    const snapshot = {
      personal_memory: clone(nextState.personal_memory || []),
      knowledge_index: clone(nextState.knowledge_index || {}),
      entity_memory: clone(nextState.entity_memory || {}),
      entity_index: clone(nextState.entity_index || {}),
      round: Math.max(0, Number(nextState.round) || 0),
      chatLayer: nextState.chatLayer ?? layer
    };
    const hash = api?.hashText?.(memoryView(nextState)) || String(Date.now());
    timeline.nodes.push({
      id: nextTimelineNodeId(timeline),
      kind: 'manual_snapshot',
      originChatId,
      startLayer: layer,
      endLayer: layer,
      sourceRefs: [{ chatId: originChatId, messageId: `manual:${Date.now()}`, layer, role: 'synthetic', swipeId: 0, hash, synthetic: true }],
      sourceDigest: hash,
      personal: [],
      entities: {},
      snapshot,
      status: 'valid',
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    nextState.timeline = clone(timeline);
    return nextState;
  }

  // 自动纪要只处理进入当前聊天之后新增的对话。首次见到一个聊天时仅落下
  // 当前楼层基线，不调用 API；从头整理历史记录只允许由批量重填显式触发。
  function initializeSummaryBaseline() {
    const memoryData = data();
    if (!memoryData) return null;
    const state = memoryData.loadState();
    const eventMemory = ensureEventState(state);
    if (eventMemory.small_summary_layer !== null
      && eventMemory.small_summary_layer !== ''
      && Number.isFinite(Number(eventMemory.small_summary_layer))) return state;
    eventMemory.small_summary_layer = chat().length - 1;
    return memoryData.saveState(state);
  }

  function nextSmallSummaryId(eventMemory) {
    const max = (eventMemory.small_summaries || []).reduce((number, item) => {
      const match = /^small_(\d+)$/.exec(clean(item?.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `small_${String(max + 1).padStart(6, '0')}`;
  }

  function nextBigSummaryId(eventMemory) {
    const max = (eventMemory.big_summaries || []).reduce((number, item) => {
      const match = /^big_(\d+)$/.exec(clean(item?.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `big_${String(max + 1).padStart(6, '0')}`;
  }

  async function requestTasks(tasks, options) {
    const st = settings(), state = options?.baseState ? clone(options.baseState) : data().loadState();
    const prompt = await buildRequestPrompt(tasks, state, st);
    lastDebug = { prompt, requestPrompt: prompt, rawResult: '', apiResponse: '', parsed: null, error: '' };
    const retries = Math.max(0, Number(options?.retries ?? st.apiAutoRetries) || 0);
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await window.WORLD_ENGINE_API.callApi(
          prompt, st.maxTokens, st.temperature, abortController?.signal, st
        );
        lastDebug.rawResult = lastDebug.apiResponse = raw;
        const parsed = parseResponse(raw, tasks);
        lastDebug.parsed = clone(parsed);
        return parsed;
      } catch (error) {
        lastDebug.error = String(error?.message || error);
        if (abortController?.signal?.aborted || attempt >= retries) throw error;
      }
    }
    return {
      personal: [], entities: Object.fromEntries(ENTITY_TYPES.map(type => [type, []])),
      smallSummary: '', bigSummary: ''
    };
  }

  async function runTasks(tasks, options) {
    if (running && !options?.allowWhileBackfill) return { skipped: true, reason: 'running' };
    if (!tasks?.memory && !tasks?.small && !tasks?.big) return { skipped: true, reason: 'no_tasks' };
    if (tasks.small && tasks.big) throw new Error('总述必须在纪要落库后独立运行');
    if (tasks.memory && Number.isFinite(Number(options?.layer))) {
      ensureLinkCheckpoint(Number(options.layer), options?.baseState);
    }
    running = true;
    runningLabel = tasks.memory && tasks.small ? '人物、实体与纪要'
      : (tasks.memory ? '人物与实体提取' : (tasks.small ? '纪要' : '总述'));
    const taskLabel = runningLabel;
    abortController = new AbortController();
    setExternalStatus(`正在进行${taskLabel}…`);
    // 顶部状态机会先清理悬浮球运行类，因此最后再按当前引擎面刷新动画状态。
    window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(true, runningLabel);
    try {
      const before = options?.baseState ? clone(options.baseState) : data().loadState();
      const extracted = await requestTasks(tasks, { ...options, baseState: before });
      if (options?.saveCheckpoint !== false) data().saveCheckpoint(before);
      const next = clone(before);
      const memorySourceDigest = tasks.memory && Array.isArray(tasks.memory.sourceRefs) && tasks.memory.sourceRefs.length
        ? timelineApi()?.digestRefs?.(tasks.memory.sourceRefs) || '' : '';
      const memoryAlreadyStored = memorySourceDigest && ensureTimelineState(next).nodes.some(node =>
        node.kind === 'memory' && node.status === 'valid' && clean(node.sourceDigest) === memorySourceDigest
      );
      const applyMemory = Boolean(tasks.memory && !memoryAlreadyStored);
      const addedPersonal = applyMemory ? mergeMemories(next, extracted.personal) : 0;
      const entityChanges = applyMemory
        ? mergeEntityMemories(next, extracted.entities)
        : { entities: 0, history: 0, descriptions: 0 };
      if (applyMemory) appendTimelineNode(next, extracted, tasks.memory, options);
      const eventMemory = ensureEventState(next);
      let addedSmall = 0, updatedBig = 0;
      if (tasks.small && extracted.smallSummary) {
        const sourceRefs = clone(tasks.small.sourceRefs || timelineApi()?.captureRange?.(tasks.small.startLayer, tasks.small.endLayer) || []);
        const sourceDigest = timelineApi()?.digestRefs?.(sourceRefs) || '';
        const existingSummary = sourceDigest ? eventMemory.small_summaries.find(item =>
          item.status !== 'stale' && clean(item.sourceDigest) === sourceDigest
        ) : null;
        if (!existingSummary) {
          eventMemory.small_summaries.push({
            id: nextSmallSummaryId(eventMemory),
            startLayer: Number(tasks.small.startLayer) || 0,
            endLayer: Number(tasks.small.endLayer) || 0,
            content: extracted.smallSummary,
            sourceRefs,
            sourceDigest,
            originChatId: data()?.getChatId?.() || 'default',
            status: 'valid',
            revision: 1
          });
          addedSmall = 1;
        }
        eventMemory.small_summary_layer = Number(tasks.small.endLayer) || 0;
      }
      if (options?.worldDigestMinute?.content) {
        const linked = options.worldDigestMinute;
        eventMemory.small_summaries.push({
          id: nextSmallSummaryId(eventMemory),
          startLayer: Number(linked.layer) || 0,
          endLayer: Number(linked.layer) || 0,
          content: Array.from(clean(linked.content)).slice(0, 200).join(''),
          source: 'world_engine',
          sourceKey: clean(linked.sourceKey)
        });
        addedSmall += 1;
      }
      if (tasks.big && extracted.bigSummary) {
        eventMemory.big_summaries.push({
          id: nextBigSummaryId(eventMemory),
          startLayer: Number(tasks.big.startLayer) || 0,
          endLayer: Number(tasks.big.endLayer) || 0,
          content: extracted.bigSummary,
          childIds: clone(tasks.big.childIds || []),
          childDigest: clean(tasks.big.childDigest),
          sourceRefs: clone(tasks.big.sourceRefs || []),
          originChatId: data()?.getChatId?.() || 'default',
          status: 'valid',
          revision: 1
        });
        eventMemory.big_summary_cursor = Math.min(
          eventMemory.small_summaries.length,
          eventMemory.big_summary_cursor + Math.max(1, Number(tasks.big.consumeCount) || 1)
        );
        updatedBig = 1;
      }
      const added = addedPersonal + entityChanges.entities + entityChanges.history + entityChanges.descriptions;
      if (tasks.memory) {
        if (applyMemory) next.round = Math.max(0, Number(next.round) || 0) + 1;
        next.chatLayer = Number.isFinite(Number(options?.layer)) ? Number(options.layer) : currentLayer();
      }
      data().saveState(next);
      window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.afterEvolution?.();
      applyInjection();
      setExternalStatus(`${taskLabel}完成`);
      return {
        added: added + addedSmall + updatedBig,
        extracted: extracted.personal.length + ENTITY_TYPES.reduce((sum, type) => sum + extracted.entities[type].length, 0),
        addedPersonal,
        entityChanges,
        addedSmall,
        updatedBig,
        state: next
      };
    } catch (error) {
      const stopped = abortController?.signal?.aborted || error?.name === 'AbortError';
      setExternalStatus(stopped ? `${taskLabel}已停止` : `${taskLabel}失败：${error?.message || error}`, !stopped);
      throw error;
    } finally {
      running = false;
      runningLabel = '';
      abortController = null;
      window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(false, '');
    }
  }

  async function extractConversation(conversation, options) {
    return runTasks({ memory: {
      conversation,
      sourceRefs: clone(options?.sourceRefs || []),
      startLayer: options?.startLayer,
      endLayer: options?.endLayer,
      sourceKey: options?.sourceKey
    } }, options);
  }

  function countAiSince(layer, st) {
    const anchor = layer !== null && layer !== '' && Number.isFinite(Number(layer)) ? Number(layer) : -1;
    const all = chat(), skipOpening = anchor < 0 && ignoreFirstLayer(st || settings());
    return all.reduce((count, message, index) => count + (
      index > anchor && !(skipOpening && index === 0) && message && !message.is_user ? 1 : 0
    ), 0);
  }

  function getAiBatchAfter(layer, maxAi, endLayer, settingsOverride) {
    const all = chat();
    const anchor = layer !== null && layer !== '' && Number.isFinite(Number(layer)) ? Number(layer) : -1;
    const skipOpening = anchor < 0 && ignoreFirstLayer(settingsOverride || settings());
    const end = endLayer !== undefined && Number.isFinite(Number(endLayer)) ? Number(endLayer) : all.length - 1;
    const aiLayers = all.map((message, index) => (index > anchor && index <= end && !(skipOpening && index === 0) && message && !message.is_user ? index : -1))
      .filter(index => index >= 0).slice(0, Math.max(1, parseInt(maxAi) || 1));
    if (!aiLayers.length) return null;
    const firstAi = aiLayers[0], finish = aiLayers.at(-1);
    const start = firstAi > 0 && all[firstAi - 1]?.is_user ? firstAi - 1 : firstAi;
    return {
      startLayer: start,
      endLayer: finish,
      aiCount: aiLayers.length,
      conversation: formatMessages(all.slice(start, finish + 1), start),
      sourceRefs: timelineApi()?.captureRange?.(start, finish) || []
    };
  }

  function buildBigTask(state, force, thresholdOverride) {
    const st = settings(), eventMemory = ensureEventState(state);
    const allPending = eventMemory.small_summaries.slice(eventMemory.big_summary_cursor);
    const threshold = Math.max(1, parseInt(thresholdOverride ?? st.bigSummaryEveryX) || 5);
    if (!force && allPending.length < threshold) return null;
    if (force && !allPending.length) return null;
    const pending = force ? allPending : allPending.slice(0, threshold);
    const childIds = pending.map(item => item.id);
    const sourceRefs = timelineApi()?.unionRefs?.(pending.map(item => item.sourceRefs || [])) || [];
    return {
      summaries: pending,
      consumeCount: pending.length,
      startLayer: Number(pending[0]?.startLayer) || 0,
      endLayer: Number(pending.at(-1)?.endLayer) || 0,
      childIds,
      childDigest: timelineApi()?.hashText?.(pending.map(item => `${item.id}:${item.revision || 1}:${item.sourceDigest || ''}`).join('|')) || '',
      sourceRefs
    };
  }

  async function runTasksThenDueBig(tasks, options, bigThresholdOverride) {
    const primary = await runTasks(tasks, options);
    if (primary?.skipped) return primary;
    const after = data().loadState();
    const bigTask = buildBigTask(after, false, bigThresholdOverride);
    if (!bigTask) return primary;
    const bigResult = await runTasks({ big: bigTask }, {
      ...options,
      baseState: after,
      saveCheckpoint: false,
      // 世界摘要纪要只在 primary 落库一次；这里仅消费待整理纪要生成总述。
      worldDigestMinute: null
    });
    return {
      ...primary,
      added: Number(primary.added || 0) + Number(bigResult?.updatedBig || 0),
      updatedBig: Number(bigResult?.updatedBig || 0),
      state: bigResult?.state || primary.state
    };
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
    if (st.engineEnabled === false || running || backfillRunning || reconciling) return;
    // 历史正文修复必须等本轮 AI 回复完成后才请求 API；手动提取模式也照常修复历史。
    await reconcileHistory();
    if (st.evolveMode !== 'auto') return;
    const state = data().loadState();
    const anchor = state.chatLayer !== null && state.chatLayer !== '' && Number.isFinite(Number(state.chatLayer))
      ? Number(state.chatLayer) : -1;
    const tasks = {};
    if (countAiSince(anchor) >= Math.max(1, parseInt(st.evolveEveryX) || 1)) {
      tasks.memory = recentConversationBatch(st.evolveReadRounds);
    }
    const eventMemory = ensureEventState(state);
    const smallEvery = Math.max(1, parseInt(st.smallSummaryEveryX) || 5);
    const smallBatch = countAiSince(eventMemory.small_summary_layer) >= smallEvery
      ? getAiBatchAfter(eventMemory.small_summary_layer, smallEvery) : null;
    if (smallBatch) tasks.small = smallBatch;
    const bigTask = buildBigTask(state, false);
    if (!tasks.memory && !tasks.small) {
      if (!bigTask) return;
      const result = await runTasks({ big: bigTask }, { baseState: state });
      if (buildBigTask(data().loadState(), false)) {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => autoExtract().catch(error => console.error('[记忆引擎] 自动总述补进度失败', error)), 0);
      }
      return result;
    }
    const result = await runTasksThenDueBig(tasks, { layer: currentLayer(), baseState: state });
    const after = data().loadState(), afterEvent = ensureEventState(after);
    if (countAiSince(afterEvent.small_summary_layer) >= smallEvery || buildBigTask(after, false)) {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => autoExtract().catch(error => console.error('[记忆引擎] 自动纪要补进度失败', error)), 0);
    }
    return result;
  }

  async function manualExtract() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const state = data().loadState();
    const timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
    const memoryLayer = state.chatLayer !== null && state.chatLayer !== '' && Number.isFinite(Number(state.chatLayer))
      ? Number(state.chatLayer) : null;
    const summaryLayer = eventMemory.small_summary_layer !== null && eventMemory.small_summary_layer !== ''
      && Number.isFinite(Number(eventMemory.small_summary_layer)) ? Number(eventMemory.small_summary_layer) : null;
    const hasTrackedSummaries = eventMemory.small_summaries.some(summary =>
      Array.isArray(summary.sourceRefs) && summary.sourceRefs.length
    );
    // 新聊天首次建立纪要基线时，人物游标尚为空；此时沿用纪要基线，避免误把整段旧聊天当成待处理。
    // 若已经存在带正文来源的纪要，则从头寻找尚缺人物实体的最早一轮，补齐两条链。
    let anchor = memoryLayer === null ? (hasTrackedSummaries ? -1 : (summaryLayer ?? -1))
      : (summaryLayer === null ? memoryLayer : Math.min(memoryLayer, summaryLayer));
    let batch = null;
    while (true) {
      const candidate = getAiBatchAfter(anchor, 1);
      if (!candidate) break;
      const digest = timelineApi()?.digestRefs?.(candidate.sourceRefs || []) || '';
      const hasNode = digest && timeline.nodes.some(node =>
        node.kind === 'memory' && node.status === 'valid' && clean(node.sourceDigest) === digest
      );
      const hasSummary = digest && eventMemory.small_summaries.some(summary =>
        summary.status !== 'stale' && clean(summary.sourceDigest) === digest
      );
      if (hasNode && hasSummary) {
        anchor = candidate.endLayer;
        continue;
      }
      batch = candidate;
      break;
    }
    if (!batch) throw new Error('当前没有尚未提取的新一轮正文');
    return runTasksThenDueBig({ memory: batch, small: batch }, {
      ...batch, layer: batch.endLayer, baseState: state
    });
  }

  async function manualReextract() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const current = data().loadState();
    const timeline = ensureTimelineState(current);
    const latestNode = timeline.nodes.slice().reverse().find(node => node.kind === 'memory' && node.status === 'valid');
    if (latestNode) {
      const eventMemory = ensureEventState(current);
      const sourceDigest = clean(latestNode.sourceDigest)
        || timelineApi()?.digestRefs?.(latestNode.sourceRefs || []) || '';
      const pairedSummary = sourceDigest ? eventMemory.small_summaries.find(summary => {
        const digest = clean(summary.sourceDigest)
          || timelineApi()?.digestRefs?.(summary.sourceRefs || []) || '';
        return summary.status === 'valid' && digest === sourceDigest;
      }) : null;
      latestNode.status = 'stale';
      if (pairedSummary) pairedSummary.status = 'stale';
      data().saveState(current);
      const repaired = await repairMemoryAndSmall(latestNode.id, pairedSummary?.id);
      if (!repaired) throw new Error('最新一轮人物、实体与纪要未能重新提取');
      await reconcileHistory();
      return { replacedNodeId: latestNode.id, replacedSummaryId: pairedSummary?.id || null, state: data().loadState() };
    }
    // 旧数据尚未产生时间链节点时，保留一次兼容回退；新节点产生后不再依赖 checkpoint。
    const checkpoint = data().loadCheckpoint();
    if (!checkpoint) throw new Error('没有可用于重新推演的记忆存档点');
    const readRounds = getElapsedReadRounds(checkpoint, st.manualReadRounds);
    const batch = recentConversationBatch(readRounds);
    return runTasksThenDueBig({ memory: batch, small: batch }, {
      ...batch, layer: currentLayer(), baseState: checkpoint
    });
  }

  async function manualSmallSummary() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const state = data().loadState(), eventMemory = ensureEventState(state);
    const batch = getAiBatchAfter(eventMemory.small_summary_layer, Math.max(1, parseInt(st.smallSummaryEveryX) || 5));
    if (!batch) throw new Error('当前状态之后没有可总结的新对话');
    return runTasksThenDueBig({ small: batch }, { baseState: state });
  }

  async function manualBigSummary() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const state = data().loadState(), bigTask = buildBigTask(state, true);
    if (!bigTask) throw new Error('当前没有尚未并入总述的纪要');
    return runTasks({ big: bigTask }, { baseState: state });
  }

  function newHistoryAuditReport() {
    return { changedLayers: new Set(), deletedLayers: new Set() };
  }

  function collectHistoryAudit(report, audit) {
    if (!report || !audit) return;
    for (const item of audit.changed || []) {
      const layer = Number(item?.before?.layer ?? item?.after?.layer);
      if (Number.isFinite(layer)) report.changedLayers.add(layer);
    }
    for (const ref of audit.missing || []) {
      const layer = Number(ref?.layer);
      if (Number.isFinite(layer)) report.deletedLayers.add(layer);
    }
  }

  // 楼层数字会在删楼后整体前移。来源引用可以用稳定消息 ID 判断哪些旧楼
  // 消失了，但纪要进度仍是数字游标，必须同步减去游标之前被删的楼层数。
  // 否则新对话要先“追平”删除前的楼层号，期间不会再生成纪要。
  function rewindSummaryCursorForDeletedLayers(state, report) {
    const deleted = [...(report?.deletedLayers || [])].filter(Number.isFinite);
    if (!deleted.length) return false;
    const eventMemory = ensureEventState(state);
    if (eventMemory.small_summary_layer === null || eventMemory.small_summary_layer === ''
      || !Number.isFinite(Number(eventMemory.small_summary_layer))) return false;
    const anchor = Number(eventMemory.small_summary_layer);
    const removedBeforeCursor = deleted.filter(layer => layer <= anchor).length;
    if (!removedBeforeCursor) return false;
    eventMemory.small_summary_layer = Math.max(-1, anchor - removedBeforeCursor);
    return true;
  }

  function formatHistoryLayers(layers) {
    const values = [...(layers || [])].filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? `第 ${values.join('、')} 楼` : '';
  }

  function historyAuditMessage(report, phase, error) {
    const changed = formatHistoryLayers(report?.changedLayers);
    const deleted = formatHistoryLayers(report?.deletedLayers);
    const subjects = [changed ? `${changed}正文已修改` : '', deleted ? `${deleted}已删除` : ''].filter(Boolean);
    if (!subjects.length) {
      if (phase === 'failed') return `历史记忆修复失败：旧记忆已停止注入，本次使用原始正文。原因：${error?.message || error}`;
      return phase === 'success' ? '历史记忆对账完成' : '正在核对历史楼层与记忆链…';
    }
    const subject = subjects.join('；');
    if (phase === 'detected') return `检测到${subject}，正在重建相关记忆、纪要与总述…`;
    if (phase === 'success') return `${subject}：相关记忆、纪要与总述已更新，本次注入采用新正文。`;
    return `${subject}：历史记忆修复失败，旧记忆已停止注入，本次使用原始正文。原因：${error?.message || error}`;
  }

  function auditStoredSources(state, report) {
    const api = timelineApi(), timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
    let changed = false;
    const refreshValidRefs = (record, audit) => {
      if (!audit?.valid || audit.inherited || audit.synthetic || !Array.isArray(audit.refs)) return;
      const oldLayers = (record.sourceRefs || []).map(ref => Number(ref.layer)).join(',');
      const newLayers = audit.refs.map(ref => Number(ref.layer)).join(',');
      if (oldLayers === newLayers) return;
      record.sourceRefs = clone(audit.refs);
      const bounds = sourceBounds(audit.refs, record.endLayer);
      record.startLayer = bounds.startLayer;
      record.endLayer = bounds.endLayer;
      changed = true;
    };
    for (const node of timeline.nodes) {
      if (!Array.isArray(node.sourceRefs) || !node.sourceRefs.length) continue;
      const audit = api?.auditRefs?.(node.sourceRefs);
      collectHistoryAudit(report, audit);
      refreshValidRefs(node, audit);
      const nextStatus = audit?.valid ? 'valid' : 'stale';
      if (node.status !== nextStatus) { node.status = nextStatus; changed = true; }
    }
    for (const summary of eventMemory.small_summaries) {
      if (!Array.isArray(summary.sourceRefs) || !summary.sourceRefs.length) continue; // 旧版手工/迁移纪要保持封存。
      const audit = api?.auditRefs?.(summary.sourceRefs);
      collectHistoryAudit(report, audit);
      refreshValidRefs(summary, audit);
      const nextStatus = audit?.valid ? 'valid' : 'stale';
      if (summary.status !== nextStatus) { summary.status = nextStatus; changed = true; }
    }
    for (const overview of eventMemory.big_summaries) {
      if (!Array.isArray(overview.childIds) || !overview.childIds.length) continue;
      const children = overview.childIds.map(id => eventMemory.small_summaries.find(item => item.id === id)).filter(Boolean);
      const digest = api?.hashText?.(children.map(item => `${item.id}:${item.revision || 1}:${item.sourceDigest || ''}`).join('|')) || '';
      const valid = children.length === overview.childIds.length
        && children.every(item => item.status === 'valid')
        && digest === clean(overview.childDigest);
      const nextStatus = valid ? 'valid' : 'stale';
      if (overview.status !== nextStatus) { overview.status = nextStatus; changed = true; }
    }
    return changed;
  }

  async function repairMemoryNode(nodeId) {
    let state = data().loadState(), timeline = ensureTimelineState(state);
    let node = timeline.nodes.find(item => item.id === nodeId);
    if (!node || node.status !== 'stale') return false;
    const api = timelineApi(), audit = api?.auditRefs?.(node.sourceRefs);
    if (!audit?.refs?.length) {
      timeline.nodes = timeline.nodes.filter(item => item.id !== nodeId);
      data().saveState(replayTimeline(state));
      return true;
    }
    const base = replayTimeline(state, nodeId);
    const conversation = api?.refsToConversation?.(node.sourceRefs) || '';
    if (!conversation) return false;
    const extracted = await requestTasks({ memory: { conversation } }, { baseState: base });

    state = data().loadState();
    timeline = ensureTimelineState(state);
    node = timeline.nodes.find(item => item.id === nodeId);
    if (!node) return false;
    const bounds = sourceBounds(audit.refs, node.endLayer);
    node.sourceRefs = clone(audit.refs);
    node.sourceDigest = api?.digestRefs?.(audit.refs) || '';
    node.startLayer = bounds.startLayer;
    node.endLayer = bounds.endLayer;
    node.personal = clone(extracted.personal || []);
    node.entities = clone(extracted.entities || {});
    node.status = 'valid';
    node.revision = Math.max(1, Number(node.revision) || 1) + 1;
    node.updatedAt = Date.now();
    data().saveState(replayTimeline(state));
    return true;
  }

  // 日常提取固定为一轮后，同轮人物/实体节点与纪要拥有相同来源。
  // 历史变化时也联合请求，保持新增与修复使用同一个最小事务单元。
  async function repairMemoryAndSmall(nodeId, summaryId) {
    let state = data().loadState(), timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
    let node = timeline.nodes.find(item => item.id === nodeId);
    let summary = summaryId ? eventMemory.small_summaries.find(item => item.id === summaryId) : null;
    if (!node || node.status !== 'stale' || (summaryId && (!summary || summary.status !== 'stale'))) return false;

    const api = timelineApi();
    const nodeAudit = api?.auditRefs?.(node.sourceRefs);
    const summaryAudit = summary ? api?.auditRefs?.(summary.sourceRefs) : nodeAudit;
    if (!nodeAudit?.refs?.length || !summaryAudit?.refs?.length) return false;
    const nodeDigest = api?.digestRefs?.(nodeAudit.refs) || '';
    const summaryDigest = api?.digestRefs?.(summaryAudit.refs) || '';
    if (!nodeDigest || nodeDigest !== summaryDigest) return false;

    const conversation = api?.refsToConversation?.(node.sourceRefs) || '';
    if (!conversation) return false;
    const bounds = sourceBounds(nodeAudit.refs, node.endLayer);
    const base = replayTimeline(state, nodeId);
    const extracted = await requestTasks({
      memory: { conversation },
      small: {
        startLayer: bounds.startLayer,
        endLayer: bounds.endLayer,
        conversation
      }
    }, { baseState: base });

    state = data().loadState();
    timeline = ensureTimelineState(state);
    eventMemory = ensureEventState(state);
    node = timeline.nodes.find(item => item.id === nodeId);
    summary = summaryId ? eventMemory.small_summaries.find(item => item.id === summaryId) : null;
    if (!node || (summaryId && !summary)) return false;

    node.sourceRefs = clone(nodeAudit.refs);
    node.sourceDigest = nodeDigest;
    node.startLayer = bounds.startLayer;
    node.endLayer = bounds.endLayer;
    node.personal = clone(extracted.personal || []);
    node.entities = clone(extracted.entities || {});
    node.status = 'valid';
    node.revision = Math.max(1, Number(node.revision) || 1) + 1;
    node.updatedAt = Date.now();

    if (!summary) {
      summary = {
        id: nextSmallSummaryId(eventMemory),
        startLayer: bounds.startLayer,
        endLayer: bounds.endLayer,
        sourceRefs: clone(summaryAudit.refs),
        sourceDigest: summaryDigest,
        content: extracted.smallSummary,
        originChatId: data()?.getChatId?.() || 'default',
        status: 'valid',
        revision: 1
      };
      eventMemory.small_summaries.push(summary);
      eventMemory.small_summary_layer = Math.max(Number(eventMemory.small_summary_layer) || 0, bounds.endLayer);
    } else {
      summary.startLayer = bounds.startLayer;
      summary.endLayer = bounds.endLayer;
      summary.sourceRefs = clone(summaryAudit.refs);
      summary.sourceDigest = summaryDigest;
      summary.content = extracted.smallSummary;
      summary.status = 'valid';
      summary.revision = Math.max(1, Number(summary.revision) || 1) + 1;
    }
    data().saveState(replayTimeline(state));
    return true;
  }

  async function repairSmallSummary(summaryId) {
    let state = data().loadState(), eventMemory = ensureEventState(state);
    let summary = eventMemory.small_summaries.find(item => item.id === summaryId);
    if (!summary || summary.status !== 'stale') return false;
    const api = timelineApi(), audit = api?.auditRefs?.(summary.sourceRefs);
    if (!audit?.refs?.length) {
      const index = eventMemory.small_summaries.findIndex(item => item.id === summaryId);
      if (index >= 0) {
        eventMemory.small_summaries.splice(index, 1);
        if (index < eventMemory.big_summary_cursor) eventMemory.big_summary_cursor--;
      }
      data().saveState(state);
      return true;
    }
    const conversation = api?.refsToConversation?.(summary.sourceRefs) || '';
    if (!conversation) return false;
    const bounds = sourceBounds(audit.refs, summary.endLayer);
    const extracted = await requestTasks({ small: {
      startLayer: bounds.startLayer,
      endLayer: bounds.endLayer,
      conversation
    } }, { baseState: state });

    state = data().loadState();
    eventMemory = ensureEventState(state);
    summary = eventMemory.small_summaries.find(item => item.id === summaryId);
    if (!summary) return false;
    summary.startLayer = bounds.startLayer;
    summary.endLayer = bounds.endLayer;
    summary.sourceRefs = clone(audit.refs);
    summary.sourceDigest = api?.digestRefs?.(audit.refs) || '';
    summary.content = extracted.smallSummary;
    summary.status = 'valid';
    summary.revision = Math.max(1, Number(summary.revision) || 1) + 1;
    data().saveState(state);
    return true;
  }

  async function repairBigSummary(overviewId) {
    let state = data().loadState(), eventMemory = ensureEventState(state);
    let overview = eventMemory.big_summaries.find(item => item.id === overviewId);
    if (!overview || overview.status !== 'stale') return false;
    const children = (overview.childIds || []).map(id => eventMemory.small_summaries.find(item => item.id === id)).filter(Boolean);
    if (!children.length) {
      eventMemory.big_summaries = eventMemory.big_summaries.filter(item => item.id !== overviewId);
      data().saveState(state);
      return true;
    }
    if (children.some(item => item.status !== 'valid')) return false;
    const api = timelineApi();
    const extracted = await requestTasks({ big: { summaries: children } }, { baseState: state });

    state = data().loadState();
    eventMemory = ensureEventState(state);
    overview = eventMemory.big_summaries.find(item => item.id === overviewId);
    if (!overview) return false;
    overview.content = extracted.bigSummary;
    overview.childIds = children.map(item => item.id);
    overview.startLayer = Number(children[0]?.startLayer) || 0;
    overview.endLayer = Number(children.at(-1)?.endLayer) || 0;
    overview.sourceRefs = api?.unionRefs?.(children.map(item => item.sourceRefs || [])) || [];
    overview.childDigest = api?.hashText?.(children.map(item => `${item.id}:${item.revision || 1}:${item.sourceDigest || ''}`).join('|')) || '';
    overview.status = 'valid';
    overview.revision = Math.max(1, Number(overview.revision) || 1) + 1;
    data().saveState(state);
    return true;
  }

  async function reconcileHistory() {
    if (reconciling || running || backfillRunning || settings().engineEnabled === false) return { skipped: true };
    reconciling = true;
    let announced = false;
    const auditReport = newHistoryAuditReport();
    try {
      let state = data().loadState();
      // 一旦来源失效，立即从 Root 重放并排除 stale 节点；即使后续 API
      // 修复失败，旧人物/实体贡献也不会继续进入注入。
      const sourcesChanged = auditStoredSources(state, auditReport);
      const summaryCursorChanged = rewindSummaryCursorForDeletedLayers(state, auditReport);
      if (sourcesChanged || summaryCursorChanged) {
        state = replayTimeline(state);
        data().saveState(state);
      }
      const timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
      const needsRepair = timeline.nodes.some(node => node.status === 'stale')
        || eventMemory.small_summaries.some(item => item.status === 'stale')
        || eventMemory.big_summaries.some(item => item.status === 'stale');
      if (!needsRepair) {
        applyInjection();
        return { repaired: false };
      }
      runningLabel = '历史记忆对账';
      setExternalStatus(historyAuditMessage(auditReport, 'detected'));
      window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(true, runningLabel);
      announced = true;

      for (const node of ensureTimelineState(data().loadState()).nodes.slice()) {
        if (node.status !== 'stale') continue;
        const current = data().loadState();
        const currentEvent = ensureEventState(current);
        const nodeSourceDigest = clean(node.sourceDigest)
          || timelineApi()?.digestRefs?.(node.sourceRefs || []) || '';
        const pairedSummary = nodeSourceDigest ? currentEvent.small_summaries.find(summary => {
          if (summary.status !== 'stale') return false;
          const summaryDigest = clean(summary.sourceDigest)
            || timelineApi()?.digestRefs?.(summary.sourceRefs || []) || '';
          return summaryDigest === nodeSourceDigest;
        }) : null;
        const repairedTogether = pairedSummary
          ? await repairMemoryAndSmall(node.id, pairedSummary.id)
          : false;
        if (!repairedTogether) await repairMemoryNode(node.id);
      }
      state = data().loadState();
      auditStoredSources(state);
      data().saveState(state);
      for (const summary of ensureEventState(data().loadState()).small_summaries.slice()) {
        if (summary.status === 'stale') await repairSmallSummary(summary.id);
      }
      state = data().loadState();
      auditStoredSources(state);
      data().saveState(state);
      for (const overview of ensureEventState(data().loadState()).big_summaries.slice()) {
        if (overview.status === 'stale') await repairBigSummary(overview.id);
      }
      state = data().loadState();
      auditStoredSources(state);
      data().saveState(state);
      const finalTimeline = ensureTimelineState(state), finalEventMemory = ensureEventState(state);
      const unresolved = finalTimeline.nodes.some(node => node.status === 'stale')
        || finalEventMemory.small_summaries.some(item => item.status === 'stale')
        || finalEventMemory.big_summaries.some(item => item.status === 'stale');
      if (unresolved) throw new Error('仍有相关记忆或纪要未能重建');
      applyInjection();
      setExternalStatus(historyAuditMessage(auditReport, 'success'));
      return { repaired: true };
    } catch (error) {
      const state = data().loadState();
      auditStoredSources(state, auditReport);
      data().saveState(replayTimeline(state));
      applyInjection(); // 失效摘要不注入，正文会恢复，避免信息洞。
      setExternalStatus(historyAuditMessage(auditReport, 'failed', error), true);
      throw error;
    } finally {
      reconciling = false;
      runningLabel = '';
      if (announced) window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(false, '');
    }
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

  async function prepareHistoryForGeneration() {
    if (settings().engineEnabled === false) return { invalidated: false };
    const auditReport = newHistoryAuditReport();
    let state = data().loadState();
    const sourcesChanged = auditStoredSources(state, auditReport);
    const summaryCursorChanged = rewindSummaryCursorForDeletedLayers(state, auditReport);
    if (sourcesChanged || summaryCursorChanged) {
      state = replayTimeline(state);
      data().saveState(state);
    }
    // stale 纪要/总述不会再注入；其来源正文（例如第 3、4 楼）会从隐藏集合移除。
    applyInjection();
    await hiddenSyncPromise;
    return { invalidated: sourcesChanged || summaryCursorChanged };
  }

  function selectHiddenMessageIds(coveredRefs, currentChatId, recentMessageIds) {
    const recent = recentMessageIds instanceof Set ? recentMessageIds : new Set(recentMessageIds || []);
    return new Set((coveredRefs || [])
      .filter(ref => clean(ref?.chatId) === clean(currentChatId))
      .map(ref => clean(ref?.messageId))
      .filter(messageId => messageId && !recent.has(messageId)));
  }

  function recentRawRoundMessageIds(messages, roundCount, st, api) {
    const source = Array.isArray(messages) ? messages : [];
    const take = Math.max(0, parseInt(roundCount) || 0);
    if (!source.length || !take) return new Set();
    const opening = ignoreFirstLayer(st);
    const aiLayers = source.map((message, index) => (
      !message?.is_user && !(opening && index === 0) ? index : -1
    )).filter(index => index >= 0);
    const start = aiLayers.length > take ? aiLayers[aiLayers.length - take - 1] + 1 : 0;
    return new Set(source.slice(start)
      .map(message => clean(api?.ensureMessageId?.(message)))
      .filter(Boolean));
  }

  function syncHiddenMessages(messageIds, label) {
    try {
      hiddenSyncPromise = Promise.resolve(timelineApi()?.syncHidden?.(messageIds))
        .catch(error => console.warn(`[记忆引擎] ${label}`, error));
    } catch (error) {
      console.warn(`[记忆引擎] ${label}`, error);
      hiddenSyncPromise = Promise.resolve();
    }
    return hiddenSyncPromise;
  }

  function applyInjection(options) {
    const st = settings();
    if (st.engineEnabled === false || st.injectIntoPrompt === false) {
      clearInjection();
      syncHiddenMessages(new Set(), '恢复正文失败');
      return '';
    }
    const state = (options?.isReroll && data().loadCheckpoint()) || data().loadState();
    ensureEntityState(state);
    const eventMemory = ensureEventState(state);
    const hasPeople = Boolean(state?.personal_memory?.length);
    const hasEntities = ENTITY_TYPES.some(type => state.entity_memory[type].length);
    const hasEvents = Boolean(eventMemory.big_summaries.length || eventMemory.small_summaries.length);
    if (!hasPeople && !hasEntities && !hasEvents) {
      clearInjection();
      syncHiddenMessages(new Set(), '恢复正文失败');
      return '';
    }
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
    const sections = [], globalSeen = new Set(), limit = Math.max(1, parseInt(st.maxPerCharacter) || 20);
    const bigLimit = Math.max(1, parseInt(st.bigSummaryInjectLimit) || 3);
    const validBig = eventMemory.big_summaries.filter(item => item.status !== 'stale' && item.status !== 'failed');
    const recentBig = validBig.slice(-bigLimit);
    if (recentBig.length) {
      sections.push(`【故事总述】\n${recentBig.map(item =>
        `- [楼层 ${item.startLayer}-${item.endLayer}] ${item.content}`
      ).join('\n')}`);
    }
    const coveredChildIds = new Set(recentBig.flatMap(item => item.childIds || []));
    const hasStructuredOverview = eventMemory.big_summaries.some(item => Array.isArray(item.childIds) && item.childIds.length);
    const pendingSmall = eventMemory.small_summaries.filter((item, index) => {
      if (item.status === 'stale' || item.status === 'failed') return false;
      // 新结构按 childIds 精确判断；旧数据没有 childIds 时继续兼容游标。
      if (hasStructuredOverview) return !coveredChildIds.has(item.id);
      return index >= eventMemory.big_summary_cursor;
    });
    if (pendingSmall.length) {
      sections.push(`【近期事件纪要】\n${pendingSmall.map(item =>
        `- [楼层 ${item.startLayer}-${item.endLayer}] ${item.content}`
      ).join('\n')}`);
    }
    for (const character of matched) {
      const records = [];
      for (const name of character.names || []) records.push(...(state.knowledge_index[normalized(name)] || []));
      const candidates = records.filter(record => {
        const key = `${record.ownerId}\u0000${record.time}\u0000${record.memory}`;
        return !globalSeen.has(key);
      }).filter((record, index, list) => list.findIndex(other =>
        other.ownerId === record.ownerId && other.time === record.time && other.memory === record.memory
      ) === index);
      const selected = exponentialMemorySample(candidates, limit, Math.random, st.injectionDiceSides);
      selected.forEach(record => globalSeen.add(`${record.ownerId}\u0000${record.time}\u0000${record.memory}`));
      if (selected.length) sections.push(`【${character.names?.[0] || character.id}】\n` +
        selected.map(record => `- [${record.time || '时间未明'}] ${record.memory}`).join('\n'));
    }
    if (matchedEntities.length) {
      const entitySections = matchedEntities.map(({ type, entity }) => {
        const lines = [`【${ENTITY_LABELS[type]}：${entity.name}】`, entity.description];
        const history = exponentialMemorySample(
          Array.isArray(entity.history) ? entity.history : [], limit, Math.random, st.injectionDiceSides
        );
        if (history.length) lines.push(...history.map(entry => `- [${entry.time || '时间未明'}] ${entry.event}`));
        return lines.filter(Boolean).join('\n');
      });
      sections.push(`【相关世界实体】\n${entitySections.join('\n\n')}`);
    }
    const coveredRefs = timelineApi()?.unionRefs?.([
      ...recentBig.map(item => item.sourceRefs || []),
      ...pendingSmall.map(item => item.sourceRefs || [])
    ]) || [];
    const api = timelineApi();
    const recentMessageIds = recentRawRoundMessageIds(
      chat(), RECENT_RAW_ROUND_COUNT, st, api
    );
    const coveredMessageIds = selectHiddenMessageIds(
      coveredRefs, data()?.getChatId?.(), recentMessageIds
    );
    syncHiddenMessages(coveredMessageIds, '同步正文覆盖失败');
    if (!sections.length) { clearInjection(); return ''; }
    const content = `${SENTINEL}\n事件总结记录对话中已经发生的剧情；人物条目是当前场景人物持有或明确知晓的主观记忆，允许彼此矛盾；实体条目记录相关组织、物件、能力与地点的当前描述和本地历史。\n\n${sections.join('\n\n')}`;
    registerInjection(content);
    return content;
  }

  function buildWorldEngineContext(worldState) {
    const st = settings();
    if (st.engineEnabled === false || st.injectIntoWorldEngine !== true || !worldState) return '';
    const state = data().loadState();
    ensureEntityState(state);
    if (!state.knowledge_index || !Object.keys(state.knowledge_index).length) rebuildKnowledgeIndex(state);
    const scan = JSON.stringify(worldState);
    const appears = name => name && scan.includes(String(name));
    const limit = Math.max(1, parseInt(st.worldEngineMemoryLimit) || 5);
    const sections = [], seenRecords = new Set();
    for (const character of state.personal_memory || []) {
      if (!(character.names || []).some(appears)) continue;
      const records = [];
      for (const name of character.names || []) records.push(...(state.knowledge_index[normalized(name)] || []));
      const candidates = records.filter(record => {
        const key = `${record.ownerId}\u0000${record.time}\u0000${record.memory}`;
        if (seenRecords.has(key)) return false;
        return true;
      }).filter((record, index, list) => list.findIndex(other =>
        other.ownerId === record.ownerId && other.time === record.time && other.memory === record.memory
      ) === index);
      const selected = exponentialMemorySample(candidates, limit, Math.random, st.injectionDiceSides);
      selected.forEach(record => seenRecords.add(`${record.ownerId}\u0000${record.time}\u0000${record.memory}`));
      if (selected.length) sections.push(`【人物：${character.names?.[0] || character.id}】\n` +
        selected.map(record => `- [${record.time || '时间未明'}] ${record.memory}`).join('\n'));
    }
    for (const type of ENTITY_TYPES) {
      for (const entity of state.entity_memory[type] || []) {
        if (!appears(entity.name)) continue;
        const lines = [`【${ENTITY_LABELS[type]}：${entity.name}】`];
        if (entity.description) lines.push(entity.description);
        lines.push(...exponentialMemorySample(
          Array.isArray(entity.history) ? entity.history : [], limit, Math.random, st.injectionDiceSides
        )
          .map(entry => `- [${entry.time || '时间未明'}] ${entry.event}`));
        sections.push(lines.join('\n'));
      }
    }
    if (!sections.length) return '';
    return `【记忆引擎提供的相关人物与实体信息】\n以下信息只用于辅助世界推演；不包含纪要或总述。\n\n${sections.join('\n\n')}`;
  }

  async function ingestWorldEvolution(payload) {
    const worldSettings = window.WORLD_ENGINE_API?.getSettings?.(true) || {};
    if (worldSettings.memoryLinkEnabled !== true) return { skipped: true, reason: 'disabled' };
    const st = settings();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭，无法执行世界联动');
    if (backfillRunning) throw new Error('记忆引擎正在批量重填，暂不能执行世界联动');
    const layer = Number.isFinite(Number(payload?.layer)) ? Number(payload.layer) : currentLayer();
    // 普通记忆提取先开始时，等待它完整落库；不得并发读取同一基底后互相覆盖。
    const deadline = Date.now() + Math.max(10000, Number(st.apiTimeoutMs) || 120000);
    while (running && Date.now() < deadline) await delay(100);
    if (running) throw new Error('等待当前记忆任务结束超时');
    let checkpoint = ensureLinkCheckpoint(layer, data().loadState());
    if (payload?.replace === true && checkpoint && checkpoint.rolledBack !== true) {
      data().saveState(checkpoint.baseState);
      data().saveLinkCheckpoint({ ...checkpoint, rolledBack: true });
      checkpoint = data().loadLinkCheckpoint();
    }

    const digest = clean(payload?.worldDigest);
    if (!digest) return { skipped: true, reason: 'empty_digest' };
    const sourceKey = `${data().getChatId()}:${layer}`;
    const worldInfo = payload?.worldUpdate && typeof payload.worldUpdate === 'object'
      ? JSON.stringify(payload.worldUpdate, null, 2)
      : digest;
    const attemptBase = data().loadState();
    try {
      const result = await runTasksThenDueBig({
        memory: {
          conversation: `【世界引擎本轮返回】\n${worldInfo}\n\n以上是客观世界信息。只更新其中明确支持的人物认知与世界实体，不得猜测任何人物知晓未公开信息。`,
          sourceKey,
          startLayer: layer,
          endLayer: layer,
          kind: 'world_link'
        }
      }, {
        layer,
        baseState: attemptBase,
        saveCheckpoint: false,
        worldDigestMinute: { layer, sourceKey, content: digest }
      });
      checkpoint = data().loadLinkCheckpoint?.();
      if (checkpoint?.layer === layer) data().saveLinkCheckpoint({ ...checkpoint, rolledBack: false });
      return result;
    } catch (error) {
      checkpoint = data().loadLinkCheckpoint?.();
      if (checkpoint?.layer === layer) {
        // 联动失败只撤销本次联动尝试；同楼层已完成的普通记忆提取仍应保留。
        data().saveState(attemptBase);
        data().saveLinkCheckpoint({ ...checkpoint, rolledBack: true });
        applyInjection();
      }
      throw error;
    }
  }

  function setBackfillStatus(current, total, message) {
    backfillStatus = { running: backfillRunning, current, total, message: message || '' };
    const element = document.getElementById('we-memory-person-backfill-status');
    if (element) element.textContent = backfillStatus.message;
  }

  function setSummaryBackfillStatus(current, total, message) {
    summaryBackfillStatus = { running: backfillRunning, current, total, message: message || '' };
    const element = document.getElementById('we-memory-summary-backfill-status');
    if (element) element.textContent = summaryBackfillStatus.message;
  }

  async function backfill() {
    if (backfillRunning || running) return;
    const st = settings(), all = chat();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const configuredEnd = Math.max(0, parseInt(st.backfillEndLayer) || 0);
    const end = Math.min(all.length - 1, configuredEnd || all.length - 1);
    const opening = ignoreFirstLayer(st);
    const aiLayers = all.map((message, index) => (!message?.is_user && index <= end && !(opening && index === 0) ? index : -1)).filter(i => i >= 0);
    const size = Math.max(1, parseInt(st.backfillBatchSize) || 5), batches = [];
    for (let i = 0; i < aiLayers.length; i += size) batches.push(aiLayers.slice(i, i + size));
    if (!batches.length) { setBackfillStatus(0, 0, '没有可重填的 AI 楼层'); return; }
    backfillRunning = true;
    window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.createSnapshot?.('记忆重填前自动备份');
    const original = data().loadState();
    data().saveCheckpoint(original);
    data().saveState({
      ...original,
      personal_memory: [],
      knowledge_index: {},
      entity_memory: { organization: [], object: [], ability: [], location: [] },
      entity_index: {},
      round: 0,
      chatLayer: null,
      timeline: null
    });
    try {
      for (let i = 0; i < batches.length && backfillRunning; i++) {
        const layers = batches[i], start = Math.max(0, layers[0] - 1), finish = layers.at(-1);
        setBackfillStatus(i, batches.length, `正在重填 ${i + 1} / ${batches.length}`);
        await extractConversation(formatMessages(all.slice(start, finish + 1), start), {
          startLayer: start,
          endLayer: finish,
          sourceRefs: timelineApi()?.captureRange?.(start, finish) || [],
          layer: finish, retries: st.backfillRetries, saveCheckpoint: true, allowWhileBackfill: true
        });
      }
      setBackfillStatus(batches.length, batches.length, backfillRunning ? '记忆重填完成' : '记忆重填已停止');
    } catch (error) {
      setBackfillStatus(backfillStatus.current, batches.length, `重填失败：${error?.message || error}`);
      throw error;
    } finally { backfillRunning = false; backfillStatus.running = false; applyInjection(); }
  }

  async function backfillSummaries() {
    if (backfillRunning || running) return;
    const st = settings(), all = chat();
    if (st.engineEnabled === false) throw new Error('记忆引擎已关闭');
    const configuredEnd = Math.max(0, parseInt(st.backfillEndLayer) || 0);
    const end = Math.min(all.length - 1, configuredEnd || all.length - 1);
    const opening = ignoreFirstLayer(st);
    const aiLayers = all.map((message, index) => (!message?.is_user && index <= end && !(opening && index === 0) ? index : -1)).filter(index => index >= 0);
    const size = Math.max(1, parseInt(st.summaryBackfillSmallEveryX) || 5), batches = [];
    for (let i = 0; i < aiLayers.length; i += size) batches.push(aiLayers.slice(i, i + size));
    if (!batches.length) { setSummaryBackfillStatus(0, 0, '没有可重填的 AI 楼层'); return; }
    backfillRunning = true;
    window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.createSnapshot?.('纪要与总述重填前自动备份');
    const original = data().loadState();
    data().saveCheckpoint(original);
    data().saveState({
      ...original,
      event_memory: { small_summaries: [], big_summaries: [], small_summary_layer: null, big_summary_cursor: 0 }
    });
    try {
      for (let i = 0; i < batches.length && backfillRunning; i++) {
        const layers = batches[i], firstAi = layers[0], finish = layers.at(-1);
        const start = firstAi > 0 && all[firstAi - 1]?.is_user ? firstAi - 1 : firstAi;
        const smallTask = {
          startLayer: start,
          endLayer: finish,
          conversation: formatMessages(all.slice(start, finish + 1), start),
          sourceRefs: timelineApi()?.captureRange?.(start, finish) || []
        };
        const state = data().loadState();
        setSummaryBackfillStatus(i, batches.length, `正在重填纪要与总述 ${i + 1} / ${batches.length}`);
        await runTasksThenDueBig({ small: smallTask }, {
          baseState: state, retries: st.backfillRetries, saveCheckpoint: true, allowWhileBackfill: true
        }, st.summaryBackfillBigEveryX);
      }
      setSummaryBackfillStatus(batches.length, batches.length, backfillRunning ? '纪要与总述重填完成' : '纪要与总述重填已停止');
    } catch (error) {
      setSummaryBackfillStatus(summaryBackfillStatus.current, batches.length, `纪要与总述重填失败：${error?.message || error}`);
      throw error;
    } finally { backfillRunning = false; summaryBackfillStatus.running = false; applyInjection(); }
  }

  function stopBackfill() {
    backfillRunning = false;
    abortController?.abort();
    setBackfillStatus(backfillStatus.current, backfillStatus.total, '正在停止…');
    setSummaryBackfillStatus(summaryBackfillStatus.current, summaryBackfillStatus.total, '正在停止…');
  }

  function onMessageReceived() {
    const key = `${currentLayer()}:${clean(chat().at(-1)?.mes).slice(-80)}`;
    if (key === lastEventKey) return;
    lastEventKey = key;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => autoExtract().catch(error => console.error('[记忆引擎] 自动提取失败', error)), 1500);
  }

  function schedulePreparation(delayMs = 50) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => prepareHistoryForGeneration()
      .catch(error => console.error('[记忆引擎] 历史摘要撤旧失败', error)), delayMs);
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
    initializeSummaryBaseline();
    const ctx = context(), types = ctx?.event_types || {};
    if (ctx?.eventSource) {
      ctx.eventSource.on(types.GENERATION_ENDED || types.MESSAGE_RECEIVED || 'message_received', guardEvent('生成完成', onMessageReceived));
      ctx.eventSource.on(types.CHAT_LOADED || 'chat_loaded', guardEvent('聊天加载', () => {
        clearTimeout(autoTimer);
        abortController?.abort();
        lastEventKey = '';
        initializeSummaryBaseline();
        schedulePreparation(100);
      }));
      ctx.eventSource.on(types.MESSAGE_SWIPED || 'message_swiped', guardEvent('滑动重生成', () => {
        clearTimeout(autoTimer);
        abortController?.abort();
        if (!rollbackLinkedLayer(currentLayer())) applyInjection({ isReroll: true });
        schedulePreparation(50);
      }));
      ctx.eventSource.on(types.MESSAGE_DELETED || 'message_deleted', guardEvent('删除消息', () => {
        clearTimeout(autoTimer);
        abortController?.abort();
        lastEventKey = '';
        schedulePreparation(50);
      }));
      ctx.eventSource.on(types.GENERATION_STARTED || 'generation_started', guardEvent('生成开始', (type, _opts, dryRun) => {
        if (!dryRun) applyInjection({ isReroll: type === 'swipe' || type === 'regenerate' });
      }));
    }
    try { applyInjection(); }
    catch (error) { console.error('[记忆引擎] 首次注入失败', error); }
  }

  return {
    init, applyInjection, buildWorldEngineContext, ingestWorldEvolution, manualExtract, manualReextract, extractNow: manualExtract,
    reconcileHistory, prepareHistoryForGeneration, replayTimeline, commitManualState,
    manualSmallSummary, manualBigSummary,
    backfill, backfillSummaries, stopBackfill, abort,
    repairStateIndexes, replaceKnownByRecords,
    getLastDebug: () => clone(lastDebug), getBackfillStatus: () => clone(backfillStatus),
    getSummaryBackfillStatus: () => clone(summaryBackfillStatus),
    getRunningLabel: () => runningLabel,
    isRunning: () => running || backfillRunning || reconciling,
    _test: {
      exponentialMemorySample, rollbackLinkedLayer, rewindSummaryCursorForDeletedLayers,
      buildSmallHistoryContext, parseResponse, selectHiddenMessageIds, recentRawRoundMessageIds
    }
  };
})();
