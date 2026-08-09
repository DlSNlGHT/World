// world-engine-ui.js — 完整 UI 面板
window.WORLD_ENGINE_UI = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const evolution = window.WORLD_ENGINE_EVOLUTION;

  let panelElement = null;
  let panelBodyElement = null;
  let panelVisible = false;
  let isEvolving = false;
  let editingEvent = null;
  let editingFaction = null;
  let editingWind = null;
  let editingTrend = null;
  let editingDigest = null;
  let editingEnemy = null;
  let editingInfluence = null;
  let editingRI = null;
  // 秘密编辑器统一态：{ scope, list:'action'|'asset', index, view:'action'|'asset' }
  //   list  = 条目当前所在的桶；index = 在该桶里的下标
  //   view  = 当前显示的表单类型（切下拉只改 view，不动数据；转换延到保存）
  let editingSecret = null;
  let editingEconomy = null;
  let listPagerCounter = 0;
  const listPageState = {};
  const sectionCollapsed = { 'checkpoint-section': true, 'set-filter': true };
  const expandedWorldbookGroups = new Set();
  // 世界书缓存（模块级，跨 refresh() 存活）
  let _wbCachedEntries = null;
  let _wbCachedSelectedIds = null;
  let _wbCachedChatId = null;
  let _wbScrollTop = 0;

  function h(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[m] || m));
  }

  /** 渲染用户可见文本：将 {{user}} 替换为当前角色名，并转义 HTML */
  function u(text) {
    return h(core.renderUserName(text));
  }

  function showToast(msg, isError, duration) {
    const id = 'we-toast';
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'we-toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    if (duration !== 0) setTimeout(() => el.remove(), duration || 3000);
  }

  // 各分页小标题的随附古文（去 cp- 前缀后查表；设置页等不在表中则无）
  const SECTION_MOTTOS = {
    trends: '天下之势，以渐而成',
    regional: '一方有警，四面皆惊',
    ledger: '毫厘皆有来历',
    events: '牵一发而全身动',
    winds: '风起于青萍之末',
    influence: '牵枝而动叶',
    reputation: '人之有誉，如影随形',
    factions: '大树之下，草不沾霜',
    enemies: '仇者快，亲者痛',
    economy: '食者民之本，货者民用之资',
    blackbox: '墙有耳，伏寇在侧'
  };

  function sectionHeader(title, sectionId) {
    const collapsed = sectionCollapsed[sectionId] || false;
    const motto = UMOTTO(sectionId.replace(/^cp-/, ''));
    const mottoHtml = motto ? `<span class="we-section-motto">— ${motto}</span>` : '';
    return `<span class="we-section-toggle" data-section="${sectionId}">
      <span class="we-section-arrow" id="we-section-arrow-${sectionId}">${collapsed ? '▶' : '▼'}</span>${UL(title)}${mottoHtml}
    </span>`;
  }

  function sectionBody(sectionId, content) {
    const collapsed = sectionCollapsed[sectionId] || false;
    return `<div class="we-section-body" id="we-section-body-${sectionId}" style="${collapsed ? 'display:none' : ''}">${content}</div>`;
  }

  function buildPanel() {
    if (document.getElementById('we-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'we-panel';
    panel.innerHTML = `
      <div class="we-panel-header">
        <div class="we-header-info">
          <div class="we-header-top">
            <span class="we-panel-title">世界引擎</span>
            <span class="we-header-round" id="we-header-round"></span>
            <span class="we-header-evolve" id="we-header-evolve">
              <button class="we-hdr-btn we-hdr-forward" title="向前推进"><i class="fa-solid fa-forward"></i></button>
              <button class="we-hdr-btn we-hdr-redo" title="重新推进"><i class="fa-solid fa-rotate-right"></i></button>
              <button class="we-hdr-btn we-hdr-abort we-hdr-btn-off" title="停止推演"><i class="fa-solid fa-stop"></i></button>
              <button class="we-hdr-btn we-hdr-power" title="插上=关闭推演与注入 / 拔下=开启"><i class="fa-solid fa-power-off"></i></button>
            </span>
          </div>
          <div class="we-header-mood" id="we-header-mood">
            <span class="we-header-dot"></span>
            <span class="we-header-mood-text"></span>
          </div>
        </div>
        <div class="we-panel-corner-actions">
          <button class="we-panel-close">✕</button>
          <button class="we-panel-settings" id="we-btn-settings-open" title="设置"><i class="fa-solid fa-gear"></i></button>
        </div>
      </div>
      <div class="we-panel-body" id="we-panel-body">
        <div class="we-loading">加载中...</div>
      </div>
      <div class="we-panel-resize" title="拖拽调整大小"></div>
    `;
    document.body.appendChild(panel);
    panelElement = panel;
    panelBodyElement = panel.querySelector('#we-panel-body');

    panel.querySelector('.we-panel-close').onclick = () => hidePanel();

    // 标题栏推进按钮组（悬浮球关闭时的替代入口；we-hdr-btn-off 时不可点）
    const hdrWire = (cls, fn) => {
      const el = panel.querySelector(cls);
      if (!el) return;
      el.onclick = (e) => {
        e.stopPropagation(); e.preventDefault();
        if (el.classList.contains('we-hdr-btn-off')) return;
        fn();
      };
    };
    hdrWire('.we-hdr-forward', () => runManualEvolve('forward', 'state'));
    hdrWire('.we-hdr-redo', () => runManualEvolve('redo', 'checkpoint'));
    hdrWire('.we-hdr-abort', () => { evolution.abort(); showToast('已发送停止信号'); });
    hdrWire('.we-hdr-power', togglePowerSwitch);
    updateHeaderEvolveVisibility();

    initDrag(panel, panel.querySelector('.we-panel-header'));
    initResize(panel, panel.querySelector('.we-panel-resize'));
    applySavedPanelRect(panel);

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panelVisible) hidePanel();
    });
  }

  // 当前视图：'home' | 'situation' | 'events' | 'relations' | 'resources' | 'settings'
  let _currentView = 'home';
  // 显示模式：'mask'=遮蔽（主页+分页）｜'expand'=展开（所有 section 平铺）
  function isExpandMode() {
    const s = window.WORLD_ENGINE_API
      ? window.WORLD_ENGINE_API.getSettings()
      : JSON.parse(window.WORLD_ENGINE_STORE.getItem('world_engine_settings') || '{}');
    return s.displayMode === 'expand';
  }
  // 主页导航：单击选中的行（再次单击才进入）
  let _selectedNavView = null;
  // 推演进行中标志 + 本次推演的显示基底：
  //   'checkpoint' = 重新推演（喂存档点 B，面板显示 B）
  //   'state'      = 向前推演（喂当前状态 A，面板显示 A）
  // 推演期间新结果还没写回，靠这俩决定面板显示哪份，等写回再翻新。
  let _evolving = false;
  let _evolvingScope = 'state';
  // 最近一次实际注入正文的状态桶；普通刷新必须跟随它，不能重新按瞬时楼层猜测。
  let _injectedScope = null;

  /**
   * 计算此刻实际注入正文的那一份世界状态（与 world-engine.js
   * applyInjectionForCurrentRound 用同一条楼层判断）：
   *   对话层数 < 当前状态层数 且有存档点 → 注入/显示存档点（重 roll 回退）
   *   否则 → 注入/显示当前状态
   * 返回的 scope 同时决定编辑写回哪个存储桶。
   */
  function getActiveInjected(state, checkpoint) {
    // 推演进行中：新结果还没写回，按本次推演的基底显示——
    //   重新推演（_evolvingScope='checkpoint'）→ 显示存档点 B；
    //   向前推演（_evolvingScope='state'）   → 显示当前状态 A。
    if (_evolving) {
      if (_evolvingScope === 'checkpoint' && checkpoint) {
        return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
      }
      return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
    }
    if (_injectedScope === 'checkpoint' && checkpoint) {
      return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
    }
    if (_injectedScope === 'state') {
      return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
    }
    const chatLayer = core.getChatLayer();
    const stateLayer = Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : chatLayer;
    if (chatLayer < stateLayer && checkpoint) {
      return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
    }
    return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
  }

  // 按当前显示/编辑的存储桶读写：scope==='checkpoint' 读写存档点，其余读写主状态。
  // 面板可能正在显示存档点（重 roll 回退）或设置页的存档点小节，此时所有编辑必须
  // 写回存档点而非主状态，否则“数据变了、界面不动 / 点了没反应”（与风声同源的毛病）。
  function loadScopedState(scope) {
    return scope === 'checkpoint' ? core.restoreCheckpoint() : core.loadState();
  }
  function saveScopedState(scope, scopedState) {
    if (scope === 'checkpoint') core.saveCheckpoint(scopedState);
    else core.saveState(scopedState);
  }

  // [移植 v2.3.20] 任一编辑器处于输入状态：后台自动刷新须暂缓
  function isEditingPanelContent() {
    if (editingEvent || editingFaction || editingWind || editingTrend || editingDigest ||
        editingEnemy || editingInfluence || editingRI || editingSecret || editingEconomy) return true;

    // 少数内容使用 contentEditable 行内编辑，不经过上面的编辑状态变量。
    const active = document.activeElement;
    return !!(active && panelBodyElement && panelBodyElement.contains(active) && active.isContentEditable);
  }

  function refresh(auto) {
    if (!panelElement || !panelVisible) return;
    // 后台自动刷新会整块重建 DOM：设置页或任何编辑器正在输入时必须暂缓，
    // 否则未保存内容会被持久化数据覆盖，表现为输入框不断“回弹”。
    // 保存、取消等主动调用 refresh()（auto=false）仍会正常刷新。
    if (auto && (_currentView === 'settings' || isEditingPanelContent())) return;
    const body = panelBodyElement;
    if (!body) return;
    listPagerCounter = 0;

    const state = core.loadState();
    const checkpoint = core.restoreCheckpoint();
    const cpLayer = getCheckpointLayer(checkpoint);
    const active = getActiveInjected(state, checkpoint);
    const s = active.state;

    const _wbListEl = document.getElementById('we-worldbook-list');
    if (_wbListEl) _wbScrollTop = _wbListEl.scrollTop;

    if (_currentView === 'home') {
      body.innerHTML = isExpandMode()
        ? renderHomeViewExpanded(s, active.layer, active.scope)
        : renderHomeView(s, active.layer, active.scope);
    } else if (_currentView === 'settings') {
      body.innerHTML = renderSettingsView(checkpoint, cpLayer);
    } else {
      body.innerHTML = renderSubView(_currentView, s, active.layer, active.scope);
    }

    updatePanelHeader(s, active.layer);
    bindEvents(state);
  }

  /**
   * 世界稳定度（纯 UI 现算，只读，不写存档/不进 prompt/不返 API）
   * 稳定度 = clamp(100 - 世界压力, 0, 100)
   */
  function computeWorldStability(state) {
    state = state || {};
    const round = Number(state.round) || 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // 事件链：仅 Lv3/4，单条封顶 60
    const CONFLICT_BASE = { 萌芽:0, 发酵:1, 逼近:2, 已爆发:4, 已消散:0 };
    const PROGRESS_BASE = { 筹备:0, 执行:1, 关键:2, 已完成:-2, 已失败:0 };
    let eventP = 0;
    for (const e of (state.events || [])) {
      const level = Number(e.level) || 1;
      if (level < 3) continue;
      const isProgress = e.type === 'progress';
      const base = isProgress ? PROGRESS_BASE : CONFLICT_BASE;
      const keepTotal = 2 + level * 2;
      const remainFactor = () => {
        if (e._terminalSince === undefined) return 1;
        return clamp((keepTotal - (round - e._terminalSince)) / keepTotal, 0, 1);
      };
      let p;
      if (e.stage === '已爆发') p = 4 * level * 0.5 * remainFactor();
      else if (e.stage === '已完成') p = -2 * remainFactor();        // 不乘 level
      else if (e.stage === '已消散' || e.stage === '已失败') p = 0;
      else p = (base[e.stage] || 0) * level * 0.5;
      if (e.stall) p *= 0.65;
      eventP += clamp(p, -60, 60);
    }

    // 风声：仅 Lv3/4，总封顶 25
    const WIND_BASE = { rumor:0.5, announcement:1, report:1.5, sentiment:2 };
    let windP = 0;
    for (const w of (state.winds || [])) {
      const level = Number(w.level) || 1;
      if (level < 3) continue;
      windP += (WIND_BASE[w.type] || 0) * level;
    }
    windP = Math.min(windP, 25);

    // 天下大势：每条持续中 +6，总封顶 20
    let trendP = 0;
    for (const t of (state.worldTrends || [])) if (t.status !== '已结束') trendP += 6;
    trendP = Math.min(trendP, 20);

    // 势力：关系值 × 状态系数，总封顶 35
    const REL = { 血盟:-1.5, 盟友:-1, 友好:-0.5, 中立:0, 冷淡:0.5, 敌对:1, 世仇:1.5 };
    const STAT = { 鼎盛:1.25, 稳固:1, 倾轧:0.75, 困顿:0.5, 衰落:0.25, 瓦解:0 };
    let factionP = 0;
    for (const f of (state.factions || [])) {
      const rel = REL[f.relation] !== undefined ? REL[f.relation] : 0;
      const st = STAT[f.status] !== undefined ? STAT[f.status] : 1;
      factionP += rel * st;
    }
    factionP = clamp(factionP, -35, 35);

    // 经济：只看 climate
    const CLIMATE = { 繁荣:-2, 平稳:0, 衰退:1, 动荡:2 };
    const econP = CLIMATE[(state.economy || {}).climate] || 0;

    // 区域突发：激活 +5
    const regionP = (state.regionalIncident && state.regionalIncident.active) ? 5 : 0;

    // 仇敌、黑盒：按设定不计入世界稳定度

    const pressure = eventP + windP + trendP + factionP + econP + regionP;
    const stability = Number(clamp(100 - pressure, 0, 100).toFixed(1));
    const tier =
      stability >= 90 ? '天下太平' :
      stability >= 70 ? '暗流浮动' :
      stability >= 45 ? '局势紧张' :
      stability >= 20 ? '动荡失序' : '崩坏边缘';

    const r1 = v => Number(v.toFixed(1));
    return {
      stability, tier, pressure: r1(pressure),
      breakdown: {
        事件: r1(eventP), 风声: r1(windP), 大势: r1(trendP), 势力: r1(factionP),
        经济: r1(econP), 区域: r1(regionP)
      }
    };
  }

  // ── world-view chrome label accessors (delegate to active preset) ──
  function _PRE() { return window.WORLD_ENGINE_PRESETS; }
  function UL(x) { var P = _PRE(); return (P && P.uiLabel) ? P.uiLabel(x) : x; }
  function ULsub(sub) { return String(sub).split(' \u00b7 ').map(function (x) { return UL(x.trim()); }).join(' \u00b7 '); }
  function UMOOD(tier, fb) { var P = _PRE(); return (P && P.uiMood) ? (P.uiMood(tier) || fb || '') : (fb || ''); }
  function UPOEM(view, fb) { var P = _PRE(); return (P && P.uiPoem) ? P.uiPoem(view) : (fb != null ? fb : ''); }
  function UMOTTO(id) { var P = _PRE(); return (P && P.uiMotto) ? P.uiMotto(id) : (SECTION_MOTTOS[id] || ''); }
  function USUM() { var P = _PRE(); return (P && P.uiSummaryEmpty) ? P.uiSummaryEmpty() : '\u4e16\u754c\u6b63\u5728\u82cf\u9192\uff0c\u4e00\u5207\u5c1a\u672a\u53ef\u77e5\u3002'; }
  function digestHtml(s) { var d = s && s.worldDigest; if (!d || d === '\u4e16\u754c\u6b63\u5728\u82cf\u9192\uff0c\u4e00\u5207\u5c1a\u672a\u53ef\u77e5\u3002') return USUM(); return u(d); }

  // [\u79fb\u690d v2.3.20] \u4e16\u754c\u6458\u8981\u5361\u7247\uff1a\u884c\u5185\u7f16\u8f91\u5165\u53e3\uff08\u4ec5\u7f16\u8f91\uff0c\u4e0d\u63d0\u4f9b\u590d\u5236\u6216\u5220\u9664\uff09\u3002
  //   \u663e\u793a\u8d70 digestHtml\uff08\u7a7a\u6458\u8981\u7ed9\u9884\u8bbe\u5360\u4f4d\u8bed\uff09\uff0c\u7f16\u8f91\u6846\u91cc\u662f\u539f\u59cb worldDigest\u3002
  function renderWorldDigest(s, scope) {
    const isEditing = editingDigest?.scope === scope;
    const editor = isEditing
      ? '<div class="we-event-editor we-digest-editor" data-digest-scope="' + h(scope) + '">'
        + '<button class="we-event-editor-close we-digest-editor-close" title="\u53d6\u6d88"><i class="fa-solid fa-xmark"></i></button>'
        + '<textarea class="we-digest-edit-text" rows="6">' + h(s.worldDigest || '') + '</textarea>'
        + '<div class="we-event-editor-footer"><button class="we-btn we-btn-primary we-digest-editor-save">\u4fdd\u5b58</button></div>'
        + '</div>'
      : '<div class="we-digest">' + digestHtml(s) + '</div>';

    return '<div class="we-section we-digest-card" id="we-sec-digest">'
      + '<div class="we-section-title">' + UL('\u4e16\u754c\u6458\u8981') + '</div>'
      + editor
      + '<div class="we-event-actions">'
      + '<button class="we-icon-btn we-digest-edit" data-digest-scope="' + h(scope) + '" title="\u7f16\u8f91"><i class="fa-solid fa-pen"></i></button>'
      + '</div></div>';
  }

  const STABILITY_TIER_COLOR = {
    天下太平: '#69b68e', 暗流浮动: '#58b8a9', 局势紧张: '#d0aa58',
    动荡失序: '#d98a3d', 崩坏边缘: '#ff0000'
  };

  // 稳定度档位 → 头部小字（诗句）
  const STABILITY_TIER_MOOD = {
    天下太平: '海静不扬波', 暗流浮动: '暗水带花流', 局势紧张: '云急风更恶',
    动荡失序: '乾坤含疮痍', 崩坏边缘: '坤轴欹将折'
  };
  const FREE_STABILITY_TIER_LABEL = {
    天下太平: '稳定', 暗流浮动: '轻微波动', 局势紧张: '压力上升',
    动荡失序: '高压失序', 崩坏边缘: '临界崩坏'
  };

  const FREE_STABILITY_TIER_MOOD = {
    天下太平: '运行稳定', 暗流浮动: '局部波动', 局势紧张: '风险升高',
    动荡失序: '秩序承压', 崩坏边缘: '临界警报'
  };

  function stabilityTierText(tier) {
    return isFreePresetMode() ? (FREE_STABILITY_TIER_LABEL[tier] || tier) : UL(tier);
  }

  function stabilityMoodText(tier) {
    const fallback = isFreePresetMode() ? FREE_STABILITY_TIER_MOOD[tier] : STABILITY_TIER_MOOD[tier];
    return UMOOD(tier, fallback || '');
  }

  // 自由模式：按 headerMood 配置，从某个自定义模块的字段值匹配出顶部短语。
  // 数值值用 min 从高到低分档；字符串/枚举值用 value 精确匹配。命中返回 {text, color}，否则 null。
  function matchHeaderTier(tiers, value, fallback) {
    if (!Array.isArray(tiers)) return null;
    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i] && tiers[i].value !== undefined && String(tiers[i].value) === String(value)) {
        return { text: tiers[i].phrase, color: tiers[i].color };
      }
    }
    const num = Number(value);
    if (Number.isFinite(num) && String(value).trim() !== '') {
      let best = null;
      for (let j = 0; j < tiers.length; j++) {
        if (tiers[j] && tiers[j].min !== undefined && num >= tiers[j].min) {
          if (!best || tiers[j].min > best.min) best = tiers[j];
        }
      }
      if (best) return { text: best.phrase, color: best.color };
    }
    if (fallback) return { text: fallback, color: undefined };
    return null;
  }

  function freeHeaderMoodFromModules(state) {
    if (!isFreePresetMode()) return null;
    const P = _PRE();
    const preset = P && P.getActivePreset && P.getActivePreset();
    const hm = preset && preset.headerMood;
    if (!hm || !hm.module) return null;
    // 模板自带的初始/兜底短语：只要预设定义了 headerMood，就用它替换默认的「海静不扬波」
    const def = hm.fallback ? { text: hm.fallback, color: hm.color } : null;
    const descriptors = getActiveRenderDescriptors();
    let desc = null;
    for (let i = 0; i < descriptors.length; i++) {
      if (descriptors[i] && descriptors[i].id === hm.module && descriptors[i].enabled !== false) { desc = descriptors[i]; break; }
    }
    if (!desc) return def;
    const field = desc.field || desc.id;
    const base = state && Object.prototype.hasOwnProperty.call(state, field) ? state[field] : undefined;
    let cur;
    if (desc.container === 'array') {
      const arr = Array.isArray(base) ? base : [];
      const last = arr.length ? arr[arr.length - 1] : null;
      cur = (last && typeof last === 'object' && hm.field) ? last[hm.field] : last;
    } else if (desc.container === 'object') {
      cur = (base && typeof base === 'object' && hm.field) ? base[hm.field] : base;
    } else {
      cur = base;
    }
    if (cur == null || cur === '') return def;
    return matchHeaderTier(hm.tiers, cur) || def;
  }

  function worldCoreTitleText() {
    return isFreePresetMode() ? UL('世界概览') : UL('世界核心');
  }

  /** 刷新头部的「第X轮 + 稳定度小字」 */
  function updatePanelHeader(state, layer) {
    const roundEl = document.getElementById('we-header-round');
    if (roundEl) {
      const layerText = (layer !== undefined && layer !== null && layer !== '-') ? ' · 第 ' + layer + ' 层' : '';
      roundEl.textContent = '第 ' + ((state && state.round) || 0) + ' 轮' + layerText;
    }
    const moodEl = document.getElementById('we-header-mood');
    if (moodEl && !isStabilityShown()) { moodEl.style.display = 'none'; return; }
    if (moodEl) {
      moodEl.style.display = '';
      const stab = computeWorldStability(state || {});
      let color = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';
      let text = stabilityMoodText(stab.tier);
      const hm = freeHeaderMoodFromModules(state || {});
      if (hm && hm.text) {
        text = hm.text;
        if (hm.color) color = hm.color;
      }
      const dot = moodEl.querySelector('.we-header-dot');
      const txt = moodEl.querySelector('.we-header-mood-text');
      if (dot) { dot.style.background = color; dot.style.boxShadow = '0 0 6px ' + color; }
      if (txt) { txt.textContent = text; txt.style.color = color; }
    }
  }

  const VIEW_TITLES = {
    situation: '局势', events: '事件', relations: '关系', resources: '资源', settings: '设置'
  };
  const SETTINGS_TABS = [
    { key: 'common', label: '常用' },
    { key: 'filter', label: '过滤' },
    { key: 'preset', label: '预设' },
    { key: 'worldbook', label: '世界书' },
    { key: 'data', label: '数据' },
    { key: 'mechanics', label: '本地机制' },
    { key: 'debug', label: '调试' }
  ];
  let _settingsTab = 'common';

  function renderSection(title, id, content) {
    return '<div class="we-section" id="we-sec-' + id + '"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' + sectionBody(id, content) + '</div>';
  }

  function getHomeDescriptors() {
    return getActiveRenderDescriptors().filter(function (descriptor) {
      return descriptor && descriptor.enabled !== false && descriptor.container !== 'none';
    });
  }

  function descriptorHomeTitle(descriptor) {
    const builtin = descriptor && descriptor.kind === 'builtin' && BUILTIN_RENDER[descriptor.id];
    return builtin ? UL(builtin.title) : (descriptor.name || descriptor.title || descriptor.id || descriptor.field || '模块');
  }

  function descriptorHomeSub(descriptor) {
    if (!descriptor) return '';
    const display = descriptor.display || {};
    const fields = []
      .concat(display.badgeFields || [])
      .concat(display.bodyFields || display.fields || [])
      .concat(display.columns || [])
      .filter(Boolean);
    const unique = fields.filter(function (field, index) { return fields.indexOf(field) === index; }).slice(0, 3);
    if (unique.length) return unique.map(function (field) { return genericFieldLabel(descriptor, field); }).join(' · ');
    return descriptor.field || descriptor.container || descriptor.id || '';
  }

  function descriptorHomeCount(descriptor, state) {
    if (!descriptor || !state) return 0;
    const builtin = descriptor.kind === 'builtin' && BUILTIN_RENDER[descriptor.id];
    const field = builtin ? builtin.field : (descriptor.field || descriptor.id);
    const value = state[field];
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') {
      const nestedArrayCount = Object.keys(value).reduce(function (sum, key) {
        return sum + (Array.isArray(value[key]) ? value[key].length : 0);
      }, 0);
      return nestedArrayCount || (Object.keys(value).length ? 1 : 0);
    }
    return value == null || value === '' ? 0 : 1;
  }

  function getFreeCoreStats(s) {
    const stats = getHomeDescriptors().slice(0, 4).map(function (descriptor) {
      return [descriptorHomeTitle(descriptor), descriptorHomeCount(descriptor, s)];
    });
    while (stats.length < 4) stats.push(['模块', 0]);
    return stats;
  }

  function renderFreeHomeView(s, layer, scope) {
    const stab = computeWorldStability(s);
    const tierColor = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';
    const descriptors = getHomeDescriptors();
    const navRows = descriptors.length ? descriptors.map(function (descriptor, i) {
      const topLine = i === 0 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const botLine = i === descriptors.length - 1 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const sub = descriptorHomeSub(descriptor);
      const count = descriptorHomeCount(descriptor, s);
      const countHtml = '<span class="we-nav-poem">' + count + '</span>';
      return '<div class="we-nav-row" data-view="situation">'
        + '<div class="we-nav-label">' + u(descriptorHomeTitle(descriptor)) + '</div>'
        + '<div class="we-nav-track">' + topLine + '<div class="we-nav-dot"></div>' + botLine + '</div>'
        + '<div class="we-nav-content"><span class="we-nav-sub">' + u(sub) + '</span>' + countHtml + '</div>'
        + '<i class="fa-solid fa-chevron-right we-nav-arrow"></i>'
        + '</div>';
    }).join('') : '<div class="we-empty">暂无可显示模块</div>';

    return renderWorldCore(s)
      + '<div class="we-nav-list" style="--we-tier-color:' + tierColor + ';">' + navRows + '</div>'
      + renderWorldDigest(s, scope);
  }

  function renderHomeView(s, layer, scope) {
    if (isFreePresetMode()) return renderFreeHomeView(s, layer, scope);
    const stab = computeWorldStability(s);
    const tierColor = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';

    const rows = [
      { view: 'situation', label: '局势', sub: '天下大势 · 区域事件 · 账本', poem: '天下云集响应' },
      { view: 'events',    label: '事件', sub: '事件链 · 风声 · 影响链',     poem: '事至而应' },
      { view: 'relations', label: '关系', sub: '声誉 · 势力 · 仇敌录',       poem: '同声相应，同气相求' },
      { view: 'resources', label: '资源', sub: '经济 · 秘密',               poem: '地藏无尽藏' },
    ];

    const navRows = rows.map((r, i) => {
      const topLine = i === 0 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const botLine = i === rows.length - 1 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const sel = _selectedNavView === r.view ? ' we-nav-row--selected' : '';
      const navPoem = UPOEM(r.view, r.poem);
      const poemHtml = navPoem ? '<span class="we-nav-poem">' + navPoem + '</span>' : '';
      return '<div class="we-nav-row' + sel + '" data-view="' + r.view + '">'
        + '<div class="we-nav-label">' + UL(r.label) + '</div>'
        + '<div class="we-nav-track">' + topLine + '<div class="we-nav-dot"></div>' + botLine + '</div>'
        + '<div class="we-nav-content"><span class="we-nav-sub">' + ULsub(r.sub) + '</span>' + poemHtml + '</div>'
        + '<i class="fa-solid fa-chevron-right we-nav-arrow"></i>'
        + '</div>';
    }).join('');

    return renderWorldCore(s)
      + '<div class="we-nav-list" style="--we-tier-color:' + tierColor + ';">' + navRows + '</div>'
      + renderWorldDigest(s, scope);
  }

  function genericValueText(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) return value.map(genericValueText).filter(Boolean).join('、');
    if (typeof value === 'object') return Object.keys(value).map(k => k + ': ' + genericValueText(value[k])).join('；');
    return String(value);
  }

  function genericFieldLabel(descriptor, field) {
    const spec = descriptor && descriptor.fields && descriptor.fields[field];
    return (spec && (spec.label || spec.description && field)) || field;
  }

  function genericVisibleFields(descriptor, item, preferred) {
    const fields = [];
    (preferred || []).forEach(f => { if (f && fields.indexOf(f) === -1) fields.push(f); });
    Object.keys((descriptor && descriptor.fields) || {}).forEach(f => {
      const spec = descriptor.fields[f] || {};
      if (spec.display === false) return;
      if (fields.indexOf(f) === -1) fields.push(f);
    });
    Object.keys(item || {}).forEach(f => { if (fields.indexOf(f) === -1) fields.push(f); });
    return fields;
  }

  function renderGenericKeyValue(descriptor, item) {
    const data = (item && typeof item === 'object' && !Array.isArray(item)) ? item : { value: item };
    const display = descriptor.display || {};
    const fields = genericVisibleFields(descriptor, data, display.fields || display.bodyFields);
    if (!fields.length) return '<div class="we-empty">暂无内容</div>';
    return '<div class="we-generic-kv">' + fields.map(field => {
      const value = genericValueText(data[field]);
      if (!value) return '';
      return '<div class="we-generic-kv-row"><span class="we-generic-kv-label">' + u(genericFieldLabel(descriptor, field)) + '</span><span class="we-generic-kv-value">' + u(value) + '</span></div>';
    }).join('') + '</div>';
  }

  function renderGenericCards(descriptor, value, scope) {
    const display = descriptor.display || {};
    const items = Array.isArray(value) ? value : [value];
    const titleField = display.titleField || descriptor.itemKey || 'name';
    const subtitleField = display.subtitleField || '';
    const badgeFields = display.badgeFields || [];
    const bodyFields = display.bodyFields || display.fields || [];
    return renderPagedList(items, 'generic-' + (descriptor.id || descriptor.field || scope || 'module'), item => {
      const data = (item && typeof item === 'object' && !Array.isArray(item)) ? item : { value: item };
      const title = genericValueText(data[titleField] || data.name || data.value || descriptor.name || descriptor.id);
      const badges = badgeFields.map(field => genericValueText(data[field])).filter(Boolean)
        .map(text => '<span class="we-badge">' + u(text) + '</span>').join('');
      const subtitle = subtitleField && data[subtitleField] ? '<div class="we-generic-card-sub">' + u(genericValueText(data[subtitleField])) + '</div>' : '';
      const fields = genericVisibleFields(descriptor, data, bodyFields).filter(field => field !== titleField && field !== subtitleField && badgeFields.indexOf(field) === -1);
      const body = fields.map(field => {
        const text = genericValueText(data[field]);
        return text ? '<div class="we-generic-kv-row"><span class="we-generic-kv-label">' + u(genericFieldLabel(descriptor, field)) + '</span><span class="we-generic-kv-value">' + u(text) + '</span></div>' : '';
      }).join('');
      const bodyHtml = body ? '<div class="we-generic-kv">' + body + '</div>' : '';
      return '<div class="we-generic-card"><div class="we-generic-card-head"><span class="we-generic-card-title">' + u(title) + '</span>' + badges + '</div>' + subtitle + bodyHtml + '</div>';
    }, display.perPage || 4);
  }

  function renderGenericTable(descriptor, value) {
    const items = Array.isArray(value) ? value : [value];
    const display = descriptor.display || {};
    const columns = genericVisibleFields(descriptor, items[0] || {}, display.columns || display.fields);
    if (!items.length || !columns.length) return '<div class="we-empty">暂无内容</div>';
    const head = '<thead><tr>' + columns.map(field => '<th>' + u(genericFieldLabel(descriptor, field)) + '</th>').join('') + '</tr></thead>';
    const body = '<tbody>' + items.map(item => {
      const data = (item && typeof item === 'object' && !Array.isArray(item)) ? item : { value: item };
      return '<tr>' + columns.map(field => '<td>' + u(genericValueText(data[field])) + '</td>').join('') + '</tr>';
    }).join('') + '</tbody>';
    return '<div class="we-generic-table-wrap"><table class="we-term-table we-generic-table">' + head + body + '</table></div>';
  }

  function renderGenericList(descriptor, value, scope) {
    const display = descriptor.display || {};
    const items = Array.isArray(value) ? value : [value];
    const titleField = display.titleField || descriptor.itemKey || 'name';
    return renderPagedList(items, 'generic-list-' + (descriptor.id || descriptor.field || scope || 'module'), item => {
      const data = (item && typeof item === 'object' && !Array.isArray(item)) ? item : { value: item };
      const title = genericValueText(data[titleField] || data.value || item);
      return '<div class="we-signal-item"><span class="we-signal-summary">' + u(title) + '</span></div>';
    }, display.perPage || 6);
  }

  function renderGenericModule(descriptor, state, scope) {
    if (!descriptor || descriptor.enabled === false || descriptor.container === 'none') return '';
    const field = descriptor.field || descriptor.id;
    const value = state && Object.prototype.hasOwnProperty.call(state, field) ? state[field] : undefined;
    const display = descriptor.display || {};
    const emptyText = display.emptyText || '暂无内容';
    if (value == null || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) {
      return '<div class="we-empty">' + u(emptyText) + '</div>';
    }
    const style = display.style || (descriptor.container === 'array' ? 'cards' : 'keyvalue');
    if (style === 'table') return renderGenericTable(descriptor, value, scope);
    if (style === 'keyvalue') return renderGenericKeyValue(descriptor, value, scope);
    if (style === 'list') return renderGenericList(descriptor, value, scope);
    return renderGenericCards(descriptor, value, scope);
  }

  // 内置模块渲染分发表（moduleId → {title, field, fn}），与 evolution 的 BUILTIN_MERGE 对应。
  // 视图按 id 查表渲染；为 Phase 3 自由/混合模式的通用渲染分发铺垫。函数声明已 hoist，引用安全。
  const BUILTIN_RENDER = {
    trends:     { title: '天下大势', field: 'worldTrends',      fn: renderWorldTrends },
    regional:   { title: '区域事件', field: 'regionalIncident', fn: renderRegionalIncident },
    events:     { title: '事件链',   field: 'events',           fn: renderEventList },
    winds:      { title: '风声',     field: 'winds',            fn: renderWindList },
    influence:  { title: '影响链',   field: 'influenceChain',   fn: renderInfluenceChain },
    reputation: { title: '声誉',     field: 'reputation',       fn: renderReputation },
    factions:   { title: '势力',     field: 'factions',         fn: renderFactionList },
    enemies:    { title: '仇敌录',   field: 'enemies',          fn: renderEnemies },
    economy:    { title: '经济',     field: 'economy',          fn: renderEconomy },
    blackbox:   { title: '秘密',     field: 'blackbox',         fn: renderBlackbox }
  };
  const SUBVIEW_MODULES = {
    situation: ['trends', 'regional'],
    events:    ['events', 'winds', 'influence'],
    relations: ['reputation', 'factions', 'enemies'],
    resources: ['economy', 'blackbox']
  };
  function renderModuleSection(moduleId, s, scope, idPrefix) {
    const def = BUILTIN_RENDER[moduleId];
    if (!def) return '';
    return renderSection(def.title, (idPrefix || '') + moduleId, def.fn(s[def.field], scope));
  }

  function isFreePresetMode() {
    try {
      const preset = window.WORLD_ENGINE_PRESETS && window.WORLD_ENGINE_PRESETS.getActivePreset && window.WORLD_ENGINE_PRESETS.getActivePreset();
      return !!(preset && preset.mode === 'free');
    } catch (e) { return false; }
  }

  // 世界稳定度仪表是否显示：手动覆盖（store，按预设 id）优先，其次预设自带的
  // showStability，默认显示。关闭时隐藏世界核心环与顶部档位小字。
  function isStabilityShown() {
    try {
      const P = window.WORLD_ENGINE_PRESETS;
      const preset = P && P.getActivePreset && P.getActivePreset();
      if (!preset) return true;
      const store = window.WORLD_ENGINE_STORE;
      const ov = store && store.getItem ? store.getItem('world_engine_show_stability_' + preset.id) : null;
      if (ov === 'true') return true;
      if (ov === 'false') return false;
      return preset.showStability !== false;
    } catch (e) { return true; }
  }

  function getActiveRenderDescriptors() {
    try {
      const rules = window.WORLD_ENGINE_RULES;
      if (rules && typeof rules.getActiveModuleDescriptors === 'function') return rules.getActiveModuleDescriptors();
    } catch (e) {}
    return [];
  }

  function renderDescriptorSection(descriptor, s, scope, idPrefix) {
    if (!descriptor || descriptor.enabled === false || descriptor.container === 'none') return '';
    const builtin = descriptor.kind === 'builtin' && BUILTIN_RENDER[descriptor.id];
    if (builtin) return renderModuleSection(descriptor.id, s, scope, idPrefix);
    return renderSection(descriptor.name || descriptor.id, (idPrefix || '') + (descriptor.id || descriptor.field), renderGenericModule(descriptor, s, scope));
  }

  function renderActiveDescriptorSections(s, scope, idPrefix) {
    return getActiveRenderDescriptors().map(descriptor => renderDescriptorSection(descriptor, s, scope, idPrefix || '')).join('');
  }

  /** 展开模式主页：世界核心 + 世界摘要 + 所有 section 平铺（如存档点） */
  function renderHomeViewExpanded(s, layer, scope) {
    const order = ['trends', 'regional', 'events', 'winds', 'influence', 'reputation', 'factions', 'enemies', 'economy', 'blackbox'];
    return renderWorldCore(s)
      + renderWorldDigest(s, scope)
      + (isFreePresetMode() ? renderActiveDescriptorSections(s, scope, '') : order.map(id => renderModuleSection(id, s, scope, '')).join(''))
      + renderSection('事件账本', 'ledger', renderLedger(s.memories));
  }

  function renderSubView(viewKey, s, layer, scope) {
    let content = (isFreePresetMode() && viewKey === 'situation')
      ? renderActiveDescriptorSections(s, scope, '')
      : (SUBVIEW_MODULES[viewKey] || []).map(id => renderModuleSection(id, s, scope, '')).join('');
    if (viewKey === 'situation') {
      content += renderSection('事件账本', 'ledger', renderLedger(s.memories));
    }
    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-btn-back" title="返回"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">' + UL(VIEW_TITLES[viewKey] || viewKey) + '</span>'
      + '</div>' + content;
  }

  /** 存档点小标题：青色默认小字 + 「- N轮 - M层」 */
  function checkpointTitle(checkpoint, cpLayer) {
    if (!checkpoint) return '存档点';
    const round = checkpoint.round || 0;
    const layer = (cpLayer === undefined || cpLayer === null) ? '-' : cpLayer;
    return '存档点 - ' + round + ' 轮 - ' + layer + ' 层';
  }

  function renderSettingsView(checkpoint, cpLayer) {
    const cpContent = checkpoint
      ? renderCheckpointSections(checkpoint, cpLayer)
      : '<div class="we-empty">暂无存档点</div>';
    const presetSettings = window.WORLD_ENGINE_PRESET_UI?.renderSettingsSection
      ? window.WORLD_ENGINE_PRESET_UI.renderSettingsSection()
      : '';
    const form = renderSettingsForm();
    const extra = renderSettingsAfterCheckpoint();
    const checkpointSection = '<div class="we-section" style="margin-top:16px;"><div class="we-section-title">' + sectionHeader(checkpointTitle(checkpoint, cpLayer), 'checkpoint-section') + '</div>' + sectionBody('checkpoint-section', cpContent) + '</div>';
    const debugSection = '<div class="we-section we-debug-section" style="margin-top:8px;">'
      + '<div class="we-section-title"><span class="we-debug-toggle" title="展开或收起调试信息"><span class="we-toggle-arrow">▶</span>调试</span></div>'
      + '<div id="we-debug-body" style="display:none;">'
      + '<button class="we-btn" id="we-export-diag" style="width:100%;margin-bottom:8px;">导出诊断包</button>'
      + renderDebug() + '</div></div>';

    const panels = {
      common: (form.api || '') + (form.evolve || '') + (form.display || '') + (form.inject || ''),
      filter: (form.filter || '') + (extra.tone || ''),
      preset: presetSettings || '<div class="we-empty">预设管理模块未加载</div>',
      worldbook: extra.worldbook || '',
      data: (extra.data || '') + (extra.backup || '') + checkpointSection,
      mechanics: form.mechanics || '',
      debug: debugSection
    };

    const tabBar = '<div class="we-settings-tabs">' + SETTINGS_TABS.map(tab =>
      '<button class="we-settings-tab' + (tab.key === _settingsTab ? ' we-settings-tab--active' : '') + '" data-tab="' + tab.key + '" type="button">' + tab.label + '</button>'
    ).join('') + '</div>';
    const panelHtml = SETTINGS_TABS.map(tab =>
      '<div class="we-settings-panel" data-tab="' + tab.key + '"' + (tab.key === _settingsTab ? '' : ' style="display:none;"') + '>' + (panels[tab.key] || '') + '</div>'
    ).join('');

    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-btn-back" title="返回"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">设置</span>'
      + '</div>'
      + tabBar
      + panelHtml
      + '<div class="we-settings-save-actions we-settings-save-sticky">'
      + '<button class="we-btn" id="we-save-settings">保存设置</button>'
      + '<button class="we-btn we-btn-danger" id="we-reset-world">重置世界</button>'
      + '</div>';
  }
  function renderCheckpointSections(s, layer) {
    const order = ['trends', 'events', 'factions', 'winds', 'reputation', 'economy', 'enemies', 'influence', 'regional', 'blackbox'];
    return (isFreePresetMode() ? renderActiveDescriptorSections(s, 'checkpoint', 'cp-') : order.map(id => renderModuleSection(id, s, 'checkpoint', 'cp-')).join(''))
      + renderSection('事件账本', 'cp-ledger', renderLedger(s.memories));
  }

  const API_PROFILE_STORE_KEY = 'world_engine_api_profiles';

  function normalizeApiProfile(profile, index) {
    if (!profile || typeof profile !== 'object') return null;
    const name = String(profile.name || '').trim();
    const apiUrl = String(profile.apiUrl || '').trim();
    const apiKey = String(profile.apiKey || '');
    if (!name && !apiUrl && !apiKey) return null;
    return {
      id: String(profile.id || ('api_profile_' + Date.now() + '_' + index)),
      name: name || ('配置 ' + (index + 1)),
      apiUrl,
      apiKey,
      model: String(profile.model || ''),
      updatedAt: Number(profile.updatedAt) || 0
    };
  }

  function getApiProfiles() {
    const raw = window.WORLD_ENGINE_STORE.getItem(API_PROFILE_STORE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.profiles) ? parsed.profiles : []);
      return list.map(normalizeApiProfile).filter(Boolean);
    } catch(e) {
      return [];
    }
  }

  function saveApiProfiles(profiles) {
    const clean = (profiles || []).map(normalizeApiProfile).filter(Boolean);
    window.WORLD_ENGINE_STORE.setItem(API_PROFILE_STORE_KEY, JSON.stringify(clean));
    return clean;
  }

  function findMatchingApiProfile(apiUrl, apiKey, preferredId) {
    apiUrl = String(apiUrl || '').trim();
    apiKey = String(apiKey || '');
    const profiles = getApiProfiles();
    const preferred = profiles.find(p => p.id === preferredId && p.apiUrl === apiUrl && p.apiKey === apiKey);
    if (preferred) return preferred.id;
    const matched = profiles.find(p => p.apiUrl === apiUrl && p.apiKey === apiKey);
    return matched ? matched.id : '';
  }

  function defaultApiProfileName(apiUrl) {
    try {
      const host = new URL(apiUrl).host;
      if (host) return host;
    } catch(e) {}
    return '默认接口';
  }

  function renderApiProfileControls(settings) {
    const profiles = getApiProfiles();
    const activeId = findMatchingApiProfile(settings.apiUrl || '', settings.apiKey || '', settings.apiProfileActiveId || '');
    const options = profiles.length
      ? profiles.map(profile => '<option value="' + u(profile.id) + '" ' + (profile.id === activeId ? 'selected' : '') + '>' + u(profile.name) + '</option>').join('')
      : '<option value="">暂无配置档</option>';
    const activeProfile = profiles.find(profile => profile.id === activeId);
    const nameValue = activeProfile ? activeProfile.name : '';
    return `
      <div class="we-api-profile-box">
        <div class="we-api-profile-row">
          <div class="we-input-group we-api-profile-select">
            <label>接口配置档</label>
            <select id="we-api-profile-select">${profiles.length ? '<option value="">-- 选择配置档 --</option>' + options : options}</select>
          </div>
          <button class="we-btn" id="we-api-profile-apply" type="button" ${profiles.length ? '' : 'disabled'}>切换</button>
        </div>
        <div class="we-api-profile-row">
          <div class="we-input-group we-api-profile-name">
            <label>配置名称</label>
            <input type="text" id="we-api-profile-name" value="${u(nameValue)}" placeholder="例如：主号 / 备用 / 本地代理">
          </div>
        </div>
        <div class="we-api-profile-actions">
          <button class="we-btn we-btn-primary" id="we-api-profile-save" type="button">保存为配置档</button>
          <button class="we-btn" id="we-api-profile-update" type="button" ${activeId ? '' : 'disabled'}>更新所选</button>
          <button class="we-btn we-btn-danger" id="we-api-profile-delete" type="button" ${activeId ? '' : 'disabled'}>删除所选</button>
        </div>
      </div>`;
  }

  /** 世界核心：环形稳定度仪表 + 四格关键计数 */
  function renderWorldCore(s) {
    if (!isStabilityShown()) return '';
    const stab = computeWorldStability(s);
    const tierColor = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';
    const detail = Object.entries(stab.breakdown)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join('　') || '无压力来源';

    const R = 66, C = 2 * Math.PI * R;
    const pct = Math.max(0, Math.min(1, stab.stability / 100));
    const dash = (pct * C).toFixed(1);
    const theta = (pct * 360 - 90) * Math.PI / 180;       // 从正上方起、顺时针
    const dotX = (80 + R * Math.cos(theta)).toFixed(1);
    const dotY = (80 + R * Math.sin(theta)).toFixed(1);
    const dashNum = Number(dash);

    function arcPoint(angleDeg) {
      const rad = angleDeg * Math.PI / 180;
      return {
        x: 80 + R * Math.cos(rad),
        y: 80 + R * Math.sin(rad)
      };
    }

    function arcPath(startDeg, endDeg) {
      const a = arcPoint(startDeg);
      const b = arcPoint(endDeg);
      const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
      return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }

    const tailDeg = Math.min(36, pct * 360);
    const tailSegs = 36;
    let tailGlow = '';

    for (let i = 0; i < tailSegs; i++) {
      const t1 = i / tailSegs;
      const t2 = (i + 1) / tailSegs;

      const startDeg = -90 + pct * 360 - tailDeg + t1 * tailDeg;
      const endDeg = -90 + pct * 360 - tailDeg + t2 * tailDeg;

      const alpha = Math.pow(t2, 2.2) * 0.72;

      tailGlow += `
        <path d="${arcPath(startDeg, endDeg)}"
          fill="none"
          stroke="#ffffff"
          stroke-width="6"
          stroke-linecap="butt"
          opacity="${alpha.toFixed(3)}"/>
      `;
    }

    const stats = (isFreePresetMode() ? getFreeCoreStats(s) : [
      ['事件', (s.events || []).length],
      ['势力', (s.factions || []).length],
      ['风声', (s.winds || []).length],
      ['大势', (s.worldTrends || []).length],
    ]).map(([k, v]) => `<div class="we-core-stat"><div class="we-core-stat-k">${UL(k)}</div><div class="we-core-stat-v">${v}</div></div>`).join('');

    return `
      <div class="we-section we-core-section">
        <div class="we-core" title="各来源压力（仅 Lv3/4 计入）：${detail}　|　压力 ${stab.pressure}">
          <div class="we-core-ring">
            <svg viewBox="0 0 160 160" width="160" height="160">
              <defs>
                <filter id="weCoreDotGlow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="3.2"/>
                </filter>
              </defs>

              <circle cx="80" cy="80" r="${R}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6"/>

              <circle cx="80" cy="80" r="${R}" fill="none" stroke="${tierColor}" stroke-width="6"
                stroke-linecap="round"
                stroke-dasharray="${dash} ${(C - pct * C).toFixed(1)}"
                transform="rotate(-90 80 80)"/>

              ${tailGlow}

              <circle class="we-core-dot-glow" cx="${dotX}" cy="${dotY}" r="8" fill="#ffffff" opacity="0.14" filter="url(#weCoreDotGlow)"/>
              <circle cx="${dotX}" cy="${dotY}" r="4.6" fill="#e8fffb" opacity="0.70"/>
              <circle class="we-core-dot-core" cx="${dotX}" cy="${dotY}" r="2.5" fill="#ffffff" opacity="0.95"/>
            </svg>
            <div class="we-core-center">
              <div class="we-core-title">${worldCoreTitleText()}</div>
              <div class="we-core-sub">${UL('稳定度')}</div>
              <div class="we-core-pct" style="color:${tierColor};">${stab.stability.toFixed(1)}<span>%</span></div>
              <div class="we-core-tier" style="color:${tierColor};">${stabilityTierText(stab.tier)}</div>
            </div>
          </div>
          <div class="we-core-stats">${stats}</div>
        </div>
      </div>`;
  }

  /** 获取存档点的对话层数 */
  function getCheckpointLayer(cp) {
    if (!cp) return '-';
    return Number.isFinite(Number(cp.chatLayer)) ? Number(cp.chatLayer) : '-';
  }

  function renderPagedList(items, key, renderItem, perPage = 4) {
    const rid = `we-list-${key}-${++listPagerCounter}`;
    const totalPages = Math.ceil(items.length / perPage);
    const currentPage = Math.min(totalPages, Math.max(1, listPageState[rid] || 1));
    listPageState[rid] = currentPage;
    const pager = totalPages > 1
      ? `<div class="we-list-pager">
          <span class="we-list-arrow" data-rid="${rid}" data-dir="-1">◀</span>
          <span class="we-list-page"><span class="we-list-cur">${currentPage}</span>/${totalPages}</span>
          <span class="we-list-arrow" data-rid="${rid}" data-dir="1">▶</span>
        </div>`
      : '';
    return pager + `<div class="we-paged-list" data-rid="${rid}">` + items.map((item, index) => {
      const page = Math.floor(index / perPage) + 1;
      return `<div class="we-page-item" data-page="${page}" style="${page !== currentPage ? 'display:none;' : ''}">${renderItem(item, index)}</div>`;
    }).join('') + '</div>';
  }

  function renderEventList(events, scope) {
    if (!events || !events.length) return '<div class="we-empty">暂无事件链</div>';
    const curRound = (core.loadState() || {}).round || 0;
    return renderPagedList(events, 'events-' + scope, (e, eventIndex) => {
      const stageColors = {
        萌芽:'#d6b85a',
        发酵:'#d98a3d',
        逼近:'#cf5f3f',
        已爆发:'#b93f3f',
        已消散:'#888888',
        筹备:'#7de9d9',
        执行:'#58e8b3',
        关键:'#2a8a5d',
        已完成:'#1b5e3b',
        已失败:'#888888',
        停滞:'#6688aa'
      };
      const levelColors = {
        1: '#c0c0c0',
        2: '#f2f2f2',
        3: '#c9a45c',
        4: '#df7cff'
      };
      const color = stageColors[e.stage] || '#888';
      const levelColor = levelColors[e.level] || '#9aa6b2';
      let extras = '';
      const terminalStages = e.type === 'progress' ? ['已完成', '已失败'] : ['已爆发', '已消散'];
      const isTerminal = terminalStages.includes(e.stage);
      if (e.consecutiveFails > 0 && !isTerminal) {
        const maxFails = e.type === 'progress' ? 2 + (e.level || 1) : 6 - (e.level || 1);
        extras += ` <span class="we-badge" style="background:#6662;color:#888;">${e.consecutiveFails}/${maxFails}</span>`;
      }
      if (e.stall && !isTerminal) {
        extras += ' <span class="we-badge" style="background:#6688aa22;color:#6688aa;">停滞</span>';
      }
      let metaExtra = '';
      if (e.evolveResult && !isTerminal) {
        const resultColors = { '成功':'#7a9a7a', '保持':'#b8a070', '受挫':'#c46a6a' };
        const color = resultColors[e.evolveResult] || '#888';
        metaExtra = ` <span class="we-badge we-event-result-badge" style="--event-result:${color};">${e.evolveResult}</span>`;
      }
      // 阶段进度条
      let progressHtml = '';
      if (!isTerminal) {
        const pct = Math.round((e.stageRound / 9) * 100);

        const progressMotionClass = {
          '成功': 'we-event-progress-success',
          '保持': 'we-event-progress-hold',
          '受挫': 'we-event-progress-fail'
        }[e.evolveResult] || '';

        progressHtml = `<div class="we-event-progress ${progressMotionClass}">
          <div style="width:${pct}%;background:${color};"></div>
        </div>`;
      }
      const typeName = e.type === 'progress' ? '推进型' : '冲突型';
      const typeColor = e.type === 'progress' ? '#57b7a8' : '#cf5f3f';
      // 正面终局倒计时徽标（已爆发/已完成，保留 2+level*2 轮后自动清退）
      let countdownHtml = '';
      const POSITIVE_TERMINALS = ['已爆发', '已完成'];
      if (POSITIVE_TERMINALS.includes(e.stage) && e._terminalSince !== undefined) {
        const keepRounds = 2 + (e.level || 1) * 2;
        const left = keepRounds - (curRound - e._terminalSince) + 1;
        if (left >= 1) {
          const cdColor = e.stage === '已完成' ? '#58e8b3' : '#e07465';
          countdownHtml = ` <span class="we-badge we-event-countdown" style="--event-countdown:${cdColor};" title="该事件在 ${left} 轮后自动清退"><i class="fa-regular fa-clock"></i>剩余${left}轮</span>`;
        }
      }
      const terminalStamp = {
        已完成: { text: '完成', color: '#58e8b3' },
        已爆发: { text: '爆发', color: '#e07465' },
        已消散: { text: '消散', color: '#a6a6ad' },
        已失败: { text: '失败', color: '#c08aaa' }
      }[e.stage];
      const isEditing = editingEvent?.scope === scope && editingEvent?.index === eventIndex;
      // 颜色作为 CSS 变量下放，描边/底色/光效全交由样式层处理（不再内联左色条）
      const itemStyle = `--event-accent:${color};--event-type:${typeColor};--event-level:${levelColor};`;
      const stageClassMap = {
        萌芽: 'we-stage-sprout', 发酵: 'we-stage-ferment', 逼近: 'we-stage-loom',
        已爆发: 'we-stage-erupt', 已消散: 'we-stage-fade',
        已完成: 'we-stage-done', 已失败: 'we-stage-failed',
      };
      const stageClass = stageClassMap[e.stage] || '';
      const itemClass = (isTerminal ? 'we-event-item we-event-item-terminal' : 'we-event-item') + (stageClass ? ' ' + stageClass : '');
      const metaStyle = isTerminal
        ? 'style="color:var(--we-text2);"'
        : '';
      const stageBadge = isTerminal ? '' : ` <span class="we-badge we-event-stage-badge">${e.stage}</span>`;
      const metaText = isTerminal
        ? (e.desc ? u(e.desc) : '')
        : `${e.stageRound||1}/9 ${e.desc ? '— '+u(e.desc) : ''}${metaExtra}`;
      const stampHtml = isTerminal && terminalStamp
        ? `<div class="we-event-stamp" style="--event-stamp:${terminalStamp.color};">${terminalStamp.text}</div>`
        : '';
      const extraFieldsHtml = renderSchemaExtraFields(e, 'events', {
        name: true,
        type: true,
        level: true,
        stage: true,
        stageRound: true,
        desc: true,
        stall: true,
        consecutiveFails: true,
        evolveResult: true,
        _terminalSince: true
      }, 'we-event-meta');
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-event-delete" data-event-scope="${scope}" data-event-index="${eventIndex}" title="删除事件"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-event-copy" data-event-scope="${scope}" data-event-index="${eventIndex}" title="复制事件"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-event-edit" data-event-scope="${scope}" data-event-index="${eventIndex}" title="修改事件"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderEventEditor(e, scope, eventIndex) : '';
      return `<div class="${itemClass}" style="${itemStyle}">
        ${stampHtml}
        <div class="we-event-name"><span class="we-event-title">${u(e.name)}</span> <span class="we-badge we-event-level-badge">Lv.${e.level||'?'}</span> <span class="we-badge we-event-type-badge">${typeName}</span>${countdownHtml}${stageBadge}${extras}</div>
        ${metaText ? `<div class="we-event-meta" ${metaStyle}>${metaText}</div>` : ''}
        ${extraFieldsHtml}
        ${editHtml}
        ${actionHtml}
        ${progressHtml}
      </div>`;
    });
  }

  function renderEventEditor(event, scope, eventIndex) {
    const stages = event.type === 'progress'
      ? ['筹备', '执行', '关键', '已完成', '已失败']
      : ['萌芽', '发酵', '逼近', '已爆发', '已消散'];
    const levelOptions = [1, 2, 3, 4].map(level =>
      `<option value="${level}" ${Number(event.level) === level ? 'selected' : ''}>Lv.${level}</option>`
    ).join('');
    const typeOptions = [
      ['conflict', '冲突型'],
      ['progress', '推进型']
    ].map(([type, label]) =>
      `<option value="${type}" ${event.type === type ? 'selected' : ''}>${label}</option>`
    ).join('');
    const stageOptions = stages.map(stage =>
      `<option value="${stage}" ${event.stage === stage ? 'selected' : ''}>${stage}</option>`
    ).join('');

    // 正面终局倒计时：默认值取当前剩余，非终局事件留空
    const POSITIVE_TERMINALS = ['已爆发', '已完成'];
    const keepRounds = 2 + (Number(event.level) || 1) * 2;
    let leftValue = '';
    if (POSITIVE_TERMINALS.includes(event.stage)) {
      const curRound = (core.loadState() || {}).round || 0;
      const left = event._terminalSince !== undefined
        ? keepRounds - (curRound - event._terminalSince) + 1
        : keepRounds;
      leftValue = Math.min(keepRounds, Math.max(1, left));
    }

    return `
      <div class="we-event-editor" data-event-scope="${scope}" data-event-index="${eventIndex}">
        <button class="we-event-editor-close" title="取消修改"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">事件名字<input class="we-event-edit-name" type="text" value="${u(event.name || '')}"></label>
          <label>等级<select class="we-event-edit-level">${levelOptions}</select></label>
          <label>类型<select class="we-event-edit-type">${typeOptions}</select></label>
          <label>阶段<select class="we-event-edit-stage">${stageOptions}</select></label>
          <label>阶段进度<input class="we-event-edit-round" type="number" min="1" max="9" value="${event.stageRound || 1}"></label>
          <label title="仅正面终局（已爆发/已完成）生效，到期自动清退；非终局留空">剩余轮数<input class="we-event-edit-left" type="number" min="1" placeholder="终局专用" value="${leftValue}"></label>
          <label class="we-event-editor-wide">描述<textarea class="we-event-edit-desc" rows="3">${u(event.desc || '')}</textarea></label>
          ${renderSchemaExtraEditor(event, 'events', { name:true, type:true, level:true, stage:true, stageRound:true, desc:true, stall:true, consecutiveFails:true, evolveResult:true, _terminalSince:true })}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-event-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function mapSchemaFields(fieldsMap, baseFields) {
    if (!fieldsMap) return [];
    baseFields = baseFields || {};
    return Object.keys(fieldsMap).filter(function (key) {
      return !baseFields[key] && (!fieldsMap[key] || fieldsMap[key].display !== false);
    }).map(function (key) {
      var spec = fieldsMap[key] || {};
      return { key: key, label: spec.label || spec.title || key, type: spec.type || 'string', enum: spec.enum || [], display: spec.display !== false };
    });
  }

  function getSchemaExtraFields(moduleId, baseFields) {
    var rulesLoader = window.WORLD_ENGINE_RULES;
    if (!rulesLoader || !rulesLoader.getModuleOutputSchema) return [];
    var schema = rulesLoader.getModuleOutputSchema(moduleId);
    if (!schema || !schema.fields) return [];
    return mapSchemaFields(schema.fields, baseFields);
  }

  // 数组对象（如黑箱 secretActions/secretAssets）的子 schema 扩展字段
  var SECRET_ITEM_BASE = {
    action: { action: true, witnesses: true },
    asset: { name: true, exposure: true, status: true }
  };
  var SECRET_ITEM_FIELD = { action: 'secretActions', asset: 'secretAssets' };
  function getSecretItemSchemaFields(listType) {
    var rulesLoader = window.WORLD_ENGINE_RULES;
    if (!rulesLoader || !rulesLoader.getModuleOutputSchema) return [];
    var schema = rulesLoader.getModuleOutputSchema('blackbox');
    if (!schema || !schema.fields) return [];
    var key = SECRET_ITEM_FIELD[listType];
    var spec = key ? schema.fields[key] : null;
    if (!spec || !spec.itemFields) return [];
    return mapSchemaFields(spec.itemFields, SECRET_ITEM_BASE[listType] || {});
  }

  function formatSchemaDisplayValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (Array.isArray(value)) {
      return value.map(function (item) {
        if (item && typeof item === 'object') return JSON.stringify(item);
        return String(item);
      }).join(', ');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function renderSchemaExtraFields(item, moduleId, baseFields, rowClass) {
    return buildSchemaExtraFieldsHtml(item, getSchemaExtraFields(moduleId, baseFields), rowClass);
  }

  function renderSchemaExtraValueHtml(field, value) {
    if (value === undefined || value === null || value === '') return '';
    var type = String((field && field.type) || 'string');
    var isEnum = type === 'enum' || (field && Array.isArray(field.enum) && field.enum.length);
    // 布尔 → 开关态标签
    if (type === 'boolean' || typeof value === 'boolean') {
      var on = (value === true || value === 'true' || value === 1 || value === '1' || value === '是');
      return '<span class="we-xf-bool ' + (on ? 'we-xf-bool-on' : 'we-xf-bool-off') + '">' +
        '<i class="fa-solid ' + (on ? 'fa-toggle-on' : 'fa-toggle-off') + '"></i>' + (on ? '是' : '否') + '</span>';
    }
    // 枚举 → 单个标签
    if (isEnum && !Array.isArray(value)) {
      return '<span class="we-xf-tag we-xf-tag-enum">' + u(String(value)) + '</span>';
    }
    // 数组 → 多个小标签（对象元素退化为 JSON 标签）
    if (type.indexOf('array') === 0 || Array.isArray(value)) {
      if (Array.isArray(value)) {
        var tags = value.filter(function (v) { return v !== undefined && v !== null && v !== ''; })
          .map(function (v) {
            var t = (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
            return '<span class="we-xf-tag">' + u(t) + '</span>';
          }).join('');
        return tags ? '<span class="we-xf-tags">' + tags + '</span>' : '';
      }
    }
    // 对象 → 折叠显示
    if (type === 'object' || (typeof value === 'object')) {
      var json = JSON.stringify(value, null, 2);
      var label = Array.isArray(value) ? (value.length + ' 项') : '对象';
      return '<details class="we-xf-obj"><summary>展开（' + label + '）</summary>' +
        '<pre class="we-xf-obj-pre">' + u(json) + '</pre></details>';
    }
    // 数字 → 数值徽章（0-100 时徽章自带进度填充）
    if (type === 'number' || (typeof value === 'number') || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) {
      var num = Number(value);
      if (Number.isFinite(num)) {
        if (num >= 0 && num <= 100) {
          return '<span class="we-xf-num" style="--xf-pct:' + Math.max(0, Math.min(100, num)) + '%;">' + u(String(value)) + '</span>';
        }
        return '<span class="we-xf-num we-xf-num-plain">' + u(String(value)) + '</span>';
      }
    }
    // 文本兜底
    return u(String(value));
  }

  function buildSchemaExtraFieldsHtml(item, fields, rowClass) {
    if (!item || !fields) return '';
    rowClass = rowClass || 'we-faction-meta';
    return fields.map(function (field) {
      var valueHtml = renderSchemaExtraValueHtml(field, item[field.key]);
      if (!valueHtml) return '';
      return '<div class="' + rowClass + ' we-xf-row"><span class="we-schema-extra-label">' + u(field.label) + ': </span>' + valueHtml + '</div>';
    }).join('');
  }

  function formatSchemaEditValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  }

  function renderSchemaExtraEditor(item, moduleId, baseFields) {
    return buildSchemaExtraEditorHtml(item, getSchemaExtraFields(moduleId, baseFields));
  }

  function buildSchemaExtraEditorHtml(item, fields) {
    if (!fields || !fields.length) return '';
    var html = '<div class="we-event-editor-wide we-schema-extra-editor" style="display:grid;grid-template-columns:1fr;gap:6px;margin-top:4px;">' +
      '<div style="font-size:12px;color:var(--we-text2,#aaa);">自定义字段</div>';
    fields.forEach(function (field) {
      var raw = formatSchemaEditValue(item && item[field.key]);
      var type = String(field.type || 'string');
      var label = u(field.label || field.key);
      var common = ' class="we-schema-extra-input" data-schema-extra-field="' + h(field.key) + '" data-schema-extra-type="' + h(type) + '"';
      if (Array.isArray(field.enum) && field.enum.length) {
        html += '<label>' + label + '<select' + common + '><option value="">未设置</option>' + field.enum.map(function (opt) {
          opt = String(opt);
          return '<option value="' + h(opt) + '"' + (String(raw) === opt ? ' selected' : '') + '>' + h(opt) + '</option>';
        }).join('') + '</select></label>';
      } else if (type === 'boolean') {
        html += '<label>' + label + '<select' + common + '><option value="">未设置</option><option value="true"' + (raw === 'true' ? ' selected' : '') + '>是</option><option value="false"' + (raw === 'false' ? ' selected' : '') + '>否</option></select></label>';
      } else if (type === 'number') {
        html += '<label>' + label + '<input type="number"' + common + ' value="' + h(raw) + '"></label>';
      } else if (type.indexOf('array') === 0 || type === 'object') {
        html += '<label>' + label + '<textarea rows="2"' + common + ' placeholder="JSON 或逗号分隔值">' + h(raw) + '</textarea></label>';
      } else {
        html += '<label>' + label + '<input type="text"' + common + ' value="' + h(raw) + '"></label>';
      }
    });
    html += '</div>';
    return html;
  }

  function parseSchemaExtraEditorValue(raw, type, fieldName) {
    raw = (raw || '').trim();
    if (!raw) return undefined;
    type = String(type || 'string');
    if (type === 'number') {
      var n = Number(raw);
      if (!Number.isFinite(n)) throw new Error('字段“' + fieldName + '”需要数字');
      return n;
    }
    if (type === 'boolean') return raw === 'true';
    if (type.indexOf('array') === 0) {
      if (raw[0] === '[') return JSON.parse(raw);
      return raw.split(',').map(function (item) { return item.trim(); }).filter(Boolean);
    }
    if (type === 'object') return JSON.parse(raw);
    return raw;
  }

  function applySchemaExtraEditor(editor, target) {
    var inputs = editor.querySelectorAll('.we-schema-extra-input[data-schema-extra-field]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var key = input.getAttribute('data-schema-extra-field');
      var type = input.getAttribute('data-schema-extra-type') || 'string';
      try {
        var value = parseSchemaExtraEditorValue(input.value, type, key);
        if (value === undefined) delete target[key];
        else target[key] = value;
      } catch (err) {
        showToast(err.message || ('自定义字段“' + key + '”格式不正确'), true);
        return false;
      }
    }
    return true;
  }
  function renderFactionList(factions, scope) {
    if (!factions || !factions.length) return '<div class="we-empty">暂无势力</div>';
    return renderPagedList(factions, 'factions', (f, factionIndex) => {
      const relationColors = {
        血盟:'#2563eb', 盟友:'#0ea5e9', 友好:'#06b6d4', 中立:'#94a3b8',
        冷淡:'#f59e0b', 紧张:'#f59e0b', 敌对:'#ef4444', 世仇:'#991b1b'
      };
      const statusColors = { 鼎盛:'#d0aa58', 稳固:'#69b68e', 倾轧:'#cf5f3f', 困顿:'#70a8d2', 衰落:'#a6a6ad', 瓦解:'#888888' };
      const relColor = relationColors[f.relation] || '#888';
      const stColor = statusColors[f.status] || '#888';

      const isEditing = editingFaction && editingFaction.scope === scope && editingFaction.index === factionIndex;

      let pillarsHtml = '';
      if (f.powerPillars && f.powerPillars.length) {
        pillarsHtml = '<div class="we-faction-meta">权力支柱: ' + f.powerPillars.map(p => '<span class="we-pillar-tag">' + u(p) + '</span>').join('') + '</div>';
      }

      const extraFieldsHtml = renderSchemaExtraFields(f, 'factions', {
        name: true,
        scope: true,
        status: true,
        relation: true,
        currentGoal: true,
        core_person: true,
        powerPillars: true
      }, 'we-faction-meta');
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-faction-delete" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="删除势力"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-faction-copy" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="复制势力"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-faction-edit" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="编辑势力"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderFactionEditor(f, factionIndex, scope) : '';

      return `<div class="we-faction-item">
        <div class="we-faction-name">${u(f.name)}</div>
        <div class="we-faction-tags">
          <span class="we-tag" style="border-color:${stColor};color:${stColor};">${f.status||'稳固'}</span>
          <span class="we-tag" style="border-color:${relColor};color:${relColor};">${f.relation||'中立'}</span>
          ${f.scope ? '<span class="we-tag">' + u(f.scope) + '</span>' : ''}
        </div>
        ${f.currentGoal ? `<div class="we-faction-goal">${u(f.currentGoal)}</div>` : ''}
        ${f.core_person ? `<div class="we-faction-meta">核心人物: ${u(f.core_person)}</div>` : ''}
        ${pillarsHtml}
        ${extraFieldsHtml}
        ${actionHtml}
        ${editHtml}
      </div>`;
    });
  }

  function renderFactionEditor(f, index, scope) {
    const statusOptions = ['鼎盛','稳固','倾轧','困顿','衰落','瓦解'].map(s =>
      `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('');
    const relationOptions = ['血盟','盟友','友好','中立','冷淡','敌对','世仇'].map(r =>
      `<option value="${r}" ${f.relation === r ? 'selected' : ''}>${r}</option>`).join('');
    const pillars = [];
    for (let i = 0; i < 3; i++) pillars.push(f.powerPillars?.[i] || '');

    return `
      <div class="we-event-editor" data-faction-scope="${scope}" data-faction-index="${index}">
        <button class="we-event-editor-close we-faction-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">势力名称<input class="we-faction-edit-name" type="text" value="${u(f.name||'')}"></label>
          <label>运势<select class="we-faction-edit-status">${statusOptions}</select></label>
          <label>关系<select class="we-faction-edit-relation">${relationOptions}</select></label>
          <label>范围<input class="we-faction-edit-scope" type="text" value="${u(f.scope||'')}"></label>
          <label>目标<input class="we-faction-edit-goal" type="text" value="${u(f.currentGoal||'')}"></label>
          <label>核心人物<input class="we-faction-edit-core" type="text" value="${u(f.core_person||'')}"></label>
          ${[0,1,2].map(i => `<label>权力支柱${i+1}<input class="we-faction-edit-pillar" data-pillar-idx="${i}" type="text" value="${u(pillars[i])}" maxlength="4" placeholder="最多4字"></label>`).join('')}
          ${renderSchemaExtraEditor(f, 'factions', { name:true, scope:true, status:true, relation:true, currentGoal:true, core_person:true, powerPillars:true })}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-faction-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderWorldTrends(trends, scope) {
    if (!trends || !trends.length) return '<div class="we-empty">暂无天下大势</div>';
    return renderPagedList(trends, 'world-trends', (trend, trendIndex) => {
      const ended = trend.status === '已结束';
      const color = ended ? '#888888' : '#c9a45c';
      const isEditing = editingTrend?.scope === scope && editingTrend?.index === trendIndex;
      const extraFieldsHtml = renderSchemaExtraFields(trend, 'trends', {
        name: true,
        scope: true,
        status: true,
        description: true,
        source: true
      }, 'we-trend-source');
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-trend-delete" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="删除天下大势"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-trend-copy" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="复制天下大势"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-trend-edit" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="编辑天下大势"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderTrendEditor(trend, scope, trendIndex) : '';
      return `<div class="we-trend-item${ended ? ' we-trend-ended' : ''}" style="border-left-color:${color};">
        ${actionHtml}
        <div class="we-trend-header">
          <span class="we-trend-name">${u(trend.name)}</span>
          <span class="we-badge" style="background:${color}22;color:${color};">${u(trend.status || '持续中')}</span>
        </div>
        <div class="we-trend-scope">${u(trend.scope || '天下')}</div>
        <div class="we-trend-description">${u(trend.description || '?')}</div>
        <div class="we-trend-source"><span>来源</span>${u(trend.source || '?')}</div>
        ${extraFieldsHtml}
        ${editHtml}
      </div>`;
    });
  }

  function renderTrendEditor(trend, scope, index) {
    const statusOptions = ['持续中', '已结束'].map(s =>
      `<option value="${s}" ${trend.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-trend-scope="${scope}" data-trend-index="${index}">
        <button class="we-event-editor-close we-trend-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">大势名称<input class="we-trend-edit-name" type="text" value="${u(trend.name||'')}"></label>
          <label>状态<select class="we-trend-edit-status">${statusOptions}</select></label>
          <label>范围<input class="we-trend-edit-scope" type="text" value="${u(trend.scope||'')}"></label>
          <label>来源<input class="we-trend-edit-source" type="text" value="${u(trend.source||'')}"></label>
          <label class="we-event-editor-wide">描述<textarea class="we-trend-edit-desc" rows="3">${u(trend.description||'')}</textarea></label>
          ${renderSchemaExtraEditor(trend, 'trends', { name:true, scope:true, status:true, description:true, source:true })}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-trend-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderWindList(winds, scope) {
    if (!winds || !winds.length) return '<div class="we-empty">暂无风声</div>';
    const typeNames = { announcement:'公告', report:'消息', rumor:'流言', sentiment:'舆情' };
    const typeColors = { announcement:'#c94b4b', report:'#4a8ab5', rumor:'#9178a0', sentiment:'#c17a35' };
    return renderPagedList(winds, 'winds', (w, windIndex) => {
      const typeColor = typeColors[w.type] || '#888';
      // 等级徽章：Lv1/2 中性灰，Lv3/4 取类型本色（与风声四态配色统一）
      const levelColor = (w.level >= 3) ? typeColor : (w.level === 2 ? '#7a828c' : '#5a6270');
      const isEditing = editingWind && editingWind.scope === scope && editingWind.index === windIndex;

      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-wind-delete" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="删除风声"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-wind-copy" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="复制风声"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-wind-edit" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="编辑风声"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderWindEditor(w, windIndex, scope) : '';

      const windTypeClass = { announcement:'we-wind-announcement', report:'we-wind-report', rumor:'we-wind-rumor', sentiment:'we-wind-sentiment' }[w.type] || '';
      const windLvClass = 'we-wind-lv' + (w.level || 1);
      let html = '<div class="we-wind-item ' + windTypeClass + ' ' + windLvClass + '" style="--wind-accent:' + typeColor + ';--wind-level-color:' + levelColor + ';">';
      // Lv4 专属装饰元素：公告双冲击环 / 流言双焦点多圈涟漪
      if (w.level === 4) {
        if (w.type === 'announcement') {
          html += '<span class="we-wind-ring"></span><span class="we-wind-ring we-wind-ring2"></span>';
        } else if (w.type === 'rumor') {
          html += '<span class="we-wind-rp we-rp-a1"></span><span class="we-wind-rp we-rp-a2"></span><span class="we-wind-rp we-rp-a3"></span><span class="we-wind-rp we-rp-b1"></span><span class="we-wind-rp we-rp-b2"></span>';
        }
      }
      html += '<div class="we-wind-header">';
      html += '<span class="we-wind-topic">' + u(w.topic || '未命名风声') + '</span>';
      html += '<span class="we-badge" style="background:' + typeColor + '22;color:' + typeColor + ';">' + (typeNames[w.type] || '风声') + '</span>';
      html += '<span class="we-badge" style="background:' + levelColor + '22;color:' + levelColor + ';">Lv.' + (w.level || 1) + '</span>';
      html += '</div>';
      html += '<div class="we-wind-field we-wind-content"><span class="we-wind-label">内容</span><span>' + u(w.content || '?') + '</span></div>';
      html += '<div class="we-wind-field"><span class="we-wind-label">范围</span><span>' + u(w.scope || '?') + '</span></div>';
      html += '<div class="we-wind-field"><span class="we-wind-label">来源</span><span>' + u(w.source || '?') + '</span></div>';
      html += renderSchemaExtraFields(w, 'winds', { topic:true, type:true, level:true, content:true, scope:true, source:true }, 'we-wind-field');
      html += editHtml;
      html += actionHtml;
      html += '</div>';
      return html;
    });
  }

  function renderWindEditor(w, index, scope) {
    const typeOptions = [['announcement','公告'],['report','消息'],['rumor','流言'],['sentiment','舆情']].map(([v,label]) =>
      `<option value="${v}" ${w.type === v ? 'selected' : ''}>${label}</option>`).join('');
    const levelOptions = [1,2,3,4].map(l =>
      `<option value="${l}" ${w.level === l ? 'selected' : ''}>Lv.${l}</option>`).join('');

    return `
      <div class="we-event-editor" data-wind-index="${index}" data-wind-scope="${scope}">
        <button class="we-event-editor-close we-wind-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">主题<input class="we-wind-edit-topic" type="text" value="${u(w.topic||'')}"></label>
          <label>类型<select class="we-wind-edit-type">${typeOptions}</select></label>
          <label>等级<select class="we-wind-edit-level">${levelOptions}</select></label>
          <label>范围<input class="we-wind-edit-scope" type="text" value="${u(w.scope||'')}"></label>
          <label>来源<input class="we-wind-edit-source" type="text" value="${u(w.source||'')}"></label>
          <label class="we-event-editor-wide">内容<textarea class="we-wind-edit-content" rows="3">${u(w.content||'')}</textarea></label>
          ${renderSchemaExtraEditor(w, 'winds', { topic:true, type:true, level:true, content:true, scope:true, source:true })}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-wind-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderReputation(rep, scope) {
    if (!rep) return '<div class="we-empty">暂无声誉数据</div>';
    const levels = ['天怒人怨','声名狼藉','默默无闻','受人尊敬','万众敬仰'];
    const levelColors = { '天怒人怨':'#e05555', '声名狼藉':'#d97a5a', '默默无闻':'#7a8a9a', '受人尊敬':'#6cae8e', '万众敬仰':'#c9a45c' };
    const legacyMap = { '小有名气':'受人尊敬' };
    const dimLabels = { authority:'朝堂', common:'市井', shadow:'草莽', circuit:'同道' };
    // 各维度 × 各等级的随附古文（出处略）
    const quotes = {
      authority: { '天怒人怨':'上下疾之如仇', '声名狼藉':'在位皆言其恶', '默默无闻':'沉于下寮不见知', '受人尊敬':'群臣莫不敬惮', '万众敬仰':'天下想望其风采' },
      common:    { '天怒人怨':'行人指目相戒', '声名狼藉':'里中无赖子亦耻之', '默默无闻':'出入市廛人莫识', '受人尊敬':'闾里称其长者', '万众敬仰':'儿童走卒皆知其名' },
      shadow:    { '天怒人怨':'绿林亦不肯纳', '声名狼藉':'豪杰闻而鄙之', '默默无闻':'混迹渔樵无人问', '受人尊敬':'江湖豪杰多归之', '万众敬仰':'四海之内皆称其侠' },
      circuit:   { '天怒人怨':'同辈羞与为伍', '声名狼藉':'友朋面斥其非', '默默无闻':'独行无人与语', '受人尊敬':'同门推为领袖', '万众敬仰':'吾辈望之如泰山' }
    };
    // 维度名与判词改读当前世界观预设；古风预设保留原有短标签与古文短句，
    // 其它世界观（含世界书生成）用预设里的维度名与判词。
    const _P = window.WORLD_ENGINE_PRESETS;
    const _preset = (_P && _P.getActivePreset) ? _P.getActivePreset() : null;
    const _isAncient = !_preset || _preset.id === 'ancient_chinese';
    const _dims = (_preset && _preset.reputation && _preset.reputation.dimensions) || {};
    const _verdicts = (_preset && _preset.reputation && _preset.reputation.verdicts) || {};
    return '<div class="we-rep-grid">' + Object.entries(rep).filter(([k]) => k !== 'lastChange').map(([key, rawVal]) => {
      const val = legacyMap[rawVal] || rawVal;
      const cn = _isAncient
        ? (dimLabels[key] || key)
        : ((_dims[key] && _dims[key].name) || dimLabels[key] || key);
      const idx = levels.indexOf(val);
      const color = levelColors[val] || '#888';
      const quote = _isAncient
        ? ((quotes[key] && quotes[key][val]) || '')
        : ((_verdicts[key] && _verdicts[key][val]) || (quotes[key] && quotes[key][val]) || '');
      const dotsHtml = levels.map((l, i) => {
        const active = i <= idx ? ' we-rep-dot-active' : '';
        const dotColor = i <= idx ? color : '#444';
        return `<span class="we-rep-dot${active}" style="background:${dotColor};" data-rep-scope="${scope || 'state'}" data-dim="${key}" data-level="${l}" title="${l}"></span>`;
      }).join('');
      return `<div class="we-rep-row">
        <span class="we-rep-dim">${u(cn)}</span>
        <div class="we-rep-dots">${dotsHtml}</div>
        <span class="we-rep-quote" style="color:${color}">${u(quote)}</span>
      </div>`;
    }).join('') + '</div>';
  }

  function renderEconomy(econ, scope) {
    if (!econ) return '<div class="we-empty">暂无经济数据</div>';
    const sc = scope || 'state';
    if (editingEconomy && editingEconomy.scope === sc) return renderEconomyEditor(econ, sc);
    const climates = ['繁荣','平稳','衰退','动荡'];
    const climateColors = { '繁荣': '#3ecf8e', '平稳': '#7a8a9a', '衰退': '#d9a34a', '动荡': '#e05555' };
    const climateBg = { '繁荣': 'rgba(62,207,142,0.08)', '平稳': 'rgba(122,138,154,0.06)', '衰退': 'rgba(217,163,74,0.08)', '动荡': 'rgba(224,85,85,0.08)' };
    const climate = econ.climate || '平稳';
    const cColor = climateColors[climate] || '#7a8a9a';
    let html = '<div class="we-event-actions we-economy-actions"><button class="we-icon-btn we-economy-edit" data-economy-scope="' + sc + '" title="编辑经济"><i class="fa-solid fa-pen"></i></button></div>';
    html += '<div class="we-climate-bar" style="background:' + (climateBg[climate]||'rgba(122,138,154,0.06)') + ';">';
    html += '<span class="we-climate-dot" style="background:' + cColor + ';box-shadow:0 0 8px ' + cColor + '88;"></span>';
    html += '<span class="we-climate-label" style="color:' + cColor + '">' + climate + '</span>';
    html += '<div class="we-climate-btns">';
    for (const c of climates) {
      html += '<span class="we-climate-btn' + (c === climate ? ' we-climate-btn-on' : '') + '" style="' + (c === climate ? ('color:'+(climateColors[c]||'#7a8a9a')+';border-color:'+(climateColors[c]||'#7a8a9a')) : '') + '" data-climate-scope="' + sc + '" data-climate="' + c + '">' + c + '</span>';
    }
    html += '</div></div>';
    html += renderSchemaExtraFields(econ, 'economy', { climate:true, signals:true }, 'we-wind-field');
    if (econ.signals?.length) {
      html += renderPagedList(econ.signals, 'economy-signals', (s, i) =>
        '<div class="we-signal-item" data-sig-scope="' + sc + '">' +
        '<span class="we-signal-summary">' + u(s.summary||s) + '</span>' +
        '<span class="we-signal-scope">' + u(s.scope||'?') + '</span>' +
        '<span class="we-signal-del" data-sig-scope="' + sc + '" data-sigidx="' + i + '" title="删除信号">✕</span>' +
        '</div>'
      );
    } else {
      html += '<div class="we-empty" style="margin-top:4px;">暂无市场信号</div>';
    }
    html += '<div class="we-signal-add" data-sig-scope="' + sc + '"><i class="fa-solid fa-plus"></i> 添加信号</div>';
    return html;
  }

  function renderEconomyEditor(econ, scope) {
    const climates = ['繁荣','平稳','衰退','动荡'];
    const cur = econ.climate || '平稳';
    if (climates.indexOf(cur) === -1) climates.push(cur);
    const climateOptions = climates.map(function (c) {
      return '<option value="' + h(c) + '"' + (c === cur ? ' selected' : '') + '>' + h(c) + '</option>';
    }).join('');
    const signals = Array.isArray(econ.signals) ? econ.signals : [];
    let signalRows = signals.map(function (sig, i) {
      const summary = (sig && typeof sig === 'object') ? (sig.summary || '') : String(sig || '');
      const sigScope = (sig && typeof sig === 'object') ? (sig.scope || '') : '';
      return '<div class="we-econ-signal-row" data-sig-row="' + i + '">'
        + '<input class="we-econ-sig-summary" type="text" placeholder="信号摘要" value="' + u(summary) + '">'
        + '<input class="we-econ-sig-scope" type="text" placeholder="范围" value="' + u(sigScope) + '">'
        + '<button class="we-icon-btn we-econ-sig-del" data-economy-scope="' + scope + '" data-sig-idx="' + i + '" title="删除信号"><i class="fa-solid fa-xmark"></i></button>'
        + '</div>';
    }).join('');
    if (!signals.length) signalRows = '<div class="we-empty" style="margin:2px 0;">暂无市场信号</div>';
    return '<div class="we-event-editor we-economy-editor" data-economy-scope="' + scope + '">'
      + '<button class="we-event-editor-close we-economy-editor-close"><i class="fa-solid fa-xmark"></i></button>'
      + '<div class="we-event-editor-grid">'
      + '<label>经济气候<select class="we-economy-edit-climate">' + climateOptions + '</select></label>'
      + '<div class="we-event-editor-wide">'
      + '<div style="font-size:12px;color:var(--we-text2);margin-bottom:4px;">市场信号</div>'
      + '<div class="we-econ-signal-list">' + signalRows + '</div>'
      + '<button class="we-btn we-economy-sig-add" data-economy-scope="' + scope + '" style="margin-top:4px;"><i class="fa-solid fa-plus"></i> 添加信号</button>'
      + '</div>'
      + buildSchemaExtraEditorHtml(econ, getSchemaExtraFields('economy', { climate: true, signals: true }))
      + '</div>'
      + '<div class="we-event-editor-footer">'
      + '<button class="we-btn we-btn-primary we-economy-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>'
      + '</div>'
      + '</div>';
  }

  function readEconomySignals(editor, keepEmpty) {
    const out = [];
    editor.querySelectorAll('.we-econ-signal-row').forEach(function (row) {
      const summary = (row.querySelector('.we-econ-sig-summary').value || '').trim();
      const sigScope = (row.querySelector('.we-econ-sig-scope').value || '').trim();
      if (summary || sigScope || keepEmpty) out.push({ summary: summary, scope: sigScope || '区域' });
    });
    return out;
  }

  function renderEnemies(enemiesList, scope) {
    if (!enemiesList || !enemiesList.length) return '<div class="we-empty">暂无仇敌</div>';
    return renderPagedList(enemiesList, 'enemies', (en, enemyIndex) => {
      const isEditing = editingEnemy?.scope === scope && editingEnemy?.index === enemyIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-enemy-delete" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="删除仇敌"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-enemy-copy" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="复制仇敌"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-enemy-edit" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="编辑仇敌"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const extraFieldsHtml = renderSchemaExtraFields(en, 'enemies', { name:true, reason:true, type:true, status:true }, 'we-blood-meta');
      const editHtml = isEditing ? renderEnemyEditor(en, enemyIndex, scope) : '';
      return `<div class="we-blood-item">
        ${actionHtml}
        <div class="we-blood-title">${u(en.name)} <span class="we-badge we-badge-danger">${en.status||'追踪中'}</span><span class="we-badge" style="background:var(--we-purple);font-size:10px;">${en.type==='blood'?'血仇':'恩怨'}</span></div>
        <div class="we-blood-meta">原因: ${u(en.reason||'?')}</div>
        ${extraFieldsHtml}
        ${editHtml}
      </div>`;
    });
  }

  function renderEnemyEditor(en, index, scope) {
    const typeOptions = [['blood','血仇'],['grudge','恩怨']].map(([v,label]) =>
      `<option value="${v}" ${en.type === v ? 'selected' : ''}>${label}</option>`).join('');
    const statusOptions = ['追踪中','策划中','执行中','已终结'].map(s =>
      `<option value="${s}" ${en.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-enemy-scope="${scope}" data-enemy-index="${index}">
        <button class="we-event-editor-close we-enemy-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">仇敌名称<input class="we-enemy-edit-name" type="text" value="${u(en.name||'')}"></label>
          <label>类型<select class="we-enemy-edit-type">${typeOptions}</select></label>
          <label>状态<select class="we-enemy-edit-status">${statusOptions}</select></label>
          <label class="we-event-editor-wide">原因<textarea class="we-enemy-edit-reason" rows="2">${u(en.reason||'')}</textarea></label>
          ${renderSchemaExtraEditor(en, 'enemies', { name:true, reason:true, type:true, status:true })}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-enemy-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderInfluenceChain(chain, scope) {
    if (!chain || !chain.length) return '<div class="we-empty">暂无影响链</div>';
    return renderPagedList(chain, 'influence', (item, infIndex) => {
      const isEditing = editingInfluence?.scope === scope && editingInfluence?.index === infIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-influence-delete" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="删除影响链"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-influence-copy" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="复制影响链"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-influence-edit" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="编辑影响链"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const extraFieldsHtml = renderSchemaExtraFields(item, 'influence', { trigger:true, impact:true, fallout:true }, 'we-influence-step');
      const editHtml = isEditing ? renderInfluenceEditor(item, infIndex, scope) : '';
      return `<div class="we-influence-item">
        ${actionHtml}
        <div class="we-influence-step we-influence-trigger">
          <span class="we-influence-label">触发源</span>
          <span class="we-influence-text">${u(item.trigger)}</span>
        </div>
        <div class="we-influence-step we-influence-impact">
          <span class="we-influence-label">直接影响</span>
          <span class="we-influence-text">${u(item.impact)}</span>
        </div>
        ${item.fallout ? `<div class="we-influence-step we-influence-fallout">
          <span class="we-influence-label">后续余波</span>
          <span class="we-influence-text">${u(item.fallout)}</span>
        </div>` : ''}
        ${extraFieldsHtml}
        ${editHtml}
      </div>`;
    });
  }

  function renderInfluenceEditor(item, index, scope) {
    return `
      <div class="we-event-editor" data-influence-index="${index}" data-influence-scope="${scope}">
        <button class="we-event-editor-close we-influence-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">触发源<textarea class="we-influence-edit-trigger" rows="2">${u(item.trigger||'')}</textarea></label>
          <label class="we-event-editor-wide">直接影响<textarea class="we-influence-edit-impact" rows="2">${u(item.impact||'')}</textarea></label>
          <label class="we-event-editor-wide">后续余波<textarea class="we-influence-edit-fallout" rows="2">${u(item.fallout||'')}</textarea></label>
          ${renderSchemaExtraEditor(item, 'influence', { trigger:true, impact:true, fallout:true })}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-influence-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function getRegionalIncidentTypeLabel(type) {
    const labels = {
      banditry: '盗匪劫掠',
      fire: '大火',
      massacre: '恶性凶案',
      flood: '洪涝',
      infrastructure: '道路水利崩坏',
      plague: '疫病',
      famine: '饥荒粮荒',
      riot: '骚乱暴动',
      rebellion: '民变叛乱',
      military: '军务突变',
      earthquake: '地震山崩',
      storm: '风暴雪灾',
      other: '其他'
    };
    return labels[type] || '其他';
  }

  function renderRegionalIncident(ri, scope) {
    if (!ri) return '<div class="we-empty">尚未进行区域事件判定</div>';
    const isEditing = editingRI?.active === true && editingRI?.scope === scope;
    const actionHtml = isEditing ? '' : `
      <div class="we-event-actions">
        <button class="we-icon-btn we-ri-delete" data-ri-scope="${scope}" title="清除区域事件"><i class="fa-solid fa-trash-can"></i></button>
        <button class="we-icon-btn we-ri-copy" data-ri-scope="${scope}" title="复制区域事件"><i class="fa-solid fa-copy"></i></button>
        <button class="we-icon-btn we-ri-edit" data-ri-scope="${scope}" title="编辑区域事件"><i class="fa-solid fa-pen"></i></button>
      </div>`;
    const extraFieldsHtml = renderSchemaExtraFields(ri, 'regional', { active:true, title:true, type:true, scope:true, impact:true, duration:true, cooldown:true }, 'we-faction-meta');
    const editHtml = isEditing ? renderRIEditor(ri, scope) : '';

    if (ri.active) {
      return `<div class="we-accident-item we-regional-incident-item we-accident-triggered">
        ${actionHtml}
        ${u(ri.title)}<br>
        <span style="font-size:11px;color:var(--we-text3);">类型: ${u(getRegionalIncidentTypeLabel(ri.type))} | 范围: ${u(ri.scope||'?')} | 剩余: ${ri.duration||0}轮</span><br>
        <span style="font-size:11px;color:var(--we-text2);">${u(ri.impact||'')}</span>
        ${extraFieldsHtml}
        ${editHtml}
      </div>`;
    }
    if (ri.title && ri.title.includes('重试')) {
      return `<div class="we-accident-item we-regional-incident-item" style="border-left:3px solid var(--we-gold);">
        ${actionHtml}
        ${u(ri.title)}（类型: ${u(getRegionalIncidentTypeLabel(ri.type))}）
        ${editHtml}
      </div>`;
    }
    if (ri.cooldown > 0) {
      return `<div class="we-accident-item we-regional-incident-item">${actionHtml}本轮无区域事件（剩余冷却 ${ri.cooldown} 轮）${editHtml}</div>`;
    }
    return `<div class="we-accident-item we-regional-incident-item">${actionHtml}本轮无区域事件${editHtml}</div>`;
  }

  function renderRIEditor(ri, scope) {
    const types = ['banditry','fire','massacre','flood','infrastructure','plague','famine','riot','rebellion','military','earthquake','storm'];
    if (ri.type && !types.includes(ri.type)) types.push(ri.type);
    const typeOptions = types.map(t =>
      `<option value="${t}" ${ri.type === t ? 'selected' : ''}>${u(getRegionalIncidentTypeLabel(t))}</option>`).join('');
    return `
      <div class="we-event-editor" data-ri-edit="1" data-ri-scope="${scope}">
        <button class="we-event-editor-close we-ri-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label>状态<select class="we-ri-edit-active">
            <option value="true" ${ri.active ? 'selected' : ''}>激活并显示事件</option>
            <option value="false" ${!ri.active ? 'selected' : ''}>未激活</option>
          </select></label>
          <label class="we-event-editor-wide">标题<input class="we-ri-edit-title" type="text" value="${u(ri.title||'')}"></label>
          <label>类型<select class="we-ri-edit-type">${typeOptions}</select></label>
          <label>范围<input class="we-ri-edit-scope" type="text" value="${u(ri.scope||'')}"></label>
          <label>剩余轮数<input class="we-ri-edit-duration" type="number" min="0" max="99" value="${ri.duration||0}"></label>
          <label>冷却<input class="we-ri-edit-cooldown" type="number" min="0" max="99" value="${ri.cooldown||0}"></label>
          <label class="we-event-editor-wide">影响<textarea class="we-ri-edit-impact" rows="3">${u(ri.impact||'')}</textarea></label>
          ${renderSchemaExtraEditor(ri, 'regional', { active:true, title:true, type:true, scope:true, impact:true, duration:true, cooldown:true })}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-ri-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  const SECRET_STATUS_COLOR = { '有效': 'var(--we-green)', '过期': 'var(--we-text3)', '暴露': 'var(--we-red)', '失效': 'var(--we-text3)' };

  function isEditingSecret(scope, list, index) {
    return editingSecret && editingSecret.scope === scope && editingSecret.list === list && editingSecret.index === index;
  }

  function renderBlackbox(blackbox, scope) {
    if (!blackbox) return '<div class="we-empty">暂无黑盒信息</div>';
    let html = '';
    const actions = blackbox.secretActions || [];
    const assets = blackbox.secretAssets || [];

    if (actions.length) {
      html += '<div class="we-secret-group-label we-secret-action">隐秘行为</div>';
      html += renderPagedList(actions, 'secret-actions', (raw, idx) => {
        const a = (typeof raw === 'string') ? { action: raw } : raw;
        if (isEditingSecret(scope, 'action', idx)) return renderSecretEditor(a, 'action', idx, scope);
        return `<div class="we-secret-card we-secret-action">
          <div class="we-secret-ops">
            <button class="we-icon-btn we-secret-edit" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="编辑"><i class="fa-solid fa-pen"></i></button>
            <button class="we-icon-btn we-secret-copy" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="复制"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-secret-del" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="删除"><i class="fa-solid fa-trash-can"></i></button>
          </div>
          <div class="we-secret-body">
            <div class="we-secret-title">${u(a.action || '未命名行为')}</div>
            <div class="we-secret-meta">知情者 · ${u(a.witnesses || '无')}</div>
            ${buildSchemaExtraFieldsHtml(a, getSecretItemSchemaFields('action'), 'we-secret-meta')}
          </div>
        </div>`;
      });
    }

    if (assets.length) {
      html += '<div class="we-secret-group-label we-secret-asset">隐秘资产</div>';
      html += renderPagedList(assets, 'secret-assets', (raw, idx) => {
        const a = (typeof raw === 'string') ? { name: raw } : raw;
        if (isEditingSecret(scope, 'asset', idx)) return renderSecretEditor(a, 'asset', idx, scope);
        const expo = Math.min(100, Math.max(0, Number(a.exposure) || 0));
        const status = a.status || '有效';
        const stColor = SECRET_STATUS_COLOR[status] || 'var(--we-text3)';
        return `<div class="we-secret-card we-secret-asset">
          <div class="we-secret-ops">
            <button class="we-icon-btn we-secret-edit" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="编辑"><i class="fa-solid fa-pen"></i></button>
            <button class="we-icon-btn we-secret-copy" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="复制"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-secret-del" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="删除"><i class="fa-solid fa-trash-can"></i></button>
          </div>
          <div class="we-secret-body">
            <div class="we-secret-title">${u(a.name || '未命名资产')}<span class="we-secret-status" style="color:${stColor};border-color:${stColor};">${u(status)}</span></div>
            <div class="we-secret-expo">
              <div class="we-secret-expo-track"><div class="we-secret-expo-fill" style="width:${expo}%;"></div></div>
              <span class="we-secret-expo-num">暴露 ${expo}%</span>
            </div>
            ${buildSchemaExtraFieldsHtml(a, getSecretItemSchemaFields('asset'), 'we-secret-meta')}
          </div>
        </div>`;
      });
    }

    if (!html) html = '<div class="we-empty">无暗面信息</div>';
    return html;
  }

  /** 秘密统一编辑器：顶部「类型」下拉只切表单(view)，转换延到保存才落库 */
  function renderSecretEditor(a, list, index, scope, view) {
    view = view || (editingSecret && editingSecret.view) || list;
    const typeSelect = `<label>类型<select class="we-secret-type">
        <option value="action" ${view === 'action' ? 'selected' : ''}>隐秘行为</option>
        <option value="asset" ${view === 'asset' ? 'selected' : ''}>隐秘资产</option>
      </select></label>`;
    // 跨类型预填：行为↔资产 标题字段互通（action.action ↔ asset.name）
    const titleText = u(a.action || a.name || '');
    let fields;
    if (view === 'action') {
      fields = `${typeSelect}
        <label class="we-event-editor-wide">行为描述<textarea class="we-secret-f-action" rows="2">${titleText}</textarea></label>
        <label class="we-event-editor-wide">目击者<input class="we-secret-f-witnesses" type="text" value="${u(a.witnesses || '无')}"></label>`;
    } else {
      const statusOptions = ['有效','过期','暴露','失效'].map(s =>
        `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s}</option>`).join('');
      fields = `${typeSelect}
        <label class="we-event-editor-wide">资产名称<input class="we-secret-f-name" type="text" value="${titleText}"></label>
        <label>暴露度<input class="we-secret-f-exposure" type="number" min="0" max="100" value="${Number(a.exposure) || 0}"></label>
        <label>状态<select class="we-secret-f-status">${statusOptions}</select></label>`;
    }
    return `
      <div class="we-event-editor we-secret-editor" data-secret-scope="${scope}" data-secret-list="${list}" data-secret-index="${index}" data-secret-view="${view}">
        <button class="we-event-editor-close we-secret-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">${fields}${buildSchemaExtraEditorHtml(a, getSecretItemSchemaFields(view))}</div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-secret-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
  }

  function renderLedger(memories) {
    const entries = (memories || []).filter(m => m.type === 'ledger').reverse();
    if (!entries.length) return '<div class="we-empty">暂无重大事件记录</div>';
    return renderPagedList(entries, 'ledger', entry => {
      const lines = [];
      for (const c of (entry.changes || [])) {
        if (c.type === 'event_new') {
          const tn = { conflict: '冲突型', progress: '推进型' }[c.eventType] || c.eventType;
          lines.push(`[新增Lv${c.level}${tn}] ${u(c.name)} - ${u(c.stage)} - ${u(c.desc||'')}`);
        } else if (c.type === 'event_advance') {
          lines.push(`[推进] ${u(c.name)}(Lv${c.level}) ${u(c.fromStage)}->${u(c.toStage)} - ${u(c.desc||'')}`);
        } else if (c.type === 'event_terminal') {
          const transition = c.fromStage ? `${u(c.fromStage)}->${u(c.stage||c.toStage)}` : u(c.stage||c.toStage);
          lines.push(`[终局] ${u(c.name)}(Lv${c.level}) ${transition} - ${u(c.desc||'')}`);
        } else if (c.type === 'wind_new') {
          lines.push(`[新增Lv${c.level}风声] ${u(c.topic)} - ${u(c.content||'')}`);
        }
      }
      return `<div class="we-ledger-item">
        <span class="we-ledger-round">第${entry.round}轮</span>
        <div class="we-ledger-changes">${lines.map(l => `<div class="we-ledger-line">${l}</div>`).join('')}</div>
      </div>`;
    });
  }

  // ── 注入自检卡（只读）：读 WORLD_ENGINE_INJECT_INSPECTOR 最后一份快照，
  //    用大白话 + role 分好的消息链回答「世界状态到底有没有真进发给大模型的 prompt」。
  //    数据全来自 inspector 只读快照；本函数纯拼 HTML，不触发任何副作用。
  //    折叠复用本文件 renderDebug 的原生 <details class="we-prompt-seg-card">，无需额外事件绑定。
  function renderInjectInspector() {
    const insp = window.WORLD_ENGINE_INJECT_INSPECTOR;
    if (!insp || !insp.getLastSnapshot) return '';
    const snap = insp.getLastSnapshot();
    const status = snap ? snap.status : 'NOT_YET';
    const text = insp.statusText ? insp.statusText(status) : '';

    const palette = {
      SUCCESS:          { icon: '✅', color: '#3fb950', bg: 'rgba(63,185,80,0.10)' },
      MISSING:          { icon: '❌', color: '#f85149', bg: 'rgba(248,81,73,0.10)' },
      SKIPPED_DISABLED: { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      SKIPPED_REROLL:   { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      SKIPPED_OTHER:    { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      NOT_YET:          { icon: '—', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
    };
    const p = palette[status] || palette.NOT_YET;

    let html = '<div class="we-inject-inspector" style="border:1px solid var(--we-border);border-radius:8px;padding:10px;margin-bottom:12px;background:' + p.bg + ';">';
    html += '<div style="font-weight:600;color:' + p.color + ';margin-bottom:4px;">' + p.icon + ' 注入自检 · ' + h(text) + '</div>';

    if (!snap) {
      html += '<div style="font-size:11px;color:var(--we-text3);">发一条消息触发生成后，这里会显示「世界状态」有没有真正进入发给大模型的正文 prompt（与上方推演 prompt 不是一回事）。</div>';
      return html + '</div>';
    }

    // 元信息行
    const apiLabel = snap.apiType === 'chat' ? '对话补全' : '文本补全';
    let when = '';
    try { when = snap.ts ? new Date(snap.ts).toLocaleTimeString() : ''; } catch (e) {}
    html += '<div style="font-size:11px;color:var(--we-text3);margin-bottom:6px;">'
      + 'API：' + apiLabel + ' · 轮次：' + (snap.round != null ? h(String(snap.round)) : '?')
      + ' · 已注册：' + (snap.registeredAtSend ? '是' : '否')
      + ' · 进正文：' + (snap.landed ? '是' : '否')
      + (when ? ' · ' + h(when) : '')
      + '</div>';

    // role 徽标 + 右对齐字数
    const roleColor = { system: '#a371f7', user: '#58a6ff', assistant: '#3fb950', tool: '#d29922' };
    const roleBadge = (role) => {
      const c = roleColor[role] || 'var(--we-text3)';
      return '<span style="display:inline-block;min-width:62px;text-align:center;font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid ' + c + ';color:' + c + ';">' + h(role || '?') + '</span>';
    };
    const metaSpan = (len) => (len != null ? '<span style="margin-left:auto;font-size:10px;color:var(--we-text3);">' + len + ' 字</span>' : '');

    if (snap.apiType === 'chat' && Array.isArray(snap.messages)) {
      html += '<div style="font-size:11px;color:var(--we-text2);margin-bottom:4px;">实际发出的消息链（共 ' + h(String(snap.messageCount)) + ' 条，按 role 分；点击任意条展开看完整内容）：</div>';
      html += snap.messages.map((m) => {
        const meta = metaSpan(m.length);
        const hasBody = (m.content != null && m.content.length > 0);
        if (m.isOurs) {
          // 本扩展注入那条：可折叠，展开看完整世界状态（证明确实在 prompt 里）
          const body = '<pre class="we-prompt-seg-pre">' + u(m.content || snap.ourContent || '') + '</pre>';
          return '<details class="we-prompt-seg-card" style="margin:3px 0;">'
            + '<summary style="display:flex;align-items:center;gap:6px;">'
            + roleBadge(m.role)
            + '<span style="color:#3fb950;">✅ 含本扩展注入</span>'
            + meta
            + '</summary>'
            + body
            + '</details>';
        }
        // 其它消息：也可折叠展开看完整内容（只读，不写任何存储）
        if (hasBody) {
          const body = '<pre class="we-prompt-seg-pre">' + u(m.content) + '</pre>';
          return '<details class="we-prompt-seg-card" style="margin:3px 0;">'
            + '<summary style="display:flex;align-items:center;gap:6px;">'
            + roleBadge(m.role)
            + meta
            + '</summary>'
            + body
            + '</details>';
        }
        // 空内容：只读一行（不可展开）
        return '<div style="display:flex;align-items:center;gap:6px;padding:2px 6px;font-size:11px;color:var(--we-text3);">'
          + roleBadge(m.role)
          + meta
          + '</div>';
      }).join('');
    } else if (snap.apiType === 'text') {
      html += '<div style="font-size:11px;color:var(--we-text2);margin-bottom:4px;">文本补全 prompt 共 ' + h(String(snap.promptLength || 0)) + ' 字（已 flatten 成单串，无 role 之分）：</div>';
      if (snap.landed && snap.ourExcerpt) {
        const body = '<pre class="we-prompt-seg-pre">' + u(snap.ourExcerpt) + '</pre>';
        html += '<details class="we-prompt-seg-card" style="margin:3px 0;">'
          + '<summary style="display:flex;align-items:center;gap:6px;">'
          + '<span style="color:#3fb950;">✅ 哨兵命中处摘录</span>'
          + '</summary>'
          + body
          + '</details>';
      }
    }

    return html + '</div>';
  }

  function renderDebug() {
    // 注入自检卡独立于推演数据：每次生成都会更新，故即便尚未推演也要先展示它（原生 <details> 折叠，无需额外事件绑定）。
    const injectCard = renderInjectInspector();
    const wrap = (inner) => '<div class="we-prompt-debug">' + injectCard + inner + '</div>';
    const evo = window.WORLD_ENGINE_EVOLUTION;
    if (!evo || !evo.getLastDebug) return wrap('<div class="we-empty">调试数据不可用</div>');
    const dbg = evo.getLastDebug();
    if (!dbg || !dbg.prompt) return wrap('<div class="we-empty">尚未推演，暂无调试数据</div>');
    const segments = Array.isArray(dbg.segments) ? dbg.segments : [];
    const totalLen = String(dbg.prompt || '').length;

    const tryPrettyJson = text => {
      if (!text) return null;
      try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) {}
      const apiMod = window.WORLD_ENGINE_API;
      if (apiMod && typeof apiMod.parseJSON === 'function') {
        try {
          const parsed = apiMod.parseJSON(text);
          if (parsed && typeof parsed === 'object') return JSON.stringify(parsed, null, 2);
        } catch (e) {}
      }
      return null;
    };

    const segmentCards = segments.length ? segments.map(seg => {
      const content = String(seg.content || '');
      const len = content.length;
      const pct = totalLen ? (len / totalLen * 100).toFixed(1) : '0.0';
      const pretty = tryPrettyJson(content);
      const shown = pretty || content;
      const body = len
        ? '<pre class="we-prompt-seg-pre' + (pretty ? ' we-prompt-seg-pre-json' : '') + '">' + u(shown) + '</pre>'
        : '<div class="we-empty">本轮未启用</div>';
      return '<details class="we-prompt-seg-card">'
        + '<summary><span>' + u(seg.label || seg.key || '分段') + '</span><b>' + len + '字 · ' + pct + '%</b></summary>'
        + body
        + '</details>';
    }).join('') : '<div class="we-empty">暂无分段数据，显示完整 Prompt 预览</div>';

    const rawResult = String(dbg.rawResult || '');
    const prettyRaw = tryPrettyJson(rawResult);
    const rawShown = prettyRaw || rawResult;
    const rawCard = '<details class="we-prompt-seg-card we-prompt-seg-card-raw">'
      + '<summary><span>AI 返回（推演 API 原始结果）</span><b>' + rawResult.length + '字' + (prettyRaw ? ' · JSON' : '') + '</b></summary>'
      + (rawResult ? '<pre class="we-prompt-seg-pre' + (prettyRaw ? ' we-prompt-seg-pre-json' : '') + '">' + u(rawShown) + '</pre>' : '<div class="we-empty">无 API 返回</div>')
      + '</details>';

    const fallbackPrompt = segments.length ? '' : '<pre class="we-prompt-seg-pre">' + u(String(dbg.prompt || '').slice(0, 3000)) + '</pre>';

    return '<div class="we-prompt-debug">'
      + injectCard
      + '<div class="we-prompt-debug-summary">Prompt 共 ' + totalLen + ' 字，分 ' + segments.length + ' 段。</div>'
      + '<div class="we-prompt-seg-list">' + segmentCards + rawCard + fallbackPrompt + '</div>'
      + '<div style="display:flex;gap:6px;margin-top:8px;">'
      + '<button class="we-btn" id="we-export-prompt" style="flex:1;">导出完整 Prompt</button>'
      + '<button class="we-btn" id="we-export-raw-result" style="flex:1;">导出 API 返回</button>'
      + '</div>'
      + '</div>';
  }
  function renderSettingsForm() {
    const settings = window.WORLD_ENGINE_API
      ? window.WORLD_ENGINE_API.getSettings(true)
      : JSON.parse(window.WORLD_ENGINE_STORE.getItem('world_engine_settings') || '{}');
    const mode = (settings.evolveMode === 'manual' || settings.evolveMode === 'time') ? settings.evolveMode : 'auto';
    const everyX = Math.max(1, parseInt(settings.evolveEveryX) || 1);
    const readRounds = Math.min(everyX, Math.max(1, parseInt(settings.evolveReadRounds) || 1));
    const manualReadRounds = Math.max(1, parseInt(settings.manualReadRounds) || 1);
    const apiTemperature = Number.isFinite(Number(settings.temperature)) ? Math.max(0, Number(settings.temperature)) : 0.7;
    const apiMaxTokens = Math.max(1, parseInt(settings.maxTokens) || 8000);
    const apiAutoRetries = Math.max(0, parseInt(settings.apiAutoRetries) || 0);
    const apiTimeoutMs = Number.isFinite(Number(settings.apiTimeoutMs)) ? Number(settings.apiTimeoutMs) : 120000;
    const apiTimeoutSec = Math.max(0, Math.round(apiTimeoutMs / 1000));
    // 按时间模式的当前值
    const _stForTime = core.hasState() ? core.loadState() : null;
    const _cpForTime = core.restoreCheckpoint();
    const stTimeVal = (_stForTime && _stForTime.time != null) ? _stForTime.time : '';
    const cpTimeVal = (_cpForTime && _cpForTime.time != null) ? _cpForTime.time : '';
    const lastDayVal = (core.getLastStoryDay && core.getLastStoryDay() != null) ? core.getLastStoryDay() : '';
    const tv = (k, d) => (settings[k] != null && settings[k] !== '') ? settings[k] : d;

    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';

    const apiBody = `
      ${renderApiProfileControls(settings)}
      <div class="we-input-group">
        <label>API URL（OpenAI 兼容）</label>
        <input type="text" id="we-api-url" value="${u(settings.apiUrl||'')}" placeholder="https://api.openai.com/v1">
      </div>
      <div class="we-input-group">
        <label>API Key</label>
        <input type="password" id="we-api-key" value="${u(settings.apiKey||'')}">
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;align-items:end;">
        <div style="flex:1;">
          <label>模型</label>
          <input type="text" id="we-model" value="${u(settings.model||'gpt-3.5-turbo')}" placeholder="模型名称" style="width:100%;">
        </div>
        <button class="we-btn" id="we-fetch-models" style="white-space:nowrap;flex-shrink:0;">获取列表</button>
      </div>
      <div class="we-input-group">
        <select id="we-model-list" style="display:none;width:100%;margin-top:4px;">
          <option value="">-- 选择模型 --</option>
        </select>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-use-st-proxy" ${settings.useStProxy !== false ? 'checked' : ''}>
          经酒馆后端转发（绕过浏览器跨域/CORS）
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">开启后请求经 SillyTavern 后端转发到目标 API，可解决"拉不到模型/请求被拦截"。关闭则浏览器直连（需目标接口允许跨域）。非酒馆环境下自动直连。</div>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;">
        <div style="flex:1;">
          <label>温度</label>
          <input type="number" id="we-temperature" min="0" step="0.1" value="${apiTemperature}" style="width:100%;">
        </div>
        <div style="flex:1;">
          <label>最大输出 token</label>
          <input type="number" id="we-max-tokens" min="1" step="1" value="${apiMaxTokens}" style="width:100%;">
        </div>
      </div>
      <div class="we-input-group">
        <label>请求超时（秒）</label>
        <input type="number" id="we-api-timeout-sec" min="0" step="1" value="${apiTimeoutSec}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">超过该时间仍未收到完整响应会自动中止并解除「推演中」状态。0 = 不超时。</div>
      </div>
      <div class="we-input-group">
        <label>API fault 自动重试次数</label>
        <input type="number" id="we-api-auto-retries" min="0" step="1" value="${apiAutoRetries}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">仅连接、HTTP、超时、空返回或 JSON 无法修补等 fault 才重试；主动停止或切换聊天不重试。默认 0。</div>
      </div>`;

    const evolveBody = `
      <div class="we-input-group">
        <label>推演模式</label>
        <select id="we-evolve-mode" style="width:100%;">
          <option value="auto" ${mode === 'auto' ? 'selected' : ''}>自动 · 按轮（每 X 轮推演一次）</option>
          <option value="time" ${mode === 'time' ? 'selected' : ''}>自动 · 按时间（正文日期差够 N 天）</option>
          <option value="manual" ${mode === 'manual' ? 'selected' : ''}>手动（仅点「手动推演」才触发）</option>
        </select>
      </div>
      <div class="we-input-group" id="we-evolve-everyx-group" style="${mode === 'auto' ? '' : 'display:none;'}">
        <label>每几轮推演一次（X）</label>
        <input type="number" id="we-evolve-everyx" min="1" step="1" value="${everyX}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">填 1 = 每轮推演；填 3 = 每向前 3 轮推演一次。重 roll 不计入轮数。</div>
      </div>
      <div class="we-input-group" id="we-evolve-readrounds-group" style="${mode === 'auto' ? '' : 'display:none;'}">
        <label>每次推演读取最近几轮对话（a）</label>
        <input type="number" id="we-evolve-readrounds" min="1" max="${everyX}" step="1" value="${readRounds}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">从当前层往前取 a 轮的「用户输入 + AI 输出」喂给后台推演。最小 1，最大不超过 X（每次推演的轮数）。默认 1 = 只读最新一轮。</div>
      </div>
      <div class="we-input-group" id="we-manual-readrounds-group" style="${mode === 'manual' ? '' : 'display:none;'}">
        <label>手动推演读取最近几轮对话</label>
        <input type="number" id="we-manual-readrounds" min="1" step="1" value="${manualReadRounds}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">点击「向前推进」或「重新推进」时，从当前层往前取这些轮的「用户输入 + AI 输出」喂给后台推演。默认 1 = 只读最新一轮。</div>
      </div>
      <div id="we-evolve-time-group" style="${mode === 'time' ? '' : 'display:none;'}">
        <div class="we-input-group" style="display:flex;gap:6px;">
          <div style="flex:1;"><label>取正文前 N 字</label><input type="number" id="we-time-front" min="0" step="1" value="${tv('evolveTimeFront', 0)}" style="width:100%;"></div>
          <div style="flex:1;"><label>取正文后 N 字</label><input type="number" id="we-time-back" min="0" step="1" value="${tv('evolveTimeBack', 80)}" style="width:100%;"></div>
        </div>
        <div class="we-input-group">
          <label>日期正则（6 框：1/3/5 抓数字 → 捕获组，2/4/6 单位）</label>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <input type="text" id="we-time-re1" value="${u(tv('evolveTimeRe1',''))}" placeholder="框1 如 \\d+ 或 [一二三...]+" style="flex:1 1 30%;">
            <input type="text" id="we-time-re2" value="${u(tv('evolveTimeRe2',''))}" placeholder="框2 单位 如 年" style="flex:1 1 18%;">
            <input type="text" id="we-time-re3" value="${u(tv('evolveTimeRe3',''))}" placeholder="框3" style="flex:1 1 30%;">
            <input type="text" id="we-time-re4" value="${u(tv('evolveTimeRe4',''))}" placeholder="框4 如 月" style="flex:1 1 18%;">
            <input type="text" id="we-time-re5" value="${u(tv('evolveTimeRe5',''))}" placeholder="框5" style="flex:1 1 30%;">
            <input type="text" id="we-time-re6" value="${u(tv('evolveTimeRe6',''))}" placeholder="框6 如 日/号" style="flex:1 1 18%;">
          </div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">某框留空即跳过。中文数字自动换算，多个日期取最后一个。</div>
        </div>
        <div class="we-input-group" style="display:flex;gap:6px;">
          <div style="flex:1;"><label>乘数A（框1）</label><input type="number" id="we-time-mul1" step="any" value="${tv('evolveTimeMul1',360)}" style="width:100%;"></div>
          <div style="flex:1;"><label>乘数B（框3）</label><input type="number" id="we-time-mul2" step="any" value="${tv('evolveTimeMul2',30)}" style="width:100%;"></div>
          <div style="flex:1;"><label>乘数C（框5）</label><input type="number" id="we-time-mul3" step="any" value="${tv('evolveTimeMul3',1)}" style="width:100%;"></div>
        </div>
        <div class="we-input-group">
          <label>满 N 天推演一次</label>
          <input type="number" id="we-time-threshold" min="1" step="1" value="${tv('evolveTimeThreshold',1)}" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>最多读取最近 X 轮对话</label>
          <input type="number" id="we-time-maxrounds" min="1" step="1" value="${tv('evolveTimeMaxRounds',10)}" style="width:100%;">
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">自上次推演以来跨了几轮就读几轮，超过 X 则只读最近 X 轮，封顶防止 prompt 过长。</div>
        </div>
        <div class="we-input-group" style="border-top:1px solid var(--we-border,#3a3a3a);padding-top:8px;">
          <label>当前状态时间（总天数）</label>
          <input type="number" id="we-time-state" step="any" value="${stTimeVal}" placeholder="state.time，空则不写" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>存档点时间（总天数）</label>
          <input type="number" id="we-time-checkpoint" step="any" value="${cpTimeVal}" placeholder="checkpoint.time，空则不写" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>本轮对话时间（总天数）</label>
          <input type="number" id="we-time-current" step="any" value="${lastDayVal}" placeholder="保存即判断是否推演" style="width:100%;">
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">保存后：与基准时间相减，够 N 天则立即推演。三个时间框都只在有值时写入，写错可关闭插件重开重填。</div>
        </div>
      </div>`;

    const filterBody = `
      <div class="we-input-group">
        <label>每行一条正则，匹配内容会在喂后台前删除</label>
        <div style="margin-bottom:8px;border:1px solid var(--we-border,#3a3a3a);border-radius:4px;padding:6px;">
          <div style="font-size:12px;color:var(--we-text2);margin-bottom:4px;">简单模式：勾选标签自动生成删除正则</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
            <button class="we-btn" id="we-btn-filter-scan" type="button">扫描本聊天标签</button>
            <input type="text" id="we-filter-add-input" placeholder="手动加标签名，如 think" style="flex:1;min-width:140px;">
            <button class="we-btn" id="we-btn-filter-add" type="button">添加</button>
          </div>
          <div id="we-filter-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:4px;"></div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">自动生成的正则不一定适合带属性、带 ~、嵌套或闭标签异常的标签；遇到不生效时可直接编辑下方文本框。未勾选标签不会保存。</div>
        </div>
        <textarea id="we-filter-regex" rows="4" style="width:100%;resize:vertical;" placeholder="每行一条；支持纯 pattern 或 /pattern/flags。例：\n<details>[\\s\\S]*?</details>\\n?\n/&lt;think&gt;[\\s\\S]*?&lt;\\/think&gt;/g">${u(tv('evolveFilterRegex',''))}</textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px;">
          <button class="we-btn" id="we-btn-filter-test" type="button">测试正则</button>
        </div>
        <div class="we-hint" id="we-filter-status" style="margin:0 0 4px;white-space:pre-wrap;"></div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">每行一条；支持纯 pattern（默认 g 全局）或 /pattern/flags 字面量。不影响聊天正文，也不影响日期抓取。</div>
      </div>`;

    const injectMaxChars = Number.isFinite(Number(settings.injectMaxChars)) ? Math.max(0, Math.floor(Number(settings.injectMaxChars))) : 5000;
    const injectBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-inject-into-prompt" ${settings.injectIntoPrompt !== false ? 'checked' : ''}>
          注入正文
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">关闭后不会将当前状态或存档点注入聊天正文。</div>
      </div>
      <div class="we-input-group">
        <label>正文注入最大字符数</label>
        <input type="number" id="we-inject-max-chars" min="0" step="100" value="${injectMaxChars}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">限制注入到正文 prompt 的世界状态长度。默认 5000；0 = 不限制。</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-inject-all-levels" ${settings.injectAllLevels === true ? 'checked' : ''}>
          全等级注入
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">开启后事件链和风声的 Lv1-Lv4 全部注入正文；关闭时维持原有高等级筛选。</div>
      </div>`;

    // [移植 v2.4.1] 本地机制调参：区域事件 / 事件骰子 / 风声消散 / 保留上限，关键公式直接写在设置里
    const mech = (k, d) => { const v = settings[k]; return (v === undefined || v === null || v === '') ? d : v; };
    const localPreset = (() => {
      try { return window.WORLD_ENGINE_PRESETS?.getActivePreset?.() || {}; } catch (e) { return {}; }
    })();
    const localProfile = localPreset.localMechanics || {};
    const followPresetRow = (id, key, summary) => `
      <div class="we-input-group" style="padding:8px 10px;border:1px solid var(--we-border);border-radius:8px;background:var(--we-bg2, rgba(255,255,255,0.04));">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0;">
          <input type="checkbox" id="${id}" ${settings[key] !== false ? 'checked' : ''}>
          跟随当前世界观预设
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:4px;line-height:1.5;">预设值：${summary}。取消勾选后使用下方手动值。</div>
      </div>`;
    const numInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="flex:1;min-width:112px;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const wideNumInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="width:100%;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const regionalBody = `
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        区域突发事件是纯本地骰子：先由本地判定是否发生，再把事件类型和约束交给推演模型写成世界变化。
        概率越高，远方灾变、治安事件、交通断裂这类背景波动越频繁。
      </div>
      ${followPresetRow('we-local-ri-use-preset', 'localRegionalIncidentUsePreset',
        `概率 ${Math.round(Number(localPreset.regionalIncidents?.chance || 0.03) * 1000) / 10}% / 持续 ${localPreset.regionalIncidents?.durationRounds ?? 5} 轮 / 冷却 ${localPreset.regionalIncidents?.cooldownRounds ?? 5} 轮`)}
      <div class="we-input-group">
        <label>区域突发事件参数</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-ri-chance', 'localRegionalIncidentChancePercent', '触发概率 %', 3, 0, '0.1')}
          ${numInput('we-local-ri-duration', 'localRegionalIncidentDuration', '持续轮数', 5, 1, '1')}
          ${numInput('we-local-ri-cooldown', 'localRegionalIncidentCooldown', '消散后冷却', 5, 0, '1')}
        </div>
      </div>`;

    const distantBody = `
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        账本达到门槛后按概率生成一条与主角及既有账本无直接关系的远方事件链或风声（Lv2/Lv3）。<br>
        类型由本地预选；返回不合格或 API fault 时保留同一类型与账本样本继续尝试。当前预设未启用 events/winds 时自动停用对应目标。
      </div>
      ${followPresetRow('we-local-distant-use-preset', 'localDistantEventUsePreset',
        `门槛 ${localProfile.distantEvent?.ledgerThreshold ?? 10} / 概率 ${localProfile.distantEvent?.chancePercent ?? 20}% / 冷却 ${localProfile.distantEvent?.cooldownRounds ?? 5} / 事件占比 ${localProfile.distantEvent?.eventPercent ?? 50}%`)}
      <div class="we-input-group">
        <label>远方随机事件参数</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-distant-threshold', 'localDistantEventLedgerThreshold', '账本门槛', 10, 1, '1')}
          ${numInput('we-local-distant-chance', 'localDistantEventChancePercent', '触发概率 %', 20, 0, '0.1')}
          ${numInput('we-local-distant-cooldown', 'localDistantEventCooldown', '成功后冷却', 5, 0, '1')}
          ${numInput('we-local-distant-event-percent', 'localDistantEventEventPercent', '事件链占比 %', 50, 0, '0.1')}
        </div>
      </div>`;

    const nearBody = `
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        按概率生成一条与当前对话、主角、所在区域或正在发展事项有明确因果的近端事件链或风声（Lv2/Lv3）。<br>
        类型由本地预选；返回不合格或 API fault 时保持原类型继续尝试。当前预设未启用 events/winds 时自动停用对应目标。
      </div>
      ${followPresetRow('we-local-near-use-preset', 'localNearEventUsePreset',
        `概率 ${localProfile.nearEvent?.chancePercent ?? 20}% / 冷却 ${localProfile.nearEvent?.cooldownRounds ?? 5} / 事件占比 ${localProfile.nearEvent?.eventPercent ?? 50}%`)}
      <div class="we-input-group">
        <label>近端随机事件参数</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-near-chance', 'localNearEventChancePercent', '触发概率 %', 20, 0, '0.1')}
          ${numInput('we-local-near-cooldown', 'localNearEventCooldown', '成功后冷却', 5, 0, '1')}
          ${numInput('we-local-near-event-percent', 'localNearEventEventPercent', '事件链占比 %', 50, 0, '0.1')}
        </div>
      </div>`;

    const diceBody = `
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        每条事件链每轮掷 1d100。设阶段格数 r = 当前格数 / 9。<br>
        目标值 T = 阶段基础值 - 200 × r × (1 - r) + Lv修正 - 全局推进修正。<br>
        若 骰值 &gt; T：推进一格；若 骰值 &lt; T × 受挫系数：倒退一格；否则保持。<br>
        冲突型 Lv 修正 = -(Lv - 1) × 10，Lv 越高越容易爆发。推进型 Lv 修正 = +(Lv - 1) × 10，Lv 越高越难完成。
      </div>
      ${followPresetRow('we-local-dice-use-preset', 'localEventDiceUsePreset',
        `推进修正 ${localProfile.eventDice?.modifier ?? 0} / 受挫 ${localProfile.eventDice?.setbackRatioPercent ?? 40}% / 保底 A=${localProfile.eventDice?.progressFailBase ?? 2}, B=${localProfile.eventDice?.conflictFailBase ?? 6}`)}
      <div class="we-input-group">
        <label>事件骰子公式参数</label>
        <div style="margin-bottom:6px;">
          ${wideNumInput('we-local-dice-mod', 'localEventDiceModifier', '全局推进修正', 0, -100, '1')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-setback-ratio', 'localEventSetbackRatioPercent', '受挫系数 %', 40, 0, '1')}
          ${numInput('we-local-progress-fail-base', 'localProgressFailBase', '推进型保底 A', 2, 0, '1')}
          ${numInput('we-local-conflict-fail-base', 'localConflictFailBase', '冲突型保底 B', 6, 1, '1')}
        </div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">
          保底公式：推进型连续失败上限 = A + Lv；冲突型连续失败上限 = max(1, B - Lv)。达到上限后强制推进一格。
        </div>
      </div>`;

    const winddecayBody = `
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        风声本轮没有被同主题更新时，沉寂轮数 +1。沉寂轮数 ≤ grace 时不检查消散。<br>
        超过 grace 后：n = 沉寂轮数 - grace - 1。<br>
        消散率 P = clamp(base + linear × n + quadratic × n² - (Lv - 1) × 10, 5, 95)。<br>
        掷 1d100，若 骰值 ≤ P，则该风声消散。Lv 越高，越不容易消散。
      </div>
      ${followPresetRow('we-local-wind-use-preset', 'localWindDecayUsePreset',
        `公告 ${localProfile.windDecay?.announcement?.base ?? 10}/${localProfile.windDecay?.announcement?.grace ?? 4}/${localProfile.windDecay?.announcement?.linear ?? 3}/${localProfile.windDecay?.announcement?.quadratic ?? 1}，消息 ${localProfile.windDecay?.report?.base ?? 20}/${localProfile.windDecay?.report?.grace ?? 2}/${localProfile.windDecay?.report?.linear ?? 4}/${localProfile.windDecay?.report?.quadratic ?? 2}，流言 ${localProfile.windDecay?.rumor?.base ?? 25}/${localProfile.windDecay?.rumor?.grace ?? 1}/${localProfile.windDecay?.rumor?.linear ?? 5}/${localProfile.windDecay?.rumor?.quadratic ?? 3}，舆论 ${localProfile.windDecay?.sentiment?.base ?? 8}/${localProfile.windDecay?.sentiment?.grace ?? 5}/${localProfile.windDecay?.sentiment?.linear ?? 2}/${localProfile.windDecay?.sentiment?.quadratic ?? 1}`)}
      <div class="we-input-group">
        <label>风声消散公式参数</label>
        ${['Rumor:流言:25:1:5:3','Sentiment:舆论:8:5:2:1','Report:消息:20:2:4:2','Announcement:公告:10:4:3:1'].map(row => {
          const p = row.split(':');
          return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">'
            + '<div style="width:42px;color:var(--we-text2);font-size:12px;align-self:center;">' + p[1] + '</div>'
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-base', 'localWind' + p[0] + 'Base', 'base', p[2], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-grace', 'localWind' + p[0] + 'Grace', 'grace', p[3], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-linear', 'localWind' + p[0] + 'Linear', 'linear', p[4], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-quadratic', 'localWind' + p[0] + 'Quadratic', 'quadratic', p[5], 0, '1')
            + '</div>';
        }).join('')}
      </div>`;

    const retentionBody = `
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        这里控制“东西在面板里留多久”和“每类最多存多少”。<br>
        正面终局事件（已爆发 / 已完成）保留轮数 = 基础保留 + Lv × 每级额外保留。<br>
        负面终局事件（已消散 / 已失败）下一轮清退；影响链、已终结仇敌、账本分别按各自保存轮数清退。
      </div>
      ${followPresetRow('we-local-retention-use-preset', 'localRetentionUsePreset',
        `终局 ${localProfile.retention?.terminalBaseKeepRounds ?? 2}+Lv×${localProfile.retention?.terminalLevelKeepRounds ?? 2} 轮 / 影响 ${localProfile.retention?.influenceKeepRounds ?? 8} / 仇敌 ${localProfile.retention?.enemyTerminalKeepRounds ?? 20} / 账本 ${localProfile.retention?.ledgerKeepRounds ?? 20}`)}
      <div class="we-input-group">
        <label>保留轮数</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-terminal-base', 'localTerminalBaseKeepRounds', '终局基础保留', 2, 0, '1')}
          ${numInput('we-local-terminal-level', 'localTerminalLevelKeepRounds', '每级额外保留', 2, 0, '1')}
          ${numInput('we-local-influence-keep', 'localInfluenceKeepRounds', '影响链保留', 8, 1, '1')}
          ${numInput('we-local-enemy-keep', 'localEnemyTerminalKeepRounds', '已终结仇敌保留', 20, 1, '1')}
          ${numInput('we-local-ledger-keep', 'localLedgerKeepRounds', '账本保存轮数', 20, 1, '1')}
        </div>
      </div>
      <div class="we-input-group">
        <label>容量上限</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-cap-events', 'localCapEvents', '事件上限', 16, 1, '1')}
          ${numInput('we-local-cap-factions', 'localCapFactions', '势力上限', 15, 1, '1')}
          ${numInput('we-local-cap-winds', 'localCapWinds', '风声上限', 12, 1, '1')}
          ${numInput('we-local-cap-trends', 'localCapWorldTrends', '大势上限', 4, 1, '1')}
          ${numInput('we-local-cap-influence', 'localCapInfluence', '影响链上限', 12, 1, '1')}
          ${numInput('we-local-cap-enemies', 'localCapEnemies', '仇敌上限', 8, 1, '1')}
          ${numInput('we-local-cap-econ', 'localCapEconomySignals', '经济信号上限', 8, 1, '1')}
          ${numInput('we-local-cap-blackbox', 'localCapBlackbox', '黑盒总上限', 12, 1, '1')}
        </div>
      </div>`;

    const displayMode = settings.displayMode === 'expand' ? 'expand' : 'mask';
    const _curTheme = getStoredTheme();
    const _themeOpts = WE_THEMES.map(t => '<option value="' + t.id + '"' + (t.id === _curTheme ? ' selected' : '') + '>' + t.name + '</option>').join('');
    const displayBody = `
      <div class="we-input-group">
        <label>主题配色</label>
        <select id="we-theme-select" style="width:100%;">${_themeOpts}</select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">切换即时生效，无需保存。深色：墨玉 / 夜阑 / 深海 / 夜合；浅色：云白 / 早樱。</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-show-ball" ${settings.showFloatingBall !== false ? 'checked' : ''}>
          显示悬浮球
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">关闭后悬浮球隐藏，可从输入框左侧「魔法棒」扩展菜单打开本面板；向前推进 / 重新推进 / 停止 / 插头按钮移到面板标题栏。</div>
      </div>
      <div class="we-input-group">
        <label>快速回复按钮</label>
        <button class="we-btn" id="we-add-qr" style="width:100%;">添加「🌍面板 / ▶推演」到快速回复</button>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">需启用酒馆自带的 Quick Reply 扩展。创建「世界引擎」按钮组（消息为 /we-panel 与 /we-evolve 斜杠命令），可在快速回复设置里自行改名或增删；重复点击不会重复添加。</div>
      </div>
      <div class="we-input-group">
        <label>主页显示模式</label>
        <select id="we-display-mode" style="width:100%;">
          <option value="mask" ${displayMode === 'mask' ? 'selected' : ''}>遮蔽模式（主页 + 分页进入）</option>
          <option value="expand" ${displayMode === 'expand' ? 'selected' : ''}>展开模式（所有内容平铺）</option>
        </select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">展开模式下世界摘要下方直接平铺全部 section，无需进分页。</div>
      </div>`;

    return {
      api: sec('set-api', 'API 配置', apiBody),
      evolve: sec('set-evolve', '推演模式', evolveBody),
      filter: sec('set-filter', '输入输出过滤器', filterBody),
      display: sec('set-display', '界面显示', displayBody),
      inject: sec('set-inject', '正文注入', injectBody),
      mechanics: sec('set-regional', '区域事件', regionalBody)
        + sec('set-near', '近端随机事件', nearBody)
        + sec('set-distant', '远方随机事件', distantBody)
        + sec('set-dice', '事件骰子', diceBody)
        + sec('set-winddecay', '风声消散', winddecayBody)
        + sec('set-retention', '保留上限', retentionBody)
    };
  }

  function renderSettingsAfterCheckpoint() {
    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';
    const worldbookTrigger = window.WORLD_ENGINE_API?.getSettings?.(true)?.worldbookTrigger === true;
    const worldbookBody = `
      <div class="we-worldbook-settings">
        <div class="we-worldbook-header">
          <div><div class="we-worldbook-summary" id="we-worldbook-summary">正在读取当前聊天世界书...</div></div>
          <button class="we-icon-btn" id="we-worldbook-reload" title="重新读取当前聊天世界书"><i class="fa-solid fa-rotate"></i></button>
        </div>
        <div class="we-input-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="we-worldbook-trigger" ${worldbookTrigger ? 'checked' : ''}>
            启用蓝绿灯触发（常驻 / 关键词命中）
          </label>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">关闭时：所有已勾选条目都会注入。开启后：已勾选条目还需满足常驻或关键词命中；每条可单独强制。</div>
        </div>
        <div class="we-worldbook-toolbar">
          <button class="we-btn" id="we-worldbook-select-all">全选</button>
          <button class="we-btn" id="we-worldbook-clear-all">取消全选</button>
          <button class="we-btn we-btn-primary" id="we-worldbook-save">保存世界书选择</button>
        </div>
        <div class="we-worldbook-list" id="we-worldbook-list"><div class="we-empty">正在读取...</div></div>
      </div>`;
    const dataBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-export-data">导出 JSON</button>
        <button class="we-btn" id="we-import-data">导入 JSON</button>
        <input type="file" id="we-import-file" accept=".json" style="display:none;">
      </div>`;
    const includePresetForTone = window.WORLD_ENGINE_STORE?.getItem?.('world_engine_tone_generate_with_preset') !== 'false';
    const toneLibraryOptions = (function () {
      try {
        const raw = window.WORLD_ENGINE_STORE?.getItem?.('world_engine_tone_library');
        const list = raw ? (JSON.parse(raw) || []) : [];
        if (!Array.isArray(list) || !list.length) return '<option value="">（库为空）</option>';
        const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return '<option value="">— 选择已保存的提示词 —</option>' + list.map((it) =>
          '<option value="' + escAttr(it.id) + '">' + escAttr(it.name || '(未命名)') + '</option>').join('');
      } catch (e) { return '<option value="">（库为空）</option>'; }
    })();
    const toneBody = `
      <textarea id="we-tone-text" rows="5" style="width:100%;resize:vertical;" placeholder="在此查看或编辑当前聊天的附加提示词，编辑后点「保存编辑」生效…"></textarea>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
        <button class="we-btn we-btn-primary" id="we-tone-save-text">保存编辑</button>
        <button class="we-btn" id="we-tone-generate">&#20174;&#35774;&#23450;&#29983;&#25104;</button>
        <button class="we-btn" id="we-tone-import">导入</button>
        <button class="we-btn" id="we-tone-export">导出</button>
        <button class="we-btn" id="we-tone-clear">清除</button>
        <input type="file" id="we-tone-file" accept=".txt" style="display:none;">
      </div>
      <input type="text" id="we-tone-guidance" placeholder="生成指导（可留空）：例如 侧重战斗紧张感、强调资源稀缺" style="width:100%;margin-top:6px;">
      <label class="we-hint" style="display:flex;align-items:center;gap:6px;margin-top:6px;">
        <input type="checkbox" id="we-tone-generate-preset" ${includePresetForTone ? 'checked' : ''}> &#29983;&#25104;&#26102;&#21442;&#32771;&#24403;&#21069;&#19990;&#30028;&#39044;&#35774;
      </label>
      <div style="border-top:1px solid var(--we-border,rgba(255,255,255,0.1));margin-top:10px;padding-top:8px;">
        <label class="we-hint" style="display:block;margin-bottom:4px;">提示词库（全局共享，可跨聊天复用）</label>
        <select id="we-tone-library" style="width:100%;">${toneLibraryOptions}</select>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
          <button class="we-btn we-btn-primary" id="we-tone-lib-apply">切换为此条</button>
          <button class="we-btn" id="we-tone-lib-save">保存当前到库</button>
          <button class="we-btn we-btn-danger" id="we-tone-lib-delete">删除此条</button>
        </div>
      </div>
      <div class="we-hint" id="we-tone-status" style="margin-top:6px;"></div>`;
    const backupBody = window.WORLD_ENGINE_BACKUP && window.WORLD_ENGINE_BACKUP.sectionBodyHtml
      ? window.WORLD_ENGINE_BACKUP.sectionBodyHtml()
      : '<div class="we-empty">备份模块未加载</div>';
    return {
      worldbook: sec('set-worldbook', '后台推演世界书', worldbookBody),
      data: sec('set-data', '数据导入/导出', dataBody),
      backup: sec('set-backup', '世界存档备份', backupBody),
      tone: sec('set-tone', '附加提示词', toneBody)
    };
  }

  function bindEvents(state) {
    function readApiFields() {
      const fields = {
        apiUrl: (document.getElementById('we-api-url')?.value || '').trim(),
        apiKey: document.getElementById('we-api-key')?.value || ''
      };
      // 同时捕获当前「模型」输入，避免保存/更新配置档时把未保存的模型改动覆盖回旧值
      const modelEl = document.getElementById('we-model');
      if (modelEl) fields.model = modelEl.value || '';
      return fields;
    }

    function persistApiFields(activeId) {
      const api = window.WORLD_ENGINE_API;
      const current = api && api.getSettings ? api.getSettings(true) : {};
      const fields = readApiFields();
      const nextActiveId = activeId !== undefined
        ? activeId
        : findMatchingApiProfile(fields.apiUrl, fields.apiKey, current.apiProfileActiveId || '');
      window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({
        ...current,
        ...fields,
        apiProfileActiveId: nextActiveId || ''
      }));
      if (api && api.getSettings) api.getSettings(true);
    }

    function applyApiProfile(profile) {
      if (!profile) return;
      const urlInput = document.getElementById('we-api-url');
      const keyInput = document.getElementById('we-api-key');
      const nameInput = document.getElementById('we-api-profile-name');
      const select = document.getElementById('we-api-profile-select');
      if (urlInput) urlInput.value = profile.apiUrl || '';
      if (keyInput) keyInput.value = profile.apiKey || '';
      if (nameInput) nameInput.value = profile.name || '';
      const modelInput = document.getElementById('we-model');
      if (modelInput && profile.model) modelInput.value = profile.model;
      if (select) select.value = profile.id;
      persistApiFields(profile.id);
      showToast('已切换到配置档：' + profile.name);
    }

    const apiProfileSelect = document.getElementById('we-api-profile-select');
    const apiProfileApply = document.getElementById('we-api-profile-apply');
    const apiProfileSave = document.getElementById('we-api-profile-save');
    const apiProfileUpdate = document.getElementById('we-api-profile-update');
    const apiProfileDelete = document.getElementById('we-api-profile-delete');

    function getSelectedApiProfile() {
      const id = apiProfileSelect?.value || '';
      return getApiProfiles().find(profile => profile.id === id) || null;
    }

    if (apiProfileSelect) {
      apiProfileSelect.onchange = () => {
        const selected = getSelectedApiProfile();
        if (selected) applyApiProfile(selected);
      };
    }

    if (apiProfileApply) {
      apiProfileApply.onclick = () => {
        const selected = getSelectedApiProfile();
        if (!selected) { showToast('请先选择配置档', true); return; }
        applyApiProfile(selected);
      };
    }

    if (apiProfileSave) {
      apiProfileSave.onclick = () => {
        const fields = readApiFields();
        if (!fields.apiUrl && !fields.apiKey) { showToast('请先填写 API URL 或 API Key', true); return; }
        const nameInput = document.getElementById('we-api-profile-name');
        const name = (nameInput?.value || '').trim() || defaultApiProfileName(fields.apiUrl);
        const profiles = getApiProfiles();
        const now = Date.now();
        let savedId = '';
        const sameName = profiles.find(profile => profile.name === name);
        if (sameName) {
          sameName.apiUrl = fields.apiUrl;
          sameName.apiKey = fields.apiKey;
          sameName.model = fields.model || '';
          sameName.updatedAt = now;
          savedId = sameName.id;
        } else {
          savedId = 'api_profile_' + now + '_' + Math.random().toString(36).slice(2, 8);
          profiles.push({ id: savedId, name, apiUrl: fields.apiUrl, apiKey: fields.apiKey, model: fields.model || '', updatedAt: now });
        }
        saveApiProfiles(profiles);
        persistApiFields(savedId);
        showToast('配置档已保存：' + name);
        refresh();
      };
    }

    if (apiProfileUpdate) {
      apiProfileUpdate.onclick = () => {
        const selected = getSelectedApiProfile();
        if (!selected) { showToast('请先选择配置档', true); return; }
        const fields = readApiFields();
        const name = (document.getElementById('we-api-profile-name')?.value || '').trim() || selected.name;
        const profiles = getApiProfiles();
        const target = profiles.find(profile => profile.id === selected.id);
        if (!target) { showToast('配置档不存在', true); return; }
        target.name = name;
        target.apiUrl = fields.apiUrl;
        target.apiKey = fields.apiKey;
        target.model = fields.model || '';
        target.updatedAt = Date.now();
        saveApiProfiles(profiles);
        persistApiFields(target.id);
        showToast('配置档已更新：' + name);
        refresh();
      };
    }

    if (apiProfileDelete) {
      apiProfileDelete.onclick = () => {
        const selected = getSelectedApiProfile();
        if (!selected) { showToast('请先选择配置档', true); return; }
        if (!confirm('删除配置档 "' + selected.name + '"？')) return;
        const profiles = getApiProfiles().filter(profile => profile.id !== selected.id);
        saveApiProfiles(profiles);
        persistApiFields('');
        showToast('配置档已删除：' + selected.name);
        refresh();
      };
    }

    document.querySelectorAll('.we-event-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.eventScope;
        const index = Number(button.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event || !confirm(`删除事件“${event.name}”？`)) return;
        scopedState.events.splice(index, 1);
        editingEvent = null;
        saveScopedState(scope, scopedState);
        showToast('事件已删除');
        refresh();
      };
    });

    document.querySelectorAll('.we-event-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.eventScope;
        const index = Number(button.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event) return;
        const copy = JSON.parse(JSON.stringify(event));
        delete copy.id;  // [移植 v2.4.0] 复制品是新实体，由本地补新 id，不与原件共享身份
        delete copy.evolveResult;
        core.ensureEventFields(copy);
        scopedState.events.push(copy);
        saveScopedState(scope, scopedState);
        showToast('事件已复制到列表末尾');
        refresh();
      };
    });

    document.querySelectorAll('.we-event-edit').forEach(button => {
      button.onclick = () => {
        editingEvent = {
          scope: button.dataset.eventScope,
          index: Number(button.dataset.eventIndex)
        };
        refresh();
      };
    });

    document.querySelectorAll('.we-event-editor-close').forEach(button => {
      button.onclick = () => {
        editingEvent = null;
        refresh();
      };
    });

    document.querySelectorAll('.we-event-edit-type').forEach(select => {
      select.onchange = () => {
        const stageSelect = select.closest('.we-event-editor').querySelector('.we-event-edit-stage');
        const stages = select.value === 'progress'
          ? ['筹备', '执行', '关键', '已完成', '已失败']
          : ['萌芽', '发酵', '逼近', '已爆发', '已消散'];
        stageSelect.innerHTML = stages.map(stage => `<option value="${stage}">${stage}</option>`).join('');
      };
    });

    document.querySelectorAll('.we-event-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.eventScope;
        const index = Number(editor.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event) return;

        const name = editor.querySelector('.we-event-edit-name').value.trim();
        if (!name) {
          showToast('事件名字不能为空', true);
          return;
        }
        event.name = name;
        event.level = Number(editor.querySelector('.we-event-edit-level').value);
        event.type = editor.querySelector('.we-event-edit-type').value;
        event.stage = editor.querySelector('.we-event-edit-stage').value;
        event.stageRound = Math.min(9, Math.max(1, Number(editor.querySelector('.we-event-edit-round').value) || 1));
        event.desc = editor.querySelector('.we-event-edit-desc').value.trim();
        event.consecutiveFails = 0;
        delete event.evolveResult;

        // 剩余轮数 → 反推 _terminalSince（仅正面终局）
        const POSITIVE_TERMINALS = ['已爆发', '已完成'];
        if (POSITIVE_TERMINALS.includes(event.stage)) {
          const K = 2 + (event.level || 1) * 2;
          const curRound = scopedState.round || 0;
          let left = Number(editor.querySelector('.we-event-edit-left').value);
          left = Number.isFinite(left) && left >= 1 ? Math.min(K, left) : K;
          event._terminalSince = curRound - K + left - 1;
        } else {
          delete event._terminalSince;
        }
        if (!applySchemaExtraEditor(editor, event)) return;
        core.ensureEventFields(event);
        saveScopedState(scope, scopedState);
        editingEvent = null;
        showToast('事件修改已保存');
        refresh();
      };
    });

    // 势力编辑器事件
    document.querySelectorAll('.we-faction-edit').forEach(button => {
      button.onclick = () => {
        editingFaction = { scope: button.dataset.factionScope, index: Number(button.dataset.factionIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-editor-close').forEach(button => {
      button.onclick = () => { editingFaction = null; refresh(); };
    });
    document.querySelectorAll('.we-faction-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.factionScope;
        const index = Number(editor.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction) return;
        const name = editor.querySelector('.we-faction-edit-name').value.trim();
        if (!name) { showToast('势力名称不能为空', true); return; }
        faction.name = name;
        faction.status = editor.querySelector('.we-faction-edit-status').value;
        faction.relation = editor.querySelector('.we-faction-edit-relation').value;
        faction.scope = editor.querySelector('.we-faction-edit-scope').value.trim();
        faction.currentGoal = editor.querySelector('.we-faction-edit-goal').value.trim();
        faction.core_person = editor.querySelector('.we-faction-edit-core').value.trim();
        const pillars = [];
        editor.querySelectorAll('.we-faction-edit-pillar').forEach(input => {
          const v = input.value.trim().slice(0, 4);
          if (v) pillars.push(v);
        });
        faction.powerPillars = pillars;
        if (!applySchemaExtraEditor(editor, faction)) return;
        saveScopedState(scope, state);
        editingFaction = null;
        showToast('势力修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.factionScope;
        const index = Number(button.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction || !confirm(`删除势力"${faction.name}"？`)) return;
        state.factions.splice(index, 1);
        saveScopedState(scope, state);
        showToast('势力已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.factionScope;
        const index = Number(button.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction) return;
        const copy = JSON.parse(JSON.stringify(faction));
        delete copy.id;
        state.factions.splice(index + 1, 0, copy);
        saveScopedState(scope, state);
        showToast('势力已复制');
        refresh();
      };
    });

    // 风声编辑器事件
    document.querySelectorAll('.we-wind-edit').forEach(button => {
      button.onclick = () => {
        editingWind = { scope: button.dataset.windScope, index: Number(button.dataset.windIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-editor-close').forEach(button => {
      button.onclick = () => { editingWind = null; refresh(); };
    });
    document.querySelectorAll('.we-wind-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.windScope;
        const index = Number(editor.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind) return;
        const topic = editor.querySelector('.we-wind-edit-topic').value.trim();
        if (!topic) { showToast('风声主题不能为空', true); return; }
        wind.topic = topic;
        wind.type = editor.querySelector('.we-wind-edit-type').value;
        wind.level = Number(editor.querySelector('.we-wind-edit-level').value);
        wind.scope = editor.querySelector('.we-wind-edit-scope').value.trim();
        wind.source = editor.querySelector('.we-wind-edit-source').value.trim();
        wind.content = editor.querySelector('.we-wind-edit-content').value.trim();
        wind.quietRounds = 0;
        if (!applySchemaExtraEditor(editor, wind)) return;
        saveScopedState(scope, scopedState);
        editingWind = null;
        showToast('风声修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.windScope;
        const index = Number(button.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind || !confirm(`删除风声"${wind.topic}"？`)) return;
        scopedState.winds.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('风声已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.windScope;
        const index = Number(button.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind) return;
        const copy = JSON.parse(JSON.stringify(wind));
        delete copy.id;
        copy.quietRounds = 0;
        scopedState.winds.push(copy);
        saveScopedState(scope, scopedState);
        showToast('风声已复制');
        refresh();
      };
    });

    // ===== 天下大势编辑器事件 =====
    document.querySelectorAll('.we-trend-edit').forEach(button => {
      button.onclick = () => {
        editingTrend = { scope: button.dataset.trendScope, index: Number(button.dataset.trendIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-editor-close').forEach(button => {
      button.onclick = () => { editingTrend = null; refresh(); };
    });
    document.querySelectorAll('.we-trend-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.trendScope;
        const index = Number(editor.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend) return;
        const name = editor.querySelector('.we-trend-edit-name').value.trim();
        if (!name) { showToast('大势名称不能为空', true); return; }
        trend.name = name;
        trend.status = editor.querySelector('.we-trend-edit-status').value;
        trend.scope = editor.querySelector('.we-trend-edit-scope').value.trim();
        trend.source = editor.querySelector('.we-trend-edit-source').value.trim();
        trend.description = editor.querySelector('.we-trend-edit-desc').value.trim();
        if (!applySchemaExtraEditor(editor, trend)) return;
        saveScopedState(scope, scopedState);
        editingTrend = null;
        showToast('天下大势修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.trendScope;
        const index = Number(button.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend || !confirm(`删除大势"${trend.name}"？`)) return;
        scopedState.worldTrends.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('天下大势已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.trendScope;
        const index = Number(button.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend) return;
        const copy = JSON.parse(JSON.stringify(trend));
        delete copy.id;
        scopedState.worldTrends.push(copy);
        saveScopedState(scope, scopedState);
        showToast('天下大势已复制');
        refresh();
      };
    });

    // ===== 仇敌编辑器事件 =====
    document.querySelectorAll('.we-enemy-edit').forEach(button => {
      button.onclick = () => {
        editingEnemy = { scope: button.dataset.enemyScope, index: Number(button.dataset.enemyIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-editor-close').forEach(button => {
      button.onclick = () => { editingEnemy = null; refresh(); };
    });
    document.querySelectorAll('.we-enemy-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.enemyScope;
        const index = Number(editor.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy) return;
        const name = editor.querySelector('.we-enemy-edit-name').value.trim();
        if (!name) { showToast('仇敌名称不能为空', true); return; }
        enemy.name = name;
        enemy.type = editor.querySelector('.we-enemy-edit-type').value;
        enemy.status = editor.querySelector('.we-enemy-edit-status').value;
        enemy.reason = editor.querySelector('.we-enemy-edit-reason').value.trim();
        if (!applySchemaExtraEditor(editor, enemy)) return;
        saveScopedState(scope, state);
        editingEnemy = null;
        showToast('仇敌修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.enemyScope;
        const index = Number(button.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy || !confirm(`删除仇敌"${enemy.name}"？`)) return;
        state.enemies.splice(index, 1);
        saveScopedState(scope, state);
        showToast('仇敌已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.enemyScope;
        const index = Number(button.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy) return;
        const copy = JSON.parse(JSON.stringify(enemy));
        delete copy.id;
        state.enemies.splice(index + 1, 0, copy);
        saveScopedState(scope, state);
        showToast('仇敌已复制');
        refresh();
      };
    });

    // ===== 影响链编辑器事件 =====
    document.querySelectorAll('.we-influence-edit').forEach(button => {
      button.onclick = () => {
        editingInfluence = { scope: button.dataset.influenceScope, index: Number(button.dataset.influenceIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-editor-close').forEach(button => {
      button.onclick = () => { editingInfluence = null; refresh(); };
    });
    document.querySelectorAll('.we-influence-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.influenceScope;
        const index = Number(editor.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf) return;
        const trigger = editor.querySelector('.we-influence-edit-trigger').value.trim();
        const impact = editor.querySelector('.we-influence-edit-impact').value.trim();
        if (!trigger || !impact) { showToast('触发源和直接影响不能为空', true); return; }
        inf.trigger = trigger;
        inf.impact = impact;
        inf.fallout = editor.querySelector('.we-influence-edit-fallout').value.trim();
        if (!applySchemaExtraEditor(editor, inf)) return;
        saveScopedState(scope, scopedState);
        editingInfluence = null;
        showToast('影响链修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.influenceScope;
        const index = Number(button.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf || !confirm(`删除影响链"${inf.trigger}"？`)) return;
        scopedState.influenceChain.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('影响链已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.influenceScope;
        const index = Number(button.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf) return;
        const copy = JSON.parse(JSON.stringify(inf));
        copy._createdRound = Number(scopedState.round) || 0;
        scopedState.influenceChain.push(copy);
        saveScopedState(scope, scopedState);
        showToast('影响链已复制');
        refresh();
      };
    });

    // ===== 经济模块编辑器事件 =====
    document.querySelectorAll('.we-economy-edit').forEach(button => {
      button.onclick = () => { editingEconomy = { scope: button.dataset.economyScope }; refresh(); };
    });
    document.querySelectorAll('.we-economy-editor-close').forEach(button => {
      button.onclick = () => { editingEconomy = null; refresh(); };
    });
    document.querySelectorAll('.we-economy-sig-add').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-economy-editor');
        const scope = button.dataset.economyScope;
        const state = loadScopedState(scope);
        state.economy = state.economy || {};
        const signals = readEconomySignals(editor, true);
        signals.push({ summary: '', scope: '区域' });
        state.economy.signals = signals;
        const climateSel = editor.querySelector('.we-economy-edit-climate');
        if (climateSel) state.economy.climate = climateSel.value;
        applySchemaExtraEditor(editor, state.economy);
        saveScopedState(scope, state);
        refresh();
      };
    });
    document.querySelectorAll('.we-econ-sig-del').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-economy-editor');
        const scope = button.dataset.economyScope;
        const idx = Number(button.dataset.sigIdx);
        const state = loadScopedState(scope);
        state.economy = state.economy || {};
        const signals = readEconomySignals(editor, true);
        if (idx >= 0 && idx < signals.length) signals.splice(idx, 1);
        state.economy.signals = signals;
        const climateSel = editor.querySelector('.we-economy-edit-climate');
        if (climateSel) state.economy.climate = climateSel.value;
        applySchemaExtraEditor(editor, state.economy);
        saveScopedState(scope, state);
        refresh();
      };
    });
    document.querySelectorAll('.we-economy-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-economy-editor');
        const scope = editor.dataset.economyScope;
        const state = loadScopedState(scope);
        state.economy = state.economy || {};
        state.economy.climate = editor.querySelector('.we-economy-edit-climate').value;
        state.economy.signals = readEconomySignals(editor, false);
        if (!applySchemaExtraEditor(editor, state.economy)) return;
        saveScopedState(scope, state);
        editingEconomy = null;
        showToast('经济模块已保存');
        refresh();
      };
    });

    // ===== 区域事件编辑器事件 =====
    document.querySelectorAll('.we-ri-edit').forEach(button => {
      button.onclick = () => {
        editingRI = { active: true, scope: button.dataset.riScope };
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-editor-close').forEach(button => {
      button.onclick = () => { editingRI = null; refresh(); };
    });
    document.querySelectorAll('.we-ri-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) {
          state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', duration: 0, cooldown: 0, _retry: false, _retryType: '' };
        }
        const ri = state.regionalIncident;
        ri.active = editor.querySelector('.we-ri-edit-active').value === 'true';
        ri.title = editor.querySelector('.we-ri-edit-title').value.trim();
        ri.type = editor.querySelector('.we-ri-edit-type').value;
        ri.scope = editor.querySelector('.we-ri-edit-scope').value.trim();
        ri.duration = Math.max(0, Number(editor.querySelector('.we-ri-edit-duration').value) || 0);
        ri.cooldown = Math.max(0, Number(editor.querySelector('.we-ri-edit-cooldown').value) || 0);
        ri.impact = editor.querySelector('.we-ri-edit-impact').value.trim();
        if (!applySchemaExtraEditor(editor, ri)) return;
        saveScopedState(scope, state);
        editingRI = null;
        showToast('区域事件修改已保存');
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) return;
        if (!confirm('清除区域事件？')) return;
        state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', cooldown: state.regionalIncident.cooldown || 0, _retry: false, _retryType: '' };
        saveScopedState(scope, state);
        showToast('区域事件已清除');
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) return;
        const copy = JSON.parse(JSON.stringify(state.regionalIncident));
        copy._retry = false;
        copy._retryType = '';
        copy.cooldown = 0;
        state.regionalIncident = copy;
        saveScopedState(scope, state);
        showToast('区域事件已复制（冷却已重置）');
        refresh();
      };
    });

    // ===== 秘密（隐秘行为/资产）统一编辑器事件 =====
    const SECRET_ARR = { action: 'secretActions', asset: 'secretAssets' };

    document.querySelectorAll('.we-secret-edit').forEach(button => {
      button.onclick = () => {
        const list = button.dataset.secretList;
        editingSecret = { scope: button.dataset.secretScope, list, index: Number(button.dataset.secretIndex), view: list };
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-editor-close').forEach(button => {
      button.onclick = () => { editingSecret = null; refresh(); };
    });
    // 类型下拉：仅切换显示的表单(view)，不动数据、不保存
    document.querySelectorAll('.we-secret-type').forEach(select => {
      select.onchange = () => {
        if (editingSecret) { editingSecret.view = select.value; refresh(); }
      };
    });
    document.querySelectorAll('.we-secret-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-secret-editor');
        const scope = editor.dataset.secretScope;
        const list = editor.dataset.secretList;            // 条目当前所在桶
        const index = Number(editor.dataset.secretIndex);
        const view = editor.dataset.secretView;            // 目标类型（可能与 list 不同）
        const state = loadScopedState(scope);
        state.blackbox = state.blackbox || {};
        const srcArr = state.blackbox[SECRET_ARR[list]];
        if (!srcArr || srcArr[index] === undefined) return;

        // 按 view 读取表单，组装目标条目
        let item, okMsg;
        if (view === 'action') {
          const action = editor.querySelector('.we-secret-f-action').value.trim();
          if (!action) { showToast('行为描述不能为空', true); return; }
          item = { action, witnesses: editor.querySelector('.we-secret-f-witnesses').value.trim() || '无' };
        } else {
          const name = editor.querySelector('.we-secret-f-name').value.trim();
          if (!name) { showToast('资产名称不能为空', true); return; }
          item = {
            name,
            exposure: Math.min(100, Math.max(0, Number(editor.querySelector('.we-secret-f-exposure').value) || 0)),
            status: editor.querySelector('.we-secret-f-status').value
          };
        }
        if (!applySchemaExtraEditor(editor, item)) return;

        if (view === list) {
          srcArr[index] = item;                            // 原地更新
          okMsg = view === 'action' ? '隐秘行为已保存' : '隐秘资产已保存';
        } else {
          srcArr.splice(index, 1);                         // 从旧桶移除
          const arrKey = SECRET_ARR[view];
          if (!Array.isArray(state.blackbox[arrKey])) state.blackbox[arrKey] = [];
          state.blackbox[arrKey].push(item);               // 落入新桶 = 真正的类型转换
          okMsg = view === 'action' ? '已转为隐秘行为' : '已转为隐秘资产';
        }
        saveScopedState(scope, state);
        editingSecret = null;
        showToast(okMsg);
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-del').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.secretScope;
        const list = button.dataset.secretList;
        const index = Number(button.dataset.secretIndex);
        const state = loadScopedState(scope);
        const arr = state.blackbox?.[SECRET_ARR[list]];
        if (!arr || arr[index] === undefined) return;
        if (!confirm(list === 'action' ? '删除隐秘行为？' : '删除隐秘资产？')) return;
        arr.splice(index, 1);
        saveScopedState(scope, state);
        showToast('已删除');
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.secretScope;
        const list = button.dataset.secretList;
        const index = Number(button.dataset.secretIndex);
        const state = loadScopedState(scope);
        const arr = state.blackbox?.[SECRET_ARR[list]];
        if (!arr || arr[index] === undefined) return;
        arr.splice(index + 1, 0, JSON.parse(JSON.stringify(arr[index])));  // 就近插入
        saveScopedState(scope, state);
        showToast('已复制');
        refresh();
      };
    });

    // ===== [移植 v2.3.20] 世界摘要编辑器事件（仅编辑，不提供复制或删除） =====
    document.querySelectorAll('.we-digest-edit').forEach(button => {
      button.onclick = () => {
        editingDigest = { scope: button.dataset.digestScope || 'state' };
        refresh();
      };
    });
    document.querySelectorAll('.we-digest-editor-close').forEach(button => {
      button.onclick = () => { editingDigest = null; refresh(); };
    });
    document.querySelectorAll('.we-digest-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-digest-editor');
        if (!editor) return;
        const scope = editor.dataset.digestScope || 'state';
        const scopedState = loadScopedState(scope);
        const value = editor.querySelector('.we-digest-edit-text')?.value.trim() || '';
        scopedState.worldDigest = value;
        saveScopedState(scope, scopedState);
        editingDigest = null;
        showToast('世界摘要已保存');
        refresh();
      };
    });

    // ===== 导航事件 =====
    const backBtn = document.getElementById('we-btn-back');
    if (backBtn) backBtn.onclick = () => { _currentView = 'home'; refresh(); };

    const settingsOpenBtn = document.getElementById('we-btn-settings-open');
    if (settingsOpenBtn) settingsOpenBtn.onclick = () => { _currentView = 'settings'; refresh(); };

    document.querySelectorAll('.we-nav-row[data-view]').forEach(row => {
      row.onclick = () => {
        if (_selectedNavView === row.dataset.view) {
          // 二次点击：进入分页
          _selectedNavView = null;
          _currentView = row.dataset.view;
          refresh();
        } else {
          // 首次点击：选中该行
          _selectedNavView = row.dataset.view;
          refresh();
        }
      };
    });

    // 点击导航列表以外的地方取消选中
    const panelBody = panelBodyElement;
    if (panelBody) {
      panelBody.onclick = (e) => {
        if (_currentView === 'home' && _selectedNavView && !e.target.closest('.we-nav-row')) {
          _selectedNavView = null;
          refresh();
        }
      };
    }

    // ===== 区块折叠/展开事件 =====
    document.querySelectorAll('.we-section-toggle').forEach(toggle => {
      toggle.onclick = () => {
        const sectionId = toggle.dataset.section;
        sectionCollapsed[sectionId] = !sectionCollapsed[sectionId];
        const body = document.getElementById('we-section-body-' + sectionId);
        const arrow = document.getElementById('we-section-arrow-' + sectionId);
        if (body) body.style.display = sectionCollapsed[sectionId] ? 'none' : '';
        if (arrow) arrow.textContent = sectionCollapsed[sectionId] ? '▶' : '▼';
      };
    });

    document.querySelectorAll('.we-settings-tab').forEach(tab => {
      tab.onclick = () => {
        const key = tab.dataset.tab || 'common';
        _settingsTab = key;
        document.querySelectorAll('.we-settings-tab').forEach(item =>
          item.classList.toggle('we-settings-tab--active', item.dataset.tab === key));
        document.querySelectorAll('.we-settings-panel').forEach(panel =>
          panel.style.display = panel.dataset.tab === key ? '' : 'none');
      };
    });
    const refreshBtn = document.getElementById('we-btn-refresh');
    if (refreshBtn) refreshBtn.onclick = () => refresh();

    function renderFilterStatus(result, prefix) {
      const el = document.getElementById('we-filter-status');
      if (!el) return;
      const pfx = prefix || '';
      if (!result || (!result.ok && !result.bad.length)) { el.textContent = pfx + '（未填写正则）'; return; }
      if (!result.bad.length) { el.textContent = pfx + result.ok + ' 条全部生效'; return; }
      let text = pfx + result.ok + ' 条生效 / ' + result.bad.length + ' 条失败：';
      result.bad.forEach(function(item) {
        text += '\n行 ' + item.line + '「' + item.raw + '」无效：' + item.reason;
      });
      el.textContent = text;
    }

    const SIMPLE_TAG_LINE = /^<([a-zA-Z_][\w-]*)>[\s\S]*?<\/\1>(?:\\n\?)?$/;
    const SCAN_TAG_RE = /<([a-zA-Z_][\w-]*)/g;
    let _filterTags = [];

    function parseTextareaTags(raw) {
      const tags = [];
      const advanced = [];
      String(raw || '').split('\n').forEach(function(line) {
        const match = line.match(SIMPLE_TAG_LINE);
        if (match) {
          if (tags.indexOf(match[1]) < 0) tags.push(match[1]);
        } else if (line.trim()) {
          advanced.push(line);
        }
      });
      return { tags, advanced };
    }

    function writeTextareaFromTags(checkedTags, advancedLines) {
      const tagLines = checkedTags.map(function(tag) { return '<' + tag + '>[\\s\\S]*?</' + tag + '>\\n?'; });
      const ta = document.getElementById('we-filter-regex');
      if (ta) ta.value = tagLines.concat(advancedLines || []).join('\n');
    }

    function renderFilterTags() {
      const box = document.getElementById('we-filter-tags');
      if (!box) return;
      box.innerHTML = '';
      _filterTags.forEach(function(tagItem) {
        const chip = document.createElement('label');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border:1px solid var(--we-border,#3a3a3a);border-radius:3px;font-size:12px;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!tagItem.checked;
        cb.onchange = function() { tagItem.checked = cb.checked; syncTextareaFromTags(); };
        const name = document.createElement('span');
        name.textContent = tagItem.name;
        const del = document.createElement('span');
        del.textContent = 'x';
        del.style.cssText = 'color:var(--we-text3);cursor:pointer;margin-left:2px;';
        del.onclick = function(e) {
          e.preventDefault();
          _filterTags = _filterTags.filter(function(item) { return item.name !== tagItem.name; });
          renderFilterTags();
          syncTextareaFromTags();
        };
        chip.appendChild(cb);
        chip.appendChild(name);
        chip.appendChild(del);
        box.appendChild(chip);
      });
    }

    function syncTextareaFromTags() {
      const ta = document.getElementById('we-filter-regex');
      const parsed = parseTextareaTags(ta ? ta.value : '');
      const checked = _filterTags.filter(function(item) { return item.checked; }).map(function(item) { return item.name; });
      writeTextareaFromTags(checked, parsed.advanced);
    }

    let _filterTagSyncTimer = null;
    function syncTagsFromTextarea() {
      const ta = document.getElementById('we-filter-regex');
      if (!ta) return;
      const parsed = parseTextareaTags(ta.value);
      const tagSet = new Set(parsed.tags);
      _filterTags.forEach(function(item) { item.checked = tagSet.has(item.name); });
      parsed.tags.forEach(function(name) {
        if (!_filterTags.some(function(item) { return item.name === name; })) _filterTags.push({ name, checked: true });
      });
      renderFilterTags();
    }

    function scanTagsFromLastAI() {
      let text = '';
      try {
        const ctx = SillyTavern.getContext();
        const chat = (ctx && ctx.chat) || [];
        for (let i = chat.length - 1; i >= 0; i--) {
          const message = chat[i];
          if (message && !message.is_user && String(message.mes || '').trim()) { text = String(message.mes); break; }
        }
      } catch (e) {}
      if (!text) { showToast('未找到 AI 回复', true); return; }
      const found = [];
      let match;
      SCAN_TAG_RE.lastIndex = 0;
      while ((match = SCAN_TAG_RE.exec(text)) !== null) {
        const name = match[1];
        if (name && found.indexOf(name) < 0) found.push(name);
      }
      if (!found.length) { showToast('最新 AI 回复里没发现标签', true); return; }
      found.forEach(function(name) {
        if (!_filterTags.some(function(item) { return item.name === name; })) _filterTags.push({ name, checked: true });
      });
      renderFilterTags();
      syncTextareaFromTags();
      showToast('扫描到 ' + found.length + ' 个标签');
    }

    const scanFilterBtn = document.getElementById('we-btn-filter-scan');
    if (scanFilterBtn) scanFilterBtn.onclick = scanTagsFromLastAI;

    const addFilterBtn = document.getElementById('we-btn-filter-add');
    const addFilterInput = document.getElementById('we-filter-add-input');
    function addFilterTag() {
      const value = (addFilterInput && addFilterInput.value || '').trim();
      if (!value) return;
      if (!/^[a-zA-Z_][\w-]*$/.test(value)) { showToast('标签名无效：只允许字母、数字、下划线、连字符，且不能以数字开头', true); return; }
      if (!_filterTags.some(function(item) { return item.name === value; })) _filterTags.push({ name: value, checked: true });
      if (addFilterInput) addFilterInput.value = '';
      renderFilterTags();
      syncTextareaFromTags();
    }
    if (addFilterBtn) addFilterBtn.onclick = addFilterTag;
    if (addFilterInput) addFilterInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addFilterTag(); } });

    const filterTextarea = document.getElementById('we-filter-regex');
    if (filterTextarea) {
      filterTextarea.addEventListener('input', function() {
        clearTimeout(_filterTagSyncTimer);
        _filterTagSyncTimer = setTimeout(syncTagsFromTextarea, 300);
      });
      syncTagsFromTextarea();
    }

    const testFilterBtn = document.getElementById('we-btn-filter-test');
    if (testFilterBtn) {
      testFilterBtn.onclick = function() {
        const raw = (document.getElementById('we-filter-regex') || {}).value || '';
        if (!raw.trim()) { showToast('未填写正则', true); renderFilterStatus(null); return; }
        const coreMod = window.WORLD_ENGINE_CORE;
        if (!coreMod || typeof coreMod.validateFilterRegex !== 'function') { showToast('正则校验不可用', true); return; }
        const validation = coreMod.validateFilterRegex(raw);
        if (validation.bad.length) { renderFilterStatus(validation, '测试中止：'); showToast('有 ' + validation.bad.length + ' 条正则无效', true); return; }
        let sample = '';
        try {
          const ctx = SillyTavern.getContext();
          const chat = (ctx && ctx.chat) || [];
          for (let i = chat.length - 1; i >= 0; i--) {
            const text = chat[i] && String(chat[i].mes || '').trim();
            if (text) { sample = String(chat[i].mes); break; }
          }
        } catch (e) {}
        if (!sample) { showToast('当前聊天没有可测试文本', true); return; }
        let removed = 0;
        let work = sample;
        validation.entries.forEach(function(entry) {
          try {
            const re = new RegExp(entry.pattern, entry.flags);
            let m;
            while ((m = re.exec(work)) !== null) { removed += 1; if (m.index === re.lastIndex) re.lastIndex += 1; }
            work = work.replace(new RegExp(entry.pattern, entry.flags), '');
          } catch (e) {}
        });
        const before = sample.slice(0, 60) + (sample.length > 60 ? '...' : '');
        const after = work.slice(0, 60) + (work.length > 60 ? '...' : '');
        const el = document.getElementById('we-filter-status');
        if (el) el.textContent = '已删除 ' + removed + ' 处。\n前: ' + before + '\n后: ' + after;
        showToast('已删除 ' + removed + ' 处');
      };
    }
    const saveBtn = document.getElementById('we-save-settings');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const _modeRaw = document.getElementById('we-evolve-mode')?.value;
        const gv = id => document.getElementById(id)?.value;
        const ns = {
          ...(window.WORLD_ENGINE_API ? window.WORLD_ENGINE_API.getSettings(true) : {}),
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          apiProfileActiveId: findMatchingApiProfile(
            document.getElementById('we-api-url')?.value || '',
            document.getElementById('we-api-key')?.value || '',
            window.WORLD_ENGINE_API?.getSettings(true)?.apiProfileActiveId || ''
          ),
          model: document.getElementById('we-model')?.value || 'gpt-3.5-turbo',
          useStProxy: document.getElementById('we-use-st-proxy')?.checked !== false,
          temperature: (() => { const t = parseFloat(gv('we-temperature')); return Number.isFinite(t) ? Math.max(0, t) : 0.7; })(),
          maxTokens: Math.max(1, parseInt(gv('we-max-tokens')) || 8000),
          apiAutoRetries: Math.max(0, parseInt(gv('we-api-auto-retries')) || 0),
          apiTimeoutMs: (() => { const s = parseFloat(gv('we-api-timeout-sec')); return Number.isFinite(s) ? Math.max(0, Math.round(s * 1000)) : 120000; })(),
          injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
          injectMaxChars: Math.max(0, parseInt(gv('we-inject-max-chars')) || 0),
          injectAllLevels: document.getElementById('we-inject-all-levels')?.checked === true,
          evolveMode: (_modeRaw === 'manual' || _modeRaw === 'time') ? _modeRaw : 'auto',
          evolveEveryX: Math.max(1, parseInt(document.getElementById('we-evolve-everyx')?.value) || 1),
          evolveReadRounds: Math.max(1, parseInt(document.getElementById('we-evolve-readrounds')?.value) || 1),
          manualReadRounds: Math.max(1, parseInt(document.getElementById('we-manual-readrounds')?.value) || 1),
          evolveFilterRegex: gv('we-filter-regex') || '',
          worldbookTrigger: document.getElementById('we-worldbook-trigger')?.checked === true,
          displayMode: document.getElementById('we-display-mode')?.value === 'expand' ? 'expand' : 'mask',
          showFloatingBall: document.getElementById('we-show-ball')?.checked !== false,
          // 按时间模式
          evolveTimeFront: Math.max(0, parseInt(gv('we-time-front')) || 0),
          evolveTimeBack: Math.max(0, parseInt(gv('we-time-back')) || 0),
          evolveTimeRe1: gv('we-time-re1') || '', evolveTimeRe2: gv('we-time-re2') || '',
          evolveTimeRe3: gv('we-time-re3') || '', evolveTimeRe4: gv('we-time-re4') || '',
          evolveTimeRe5: gv('we-time-re5') || '', evolveTimeRe6: gv('we-time-re6') || '',
          evolveTimeMul1: parseFloat(gv('we-time-mul1')) || 0,
          evolveTimeMul2: parseFloat(gv('we-time-mul2')) || 0,
          evolveTimeMul3: parseFloat(gv('we-time-mul3')) || 0,
          evolveTimeThreshold: Math.max(1, parseInt(gv('we-time-threshold')) || 1),
          evolveTimeMaxRounds: Math.max(1, parseInt(gv('we-time-maxrounds')) || 10),
          // [pigment 3.6] 本地机制：每组可跟随当前预设，或使用手动值
          localRegionalIncidentUsePreset: document.getElementById('we-local-ri-use-preset')?.checked !== false,
          localDistantEventUsePreset: document.getElementById('we-local-distant-use-preset')?.checked !== false,
          localNearEventUsePreset: document.getElementById('we-local-near-use-preset')?.checked !== false,
          localEventDiceUsePreset: document.getElementById('we-local-dice-use-preset')?.checked !== false,
          localWindDecayUsePreset: document.getElementById('we-local-wind-use-preset')?.checked !== false,
          localRetentionUsePreset: document.getElementById('we-local-retention-use-preset')?.checked !== false,
          localRegionalIncidentChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-ri-chance')) || 0)),
          localRegionalIncidentDuration: Math.max(1, parseInt(gv('we-local-ri-duration')) || 5),
          localRegionalIncidentCooldown: Math.max(0, parseInt(gv('we-local-ri-cooldown')) || 0),
          localDistantEventLedgerThreshold: Math.max(1, parseInt(gv('we-local-distant-threshold')) || 10),
          localDistantEventChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-distant-chance')) || 0)),
          localDistantEventCooldown: Math.max(0, parseInt(gv('we-local-distant-cooldown')) || 0),
          localDistantEventEventPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-distant-event-percent')) || 0)),
          localNearEventChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-near-chance')) || 0)),
          localNearEventCooldown: Math.max(0, parseInt(gv('we-local-near-cooldown')) || 0),
          localNearEventEventPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-near-event-percent')) || 0)),
          localEventDiceModifier: Math.min(100, Math.max(-100, parseInt(gv('we-local-dice-mod')) || 0)),
          localEventSetbackRatioPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-setback-ratio')) || 0)),
          localProgressFailBase: Math.max(0, parseInt(gv('we-local-progress-fail-base')) || 0),
          localConflictFailBase: Math.max(1, parseInt(gv('we-local-conflict-fail-base')) || 6),
          localTerminalBaseKeepRounds: Math.max(0, parseInt(gv('we-local-terminal-base')) || 0),
          localTerminalLevelKeepRounds: Math.max(0, parseInt(gv('we-local-terminal-level')) || 0),
          localInfluenceKeepRounds: Math.max(1, parseInt(gv('we-local-influence-keep')) || 8),
          localEnemyTerminalKeepRounds: Math.max(1, parseInt(gv('we-local-enemy-keep')) || 20),
          localLedgerKeepRounds: Math.max(1, parseInt(gv('we-local-ledger-keep')) || 20),
          localCapEvents: Math.max(1, parseInt(gv('we-local-cap-events')) || 16),
          localCapFactions: Math.max(1, parseInt(gv('we-local-cap-factions')) || 15),
          localCapWinds: Math.max(1, parseInt(gv('we-local-cap-winds')) || 12),
          localCapWorldTrends: Math.max(1, parseInt(gv('we-local-cap-trends')) || 4),
          localCapInfluence: Math.max(1, parseInt(gv('we-local-cap-influence')) || 12),
          localCapEnemies: Math.max(1, parseInt(gv('we-local-cap-enemies')) || 8),
          localCapEconomySignals: Math.max(1, parseInt(gv('we-local-cap-econ')) || 8),
          localCapBlackbox: Math.max(1, parseInt(gv('we-local-cap-blackbox')) || 12),
          localWindAnnouncementBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-announcement-base')) || 0)),
          localWindAnnouncementGrace: Math.max(0, parseInt(gv('we-local-wind-announcement-grace')) || 0),
          localWindAnnouncementLinear: Math.max(0, parseFloat(gv('we-local-wind-announcement-linear')) || 0),
          localWindAnnouncementQuadratic: Math.max(0, parseFloat(gv('we-local-wind-announcement-quadratic')) || 0),
          localWindReportBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-report-base')) || 0)),
          localWindReportGrace: Math.max(0, parseInt(gv('we-local-wind-report-grace')) || 0),
          localWindReportLinear: Math.max(0, parseFloat(gv('we-local-wind-report-linear')) || 0),
          localWindReportQuadratic: Math.max(0, parseFloat(gv('we-local-wind-report-quadratic')) || 0),
          localWindRumorBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-rumor-base')) || 0)),
          localWindRumorGrace: Math.max(0, parseInt(gv('we-local-wind-rumor-grace')) || 0),
          localWindRumorLinear: Math.max(0, parseFloat(gv('we-local-wind-rumor-linear')) || 0),
          localWindRumorQuadratic: Math.max(0, parseFloat(gv('we-local-wind-rumor-quadratic')) || 0),
          localWindSentimentBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-sentiment-base')) || 0)),
          localWindSentimentGrace: Math.max(0, parseInt(gv('we-local-wind-sentiment-grace')) || 0),
          localWindSentimentLinear: Math.max(0, parseFloat(gv('we-local-wind-sentiment-linear')) || 0),
          localWindSentimentQuadratic: Math.max(0, parseFloat(gv('we-local-wind-sentiment-quadratic')) || 0)
        };
        // a 不得超过 X（每次推演的轮数）
        ns.evolveReadRounds = Math.min(ns.evolveReadRounds, ns.evolveEveryX);
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify(ns));
        if (window.WORLD_ENGINE_API) window.WORLD_ENGINE_API.getSettings(true);
        buildInputButton();   // 悬浮球开关即时生效（关→移除球，开→重建；标题栏推进钮随之切换）

        let filterBadCount = 0;
        try {
          const coreMod = window.WORLD_ENGINE_CORE;
          if (coreMod && typeof coreMod.validateFilterRegex === 'function') {
            const validation = coreMod.validateFilterRegex(ns.evolveFilterRegex);
            renderFilterStatus(validation, '已保存：');
            filterBadCount = validation.bad.length;
          }
        } catch (e) {}

        // 按时间模式：三个时间框「有值才写」，本轮对话时间写入后触发判断
        if (ns.evolveMode === 'time') {
          const stIn = gv('we-time-state');
          if (stIn != null && stIn !== '') {
            const s2 = core.loadState();
            if (s2) { s2.time = Number(stIn); core.saveState(s2); }
          }
          const cpIn = gv('we-time-checkpoint');
          if (cpIn != null && cpIn !== '') {
            const cp2 = core.restoreCheckpoint();
            if (cp2) { cp2.time = Number(cpIn); core.saveCheckpoint(cp2); }
          }
          const curIn = gv('we-time-current');
          if (curIn != null && curIn !== '') {
            window.WORLD_ENGINE?.manualTimeEvolve?.(Number(curIn));
          }
        }

        window.WORLD_ENGINE?.applyInjection?.();
        showToast(filterBadCount > 0 ? ('已保存，但有 ' + filterBadCount + ' 条正则无效') : '设置已保存', filterBadCount > 0);
      };
    }

    // 主题配色：即时应用 + 持久化，不 refresh（纯 CSS，避免清空正在编辑的设置表单）
    const themeSel = document.getElementById('we-theme-select');
    if (themeSel) themeSel.onchange = () => setTheme(themeSel.value);

    const addQrBtn = document.getElementById('we-add-qr');
    if (addQrBtn) addQrBtn.onclick = () => handleAddQuickReplies();

    // 推演模式切换：按轮显示 X/a，按时间显示时间组，手动显示手动读取轮数
    const evolveModeSel = document.getElementById('we-evolve-mode');
    if (evolveModeSel) {
      evolveModeSel.onchange = () => {
        const v = evolveModeSel.value;
        const roundShow = v === 'auto' ? '' : 'none';
        const manualShow = v === 'manual' ? '' : 'none';
        const timeShow = v === 'time' ? '' : 'none';
        const g1 = document.getElementById('we-evolve-everyx-group');
        if (g1) g1.style.display = roundShow;
        const g2 = document.getElementById('we-evolve-readrounds-group');
        if (g2) g2.style.display = roundShow;
        const g3 = document.getElementById('we-manual-readrounds-group');
        if (g3) g3.style.display = manualShow;
        const g4 = document.getElementById('we-evolve-time-group');
        if (g4) g4.style.display = timeShow;
      };
    }

    const worldbookList = document.getElementById('we-worldbook-list');
    if (worldbookList) {
      const worldbook = window.WORLD_ENGINE_WORLDBOOK;
      const summary = document.getElementById('we-worldbook-summary');
      const reloadBtn = document.getElementById('we-worldbook-reload');
      const selectAllBtn = document.getElementById('we-worldbook-select-all');
      const clearAllBtn = document.getElementById('we-worldbook-clear-all');
      const saveWorldbookBtn = document.getElementById('we-worldbook-save');

      function updateWorldbookSummary() {
        const checkboxes = [...worldbookList.querySelectorAll('.we-worldbook-entry-check')];
        const selected = checkboxes.filter(checkbox => checkbox.checked);
        const chars = selected.reduce((total, checkbox) => total + Number(checkbox.dataset.chars || 0), 0);
        if (summary) summary.textContent = `${selected.length}/${checkboxes.length} 条已选，约 ${chars} 字符`;
      }

      async function loadWorldbookEntries() {
        if (!worldbook) {
          worldbookList.innerHTML = '<div class="we-empty">世界书模块未加载</div>';
          return;
        }
        worldbookList.innerHTML = '<div class="we-empty">正在读取当前聊天世界书...</div>';
        if (reloadBtn) reloadBtn.disabled = true;
        try {
          const entries = await worldbook.loadCurrentEntries();
          const currentChatId = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
          // 用 hasSelection() 区分"从未保存"与"保存了空数组"，避免刷新后误触发自动全选
          const isFirstVisit = worldbook.hasSelection ? !worldbook.hasSelection() : false;
          const savedIds = worldbook.getSelectedIds();
          _wbCachedEntries = entries;
          _wbCachedChatId = currentChatId;
          // 首次进入该聊天（存储中无记录）则自动全选启用条目
          if (isFirstVisit && entries.length) {
            const allIds = entries.filter(e => !e.disabled).map(e => e.id);
            worldbook.saveSelectedIds(allIds);
            _wbCachedSelectedIds = new Set(allIds);
            showToast(`已自动全选 ${allIds.length} 条世界书条目`);
          } else {
            const enabledIds = new Set(entries.filter(e => !e.disabled).map(e => e.id));
            const validSavedIds = savedIds.filter(id => enabledIds.has(id));
            _wbCachedSelectedIds = new Set(validSavedIds);
            // 仅在有匹配条目时才回写，防止刷新后 entry.world 尚未加载导致 ID 全部不匹配、
            // 误将保存记录清空为 []（清空后下次开面板会误触发自动全选）
            if (validSavedIds.length > 0 && validSavedIds.length !== savedIds.length) {
              worldbook.saveSelectedIds(validSavedIds);
            }
          }
          renderWorldbookList();
        } catch(error) {
          worldbookList.innerHTML = `<div class="we-empty">读取失败：${u(error.message)}</div>`;
          if (summary) summary.textContent = '读取失败';
          _wbCachedEntries = null;
          _wbCachedSelectedIds = null;
          _wbCachedChatId = null;
        } finally {
          if (reloadBtn) reloadBtn.disabled = false;
        }
      }

      function renderWorldbookList() {
        const entries = _wbCachedEntries;
        const selectedIds = _wbCachedSelectedIds || new Set();
        const overrides = worldbook && typeof worldbook.getOverrides === 'function' ? worldbook.getOverrides() : {};
        if (!entries || !entries.length) {
          worldbookList.innerHTML = '<div class="we-empty">当前聊天未关联可读取的世界书条目</div>';
          if (summary) summary.textContent = '0 条可选';
          return;
        }
        const groups = new Map();
        for (const entry of entries) {
          if (!groups.has(entry.world)) groups.set(entry.world, []);
          groups.get(entry.world).push(entry);
        }
        worldbookList.innerHTML = [...groups.entries()].map(([world, worldEntries]) => {
          const expanded = expandedWorldbookGroups.has(world);
          return `
          <div class="we-worldbook-group" data-worldbook-group="${u(world)}">
            <div class="we-worldbook-group-header">
              <span>${expanded ? '▼' : '▶'}</span>
              <div class="we-worldbook-group-title">
                <div>${u(world)} <span>${worldEntries.length}条</span></div>
              </div>
              <div class="we-worldbook-group-actions">
                <button type="button" data-worldbook-group-action="select">全选</button>
                <button type="button" data-worldbook-group-action="clear">取消全选</button>
              </div>
            </div>
            <div class="we-worldbook-group-body" style="${expanded ? '' : 'display:none;'}">
            ${worldEntries.map(entry => `
              <label class="we-worldbook-entry${entry.disabled ? ' is-disabled' : ''}">
                <input class="we-worldbook-entry-check" type="checkbox" value="${u(entry.id)}" data-chars="${entry.content.length}" ${selectedIds.has(entry.id) && !entry.disabled ? 'checked' : ''} ${entry.disabled ? 'disabled' : ''}>
                <span>
                  <strong>${u(entry.title)}</strong>
                  <small>${entry.content.length} 字符${entry.disabled ? ' · 世界书内已停用' : ''}${entry.constant ? ' · 常驻' : ''}${entry.keys && entry.keys.length ? ' · 关键词' : ''}</small>
                  <select class="we-worldbook-entry-mode" data-entry-id="${u(entry.id)}" ${entry.disabled ? 'disabled' : ''}>
                    <option value="auto" ${!overrides[entry.id] ? 'selected' : ''}>跟随</option>
                    <option value="const" ${overrides[entry.id] === 'const' ? 'selected' : ''}>强制常驻</option>
                    <option value="key" ${overrides[entry.id] === 'key' ? 'selected' : ''}>强制关键词</option>
                    <option value="off" ${overrides[entry.id] === 'off' ? 'selected' : ''}>关闭</option>
                  </select>
                </span>
              </label>`).join('')}
            </div>
          </div>`;
        }).join('');
          worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
            checkbox.onchange = () => {
              _wbCachedSelectedIds = new Set([...worldbookList.querySelectorAll('.we-worldbook-entry-check:checked')].map(cb => cb.value));
              updateWorldbookSummary();
            };
          });
          worldbookList.querySelectorAll('.we-worldbook-group-header').forEach(header => {
            header.onclick = () => {
              const body = header.nextElementSibling;
              const arrow = header.querySelector('span');
              if (body) {
                const isHidden = body.style.display === 'none';
                body.style.display = isHidden ? '' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
                const world = header.closest('.we-worldbook-group')?.dataset.worldbookGroup;
                if (world) {
                  if (isHidden) expandedWorldbookGroups.add(world);
                  else expandedWorldbookGroups.delete(world);
                }
              }
            };
          });
          worldbookList.querySelectorAll('[data-worldbook-group-action]').forEach(button => {
            button.onclick = (e) => {
              e.stopPropagation();
              const group = button.closest('.we-worldbook-group');
              if (!group) return;
              const checked = button.dataset.worldbookGroupAction === 'select';
              group.querySelectorAll('.we-worldbook-entry-check:not(:disabled)').forEach(checkbox => {
                checkbox.checked = checked;
                checkbox.onchange();
              });
            };
          });
          updateWorldbookSummary();
          // 恢复滚动位置（refresh() 重建 DOM 后补回）
          if (_wbScrollTop) worldbookList.scrollTop = _wbScrollTop;
      }

      if (reloadBtn) reloadBtn.onclick = () => { _wbCachedEntries = null; _wbCachedChatId = null; loadWorldbookEntries(); };
      if (selectAllBtn) selectAllBtn.onclick = () => {
        worldbookList.querySelectorAll('.we-worldbook-entry-check:not(:disabled)').forEach(checkbox => {
          checkbox.checked = true;
          checkbox.onchange();
        });
      };
      if (clearAllBtn) clearAllBtn.onclick = () => {
        worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
          checkbox.checked = false;
          checkbox.onchange();
        });
      };
      if (saveWorldbookBtn) saveWorldbookBtn.onclick = () => {
        const modes = {};
        worldbookList.querySelectorAll('.we-worldbook-entry-mode').forEach(select => {
          if (select.value && select.value !== 'auto') modes[select.dataset.entryId] = select.value;
        });
        if (worldbook.saveSelection) worldbook.saveSelection([..._wbCachedSelectedIds], modes);
        else worldbook.saveSelectedIds([..._wbCachedSelectedIds]);
        showToast(`已保存 ${_wbCachedSelectedIds.size} 条后台世界书条目`);
        updateWorldbookSummary();
      };
      // refresh() 重建 DOM 时，如果 chatId 未变且已有缓存，直接渲染，避免勾选丢失
      const currentChatIdNow = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
      if (_wbCachedEntries && _wbCachedChatId === currentChatIdNow) {
        renderWorldbookList();
      } else {
        loadWorldbookEntries();
      }
    }

    const resetBtn = document.getElementById('we-reset-world');
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (confirm('重置当前聊天所有世界状态和记忆？不可恢复！')) {
          core.clearState();
          core.clearCheckpoint();
          core.saveFingerprint(String(core.getChatLayer()));
          showToast('世界已重置');
          refresh();
        }
      };
    }

    const settingsToggle = document.querySelector('.we-settings-toggle');
    if (settingsToggle) {
      settingsToggle.onclick = () => {
        const body = document.getElementById('we-settings-body');
        const arrow = settingsToggle.querySelector('.we-toggle-arrow');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
        }
      };
    }

    const debugToggle = document.querySelector('.we-debug-toggle');
    if (debugToggle) {
      debugToggle.onclick = () => {
        const body = document.getElementById('we-debug-body');
        const arrow = debugToggle.querySelector('.we-toggle-arrow');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
          if (!isHidden) refresh();
        }
      };
    }

    const fetchBtn = document.getElementById('we-fetch-models');
    if (fetchBtn) {
      fetchBtn.onclick = async () => {
        const api = window.WORLD_ENGINE_API;
        if (!api) { showToast('API 模块未加载', true); return; }
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({
          ...(api.getSettings ? api.getSettings(true) : {}),
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || '',
          useStProxy: document.getElementById('we-use-st-proxy')?.checked !== false,
          temperature: (() => { const t = parseFloat(document.getElementById('we-temperature')?.value); return Number.isFinite(t) ? Math.max(0, t) : 0.7; })(),
          maxTokens: Math.max(1, parseInt(document.getElementById('we-max-tokens')?.value) || 8000),
          apiAutoRetries: Math.max(0, parseInt(document.getElementById('we-api-auto-retries')?.value) || 0),
          apiTimeoutMs: (() => { const s = parseFloat(document.getElementById('we-api-timeout-sec')?.value); return Number.isFinite(s) ? Math.max(0, Math.round(s * 1000)) : 120000; })(),
          injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
          injectMaxChars: Math.max(0, parseInt(document.getElementById('we-inject-max-chars')?.value) || 0),
          injectAllLevels: document.getElementById('we-inject-all-levels')?.checked === true
        }));
        if (api.getSettings) api.getSettings(true);
        fetchBtn.disabled = true;
        fetchBtn.textContent = '获取中...';
        try {
          const models = await api.fetchModelList();
          const select = document.getElementById('we-model-list');
          if (select) {
            select.innerHTML = '<option value="">-- 选择模型 --</option>' +
              models.map(m => '<option value="' + u(m) + '">' + u(m) + '</option>').join('');
            select.style.display = 'block';
            select.onchange = () => {
              const modelInput = document.getElementById('we-model');
              if (modelInput) modelInput.value = select.value;
            };
          }
          showToast('获取到 ' + models.length + ' 个模型');
        } catch(e) {
          showToast('' + e.message, true);
        }
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '获取列表';
      };
    }

    const exportBtn = document.getElementById('we-export-data');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const s = core.loadState();
        const checkpoint = core.restoreCheckpoint();
        const clean = core.getCleanExport(s);
        const cleanCheckpoint = checkpoint ? core.getCleanExport(checkpoint) : null;
        const exportData = {
          version: '1.2',
          exportedAt: new Date().toISOString(),
          chatId: core.getChatId(),
          state: clean,
          checkpoint: cleanCheckpoint,
          fingerprint: core.loadFingerprint()
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'world-engine-' + core.getChatId() + '-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('已导出');
      };
    }

    const importBtn = document.getElementById('we-import-data');
    const importFile = document.getElementById('we-import-file');
    if (importBtn && importFile) {
      importBtn.onclick = () => importFile.click();
      importFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            const isRegionalIncident = data && typeof data === 'object' &&
              Object.prototype.hasOwnProperty.call(data, 'active') &&
              Object.prototype.hasOwnProperty.call(data, 'title') &&
              Object.prototype.hasOwnProperty.call(data, 'impact');
            if (isRegionalIncident) {
              const state = core.loadState();
              state.regionalIncident = {
                active: data.active === true || data.active === 'true',
                title: String(data.title || ''),
                type: String(data.type || 'other'),
                scope: String(data.scope || ''),
                impact: String(data.impact || ''),
                cooldown: Math.max(0, Number(data.cooldown) || 0),
                _retry: data._retry === true || data._retry === 'true',
                _retryType: String(data._retryType || '')
              };
              core.saveState(state);
              showToast('区域事件导入成功');
              refresh();
              return;
            }
            if (data.version !== '1.2') { showToast('不支持的存档格式版本', true); return; }
            if (!data.state) { showToast('无效的导入文件', true); return; }
            const s = data.state;
            if (s.round === undefined) { showToast('缺少 round 字段', true); return; }
            core.importState(s);
            if (Object.prototype.hasOwnProperty.call(data, 'checkpoint')) {
              if (data.checkpoint) {
                data.checkpoint.chatLayer = core.getChatLayer();
                core.saveCheckpoint(data.checkpoint);
              }
              else core.clearCheckpoint();
            }
            core.saveFingerprint(String(core.getChatLayer()));
            showToast('导入成功！第' + s.round + '轮，' + (s.memories||[]).filter(m=>m.type==='ledger').length + '轮账本');
            refresh();
          } catch(err) {
            showToast('解析失败: ' + err.message, true);
          }
        };
        reader.readAsText(file);
        importFile.value = '';
      };
    }

    // ===== 附加提示词 导入 / 导出 / 清除 =====
    function getTonePrompt() {
      return (window.WORLD_ENGINE_API?.getSettings(true)?.tonePrompt || '');
    }
    function getTonePromptKey() {
      const chatId = window.WORLD_ENGINE_CORE?.getChatId?.() || 'default';
      return 'world_engine_tone_prompt_' + chatId;
    }
    function saveTonePrompt(text) {
      const store = window.WORLD_ENGINE_STORE;
      if (store && typeof store.setItem === 'function') {
        store.setItem(getTonePromptKey(), text || '');
      }
      const wapi = window.WORLD_ENGINE_API;
      if (wapi && wapi.getSettings) wapi.getSettings(true);
    }
    function updateToneStatus() {
      const el = document.getElementById('we-tone-status');
      if (!el) return;
      const t = getTonePrompt().trim();
      el.textContent = t ? `当前已设置附加提示词（${t.length} 字）` : '当前未设置附加提示词';
    }
    function fillToneText() {
      const ta = document.getElementById('we-tone-text');
      if (ta) ta.value = getTonePrompt();
    }
    const TONE_LIBRARY_KEY = 'world_engine_tone_library';
    function getToneLibrary() {
      try {
        const raw = window.WORLD_ENGINE_STORE?.getItem?.(TONE_LIBRARY_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch (e) { return []; }
    }
    function setToneLibrary(list) {
      try {
        window.WORLD_ENGINE_STORE?.setItem?.(TONE_LIBRARY_KEY, JSON.stringify(Array.isArray(list) ? list : []));
      } catch (e) {}
    }
    function refreshToneLibrarySelect(selectedId) {
      const sel = document.getElementById('we-tone-library');
      if (!sel) return;
      const list = getToneLibrary();
      const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (!list.length) {
        sel.innerHTML = '<option value="">（库为空）</option>';
        return;
      }
      sel.innerHTML = '<option value="">— 选择已保存的提示词 —</option>' + list.map((it) =>
        '<option value="' + escHtml(it.id) + '"' + (it.id === selectedId ? ' selected' : '') + '>' + escHtml(it.name || '(未命名)') + '</option>').join('');
    }
    updateToneStatus();
    fillToneText();

    const toneGeneratePreset = document.getElementById('we-tone-generate-preset');
    if (toneGeneratePreset) {
      toneGeneratePreset.onchange = () => {
        window.WORLD_ENGINE_STORE?.setItem?.('world_engine_tone_generate_with_preset', toneGeneratePreset.checked ? 'true' : 'false');
      };
    }

    const toneGenerateBtn = document.getElementById('we-tone-generate');
    if (toneGenerateBtn) {
      toneGenerateBtn.onclick = async () => {
        if (!window.WORLD_ENGINE_PRESETS || typeof window.WORLD_ENGINE_PRESETS.generateTonePrompt !== 'function') {
          showToast('\u9644\u52a0\u63d0\u793a\u8bcd\u751f\u6210\u529f\u80fd\u4e0d\u53ef\u7528', true);
          return;
        }
        const oldText = toneGenerateBtn.textContent;
        toneGenerateBtn.disabled = true;
        toneGenerateBtn.textContent = '\u751f\u6210\u4e2d...';
        const statusEl = document.getElementById('we-tone-status');
        if (statusEl) statusEl.textContent = '\u6b63\u5728\u6839\u636e\u8bbe\u5b9a\u751f\u6210\u9644\u52a0\u63d0\u793a\u8bcd...';
        try {
          const includeCharacterDescription = window.WORLD_ENGINE_STORE?.getItem?.('world_engine_generate_with_character_profile') !== 'false';
          const includePreset = document.getElementById('we-tone-generate-preset')?.checked !== false;
          const userGuidance = (document.getElementById('we-tone-guidance')?.value || '').trim();
          const text = await window.WORLD_ENGINE_PRESETS.generateTonePrompt({
            includeCharacterDescription: includeCharacterDescription,
            includeUserPersona: true,
            includePreset: includePreset,
            userGuidance: userGuidance
          });
          saveTonePrompt(text);
          fillToneText();
          updateToneStatus();
          showToast('\u9644\u52a0\u63d0\u793a\u8bcd\u5df2\u751f\u6210');
        } catch (e) {
          console.error('[WorldEngine] Generate tone prompt failed', e);
          updateToneStatus();
          showToast('\u751f\u6210\u5931\u8d25\uff1a' + (e && e.message ? e.message : e), true);
        } finally {
          toneGenerateBtn.disabled = false;
          toneGenerateBtn.textContent = oldText;
        }
      };
    }

    const toneImportBtn = document.getElementById('we-tone-import');
    const toneFile = document.getElementById('we-tone-file');
    if (toneImportBtn && toneFile) {
      toneImportBtn.onclick = () => toneFile.click();
      toneFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = String(ev.target.result || '').trim();
          if (!text) { showToast('文件为空', true); return; }
          saveTonePrompt(text);
          fillToneText();
          updateToneStatus();
          showToast('附加提示词已导入');
        };
        reader.readAsText(file);
        toneFile.value = '';
      };
    }

    const toneExportBtn = document.getElementById('we-tone-export');
    if (toneExportBtn) {
      toneExportBtn.onclick = () => {
        const t = getTonePrompt();
        if (!t.trim()) { showToast('当前无附加提示词可导出', true); return; }
        const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'world-engine-tone-' + Date.now() + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        showToast('附加提示词已导出');
      };
    }

    const toneClearBtn = document.getElementById('we-tone-clear');
    if (toneClearBtn) {
      toneClearBtn.onclick = () => {
        if (!getTonePrompt().trim()) { showToast('当前无附加提示词', true); return; }
        saveTonePrompt('');
        fillToneText();
        updateToneStatus();
        showToast('附加提示词已清除');
      };
    }

    const toneSaveTextBtn = document.getElementById('we-tone-save-text');
    if (toneSaveTextBtn) {
      toneSaveTextBtn.onclick = () => {
        const ta = document.getElementById('we-tone-text');
        const text = ta ? ta.value : '';
        saveTonePrompt(text);
        updateToneStatus();
        showToast('附加提示词已保存');
      };
    }

    const toneLibApplyBtn = document.getElementById('we-tone-lib-apply');
    if (toneLibApplyBtn) {
      toneLibApplyBtn.onclick = () => {
        const sel = document.getElementById('we-tone-library');
        const id = sel ? sel.value : '';
        if (!id) { showToast('请先在列表中选择一条提示词', true); return; }
        const item = getToneLibrary().find((it) => it.id === id);
        if (!item) { showToast('未找到该提示词，可能已被删除', true); return; }
        saveTonePrompt(item.content || '');
        fillToneText();
        updateToneStatus();
        showToast('已切换为「' + (item.name || '未命名') + '」');
      };
    }

    const toneLibSaveBtn = document.getElementById('we-tone-lib-save');
    if (toneLibSaveBtn) {
      toneLibSaveBtn.onclick = () => {
        const ta = document.getElementById('we-tone-text');
        const content = (ta ? ta.value : getTonePrompt()) || '';
        if (!content.trim()) { showToast('当前无内容可保存到库', true); return; }
        const name = (window.prompt('给这条附加提示词起个名字：', '') || '').trim();
        if (!name) { showToast('已取消保存', true); return; }
        const list = getToneLibrary();
        const existing = list.find((it) => it.name === name);
        if (existing) {
          existing.content = content;
          existing.ts = Date.now();
          setToneLibrary(list);
          refreshToneLibrarySelect(existing.id);
          showToast('已更新库中的「' + name + '」');
        } else {
          const id = 'tone_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          list.push({ id: id, name: name, content: content, ts: Date.now() });
          setToneLibrary(list);
          refreshToneLibrarySelect(id);
          showToast('已保存「' + name + '」到库');
        }
      };
    }

    const toneLibDeleteBtn = document.getElementById('we-tone-lib-delete');
    if (toneLibDeleteBtn) {
      toneLibDeleteBtn.onclick = () => {
        const sel = document.getElementById('we-tone-library');
        const id = sel ? sel.value : '';
        if (!id) { showToast('请先在列表中选择一条提示词', true); return; }
        const list = getToneLibrary();
        const idx = list.findIndex((it) => it.id === id);
        if (idx < 0) { showToast('未找到该提示词', true); return; }
        const name = list[idx].name || '未命名';
        list.splice(idx, 1);
        setToneLibrary(list);
        refreshToneLibrarySelect('');
        showToast('已从库删除「' + name + '」');
      };
    }

    // 调试区导出按钮
    function setupDownload(content, filename) {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    const exportDiagBtn = document.getElementById('we-export-diag');
    if (exportDiagBtn) {
      exportDiagBtn.onclick = () => {
        const diag = window.WORLD_ENGINE_DIAG;
        if (!diag || typeof diag.download !== 'function') { showToast('诊断模块未加载', true); return; }
        diag.download();
        showToast('诊断包已导出');
      };
    }

    const exportPromptBtn = document.getElementById('we-export-prompt');
    if (exportPromptBtn) {
      exportPromptBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.prompt) { showToast('无 Prompt 可导出', true); return; }
        setupDownload(dbg.prompt, 'prompt-' + Date.now() + '.txt');
        showToast('Prompt 已导出');
      };
    }

    const exportRawBtn = document.getElementById('we-export-raw-result');
    if (exportRawBtn) {
      exportRawBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.rawResult) { showToast('无 API 返回可导出', true); return; }
        setupDownload(dbg.rawResult, 'api-raw-' + Date.now() + '.txt');
        showToast('API 返回已导出');
      };
    }
  }

  function showPanel() {
    if (!panelElement) buildPanel();
    panelElement.style.display = 'flex';
    panelVisible = true;
    refresh();
  }

  function hidePanel() {
    if (!panelElement) return;
    panelElement.style.display = 'none';
    panelVisible = false;
  }

  function togglePanel() {
    if (panelVisible) hidePanel();
    else showPanel();
  }

  // ===== 主题配色 =====
  // 纯 CSS 变量主题：在 <html> 上设 data-we-theme，:root[data-we-theme] 覆盖 --we-* 变量，
  // 面板 / 悬浮球 / 顶部横幅一起变。持久化用 localStorage（同步、无 store 异步竞态）。
  const WE_THEME_KEY = 'we-theme';
  const WE_THEMES = [
    { id: 'default', name: '墨玉 · 默认' },
    { id: 'night',   name: '夜阑 · 近黑' },
    { id: 'deepsea', name: '深海 · 幽蓝' },
    { id: 'plum',    name: '夜合 · 暗紫' },
    { id: 'paper',   name: '云白 · 清爽' },
    { id: 'sakura',  name: '早樱 · 浅粉' }
  ];
  function getStoredTheme() {
    try { return localStorage.getItem(WE_THEME_KEY) || 'default'; } catch (e) { return 'default'; }
  }
  function applyTheme(id) {
    const valid = WE_THEMES.some(t => t.id === id) ? id : 'default';
    const root = document.documentElement;
    if (!root) return;
    if (valid === 'default') root.removeAttribute('data-we-theme');
    else root.setAttribute('data-we-theme', valid);
  }
  function setTheme(id) {
    const valid = WE_THEMES.some(t => t.id === id) ? id : 'default';
    applyTheme(valid);
    try { localStorage.setItem(WE_THEME_KEY, valid); } catch (e) {}
  }

  // 面板位置 + 大小持久化：拖动 / 缩放后都写回，重开面板还原（并按当前视口夹回可视区）。
  const WE_PANEL_RECT_KEY = 'world_engine_panel_rect';
  const WE_PANEL_MIN_W = 320;
  const WE_PANEL_MIN_H = 360;

  function savePanelRect(panel) {
    try {
      const r = panel.getBoundingClientRect();
      localStorage.setItem(WE_PANEL_RECT_KEY, JSON.stringify({
        left: Math.round(r.left), top: Math.round(r.top),
        width: Math.round(r.width), height: Math.round(r.height)
      }));
    } catch (e) {}
  }

  function applySavedPanelRect(panel) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(WE_PANEL_RECT_KEY) || 'null'); } catch (e) {}
    if (!saved) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (saved.width) {
      panel.style.width = Math.max(WE_PANEL_MIN_W, Math.min(saved.width, vw - 8)) + 'px';
      panel.style.maxWidth = 'none';
    }
    if (saved.height) {
      panel.style.height = Math.max(WE_PANEL_MIN_H, Math.min(saved.height, vh - 8)) + 'px';
      panel.style.maxHeight = 'none';
    }
    if (typeof saved.left === 'number' && typeof saved.top === 'number') {
      const w = saved.width || panel.getBoundingClientRect().width || 420;
      const left = Math.max(4, Math.min(saved.left, vw - w - 4));
      const top = Math.max(4, Math.min(saved.top, vh - 80));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
  }

  function initDrag(panel, handle) {
    let dragging = false, startX, startY, startLeft, startTop;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', function(e) {
      if (e.target.closest('.we-panel-close') || e.target.closest('.we-panel-header-actions')
        || e.target.closest('.we-header-evolve') || e.target.closest('.we-panel-corner-actions')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.style.left = startLeft + 'px'; panel.style.top = startTop + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = (startLeft + dx) + 'px';
      panel.style.top = (startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      panel.style.cursor = '';
      savePanelRect(panel);
    });
  }

  // 左下角把手缩放：面板锚在右上角，往左 / 下扩最顺手（宽内容有处可去）。
  // 用 pointer 事件一套代码兼容鼠标 + 触屏；右、上两边固定，只动左、下两边。
  function initResize(panel, handle) {
    if (!handle) return;
    let resizing = false, startX, startY, startW, startH, rightEdge, topEdge;

    handle.addEventListener('pointerdown', function(e) {
      resizing = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startW = rect.width; startH = rect.height;
      rightEdge = rect.left + rect.width;
      topEdge = rect.top;
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.maxWidth = 'none'; panel.style.maxHeight = 'none';
      document.body.style.userSelect = 'none';
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });

    handle.addEventListener('pointermove', function(e) {
      if (!resizing) return;
      const maxW = rightEdge - 4;
      const maxH = window.innerHeight - topEdge - 4;
      const newW = Math.max(WE_PANEL_MIN_W, Math.min(startW - (e.clientX - startX), maxW));
      const newH = Math.max(WE_PANEL_MIN_H, Math.min(startH + (e.clientY - startY), maxH));
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
      panel.style.left = (rightEdge - newW) + 'px';
    });

    function endResize(e) {
      if (!resizing) return;
      resizing = false;
      document.body.style.userSelect = '';
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      savePanelRect(panel);
    }
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
  }

  /** 获取当前对话层数 */
  function getChatLayer() {
    try {
      const ctx = SillyTavern.getContext();
      const chat = ctx?.chat || [];
      return Math.max(0, chat.length - 1);
    } catch(e) { return '?'; }
  }

  /** 设置面板状态条 */
  function setStatus(text, isError) {
    const statusBar = document.getElementById('we-status-bar');
    if (!statusBar) return;
    statusBar.textContent = text;
    statusBar.className = 'we-status-bar' + (isError ? ' error' : '');
  }

  // ========== 全局事件委托：声誉点击 + economy 编辑 ==========
  document.addEventListener('click', function(e) {
    // 声誉方块点击
    var dot = e.target.closest('.we-rep-dot');
    if (dot) {
      var dim = dot.getAttribute('data-dim');
      var level = dot.getAttribute('data-level');
      if (dim && level) {
        var scope = dot.getAttribute('data-rep-scope');
        var s = loadScopedState(scope);
        s.reputation = s.reputation || {};
        s.reputation[dim] = level;
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }
    // climate 按钮点击
    var cb = e.target.closest('.we-climate-btn');
    if (cb) {
      var c = cb.getAttribute('data-climate');
      if (c) {
        var scope = cb.getAttribute('data-climate-scope');
        var s = loadScopedState(scope);
        s.economy = s.economy || {};
        s.economy.climate = c;
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }
    // 通用列表翻页
    var arr = e.target.closest('.we-list-arrow');
    if (arr) {
      var rid = arr.getAttribute('data-rid');
      var dir = parseInt(arr.getAttribute('data-dir'));
      if (!rid || isNaN(dir)) return;
      // 找到对应的翻页器
      var pager = arr.parentNode;
      var curSpan = pager.querySelector('.we-list-cur');
      if (!curSpan) return;
      var curPage = parseInt(curSpan.textContent);
      var list = document.querySelector('.we-paged-list[data-rid="' + rid + '"]');
      if (!list) return;
      var items = list.querySelectorAll('.we-page-item');
      var pages = Array.from(items).map(function(el) {
        return { el: el, page: parseInt(el.getAttribute('data-page')) };
      });
      if (!pages.length) return;
      var maxPage = Math.max.apply(null, pages.map(function(p){return p.page;}));
      var newPage = ((curPage - 1 + dir) % maxPage + maxPage) % maxPage + 1;
      pages.forEach(function(p) { p.el.style.display = p.page === newPage ? '' : 'none'; });
      curSpan.textContent = newPage;
      listPageState[rid] = newPage;
      return;
    }
    // 删除 signal
    var sd = e.target.closest('.we-signal-del');
    if (sd) {
      var idx = parseInt(sd.getAttribute('data-sigidx'));
      if (!isNaN(idx)) {
        var scope = sd.getAttribute('data-sig-scope');
        var s = loadScopedState(scope);
        if (s.economy && s.economy.signals && s.economy.signals[idx] !== undefined) {
          s.economy.signals.splice(idx, 1);
          saveScopedState(scope, s);
          refresh();
        }
      }
      return;
    }
    // 添加 signal
    var sa = e.target.closest('.we-signal-add');
    if (sa) {
      var scope = sa.getAttribute('data-sig-scope');
      var s = loadScopedState(scope);
      s.economy = s.economy || {};
      if (!s.economy.signals) s.economy.signals = [];
      if (s.economy.signals.length < 5) {
        s.economy.signals.push({ summary: '新信号', scope: '区域' });
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }

    // 单击信号卡片后显示删除按钮；再次点击同一卡片时保持显示，方便移动端操作
    var signalCard = e.target.closest('.we-signal-item');
    if (signalCard && panelBodyElement && panelBodyElement.contains(signalCard)) {
      panelBodyElement.querySelectorAll('.we-card-active').forEach(function(c){ c.classList.remove('we-card-active'); });
      signalCard.classList.add('we-card-active');
      return;
    }

    // ===== 单击条目卡片显示/隐藏其编辑按钮（移动端无悬停，统一改为点按）=====
    if (!panelBodyElement || !panelBodyElement.contains(e.target)) return;
    // 点在按钮/输入控件/展开的编辑器内：交给各自处理器，不切换
    if (e.target.closest('button, select, input, textarea, label, a, .we-event-editor, .we-rep-dot, .we-climate-btn, .we-signal-item, .we-list-arrow, .we-nav-row, .we-section-toggle')) return;
    var card = findActionCard(e.target);
    var wasActive = card && card.classList.contains('we-card-active');
    // 先收起其它已展开的卡片
    panelBodyElement.querySelectorAll('.we-card-active').forEach(function(c){ c.classList.remove('we-card-active'); });
    if (card && !wasActive) card.classList.add('we-card-active');
  });

  /** 找到包含编辑按钮组的条目卡片（其直接子节点里有 .we-event-actions / .we-secret-ops） */
  function findActionCard(target) {
    var el = target;
    while (el && el.nodeType === 1 && el.id !== 'we-panel-body') {
      if (el.querySelector && el.querySelector(':scope > .we-event-actions, :scope > .we-secret-ops')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // 全局事件委托：signal 双击编辑
  document.addEventListener('dblclick', function(e) {
    var sum = e.target.closest('.we-signal-summary');
    var sc = e.target.closest('.we-signal-scope');
    if (!sum && !sc) return;
    e.preventDefault();
    var item = sum || sc;
    var isScope = !!sc;
    var parent = item.closest('.we-signal-item');
    if (!parent) return;
    var del = parent.querySelector('.we-signal-del');
    var idx = del ? parseInt(del.getAttribute('data-sigidx')) : -1;
    if (isNaN(idx)) return;
    var dispScope = parent.getAttribute('data-sig-scope');
    var oldText = item.textContent;
    item.contentEditable = 'true';
    item.focus();
    // select all text
    var range = document.createRange();
    range.selectNodeContents(item);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    item.onblur = function() {
      item.contentEditable = 'false';
      var s = loadScopedState(dispScope);
      if (s.economy && s.economy.signals && s.economy.signals[idx]) {
        if (isScope) s.economy.signals[idx].scope = item.textContent;
        else s.economy.signals[idx].summary = item.textContent;
        saveScopedState(dispScope, s);
      }
    };
    item.onkeydown = function(ke) {
      if (ke.key === 'Enter') { ke.preventDefault(); item.blur(); }
    };
  });

  // ========== 推演 UI 状态切换 ==========
  function setEvolvingUI(active, scope) {
    // 只置标志，绝不在这里调 refresh()：bindEvents() 每次刷新都会调用本函数，
    // 一旦回头再 refresh 就会 setEvolvingUI→refresh→bindEvents→setEvolvingUI 无限递归卡死。
    // 显示哪份由 getActiveInjected 守卫 + _evolvingScope 负责，刷新由调用方在外面做。
    _evolving = !!active;
    if (active && scope) _evolvingScope = scope;
    // 悬浮球卫星按钮：推演中禁用 前进/重新、启用 停止；空闲反之
    const fwd = document.getElementById('we-sat-forward');
    const redo = document.getElementById('we-sat-redo');
    const ab = document.getElementById('we-sat-abort');
    if (fwd) fwd.classList.toggle('we-sat-off', !!active);
    if (redo) redo.classList.toggle('we-sat-off', !!active);
    if (ab) ab.classList.toggle('we-sat-off', !active);
    // 面板标题栏推进按钮组（悬浮球关闭时的替代入口）同步禁用态
    const hFwd = document.querySelector('.we-hdr-forward');
    const hRedo = document.querySelector('.we-hdr-redo');
    const hAb = document.querySelector('.we-hdr-abort');
    if (hFwd) hFwd.classList.toggle('we-hdr-btn-off', !!active);
    if (hRedo) hRedo.classList.toggle('we-hdr-btn-off', !!active);
    if (hAb) hAb.classList.toggle('we-hdr-btn-off', !active);
    const ball = document.getElementById('we-input-btn');
    if (ball && active) {
      ball.classList.add('we-ball-evolving');
      ball.classList.remove('we-ball-success', 'we-ball-fail');
    } else if (ball && !active) {
      ball.classList.remove('we-ball-evolving');
    }
  }

  function setInjectedScope(scope) {
    _injectedScope = scope === 'checkpoint' ? 'checkpoint' : 'state';
  }

  // 手动推演（供悬浮球卫星按钮调用）：显式指定基底，不看 isNewRound。
  //   重新推进 → 喂存档点 B（mode 'redo'），面板显示存档点；
  //   向前推进 → 喂当前状态 A（mode 'forward'），面板显示当前状态。
  // [移植 v2.3.20 区间] 手动推演改为委托 world-engine.js 的 manualEvolve 统一入口：
  //   读取轮数改用 manualReadRounds 设置（存档点锚定），UI 只负责 toast。
  async function runManualEvolve(mode, scope) {
    if (!window.WORLD_ENGINE || typeof window.WORLD_ENGINE.manualEvolve !== 'function') {
      showToast('手动推演入口未就绪', true);
      return;
    }
    const ok = await window.WORLD_ENGINE.manualEvolve(mode, scope);
    if (ok) showToast('推演完成');
    else if (evolution.getLastError?.()) showToast(evolution.getLastError(), true);
  }

  // ========== 世界引擎悬浮球 ==========
  let inputButtonObserver = null;
  let inputButtonRetryTimer = null;
  const WE_BALL_POS_KEY = 'we-ball-pos';
  let _ballStatusTimer = null;

  function loadBallPos() {
    try {
      const raw = localStorage.getItem(WE_BALL_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.left === 'number' && typeof p.top === 'number') return p;
      }
    } catch (_) {}
    return null;
  }

  function saveBallPos(left, top, tucked, side) {
    try { localStorage.setItem(WE_BALL_POS_KEY, JSON.stringify({ left, top, tucked: !!tucked, side: side || null })); } catch (_) {}
  }

  // 侧边吸附参数
  const WE_TUCK_EDGE = 28;    // 距边缘多近算「吸附」
  const WE_TUCK_HANDLE = 15;  // 缩进后露出的小条宽度
  const WE_TUCK_INSET = 8;    // 拉出后距边缘的留白

  function applyBallTuck(ball, side) {
    const vw = window.innerWidth;
    const size = ball.offsetWidth || 52;
    ball.classList.add('we-ball-tucked');
    ball.classList.toggle('we-ball-tucked-left', side === 'left');
    ball.classList.toggle('we-ball-tucked-right', side === 'right');
    ball.style.left = (side === 'left' ? (WE_TUCK_HANDLE - size) : (vw - WE_TUCK_HANDLE)) + 'px';
  }

  function untuckBall(ball) {
    const pos = loadBallPos() || {};
    const vw = window.innerWidth, vh = window.innerHeight, size = ball.offsetWidth || 52;
    let left = typeof pos.left === 'number' ? pos.left : (vw - size - 18);
    let top = typeof pos.top === 'number' ? pos.top : (vh - size - 90);
    left = Math.max(4, Math.min(left, vw - size - 4));
    top = Math.max(4, Math.min(top, vh - size - 4));
    ball.classList.remove('we-ball-tucked', 'we-ball-tucked-left', 'we-ball-tucked-right');
    ball.style.left = left + 'px';
    ball.style.top = top + 'px';
    saveBallPos(left, top, false, null);
  }

  function applyBallPos(ball) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = ball.offsetWidth || 52;
    let pos = loadBallPos();
    if (!pos) pos = { left: vw - size - 44, top: vh - size - 90 };
    // 钳制进可视区域，避免拖出屏幕后找不到
    pos.left = Math.max(4, Math.min(pos.left, vw - size - 4));
    pos.top = Math.max(4, Math.min(pos.top, vh - size - 4));
    ball.style.top = pos.top + 'px';
    ball.style.right = 'auto';
    ball.style.bottom = 'auto';
    if (pos.tucked && (pos.side === 'left' || pos.side === 'right')) {
      ball.style.left = pos.left + 'px';   // 记录的是「拉出后」的位置
      applyBallTuck(ball, pos.side);        // 视觉上缩到边缘
    } else {
      ball.classList.remove('we-ball-tucked', 'we-ball-tucked-left', 'we-ball-tucked-right');
      ball.style.left = pos.left + 'px';
    }
  }

  function makeBallDraggable(ball) {
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const onDown = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      dragging = true; moved = false;
      sx = pt.clientX; sy = pt.clientY;
      const rect = ball.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      ball.classList.add('we-ball-dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - sx, dy = pt.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (e.cancelable) e.preventDefault();
      const size = ball.offsetWidth || 52;
      let left = Math.max(4, Math.min(ox + dx, window.innerWidth - size - 4));
      let top = Math.max(4, Math.min(oy + dy, window.innerHeight - size - 4));
      ball.style.left = left + 'px';
      ball.style.top = top + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      ball.classList.remove('we-ball-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if (!moved) return;
      const vw = window.innerWidth, size = ball.offsetWidth || 52;
      const left = parseFloat(ball.style.left) || 0;
      const top = parseFloat(ball.style.top) || 0;
      if (left <= WE_TUCK_EDGE) {                          // 贴左缘 → 缩进左侧
        saveBallPos(WE_TUCK_INSET, top, true, 'left');
        applyBallTuck(ball, 'left');
      } else if (left >= vw - size - WE_TUCK_EDGE) {        // 贴右缘 → 缩进右侧
        saveBallPos(vw - size - WE_TUCK_INSET, top, true, 'right');
        applyBallTuck(ball, 'right');
      } else {
        saveBallPos(left, top, false, null);
      }
    };
    ball.addEventListener('mousedown', onDown);
    ball.addEventListener('touchstart', onDown, { passive: true });
    // 点击处理：拖动后不算点击；已缩进则「拉出来」而非开面板
    ball.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; return; }
      if (ball.classList.contains('we-ball-tucked')) {
        e.preventDefault(); e.stopImmediatePropagation();
        untuckBall(ball);
      }
    }, true);
  }

  function observeInputButton() {
    if (inputButtonObserver || !document.body) return;
    inputButtonObserver = new MutationObserver(() => {
      // 球被酒馆重绘冲掉时重建（仅在启用时）；魔法棒菜单出现/被重建时补入口
      const needBall = isBallEnabled() && !document.getElementById('we-input-btn');
      const needWand = !document.getElementById('we-wand-entry') && !!document.getElementById('extensionsMenu');
      if (needBall || needWand) {
        clearTimeout(inputButtonRetryTimer);
        inputButtonRetryTimer = setTimeout(buildInputButton, 50);
      }
    });
    inputButtonObserver.observe(document.body, { childList: true, subtree: true });
  }

  // 解析推演状态文本 → 切换地球形态 + 进度环
  function setBallState(text, isError) {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const ring = ball.querySelector('.we-ball-ring');
    const badge = ball.querySelector('.we-ball-badge');
    // 悬浮球不显示状态文字（文字走屏幕顶部横幅）

    ball.classList.remove('we-ball-evolving', 'we-ball-success', 'we-ball-fail');
    clearTimeout(_ballStatusTimer);

    const count = ball.querySelector('.we-ball-count');
    const clearCount = () => {
      ball.classList.remove('we-ball-counting');
      if (count) count.textContent = '';
      if (ring) ring.style.setProperty('--we-ring-pct', '0deg');
    };

    if (/推演中/.test(text)) {
      ball.classList.add('we-ball-evolving');
      if (badge) badge.textContent = '';
      clearCount(); // 推演进行中不展示轮次计数，避免残留旧的 N/X
    } else if (isError || /失败|异常/.test(text)) {
      ball.classList.add('we-ball-fail');
      if (badge) badge.textContent = '✕';
      _ballStatusTimer = setTimeout(() => clearBallBadge(), 6000);
    } else if (/完成/.test(text)) {
      ball.classList.add('we-ball-success');
      if (badge) badge.textContent = '✓';
      clearCount(); // 推演完成 → 计数已归零，清掉进度环与数字
      _ballStatusTimer = setTimeout(() => clearBallBadge(), 4000);
    }

    // 解析「第 N/X 轮」→ 进度环 + 数字（仅未到推演的提示态才显示）
    const m = /第\s*(\d+)\s*\/\s*(\d+)\s*轮/.exec(text || '');
    if (ring && m) {
      const cur = Number(m[1]), total = Number(m[2]) || 1;
      const pct = Math.max(0, Math.min(1, cur / total));
      ring.style.setProperty('--we-ring-pct', (pct * 360) + 'deg');
      ball.classList.toggle('we-ball-counting', cur > 0 && cur < total);
      if (count) count.textContent = (cur < total) ? `${cur}/${total}` : '';
    }
  }

  function clearBallBadge() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    ball.classList.remove('we-ball-success', 'we-ball-fail');
    const badge = ball.querySelector('.we-ball-badge');
    if (badge) badge.textContent = '';
  }

  // 屏幕正上方状态横幅：显示约 5s 后淡出
  let _topStatusTimer = null;
  function showTopStatus(text, isError) {
    if (!document.body || !text) return;
    let el = document.getElementById('we-top-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'we-top-status';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('we-top-status-error', !!isError);
    el.classList.add('show');
    clearTimeout(_topStatusTimer);
    _topStatusTimer = setTimeout(() => { el.classList.remove('show'); }, 5000);
  }

  // 给悬浮球的三颗卫星按钮绑事件；阻止冒泡，避免触发拖拽 / 打开面板
  // [移植 v2.3.14] 「插头」总开关公用逻辑:一键联动 evolveMode + injectIntoPrompt。
  //   关闭态(插上)= evolveMode='manual'(不自动推演) + injectIntoPrompt=false(不注入)；
  //   不新增设置字段:状态从这俩字段反推(`manual && inject===false` = 关)。
  //   立即生效:切完调 applyInjection 让 inject 守卫生效(关→unregister,开→重注入)。
  //   球卫星钮与面板标题栏钮共用（悬浮球可关闭后,标题栏是备用入口）。
  function readPowerSettings() {
    const wapi = window.WORLD_ENGINE_API;
    return (wapi && wapi.getSettings ? wapi.getSettings(true) : {}) || {};
  }
  function isPowerOff(s) { return s.evolveMode === 'manual' && s.injectIntoPrompt === false; }
  function syncPowerVisual() {
    const off = isPowerOff(readPowerSettings());
    const sat = document.getElementById('we-sat-power');
    if (sat) sat.classList.toggle('on', off);
    const hdr = document.querySelector('.we-hdr-power');
    if (hdr) hdr.classList.toggle('on', off);
  }
  function togglePowerSwitch() {
    const wapi = window.WORLD_ENGINE_API;
    const turnOff = !isPowerOff(readPowerSettings()); // 切到对面
    const setKV = (k, v) => {
      const c = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
      window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...c, [k]: v }));
      if (wapi && wapi.getSettings) wapi.getSettings(true);
    };
    setKV('evolveMode', turnOff ? 'manual' : 'auto');
    setKV('injectIntoPrompt', !turnOff); // 关=false, 开=true
    window.WORLD_ENGINE?.applyInjection?.(); // 立即重注入:关→unregisterInjection,开→重新注入
    syncPowerVisual();
    showToast(turnOff ? '已关闭推演与注入' : '已开启推演与注入');
    if (typeof _currentView !== 'undefined' && _currentView === 'settings') refresh();
  }

  function wireSatellites(ball) {
    const wire = (id, fn) => {
      const el = ball.querySelector('#' + id);
      if (!el) return;
      const stop = e => e.stopPropagation();
      el.addEventListener('mousedown', stop);
      el.addEventListener('touchstart', stop, { passive: true });
      el.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        if (el.classList.contains('we-sat-off')) return;
        fn();
      });
    };
    wire('we-sat-forward', () => runManualEvolve('forward', 'state'));
    wire('we-sat-redo', () => runManualEvolve('redo', 'checkpoint'));
    wire('we-sat-abort', () => { evolution.abort(); showToast('已发送停止信号'); });
    // 插头钮不用 we-sat-off(wire 内会拦不可点);用 .on class 标关闭态,power 永远可点。
    syncPowerVisual(); // 初始视觉态
    wire('we-sat-power', togglePowerSwitch);
  }

  // 悬浮球是否启用（设置项，默认开；关闭后从酒馆「魔法棒」扩展菜单打开面板）
  function isBallEnabled() {
    try {
      const s = window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings ? window.WORLD_ENGINE_API.getSettings() : {};
      return s.showFloatingBall !== false;
    } catch (e) { return true; }
  }

  // 酒馆输入框左侧「魔法棒」扩展菜单入口：点击开关世界引擎面板。
  //   与悬浮球并存；悬浮球关闭后这是唯一入口。幂等，可反复调用。
  function ensureWandMenuEntry() {
    try {
      const menu = document.getElementById('extensionsMenu');
      if (!menu || document.getElementById('we-wand-entry')) return;
      const item = document.createElement('div');
      item.id = 'we-wand-entry';
      item.className = 'list-group-item flex-container flexGap5 interactable';
      item.tabIndex = 0;
      item.innerHTML = '<i class="fa-solid fa-globe"></i><span>世界引擎</span>';
      item.addEventListener('click', () => togglePanel());
      menu.appendChild(item);
    } catch (e) {}
  }

  // 面板标题栏的推进按钮组：悬浮球关闭时显示（卫星钮的替代入口）
  function updateHeaderEvolveVisibility() {
    const cluster = document.getElementById('we-header-evolve');
    if (!cluster) return;
    cluster.classList.toggle('we-show', !isBallEnabled());
    syncPowerVisual();
  }

  function buildInputButton() {
    if (!document.body) return;

    // 悬浮球关闭：移除现有球（不影响魔法棒入口与状态横幅），推进钮走面板标题栏
    if (!isBallEnabled()) {
      const existing = document.getElementById('we-input-btn');
      if (existing) existing.remove();
      ensureExtras();
      return;
    }

    let btn = document.getElementById('we-input-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'we-input-btn';
      btn.type = 'button';
      btn.title = '世界引擎';
      btn.setAttribute('aria-label', '世界引擎');
      btn.className = 'we-ball';
      btn.innerHTML =
        '<span class="we-ball-orbit"></span>' +
        '<span class="we-ball-ring"></span>' +
        '<span class="we-ball-globe"></span>' +
        '<span class="we-ball-count"></span>' +
        '<span class="we-ball-badge"></span>' +
        '<span class="we-ball-tip"></span>' +
        '<span class="we-sat we-sat-up" id="we-sat-forward" role="button" title="向前推进"><i class="fa-solid fa-forward"></i></span>' +
        '<span class="we-sat we-sat-right we-sat-off" id="we-sat-abort" role="button" title="停止推演"><i class="fa-solid fa-stop"></i></span>' +
        '<span class="we-sat we-sat-down" id="we-sat-redo" role="button" title="重新推进"><i class="fa-solid fa-rotate-right"></i></span>' +
        '<span class="we-sat we-sat-left" id="we-sat-power" role="button" title="插上=关闭推演与注入 / 拔下=开启"><i class="fa-solid fa-power-off"></i></span>';
      btn.onclick = () => togglePanel();
      document.body.appendChild(btn);
      wireSatellites(btn);
      applyBallPos(btn);
      makeBallDraggable(btn);
      window.addEventListener('resize', () => applyBallPos(btn));
      setEvolvingUI(isEvolving || Boolean(evolution.isRunning?.()));
    } else if (btn.parentElement !== document.body) {
      document.body.appendChild(btn);
      applyBallPos(btn);
    }

    ensureExtras();
  }

  // 斜杠命令：/we-panel 开关面板、/we-evolve 向前推进。
  //   快速回复按钮的执行载体（消息以 / 开头即按命令执行），也可直接在输入框敲。
  //   兼容两代注册 API：新版 SlashCommandParser / 旧版 registerSlashCommand。
  let _slashRegistered = false;
  function registerSlashCommands() {
    if (_slashRegistered) return;
    let ctx = null;
    try { ctx = SillyTavern.getContext(); } catch (e) { return; }
    if (!ctx) return;
    const commands = [
      { name: 'we-panel', help: '开关世界引擎面板', fn: () => { togglePanel(); return ''; } },
      { name: 'we-evolve', help: '世界引擎：向前推进一轮（同悬浮球▶钮）', fn: () => { runManualEvolve('forward', 'state'); return ''; } }
    ];
    try {
      if (ctx.SlashCommandParser && ctx.SlashCommand && typeof ctx.SlashCommand.fromProps === 'function') {
        for (const c of commands) {
          ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
            name: c.name,
            callback: async () => c.fn(),
            helpString: c.help
          }));
        }
        _slashRegistered = true;
      } else if (typeof ctx.registerSlashCommand === 'function') {
        for (const c of commands) {
          ctx.registerSlashCommand(c.name, () => c.fn(), [], '– ' + c.help, true, true);
        }
        _slashRegistered = true;
      }
    } catch (e) {
      console.warn('[世界引擎] 斜杠命令注册失败', e);
    }
  }

  // 一键添加「世界引擎」快速回复按钮组（需启用酒馆 Quick Reply 扩展）。
  //   幂等：组/按钮已存在则跳过。按钮消息即斜杠命令，用户可在快速回复设置里自行增删改。
  async function handleAddQuickReplies() {
    const qr = window.quickReplyApi;
    if (!qr || typeof qr.createQuickReply !== 'function') {
      showToast('未检测到快速回复扩展（Quick Reply），请先在酒馆扩展里启用', true);
      return;
    }
    const SET = '世界引擎';
    try {
      let set = null;
      try { set = qr.getSetByName ? qr.getSetByName(SET) : null; } catch (e) {}
      if (!set) await qr.createSet(SET, { isVisible: true });
      const ensure = (label, message, title) => {
        try {
          if (qr.getQrByLabel && qr.getQrByLabel(SET, label)) return;
        } catch (e) {}
        qr.createQuickReply(SET, label, { message: message, title: title });
      };
      ensure('🌍面板', '/we-panel', '开关世界引擎面板');
      ensure('▶推演', '/we-evolve', '世界引擎：向前推进一轮');
      try { qr.addGlobalSet(SET, { isVisible: true }); } catch (e) { /* 已链接为全局时可能抛错，无碍 */ }
      showToast('已添加「世界引擎」快速回复按钮（🌍面板 / ▶推演）');
    } catch (e) {
      console.error('[世界引擎] 添加快速回复失败', e);
      showToast('添加失败: ' + (e && e.message || e), true);
    }
  }

  // 悬浮球开/关两条路径共用的初始化：状态接口、面板、魔法棒入口、观察器、标题栏推进钮
  function ensureExtras() {
    // 兼容旧的外部状态接口：保留隐藏元素，转发到地球状态机
    let statusIndicator = document.getElementById('we-external-status');
    if (!statusIndicator) {
      statusIndicator = document.createElement('span');
      statusIndicator.id = 'we-external-status';
      statusIndicator.style.display = 'none';
      document.body.appendChild(statusIndicator);
    }

    window.__WE_SetExternalStatus = function(text, isError) {
      const el = document.getElementById('we-external-status');
      if (el) el.textContent = text;
      setBallState(text || '', !!isError);   // 球不存在时内部自动跳过
      // 进度类（第 N/X 轮/天）只在悬浮球上显示；其余状态走屏幕顶部横幅。
      // 悬浮球关闭时进度类也走横幅，否则轮次进度无处可看。
      const isProgress = text && /第\s*\d+\s*\/\s*\d+\s*[轮天]/.test(text);
      if (text && (!isProgress || !document.getElementById('we-input-btn'))) {
        showTopStatus(text, !!isError);
      }
    };

    buildPanel();
    ensureWandMenuEntry();
    registerSlashCommands();
    updateHeaderEvolveVisibility();
    observeInputButton();
  }

  // 测试钩子（纯增量）：暴露内置渲染函数与 pager 重置，供渲染快照 harness 比对。不影响生产路径。
  const __test = {
    resetPager: function () { listPagerCounter = 0; Object.keys(listPageState).forEach(function (k) { delete listPageState[k]; }); },
    renderIds: function () { return Object.keys(BUILTIN_RENDER); },
    renderWorldCore, renderEventList, renderFactionList, renderWorldTrends, renderWindList,
    renderReputation, renderEconomy, renderEnemies, renderInfluenceChain, renderRegionalIncident,
    renderBlackbox, renderGenericModule, renderDescriptorSection, renderHomeView, renderHomeViewExpanded, renderSubView, renderCheckpointSections
  };

  // 脚本加载即应用已存主题，避免面板 / 悬浮球先闪默认色。
  try { applyTheme(getStoredTheme()); } catch (e) {}

  return { buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus, setEvolvingUI, setInjectedScope, __test };
})();
