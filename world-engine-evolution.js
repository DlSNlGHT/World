// world-engine-evolution.js — 世界推演 API 调用（使用完整活体引擎规则）
window.WORLD_ENGINE_EVOLUTION = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const api = window.WORLD_ENGINE_API;

  const EVENT_TYPES = ['conflict', 'progress'];
  const EVENT_STAGE_ORDER = {
    conflict: ['萌芽', '发酵', '逼近'],
    progress: ['筹备', '执行', '关键']
  };
  const EVENT_FINAL_STAGE = {
    conflict: '已爆发',
    progress: '已完成'
  };
  const EVENT_TERMINAL_STAGES = {
    conflict: ['已爆发', '已消散'],
    progress: ['已完成', '已失败']
  };
  const EVENT_STAGE_BASE = {
    conflict: { '萌芽': 95, '发酵': 85, '逼近': 75 },
    progress: { '筹备': 75, '执行': 85, '关键': 95 }
  };
  const EVENT_STAGE_MACHINE_CONFIG = {
    typeField: 'type',
    defaultType: 'conflict',
    order: EVENT_STAGE_ORDER,
    finalStage: EVENT_FINAL_STAGE,
    terminalStages: EVENT_TERMINAL_STAGES,
    progressField: 'stageRound',
    progressMax: 9
  };
  const WIND_DECAY = {
    announcement: { base: 10, grace: 4, linear: 3, quadratic: 1 },
    report: { base: 20, grace: 2, linear: 4, quadratic: 2 },
    rumor: { base: 25, grace: 1, linear: 5, quadratic: 3 },
    sentiment: { base: 8, grace: 5, linear: 2, quadratic: 1 }
  };

  // ========== [移植 v2.4.1] 本地机制调参读取 ==========
  //   设置缺失/非法时回退到上面各常量的出厂值，行为与旧版硬编码一致。
  function localSettings() {
    return api && api.getSettings ? api.getSettings() : {};
  }

  function numSetting(key, fallback, min, max) {
    const n = Number(localSettings()[key]);
    let v = Number.isFinite(n) ? n : fallback;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function intSetting(key, fallback, min, max) {
    return Math.round(numSetting(key, fallback, min, max));
  }

  function capSetting(key, fallback) {
    return intSetting(key, fallback, 1);
  }

  // 风声消散表：按类型读取用户调参，缺省回退 WIND_DECAY 出厂值
  function tunedWindDecayTable() {
    const table = {};
    const prefixes = {
      announcement: 'localWindAnnouncement',
      report: 'localWindReport',
      rumor: 'localWindRumor',
      sentiment: 'localWindSentiment'
    };
    for (const type of Object.keys(WIND_DECAY)) {
      const d = WIND_DECAY[type];
      const p = prefixes[type];
      table[type] = {
        base: numSetting(p + 'Base', d.base, 0, 95),
        grace: intSetting(p + 'Grace', d.grace, 0),
        linear: numSetting(p + 'Linear', d.linear, 0),
        quadratic: numSetting(p + 'Quadratic', d.quadratic, 0)
      };
    }
    return table;
  }

  let _lastPrompt = '';
  let _lastRawResult = '';
  let _lastPromptSegments = [];

  function getLastDebug() {
    return { prompt: _lastPrompt, rawResult: _lastRawResult, segments: _lastPromptSegments };
  }

  // ========== 区域突发事件骰子系统 ==========

  const REGIONAL_INCIDENT_CONFIG = {
    chance: 0.03,
    durationRounds: 5,
    cooldownRounds: 5,
    typeWeights: [
      { type: 'banditry', label: '盗匪劫掠', weight: 18 },
      { type: 'fire', label: '大火', weight: 14 },
      { type: 'massacre', label: '恶性凶案', weight: 10 },
      { type: 'flood', label: '洪涝', weight: 10 },
      { type: 'infrastructure', label: '道路水利崩坏', weight: 10 },
      { type: 'plague', label: '疫病', weight: 9 },
      { type: 'famine', label: '饥荒粮荒', weight: 8 },
      { type: 'riot', label: '骚乱暴动', weight: 8 },
      { type: 'rebellion', label: '民变叛乱', weight: 5 },
      { type: 'military', label: '军务突变', weight: 4 },
      { type: 'earthquake', label: '地震山崩', weight: 2 },
      { type: 'storm', label: '风暴雪灾', weight: 2 }
    ]
  };

  const INCIDENT_TYPE_GUIDE = {
    banditry: '盗匪劫掠：山贼、水匪、流寇、贼伙、劫镖、截船、抢粮、抢盐、屠掠村寨或商队。',
    fire: '大火：坊市、粮仓、码头、寺院、官署、工坊、船队、货栈发生区域性火灾。',
    massacre: '恶性凶案：连环杀人、灭门案、客栈血案、商队被屠、码头尸案等足以引发恐慌的案件。',
    flood: '洪涝：河水暴涨、堤坝决口、码头被淹、村田被毁、桥梁被冲毁。',
    infrastructure: '道路水利崩坏：官道塌方、桥梁坍塌、渡口停摆、堤坝裂口、水闸损毁、驿路断绝。',
    plague: '疫病：人疫、畜疫、水源染病、村落封闭、码头拒载、城中高热病人暴增。',
    famine: '饥荒粮荒：粮仓见底、赈粮断供、粮价暴涨、灾民抢粮、大户闭仓、乡村断炊。',
    riot: '骚乱暴动：码头械斗、饥民抢粮、香客踩踏、盐铺被砸、关卡冲突、市井冲突扩大。',
    rebellion: '民变叛乱：流民立寨、乡兵反官、税役暴动、邪教聚众、地方叛乱。',
    military: '军务突变：守军哗变、军粮被劫、边军溃逃、敌军越境、关隘戒严、军营夜惊。',
    earthquake: '地震山崩：地震、山崩、矿山塌陷、地裂、山村被埋。',
    storm: '风暴雪灾：台风、暴雪、沙暴、寒潮、海风毁船、大风摧毁棚屋。'
  };

  // ========== Preset-aware config helper ==========

  function getRegionalConfig() {
    const preset = (window.WORLD_ENGINE_PRESETS && window.WORLD_ENGINE_PRESETS.getActivePreset)
      ? window.WORLD_ENGINE_PRESETS.getActivePreset()
      : null;
    if (preset && preset.regionalIncidents) {
      const presetTypes = Array.isArray(preset.regionalIncidents.types)
        ? preset.regionalIncidents.types
            .filter(t => t && t.type && Number(t.weight) > 0)
            .map(t => ({ ...t, weight: Number(t.weight) }))
        : [];
      return {
        chance: Number.isFinite(Number(preset.regionalIncidents.chance)) ? Number(preset.regionalIncidents.chance) : 0.03,
        durationRounds: Number.isFinite(Number(preset.regionalIncidents.durationRounds)) ? Number(preset.regionalIncidents.durationRounds) : 5,
        cooldownRounds: Number.isFinite(Number(preset.regionalIncidents.cooldownRounds)) ? Number(preset.regionalIncidents.cooldownRounds) : 5,
        typeWeights: presetTypes.length ? presetTypes : REGIONAL_INCIDENT_CONFIG.typeWeights
      };
    }
    return REGIONAL_INCIDENT_CONFIG;
  }

  // [移植 v2.4.1·pigment 适配] 区域事件参数：用户设置 > 预设 > 内置。
  //   上游没有预设层，直接读设置；pigment 的预设可自带 regionalIncidents，
  //   故约定「设置保持出厂默认 = 跟随预设/内置」，用户改过（≠默认）才覆盖预设值。
  function tunedRegionalConfig() {
    const cfg = getRegionalConfig();
    const chancePct = numSetting('localRegionalIncidentChancePercent', 3, 0, 100);
    const duration = intSetting('localRegionalIncidentDuration', 5, 1);
    const cooldown = intSetting('localRegionalIncidentCooldown', 5, 0);
    return {
      ...cfg,
      chance: chancePct !== 3 ? chancePct / 100 : cfg.chance,
      durationRounds: duration !== 5 ? duration : cfg.durationRounds,
      cooldownRounds: cooldown !== 5 ? cooldown : cfg.cooldownRounds
    };
  }

  function ensureRegionalIncident(state) {
    if (!state.regionalIncident) {
      state.regionalIncident = {
        active: false,
        title: '',
        type: '',
        scope: '',
        impact: '',
        duration: 0,
        cooldown: 0,
        _retry: false,
        _retryType: ''
      };
    }
  }

  function getIncidentTypeLabel(type) {
    const config = tunedRegionalConfig();
    const found = config.typeWeights.find(t => t.type === type);
    return found ? found.label : type;
  }

  function buildRegionalIncidentOngoingPrompt(incident) {
    return `
【区域突发事件持续中（剩余 ${incident.duration} 轮）】
标题：${incident.title}
类型：${getIncidentTypeLabel(incident.type)}
范围：${incident.scope}
当前影响：${incident.impact}
该事件仍处于活跃期。请在本轮推演中延续其余波（经济、风声、势力行动等），不得将其写成已经平息，也不得在 regionalIncident 字段生成新事件。
`;
  }

  function weightedPick(items, randomFn = Math.random) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = randomFn() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }


  const DiceEngine = {
    rollWeighted(items, randomFn = Math.random) {
      return weightedPick(items, randomFn);
    },

    rollThreshold(config, item, randomFn = Math.random) {
      const progressField = config.progressField || 'stageRound';
      const type = item[config.typeField || 'type'] || config.defaultType || 'conflict';
      const r = Math.min(1, (item[progressField] || 1) / (config.progressMax || 9));
      const stageBaseTable = (config.base && (config.base[type] || config.base[config.defaultType])) || {};
      const stageBase = stageBaseTable[item.stage] || config.defaultBase || 85;
      const level = item[config.levelField || 'level'] || 1;
      const levelAdjust = typeof config.levelAdjust === 'function'
        ? config.levelAdjust(item, level, type)
        : 0;
      const curve = typeof config.curve === 'function'
        ? config.curve(r)
        : 200 * r * (1 - r);
      // [移植 v2.4.1] thresholdModifier：全局推进修正（正值降低目标值=更易推进），可选，默认 0
      const modifier = Number.isFinite(Number(config.thresholdModifier)) ? Number(config.thresholdModifier) : 0;
      const threshold = Math.round(stageBase - curve + levelAdjust - modifier);
      const dice = Math.floor(randomFn() * 100) + 1;
      const setbackRatio = Number.isFinite(Number(config.setbackRatio)) ? Number(config.setbackRatio) : 0.4;
      if (dice > threshold) return { kind: 'success', dice, threshold };
      if (dice < threshold * setbackRatio) return { kind: 'setback', dice, threshold };
      return { kind: 'hold', dice, threshold };
    },

    rollDecay(config, item, randomFn = Math.random) {
      const table = config.table || {};
      const type = item[config.byTypeField || 'type'];
      const params = table[type] || table[config.defaultType] || {};
      const levelField = config.levelField || 'level';
      const quietField = config.quietField || 'quietRounds';
      const level = Math.min(4, Math.max(1, parseInt(item[levelField]) || 1));
      item[quietField] = Math.max(0, parseInt(item[quietField]) || 0) + 1;

      if (item[quietField] <= params.grace) {
        return { kind: 'grace', decayed: false, quietRounds: item[quietField] };
      }

      const n = item[quietField] - params.grace - 1;
      const chance = Math.min(95, Math.max(5,
        params.base + params.linear * n + params.quadratic * n * n - (level - 1) * 10
      ));
      const dice = Math.floor(randomFn() * 100) + 1;
      return { kind: dice <= chance ? 'decay' : 'survive', decayed: dice <= chance, dice, chance, quietRounds: item[quietField] };
    },

    rollTrigger(config, incident, randomFn = Math.random) {
      const typeWeights = Array.isArray(config.typeWeights) ? config.typeWeights : [];
      const chance = Number.isFinite(Number(config.chance)) ? Number(config.chance) : 0;
      const durationRounds = Number.isFinite(Number(config.durationRounds)) ? Number(config.durationRounds) : 0;
      const cooldownRounds = Number.isFinite(Number(config.cooldownRounds)) ? Number(config.cooldownRounds) : 0;

      if (incident.active) {
        const remaining = Math.max(0, (incident.duration || 0) - 1);
        if (remaining <= 0) {
          return {
            kind: 'expired',
            triggered: false,
            expiredTitle: incident.title,
            patch: {
              active: false,
              title: '',
              type: '',
              scope: '',
              impact: '',
              duration: 0,
              cooldown: cooldownRounds,
              _retry: false,
              _retryType: ''
            }
          };
        }
        return {
          kind: 'ongoing',
          triggered: true,
          ongoing: true,
          patch: { duration: remaining }
        };
      }

      if ((incident.cooldown || 0) > 0) {
        return {
          kind: 'cooldown',
          triggered: false,
          patch: { cooldown: Math.max(0, incident.cooldown - 1) }
        };
      }

      const dice = randomFn();
      let triggerNow = false;
      let triggerType = incident._retryType || '';
      let triggerLabel = '';
      const patch = {};

      if (incident._retry && triggerType) {
        triggerNow = true;
        patch._retry = false;
        patch._retryType = '';
        const found = typeWeights.find(t => t.type === triggerType);
        if (found) triggerLabel = found.label;
      }

      if (!triggerNow && dice >= chance) {
        return {
          kind: 'miss',
          triggered: false,
          chance,
          dice,
          patch: {
            active: false,
            title: '',
            type: '',
            scope: '',
            impact: ''
          }
        };
      }

      if (!triggerNow) {
        const picked = DiceEngine.rollWeighted(typeWeights, randomFn);
        triggerType = picked.type;
        triggerLabel = picked.label;
      }

      return {
        kind: triggerNow ? 'retry' : 'hit',
        triggered: true,
        ongoing: false,
        incidentType: triggerType,
        incidentLabel: triggerLabel,
        chance,
        dice,
        patch: {
          ...patch,
          active: true,
          type: triggerType,
          duration: durationRounds,
          cooldown: 0
        }
      };
    }
  };

  const StageMachine = {
    getType(config, item) {
      const type = item && item[config.typeField];
      return (type && config.order[type]) ? type : config.defaultType;
    },

    normalizeType(config, item) {
      if (!item[config.typeField] || !config.order[item[config.typeField]]) {
        item[config.typeField] = config.defaultType;
      }
      return item[config.typeField];
    },

    getOrder(config, type) {
      return config.order[type] || config.order[config.defaultType] || [];
    },

    getFinalStage(config, type) {
      return config.finalStage[type] || config.finalStage[config.defaultType];
    },

    getTerminalStages(config, type) {
      return config.terminalStages[type] || config.terminalStages[config.defaultType] || [];
    },

    normalize(config, item) {
      const type = StageMachine.normalizeType(config, item);
      const progressField = config.progressField;
      if (item[progressField] === undefined) item[progressField] = 1;
      const order = StageMachine.getOrder(config, type);
      if (!item.stage || !order.includes(item.stage)) item.stage = order[0];
      return item;
    },

    isTerminal(config, item) {
      const type = StageMachine.getType(config, item);
      return StageMachine.getTerminalStages(config, type).includes(item.stage);
    },

    isAtFinalStage(config, item, type) {
      return item.stage === StageMachine.getFinalStage(config, type);
    },

    advance(config, item, options = {}) {
      const type = StageMachine.getType(config, item);
      const order = StageMachine.getOrder(config, type);
      const finalStage = StageMachine.getFinalStage(config, type);
      const progressField = config.progressField;
      const progressMax = config.progressMax;
      item[progressField]++;
      if (item[progressField] >= progressMax) {
        const idx = order.indexOf(item.stage);
        if (idx !== -1 && idx < order.length - 1) {
          item.stage = order[idx + 1];
          item[progressField] = options.carryOverflow ? item[progressField] - progressMax : 1;
        } else {
          item.stage = finalStage;
          item[progressField] = progressMax;
        }
      }
      return item;
    },

    resolveProgressOverflow(config, item, options = {}) {
      const type = StageMachine.getType(config, item);
      const order = StageMachine.getOrder(config, type);
      const finalStage = StageMachine.getFinalStage(config, type);
      const progressField = config.progressField;
      const progressMax = config.progressMax;
      if (item[progressField] >= progressMax) {
        const idx = order.indexOf(item.stage);
        if (idx !== -1 && idx < order.length - 1) {
          item.stage = order[idx + 1];
          item[progressField] = options.carryOverflow ? item[progressField] - progressMax : 1;
        } else {
          item.stage = finalStage;
          item[progressField] = progressMax;
        }
      }
      return item;
    },

    recede(config, item) {
      const progressField = config.progressField;
      item[progressField] = Math.max(1, item[progressField] - 1);
      return item;
    }
  };

  // 出厂默认（同时是测试基准与调参回退值）。运行时请经 getLifecycleConfigs() 取调参后的版本。
  const LIFECYCLE_CONFIGS = {
    enemies: { cap: 8, terminalField: 'status', terminalRetain: ['已终结'], retainRounds: 20, sinceField: '_terminalSince', sinceDefault: 'falsy' },
    influence: { cap: 12, createdField: '_createdRound', expireRounds: 8, roundOffset: 1 },
    events: {
      terminalField: 'stage',
      terminalRemove: ['已消散', '已失败'],
      terminalRetain: ['已爆发', '已完成'],
      retainRounds: function (item) { return 2 + (item.level || 1) * 2; },
      sinceField: '_terminalSince',
      sinceDefault: 'undefined',
      clearSinceWhenActive: true
    },
    trends: { terminalField: 'status', terminalRemove: ['已结束'] },
    economySignals: { cap: 8 },
    blackbox: { totalCap: 12, buckets: ['secretActions', 'secretAssets'] }
  };

  // [移植 v2.4.1] 保留轮数/容量上限调参：在出厂配置上套用户设置（缺省回退出厂值）
  function getLifecycleConfigs() {
    return {
      ...LIFECYCLE_CONFIGS,
      enemies: {
        ...LIFECYCLE_CONFIGS.enemies,
        cap: capSetting('localCapEnemies', 8),
        retainRounds: intSetting('localEnemyTerminalKeepRounds', 20, 1)
      },
      influence: {
        ...LIFECYCLE_CONFIGS.influence,
        cap: capSetting('localCapInfluence', 12),
        expireRounds: intSetting('localInfluenceKeepRounds', 8, 1)
      },
      events: {
        ...LIFECYCLE_CONFIGS.events,
        retainRounds: function (item) {
          return intSetting('localTerminalBaseKeepRounds', 2, 0)
            + (item.level || 1) * intSetting('localTerminalLevelKeepRounds', 2, 0);
        }
      },
      economySignals: { cap: capSetting('localCapEconomySignals', 8) },
      blackbox: { ...LIFECYCLE_CONFIGS.blackbox, totalCap: capSetting('localCapBlackbox', 12) }
    };
  }

  const Lifecycle = {
    capList(list, cap) {
      if (Array.isArray(list) && Number.isFinite(Number(cap)) && list.length > cap) list.length = cap;
      return list;
    },

    pruneExpired(list, config, currentRound) {
      const source = Array.isArray(list) ? list : [];
      const completedRound = currentRound + (config.roundOffset || 0);
      const createdField = config.createdField || '_createdRound';
      const kept = source.filter(item => {
        if (!item || typeof item !== 'object') return false;
        if (item[createdField] === undefined) item[createdField] = currentRound;
        return (completedRound - item[createdField]) < config.expireRounds;
      });
      return { items: kept, removed: source.filter(item => !kept.includes(item)) };
    },

    pruneTerminal(list, config, currentRound) {
      const source = Array.isArray(list) ? list : [];
      const terminalField = config.terminalField || 'status';
      const removeValues = config.terminalRemove || [];
      const retainValues = config.terminalRetain || [];
      const sinceField = config.sinceField || '_terminalSince';
      const kept = source.filter(item => {
        const value = item && item[terminalField];
        if (removeValues.includes(value)) return false;
        if (retainValues.includes(value)) {
          if (config.sinceDefault === 'falsy') {
            if (!item[sinceField]) item[sinceField] = currentRound;
          } else if (item[sinceField] === undefined) {
            item[sinceField] = currentRound;
          }
          const keepRounds = typeof config.retainRounds === 'function'
            ? config.retainRounds(item)
            : config.retainRounds;
          return (currentRound - item[sinceField]) < keepRounds;
        }
        if (config.clearSinceWhenActive && item && item[sinceField] !== undefined) delete item[sinceField];
        return true;
      });
      return { items: kept, removed: source.filter(item => !kept.includes(item)) };
    },

    capBlackbox(box, config) {
      if (!box) return box;
      const actionsKey = config.buckets[0];
      const assetsKey = config.buckets[1];
      const total = ((box[actionsKey] && box[actionsKey].length) || 0) + ((box[assetsKey] && box[assetsKey].length) || 0);
      if (total > config.totalCap) {
        const excess = total - config.totalCap;
        const actions = box[actionsKey] || [];
        const assets = box[assetsKey] || [];
        if (actions.length > excess) {
          actions.length = Math.max(1, actions.length - excess);
          box[actionsKey] = actions;
        } else {
          box[actionsKey] = [];
          assets.length = Math.max(1, assets.length - excess + actions.length);
          box[assetsKey] = assets;
        }
      }
      return box;
    }
  };

  function buildRegionalIncidentPrompt(picked) {
    const config = tunedRegionalConfig();
    const typeInfo = config.typeWeights.find(t => t.type === picked.type);
    const guide = (typeInfo && typeInfo.guide) || INCIDENT_TYPE_GUIDE[picked.type] || '';
    return `
【本地骰子强制指令：本轮必须生成区域突发事件】
本地骰子已判定：本轮触发区域突发事件。
本地骰子已指定事件类型：
类型：${picked.label}
type：${picked.type}
类型说明：${guide}
你必须根据当前世界状态，生成一个符合该类型的区域级突发事件。
事件必须满足：
1. 事件影响一个明确区域、道路、城镇、关隘、码头、寺院、市场、村落、商路或水路。
2. 事件不是小插曲，不是路人噪音，不是单人偶发事故。
3. 事件必须产生可传播的风声。
4. 事件必须造成至少一种外溢影响：经济变化、势力行动、治安变化、事件链变化、声誉变化、黑盒变化或新的影响链。
5. 事件与{{user}}当前行为没有直接因果，不得写成已有仇敌、已有势力、已有事件链的阴谋结果。
6. 事件发生地点由你根据当前世界状态选择，但必须合理，不得凭空毁灭核心舞台，不得无故摧毁{{user}}核心资产。
7. 如果事件未发生在{{user}}所在区域，不得强行打断{{user}}当前行动，只作为后台世界变化、远方消息或风声传播。
8. 如果事件发生在{{user}}所在区域，可以形成当前场景压力，但仍不得替{{user}}做选择。
9. 禁止生成马车受惊、偷情被抓、路人吵架、小偷行窃、醉汉闹事、普通邻里纠纷等低价值事件。
10. 禁止把"区域突发事件"写成某个已有势力早已策划的阴谋；除非已有状态中存在明确因果证据。
你必须返回以下 JSON 字段：
{
  "regionalIncident": {
    "active": true,
    "title": "事件标题",
    "type": "${picked.type}",
    "scope": "影响范围",
    "impact": "一句话概括区域后果"
  },
  "winds": [
    {
      "topic": "稳定主题名",
      "type": "report",
      "level": 1-4,
      "content": "正在传播的说法",
      "scope": "传播范围",
      "source": "消息来源链"
    }
  ],
  "influenceChain": [
    {
      "trigger": "区域突发事件标题",
      "impact": "已经造成的直接影响",
      "fallout": "后续余波"
    }
  ]
}
如果事件已经足以形成持续冲突或治理任务，可以额外返回 events。
如果事件影响市场、道路、水路、粮价、盐价、货运，可以额外返回 economy。
如果事件影响某个势力判断或资源，可以额外返回 factions。
如果事件影响{{user}}名声，可以额外返回 reputation。
如果事件有隐秘目击者、暗藏证据、失踪人物、未公开真相，可以额外返回 blackbox。
`;
  }

  function rollRegionalIncident(state, randomFn = Math.random) {
    ensureRegionalIncident(state);
    const incident = state.regionalIncident;
    const config = tunedRegionalConfig();
    const roll = DiceEngine.rollTrigger(config, incident, randomFn);
    Object.assign(incident, roll.patch);

    if (roll.kind === 'expired') {
      console.log('[世界引擎] 区域突发事件已消散（持续期满）:', roll.expiredTitle);
      return { triggered: false, injectPrompt: '', reason: 'expired' };
    }

    if (roll.kind === 'ongoing') {
      return {
        triggered: true,
        ongoing: true,
        injectPrompt: buildRegionalIncidentOngoingPrompt(incident),
        reason: 'ongoing'
      };
    }

    if (roll.kind === 'cooldown') {
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    if (roll.kind === 'miss') {
      return { triggered: false, injectPrompt: '', chance: roll.chance, dice: roll.dice, reason: 'miss' };
    }

    return {
      triggered: true,
      ongoing: false,
      incidentType: roll.incidentType,
      incidentLabel: roll.incidentLabel,
      injectPrompt: buildRegionalIncidentPrompt({
        type: roll.incidentType,
        label: roll.incidentLabel || roll.incidentType
      }),
      chance: roll.chance,
      dice: roll.dice,
      reason: roll.kind
    };
  }

  function mergeRegionalIncident(state, update) {
    ensureRegionalIncident(state);
    const incident = state.regionalIncident;
    const config = tunedRegionalConfig();

    // 本轮没有本地骰子触发，不接受 API 自发生成
    if (!incident.active) {
      incident.title = '';
      incident.type = '';
      incident.scope = '';
      incident.impact = '';
      incident._retry = false;
      incident._retryType = '';
      return;
    }

    // 持续中的事件（已有标题）：内容固定，不接受 API 覆盖
    if (incident.title) {
      if (update.regionalIncident) delete update.regionalIncident;
      return;
    }

    // 新触发首轮（尚无标题）：合并 API 返回的事件内容
    const duration = incident.duration || config.durationRounds;
    if (update.regionalIncident && update.regionalIncident.active) {
      state.regionalIncident = {
        active: true,
        title: update.regionalIncident.title || '未命名区域突发事件',
        type: update.regionalIncident.type || incident.type || 'other',
        scope: update.regionalIncident.scope || '未知区域',
        impact: update.regionalIncident.impact || '区域秩序受到冲击。',
        duration,
        cooldown: 0,
        _retry: false,
        _retryType: ''
      };
    } else {
      // API 没返回 → 设置重试标记，下轮继续
      state.regionalIncident = {
        active: false,
        title: '区域突发事件生成失败（将在下一轮重试）',
        type: incident.type || 'other',
        scope: '未知区域',
        impact: '本地骰子触发区域突发事件，但 API 未返回 regionalIncident。下一轮将重试同类型。',
        duration: 0,
        cooldown: 0,
        _retry: true,
        _retryType: incident.type || ''
      };
    }
  }

  // ========== 远方/近端随机事件（上游 2.5.x，pigment 预设感知适配） ==========

  function getRandomEventTargets() {
    const fallback = { event: true, wind: true };
    const loader = window.WORLD_ENGINE_RULES;
    if (!loader || typeof loader.getActiveModuleDescriptors !== 'function') return fallback;
    try {
      const descriptors = loader.getActiveModuleDescriptors() || [];
      const enabled = (id, field) => descriptors.some(descriptor =>
        descriptor && descriptor.enabled !== false && descriptor.id === id && (descriptor.field || field) === field
      );
      return { event: enabled('events', 'events'), wind: enabled('winds', 'winds') };
    } catch (e) {
      console.warn('[世界引擎] 无法读取随机事件目标模块，回退 canonical events/winds:', e);
      return fallback;
    }
  }

  function isRandomTargetAvailable(type, targets) {
    return type === 'event' ? targets.event === true : type === 'wind' ? targets.wind === true : false;
  }

  function pickRandomTarget(percentSetting, targets, randomFn = Math.random) {
    if (targets.event && !targets.wind) return 'event';
    if (!targets.event && targets.wind) return 'wind';
    if (!targets.event && !targets.wind) return '';
    const eventChance = numSetting(percentSetting, 50, 0, 100) / 100;
    return randomFn() < eventChance ? 'event' : 'wind';
  }

  function ensureDistantEvent(state) {
    if (!state.distantEvent || typeof state.distantEvent !== 'object' || Array.isArray(state.distantEvent)) {
      state.distantEvent = { pending: false, cooldown: 0, sample: [], requestedRound: 0, requestedType: '' };
    }
    const distant = state.distantEvent;
    distant.pending = distant.pending === true;
    distant.cooldown = Math.max(0, parseInt(distant.cooldown) || 0);
    distant.sample = Array.isArray(distant.sample) ? distant.sample : [];
    distant.requestedRound = Math.max(0, parseInt(distant.requestedRound) || 0);
    distant.requestedType = ['event', 'wind'].includes(distant.requestedType) ? distant.requestedType : '';
    return distant;
  }

  function sampleDistantLedger(state, randomFn = Math.random) {
    const entries = (state.memories || []).filter(memory => memory && memory.type === 'ledger');
    const recentCount = Math.floor(entries.length / 4);
    const targetCount = Math.floor(entries.length / 2);
    const recent = entries.slice(0, recentCount);
    const older = entries.slice(recentCount);
    for (let i = older.length - 1; i > 0; i--) {
      const j = Math.floor(randomFn() * (i + 1));
      [older[i], older[j]] = [older[j], older[i]];
    }
    return recent.concat(older.slice(0, Math.max(0, targetCount - recent.length))).map(entry => ({
      round: entry.round,
      changes: Array.isArray(entry.changes) ? entry.changes : []
    }));
  }

  function buildDistantEventPrompt(sample, requestedType) {
    const wantsEvent = requestedType === 'event';
    const targetText = wantsEvent ? '一条新的 events 事件链' : '一条新的 winds 风声';
    return `
【本地随机机制强制指令：本轮必须生成一条远方动态】
以下是部分历史账本，仅用于识别已经使用过的事件主题、冲突结构和风声内容。不得续写、改写、复刻或直接关联这些记录：
${JSON.stringify(sample || [], null, 2)}

本地系统已经指定本轮远方动态的类型：${wantsEvent ? '事件链 events' : '风声 winds'}。
结合当前世界状态、世界书、时代背景、地理结构和角色生态，为本次远方动态独立新增${targetText}（不影响其他已有世界状态的正常更新）。不得改成另一种类型。

强制要求：
- 新对象等级只能是 Lv2 或 Lv3。
- 新对象必须设置 "id": null，并额外设置临时标记 "_distanceGenerated": true。
- 该临时标记仅供本地确认生成成功；不得添加到其他对象，也不得与 "_nearGenerated" 同时使用。
- 与 {{user}} 的当前行为、资产、名声、仇敌及所在场景没有直接因果关系，不得强行打断 {{user}} 当前行动。
- 不得由上述账本中的既有事件、势力冲突或风声直接引发，也不得复刻其主题与结构。
- 必须扎根于当前世界观和已有世界条件，发生在合理存在的远方区域、群体或社会系统中，不能成为无因果的随机噪音。
- ${wantsEvent ? '必须满足 events 的创建与归并规则，并填写完整的新事件字段。' : '必须满足 winds 的传播规则，并填写完整的新风声字段。'}
- 本次远方动态只能有一个带 "_distanceGenerated" 标记的新对象；其他本地强制指令分别完成，不计入本机制的一个对象限制。
`;
  }

  function rollDistantEvent(state, randomFn = Math.random) {
    const distant = ensureDistantEvent(state);
    const targets = getRandomEventTargets();
    if (!targets.event && !targets.wind) return { triggered: false, injectPrompt: '', reason: 'modules-disabled' };

    const ledgerEntries = (state.memories || []).filter(memory => memory && memory.type === 'ledger');
    if (distant.pending) {
      if (!distant.sample.length && ledgerEntries.length) distant.sample = sampleDistantLedger(state, randomFn);
      if (!isRandomTargetAvailable(distant.requestedType, targets)) {
        distant.requestedType = pickRandomTarget('localDistantEventEventPercent', targets, randomFn);
      }
      return {
        triggered: true,
        retry: true,
        requestedType: distant.requestedType,
        injectPrompt: buildDistantEventPrompt(distant.sample, distant.requestedType),
        reason: 'retry'
      };
    }
    if (distant.cooldown > 0) {
      distant.cooldown = Math.max(0, distant.cooldown - 1);
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const threshold = intSetting('localDistantEventLedgerThreshold', 10, 1);
    if (ledgerEntries.length < threshold) return { triggered: false, injectPrompt: '', reason: 'ledger-threshold' };
    const chance = numSetting('localDistantEventChancePercent', 20, 0, 100) / 100;
    const dice = randomFn();
    if (dice >= chance) return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };

    distant.pending = true;
    distant.sample = sampleDistantLedger(state, randomFn);
    distant.requestedRound = Math.max(0, Number(state.round) || 0);
    distant.requestedType = pickRandomTarget('localDistantEventEventPercent', targets, randomFn);
    return {
      triggered: true,
      retry: false,
      requestedType: distant.requestedType,
      injectPrompt: buildDistantEventPrompt(distant.sample, distant.requestedType),
      chance,
      dice,
      reason: 'hit'
    };
  }

  function acceptDistantEventResult(state, update) {
    const distant = ensureDistantEvent(state);
    // 同一对象同时冒充近端与远端结果时直接丢弃，避免在其中一个机制未 pending 时
    // 清掉首个标记后被另一个机制误接纳。
    const dualMarked = [...(update.events || []), ...(update.winds || [])]
      .filter(item => item && item._distanceGenerated === true && item._nearGenerated === true);
    if (dualMarked.length) {
      update.events = (update.events || []).filter(item => !dualMarked.includes(item));
      update.winds = (update.winds || []).filter(item => !dualMarked.includes(item));
    }
    const markedEvents = (update.events || []).filter(item => item && item._distanceGenerated === true);
    const markedWinds = (update.winds || []).filter(item => item && item._distanceGenerated === true);
    const marked = markedEvents.concat(markedWinds);
    for (const item of [...(update.events || []), ...(update.winds || [])]) {
      if (item && Object.prototype.hasOwnProperty.call(item, '_distanceGenerated')) delete item._distanceGenerated;
    }
    if (!distant.pending) return false;

    const candidate = marked.length === 1 ? marked[0] : null;
    const isEvent = !!candidate && markedEvents.includes(candidate);
    const typeMatches = !!candidate && ((distant.requestedType === 'event' && isEvent) || (distant.requestedType === 'wind' && !isEvent));
    const level = candidate ? parseInt(candidate.level) : 0;
    const validShape = isEvent
      ? !!(candidate.name && EVENT_TYPES.includes(candidate.type))
      : !!(candidate && candidate.topic && candidate.content);
    const valid = !!candidate && candidate._nearGenerated !== true && typeMatches && (level === 2 || level === 3) && validShape;
    if (!valid) {
      update.events = (update.events || []).filter(item => !markedEvents.includes(item));
      update.winds = (update.winds || []).filter(item => !markedWinds.includes(item));
      console.warn('[世界引擎] 远方随机事件生成未通过校验，下轮继续强制生成');
      return false;
    }

    candidate.id = null;
    candidate.level = level;
    distant.pending = false;
    distant.cooldown = intSetting('localDistantEventCooldown', 5, 0);
    distant.sample = [];
    distant.requestedRound = 0;
    distant.requestedType = '';
    console.log('[世界引擎] 远方随机事件生成成功:', isEvent ? candidate.name : candidate.topic);
    return true;
  }

  function ensureNearEvent(state) {
    if (!state.nearEvent || typeof state.nearEvent !== 'object' || Array.isArray(state.nearEvent)) {
      state.nearEvent = { pending: false, cooldown: 0, requestedRound: 0, requestedType: '' };
    }
    const near = state.nearEvent;
    near.pending = near.pending === true;
    near.cooldown = Math.max(0, parseInt(near.cooldown) || 0);
    near.requestedRound = Math.max(0, parseInt(near.requestedRound) || 0);
    near.requestedType = ['event', 'wind'].includes(near.requestedType) ? near.requestedType : '';
    return near;
  }

  function buildNearEventPrompt(requestedType) {
    const wantsEvent = requestedType === 'event';
    const targetText = wantsEvent ? '一条新的 events 事件链' : '一条新的 winds 风声';
    return `
【本地随机机制强制指令：本轮必须生成一条近端动态】
本地系统已经指定本轮近端动态的类型：${wantsEvent ? '事件链 events' : '风声 winds'}。
结合当前世界状态、世界书和近期对话，为本次近端动态新增${targetText}。不得改成另一种类型。

强制要求：
- 新对象等级只能是 Lv2 或 Lv3。
- 新对象必须设置 "id": null，并额外设置临时标记 "_nearGenerated": true。
- 该临时标记仅供本地确认生成成功；不得添加到其他对象，也不得与 "_distanceGenerated" 同时使用。
- 内容必须与 {{user}} 的当前行动、接触对象、所在区域、当前场景或正在发展的事项存在明确且可追溯的因果关系，不能只是同处一地或题材相似。
- 不得替 {{user}} 做决定，不得虚构目击、传播、情报来源或其他关键条件。
- ${wantsEvent
      ? '必须满足 events 的创建与归并规则：若明显属于已有事项的步骤、阻碍或直接后果，必须沿用原 id；只有形成独立事项才新建。'
      : '必须满足 winds 的传播规则：信息已经通过实际节点进入传播，并写明 scope 与 source。'}
- 本次近端动态只能有一个带 "_nearGenerated" 标记的新对象；其他本地强制指令分别完成，不计入本机制的一个对象限制。
`;
  }

  function rollNearEvent(state, randomFn = Math.random) {
    const near = ensureNearEvent(state);
    const targets = getRandomEventTargets();
    if (!targets.event && !targets.wind) return { triggered: false, injectPrompt: '', reason: 'modules-disabled' };

    if (near.pending) {
      if (!isRandomTargetAvailable(near.requestedType, targets)) {
        near.requestedType = pickRandomTarget('localNearEventEventPercent', targets, randomFn);
      }
      return {
        triggered: true,
        retry: true,
        requestedType: near.requestedType,
        injectPrompt: buildNearEventPrompt(near.requestedType),
        reason: 'retry'
      };
    }
    if (near.cooldown > 0) {
      near.cooldown = Math.max(0, near.cooldown - 1);
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const chance = numSetting('localNearEventChancePercent', 20, 0, 100) / 100;
    const dice = randomFn();
    if (dice >= chance) return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };

    near.pending = true;
    near.requestedRound = Math.max(0, Number(state.round) || 0);
    near.requestedType = pickRandomTarget('localNearEventEventPercent', targets, randomFn);
    return {
      triggered: true,
      retry: false,
      requestedType: near.requestedType,
      injectPrompt: buildNearEventPrompt(near.requestedType),
      chance,
      dice,
      reason: 'hit'
    };
  }

  function acceptNearEventResult(state, update) {
    const near = ensureNearEvent(state);
    const markedEvents = (update.events || []).filter(item => item && item._nearGenerated === true);
    const markedWinds = (update.winds || []).filter(item => item && item._nearGenerated === true);
    const marked = markedEvents.concat(markedWinds);
    for (const item of [...(update.events || []), ...(update.winds || [])]) {
      if (item && Object.prototype.hasOwnProperty.call(item, '_nearGenerated')) delete item._nearGenerated;
    }
    if (!near.pending) return false;

    const candidate = marked.length === 1 ? marked[0] : null;
    const isEvent = !!candidate && markedEvents.includes(candidate);
    const typeMatches = !!candidate && ((near.requestedType === 'event' && isEvent) || (near.requestedType === 'wind' && !isEvent));
    const level = candidate ? parseInt(candidate.level) : 0;
    const validShape = isEvent
      ? !!(candidate.name && EVENT_TYPES.includes(candidate.type))
      : !!(candidate && candidate.topic && candidate.content);
    const valid = !!candidate && candidate._distanceGenerated !== true && typeMatches && (level === 2 || level === 3) && validShape;
    if (!valid) {
      update.events = (update.events || []).filter(item => !markedEvents.includes(item));
      update.winds = (update.winds || []).filter(item => !markedWinds.includes(item));
      console.warn('[世界引擎] 近端随机事件生成未通过校验，下轮继续强制生成');
      return false;
    }

    candidate.id = null;
    candidate.level = level;
    near.pending = false;
    near.cooldown = intSetting('localNearEventCooldown', 5, 0);
    near.requestedRound = 0;
    near.requestedType = '';
    console.log('[世界引擎] 近端随机事件生成成功:', isEvent ? candidate.name : candidate.topic);
    return true;
  }

  // ========== 事件链骰子推进（双类型四阶段系统）==========
  // 每个阶段 9 格，满 9 晋级下一阶段。
  // conflict: 萌芽→发酵→逼近→已爆发；API 可判定已消散；level 越高越容易推进。
  // progress: 筹备→执行→关键→已完成；API 可判定已失败；level 越高越难推进。
  // 停滞完全交给 API 控制，本地骰子不再跳过轮次
  function forceTriggerEvents(state) {
    const events = state.events || [];
    let anyTriggered = false;

    for (const ev of events) {
      // 清除上轮结果
      delete ev.evolveResult;

      // 初始化字段
      StageMachine.normalize(EVENT_STAGE_MACHINE_CONFIG, ev);
      if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;

      // 终局事件跳过
      if (StageMachine.isTerminal(EVENT_STAGE_MACHINE_CONFIG, ev)) continue;

      // 保底：连续非成功达到上限则强制成功
      const maxFails = getMaxFails(ev);
      if (ev.consecutiveFails >= maxFails) {
        StageMachine.advance(EVENT_STAGE_MACHINE_CONFIG, ev);
        ev.consecutiveFails = 0;
        ev.evolveResult = '成功';
        anyTriggered = true;
        if (StageMachine.isAtFinalStage(EVENT_STAGE_MACHINE_CONFIG, ev, 'conflict')) logEruption(state, ev);
        continue;
      }

      // 正常掷骰
      const roll = DiceEngine.rollThreshold({
        typeField: 'type',
        defaultType: 'conflict',
        levelField: 'level',
        progressField: 'stageRound',
        progressMax: 9,
        base: EVENT_STAGE_BASE,
        defaultBase: 85,
        // [移植 v2.4.1] 受挫系数与全局推进修正可调（默认 40% / 0 = 原硬编码行为）
        setbackRatio: numSetting('localEventSetbackRatioPercent', 40, 0, 100) / 100,
        thresholdModifier: numSetting('localEventDiceModifier', 0, -100, 100),
        levelAdjust: function (item, level, type) {
          return type === 'progress' ? (level - 1) * 10 : -((level - 1) * 10);
        }
      }, ev);

      if (roll.kind === 'success') {
        // 成功：推进
        StageMachine.advance(EVENT_STAGE_MACHINE_CONFIG, ev);
        ev.consecutiveFails = 0;
        ev.evolveResult = '成功';
        anyTriggered = true;
        if (StageMachine.isAtFinalStage(EVENT_STAGE_MACHINE_CONFIG, ev, 'conflict')) logEruption(state, ev);
      } else if (roll.kind === 'setback') {
        // 受挫：倒退
        StageMachine.recede(EVENT_STAGE_MACHINE_CONFIG, ev);
        ev.consecutiveFails++;
        ev.evolveResult = '受挫';
      } else {
        // 保持：不动
        ev.consecutiveFails++;
        ev.evolveResult = '保持';
      }
    }

    if (anyTriggered) return anyTriggered;
  }

  function getMaxFails(ev) {
    const level = ev.level || 1;
    // [移植 v2.4.1] 保底可调：推进型上限 = A + Lv；冲突型上限 = max(1, B - Lv)（默认 A=2 B=6）
    const progressBase = intSetting('localProgressFailBase', 2, 0);
    const conflictBase = intSetting('localConflictFailBase', 6, 1);
    return ev.type === 'progress' ? progressBase + level : Math.max(1, conflictBase - level);
  }

  function logEruption(state, ev) {
    console.log(`[世界引擎] 事件爆发: ${ev.name}`);
  }

  // ========== 风声消散骰 ==========
  // API 本轮返回同 id 风声时，core.addWind 会将 quietRounds 重置为 0。
  // 未被更新的风声在下轮 API 调用前累积沉寂，并可能直接消散。
  function decayWinds(state, randomFn = Math.random) {
    const survivors = [];
    const decayed = [];

    for (const wind of state.winds || []) {
      const roll = DiceEngine.rollDecay({
        byTypeField: 'type',
        defaultType: 'rumor',
        levelField: 'level',
        quietField: 'quietRounds',
        // [移植 v2.4.1] 消散表按用户调参构建（默认 = WIND_DECAY 出厂值）
        table: tunedWindDecayTable()
      }, wind, randomFn);

      if (roll.decayed) decayed.push(wind);
      else survivors.push(wind);
    }

    state.winds = survivors;
    if (decayed.length) {
      console.log(`[世界引擎] 🌫️ 风声消散: ${decayed.map(w => w.topic).join('、')}`);
    }
    return decayed;
  }

  const OUTPUT_INSTRUCTIONS = `
## JSON 输出字段说明

你必须输出一个 JSON 对象。只输出本轮有实质变化的字段；禁止为了凑数制造无意义内容。

### 输出字数限制
以下限制按中文汉字计数，标点符号、空格、数字和英文字母不计入字数；但仍要求表达简洁，不得用大量标点或英文绕过限制。
- events.desc：不得超过50个汉字。
- factions.currentGoal：不得超过50个汉字。
- winds.content：不得超过50个汉字。
- influenceChain.impact：不得超过50个汉字。
- influenceChain.fallout：不得超过50个汉字。
- worldTrends.description：不得超过100个汉字。

### events（事件链数组）
创建或更新 events 前，先按核心目标或矛盾、主要对象和连续执行过程匹配已有主事项；同一事项的步骤、阻碍、代价、局部结果和善后必须沿用原 id。已经出现具体迹象、尚有发展空间的事项，可以以 id:null 新建；事项不必已经成熟，也不必预先证明一定会跨越多个轮次。筹划、试探、调查起步或矛盾初现都可以成为事件链的早期阶段。若内容明显属于已有事项的步骤、阻碍或直接后果，则沿用原 id。事件类型不同不自动构成拆链理由；只有形成可独立演化的冲突或推进事项时才分别建链。
每项包含：
- id: 已有事件必须原样返回当前 id；新事件必须显式填 null，禁止省略
- name: 事件名称。名称允许随局势演变，但改名不代表创建新事件
- type: "conflict"/"progress"。conflict=冲突型事件链，progress=推进型事件链。新事件必须填写；已有事件的 type 一旦确定禁止改动，更新同一 id 的事件时必须沿用当前 type。
- level: 1-4。conflict 表示冲突烈度/失控势能，Lv 越高越容易升级；progress 表示事项规模/完成难度，Lv 越高越难完成。
- stage: 按 type 使用不同阶段：
  - conflict 只能使用 "萌芽"/"发酵"/"逼近"/"已爆发"/"已消散"。
    - 萌芽：冲突刚出现苗头，只有少数人察觉，尚未形成公开压力。
    - 发酵：矛盾开始扩散、组织、人手、传闻或报复动机正在聚集。
    - 逼近：冲突即将落到具体行动或直接影响，已经接近爆发点。
    - 已爆发：冲突结果落地，追杀、通缉、械斗、封锁、清算等已经发生。
    - 已消散：冲突失去动机、执行者、资源、目标或时效，已经确定不会继续爆发。
    - 正常推进顺序固定为：萌芽 → 发酵 → 逼近 → 已爆发；已消散不是正常推进阶段，只能由 API 根据明确因果直接判定。
  - progress 只能使用 "筹备"/"执行"/"关键"/"已完成"/"已失败"。
    - 筹备：资源、人手、材料、情报、路线或计划正在准备，尚未全面展开。
    - 执行：事项已经实际开始，有持续投入、行动痕迹和阶段性消耗。
    - 关键：接近结果，最容易被干扰、截胡、反转、延期或付出代价。
    - 已完成：成果落地并进入世界状态，可能生成后续事件、风声、经济或势力变化。
    - 已失败：事项因执行者退出、资源耗尽、关键条件永久丧失、被有效反制或时效过期而确定无法完成。
    - 正常推进顺序固定为：筹备 → 执行 → 关键 → 已完成；已失败不是正常推进阶段，只能由 API 根据明确因果直接判定。
- stageRound: 当前阶段内进度 1-8。非终局阶段写 9 会被本地自动晋级；所有终局阶段会被本地锁定为 9/9。
- desc: 事件描述
- stall: true/false（true 表示事件暂时停滞/受阻，但未来仍可能恢复；仅作标记，不改变 type 或 stage；停滞原因和恢复条件写入 desc）

### 事件链停滞与终局判定
- 停滞不是终局。只要仍存在合理恢复条件，就设置 stall=true，并保持当前 stage。
- conflict 只有在冲突已确定失去继续爆发的可能时，才可直接将 stage 标记为 "已消散"。
- progress 只有在事项已确定无法继续或无法达成目标时，才可直接将 stage 标记为 "已失败"。
- 标记 "已消散"/"已失败" 时，desc 必须写明导致终局的具体原因；不得仅因为连续多轮没有进展而判定终局。
- "已爆发"/"已消散"/"已完成"/"已失败" 均为终局，进入后不得恢复为非终局阶段。如需重启，应创建新的事件链。

### factions（势力数组）
只有具备稳定共同身份、共同目标、组织决策能力和跨轮次行动能力的群体才能创建为势力。临时人群、一次性队伍和无组织公众不得创建，也不得为凑数量虚构势力。只有字段发生实质变化时才更新。
每项包含：
- id: 已有势力必须原样返回当前 id；新势力必须显式填 null，禁止省略
- name: 势力名称。改名、易帜或称号变化时仍沿用原 id；真正分裂出的新势力使用新对象
- scope: 势力直接控制或具有重大影响力的地理范围
- status: 整体运势——"鼎盛"/"稳固"/"倾轧"/"困顿"/"衰落"/"瓦解"。
  鼎盛=有钱有人有势，铁板一块；稳固=正常运行无重大危机；倾轧=内部派系斗争，架子还没散；困顿=资源枯竭或被封锁，咬牙硬撑；衰落=失去支柱/地盘/核心人物，滑向瓦解；瓦解=名存实亡，仅待终局确认。
- relation: 该势力对{{user}}的态度，七级（以"中立"为正中，只能取这七个值）——"血盟"/"盟友"/"友好"/"中立"/"冷淡"/"敌对"/"世仇"。
  血盟=绝对信任，生死与共；盟友=地位平等，互相支援；友好=认同{{user}}，优先合作；中立=不关心不排斥；冷淡=已注意到但不打算采取行动；敌对=公开对抗；世仇=不死不休。
- currentGoal: 当前目标文字
- core_person: 核心人物姓名
- powerPillars: 该势力当前拥有的权力支柱，最多3个，每个为1-4字的名称字符串（如"武力威慑"/"官场人脉"/"财政支持"）。只有稳固且有实际力量的支柱才列入；已经崩溃或失效的支柱不得保留。此字段仅表示当前的支柱，不包含历史。API 必须在 desc 或 influenceChain 中说明支柱变化。

### worldTrends（天下大势数组）
天下大势是已经改变国家、国际或整个世界运行方式的长期局势，不是普通风声，也不是等待爆发的事件链。
每项包含：
- id: 已有大势必须原样返回当前 id；新大势必须显式填 null，禁止省略
- name: 大势名称。措辞变化时仍沿用原 id
- scope: 实际影响范围
- status: "持续中"/"已结束"
- description: 当前局势及其正在如何约束世界行动
- source: 形成该大势的明确来源

判定规则：
- 每轮检查 Lv4 冲突型事件进入已爆发、Lv4 推进型事件进入已完成、Lv4 风声背后事实被广泛确认等候选来源。
- 只有局势长期、广域、跨系统，并迫使多个势力持续调整行动时，才创建天下大势。全国节庆、单次公告、短期轰动不算。
- 天下大势不参与骰子、不自动消散。持续中的大势每轮都必须作为事件链、势力、经济与风声推演的背景约束。
- 只有出现明确改变局势的事实时才能更新；只有局势确定结束时才标记为已结束。
- 大势产生的新行动、风声或经济变化应写入对应字段；跨系统传导写入 influenceChain。

### winds（风声数组）
新风声只需已有明确的信息主题，并已通过公开发布、他人听闻或转述、现实渠道传递、小范围流传或共同议论等方式进入传播过程。传播可以处于起始阶段，不要求已经形成较大规模、实际改变其他系统或预先证明会持续多个轮次。完全未被他人听闻的私密信息、普通寒暄、纯气氛和没有带来新信息的机械复述不创建。
创建前必须先做“信息主题归并”判断：风声可以是真实消息、流言、误传、夸张说法或片面理解；但它记录的是正在传播的信息主题，不是事实清单、细节清单、版本清单或后续标题。若新信息与已有风声共享核心对象、核心事件/事项、核心说法、传播含义或社会指向，必须沿用原 id 更新 content/level/scope/source，不得新建。
同一信息主题的补充、续传、细节增加、范围扩大、语气变化、版本变形、可信度变化、情绪升温或影响扩散，都应合并到原风声。禁止仅因标题变化、措辞变化、版本后缀或传播阶段变化创建重复风声。只有当核心传播含义已经改变，并指向不同对象、不同判断、不同利益关系、不同风险判断或不同群体行动时，才允许创建新风声。
每项包含：
- id: 已有风声必须原样返回当前 id；新风声必须显式填 null，禁止省略
- topic: 风声主题。传播中的说法、焦点或标题可以变化；只要仍是同一传播脉络，就沿用原 id。
- type: "announcement"/"report"/"rumor"/"sentiment"，分别表示公告、消息、流言、舆情。
- level: 1-4，表示实际传播规模：1=圈内少数人，2=地方，3=大区，4=国家/国际/天下。
- content: 当前正在传播的具体说法；传播变质时更新此字段。
- scope: 当前实际传播到的具体地区或圈层。
- source: 来源与传播链。与{{user}}相关时必须写出完整信息链。

### 风声联动要求
- 每轮检查已有 winds，但只有出现合法传播节点时才能扩大 level 或 scope；不得自动升级。
- 风声只有传播到相关对象所在范围或圈层后，才允许改变 factions、reputation、economy、enemies 或 events。
- 风声导致跨系统变化时，必须同步写入 influenceChain，明确"哪条风声 → 谁获知 → 采取何种行动/形成何种判断"。
- 公告只证明发布者公开说过这件事，不保证内容为真；流言也可能恰好为真。不要使用可信度字段。
- 私信、密令等仅有明确接收者的信息不属于风声；泄露并开始传播后才创建风声。
- 没有产生实际外溢影响的风声可以只更新 winds，不得硬造其他系统变化。
- 风声若连续多轮没有任何实质更新，会由本地系统判定消散并在下轮推演前删除。若一条风声本轮仍在传播、变质、扩大范围或持续影响世界，必须返回相同 id 的更新；仅原样复述而没有实际变化不算更新。
- quietRounds 是本地内部字段，禁止输出或修改。

### economy（经济对象）
- climate: 经济气候 — 当前区域经济温度："繁荣"/"平稳"/"衰退"/"动荡"
- signals: 市场信号数组。每项 { summary: "一句话描述变化和影响", scope: "影响的地理范围（具体区域名）" }。记录当前市场上值得注意的经济变化——该变化必须足以影响势力行动、NPC决策或事件链走向。日常琐碎波动不配进入。一般不超过3条。
- signal 必须是已经发生的市场变化，不能只是预测；只有幅度、范围、原因或决策影响实质改变时才更新，影响消失后移除。单一商品变化通常不得改变整个区域的 climate。

### reputation（声誉对象）
只有信息已传播到对应圈层，并足以改变该圈层对{{user}}的总体评价时才能改变声誉。单个NPC态度、未传播行为和重复旧闻不得改变声誉；没有跨级所需的新事实时不要返回 reputation。
四维声誉，每维五级（从低到高，只能取这五个值）：天怒人怨→声名狼藉→默默无闻→受人尊敬→万众敬仰
- authority: 朝堂之上 — 掌权建制力量对{{user}}的评价。守法/逆法、顺从/挑衅。
- common: 市井之间 — 普通百姓/街头舆论对{{user}}的口碑。仁善/暴戾、保护者/威胁者。
- shadow: 草莽之中 — 体制外力量（绿林/走私/佣兵/黑客/地下帮派等）对{{user}}的看法。核心标准：有种还是没种。以私力对抗体制不公、替弱者出头→加分；欺压平民、出卖同道、恃强凌弱→减分。单纯的刑事犯罪不自动获得草莽尊重。
- circuit: 同道之间 — {{user}}所在行当/职业圈内的同行评价。技艺高低、是否守行规、对行业有无贡献。
- lastChange: 本轮变化简述（如"无变化"或"朝堂评价因协助缉拿上升"）

### world_digest（字符串）
本轮后台世界推演叙事，150-200字。先感知自上次世界状态更新以来大致经过的剧情时间，再描述相对上次状态真正发生的新变化（天下大势约束、NPC独立行动、团体内部变化、风声传播等）。旧对话只作背景，不要重复当作新变化；若时间很短或新增事实不足，可写局势基本稳定或只有轻微变化。禁止提及{{user}}。

### enemies（仇敌录数组）
仇敌是因具体伤害行为而与{{user}}产生不可逆个人恩怨的角色或群体。不同于势力层面的态度对立（那是 factions.relation 的职责），仇敌的核心特征是：永不淡化、追着{{user}}跑。
只有满足对应类型的完整触发条件才创建；愤怒、敌意或口头威胁本身不构成仇敌。已有仇敌只有行动能力、定位、阶段、主体或终结事实发生实质变化时才更新。

每项包含：
- id: 已有仇敌必须原样返回当前 id；新仇敌必须显式填 null，禁止省略
- name: 仇敌名称（个人姓名或复仇团体名）
- reason: 结仇原因（简述{{user}}做了什么导致结仇）
- type: "blood"/"grudge"。blood=血仇（核心人物被杀、至亲身亡/致残）；grudge=非致死恩怨（被废、破产、被夺走重要之物等造成不可逆伤害）
- status: "追踪中"/"策划中"/"执行中"/"已终结"
  - 追踪中：正在收集情报、确定{{user}}位置
  - 策划中：已定位{{user}}，正在组织人手/资源准备行动
  - 执行中：已派出追杀/报复力量，实际攻击已发生或即将发生
  - 已终结：仇敌被{{user}}消灭或复仇已完成。标记后本地保留20轮再清除。

判定规则：
- type=blood 的触发条件：核心人物被杀（排除已失去权力的前核心人物，见势力模块的权力瓦解）；至亲身亡/致残。此种仇恨不可谈判、永不淡化、不因时间推移而放弃。
- type=grudge 的触发条件：{{user}}的行为对特定角色造成了不可逆的重大伤害（被废去武功、被夺走毕生基业、被设局导致破产/流放），且受害者有明确的复仇动机和能力。不是每个被{{user}}得罪的人都算grudge——必须满足"不可逆伤害+明确复仇意愿+有追踪/报复能力"三个条件。
- 无论blood还是grudge，一旦标记为"已终结"，本地会再保留20轮备忘，之后自动清除。

与事件链联动：
- 创建仇敌条目时，通常应同步创建一条冲突型事件链（type=conflict），name与仇敌name对应，并在influenceChain中记录两者的关联。
- 仇敌条目status变化时，对应事件链的stage应同步更新。

与权力瓦解互斥：
- 若某核心人物所有权力支柱已被摧毁（见势力模块的权力瓦解），其失去权力及核心人物地位。此时若被{{user}}杀死，不触发type=blood，仅按type=grudge处理。

禁止事项：
- 血仇提供动机，不提供能力。追杀受势力等级约束，弱势力无法渗透强势力地盘。
- 不得仅因"被{{user}}辱骂"或"商业竞争失败"等可逆伤害创建仇敌条目。
- 不得将势力层面的态度对立（factions.relation）重复录入仇敌录。

### influenceChain（影响链数组）
用于记录重要变化在世界中的传播过程，说明什么触发了变化、直接改变了什么、又产生了什么后续余波。它不是新的事件链，不参与骰子推进，也不表示 stage 进度。
只有触发源已经使另一个系统的持久状态发生实质变化，并且这段传导对理解后续状态有必要时才创建。潜在可能、普通情绪、事件内部步骤和事件链常规进度不得创建；尚未发生但有依据的趋势只能写入 fallout。
每项包含：
- trigger: 触发源。引发变化的具体事件、行动、天下大势、风声、经济变化、声誉变化或黑盒信息
- impact: 直接影响。触发源已经真实改变了什么世界状态
- fallout: 后续余波。影响继续扩散产生的次生变化或下一步趋势

要求：
- 只记录真实产生外溢影响的变化，不要把每条事件链的普通进度都塞进 influenceChain。
- impact 必须是已经发生的直接变化；fallout 必须是进一步扩散的余波，不得重复改写 trigger。
- 如果事件链 A 导致事件链 B 加速、延缓、转向、消散或失败，必须在 influenceChain 中说明传导过程。
- 如果影响依赖信息传播，必须符合信息传播规则；NPC不能因为 influenceChain 存在就获得上帝视角。
- 同一 trigger 已有记录时更新该记录，不要无限堆叠重复记录。

### blackbox（信息黑盒对象）
只有需要跨轮次保护知情边界，或追踪未来用途、暴露风险的隐秘行为与资产才进入黑盒。普通内心想法、未实施念头、公开物品、即时消耗品和无后续价值的隐私不得进入。
- secretActions: 隐秘行为数组，每项 { action: "行为描述", witnesses: "无/仅XX" }
- secretAssets: 隐秘资产数组，每项 { name: "资产名称", exposure: 0-100, status: "有效/过期/暴露/失效" }
  exposure 表示该资产被外界发现的风险程度：0=绝密，100=已完全公开。
  status 表示该资产当前是否仍然可用：有效=仍可调用，过期=情报过时，暴露=已被发现，失效=已不可用。
`;

  const JSON_EXAMPLE = `{
  "events": [
    { "id": "event_1", "name": "血刀门复仇", "type": "conflict", "level": 2, "stage": "发酵", "stageRound": 5, "desc": "血刀门派出了追踪者，追踪者在青石关外三里亭设了暗哨" },
    { "id": null, "name": "青炉司改良火药", "type": "progress", "level": 3, "stage": "执行", "stageRound": 4, "desc": "青炉司已收齐硝石与密炭，正在试小炉，尚未进入定型关口" }
  ],
  "factions": [
    { "id": "faction_1", "name": "血刀门", "scope": "血刀岭及周边三镇", "status": "稳固", "relation": "敌对", "currentGoal": "复仇", "core_person": "血刀老祖", "powerPillars": ["武力威慑","情报网"] }
  ],
  "worldTrends": [
    { "id": "trend_1", "name": "北境战争", "scope": "北境三州及周边诸国", "status": "持续中", "description": "边军与北境诸部进入长期战争，征粮、征兵与商路封锁持续改变各方行动", "source": "Lv4冲突型事件「北境战争」进入已爆发" }
  ],
  "winds": [
    { "id": "wind_1", "topic": "青石关设卡", "type": "report", "level": 2, "content": "青石关北门已有官兵设卡盘查", "scope": "青石关及周边村镇", "source": "目击商贩→往来商队" }
  ],
  "economy": { "climate": "平稳", "signals": [] },
  "reputation": { "authority": "默默无闻", "common": "默默无闻", "shadow": "默默无闻", "circuit": "默默无闻", "lastChange": "无变化" },
  "world_digest": "血刀门追踪者在青石关外三里亭设了暗哨；天机阁阁主上官云密信召回了三名外围密探；醉仙楼后厨因粮商涨价换了供货渠道。",
  "enemies": [
    { "id": "enemy_1", "name": "血刀门", "reason": "{{user}}杀了血刀门少主", "type": "blood", "status": "执行中" }
  ],
  "influenceChain": [
    { "trigger": "血刀门发布悬赏令", "impact": "草莽中人开始主动留意{{user}}的行踪", "fallout": "客栈与渡口出现试探和秘密报信者" }
  ],
  "blackbox": { "secretActions": [], "secretAssets": [] }
}`;

  // [移植 v2.4.0] 身份协议属于本地数据完整性约束，不允许被自定义引擎预设/自由模式输出文档覆盖。
  const ENTITY_ID_PROTOCOL = `【持续实体 ID 协议（强制，不可覆盖）】
- events、factions、worldTrends、winds、enemies 的 id 是系统身份。
- 更新已有对象必须原样返回当前状态中的 id，即使 name/topic 改名也不得改变 id。
- 创建新对象必须显式填写 "id": null，由本地系统分配；禁止省略 id，也禁止编造、猜测或复用 id。
- 判断是否为同一对象只看 id。当前状态中不存在的 id 无效。`;

  // ========== 引擎段落默认文本（世界观预设可覆写，见 getEngineSegments） ==========
  // 单一真相源：默认文本只住在这里。预设里只存「覆写或空」，绝不拷贝默认文本，
  // 防止将来移植上游对默认段的修改时，存量预设带着过期拷贝漂移。
  const DEFAULT_SEG_ENGINE_ROLE = `你是一个世界推演引擎。每轮对话后，后台世界必须自动向前推进一步。
请根据世界规则和本轮对话，更新世界状态。只输出 JSON，不要有其他文字。`;

  const DEFAULT_SEG_CAUSAL_STEPS = `推演时按以下因果顺序检查：
1. 【私密判定·最先执行】先判定本轮 {{user}} 及相关人物的行为有无目击者、是否留下可追溯痕迹。凡在无目击、未留痕迹的情况下发生的私密行为（独处、私密情爱、闺房之事、密室密谈、隐秘潜入、无人时的杀伐等），一律计入 blackbox.secretActions（witnesses 标"无"或"仅XX"），并且：不得据此生成风声、不得改变任何维度声誉、不得形成或推进事件链、不得让任何不在场 NPC 据此行动。只有当该行为被目击、留下可追溯痕迹、或事后确实被传播后，才可转为公开影响。
2. 将所有持续中的天下大势作为本轮世界级约束，并检查是否形成新大势或已有大势明确结束。
3. 判断本轮事实、行动与公开信息是否形成新风声（私密行为除外，见第1步）。
4. 检查已有风声是否获得新的合法传播节点，并据此更新 level/scope/content/source。
5. 判断风声实际覆盖了哪些势力、圈层或行动者；只有被覆盖者才能据此改变判断与行动。
6. 天下大势或风声造成跨系统变化时，在对应状态字段中落实结果，并用 influenceChain 记录传导过程。
7. 声誉判定：只有当 {{user}} 的行为已形成覆盖对应圈层的风声后，才改动对应维度声誉；私密、未传播或仅单人目击的行为不改变群体声誉。
8. 仇敌判定：判断本轮是否产生触发血仇/恩怨的不可逆伤害；已有仇敌只有通过覆盖其情报来源的风声或其他合法渠道获知线索后，才能推进追踪，且受势力等级约束，不得凭空定位 {{user}}。
9. 经济判定：只有事件链或可追溯的外部原因驱动时才更新 climate 与 signals；重大经济变化须生成对应风声，禁止凭空波动。
10. 不得从面板全知信息直接跳到 NPC 行动，不得为了产生联动而虚构传播节点。`;

  // 引擎段落解析：活动世界观预设的 engineSegments 非空则覆写，否则用默认。
  // 铁律：预设未覆写（或字段缺失/全空白）时必须逐字节返回默认常量——基线契约。
  // 稳定 ID 协议（ENTITY_ID_PROTOCOL）不在可覆写范围内，由 prompt 组装处独立拼接。
  function getEngineSegments() {
    let overrides = null;
    try {
      const preset = (window.WORLD_ENGINE_PRESETS && window.WORLD_ENGINE_PRESETS.getActivePreset)
        ? window.WORLD_ENGINE_PRESETS.getActivePreset()
        : null;
      overrides = preset && preset.engineSegments;
    } catch (e) {}
    const pick = (v, def) => (typeof v === 'string' && v.trim()) ? v : def;
    return {
      engineRole: pick(overrides && overrides.engineRole, DEFAULT_SEG_ENGINE_ROLE),
      causalSteps: pick(overrides && overrides.causalSteps, DEFAULT_SEG_CAUSAL_STEPS),
      engineRoleOverridden: !!(overrides && typeof overrides.engineRole === 'string' && overrides.engineRole.trim()),
      causalStepsOverridden: !!(overrides && typeof overrides.causalSteps === 'string' && overrides.causalSteps.trim())
    };
  }

  // ======== 内置模块合并处理器（阶段 1 · 从 evolve() 抽取，行为不变；为后续「按描述符分发」铺垫）========
  function mergeEnemies(state, update) {
    if (!update.enemies || !update.enemies.length) return;
    for (const en of update.enemies) {
      if (!en.name || !en.reason) continue;
      if (!en.type || !['blood', 'grudge'].includes(en.type)) en.type = 'blood';
      if (!en.status|| !['追踪中','策划中','执行中','已终结'].includes(en.status)) en.status = '追踪中';
      // [移植 v2.4.0] 按稳定 id 认领（旧存档按唯一同名兜底），改名/重 roll 不再误合并
      core.addEnemy(state, en);
    }
    // 已终结的仇敌保留20轮后清理
    state.enemies = Lifecycle.pruneTerminal(state.enemies || [], getLifecycleConfigs().enemies, state.round).items;
    Lifecycle.capList(state.enemies, getLifecycleConfigs().enemies.cap);
  }

  function mergeBlackbox(state, update) {
    if (!update.blackbox) return;
    state.blackbox = update.blackbox;
    Lifecycle.capBlackbox(state.blackbox, getLifecycleConfigs().blackbox);
  }

  function mergeEvents(state, update) {
    for (const ev of (update.events || [])) {
      // [移植 v2.4.0] 按稳定 id 认领（旧存档/旧模型按唯一同名兜底）
      const existingIndex = core.findEntityIndex(state.events, ev, core.ENTITY_ID_PREFIXES.events, 'name');
      const existing = existingIndex !== -1 ? state.events[existingIndex] : null;
      if (existing) {
        // API 的未知/错误 ID 不得污染本地身份；兼容同名认领时也强制继承本地 ID。
        ev.id = existing.id;
        // 事件类型一旦确定不可由 API 改动
        ev.type = existing.type || 'conflict';

        // 终局事件保护：只允许 API 改 desc
        if (StageMachine.isTerminal(EVENT_STAGE_MACHINE_CONFIG, existing)) {
          if (ev.desc !== undefined) existing.desc = ev.desc;
          core.ensureEventFields(existing);
          continue;
        }

        // API 改了 stageRound？以 API 为准，但 >=9 时自动晋级
        if (ev.stageRound !== undefined && ev.stageRound !== existing.stageRound) {
          existing.stageRound = ev.stageRound;
          existing.consecutiveFails = 0;
          StageMachine.resolveProgressOverflow(EVENT_STAGE_MACHINE_CONFIG, existing, { carryOverflow: true });
        }
        // 合并其他字段
        if (ev.stage !== undefined) existing.stage = ev.stage;
        if (ev.desc !== undefined) existing.desc = ev.desc;
        if (ev.level !== undefined) existing.level = ev.level;
        if (ev.name !== undefined) existing.name = ev.name;
        if (ev.stall !== undefined) existing.stall = ev.stall;
        existing.type = ev.type;
        core.ensureEventFields(existing);
      } else {
        StageMachine.normalizeType(EVENT_STAGE_MACHINE_CONFIG, ev);
        core.addEvent(state, ev);
      }
    }
  }

  function mergeInfluence(state, update) {
    if (update.influenceChain && update.influenceChain.length) {
      const completedRound = state.round + 1;
      for (const influence of update.influenceChain) {
        if (!influence.trigger || !influence.impact) continue;
        influence.fallout = influence.fallout || '';
        const idx = (state.influenceChain || []).findIndex(existing => existing.trigger === influence.trigger);
        if (idx !== -1) {
          influence._createdRound = state.influenceChain[idx]._createdRound ?? completedRound;
          state.influenceChain[idx] = influence;
        } else {
          influence._createdRound = completedRound;
          state.influenceChain.unshift(influence);
        }
      }
      Lifecycle.capList(state.influenceChain, getLifecycleConfigs().influence.cap);
    }
    // Influence entries expire after 8 rounds; updates to the same trigger do not renew them.
    const cleanedInfluence = Lifecycle.pruneExpired(state.influenceChain || [], getLifecycleConfigs().influence, state.round);
    if (cleanedInfluence.items.length !== (state.influenceChain || []).length) {
      console.log('[World Engine] auto-removed influence entries:', cleanedInfluence.removed
        .map(influence => influence.trigger)
        .join(', '));
    }
    state.influenceChain = cleanedInfluence.items;
  }

  function mergeFactions(state, update) {
    for (const fac of (update.factions || [])) core.addFaction(state, fac);
  }
  function mergeWorldTrends(state, update) {
    for (const trend of (update.worldTrends || [])) core.addWorldTrend(state, trend);
  }
  function mergeWinds(state, update) {
    for (const wind of (update.winds || [])) core.addWind(state, wind);
  }
  function mergeEconomy(state, update) {
    if (update.economy && Object.keys(update.economy).length) Object.assign(state.economy, update.economy);
  }
  function mergeReputation(state, update) {
    if (update.reputation && Object.keys(update.reputation).length) Object.assign(state.reputation, update.reputation);
  }

  const GenericMechanics = {
    getMechanics(descriptor) {
      return (descriptor && descriptor.mechanics && typeof descriptor.mechanics === 'object') ? descriptor.mechanics : {};
    },

    getStageConfig(descriptor) {
      const stages = GenericMechanics.getMechanics(descriptor).stages;
      if (!stages || typeof stages !== 'object') return null;
      const order = stages.order || stages.states;
      if (!order) return null;
      const defaultType = stages.defaultType || (Array.isArray(order) ? 'default' : Object.keys(order)[0]);
      const normalizedOrder = Array.isArray(order) ? { [defaultType]: order.slice() } : { ...order };
      const terminalStages = stages.terminalStages || stages.terminalStates || {};
      const finalStage = stages.finalStage || stages.finalStates || {};
      const firstOrder = normalizedOrder[defaultType] || normalizedOrder[Object.keys(normalizedOrder)[0]] || [];
      const singleType = !stages.typeField && Object.keys(normalizedOrder).length === 1;
      const normalizedFinalStage = Array.isArray(finalStage) ? { [defaultType]: finalStage[finalStage.length - 1] } : (typeof finalStage === 'string' ? { [defaultType]: finalStage } : { ...finalStage });
      const normalizedTerminalStages = Array.isArray(terminalStages) ? { [defaultType]: terminalStages.slice() } : { ...terminalStages };
      Object.keys(normalizedOrder).forEach(type => {
        if (!normalizedFinalStage[type]) normalizedFinalStage[type] = normalizedOrder[type][normalizedOrder[type].length - 1];
        if (!normalizedTerminalStages[type]) normalizedTerminalStages[type] = normalizedFinalStage[type] ? [normalizedFinalStage[type]] : [];
      });
      return {
        typeField: stages.typeField || 'type',
        defaultType,
        order: normalizedOrder,
        finalStage: normalizedFinalStage,
        terminalStages: normalizedTerminalStages,
        progressField: stages.progressField || 'stageRound',
        progressMax: Number.isFinite(Number(stages.progressMax)) ? Number(stages.progressMax) : 9,
        _singleType: singleType,
        _firstOrder: firstOrder
      };
    },

    normalizeStage(descriptor, item) {
      const config = GenericMechanics.getStageConfig(descriptor);
      if (!config || !item || typeof item !== 'object') return item;
      if (config._singleType) {
        const order = config._firstOrder || [];
        if (item[config.progressField] === undefined) item[config.progressField] = 1;
        if (!item.stage || order.indexOf(item.stage) === -1) item.stage = order[0];
        return item;
      }
      return StageMachine.normalize(config, item);
    },

    getVerdictLevels(descriptor, axis) {
      const verdicts = GenericMechanics.getMechanics(descriptor).verdicts;
      if (!verdicts || typeof verdicts !== 'object') return [];
      if (Array.isArray(verdicts.levels)) return verdicts.levels;
      return (verdicts.levels && verdicts.levels[axis]) || [];
    },

    normalizeVerdictValues(descriptor, item, fallback) {
      const verdicts = GenericMechanics.getMechanics(descriptor).verdicts;
      if (!verdicts || !Array.isArray(verdicts.axes) || !item || typeof item !== 'object') return item;
      const termMap = verdicts.termMap || {};
      verdicts.axes.forEach(axis => {
        const levels = GenericMechanics.getVerdictLevels(descriptor, axis);
        if (!levels.length || item[axis] == null || levels.indexOf(item[axis]) !== -1) return;
        const mapped = Object.keys(termMap).find(key => termMap[key] === item[axis]);
        if (mapped && levels.indexOf(mapped) !== -1) item[axis] = mapped;
        else if (fallback && fallback[axis] != null) item[axis] = fallback[axis];
        else item[axis] = levels[0];
      });
      return item;
    },

    normalizeVerdictTexts(descriptor, value, fallback, termMap) {
      const verdicts = GenericMechanics.getMechanics(descriptor).verdicts;
      const engine = window.WORLD_ENGINE_PRESETS && window.WORLD_ENGINE_PRESETS._VERDICT_ENGINE;
      if (!verdicts || !engine) return value;
      const config = { axes: verdicts.axes || ['value'], levels: verdicts.levels || [] };
      if ((config.axes || []).length > 1 && typeof engine.normalizeAxes === 'function') {
        return engine.normalizeAxes(config, value, fallback, termMap || verdicts.termMap);
      }
      if (typeof engine.normalizeSingleAxis === 'function') {
        return engine.normalizeSingleAxis(config, value, fallback, termMap || verdicts.termMap);
      }
      return value;
    },

    prepareItem(descriptor, item, fallback) {
      if (!item || typeof item !== 'object') return item;
      GenericMechanics.normalizeStage(descriptor, item);
      GenericMechanics.normalizeVerdictValues(descriptor, item, fallback);
      return item;
    },

    getDiceConfig(descriptor) {
      const mechanics = GenericMechanics.getMechanics(descriptor);
      const dice = mechanics.dice;
      if (!dice || typeof dice !== 'object' || !dice.mode) return null;
      const config = { ...dice };
      const stageConfig = GenericMechanics.getStageConfig(descriptor);
      if (stageConfig) {
        if (!config.typeField) config.typeField = stageConfig.typeField;
        if (!config.defaultType) config.defaultType = stageConfig.defaultType;
        if (!config.progressField) config.progressField = stageConfig.progressField;
        if (!config.progressMax) config.progressMax = stageConfig.progressMax;
      }
      return config;
    },

    rollDice(descriptor, item, randomFn = Math.random) {
      const config = GenericMechanics.getDiceConfig(descriptor);
      if (!config) return null;
      if (config.mode === 'threshold') return DiceEngine.rollThreshold(config, item || {}, randomFn);
      if (config.mode === 'decay') return DiceEngine.rollDecay(config, item || {}, randomFn);
      if (config.mode === 'trigger') return DiceEngine.rollTrigger(config, item || {}, randomFn);
      return null;
    },

    applyDiceResult(descriptor, item, roll) {
      if (!item || typeof item !== 'object' || !roll) return item;
      const config = GenericMechanics.getStageConfig(descriptor);
      const diceConfig = GenericMechanics.getDiceConfig(descriptor);
      const mode = diceConfig && diceConfig.mode;
      if (mode === 'trigger' && roll.patch && typeof roll.patch === 'object') Object.assign(item, roll.patch);
      if (mode === 'decay' && roll.decayed) item._decayed = true;
      if (mode === 'threshold' && config && !config._singleType) {
        if (roll.kind === 'success') StageMachine.advance(config, item);
        else if (roll.kind === 'setback') StageMachine.recede(config, item);
      } else if (mode === 'threshold' && config && config._singleType) {
        if (roll.kind === 'success') {
          item[config.progressField] = (parseInt(item[config.progressField]) || 1) + 1;
          const order = config._firstOrder || [];
          if (item[config.progressField] >= config.progressMax) {
            const idx = order.indexOf(item.stage);
            if (idx !== -1 && idx < order.length - 1) {
              item.stage = order[idx + 1];
              item[config.progressField] = 1;
            }
          }
        } else if (roll.kind === 'setback') {
          item[config.progressField] = Math.max(1, (parseInt(item[config.progressField]) || 1) - 1);
        }
      }
      return item;
    }
  };
  const GenericMerge = {
    getField(descriptor) {
      return descriptor && (descriptor.field || descriptor.id);
    },

    getItemKey(descriptor) {
      return (descriptor && (descriptor.itemKey || (descriptor.mechanics && descriptor.mechanics.itemKey))) || 'name';
    },

    mergeArray(state, update, descriptor) {
      const field = GenericMerge.getField(descriptor);
      if (!field || !Array.isArray(update && update[field])) return false;
      if (!Array.isArray(state[field])) state[field] = [];
      const itemKey = GenericMerge.getItemKey(descriptor);
      update[field].forEach(item => {
        if (!item || typeof item !== 'object') return;
        const keyValue = itemKey ? item[itemKey] : null;
        const idx = keyValue == null ? -1 : state[field].findIndex(existing => existing && existing[itemKey] === keyValue);
        const prepared = GenericMechanics.prepareItem(descriptor, { ...item }, idx !== -1 ? state[field][idx] : null);
        if (idx !== -1) state[field][idx] = { ...state[field][idx], ...prepared };
        else state[field].push(prepared);
      });
      return true;
    },

    mergeObject(state, update, descriptor) {
      const field = GenericMerge.getField(descriptor);
      if (!field || !update || !update[field] || typeof update[field] !== 'object' || Array.isArray(update[field])) return false;
      const current = state[field] && typeof state[field] === 'object' && !Array.isArray(state[field]) ? state[field] : {};
      const prepared = GenericMechanics.prepareItem(descriptor, { ...update[field] }, current);
      state[field] = { ...current, ...prepared };
      return true;
    },

    mergeScalar(state, update, descriptor) {
      const field = GenericMerge.getField(descriptor);
      if (!field || !update || !Object.prototype.hasOwnProperty.call(update, field)) return false;
      state[field] = update[field];
      return true;
    },

    merge(state, update, descriptor) {
      if (!descriptor || descriptor.enabled === false) return false;
      if (descriptor.container === 'array') return GenericMerge.mergeArray(state, update, descriptor);
      if (descriptor.container === 'object') return GenericMerge.mergeObject(state, update, descriptor);
      if (descriptor.container === 'scalar') return GenericMerge.mergeScalar(state, update, descriptor);
      return false;
    },

    mergeAll(state, update, descriptors) {
      let changed = false;
      (Array.isArray(descriptors) ? descriptors : []).forEach(descriptor => {
        changed = GenericMerge.merge(state, update, descriptor) || changed;
      });
      return changed;
    }
  };

  // 内置模块合并分发表（moduleId → 处理器）。evolve() 当前仍按固定顺序显式调用以保 classic 零回归；
  // 此表供 Phase 3 自由/混合模式按描述符查表分发内置处理器之用。
  function getActiveCustomModuleDescriptors() {
    const rules = window.WORLD_ENGINE_RULES;
    if (!rules || typeof rules.getActiveModuleDescriptors !== 'function') return [];
    try {
      return rules.getActiveModuleDescriptors().filter(function (descriptor) {
        return descriptor && descriptor.kind === 'custom' && descriptor.enabled !== false && descriptor.container !== 'none';
      });
    } catch (e) {
      return [];
    }
  }

  function mergeCustomModules(state, update) {
    return GenericMerge.mergeAll(state, update, getActiveCustomModuleDescriptors());
  }
  const BUILTIN_MERGE = {
    events: mergeEvents,
    factions: mergeFactions,
    trends: mergeWorldTrends,
    winds: mergeWinds,
    economy: mergeEconomy,
    reputation: mergeReputation,
    enemies: mergeEnemies,
    influence: mergeInfluence,
    regional: mergeRegionalIncident,
    blackbox: mergeBlackbox
  };
  function getBuiltinMergeIds() { return Object.keys(BUILTIN_MERGE); }

  async function callEvolutionAPI(state, userMsg, aiMsg, extraInstruction = '', dialogueText = '') {
    const rulesLoader = window.WORLD_ENGINE_RULES;
    const fullRules = rulesLoader ? rulesLoader.getAllRulesText() : '【规则加载失败】';
    const outputInstructions = (rulesLoader && typeof rulesLoader.buildOutputInstructionsText === 'function')
      ? rulesLoader.buildOutputInstructionsText()
      : OUTPUT_INSTRUCTIONS + '\n' + JSON_EXAMPLE;
    const dialogueForWorldbook = dialogueText || `用户：${userMsg || ''}\nAI：${aiMsg || ''}`;
    const worldbookSection = await window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection?.(dialogueForWorldbook) || '';
    const tonePrompt = ((api.getSettings ? api.getSettings() : {}).tonePrompt || '').trim();
    const toneSection = tonePrompt
      ? `\n\n========== 附加提示词（用户自定义 · 优先遵守 · 但不得违反上述输出 JSON 格式）==========\n${tonePrompt}`
      : '';

    // 引擎段落：世界观预设可覆写（getEngineSegments），未覆写时逐字节等于默认常量
    const engineSegs = getEngineSegments();
    const segEngineRole = engineSegs.engineRole;
    const segCausalSteps = engineSegs.causalSteps;

    const segRules = fullRules;
    const segWorldbook = worldbookSection;
    const segStateBlock = `## 当前世界状态（第${state.round}轮）
${JSON.stringify({
  round: state.round,
  events: (state.events || []).map(e => ({ ...e })),
  factions: (state.factions || []).map(f => ({ ...f })),
  worldTrends: state.worldTrends || [],
  winds: (state.winds || []).map(({ quietRounds, ...wind }) => wind),
  reputation: state.reputation,
  economy: state.economy,
  enemies: state.enemies || [],
  influenceChain: state.influenceChain || [],
  blackbox: state.blackbox || { secretActions: [], secretAssets: [] }
}, null, 2)}`;
    const segDialogue = `## 近期对话
${dialogueForWorldbook}`;
    const persona = core.getUserPersona ? core.getUserPersona() : '';
    const segPersona = persona
      ? `## {{user}} 身份设定
以下是 {{user}} 的角色背景设定，推演时请将其作为 {{user}} 的身份、社会地位、职业、能力等背景信息来考量，并据此影响势力态度、声誉判定、NPC 反应等：
${persona}`
      : '';
    const rl = window.WORLD_ENGINE_RULES;
    const skippedFields = (rl && typeof rl.getDisabledOutputFields === 'function') ? rl.getDisabledOutputFields() : [];
    const segDisabledModules = skippedFields.length
      ? `## 已禁用的模块
以下模块已被用户禁用，请不要在输出 JSON 中包含这些字段：${skippedFields.join('、')}。`
      : '';
    const segOutput = outputInstructions;
    const segExtraInstruction = extraInstruction || '';
    const segTone = toneSection;

    const prompt = segEngineRole + '\n\n' + ENTITY_ID_PROTOCOL + '\n\n' + segCausalSteps
      + '\n\n========== 世界推演规则 ==========\n' + segRules
      + '\n\n' + segWorldbook
      + '\n\n' + segStateBlock
      + '\n\n' + segDialogue
      + (segPersona ? '\n' + segPersona + '\n' : '')
      + (segDisabledModules ? '\n' + segDisabledModules + '\n' : '')
      + '\n' + segOutput
      + (segExtraInstruction ? '\n' + segExtraInstruction : '') + segTone;

    _lastPromptSegments = [
      { key: 'engine-role', label: '① 引擎角色指令' + (engineSegs.engineRoleOverridden ? '（预设覆写）' : ''), content: segEngineRole },
      { key: 'entity-ids', label: '② 持续实体 ID 协议', content: ENTITY_ID_PROTOCOL },
      { key: 'causal-steps', label: '③ 因果检查' + (engineSegs.causalStepsOverridden ? '（预设覆写）' : ''), content: segCausalSteps },
      { key: 'rules', label: '④ 世界推演规则', content: segRules },
      { key: 'worldbook', label: '⑤ 世界书注入', content: segWorldbook },
      { key: 'state', label: '⑥ 当前世界状态', content: segStateBlock },
      { key: 'dialogue', label: '⑦ 近期对话', content: segDialogue },
      { key: 'persona', label: '⑧ 用户身份设定', content: segPersona },
      { key: 'disabled-modules', label: '⑨ 已禁用模块', content: segDisabledModules },
      { key: 'output-format', label: '⑩ 输出格式与示例', content: segOutput },
      { key: 'extra', label: '⑪ 额外指令/附加提示词', content: (segExtraInstruction ? segExtraInstruction + '\n' : '') + segTone }
    ];
    _lastPrompt = prompt;
    _lastRawResult = '';
    const knownFields = (rulesLoader && typeof rulesLoader.getAllowedOutputFields === 'function')
      ? rulesLoader.getAllowedOutputFields()
      : [
        'events', 'factions', 'worldTrends', 'winds', 'economy', 'reputation',
        'world_digest', 'enemies', 'influenceChain', 'regionalIncident', 'blackbox'
      ];
    const retrySettings = api.getSettings ? api.getSettings() : {};
    const maxRetries = Math.max(0, parseInt(retrySettings.apiAutoRetries) || 0);
    let update = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // 推演请求读取用户设置（pigment 默认 8000/0.7）。
        const rawResult = await api.callApi(prompt, undefined, undefined, _abortController.signal);
        _lastRawResult = rawResult;
        update = api.parseJSON(rawResult);
        if (!update || typeof update !== 'object' || Array.isArray(update)) {
          throw new Error('API 返回无法解析为有效 JSON，已保留重 roll 前的当前状态');
        }
        if (!knownFields.some(field => Object.prototype.hasOwnProperty.call(update, field))) {
          throw new Error('API 返回不包含任何世界状态字段，已保留重 roll 前的当前状态');
        }
        break;
      } catch (error) {
        if (_abortController && _abortController.signal.aborted) throw error;
        if (attempt >= maxRetries) {
          if (maxRetries > 0 && error && error.message) error.message += `（已自动重试 ${maxRetries} 次）`;
          throw error;
        }
        console.warn(`[世界引擎] API fault，自动重试 ${attempt + 1}/${maxRetries}:`, error && error.message ? error.message : error);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`API fault，自动重试 ${attempt + 1}/${maxRetries}`);
      }
    }
    console.log('[世界引擎] API JSON 解析成功，世界摘要:', update.world_digest || '[未返回]');

    update.events = Array.isArray(update.events) ? update.events : [];
    update.factions = Array.isArray(update.factions) ? update.factions : [];
    update.worldTrends = Array.isArray(update.worldTrends) ? update.worldTrends : [];
    update.winds = Array.isArray(update.winds) ? update.winds : [];
    update.economy = update.economy || {};
    if (!update.economy.signals) update.economy.signals = [];
    update.reputation = update.reputation || {};
    update.world_digest = update.world_digest || state.worldDigest;
    update.enemies = Array.isArray(update.enemies) ? update.enemies : [];
    update.influenceChain = Array.isArray(update.influenceChain) ? update.influenceChain : [];
    // regionalIncident 由本地骰子控制，不在 callEvolutionAPI 中自动补全
    // API 返回的 regionalIncident 在 mergeRegionalIncident 中验证
    if (!update.blackbox) update.blackbox = { secretActions: [], secretAssets: [] };

    return update;
  }

  let _abortController = null;
  let _isRunning = false;
  let _lastError = '';

  async function evolve(state, userMsg, aiMsg, opts) {
    if (_isRunning) {
      console.warn('[世界引擎] ⚠️ 已有推演正在进行，跳过重复请求');
      _lastError = '已有推演正在进行';
      return false;
    }
    _lastError = '';

    delete state._terminalEventsThisRound;
    const hadStoredState = core.hasState();
    const backup = JSON.parse(JSON.stringify(state));
    // 基底由调用方显式指定（手动双按钮）：
    //   'forward' = 向前推演，从当前状态推、推完存档点前移（等同新轮次）；
    //   'redo'    = 重新推演，从存档点恢复再推、轮次不变；
    //   不传      = 自动推演，沿用 isNewRound() 判断。
    const mode = opts && opts.mode;
    const isNew = mode === 'forward' ? true
                : mode === 'redo'    ? false
                : core.isNewRound();
    // [FIX v2.3.18 移植] 基底选择三分，解耦「自动重 roll」与「redo」：
    //   isForward  = mode==='forward' 或自动新轮次（isNew=true）—— 接着当前往前推、round++、存档点前移、刷新指纹。
    //   redo       = mode==='redo'（手动卫星「重新推进」）—— 从存档点恢复基底重推、轮次=存档点轮次、不动存档点/指纹。
    //   自动重 roll = 否则（mode 未传且 !isNew）—— 对同一楼正文重新生成触发的重推，**不从存档点恢复**，
    //                直接在当前 state 上推、轮次保持当前轮、不动存档点/指纹。
    //   旧代码把「自动重 roll」也走 else 的 Object.assign(state,cp) 恢复成存档点（上一轮）再推 → 轮次回退成存档点
    //   轮次（症状B：第6轮重 roll 推演后停在5）。现纠正：只有 redo 才回存档点；自动重 roll 在当前 state 上推。
    const isForward = isNew;

    if (isForward) {
      console.log('[世界引擎] 📌 新轮次 forward');
    } else if (mode === 'redo') {
      // redo（手动「重新推进」）：从存档点 a 恢复基底重推，轮次=存档点轮次
      const cp = core.restoreCheckpoint();
      if (cp) {
        Object.assign(state, cp);
        state.memories = cp.memories || [];
        state.events = cp.events || [];
        state.factions = cp.factions || [];
        state.worldTrends = cp.worldTrends || [];
        state.winds = cp.winds || [];
        state.enemies = cp.enemies || [];
        state.influenceChain = cp.influenceChain || [];
        console.log('[世界引擎] 🔄 redo 从存档点恢复重推');
      } else {
        // [FIX 守卫] redo 必须有存档点作为基底。无存档点时（首次推演后、或仅做过 redo 从未 forward 过）拒绝执行，
        //   避免无声退化成「在当前 state 上推」+ round++ 的伪 redo。自动重 roll 不在本守卫范围（见下分支）。
        _lastError = '无存档点，无法重新推进（redo）；请先「向前推进」至少一轮再使用「重新推进」';
        console.warn('[世界引擎] ⚠️ redo 无存档点，已拒绝（不退化成伪 forward）');
        return false;
      }
    } else {
      // 自动重 roll（mode 未传且非新轮次）：对同一楼正文重新生成触发的重推。
      //   不从存档点恢复基底（存档点是「这层正文产生前」的状态，留作注入用，推演基底用当前 state）；
      //   轮次保持当前轮；不动存档点/指纹。无存档点时（首层场景）也不报错，直接在当前 state 上推。
      console.log('[世界引擎] 🔄 当前轮重新推演（自动重 roll，轮次不变）');
    }

    _isRunning = true;
    _lastError = '';
    _abortController = new AbortController();

    try {
      // 第1步：本地骰子推进事件链（全部在 b 上操作）
      forceTriggerEvents(state);

      // 第2步：风声沉寂累积与消散判定
      decayWinds(state);

      // 第3步：区域突发事件骰子
      const regionalIncidentRoll = rollRegionalIncident(state);

      // 第4步：远端动态骰子（pending 时跨轮重试，直到收到合规对象）
      const distantEventRoll = rollDistantEvent(state);

      // 第5步：近端动态骰子（与远端机制独立判定）
      const nearEventRoll = rollNearEvent(state);

      // 第6步：合并本轮本地强制指令后交给 API 做叙事更新
      const extraInstructions = [
        regionalIncidentRoll.injectPrompt,
        distantEventRoll.injectPrompt,
        nearEventRoll.injectPrompt
      ].filter(Boolean).join('\n\n');
      const update = await callEvolutionAPI(state, userMsg, aiMsg, extraInstructions, (opts && opts.dialogueText) || '');

      // 临时标记只用于确认本地随机机制确实生成了唯一合规对象，随后立即剥离。
      acceptDistantEventResult(state, update);
      acceptNearEventResult(state, update);

      // 第7步：合并 API 返回
      mergeEvents(state, update);
      mergeFactions(state, update);
      mergeWorldTrends(state, update);
      mergeWinds(state, update);
      mergeEconomy(state, update);
      mergeReputation(state, update);
      if (update.world_digest) state.worldDigest = update.world_digest;

      // 仇敌录
      mergeEnemies(state, update);

      // 影响链
      mergeInfluence(state, update);

      // economy signals 上限
      if (state.economy && state.economy.signals) {
        Lifecycle.capList(state.economy.signals, getLifecycleConfigs().economySignals.cap);
      }

      // 区域突发事件合并
      mergeRegionalIncident(state, update);

      mergeBlackbox(state, update);

      mergeCustomModules(state, update);

      // 自动清理：已消散/已失败的事件链 & 已结束的天下大势
      // - 负面终局（已消散/已失败）：下一轮即删
      // - 正面终局（已爆发/已完成）：进入终局起保留 2+level*2 轮（Lv1=4/Lv2=6/Lv3=8/Lv4=10），
      //   留出余波铺陈时间，到期自动清退
      const cleanedEvents = Lifecycle.pruneTerminal(state.events || [], getLifecycleConfigs().events, state.round);
      if (cleanedEvents.items.length !== (state.events || []).length) {
        state._terminalEventsThisRound = cleanedEvents.removed.map(e => JSON.parse(JSON.stringify(e)));
        console.log('[世界引擎] 🧹 自动清理事件链:', cleanedEvents.removed.map(e => e.name).join('、'));
      }
      state.events = cleanedEvents.items;

      const cleanedTrends = Lifecycle.pruneTerminal(state.worldTrends || [], getLifecycleConfigs().trends, state.round);
      if (cleanedTrends.items.length !== (state.worldTrends || []).length) {
        console.log('[世界引擎] 🧹 自动清理天下大势:', cleanedTrends.removed.map(t => t.name).join('、'));
      }
      state.worldTrends = cleanedTrends.items;

      state.lastEvolveResult = update;

      // [FIX v2.3.18 移植] 轮次块三分，对齐上方基底选择：
      //   isForward  → round++ + 存档点前移(saveCheckpoint) + 刷新指纹(saveFingerprint)。
      //   redo       → 轮次不变(=存档点轮次)；不存 checkpoint、不刷指纹（基底就是存档点，不动它）。
      //   自动重 roll → 轮次不变(=当前轮)；不存 checkpoint、不刷指纹。
      //     关键：自动重 roll 不 saveCheckpoint —— 存档点保持 forward 时存的「上一轮」状态，这是注入侧后续能取
      //     「这层正文产生前的世界状态」=存档点的前提；若在此前移存档点，重 roll 后注入将拿到错位状态。
      //   旧代码 round++ 无条件放在 if 之前，导致 redo/自动重 roll 也涨轮次（与注释「轮次不变」矛盾）；现移进 forward 分支。
      if (isForward) {
        // 首次推演不创建空白存档点；后续旧当前状态成为存档点并保留原层数。
        state.round++;                             // 只在 forward 涨轮次
        if (hadStoredState) core.saveCheckpoint(backup);
        core.saveFingerprint(core.getChatFingerprint());
        console.log('[世界引擎] ✅ 推演完成，新轮次第', state.round, '轮，存档点已推进');
      } else {
        const label = (mode === 'redo') ? 'redo' : '自动重roll';
        console.log('[世界引擎] ✅ 推演完成（' + label + '），轮次不变：第', state.round, '轮');
      }
      core.saveStateWithLayer(state);
      // 推演成功后自动拍一份本地存档备份（防丢存档）；失败不影响推演结果
      try { if (window.WORLD_ENGINE_BACKUP) window.WORLD_ENGINE_BACKUP.snapshot('auto'); } catch (e) {}
      return true;

    } catch(e) {
      if (e.name === 'AbortError') {
        console.log('[世界引擎] 🛑 推演已中止');
        _lastError = '已中止';
      } else {
        console.error('[世界引擎] 推演失败', e);
        _lastError = e && e.message ? e.message : '未知错误';
      }
      // API 失败时保留已经掷出的随机动态 pending 请求，下一轮继续请求同一类型；
      // 其余状态回滚。恢复语句本身可能抛错（如 IDB 在内存压力下写失败），吞掉以免跳过 finally 复位。
      const pendingDistant = state.distantEvent && state.distantEvent.pending
        ? JSON.parse(JSON.stringify(state.distantEvent))
        : null;
      const pendingNear = state.nearEvent && state.nearEvent.pending
        ? JSON.parse(JSON.stringify(state.nearEvent))
        : null;
      try {
        Object.assign(state, backup);
        if (pendingDistant) state.distantEvent = pendingDistant;
        if (pendingNear) state.nearEvent = pendingNear;
        core.saveState(state);
      } catch (_) {}
      return false;
    } finally {
      // 无论成功/失败/恢复语句抛错，都复位并发控制标志；否则后续 evolve 会被 isRunning() 守卫永久跳过
      // （即升级后内存压力下偶发"推演再也不工作了"的症状）
      _abortController = null;
      _isRunning = false;
    }
  }

  function abort() {
    if (_abortController) {
      _abortController.abort();
      console.log('[世界引擎] 🛑 发出中止信号');
    }
  }

  function isRunning() {
    return _isRunning;
  }

  function getLastError() {
    return _lastError;
  }

  window.WORLD_ENGINE_DEBUG = {
    evolve,
    callEvolutionAPI,
    forceTriggerEvents,
    decayWinds,
    state: () => core.loadState()
  };

  // 引擎段落默认文本对外只读暴露：预设 UI 的「查看默认」与占位提示用，运行时引用非拷贝
  const DEFAULT_SEGS = Object.freeze({
    engineRole: DEFAULT_SEG_ENGINE_ROLE,
    causalSteps: DEFAULT_SEG_CAUSAL_STEPS
  });
  window.WORLD_ENGINE_EVOLUTION_DEFAULT_SEGS = DEFAULT_SEGS;

  return {
    evolve, getLastDebug, abort, isRunning, getLastError, getBuiltinMergeIds, getEngineSegments, DEFAULT_SEGS,
    _BUILTIN_MERGE: BUILTIN_MERGE,
    _DICE_ENGINE: DiceEngine,
    _STAGE_MACHINE: StageMachine,
    _EVENT_STAGE_MACHINE_CONFIG: EVENT_STAGE_MACHINE_CONFIG,
    _LIFECYCLE: Lifecycle,
    _LIFECYCLE_CONFIGS: LIFECYCLE_CONFIGS,
    _GENERIC_MECHANICS: GenericMechanics,
    _GENERIC_MERGE: GenericMerge,
    _RANDOM_EVENTS: {
      getRandomEventTargets,
      pickRandomTarget,
      sampleDistantLedger,
      buildDistantEventPrompt,
      rollDistantEvent,
      acceptDistantEventResult,
      buildNearEventPrompt,
      rollNearEvent,
      acceptNearEventResult
    }
  };
})();
