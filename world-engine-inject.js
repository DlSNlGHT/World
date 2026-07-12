// world-engine-inject.js — 构建注入上下文（条件筛选，只注入影响RP的关键信息）
window.WORLD_ENGINE_INJECT = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const ledger = window.WORLD_ENGINE_LEDGER;

  // 声誉判词：把等级翻译成给正文模型看的人话，避免注入光秃秃的等级标签
  const REP_DIM_NAME = { authority: '官方与权力圈层', common: '公众与民间圈层', shadow: '非正式与地下圈层', circuit: '行业与专业圈层' };
  const REP_VERDICT = {
    authority: { // 朝堂之上 —— 守法/顺从 ↔ 挑衅/危险
      天怒人怨: '该圈层普遍将其视为严重威胁，并可能主动采取限制或追责行动',
      声名狼藉: '该圈层评价明显负面，对其保持警惕并倾向于限制合作',
      默默无闻: '该圈层对其缺乏了解，尚未形成明确评价',
      受人尊敬: '该圈层总体评价正面，愿意给予一定信任与合作机会',
      万众敬仰: '该圈层高度认可其能力与影响力，愿意优先支持其行动',
    },
    common: { // 市井之间 —— 仁善/保护 ↔ 暴戾/威胁
      天怒人怨: '公众评价极度负面，普遍回避、抵制或公开反对其行动',
      声名狼藉: '公众评价明显负面，对其缺乏信任并倾向保持距离',
      默默无闻: '公众对其缺乏了解，尚未形成广泛评价',
      受人尊敬: '公众评价总体正面，对其行为与承诺具有一定信任',
      万众敬仰: '公众评价高度正面，具有广泛认同与较强号召力',
    },
    shadow: { // 草莽之中 —— 有种/敢扛 ↔ 没种/欺弱
      天怒人怨: '该圈层普遍将其视为严重威胁，可能主动排斥或针对其行动',
      声名狼藉: '该圈层评价明显负面，缺乏合作意愿并对其保持防备',
      默默无闻: '该圈层对其缺乏了解，尚未形成明确评价',
      受人尊敬: '该圈层总体评价正面，愿意提供有限合作或信息支持',
      万众敬仰: '该圈层高度认可其能力与立场，具有较强协调和动员能力',
    },
    circuit: { // 同道之间 —— 技艺/守规/贡献 ↔ 砸招牌/背叛
      天怒人怨: '该圈层评价极度负面，可能取消合作、排除其参与或公开追责',
      声名狼藉: '该圈层评价明显负面，对其专业能力或行为可靠性缺乏信任',
      默默无闻: '该圈层对其缺乏了解，尚未建立专业评价',
      受人尊敬: '该圈层认可其专业能力与行为表现，愿意开展合作',
      万众敬仰: '该圈层高度认可其专业能力与贡献，将其视为重要参考对象',
    },
  };
  // 旧存档兼容：六级时期的"小有名气"归入"受人尊敬"
  const REP_LEGACY = { 小有名气: '受人尊敬' };
  const REP_LEVEL_NAME = {
    天怒人怨: '极度负面',
    声名狼藉: '明显负面',
    默默无闻: '缺乏关注',
    受人尊敬: '正面',
    万众敬仰: '高度认可',
  };

  // 势力运势判词：把运势词翻译成「这势力眼下什么处境、内部团不团结」
  const STATUS_VERDICT = {
    鼎盛: '资源充足、人员稳定，组织协作顺畅，具备较强的持续行动能力',
    稳固: '资源与组织结构保持稳定，能够正常推进既定事务',
    倾轧: '基本组织结构仍在，但内部存在明显分歧，决策和执行效率下降',
    困顿: '资源紧张或受到外部限制，正在维持基本运转，承受额外风险的能力较弱',
    衰落: '持续失去关键资源、影响范围或核心成员，组织稳定性明显下降',
    瓦解: '实际运作与协调能力很弱，组织结构接近解体',
  };

  // 势力关系判词：把关系词翻译成「这势力对{{user}}的行为倾向」
  const RELATION_VERDICT = {
    血盟: '与{{user}}建立高度信任的长期合作关系，会优先提供支持，并重视其安全与共同目标',
    盟友: '与{{user}}保持稳定合作，在共同利益上主动支援并共享信息，但仍保留各自边界',
    友好: '认可{{user}}，愿意优先合作并提供有限便利，但尚未建立稳定合作关系',
    中立: '对{{user}}暂无明确倾向，会依据自身目标与利益决定行动',
    冷淡: '已注意到{{user}}但合作意愿较低，倾向保持距离，暂无主动行动计划',
    敌对: '与{{user}}公开对立，可能采取施压、阻碍或直接对抗行动',
    世仇: '与{{user}}处于持续且强烈的敌对关系，可能长期采取高强度针对行动',
  };
  const RELATION_NAME = {
    血盟: '高度互信',
    盟友: '稳定合作',
    友好: '倾向合作',
    中立: '无明确立场',
    冷淡: '保持距离',
    敌对: '公开对立',
    世仇: '强烈敌对',
  };

  // 经济气候判词：把单个气候词翻译成给正文模型看的市面描述
  const CLIMATE_VERDICT = {
    繁荣: '市场活跃，流通顺畅，供需与就业保持较高水平',
    平稳: '市场运行正常，价格与供需仅有常规波动',
    衰退: '市场活动减少，需求与经营规模收缩，部分必要资源供应趋紧',
    动荡: '市场秩序不稳定，价格和供应波动显著，正常交易受到影响',
  };

  function buildContext(worldState, tags) {
    const rulesLoader = window.WORLD_ENGINE_RULES;
    const rulesSummary = rulesLoader ? rulesLoader.getCoreRulesSummary() : '';
    let injectAllLevels = false;
    try {
      const api = window.WORLD_ENGINE_API;
      const settings = api && api.getSettings ? api.getSettings() : {};
      injectAllLevels = settings.injectAllLevels === true;
    } catch (e) {}

    // 事件链：开启全等级时全部注入；否则 Lv3/4 全注入，Lv1/2 仅已爆发/已完成终局注入
    const visibleEvents = (worldState.events || []).filter(e => {
      if (injectAllLevels) return true;
      if ((e.level || 0) >= 3) return true;
      return e.stage === '已爆发' || e.stage === '已完成';
    });
    const eventsText = visibleEvents.map(e => {
      const typeName = e.type === 'progress' ? '发展事件' : '冲突事件';
      let txt = `${e.name}（${typeName}，等级 ${e.level}） ${e.stage} ${e.stageRound||1}/9`;
      if (e.evolveResult) txt += ` [${e.evolveResult}]`;
      return txt;
    }).join('；') || '无';

    // 势力：全部7级关系都注入，渲染成自然语句，运势/关系各带判词
    const formatPillars = (arr) => arr.length === 1
      ? arr[0]
      : arr.slice(0, -1).join('、') + '与' + arr[arr.length - 1];
    const allFactions = worldState.factions || [];
    const factionsText = allFactions.length
      ? '\n' + allFactions.map(f => {
          const statusDesc = STATUS_VERDICT[f.status] || (f.status ? `当前状态为「${f.status}」` : '当前状态不明');
          const relation = f.relation || '中立';
          const relationName = RELATION_NAME[relation] || relation;
          const relationDesc = RELATION_VERDICT[relation] || `对{{user}}的态度为「${relation}」`;
          let s = `- ${f.name}：${statusDesc}；与{{user}}的关系为${relationName}——${relationDesc}。`;
          if (f.scope) s += `活动或影响范围为${f.scope}。`;
          if (f.currentGoal) s += `当前目标为${f.currentGoal}。`;
          const tail = [];
          if (f.core_person) tail.push(`核心人物是${f.core_person}`);
          if (f.powerPillars?.length) tail.push(`主要资源或能力来源为${formatPillars(f.powerPillars)}`);
          if (tail.length) s += tail.join('，') + '。';
          return s;
        }).join('\n')
      : '无';

    // 风声：开启全等级时全部注入；否则只注入 Lv3/4
    const windTypeNames = { announcement: '公告', report: '消息', rumor: '流言', sentiment: '舆情' };
    const visibleWinds = (worldState.winds || []).filter(w => injectAllLevels || (w.level || 0) >= 3);
    const windsText = visibleWinds.map(w =>
      `[${windTypeNames[w.type] || '信息'} 等级 ${w.level || 1} ${w.scope || '?'}] ${w.content}`
    ).join('；') || '无';

    // 天下大势
    const trendsText = (worldState.worldTrends || []).filter(t => t.status !== '已结束').map(t =>
      `${t.name}（${t.scope || '全局'}）：${t.description}`
    ).join('；') || '无';

    // 声誉：注入人话判词，而非光秃秃的等级标签
    const rep = worldState.reputation || {};
    const repText = ['authority', 'common', 'shadow', 'circuit'].map(k => {
      const lv = REP_LEGACY[rep[k]] || rep[k];
      const verdict = REP_VERDICT[k] && REP_VERDICT[k][lv];
      if (!verdict) return '';
      return `${REP_DIM_NAME[k]}：评价等级为${REP_LEVEL_NAME[lv] || lv}；${verdict}`;
    }).filter(Boolean).join('。') + '。';
    const repChange = rep.lastChange ? `（${rep.lastChange}）` : '';

    // 经济信号：全注入
    const econ = worldState.economy || {};
    const signalsText = (econ.signals || []).map(s => `${s.summary}（${s.scope}）`).join('；');
    const climate = econ.climate || '平稳';
    const climateText = `市场状态为${climate}：${CLIMATE_VERDICT[climate] || CLIMATE_VERDICT['平稳']}`;
    const econText = `${climateText}${signalsText ? '。市场信号：' + signalsText : ''}`;

    // 仇敌录
    let enemiesText = '无';
    if (worldState.enemies && worldState.enemies.length) {
      enemiesText = worldState.enemies.map(e =>
        `${e.name}（${e.type==='blood'?'严重对立':'一般对立'}，${e.status}，原因：${e.reason}）`
      ).join('；');
    }

    // 区域突发事件
    const ri = worldState.regionalIncident || {};
    let riText = '';
    if (ri.active) {
      riText = `⚠️ ${ri.title || '区域突发事件'}（${ri.type || '?'}，${ri.scope || '?'}）— ${ri.impact || ''}`;
    } else {
      riText = ri.title && ri.title.includes('重试') ? `⚠️ ${ri.title}` : '本轮无新增区域事件';
    }

    // 信息黑盒：展示具体内容
    const blackbox = worldState.blackbox || {};
    const boxParts = [];
    if (blackbox.secretActions?.length) {
      const actionsText = blackbox.secretActions.map(a =>
        `[行为] ${a.action || '?'}（目击:${a.witnesses || '无'}）`
      ).join('；');
      boxParts.push(`未公开行为(${blackbox.secretActions.length})：${actionsText}`);
    }
    if (blackbox.secretAssets?.length) {
      const assetsText = blackbox.secretAssets.map(a =>
        `[资产] ${a.name || '?'}（暴露:${a.exposure || 0}%，${a.status || '有效'}）`
      ).join('；');
      boxParts.push(`未公开资源(${blackbox.secretAssets.length})：${assetsText}`);
    }
    const blackboxText = boxParts.length ? boxParts.join(' | ') : '无未公开信息';

    const context = `
【世界信息】
更新轮次：${worldState.round}
摘要：${worldState.worldDigest}
全局动态：${trendsText}
进行中的事件：${eventsText}
组织与关系：${factionsText}
公开信息与舆情：${windsText}
对立关系：${enemiesText}
社会评价：${repText}${repChange}
经济：${econText}
区域动态：${riText}
未公开信息：${blackboxText}

${rulesSummary}
    `.trim();

    let maxChars = 5000;
    try {
      const api = window.WORLD_ENGINE_API;
      const settings = api && api.getSettings ? api.getSettings() : {};
      const configured = Number(settings.injectMaxChars);
      if (Number.isFinite(configured)) maxChars = Math.max(0, Math.floor(configured));
    } catch (e) {}
    return maxChars > 0 ? context.substring(0, maxChars) : context;
  }

  return { buildContext };
})();
