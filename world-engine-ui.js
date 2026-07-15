// world-engine-ui.js — 完整 UI 面板
window.WORLD_ENGINE_UI = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const evolution = window.WORLD_ENGINE_EVOLUTION;

  let panelElement = null;
  let panelBodyElement = null;
  let panelVisible = false;
  let _engineFace = 'world';
  const _engineFaceOrder = [];
  const _engineFaceRegistry = new Map();
  let _memorySettingsOpen = false;
  let _memoryView = 'home';
  let _memorySelectedNavView = null;
  let _memoryEditingPerson = null;
  let _memoryEditingEntity = null;
  let _memoryEditingSmall = null;
  let _memoryEditingBig = null;
  let _memoryRunningLabel = '';
  let _panelFlipping = false;
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
  let listPagerCounter = 0;
  const listPageState = {};
  const sectionCollapsed = { 'checkpoint-section': true, 'set-filter': true };
  const expandedWorldbookGroups = new Set();
  // 世界书缓存（模块级，跨 refresh() 存活）
  let _wbCachedEntries = null;
  let _wbCachedSelectedIds = null;
  let _wbCachedOverrides = null;
  let _wbCachedChatId = null;
  let _wbCachedScope = null;
  let _wbScrollTop = 0;

  // 引擎面扩展点：新增引擎按注册顺序进入“下一界面”循环。
  // 可提供 render/bind、主题/版本、设置、运行状态、球体 class 与卫星按钮动作等钩子。
  function registerEngineFace(definition) {
    const face = definition && typeof definition === 'object' ? definition : {};
    const id = String(face.id || '').trim();
    if (!id) throw new Error('引擎界面必须提供 id');
    const existed = _engineFaceRegistry.has(id);
    _engineFaceRegistry.set(id, { id, label: id, ...face });
    if (!existed) _engineFaceOrder.push(id);
    if (panelElement) updateEngineFaceChrome();
    return id;
  }

  function callEngineFace(face, hook, fallback, ...args) {
    try {
      return typeof face?.[hook] === 'function' ? face[hook](...args) : fallback;
    } catch (error) {
      console.error(`[${face?.label || face?.id || '引擎'}] UI ${hook} 失败（已隔离）`, error);
      return fallback;
    }
  }

  const ENGINE_ACTION_FAILED = Symbol('engine-action-failed');
  function callEngineFaceAction(face, hook, ...args) {
    const report = error => {
      console.error(`[${face?.label || face?.id || '引擎'}] UI ${hook} 失败（已隔离）`, error);
      showToast(`${face?.label || '引擎'}操作失败：${error?.message || error}`, true);
      return ENGINE_ACTION_FAILED;
    };
    try {
      if (typeof face?.[hook] !== 'function') return ENGINE_ACTION_FAILED;
      const result = face[hook](...args);
      return result && typeof result.then === 'function' ? result.catch(report) : result;
    } catch (error) {
      return report(error);
    }
  }

  function ensureBuiltinEngineFaces() {
    if (_engineFaceRegistry.has('world')) return;
    registerEngineFace({
      id: 'world', label: '世界引擎',
      getTheme: () => getStoredTheme(),
      getVersion: () => window.WORLD_ENGINE_VERSION,
      getSettings: () => window.WORLD_ENGINE_API?.getSettings(true) || {},
      setEnabled: enabled => {
        const api = window.WORLD_ENGINE_API;
        const current = api?.getSettings?.(true) || {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...current, engineEnabled: enabled }));
        api?.getSettings?.(true);
        window.WORLD_ENGINE?.applyInjection?.();
      },
      isRunning: () => Boolean(_evolving),
      showForward: true,
      forward: () => runManualEvolve('forward', 'state'),
      redo: () => runManualEvolve('redo', 'checkpoint'),
      abort: () => evolution.abort()
    });
    registerEngineFace({
      id: 'memory', label: '记忆引擎', ballClass: 'we-ball-memory-face', panelClass: 'we-memory-face',
      getTheme: () => getStoredMemoryTheme(),
      getVersion: () => window.MEMORY_ENGINE_SETTINGS?.VERSION,
      getSettings: () => window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {},
      setEnabled: enabled => {
        window.MEMORY_ENGINE_SETTINGS?.patchSettings({ engineEnabled: enabled });
        window.MEMORY_ENGINE?.applyInjection?.();
      },
      isRunning: () => Boolean(window.MEMORY_ENGINE?.isRunning?.()),
      getRunningLabel: () => window.MEMORY_ENGINE?.getRunningLabel?.() || _memoryRunningLabel,
      render: () => renderMemoryView(),
      bind: () => bindMemoryView(),
      openSettings: () => { _memorySettingsOpen = !_memorySettingsOpen; },
      isSettingsOpen: () => _memorySettingsOpen,
      onSettingsTab: key => { _memorySettingsTab = key; },
      refreshDebug: () => refreshMemoryDebugRender(),
      showForward: true,
      forwardTitle: '手动提取记忆',
      forward: () => runMemoryExtract(),
      redo: () => runMemoryReextract(),
      abort: () => window.MEMORY_ENGINE?.abort?.()
    });
  }

  function getEngineFace(id) {
    ensureBuiltinEngineFaces();
    return _engineFaceRegistry.get(id || _engineFace) || _engineFaceRegistry.get('world');
  }

  function getNextEngineFace() {
    ensureBuiltinEngineFaces();
    const index = Math.max(0, _engineFaceOrder.indexOf(_engineFace));
    return getEngineFace(_engineFaceOrder[(index + 1) % _engineFaceOrder.length]);
  }

  // 六套纯 CSS 变量主题。写在 <html> 上，面板、悬浮球和顶部状态条同步换色。
  const WE_THEME_KEY = 'we-theme';
  const MEMORY_THEME_KEY = 'memory-engine-theme';
  const MEMORY_THEME_NIGHT_MIGRATION_KEY = 'memory-engine-theme-night-default-v1';
  const WE_THEMES = [
    { id: 'default', name: '墨玉 · 默认' },
    { id: 'night', name: '夜阑 · 近黑' },
    { id: 'deepsea', name: '深海 · 幽蓝' },
    { id: 'plum', name: '夜合 · 暗紫' },
    { id: 'paper', name: '云白 · 清爽' },
    { id: 'sakura', name: '早樱 · 浅粉' }
  ];
  const MECHANICS_DEFAULT_FIELDS = {
    regional: {
      'we-local-ri-chance': 3,
      'we-local-ri-duration': 5,
      'we-local-ri-cooldown': 5
    },
    distant: {
      'we-local-distant-threshold': 10,
      'we-local-distant-chance': 20,
      'we-local-distant-cooldown': 5,
      'we-local-distant-event-percent': 50
    },
    near: {
      'we-local-near-chance': 20,
      'we-local-near-cooldown': 5,
      'we-local-near-event-percent': 50
    },
    dice: {
      'we-local-dice-mod': 0,
      'we-local-setback-ratio': 40,
      'we-local-progress-fail-base': 2,
      'we-local-conflict-fail-base': 6
    },
    winddecay: {
      'we-local-wind-rumor-base': 25,
      'we-local-wind-rumor-grace': 1,
      'we-local-wind-rumor-linear': 5,
      'we-local-wind-rumor-quadratic': 3,
      'we-local-wind-sentiment-base': 8,
      'we-local-wind-sentiment-grace': 5,
      'we-local-wind-sentiment-linear': 2,
      'we-local-wind-sentiment-quadratic': 1,
      'we-local-wind-report-base': 20,
      'we-local-wind-report-grace': 2,
      'we-local-wind-report-linear': 4,
      'we-local-wind-report-quadratic': 2,
      'we-local-wind-announcement-base': 10,
      'we-local-wind-announcement-grace': 4,
      'we-local-wind-announcement-linear': 3,
      'we-local-wind-announcement-quadratic': 1
    },
    retention: {
      'we-local-terminal-base': 2,
      'we-local-terminal-level': 2,
      'we-local-influence-keep': 8,
      'we-local-enemy-keep': 20,
      'we-local-ledger-keep': 20,
      'we-local-cap-events': 16,
      'we-local-cap-factions': 15,
      'we-local-cap-winds': 12,
      'we-local-cap-trends': 4,
      'we-local-cap-influence': 12,
      'we-local-cap-enemies': 8,
      'we-local-cap-econ': 8,
      'we-local-cap-blackbox': 12
    }
  };

  function normalizeTheme(id) {
    return WE_THEMES.some(theme => theme.id === id) ? id : 'default';
  }

  function getStoredTheme() {
    try { return normalizeTheme(localStorage.getItem(WE_THEME_KEY) || 'default'); }
    catch (e) { return 'default'; }
  }

  function getStoredMemoryTheme() {
    try {
      let stored = localStorage.getItem(MEMORY_THEME_KEY);
      if (!localStorage.getItem(MEMORY_THEME_NIGHT_MIGRATION_KEY)) {
        if (!stored || stored === 'default') {
          stored = 'night';
          localStorage.setItem(MEMORY_THEME_KEY, stored);
        }
        localStorage.setItem(MEMORY_THEME_NIGHT_MIGRATION_KEY, '1');
      }
      return normalizeTheme(stored || 'night');
    }
    catch (e) { return 'night'; }
  }

  function applyTheme(id) {
    const theme = normalizeTheme(id);
    const root = document.documentElement;
    if (!root) return;
    if (theme === 'default') root.removeAttribute('data-we-theme');
    else root.setAttribute('data-we-theme', theme);
  }

  function setTheme(id) {
    const theme = normalizeTheme(id);
    applyTheme(theme);
    try { localStorage.setItem(WE_THEME_KEY, theme); } catch (e) {}
  }

  function setMemoryTheme(id) {
    const theme = normalizeTheme(id);
    applyTheme(theme);
    try { localStorage.setItem(MEMORY_THEME_KEY, theme); } catch (e) {}
  }

  function applyEngineFaceTheme() {
    const face = getEngineFace();
    applyTheme(callEngineFace(face, 'getTheme', getStoredTheme()));
  }

  // 模块加载时立即恢复主题，避免面板和悬浮球先闪默认色。
  applyTheme(getStoredTheme());

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
    const motto = SECTION_MOTTOS[sectionId.replace(/^cp-/, '')];
    const mottoHtml = motto ? `<span class="we-section-motto">— ${motto}</span>` : '';
    return `<span class="we-section-toggle" data-section="${sectionId}">
      <span class="we-section-arrow" id="we-section-arrow-${sectionId}">${collapsed ? '▶' : '▼'}</span>${title}${mottoHtml}
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
            <button class="we-panel-title we-engine-face-toggle" type="button" title="切换到记忆引擎" aria-label="切换到记忆引擎">世界引擎</button>
            <span class="we-panel-version" id="we-panel-version"></span><!-- [FIX] 版本号 -->
            <span class="we-header-round" id="we-header-round"></span>
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
    `;
    document.body.appendChild(panel);
    panelElement = panel;
    panelBodyElement = panel.querySelector('#we-panel-body');

    // [FIX] 显示扩展版本号（来自 manifest.json，读不到则隐藏）
    const verEl = panel.querySelector('#we-panel-version');
    if (verEl) {
      const v = window.WORLD_ENGINE_VERSION;
      if (v) verEl.textContent = 'v' + v;
      else verEl.style.display = 'none';
    }

    panel.querySelector('.we-panel-close').onclick = () => hidePanel();
    panel.querySelector('.we-engine-face-toggle').onclick = (event) => {
      event.stopPropagation();
      advanceEngineFace();
    };
    initDrag(panel, panel.querySelector('.we-panel-header'));

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panelVisible) hidePanel();
    });
  }

  // 当前视图：'home' | 'situation' | 'events' | 'relations' | 'resources' | 'settings'
  let _currentView = 'home';

  function renderMemoryView() {
    if (_memorySettingsOpen) return renderMemorySettingsView();
    if (_memoryView === 'home') return renderMemoryHomeView();
    return renderMemorySubView(_memoryView);
  }

  function memoryProgressCircle(radius, progress, color, width, className) {
    const circumference = 2 * Math.PI * radius;
    const ratio = Math.max(0, Math.min(1, Number(progress) || 0));
    const dash = (circumference * ratio).toFixed(1);
    return `<circle class="${className}" cx="80" cy="80" r="${radius}" fill="none" stroke="${color}" stroke-width="${width}"
      stroke-linecap="round" stroke-dasharray="${dash} ${(circumference - circumference * ratio).toFixed(1)}"
      transform="rotate(-90 80 80)"/>`;
  }

  function renderMemoryCore(state, settings) {
    const eventMemory = state?.event_memory || {};
    const smallSummaries = Array.isArray(eventMemory.small_summaries) ? eventMemory.small_summaries : [];
    const bigSummaries = Array.isArray(eventMemory.big_summaries) ? eventMemory.big_summaries : [];
    const cursor = Math.max(0, Math.min(smallSummaries.length, parseInt(eventMemory.big_summary_cursor) || 0));
    const bigTarget = Math.max(1, parseInt(settings.bigSummaryEveryX) || 5);
    const pendingSmall = Math.max(0, smallSummaries.length - cursor);
    const bigProgress = Math.min(1, pendingSmall / bigTarget);
    const bigRemaining = Math.max(0, bigTarget - pendingSmall);
    const entityCount = ['organization', 'object', 'ability', 'location']
      .reduce((sum, type) => sum + (Array.isArray(state?.entity_memory?.[type]) ? state.entity_memory[type].length : 0), 0);
    const stats = [
      ['人物', Array.isArray(state?.personal_memory) ? state.personal_memory.length : 0],
      ['实体', entityCount],
      ['纪要', smallSummaries.length],
      ['总述', bigSummaries.length]
    ].map(([label, value]) => `<div class="we-core-stat"><div class="we-core-stat-k">${label}</div><div class="we-core-stat-v">${value}</div></div>`).join('');
    const centerMain = bigRemaining > 0 ? bigRemaining : '待执行';
    const centerUnit = bigRemaining > 0 ? '<span>轮</span>' : '';

    return `<div class="we-section we-core-section we-memory-core-section">
      <div class="we-core" title="${bigRemaining > 0 ? `距离下一次总述还有 ${bigRemaining} 轮` : '总述待执行'}">
        <div class="we-core-ring we-memory-core-ring">
          <svg viewBox="0 0 160 160" width="160" height="160" aria-hidden="true">
            <circle cx="80" cy="80" r="64" fill="none" stroke="color-mix(in srgb, var(--we-accent) 18%, transparent)" stroke-width="6"/>
            ${memoryProgressCircle(64, bigProgress, 'var(--we-accent)', 6, 'we-memory-big-progress')}
          </svg>
          <div class="we-core-center">
            <div class="we-core-title">记忆脉络</div>
            <div class="we-core-sub">下一次总述</div>
            <div class="we-core-pct we-memory-core-value">${centerMain}${centerUnit}</div>
          </div>
        </div>
        <div class="we-core-stats">${stats}</div>
      </div>
    </div>`;
  }

  function renderMemoryHomeView() {
    const state = window.MEMORY_ENGINE_DATA?.loadState?.() || {};
    const settings = window.MEMORY_ENGINE_SETTINGS?.getSettings?.(true) || {};
    const rows = [
      { view: 'people', label: '人物', sub: '人物记忆 · 别名 · 时间', poem: '知人者智' },
      { view: 'entities', label: '实体', sub: '组织 · 物件 · 能力 · 地点', poem: '名者，实之宾也' },
      { view: 'minutes', label: '纪要', sub: '阶段纪要 · 楼层范围', poem: '纪事者必提其要' },
      { view: 'overview', label: '总述', sub: '阶段总述 · 全局脉络', poem: '壹引其纲，万目皆张' }
    ];
    const nav = rows.map((row, index) => {
      const selected = _memorySelectedNavView === row.view ? ' we-nav-row--selected' : '';
      const topLine = index === 0 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const bottomLine = index === rows.length - 1 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      return `<div class="we-nav-row we-memory-nav-row${selected}" data-memory-view="${row.view}">
        <div class="we-nav-label">${row.label}</div>
        <div class="we-nav-track">${topLine}<div class="we-nav-dot"></div>${bottomLine}</div>
        <div class="we-nav-content"><span class="we-nav-sub">${row.sub}</span><span class="we-nav-poem">${row.poem}</span></div>
        <i class="fa-solid fa-chevron-right we-nav-arrow"></i>
      </div>`;
    }).join('');
    return '<div class="we-memory-home">'
      + renderMemoryCore(state, settings)
      + '<div class="we-nav-list we-memory-nav-list">' + nav + '</div>'
      + '</div>';
  }

  const MEMORY_VIEW_META = {
    people: { title: '人物', poem: '知人者智' },
    entities: { title: '实体', poem: '名者，实之宾也' },
    minutes: { title: '纪要', poem: '纪事者必提其要' },
    overview: { title: '总述', poem: '壹引其纲，万目皆张' }
  };
  const MEMORY_ENTITY_LABELS = { organization: '组织', object: '物件', ability: '能力', location: '地点' };

  function renderMemoryEntryRow(time, content, kind, knownBy) {
    const placeholder = kind === 'history' ? '事件内容' : '人物记忆';
    return `<div class="we-memory-entry-edit" data-memory-entry-row>
      <input class="we-memory-entry-time" type="text" value="${h(time || '')}" placeholder="时间（可留空）">
      <textarea class="we-memory-entry-content" rows="2" placeholder="${placeholder}">${h(content || '')}</textarea>
      ${kind === 'memory' ? `<input class="we-memory-entry-known-by" type="text" value="${h((knownBy || []).join(' / '))}" placeholder="知情人（用 / 分隔；持有者本人不用填写）">` : ''}
      <button class="we-icon-btn we-memory-remove-entry" type="button" title="移除此条"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }

  function memoryKnownBy(state, person, time, memory) {
    return (state?.personal_memory || []).filter(knower => knower.id !== person?.id && (knower.names || []).some(name =>
      (state?.knowledge_index?.[String(name).trim().toLocaleLowerCase()] || []).some(record =>
        record.ownerId === person?.id && String(record.time || '') === String(time || '') && String(record.memory || '') === String(memory || '')
      )
    )).map(knower => knower.names?.[0] || knower.id);
  }

  function renderMemoryPersonEditor(person, isNew, state) {
    const entries = Object.entries(person?.memory || {}).flatMap(([time, memories]) =>
      (Array.isArray(memories) ? memories : []).map(memory => renderMemoryEntryRow(time, memory, 'memory', memoryKnownBy(state, person, time, memory)))
    ).join('');
    return `<div class="we-memory-editor" data-person-editor data-person-id="${h(person?.id || '')}" data-new="${isNew ? 'true' : 'false'}">
      <div class="we-input-group"><label>姓名与别名（用 / 分隔）</label><input class="we-memory-person-names" type="text" value="${h((person?.names || []).join(' / '))}" placeholder="例如：沈鹤亭 / 鹤亭"></div>
      <div class="we-memory-editor-label">人物记忆</div>
      <div class="we-memory-entry-list">${entries || '<div class="we-memory-entry-empty">暂无记忆，可在下方增加</div>'}</div>
      <button class="we-btn we-memory-add-entry" type="button" data-entry-kind="memory"><i class="fa-solid fa-plus"></i> 增加记忆</button>
      <div class="we-memory-editor-actions"><button class="we-btn we-memory-cancel-edit" type="button">取消</button><button class="we-btn we-btn-primary we-memory-save-person" type="button">保存</button></div>
    </div>`;
  }

  function renderMemoryPeople(state) {
    const people = Array.isArray(state.personal_memory) ? state.personal_memory : [];
    const draft = _memoryEditingPerson === '__new__'
      ? `<div class="we-memory-record we-memory-record-new">${renderMemoryPersonEditor({ id: '', names: [], memory: {} }, true, state)}</div>` : '';
    const cards = people.map(person => {
      const editing = _memoryEditingPerson === person.id;
      const entries = Object.entries(person.memory || {}).flatMap(([time, memories]) =>
        (Array.isArray(memories) ? memories : []).map(memory => {
          const knownBy = memoryKnownBy(state, person, time, memory);
          return `<div class="we-memory-line"><span class="we-memory-line-time">${h(time || '时间未明')}</span><div class="we-memory-line-main"><div class="we-memory-line-content">${h(memory)}</div><div class="we-memory-line-known">知情人：${h(knownBy.length ? knownBy.join(' · ') : '仅本人')}</div></div></div>`;
        })
      ).join('');
      return `<div class="we-memory-record" data-person-id="${h(person.id)}">
        <div class="we-memory-record-head"><div><div class="we-memory-record-title">${h(person.names?.[0] || '未命名人物')}</div><div class="we-memory-record-meta">${h((person.names || []).slice(1).join(' · ') || person.id)}</div></div>
          <div class="we-memory-record-actions"><button class="we-icon-btn we-memory-edit-person" type="button" title="编辑"><i class="fa-solid fa-pen"></i></button><button class="we-icon-btn we-memory-delete-person" type="button" title="删除"><i class="fa-solid fa-trash"></i></button></div>
        </div>
        ${editing ? renderMemoryPersonEditor(person, false, state) : (entries || '<div class="we-empty">暂无人物记忆</div>')}
      </div>`;
    }).join('');
    return `<div class="we-memory-page-actions"><button class="we-btn we-btn-primary" id="we-memory-add-person" type="button"><i class="fa-solid fa-plus"></i> 新增人物</button></div>${draft}${cards || '<div class="we-empty">暂无人物，点击“新增人物”手动建立。</div>'}`;
  }

  function renderMemoryEntityEditor(entity, type, isNew) {
    const history = (Array.isArray(entity?.history) ? entity.history : [])
      .map(entry => renderMemoryEntryRow(entry.time, entry.event, 'history')).join('');
    const options = Object.entries(MEMORY_ENTITY_LABELS).map(([value, label]) => `<option value="${value}" ${value === type ? 'selected' : ''}>${label}</option>`).join('');
    return `<div class="we-memory-editor" data-entity-editor data-entity-id="${h(entity?.id || '')}" data-original-type="${h(type || 'organization')}" data-new="${isNew ? 'true' : 'false'}">
      <div class="we-memory-form-grid"><div class="we-input-group"><label>类型</label><select class="we-memory-entity-type">${options}</select></div><div class="we-input-group"><label>名称</label><input class="we-memory-entity-name" type="text" value="${h(entity?.name || '')}" placeholder="实体名称"></div></div>
      <div class="we-input-group"><label>当前描述</label><textarea class="we-memory-entity-description" rows="3" placeholder="实体当前状态与特征">${h(entity?.description || '')}</textarea></div>
      <div class="we-memory-editor-label">历史事件</div>
      <div class="we-memory-entry-list">${history || '<div class="we-memory-entry-empty">暂无历史，可在下方增加</div>'}</div>
      <button class="we-btn we-memory-add-entry" type="button" data-entry-kind="history"><i class="fa-solid fa-plus"></i> 增加历史</button>
      <div class="we-memory-editor-actions"><button class="we-btn we-memory-cancel-edit" type="button">取消</button><button class="we-btn we-btn-primary we-memory-save-entity" type="button">保存</button></div>
    </div>`;
  }

  function renderMemoryEntities(state) {
    const draft = _memoryEditingEntity === '__new__'
      ? `<div class="we-memory-record we-memory-record-new">${renderMemoryEntityEditor({ id: '', name: '', description: '', history: [] }, 'organization', true)}</div>` : '';
    const cards = Object.entries(MEMORY_ENTITY_LABELS).flatMap(([type, label]) =>
      (Array.isArray(state.entity_memory?.[type]) ? state.entity_memory[type] : []).map(entity => {
        const key = `${type}:${entity.id}`;
        const history = (Array.isArray(entity.history) ? entity.history : []).map(entry =>
          `<div class="we-memory-line"><span class="we-memory-line-time">${h(entry.time || '时间未明')}</span><div class="we-memory-line-main"><div class="we-memory-line-content">${h(entry.event)}</div></div></div>`
        ).join('');
        return `<div class="we-memory-record" data-entity-id="${h(entity.id)}" data-entity-type="${type}">
          <div class="we-memory-record-head"><div><div class="we-memory-record-title"><span class="we-memory-type-badge">${label}</span>${h(entity.name || '未命名实体')}</div><div class="we-memory-record-meta">${h(entity.id)}</div></div>
            <div class="we-memory-record-actions"><button class="we-icon-btn we-memory-edit-entity" type="button" title="编辑"><i class="fa-solid fa-pen"></i></button><button class="we-icon-btn we-memory-delete-entity" type="button" title="删除"><i class="fa-solid fa-trash"></i></button></div>
          </div>
          ${_memoryEditingEntity === key ? renderMemoryEntityEditor(entity, type, false) : `<div class="we-memory-description">${h(entity.description || '暂无描述')}</div>${history}`}
        </div>`;
      })
    ).join('');
    return `<div class="we-memory-page-actions"><button class="we-btn we-btn-primary" id="we-memory-add-entity" type="button"><i class="fa-solid fa-plus"></i> 新增实体</button></div>${draft}${cards || '<div class="we-empty">暂无实体，点击“新增实体”手动建立。</div>'}`;
  }

  function renderMemoryMinutes(state) {
    const eventMemory = state.event_memory || {};
    const items = Array.isArray(eventMemory.small_summaries) ? eventMemory.small_summaries : [];
    const cursor = Math.max(0, Math.min(items.length, parseInt(eventMemory.big_summary_cursor) || 0));
    const editor = (item, isNew) => `<div class="we-memory-editor">
      <div class="we-memory-form-grid"><div class="we-input-group"><label>起始楼层</label><input class="we-memory-small-start" type="number" min="0" value="${h(String(item.startLayer ?? 0))}"></div><div class="we-input-group"><label>结束楼层</label><input class="we-memory-small-end" type="number" min="0" value="${h(String(item.endLayer ?? 0))}"></div></div>
      <div class="we-input-group"><label>纪要内容</label><textarea class="we-memory-small-content" rows="6">${h(item.content || '')}</textarea><div class="we-hint">API 以 50–200 字为目标，超出时仍完整保留；手动新增的纪要只会追加为未整理，不会改动已有总述。</div></div>
      <div class="we-memory-editor-actions"><button class="we-btn we-memory-cancel-edit" type="button">取消</button><button class="we-btn we-btn-primary we-memory-save-small" data-new="${isNew ? 'true' : 'false'}" type="button">保存</button></div>
    </div>`;
    const draft = _memoryEditingSmall === '__new__'
      ? `<div class="we-memory-record we-memory-record-new" data-small-id="__new__">${editor({ startLayer: eventMemory.small_summary_layer ?? 0, endLayer: eventMemory.small_summary_layer ?? 0, content: '' }, true)}</div>` : '';
    const cards = items.map((item, index) => `<div class="we-memory-record" data-small-id="${h(item.id)}">
      <div class="we-memory-record-head"><div><div class="we-memory-record-title">楼层 ${h(String(item.startLayer))}–${h(String(item.endLayer))}</div><div class="we-memory-record-meta">${index < cursor ? '已归入总述' : '等待归档'} · ${h(item.id)}</div></div>
        <div class="we-memory-record-actions"><button class="we-icon-btn we-memory-edit-small" type="button" title="修改"><i class="fa-solid fa-pen"></i></button><button class="we-icon-btn we-memory-delete-small" type="button" title="删除"><i class="fa-solid fa-trash"></i></button></div>
      </div>
      ${_memoryEditingSmall === item.id ? editor(item, false) : `<div class="we-memory-summary-text">${h(item.content || '（内容为空）')}</div>`}
    </div>`).join('');
    return `<div class="we-memory-page-actions"><button class="we-btn we-btn-primary" id="we-memory-add-small" type="button"><i class="fa-solid fa-plus"></i> 新增纪要</button></div>${draft}${cards || '<div class="we-empty">尚未生成纪要，可手动新增。</div>'}`;
  }

  function renderMemoryOverview(state) {
    const items = Array.isArray(state.event_memory?.big_summaries) ? state.event_memory.big_summaries : [];
    const editor = (big, isNew) => `<div class="we-memory-editor">
      <div class="we-memory-form-grid"><div class="we-input-group"><label>起始楼层</label><input class="we-memory-big-start" type="number" min="0" value="${h(String(big.startLayer ?? 0))}"></div><div class="we-input-group"><label>结束楼层</label><input class="we-memory-big-end" type="number" min="0" value="${h(String(big.endLayer ?? 0))}"></div></div>
      <div class="we-input-group"><label>总述内容</label><textarea class="we-memory-big-content" rows="10">${h(big.content || '')}</textarea><div class="we-hint">API 以 500–2000 字为目标，超出时仍完整保留；删除总述不会回退纪要整理游标。</div></div>
      <div class="we-memory-editor-actions"><button class="we-btn we-memory-cancel-edit" type="button">取消</button><button class="we-btn we-btn-primary we-memory-save-big" data-new="${isNew ? 'true' : 'false'}" type="button">保存</button></div>
    </div>`;
    const draft = _memoryEditingBig === '__new__'
      ? `<div class="we-memory-record we-memory-record-new" data-big-id="__new__">${editor({ startLayer: 0, endLayer: 0, content: '' }, true)}</div>` : '';
    const cards = items.map((big, index) => `<div class="we-memory-record we-memory-overview-record" data-big-id="${h(big.id)}">
      <div class="we-memory-record-head"><div><div class="we-memory-record-title">总述 ${index + 1}</div><div class="we-memory-record-meta">楼层 ${h(String(big.startLayer))}–${h(String(big.endLayer))} · ${h(big.id)}</div></div>
        <div class="we-memory-record-actions"><button class="we-icon-btn we-memory-edit-big" type="button" title="修改"><i class="fa-solid fa-pen"></i></button><button class="we-icon-btn we-memory-delete-big" type="button" title="删除"><i class="fa-solid fa-trash"></i></button></div>
      </div>
      ${_memoryEditingBig === big.id ? editor(big, false) : `<div class="we-memory-summary-text">${h(big.content || '（内容为空）')}</div>`}
    </div>`).join('');
    return `<div class="we-memory-page-actions"><button class="we-btn we-btn-primary" id="we-memory-add-big" type="button"><i class="fa-solid fa-plus"></i> 新增总述</button></div>${draft}${cards || '<div class="we-empty">尚未生成总述，可手动新增。</div>'}`;
  }

  function renderMemorySubView(view) {
    const state = window.MEMORY_ENGINE_DATA?.loadState?.() || {};
    const meta = MEMORY_VIEW_META[view] || { title: view, poem: '' };
    const content = view === 'people' ? renderMemoryPeople(state)
      : view === 'entities' ? renderMemoryEntities(state)
      : view === 'minutes' ? renderMemoryMinutes(state)
      : renderMemoryOverview(state);
    return `<div class="we-sub-topbar"><button class="we-icon-btn" id="we-memory-btn-back" type="button" title="返回"><i class="fa-solid fa-arrow-left"></i></button><span class="we-sub-title">${meta.title}</span><span class="we-memory-sub-poem">${meta.poem}</span></div><div class="we-memory-subview">${content}</div>`;
  }

  function clearMemoryEditing() {
    _memoryEditingPerson = null;
    _memoryEditingEntity = null;
    _memoryEditingSmall = null;
    _memoryEditingBig = null;
  }

  function nextMemoryUiId(items, prefix) {
    const pattern = new RegExp(`^${prefix}_(\\d+)$`);
    const max = (items || []).reduce((number, item) => {
      const match = pattern.exec(String(item?.id || ''));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `${prefix}_${String(max + 1).padStart(6, '0')}`;
  }

  function saveEditedMemoryState(state, message, afterRepair) {
    if (window.MEMORY_ENGINE?.isRunning?.()) {
      showToast('记忆任务运行中，暂不能修改数据', true);
      return false;
    }
    const previousState = window.MEMORY_ENGINE_DATA?.loadState?.();
    window.MEMORY_ENGINE?.repairStateIndexes?.(state, previousState);
    if (typeof afterRepair === 'function') afterRepair(state);
    window.MEMORY_ENGINE?.commitManualState?.(state, previousState);
    window.MEMORY_ENGINE_DATA?.saveState?.(state);
    window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.afterEvolution?.();
    window.MEMORY_ENGINE?.applyInjection?.();
    showToast(message || '记忆数据已保存');
    return true;
  }

  function readMemoryEntryRows(editor) {
    return Array.from(editor?.querySelectorAll?.('[data-memory-entry-row]') || []).map(row => ({
      time: String(row.querySelector('.we-memory-entry-time')?.value || '').trim(),
      content: String(row.querySelector('.we-memory-entry-content')?.value || '').trim(),
      known_by: Array.from(new Set(String(row.querySelector('.we-memory-entry-known-by')?.value || '')
        .split(/[\/／,，\n]/).map(value => value.trim()).filter(Boolean)))
    })).filter(entry => entry.content);
  }

  function bindMemoryView() {
    const back = document.getElementById('we-memory-btn-back');
    if (back) back.onclick = () => { clearMemoryEditing(); _memoryView = 'home'; _memorySelectedNavView = null; refresh(); };
    const settingsBack = document.getElementById('we-memory-settings-back');
    if (settingsBack) settingsBack.onclick = () => { _memorySettingsOpen = false; clearMemoryEditing(); refresh(); };

    document.querySelectorAll('.we-memory-nav-row[data-memory-view]').forEach(row => {
      row.onclick = () => {
        const view = row.dataset.memoryView;
        if (_memorySelectedNavView === view) {
          _memorySelectedNavView = null;
          _memoryView = view;
        } else {
          _memorySelectedNavView = view;
        }
        refresh();
      };
    });

    const addPerson = document.getElementById('we-memory-add-person');
    if (addPerson) addPerson.onclick = () => { clearMemoryEditing(); _memoryEditingPerson = '__new__'; refresh(); };
    document.querySelectorAll('.we-memory-edit-person').forEach(button => {
      button.onclick = () => { clearMemoryEditing(); _memoryEditingPerson = button.closest('[data-person-id]')?.dataset.personId || null; refresh(); };
    });
    document.querySelectorAll('.we-memory-delete-person').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-person-id]')?.dataset.personId;
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        const person = state?.personal_memory?.find(item => item.id === id);
        if (!person || !confirm(`删除人物“${person.names?.[0] || id}”及其全部记忆？`)) return;
        state.personal_memory = state.personal_memory.filter(item => item.id !== id);
        if (saveEditedMemoryState(state, '人物已删除')) { clearMemoryEditing(); refresh(); }
      };
    });
    document.querySelectorAll('.we-memory-save-person').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('[data-person-editor]');
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        if (!editor || !state) return;
        const names = Array.from(new Set(String(editor.querySelector('.we-memory-person-names')?.value || '')
          .split(/[\/／,，\n]/).map(value => value.trim()).filter(Boolean)));
        if (!names.length) { showToast('人物至少需要一个姓名', true); return; }
        const id = editor.dataset.new === 'true'
          ? nextMemoryUiId(state.personal_memory, 'char') : editor.dataset.personId;
        const duplicated = state.personal_memory.some(item => item.id !== id && (item.names || []).some(name =>
          names.some(candidate => candidate.toLocaleLowerCase() === String(name).trim().toLocaleLowerCase())
        ));
        if (duplicated) { showToast('姓名或别名已被其他人物使用', true); return; }
        const entries = readMemoryEntryRows(editor);
        if (entries.some(entry => Array.from(entry.content).length > 50)) { showToast('单条人物记忆不能超过 50 字', true); return; }
        const memory = {};
        for (const entry of entries) {
          if (!Array.isArray(memory[entry.time])) memory[entry.time] = [];
          if (!memory[entry.time].includes(entry.content)) memory[entry.time].push(entry.content);
        }
        const person = { id, names, memory };
        const index = state.personal_memory.findIndex(item => item.id === id);
        if (index >= 0) state.personal_memory[index] = person; else state.personal_memory.push(person);
        if (saveEditedMemoryState(state, '人物记忆已保存', repaired =>
          window.MEMORY_ENGINE?.replaceKnownByRecords?.(repaired, id, entries.map(entry => ({
            time: entry.time, memory: entry.content, known_by: entry.known_by
          })))
        )) { clearMemoryEditing(); refresh(); }
      };
    });

    const addEntity = document.getElementById('we-memory-add-entity');
    if (addEntity) addEntity.onclick = () => { clearMemoryEditing(); _memoryEditingEntity = '__new__'; refresh(); };
    document.querySelectorAll('.we-memory-edit-entity').forEach(button => {
      button.onclick = () => {
        const card = button.closest('[data-entity-id]');
        clearMemoryEditing();
        _memoryEditingEntity = card ? `${card.dataset.entityType}:${card.dataset.entityId}` : null;
        refresh();
      };
    });
    document.querySelectorAll('.we-memory-delete-entity').forEach(button => {
      button.onclick = () => {
        const card = button.closest('[data-entity-id]'), type = card?.dataset.entityType, id = card?.dataset.entityId;
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        const entity = state?.entity_memory?.[type]?.find(item => item.id === id);
        if (!entity || !confirm(`删除${MEMORY_ENTITY_LABELS[type] || '实体'}“${entity.name || id}”及其全部历史？`)) return;
        state.entity_memory[type] = state.entity_memory[type].filter(item => item.id !== id);
        if (saveEditedMemoryState(state, '实体已删除')) { clearMemoryEditing(); refresh(); }
      };
    });
    document.querySelectorAll('.we-memory-save-entity').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('[data-entity-editor]');
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        if (!editor || !state) return;
        const oldType = editor.dataset.originalType;
        const type = editor.querySelector('.we-memory-entity-type')?.value;
        const name = String(editor.querySelector('.we-memory-entity-name')?.value || '').trim();
        if (!MEMORY_ENTITY_LABELS[type] || !name) { showToast('请选择类型并填写实体名称', true); return; }
        const oldId = editor.dataset.entityId;
        const duplicate = (state.entity_memory?.[type] || []).some(item => item.id !== oldId && String(item.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase());
        if (duplicate) { showToast('同类型下已存在同名实体', true); return; }
        const prefix = { organization: 'org', object: 'obj', ability: 'ability', location: 'location' }[type];
        let id = oldId;
        if (editor.dataset.new === 'true' || oldType !== type) id = nextMemoryUiId(state.entity_memory?.[type], prefix);
        const entity = {
          id, name,
          description: String(editor.querySelector('.we-memory-entity-description')?.value || '').trim(),
          history: readMemoryEntryRows(editor).map(entry => ({ time: entry.time, event: entry.content }))
        };
        if (editor.dataset.new !== 'true') state.entity_memory[oldType] = state.entity_memory[oldType].filter(item => item.id !== oldId);
        state.entity_memory[type].push(entity);
        if (saveEditedMemoryState(state, '实体记忆已保存')) { clearMemoryEditing(); refresh(); }
      };
    });

    document.querySelectorAll('.we-memory-add-entry').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-memory-editor');
        const list = editor?.querySelector('.we-memory-entry-list');
        if (!list) return;
        list.querySelector('.we-memory-entry-empty')?.remove();
        list.insertAdjacentHTML('beforeend', renderMemoryEntryRow('', '', button.dataset.entryKind));
        bindMemoryEntryRemoveButtons(list);
      };
    });
    bindMemoryEntryRemoveButtons(panelBodyElement);
    document.querySelectorAll('.we-memory-cancel-edit').forEach(button => {
      button.onclick = () => { clearMemoryEditing(); refresh(); };
    });

    const addSmall = document.getElementById('we-memory-add-small');
    if (addSmall) addSmall.onclick = () => { clearMemoryEditing(); _memoryEditingSmall = '__new__'; refresh(); };
    document.querySelectorAll('.we-memory-edit-small').forEach(button => {
      button.onclick = () => { clearMemoryEditing(); _memoryEditingSmall = button.closest('[data-small-id]')?.dataset.smallId || null; refresh(); };
    });
    document.querySelectorAll('.we-memory-delete-small').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-small-id]')?.dataset.smallId;
        const state = window.MEMORY_ENGINE_DATA?.loadState?.(), items = state?.event_memory?.small_summaries || [];
        const index = items.findIndex(item => item.id === id);
        if (index < 0 || !confirm(`删除这条纪要？${index < (parseInt(state.event_memory.big_summary_cursor) || 0) ? '它已归入总述，现有总述内容不会自动更新。' : ''}`)) return;
        items.splice(index, 1);
        if (index < (parseInt(state.event_memory.big_summary_cursor) || 0)) state.event_memory.big_summary_cursor--;
        if (saveEditedMemoryState(state, '纪要已删除')) { clearMemoryEditing(); refresh(); }
      };
    });
    document.querySelectorAll('.we-memory-save-small').forEach(button => {
      button.onclick = () => {
        const card = button.closest('[data-small-id]'), id = card?.dataset.smallId;
        const content = String(card?.querySelector('.we-memory-small-content')?.value || '').trim();
        const startLayer = Math.max(0, parseInt(card?.querySelector('.we-memory-small-start')?.value) || 0);
        const endLayer = Math.max(startLayer, parseInt(card?.querySelector('.we-memory-small-end')?.value) || startLayer);
        if (!content) { showToast('纪要内容不能为空', true); return; }
        const state = window.MEMORY_ENGINE_DATA?.loadState?.(), items = state?.event_memory?.small_summaries || [];
        if (button.dataset.new === 'true') {
          items.push({ id: nextMemoryUiId(items, 'small'), startLayer, endLayer, content });
          if (saveEditedMemoryState(state, '纪要已新增')) { clearMemoryEditing(); refresh(); }
          return;
        }
        const index = items.findIndex(item => item.id === id);
        if (index < 0) return;
        items[index] = { ...items[index], startLayer, endLayer, content };
        if (saveEditedMemoryState(state, '纪要已修改')) { clearMemoryEditing(); refresh(); }
      };
    });
    const addBig = document.getElementById('we-memory-add-big');
    if (addBig) addBig.onclick = () => { clearMemoryEditing(); _memoryEditingBig = '__new__'; refresh(); };
    document.querySelectorAll('.we-memory-edit-big').forEach(button => {
      button.onclick = () => { clearMemoryEditing(); _memoryEditingBig = button.closest('[data-big-id]')?.dataset.bigId || null; refresh(); };
    });
    document.querySelectorAll('.we-memory-delete-big').forEach(button => {
      button.onclick = () => {
        const id = button.closest('[data-big-id]')?.dataset.bigId;
        const state = window.MEMORY_ENGINE_DATA?.loadState?.(), items = state?.event_memory?.big_summaries || [];
        const index = items.findIndex(item => item.id === id);
        if (index < 0 || !confirm('删除这条总述？对应纪要仍会保持“已整理”，系统不会自动重新生成它。')) return;
        items.splice(index, 1);
        if (saveEditedMemoryState(state, '总述已删除')) { clearMemoryEditing(); refresh(); }
      };
    });
    document.querySelectorAll('.we-memory-save-big').forEach(button => {
      button.onclick = () => {
        const card = button.closest('[data-big-id]'), id = card?.dataset.bigId;
        const content = String(card?.querySelector('.we-memory-big-content')?.value || '').trim();
        const startLayer = Math.max(0, parseInt(card?.querySelector('.we-memory-big-start')?.value) || 0);
        const endLayer = Math.max(startLayer, parseInt(card?.querySelector('.we-memory-big-end')?.value) || startLayer);
        if (!content) { showToast('总述内容不能为空', true); return; }
        const state = window.MEMORY_ENGINE_DATA?.loadState?.();
        const items = state?.event_memory?.big_summaries || [];
        if (button.dataset.new === 'true') {
          items.push({ id: nextMemoryUiId(items, 'big'), startLayer, endLayer, content });
          if (saveEditedMemoryState(state, '总述已新增')) { clearMemoryEditing(); refresh(); }
          return;
        }
        const item = state?.event_memory?.big_summaries?.find(big => big.id === id);
        if (!item) return;
        Object.assign(item, { startLayer, endLayer, content });
        if (saveEditedMemoryState(state, '总述已修改')) { clearMemoryEditing(); refresh(); }
      };
    });
  }

  function bindMemoryEntryRemoveButtons(root) {
    root?.querySelectorAll?.('.we-memory-remove-entry').forEach(button => {
      button.onclick = () => button.closest('[data-memory-entry-row]')?.remove();
    });
  }

  const MEMORY_SETTINGS_TABS = [
    { key: 'common', label: '常用' },
    { key: 'link', label: '联动' },
    { key: 'advanced', label: '高级' },
    { key: 'archive', label: '存档' },
    { key: 'worldbook', label: '世界书' },
    { key: 'debug', label: '调试' },
    { key: 'about', label: '关于' }
  ];

  function renderMemoryDebug() {
    const engine = window.MEMORY_ENGINE;
    const dbg = engine?.getLastDebug?.() || null;
    const sentPrompt = typeof dbg?.prompt === 'string' ? dbg.prompt
      : (typeof dbg?.requestPrompt === 'string' ? dbg.requestPrompt : '');
    const apiResult = typeof dbg?.rawResult === 'string' ? dbg.rawResult
      : (typeof dbg?.apiResponse === 'string' ? dbg.apiResponse
        : (typeof dbg?.response === 'string' ? dbg.response : ''));
    const card = (title, meta, content, emptyText) => {
      const hasContent = content !== null && content !== undefined && content !== '';
      const shown = typeof content === 'string' ? content : (hasContent ? JSON.stringify(content, null, 2) : '');
      return '<div class="we-prompt-seg-card">'
        + '<div class="we-prompt-seg-head" data-we-seg-toggle>'
        + '<span class="we-prompt-seg-arrow">▶</span>'
        + '<span class="we-prompt-seg-label">' + h(title) + '</span>'
        + '<span class="we-prompt-seg-meta">' + h(meta || (hasContent ? shown.length + '字' : '暂无')) + '</span>'
        + '</div>'
        + '<div class="we-prompt-seg-body" style="display:none;">'
        + (hasContent ? '<pre class="we-prompt-seg-pre">' + h(shown) + '</pre>' : '<div class="we-prompt-seg-empty">' + h(emptyText) + '</div>')
        + '</div></div>';
    };
    return '<div class="we-prompt-debug">'
      + '<div class="we-prompt-debug-summary">只显示最近一次实际运行记录；内置记忆 Prompt 不在设置中展示，也不开放修改。</div>'
      + renderInjectInspector('memory')
      + card('发送给记忆后台 API 的实际 Prompt', sentPrompt ? sentPrompt.length + '字' : '暂无', sentPrompt, '执行人物实体与纪要提取或生成总述后，显示本次真正发送的完整 Prompt。')
      + card('记忆后台 API 原始返回', apiResult ? apiResult.length + '字' : '暂无', apiResult, '执行记忆提取后显示后台 API 的原始返回。')
      + '<div style="display:flex;gap:6px;margin-top:8px;"><button class="we-btn" id="we-memory-export-prompt" style="flex:1;">导出完整 Prompt</button><button class="we-btn" id="we-memory-export-raw-result" style="flex:1;">导出 API 返回</button></div>'
      + '</div>';
  }

  function renderMemoryCheckpointSection() {
    const data = window.MEMORY_ENGINE_DATA;
    const checkpoint = data?.loadCheckpoint?.() || null;
    const count = Array.isArray(checkpoint?.personal_memory) ? checkpoint.personal_memory.length : 0;
    const entityCount = ['organization', 'object', 'ability', 'location']
      .reduce((sum, type) => sum + (Array.isArray(checkpoint?.entity_memory?.[type]) ? checkpoint.entity_memory[type].length : 0), 0);
    const smallSummaryCount = Array.isArray(checkpoint?.event_memory?.small_summaries)
      ? checkpoint.event_memory.small_summaries.length : 0;
    const bigSummaries = Array.isArray(checkpoint?.event_memory?.big_summaries) ? checkpoint.event_memory.big_summaries : [];
    const bigSummaryContent = bigSummaries.length
      ? '<div class="we-chatcache-list">' + bigSummaries.map(item =>
          '<div class="we-prompt-seg-card"><div class="we-prompt-seg-head"><span class="we-prompt-seg-label">楼层 '
          + h(item.startLayer) + '-' + h(item.endLayer) + '</span></div><div class="we-prompt-seg-body" style="display:block;"><pre class="we-prompt-seg-pre">'
          + h(item.content) + '</pre></div></div>'
        ).join('') + '</div>'
      : '<div class="we-empty">暂无总述</div>';
    const smallSummaryContent = smallSummaryCount
      ? '<div class="we-chatcache-list">' + checkpoint.event_memory.small_summaries.map(item =>
          '<div class="we-prompt-seg-card"><div class="we-prompt-seg-head"><span class="we-prompt-seg-label">楼层 '
          + h(item.startLayer) + '-' + h(item.endLayer) + '</span></div><div class="we-prompt-seg-body" style="display:block;"><pre class="we-prompt-seg-pre">'
          + h(item.content) + '</pre></div></div>'
        ).join('') + '</div>'
      : '<div class="we-empty">暂无纪要</div>';
    const content = checkpoint
      ? '<div class="we-hint">包含 ' + count + ' 个人物、' + entityCount + ' 个世界实体、' + smallSummaryCount + ' 条纪要和 ' + bigSummaries.length + ' 条总述</div>'
        + '<div class="we-section" style="margin-top:10px;"><div class="we-section-title">' + sectionHeader('总述 · ' + bigSummaries.length + ' 条', 'memory-checkpoint-big-summary') + '</div>' + sectionBody('memory-checkpoint-big-summary', bigSummaryContent) + '</div>'
        + '<div class="we-section" style="margin-top:10px;"><div class="we-section-title">' + sectionHeader('纪要 · ' + smallSummaryCount + ' 条', 'memory-checkpoint-small-summaries') + '</div>' + sectionBody('memory-checkpoint-small-summaries', smallSummaryContent) + '</div>'
        + '<div class="we-section" style="margin-top:10px;"><div class="we-section-title">' + sectionHeader('完整 JSON', 'memory-checkpoint-json') + '</div>' + sectionBody('memory-checkpoint-json', '<pre class="we-prompt-seg-pre">' + h(JSON.stringify(checkpoint, null, 2)) + '</pre>') + '</div>'
      : '<div class="we-empty">暂无存档点</div>';
    return '<div class="we-section" style="margin-top:16px;"><div class="we-section-title">'
      + sectionHeader(checkpoint ? '存档点 - ' + count + ' 人物 / ' + entityCount + ' 实体' : '存档点', 'memory-checkpoint-section')
      + '</div>' + sectionBody('memory-checkpoint-section', content) + '</div>';
  }

  function renderMemorySnapshotRows() {
    const list = window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.listSnapshots?.() || [];
    if (!list.length) return '<div class="we-empty">暂无记忆存档</div>';
    return list.map(item => {
      let time = '';
      try { time = new Date(item.createdAt).toLocaleString(); } catch (error) {}
      const count = Number(item.characters) || 0;
      const entityCount = Number(item.entities) || 0;
      return '<div class="we-snapshot-row" data-memory-snap-id="' + u(item.id) + '">'
        + '<div class="we-snapshot-main"><div class="we-snapshot-name"><span class="we-snapshot-badge' + (item.auto ? ' is-auto' : '') + '">' + (item.auto ? '自动' : '手动') + '</span>' + h(item.name) + '</div>'
        + '<div class="we-snapshot-meta">第 ' + (item.round || 0) + ' 轮 · ' + count + ' 个人物 · ' + entityCount + ' 个实体' + (time ? ' · ' + h(time) : '') + '</div></div>'
        + '<div class="we-snapshot-actions">'
        + '<button class="we-icon-btn" data-memory-snap-action="restore" title="恢复"><i class="fa-solid fa-rotate-left"></i></button>'
        + '<button class="we-icon-btn" data-memory-snap-action="rename" title="重命名"><i class="fa-solid fa-pen"></i></button>'
        + '<button class="we-icon-btn" data-memory-snap-action="export" title="导出"><i class="fa-solid fa-download"></i></button>'
        + '<button class="we-icon-btn" data-memory-snap-action="delete" title="删除"><i class="fa-solid fa-trash"></i></button>'
        + '</div></div>';
    }).join('');
  }

  function bindFilterControls(scope) {
    const memoryScope = scope === 'memory';
    const id = suffix => memoryScope ? 'we-memory-' + suffix : 'we-' + suffix;
    const textarea = document.getElementById(id('filter-regex'));
    if (!textarea) return;
    const tagsBox = document.getElementById(id('filter-tags'));
    const addInput = document.getElementById(id('filter-add-input'));
    const SIMPLE = /^<([a-zA-Z_][\w-]*)>[\s\S]*?<\/\1>(?:\\n\?)?$/;
    const SCAN = /<([a-zA-Z_][\w-]*)/g;
    let tags = [];

    function parse(raw) {
      const selected = [], advanced = [];
      for (const line of String(raw || '').split('\n')) {
        const match = line.match(SIMPLE);
        if (match) { if (!selected.includes(match[1])) selected.push(match[1]); }
        else if (line.trim()) advanced.push(line);
      }
      return { selected, advanced };
    }
    function syncTextarea() {
      const advanced = parse(textarea.value).advanced;
      const generated = tags.filter(item => item.checked).map(item => `<${item.name}>[\\s\\S]*?</${item.name}>\\n?`);
      textarea.value = generated.concat(advanced).join('\n');
    }
    function renderTags() {
      if (!tagsBox) return;
      tagsBox.innerHTML = '';
      for (const item of tags) {
        const chip = document.createElement('label');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border:1px solid var(--we-border,#3a3a3a);border-radius:3px;font-size:12px;cursor:pointer;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = item.checked;
        checkbox.onchange = () => { item.checked = checkbox.checked; syncTextarea(); };
        const name = document.createElement('span'); name.textContent = item.name;
        const remove = document.createElement('span');
        remove.textContent = '✕'; remove.style.cssText = 'color:var(--we-text3);cursor:pointer;margin-left:2px;';
        remove.onclick = event => { event.preventDefault(); tags = tags.filter(entry => entry.name !== item.name); renderTags(); syncTextarea(); };
        chip.append(checkbox, name, remove); tagsBox.appendChild(chip);
      }
    }
    function syncTags() {
      const selected = parse(textarea.value).selected;
      const set = new Set(selected);
      tags.forEach(item => { item.checked = set.has(item.name); });
      selected.forEach(name => { if (!tags.some(item => item.name === name)) tags.push({ name, checked: true }); });
      renderTags();
    }
    function addTag(name) {
      name = String(name || '').trim();
      if (!name) return;
      if (!/^[a-zA-Z_][\w-]*$/.test(name)) { showToast('标签名无效（只允许字母数字下划线连字符）', true); return; }
      if (!tags.some(item => item.name === name)) tags.push({ name, checked: true });
      if (addInput) addInput.value = '';
      renderTags(); syncTextarea();
    }
    document.getElementById(id('btn-filter-add'))?.addEventListener('click', () => addTag(addInput?.value));
    addInput?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTag(addInput.value); } });
    document.getElementById(id('btn-filter-scan'))?.addEventListener('click', () => {
      let text = '';
      try {
        const chat = SillyTavern.getContext()?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) if (chat[i] && !chat[i].is_user && String(chat[i].mes || '').trim()) { text = String(chat[i].mes); break; }
      } catch (error) {}
      if (!text) { showToast('未找到 AI 回复', true); return; }
      const found = []; let match; SCAN.lastIndex = 0;
      while ((match = SCAN.exec(text)) !== null) if (!found.includes(match[1])) found.push(match[1]);
      if (!found.length) { showToast('最新 AI 回复里没发现标签', true); return; }
      found.forEach(name => { if (!tags.some(item => item.name === name)) tags.push({ name, checked: true }); });
      renderTags(); syncTextarea(); showToast(`扫描到 ${found.length} 个标签`);
    });
    document.getElementById(id('btn-filter-test'))?.addEventListener('click', () => {
      const core = window.WORLD_ENGINE_CORE;
      const status = document.getElementById(id('filter-status'));
      if (!textarea.value.trim()) { showToast('未填写正则', true); if (status) status.textContent = '（未填写正则）'; return; }
      const validated = core?.validateFilterRegex?.(textarea.value);
      if (!validated) { showToast('core 模块不可用', true); return; }
      if (validated.bad.length) {
        if (status) status.textContent = `测试中止——⚠️ ${validated.ok} 条生效 / ${validated.bad.length} 条失败：\n` + validated.bad.map(item => `行 ${item.line}「${item.raw}」无效：${item.reason}`).join('\n');
        showToast(`有 ${validated.bad.length} 条正则无效，请先修正`, true); return;
      }
      let sample = '';
      try {
        const chat = SillyTavern.getContext()?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) if (String(chat[i]?.mes || '').trim()) { sample = String(chat[i].mes); break; }
      } catch (error) {}
      if (!sample) { showToast('当前聊天没有可测试的文本', true); return; }
      let work = sample, removed = 0;
      for (const entry of validated.entries) {
        const regex = new RegExp(entry.pattern, entry.flags); let match, count = 0;
        while ((match = regex.exec(work)) !== null) { count++; if (match.index === regex.lastIndex) regex.lastIndex++; }
        work = work.replace(regex, ''); removed += count;
      }
      if (status) status.textContent = `已删除 ${removed} 处。\n前: ${sample.slice(0, 60)}${sample.length > 60 ? '…' : ''}\n后: ${work.slice(0, 60)}${work.length > 60 ? '…' : ''}`;
      showToast(`已删除 ${removed} 处`);
    });
    let timer;
    textarea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(syncTags, 300); });
    syncTags();
  }

  function renderMemorySettingsView() {
    const settings = window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {};
    const extra = renderSettingsAfterCheckpoint({ scope: 'memory' });
    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>'
      + sectionBody(id, body) + '</div>';
    const mode = settings.evolveMode === 'manual' ? 'manual' : 'auto';
    const bigSummaryEveryX = Math.max(1, parseInt(settings.bigSummaryEveryX) || 5);
    const bigSummaryInjectLimit = Math.max(1, parseInt(settings.bigSummaryInjectLimit) || 3);
    const worldEngineMemoryLimit = Math.max(1, parseInt(settings.worldEngineMemoryLimit) || 5);
    const searchDepth = Math.max(1, parseInt(settings.searchDepth) || 5);
    const maxPerCharacter = Math.max(1, parseInt(settings.maxPerCharacter) || 20);
    const backfillBatch = Math.max(1, parseInt(settings.backfillBatchSize) || 5);
    const backfillEnd = Math.max(0, parseInt(settings.backfillEndLayer) || 0);
    const backfillRetries = Math.max(0, parseInt(settings.backfillRetries) || 0);
    const summaryBackfillSmallEveryX = Math.max(1, parseInt(settings.summaryBackfillSmallEveryX) || 5);
    const summaryBackfillBigEveryX = Math.max(1, parseInt(settings.summaryBackfillBigEveryX) || 5);
    const apiTemperature = Number.isFinite(Number(settings.temperature)) ? Math.max(0, Number(settings.temperature)) : 0.2;
    const apiMaxTokens = Math.max(1, parseInt(settings.maxTokens) || 2000);
    const apiTimeoutSec = Math.max(0, Math.round((Number(settings.apiTimeoutMs) || 120000) / 1000));

    const apiBody = `
      <div class="we-input-group">
        <label>连接方式</label>
        <select id="we-connection-mode" style="width:100%;">
          <option value="direct" ${settings.connectionMode !== 'proxy' ? 'selected' : ''}>直连（默认）</option>
          <option value="proxy" ${settings.connectionMode === 'proxy' ? 'selected' : ''}>经酒馆代理（解决跨域 CORS）</option>
        </select>
      </div>
      <div class="we-input-group">
        <label>记忆引擎 API URL（OpenAI 兼容）</label>
        <input type="text" id="we-api-url" value="${u(settings.apiUrl || '')}" placeholder="https://api.openai.com/v1">
      </div>
      <div class="we-input-group">
        <label>记忆引擎 API Key</label>
        <input type="password" id="we-api-key" value="${u(settings.apiKey || '')}">
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;align-items:end;">
        <div style="flex:1;">
          <label>模型</label>
          <input type="text" id="we-model" value="${u(settings.model || 'gpt-3.5-turbo')}" placeholder="模型名称" style="width:100%;">
        </div>
        <button class="we-btn" id="we-fetch-models" style="white-space:nowrap;flex-shrink:0;">获取列表</button>
      </div>
      <div class="we-input-group">
        <select id="we-model-list" style="display:none;width:100%;margin-top:4px;"><option value="">-- 选择模型 --</option></select>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;">
        <div style="flex:1;"><label>温度</label><input type="number" id="we-temperature" min="0" step="0.1" value="${apiTemperature}" style="width:100%;"></div>
        <div style="flex:1;"><label>最大输出 token</label><input type="number" id="we-max-tokens" min="1" step="1" value="${apiMaxTokens}" style="width:100%;"></div>
      </div>
      <div class="we-input-group">
        <label>请求超时（秒）</label>
        <input type="number" id="we-api-timeout-sec" min="0" step="1" value="${apiTimeoutSec}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">此处只配置记忆引擎；请求实现与世界引擎共用，但配置值互不覆盖。</div>
      </div>`;

    const modeBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-engine-enabled" ${settings.engineEnabled !== false ? 'checked' : ''}>
          启用记忆引擎
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">关闭后停止记忆提取与记忆注入，不影响世界引擎。</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-first-layer-ai-opening" ${settings.firstLayerIsAiOpening !== false ? 'checked' : ''}>
          首楼为 AI 开场白
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">默认勾选：第 0 层不参与人物/实体提取、纪要和批量重填；取消勾选后，第 0 层按普通对话参与处理。</div>
      </div>
      <div class="we-input-group">
        <label>记忆推演模式</label>
        <select id="we-memory-evolve-mode" style="width:100%;">
          <option value="auto" ${mode === 'auto' ? 'selected' : ''}>自动 · 每轮提取</option>
          <option value="manual" ${mode === 'manual' ? 'selected' : ''}>手动（仅手动触发记忆推演）</option>
        </select>
      </div>
      <div style="font-size:11px;color:var(--we-text3);margin-bottom:8px;">人物、实体和纪要固定以一轮为单位处理，并合并为一次 API 请求。重 Roll 不计入新轮次。</div>
      <div class="we-input-group">
        <label>总述整理</label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">每轮生成一条 50–200 字的纪要；每累计 X 条尚未整理的纪要，独立生成一条 500–2000 字的总述，历史总述不会被覆盖。</div>
      </div>
      <div class="we-input-group">
        <label>总述间隔轮数（X）</label>
        <input type="number" id="we-memory-big-summary-every" min="1" step="1" value="${bigSummaryEveryX}" style="width:100%;">
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn we-btn-primary" id="we-memory-run-now" type="button"><i class="fa-solid fa-brain"></i> 提取本轮记忆</button>
        <button class="we-btn" id="we-memory-big-summary-now" type="button"><i class="fa-solid fa-book-open"></i> 生成总述</button>
      </div>
      <div class="we-hint" id="we-memory-task-status" style="margin-top:8px;">${_memoryRunningLabel ? '正在进行' + h(_memoryRunningLabel) : '当前没有运行中的记忆任务'}</div>`;

    const injectBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-inject" ${settings.injectIntoPrompt !== false ? 'checked' : ''}>
          注入记忆信息
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">注入最新 Y 条总述和尚未整理的纪要；被摘要覆盖的旧正文自动隐藏，但始终保留最近 3 轮完整对话原文；同时扫描最近 N 层正文中的人物及实体名称，按需注入相关人物与实体记忆。</div>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;">
        <div style="flex:1;">
          <label>名称搜寻层数（N）</label>
          <input type="number" id="we-memory-search-depth" min="1" step="1" value="${searchDepth}" style="width:100%;">
        </div>
        <div style="flex:1;">
          <label>每个条目最多注入</label>
          <input type="number" id="we-memory-max-per-character" min="1" step="1" value="${maxPerCharacter}" style="width:100%;">
        </div>
      </div>
      <div class="we-input-group">
        <label>最多注入最新总述数（Y）</label>
        <input type="number" id="we-memory-big-summary-inject-limit" min="1" step="1" value="${bigSummaryInjectLimit}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">只限制总述数量；尚未整理的纪要仍会全部注入。本地与 JSON 中的历史总述不会被删除或截断。</div>
      </div>
      <div style="font-size:11px;color:var(--we-text3);">人物和实体历史使用 1d10000 指数权重抽取：越新的记录越容易入选，最旧记录也保留非零机会。</div>`;

    const linkBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-inject-world-engine" ${settings.injectIntoWorldEngine === true ? 'checked' : ''}>
          向世界引擎提供记忆
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">世界推演时扫描完整世界状态中出现的人名、别名和实体名，仅提供匹配的人物/实体记忆；不会提供纪要或总述。记忆引擎异常不会中断世界推演。</div>
      </div>
      <div class="we-input-group">
        <label>世界推演每个匹配条目最多注入（X）</label>
        <input type="number" id="we-memory-world-engine-limit" min="1" step="1" value="${worldEngineMemoryLimit}" style="width:100%;">
      </div>`;

    const backfillBody = `
      <div style="font-size:11px;color:var(--we-text3);margin-bottom:6px;">两类重填彼此独立：人物/实体重填不会清理纪要与总述；纪要与总述重填不会改写人物与实体。</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>人物实体每批楼层</label>
          <input type="number" id="we-memory-backfill-batch" min="1" step="1" value="${backfillBatch}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>结束楼层（0=全部）</label>
          <input type="number" id="we-memory-backfill-end" min="0" step="1" value="${backfillEnd}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>每批重试次数</label>
          <input type="number" id="we-memory-backfill-retries" min="0" step="1" value="${backfillRetries}"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
        <div class="we-input-group" style="flex:1;min-width:120px;margin-bottom:0;"><label>纪要回填：每 X 个 AI 楼层</label>
          <input type="number" id="we-memory-summary-backfill-small-every" min="1" step="1" value="${summaryBackfillSmallEveryX}"></div>
        <div class="we-input-group" style="flex:1;min-width:120px;margin-bottom:0;"><label>总述回填：每 Y 条纪要</label>
          <input type="number" id="we-memory-summary-backfill-big-every" min="1" step="1" value="${summaryBackfillBigEveryX}"></div>
      </div>
      <div class="we-hint" id="we-memory-person-backfill-status" style="margin:6px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-memory-backfill-start">▶ 重填人物与实体</button>
        <button class="we-btn we-btn-primary" id="we-memory-summary-backfill-start">▶ 重填纪要与总述</button>
        <button class="we-btn" id="we-memory-backfill-stop">■ 停止</button>
      </div>
      <div class="we-hint" id="we-memory-summary-backfill-status" style="margin:6px 0;"></div>`;

    const memoryTheme = getStoredMemoryTheme();
    const memoryThemeOptions = WE_THEMES.map(theme =>
      `<option value="${theme.id}" ${theme.id === memoryTheme ? 'selected' : ''}>${theme.name}</option>`
    ).join('');
    const displayBody = `
      <div class="we-input-group">
        <label>记忆引擎主题配色</label>
        <select id="we-memory-theme-select" style="width:100%;">${memoryThemeOptions}</select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">只影响记忆引擎并独立记忆；切回世界引擎时恢复世界引擎自己的配色。</div>
      </div>`;

    const retryBody = `
      <div class="we-input-group">
        <label>记忆 API 异常自动重试次数</label>
        <input type="number" id="we-memory-api-auto-retries" min="0" step="1" value="${Math.max(0, parseInt(settings.apiAutoRetries) || 0)}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">仅用于记忆提取，不修改世界推演的重试次数。</div>
      </div>`;

    const filterBody = `
      <div class="we-input-group">
        <label>每行一条正则，匹配内容会在喂记忆后台前删除</label>
        <div style="margin-bottom:8px;border:1px solid var(--we-border,#3a3a3a);border-radius:4px;padding:6px;">
          <div style="font-size:12px;color:var(--we-text2);margin-bottom:4px;">简单模式：勾选标签自动生成删除正则</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
            <button class="we-btn" id="we-memory-btn-filter-scan" type="button">🔍 扫描本聊天标签</button>
            <input type="text" id="we-memory-filter-add-input" placeholder="手动加标签名(如 tucao)" style="flex:1;min-width:140px;">
            <button class="we-btn" id="we-memory-btn-filter-add" type="button">+ 添加</button>
          </div>
          <div id="we-memory-filter-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:4px;"></div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">自动生成的正则不一定生效——标签带属性、带 ~、嵌套或闭标签异常时可能匹配失败。不生效请直接编辑下方文本框自行手写。未勾选标签不会保存。</div>
        </div>
        <textarea id="we-memory-filter-regex" rows="4" style="width:100%;resize:vertical;" placeholder="每行一条；支持纯 pattern 或 /pattern/flags 字面量。">${h(settings.filterRegex || '')}</textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px;">
          <button class="we-btn" id="we-memory-btn-filter-test" type="button">▶ 测试正则</button>
        </div>
        <div class="we-hint" id="we-memory-filter-status" style="margin:0 0 4px;white-space:pre-wrap;"></div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">每行一条；支持纯 pattern（默认 g 全局）或 /pattern/flags 字面量；空行忽略。只影响喂记忆后台的文本，不影响聊天正文。</div>
      </div>`;

    const toneBody = `
      <div class="we-input-group">
        <label>记忆引擎附加提示词</label>
        <textarea id="we-memory-tone-prompt" rows="5" style="width:100%;resize:vertical;" placeholder="可选；只附加到本次记忆提取请求">${h(settings.tonePrompt || '')}</textarea>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">这是高级运行设置；不开放内置记忆 Prompt 本体，也不提供 Prompt 预设编辑器。</div>
      </div>`;

    const archiveBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-sync-to-chat" ${settings.syncToChat === true ? 'checked' : ''}>
          跨设备实时同步（存进当前聊天）
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">开启后，本聊天的人物与实体记忆会持续写入酒馆聊天文件并随之跨设备同步；换设备打开同一聊天即可续上进度。<b>不会</b>同步 API Key，也不会读写世界引擎存档。</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-auto-backup" ${settings.autoBackup === true ? 'checked' : ''}>
          自动滚动备份（每当记忆推进存一条，保留最近 3 条）
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">防误删误改。自动备份与命名存档都保存在本聊天里，跨设备可见。</div>
      </div>
      <div class="we-hint" id="we-memory-archive-status" style="margin:4px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-memory-snapshot-save">新建命名存档</button>
        <button class="we-btn" id="we-memory-snapshot-import">导入存档</button>
        <input type="file" id="we-memory-snapshot-import-file" accept=".json,application/json" style="display:none;">
      </div>
      <div class="we-chatcache-list" id="we-memory-snapshot-list">${renderMemorySnapshotRows()}</div>`;

    const dataBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-memory-export-data">导出全部记忆 JSON</button>
        <button class="we-btn" id="we-memory-import-data">导入 JSON</button>
        <input type="file" id="we-memory-import-data-file" accept=".json,application/json" style="display:none;">
      </div>
      <div style="font-size:11px;color:var(--we-text3);margin-top:5px;">完整导出同时包含 <b>state（最新当前数据）</b>和 <b>checkpoint（重新推演前的旧存档点）</b>，两部分分别标注人物、实体、纪要和总述数量；人物记忆逐条保留 known_by。</div>`;

    const memoryVersion = window.MEMORY_ENGINE_SETTINGS?.VERSION || '0.1.0';
    const memoryAboutBody = `
      <div class="we-about-current"><span class="we-changelog-cur">记忆引擎 v${h(memoryVersion)}</span></div>
      <div class="we-section" style="margin-top:10px;">
        <div class="we-section-title">记忆引擎 1.0</div>
        <div style="font-size:12px;color:var(--we-text2);line-height:1.7;">
          面向长篇对话的独立记忆系统。人物记忆保留知情人边界，实体记忆维护组织、物件、能力与地点的当前状态和历史；纪要按新增轮次记录阶段事件，总述再将多条纪要压缩为长期脉络。
        </div>
      </div>
      <div class="we-section" style="margin-top:10px;">
        <div class="we-section-title">v1.0.0 · 正式版本</div>
        <div style="font-size:12px;color:var(--we-text2);line-height:1.7;">
          人物、实体、纪要、总述均可在面板中查看和编辑，并支持完整 JSON 导入导出与独立存档。可选择向世界引擎提供命中人物和实体的最新记忆；该模式不会把纪要或总述重复送入世界推演。
        </div>
      </div>`;

    const memoryWorldbookBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-worldbook-enabled" ${settings.worldbookEnabled === true ? 'checked' : ''}>
          启用记忆推演世界书
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">默认关闭。开启后才会把下方选中的世界书条目作为人物与背景参考；世界书内容不会被直接当作新记忆。</div>
      </div>`;

    const worldbook = String(extra.worldbook || '')
      .replace(/后台推演世界书/g, '记忆推演世界书')
      .replace(/注入推演/g, '注入记忆推演');
    const panelContent = {
      common: sec('set-memory-api', '记忆引擎 API', apiBody)
        + sec('set-memory-evolve', '记忆提取与事件整理', modeBody)
        + sec('set-memory-inject', '记忆信息注入', injectBody),
      link: sec('set-memory-link', '向世界引擎联动', linkBody),
      advanced: sec('set-memory-retry', 'API 自动重试', retryBody)
        + sec('set-memory-backfill', '批量重填记忆推演', backfillBody)
        + sec('set-memory-filter', '输入过滤器', filterBody)
        + sec('set-memory-display', '界面显示', displayBody)
        + sec('set-memory-tone', '附加提示词', toneBody),
      archive: sec('set-memory-archive', '记忆缓存与存档', archiveBody)
        + sec('set-memory-data', '记忆数据导入/导出', dataBody)
        + renderMemoryCheckpointSection(),
      worldbook: sec('set-memory-worldbook-enabled', '世界书总开关', memoryWorldbookBody) + worldbook,
      debug: sec('set-memory-debug', '记忆推演调试', '<button class="we-btn" id="we-memory-export-diag" style="width:100%;margin-bottom:8px;">导出诊断包</button><div id="we-memory-debug-render">' + renderMemoryDebug() + '</div>'),
      about: memoryAboutBody
    };

    if (!MEMORY_SETTINGS_TABS.some(tab => tab.key === _memorySettingsTab)) _memorySettingsTab = 'common';
    const tabBar = '<div class="we-settings-tabs-shell">'
      + '<button class="we-settings-tab-scroll" data-dir="-1" title="向左滚动"><i class="fa-solid fa-chevron-left"></i></button>'
      + '<div class="we-settings-tabs" id="we-settings-tabs">'
      + MEMORY_SETTINGS_TABS.map(tab =>
          '<button class="we-settings-tab' + (tab.key === _memorySettingsTab ? ' we-settings-tab--active' : '')
          + '" data-tab="' + tab.key + '">' + tab.label + '</button>').join('')
      + '</div>'
      + '<button class="we-settings-tab-scroll" data-dir="1" title="向右滚动"><i class="fa-solid fa-chevron-right"></i></button>'
      + '</div>';
    const panels = MEMORY_SETTINGS_TABS.map(tab =>
      '<div class="we-settings-panel" data-tab="' + tab.key + '"'
      + (tab.key === _memorySettingsTab ? '' : ' style="display:none;"') + '>'
      + (panelContent[tab.key] || '') + '</div>').join('');

    return '<div class="we-sub-topbar"><button class="we-icon-btn" id="we-memory-settings-back" type="button" title="返回"><i class="fa-solid fa-arrow-left"></i></button><span class="we-sub-title">设置</span></div>'
      + tabBar + panels
      + '<div class="we-settings-save-actions we-settings-save-sticky">'
      + '<button class="we-btn" id="we-save-memory-settings">保存设置</button>'
      + '</div>';
  }

  function updateEngineFaceChrome() {
    if (!panelElement) return;
    const face = getEngineFace();
    for (const registered of _engineFaceRegistry.values()) {
      if (registered.panelClass) panelElement.classList.remove(registered.panelClass);
    }
    if (face.panelClass) panelElement.classList.add(face.panelClass);
    const title = panelElement.querySelector('.we-engine-face-toggle');
    if (title) {
      const next = getNextEngineFace();
      title.textContent = face.label;
      title.title = '切换到下一界面：' + next.label;
      title.setAttribute('aria-label', title.title);
    }
    const settings = panelElement.querySelector('#we-btn-settings-open');
    if (settings) {
      settings.classList.toggle('is-active', Boolean(callEngineFace(face, 'isSettingsOpen', false)));
      settings.title = face.label + '设置';
    }
    const version = panelElement.querySelector('#we-panel-version');
    if (version) {
      const value = callEngineFace(face, 'getVersion', '');
      version.textContent = value ? 'v' + value : '';
      version.style.display = value ? '' : 'none';
    }
    syncBallFace();
  }

  function advanceEngineFace() {
    switchEngineFace(getNextEngineFace().id);
  }

  function switchEngineFace(targetId) {
    if (!panelElement || _panelFlipping) return;
    const target = getEngineFace(targetId);
    if (!target || target.id === _engineFace) return;
    _panelFlipping = true;
    panelElement.classList.add('we-panel-flip-out');
    window.setTimeout(() => {
      _engineFace = target.id;
      applyEngineFaceTheme();
      syncBallFace();
      panelElement.classList.remove('we-panel-flip-out');
      panelElement.classList.add('we-panel-flip-in');
      refresh();
      // 先把新的一面放到另一侧，再让浏览器补完后半程翻转。
      void panelElement.offsetWidth;
      panelElement.classList.remove('we-panel-flip-in');
      window.setTimeout(() => { _panelFlipping = false; }, 220);
    }, 180);
  }
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

  function isEditingPanelContent() {
    if (editingEvent || editingFaction || editingWind || editingTrend || editingDigest ||
        editingEnemy || editingInfluence || editingRI || editingSecret || _memoryEditingPerson ||
        _memoryEditingEntity || _memoryEditingSmall || _memoryEditingBig) return true;

    // 经济信号等少数内容使用 contentEditable 行内编辑，不经过上面的编辑状态变量。
    const active = document.activeElement;
    return !!(active && panelBodyElement && panelBodyElement.contains(active) && active.isContentEditable);
  }

  function refresh(auto) {
    if (!panelElement || !panelVisible) return;
    updateEngineFaceChrome();
    const currentFace = getEngineFace();
    // 后台自动刷新会整块重建 DOM。所有引擎的设置页或编辑状态都必须在进入
    // 各自 render 分支前拦截；否则非 world 界面会绕过保护，每 30 秒重绘一次。
    // 保存、取消等主动调用 refresh()（auto=false）仍会正常刷新。
    const settingsOpen = currentFace.id === 'world'
      ? _currentView === 'settings'
      : Boolean(callEngineFace(currentFace, 'isSettingsOpen', false));
    if (auto && (settingsOpen || isEditingPanelContent())) return;
    if (currentFace.id !== 'world') {
      if (panelBodyElement) panelBodyElement.innerHTML = callEngineFace(
        currentFace,
        'render',
        '<div class="we-empty">该引擎界面加载失败或尚未提供渲染器；其他引擎不受影响。</div>'
      );
      if (currentFace.id === 'memory') updateMemoryPanelHeader();
      bindEvents(null);
      callEngineFace(currentFace, 'bind', undefined, panelBodyElement);
      return;
    }
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
  function localSettingNumber(key, fallback, min, max) {
    const settings = window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings ? window.WORLD_ENGINE_API.getSettings() : {};
    const n = Number(settings[key]);
    let v = Number.isFinite(n) ? n : fallback;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function localTerminalKeepRounds(event) {
    const base = Math.round(localSettingNumber('localTerminalBaseKeepRounds', 2, 0));
    const perLevel = Math.round(localSettingNumber('localTerminalLevelKeepRounds', 2, 0));
    return Math.max(1, base + (Number(event && event.level) || 1) * perLevel);
  }

  function localEventMaxFails(event) {
    const level = Number(event && event.level) || 1;
    const progressBase = Math.round(localSettingNumber('localProgressFailBase', 2, 0));
    const conflictBase = Math.round(localSettingNumber('localConflictFailBase', 6, 1));
    return event && event.type === 'progress' ? progressBase + level : Math.max(1, conflictBase - level);
  }

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
      const keepTotal = localTerminalKeepRounds(e);
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

  const STABILITY_TIER_COLOR = {
    天下太平: '#69b68e', 暗流浮动: '#58b8a9', 局势紧张: '#d0aa58',
    动荡失序: '#d98a3d', 崩坏边缘: '#ff0000'
  };

  // 稳定度档位 → 头部小字（诗句）
  const STABILITY_TIER_MOOD = {
    天下太平: '海静不扬波', 暗流浮动: '暗水带花流', 局势紧张: '云急风更恶',
    动荡失序: '乾坤含疮痍', 崩坏边缘: '坤轴欹将折'
  };

  /** 刷新头部的「第X轮 + 稳定度小字」 */
  function updatePanelHeader(state, layer) {
    const roundEl = document.getElementById('we-header-round');
    if (roundEl) {
      const layerText = (layer !== undefined && layer !== null && layer !== '-') ? ' · 第 ' + layer + ' 层' : '';
      roundEl.textContent = '第 ' + ((state && state.round) || 0) + ' 轮' + layerText;
    }
    const moodEl = document.getElementById('we-header-mood');
    if (moodEl) {
      const stab = computeWorldStability(state || {});
      const color = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';
      const text = STABILITY_TIER_MOOD[stab.tier] || '';
      const dot = moodEl.querySelector('.we-header-dot');
      const txt = moodEl.querySelector('.we-header-mood-text');
      if (dot) { dot.style.background = color; dot.style.boxShadow = '0 0 6px ' + color; }
      if (txt) { txt.textContent = text; txt.style.color = color; }
    }
  }

  const VIEW_TITLES = {
    situation: '局势', events: '事件', relations: '关系', resources: '资源', settings: '设置'
  };

  function renderSection(title, id, content) {
    return '<div class="we-section" id="we-sec-' + id + '"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' + sectionBody(id, content) + '</div>';
  }

  function renderWorldDigest(s, scope) {
    const isEditing = editingDigest?.scope === scope;
    const editor = isEditing
      ? '<div class="we-event-editor we-digest-editor" data-digest-scope="' + h(scope) + '">'
        + '<button class="we-event-editor-close we-digest-editor-close" title="取消">✕</button>'
        + '<textarea class="we-digest-edit-text" rows="6">' + h(s.worldDigest || '') + '</textarea>'
        + '<div class="we-event-editor-footer"><button class="we-btn we-btn-primary we-digest-editor-save">保存</button></div>'
        + '</div>'
      : '<div class="we-digest">' + u(s.worldDigest) + '</div>';

    return '<div class="we-section we-digest-card" id="we-sec-digest">'
      + '<div class="we-section-title">世界摘要</div>'
      + editor
      + '<div class="we-event-actions">'
      + '<button class="we-icon-btn we-digest-edit" data-digest-scope="' + h(scope) + '" title="编辑"><i class="fa-solid fa-pen"></i></button>'
      + '</div></div>';
  }

  function renderHomeView(s, layer, scope) {
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
      return '<div class="we-nav-row' + sel + '" data-view="' + r.view + '">'
        + '<div class="we-nav-label">' + r.label + '</div>'
        + '<div class="we-nav-track">' + topLine + '<div class="we-nav-dot"></div>' + botLine + '</div>'
        + '<div class="we-nav-content"><span class="we-nav-sub">' + r.sub + '</span><span class="we-nav-poem">' + r.poem + '</span></div>'
        + '<i class="fa-solid fa-chevron-right we-nav-arrow"></i>'
        + '</div>';
    }).join('');

    return renderWorldCore(s)
      + '<div class="we-nav-list" style="--we-tier-color:' + tierColor + ';">' + navRows + '</div>'
      + renderWorldDigest(s, scope);
  }

  /** 展开模式主页：世界核心 + 世界摘要 + 所有 section 平铺（如存档点） */
  function renderHomeViewExpanded(s, layer, scope) {
    return renderWorldCore(s)
      + renderWorldDigest(s, scope)
      + renderSection('天下大势', 'trends', renderWorldTrends(s.worldTrends, scope))
      + renderSection('区域事件', 'regional', renderRegionalIncident(s.regionalIncident, scope))
      + renderSection('事件链', 'events', renderEventList(s.events, scope))
      + renderSection('风声', 'winds', renderWindList(s.winds, scope))
      + renderSection('影响链', 'influence', renderInfluenceChain(s.influenceChain, scope))
      + renderSection('声誉', 'reputation', renderReputation(s.reputation, scope))
      + renderSection('势力', 'factions', renderFactionList(s.factions, scope))
      + renderSection('仇敌录', 'enemies', renderEnemies(s.enemies, scope))
      + renderSection('经济', 'economy', renderEconomy(s.economy, scope))
      + renderSection('秘密', 'blackbox', renderBlackbox(s.blackbox, scope))
      + renderSection('事件账本', 'ledger', renderLedger(s.memories));
  }

  function renderSubView(viewKey, s, layer, scope) {
    let content = '';
    if (viewKey === 'situation') {
      content = renderSection('天下大势', 'trends', renderWorldTrends(s.worldTrends, scope))
        + renderSection('区域事件', 'regional', renderRegionalIncident(s.regionalIncident, scope))
        + renderSection('事件账本', 'ledger', renderLedger(s.memories));
    } else if (viewKey === 'events') {
      content = renderSection('事件链', 'events', renderEventList(s.events, scope))
        + renderSection('风声', 'winds', renderWindList(s.winds, scope))
        + renderSection('影响链', 'influence', renderInfluenceChain(s.influenceChain, scope));
    } else if (viewKey === 'relations') {
      content = renderSection('声誉', 'reputation', renderReputation(s.reputation, scope))
        + renderSection('势力', 'factions', renderFactionList(s.factions, scope))
        + renderSection('仇敌录', 'enemies', renderEnemies(s.enemies, scope));
    } else if (viewKey === 'resources') {
      content = renderSection('经济', 'economy', renderEconomy(s.economy, scope))
        + renderSection('秘密', 'blackbox', renderBlackbox(s.blackbox, scope));
    }
    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-btn-back" title="返回"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">' + (VIEW_TITLES[viewKey] || viewKey) + '</span>'
      + '</div>' + content;
  }

  /** 存档点小标题：青色默认小字 + 「- N轮 - M层」 */
  function checkpointTitle(checkpoint, cpLayer) {
    if (!checkpoint) return '存档点';
    const round = checkpoint.round || 0;
    const layer = (cpLayer === undefined || cpLayer === null) ? '-' : cpLayer;
    return '存档点 - ' + round + ' 轮 - ' + layer + ' 层';
  }

  // 更新日志（纯数据；与渲染解耦。新版本发布时在数组头部加一项即可）。
  //   version —— 版本选择条按钮文案 + 与 manifest 当前版本高亮匹配；
  //   date    —— 可选，日期不确定的留月份/年份；
  //   items   —— 该版本改动条目（每条一行，渲染时走 h() 转义）。
  const CHANGELOG = [
    { version: '3.0.0', date: '2026-07-14', items: ['世界引擎进入 3.0 正式版本：继续以独立世界状态推演、分层注入、本地事件机制、可编辑面板与聊天级存档为核心。', '记忆引擎 1.0 正式接入：人物、实体、纪要与总述保持独立数据和故障边界，并可按需向世界推演提供命中的最新人物与实体记忆。', '自动纪要从首次进入聊天时的当前层开始统计新增轮次；历史对话整理仅由纪要与总述批量重填执行。'] },
    { version: '2.5.4', date: '2026-07-14', items: ['记忆引擎任务接入顶部运行提示：人物/实体、纪要、总述在自动或手动执行时均显示开始、完成、失败或停止状态。'] },
    { version: '2.5.3', date: '2026-07-14', items: ['记忆引擎标题下方新增处理游标：人物/实体处理楼层、纪要处理楼层及总述已归并纪要条数；未处理时统一显示 0，不新增存储字段。'] },
    { version: '2.5.2', date: '2026-07-14', items: ['世界与记忆设置新增“首楼为 AI 开场白”，默认开启；开启时自动总结和批量重填忽略第 0 层，关闭时首楼按普通对话参与处理。', '记忆数据编辑器统一使用深色输入框与白色文字，提升各主题下的编辑可读性。'] },
    { version: '2.5.1', date: '2026-07-13', items: ['新增「近端随机事件」本地机制：按概率生成一条与当前对话、主角、所在区域或正在发展事项存在明确因果的事件链或风声，结果自动转为正式 event/wind 对象。', '近端动态支持调整触发概率、成功后冷却及事件链/风声比例；类型由本地预选，返回不合格或 API 异常时保持原类型继续强制生成，冷却最小为 1。近端、远方与区域事件可在同轮分别完成。', '精简并放宽事件链创建与归并规则：删除「至少两种未来走向」等过度准入条件，以核心目标、主要对象和连续执行过程识别同一主事项；已有事项的步骤、阻碍、局部结果与善后沿用原 id，只有可独立跨轮发展的新事项才另建事件链。'] },
    { version: '2.5.0', date: '2026-07-12', items: ['新增「远方随机事件」本地机制：事件账本达到可调门槛后按概率触发，抽取最新四分之一账本并从旧记录随机补足至二分之一，要求推演 API 生成一条与主角及既有账本无直接关系的远方事件链或风声。', '远方动态由本地按可调比例预选事件链或风声（默认各 50%），使用临时标记确认生成成功后再分配正式 ID；返回不合格或 API 异常时保留同一类型与账本样本继续强制生成，成功后进入可调冷却。', '正文注入新增「全等级注入」选项：开启后事件链与风声的 Lv1–Lv4 全部注入；关闭时维持高等级筛选，并保留低等级事件已爆发/已完成时的注入。', '区域突发事件类型说明改为更中性的跨题材表达，去除官道、盐铺、乡兵等古风绑定词，并要求具体表现适配当前世界观、时代、技术、地理与社会制度。', '修复冷却配置为 0 时的异常：远方事件冷却、区域事件消散后冷却以及区域事件持续轮数统一限制为最小 1。'] },
    { version: '2.4.2', date: '2026-07-12', items: ['世界状态注入与正文行为规则改为更中性的跨题材表达，并对齐当前世界引擎机制。', '新增 6 套界面配色，面板、顶部状态与悬浮球同步换色；本地机制四个区块新增独立恢复默认。', '高级设置新增 API 异常自动重试次数：支持空返回、乱码、解析失败、HTTP、超时及网络错误重试，默认关闭。'] },
    { version: '2.4.1', date: '2026-07-11', items: ['新增「本地机制」设置：区域事件、事件骰子、风声消散、保留上限拆成四个可折叠区块，关键公式直接写在设置里，可调整事件爆发、推进/受挫、消散与保留轮数等参数。', '注入设置新增最大注入字符数，可按模型上下文和酒馆配置控制世界状态注入长度，避免 prompt 被过长状态挤爆。'] },
    { version: '2.4.0', date: '2026-07-10', items: ['主线纳入 test 分支的世界状态增强：持续实体新增稳定 id，事件、势力、天下大势、风声、仇敌等对象在改名、重 roll、恢复存档和复制时更不容易被误合并或重复污染。', '优化世界状态模块准入与推演 prompt 规则：收紧声誉、经济、仇敌、信息黑盒、区域事件、知情边界等模块的创建/更新条件，减少无因果更新、面板泄露和过度落盘。'] },
    { version: '2.3.22', date: '2026-07-10', items: ['控制台新增「API 请求参数」结构化日志：每次推演会打印连接方式、目标地址、模型、temperature、max_tokens、timeout 秒数、消息数量与 prompt 字符数，方便核对实际请求参数；日志不输出 API Key，也不展开完整 prompt 正文。'] },
    { version: '2.3.21', date: '2026-07-10', items: ['API 设置页新增温度、最大输出 token、请求超时（秒）三个选项；推演请求不再硬编码 0.7 / 8000，而是读取用户设置。', '增强 API 无响应保护：超时覆盖请求响应头与响应正文读取全过程，避免服务端半开响应或正文卡住时一直停在「推演中」；获取模型列表也会按同一超时中止。'] },
    { version: '2.3.20', date: '2026-07-09', items: ['二级页面的返回栏与分级标题改为顶部吸附，长列表滚动到任意位置都能直接返回。', '世界摘要新增行内编辑入口：点击摘要卡片后显示编辑按钮，可修改并保存；不提供复制或删除操作。', '修复编辑事件、势力、风声、大势、世界摘要等信息时内容不断回弹：编辑期间暂停后台自动刷新，避免面板重建覆盖尚未保存的输入；保存或取消后仍正常刷新。'] },
    { version: '2.3.19', date: '2026-06-29', items: ['修复「没重 roll 却注入了存档点（旧轮次世界状态）」：v2.3.18 用纯数值 state.chatLayer===chatLayer 判重 roll，但酒馆 GENERATION_STARTED 在用户楼 push 进 chat **之前** emit——新一轮发消息时 chatLayer 仍 == 上一轮 state.chatLayer，被误判成重 roll、注入了上一轮存档点（与「蚀心入魔·数据库」等双生成插件叠加时每轮必现）。现重 roll 判据改用酒馆原生 type（GENERATION_STARTED 的 type=swipe/regenerate 才是真重 roll），不再靠楼层数值推断；dryRun（数据库类插件的预热/算 token 生成）一律跳过，杜绝「正文生成完又注入一遍」。', '注入自检查看器增强（只读）：「实际发出的消息链」现在每一条（system/user/assistant 全部）都可点击展开看完整内容，不再只显示字数；方便核对发给大模型的完整 prompt。诊断包仍只导 role+长度（不含正文，避免体积膨胀与泄露聊天上下文）。'] },
    { version: '2.3.18', date: '2026-06-29', items: ['修复重 roll 推演轮次回退（解耦重 roll 与 redo）：自动推演把「重 roll（同楼 swipe 重新生成）」混为 redo（从存档点恢复基底重推）→ 重 roll 后推演轮次卡在存档点轮次而非当前轮。现 evolve 基底选择三分——forward（新轮次/从当前推）/ redo（手动卫星按钮回存档点）/ 自动重 roll（mode 未传且非新轮次→不恢复存档点，直接在当前 state 上推，轮次保持当前轮）。', '修复重 roll 注入走错分支（解耦注入判据与事件时序）：v2.3.17 的 _pendingReroll 闸门依赖酒馆 swipe 事件时序，易被 GENERATION_ENDED 提前清零 / 双生成插件撞窗口 → 重 roll 时注入了当前轮状态而非存档点。（注：v2.3.18 换的纯数值判据有新回归，已由 v2.3.19 的 type 判据彻底修正。）', '移除 _pendingReroll 闸门（v2.3.17 引入，现完全不需要），代码更简单'] },
    { version: '2.3.17', date: '2026-06-28', items: ['修复与「会扰动楼层/双生成」类插件（如数据库类酒馆助手脚本）叠加时世界状态注入「时灵时不灵」：根因是 v2.3.14 的「同层重 roll 不注入」守卫判据 fingerprint==chatLayer 过于激进——fingerprint 在推演那刻被钉到当层，新一轮第①次生成（真正产出剧情正文那次）刚开始、新用户楼尚未落地时 chatLayer 恰好仍 == fingerprint，被误判成重 roll 而撤掉注入，导致真实正文拿不到世界状态。现给守卫加「真 swipe 闸门」：只在确实收到酒馆原生 MESSAGE_SWIPED 事件后（_pendingReroll=true）守卫才有资格触发，普通新生成不带 swipe 事件故照常注入当前状态；且触发时改为注入存档点（这层正文产生前的世界状态）而非完全不注入，更贴合「重 roll 注入存档点」本意（无存档点才退回不注入）。判据是酒馆原生事件，对任何插件通用、不含任何插件特判'] },
    { version: '2.3.16', date: '2026-06-28', items: ['新增「注入自检」（调试卡顶部，只读）：很多客户反馈「注入不成功」却无从判断——根因是 registerInjection 的成功只代表「调酒馆接口没报错」，从不证明世界状态真进了发给大模型的正文。现订阅酒馆 prompt 组装完成事件（对话补全 chat_completion_prompt_ready / 文本补全 generate_after_combine_prompts），读取注入之后酒馆真正拼好的 prompt 链并按 role 分好展示，用大白话判定本轮：✅已进正文 / ❌注册了却没进正文(真失败) / ⏸按设计跳过(关了注入或同层重 roll) / —还没生成；纯只读、解耦成独立模块，不改注入逻辑、不动 eventData、忽略算 token 的预热轮，对推演零影响；诊断包同步补采该快照'] },
    { version: '2.3.15', date: '2026-06-25', items: ['修复自动推演静默瘫痪：API 推演请求无超时，若落入网络黑洞（代理无响应/上游不返回也不报错）fetch 会永久挂起，evolution 的 _isRunning 永不复位，此后所有 GENERATION_ENDED 触发的自动推演被 isRunning() 守卫静默跳过、直到用户切一次聊天才解锁；现新增 apiTimeoutMs（默认 120s，0=不超时），超时按推演失败处理让 finally 正常复位并在状态栏报明确超时原因（用户主动中止/切聊天仍走原 AbortError 显示「已中止」）'] },
    { version: '2.3.14', date: '2026-06-23', items: ['修复 redo 轮次虚增：点「重新推进」卫星按钮时 round 无条件 +1（在 isNew 判定之前）导致 redo 也涨轮次，与注释「redo 轮次不变」不符；现 round++ 移进 if(isNew)，只 forward / 自动新轮次涨', '修复 redo 无存档点静默退化：首次推演后无 checkpoint，点 redo 旧版整块跳过→无声退化为「在当前 state 上推」+ round++ 的伪 redo（白涨一轮无提示）；现 mode==="redo" 且无 cp 时 return false 并报错「无存档点，无法重新推进（redo）；请先『向前推进』至少一轮」，不再伪 forward', '修复重 roll 同层注入旧世界状态：重 roll 同层（chatLayer==stateLayer）旧版走 else 注入「基于旧正文推演出的当前状态」，干扰正在重写的新正文；现 applyInjectionForCurrentRound 加「同层已推演→不注入」分支，判据用 fingerprint（只在真正新轮次时更新，比 chatLayer 忠实）命中 unregisterInjection，避免新正文被旧世界状态带偏', '新增小地球（悬浮球）左侧第四卫星「插头」总开关：一键关闭/开启 推演与注入（联动 evolveMode + injectIntoPrompt 两个现有设置字段，不新增字段；关闭=切手动推演+关注入，开启=切自动推演+开注入；manual 模式自带拦 pending autoEvolveTimer，无需额外总开关注解）'] },
    { version: '2.3.13', date: '2026-06-22', items: ['修复自动推演死锁：开了 syncToChat 的空壳聊天（从未推演过）首次 AI 楼层后状态行卡在「第 0/1 轮」永不自动推演', '修复火山方舟等自定义版本前缀（/api/v3、/api/coding/v3）API 无法拉取模型：URL 规整不再硬塞 /v1，版本前缀由用户填到完整，URL 框旁加格式提示', 'chatcache 跨设备同步护栏：云端缺少 checkpoint/fingerprint 时不随 exact 删除本地锚点，避免再次掉进死锁'] },
    { version: '2.3.12', date: '2026-06-22', items: ['新增「关于」选项卡：内置更新日志，可下拉选择版本查看历次改动', '正则过滤「简单模式」：勾选标签自动生成删除正则'] },
    { version: '2.3.11', date: '2026-06-22', items: ['正则过滤支持 /pattern/flags 写法、保存时校验、新增测试按钮'] },
    { version: '2.3.10', date: '2026-06-21', items: ['引擎预设系统代码审查修复（性能与卡顿）', '诊断包补采预设系统与 prompt 分段'] },
    { version: '2.3.9',  date: '2026-06',    items: ['引擎预设系统：推演 prompt 硬编码段可编辑、可保存、可切换'] },
    { version: '2.3.8',  date: '2026-06',    items: ['推演 Prompt 全透明分段展示（只读）'] },
    { version: '2.3.7',  date: '2026-06',    items: ['新增「经酒馆代理」连接方式，绕过第三方 API 的 CORS'] },
    { version: '2.3.6',  date: '2026-06',    items: ['设置页选项卡化'] },
    { version: '2.3.5',  date: '2026-06',    items: ['一键导出诊断包'] },
    { version: '2.3.4',  date: '2026-06',    items: ['面板标题旁显示扩展版本号'] },
    { version: '2.2.0',  date: '2026',       items: ['酒馆缓存与存档：跨设备同步 + 防丢失存档'] }
  ];

  // [FIX] 选项卡定义：label + 包含哪些片段。仅归类现有 section，不新增/不删功能。
  const SETTINGS_TABS = [
    { key: 'common',    label: '常用' },
    { key: 'link',      label: '联动' },
    { key: 'advanced',  label: '高级' },
    { key: 'mechanics', label: '本地机制' },
    { key: 'archive',   label: '存档' },
    { key: 'worldbook', label: '世界书' },
    { key: 'debug',     label: '调试' },
    { key: 'about',     label: '关于' }
  ];
  let _settingsTab = 'common';
  let _memorySettingsTab = 'common';

  function renderSettingsView(checkpoint, cpLayer) {
    const cpContent = checkpoint
      ? renderCheckpointSections(checkpoint, cpLayer)
      : '<div class="we-empty">暂无存档点</div>';
    const form = renderSettingsForm();              // {api,evolve,backfill,filter,display,chatcache,inject}
    const extra = renderSettingsAfterCheckpoint();  // {worldbook,data,tone}

    // 存档点 section（原样，移入「存档」卡）
    const checkpointSection = '<div class="we-section" style="margin-top:16px;"><div class="we-section-title">'
      + sectionHeader(checkpointTitle(checkpoint, cpLayer), 'checkpoint-section') + '</div>'
      + sectionBody('checkpoint-section', cpContent) + '</div>';

    // 调试 section（原样，含诊断包按钮 + renderDebug，移入「调试」卡）
    const debugSection = '<div class="we-section we-debug-section">'
      + '<div class="we-section-title"><span class="we-debug-toggle" title="展开或收起调试信息"><span class="we-toggle-arrow">▶</span>调试</span></div>'
      + '<div id="we-debug-body" style="display:none;">'
      + '<button class="we-btn" id="we-export-diag" style="width:100%;margin-bottom:8px;">导出诊断包</button><!-- [FIX] 诊断包：与是否已推演无关，始终可导出 -->'
      + '<div id="we-debug-render">' + renderDebug() + '</div>'
      // [MAP] 引擎预设管理：与 PR#12 只读分段展示同处调试卡，把 4 个硬编码段升级为可编辑+预设化。
      // 独立锚点 #we-preset-manage，局部刷新；保存走独立 storage key，不进 we-save-settings。
      + '<div class="we-preset-section">'
      + '<div class="we-section-title">引擎预设（可编辑推演 prompt 段）</div>'
      + '<div id="we-preset-manage">' + renderPresetManage() + '</div>'
      + '</div>'
      + '</div></div>';

    // 各选项卡承载的片段（每个 section 恰好出现一次，零重复）
    const panelContent = {
      common:    form.api + form.evolve + form.inject,
      link:      form.link,
      advanced:  form.retry + form.backfill + form.filter + form.display + extra.tone,
      mechanics: form.mechanics,
      archive:   form.chatcache + extra.data + checkpointSection,
      worldbook: extra.worldbook,
      debug:     debugSection,
      about:     renderAbout()
    };

    const tabBar = '<div class="we-settings-tabs-shell">'
      + '<button class="we-settings-tab-scroll" data-dir="-1" title="向左滚动"><i class="fa-solid fa-chevron-left"></i></button>'
      + '<div class="we-settings-tabs" id="we-settings-tabs">'
      + SETTINGS_TABS.map(t =>
          '<button class="we-settings-tab' + (t.key === _settingsTab ? ' we-settings-tab--active' : '')
          + '" data-tab="' + t.key + '">' + t.label + '</button>').join('')
      + '</div>'
      + '<button class="we-settings-tab-scroll" data-dir="1" title="向右滚动"><i class="fa-solid fa-chevron-right"></i></button>'
      + '</div>';

    const panels = SETTINGS_TABS.map(t =>
      '<div class="we-settings-panel" data-tab="' + t.key + '"'
      + (t.key === _settingsTab ? '' : ' style="display:none;"') + '>'
      + (panelContent[t.key] || '') + '</div>').join('');

    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-btn-back" title="返回"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">设置</span>'
      + '</div>'
      + tabBar
      + panels
      // 保存/重置：底部常驻（sticky），任何选项卡都能一键保存全部设置
      + '<div class="we-settings-save-actions we-settings-save-sticky">'
      + '<button class="we-btn" id="we-save-settings">保存设置</button>'
      + '<button class="we-btn we-btn-danger" id="we-reset-world">重置世界</button>'
      + '</div>';
  }

  // 「关于」选项卡：当前版本徽标 + 更新日志（下拉选择版本 + 每版本独立面板，纯 CSS 显隐切换）。
  //   数据来自 CHANGELOG 常量（与渲染解耦）；版本下拉复用 #we-preset-select 范式——
  //   点击弹出原生可滚动列表，版本再多也不撑爆布局。默认选中第一项（最新版）。
  function renderAbout() {
    if (!CHANGELOG.length) return '<div class="we-empty">暂无更新日志</div>';
    const cur = window.WORLD_ENGINE_VERSION;
    const curBadge = cur ? '<span class="we-changelog-cur">当前版本 v' + h(cur) + '</span>' : '';

    const optHtml = CHANGELOG.map(function (c, i) {
      const label = 'v' + c.version + (c.date ? '（' + c.date + '）' : '');
      return '<option value="' + h(c.version) + '"' + (i === 0 ? ' selected' : '') + '>' + h(label) + '</option>';
    }).join('');
    const verBar = '<div class="we-changelog-row">'
      + '<label class="we-changelog-row-label">查看版本</label>'
      + '<select id="we-changelog-select" class="we-changelog-select">' + optHtml + '</select>'
      + '</div>';

    const panels = CHANGELOG.map(function (c, i) {
      const head = '<div class="we-changelog-head">v' + h(c.version)
        + (c.date ? ' <span class="we-changelog-date">' + h(c.date) + '</span>' : '') + '</div>';
      const items = '<ul class="we-changelog-items">'
        + (c.items || []).map(function (it) { return '<li>' + h(it) + '</li>'; }).join('')
        + '</ul>';
      return '<div class="we-changelog-panel" data-ver="' + h(c.version) + '"'
        + (i === 0 ? '' : ' style="display:none;"') + '>' + head + items + '</div>';
    }).join('');

    return '<div class="we-section">'
      + '<div class="we-changelog-top">' + curBadge + '</div>'
      + verBar
      + panels
      + '</div>';
  }

  function renderCheckpointSections(s, layer) {
    return renderSection('天下大势', 'cp-trends', renderWorldTrends(s.worldTrends, 'checkpoint'))
      + renderSection('事件链', 'cp-events', renderEventList(s.events, 'checkpoint'))
      + renderSection('势力', 'cp-factions', renderFactionList(s.factions, 'checkpoint'))
      + renderSection('风声', 'cp-winds', renderWindList(s.winds, 'checkpoint'))
      + renderSection('声誉', 'cp-reputation', renderReputation(s.reputation, 'checkpoint'))
      + renderSection('经济', 'cp-economy', renderEconomy(s.economy, 'checkpoint'))
      + renderSection('仇敌录', 'cp-enemies', renderEnemies(s.enemies, 'checkpoint'))
      + renderSection('影响链', 'cp-influence', renderInfluenceChain(s.influenceChain, 'checkpoint'))
      + renderSection('区域事件', 'cp-regional', renderRegionalIncident(s.regionalIncident, 'checkpoint'))
      + renderSection('秘密', 'cp-blackbox', renderBlackbox(s.blackbox, 'checkpoint'))
      + renderSection('事件账本', 'cp-ledger', renderLedger(s.memories));
  }

  /** 世界核心：环形稳定度仪表 + 四格关键计数 */
  function renderWorldCore(s) {
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

    const stats = [
      ['事件', (s.events || []).length],
      ['势力', (s.factions || []).length],
      ['风声', (s.winds || []).length],
      ['大势', (s.worldTrends || []).length],
    ].map(([k, v]) => `<div class="we-core-stat"><div class="we-core-stat-k">${k}</div><div class="we-core-stat-v">${v}</div></div>`).join('');

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
              <div class="we-core-title">世界核心</div>
              <div class="we-core-sub">稳定度</div>
              <div class="we-core-pct" style="color:${tierColor};">${stab.stability.toFixed(1)}<span>%</span></div>
              <div class="we-core-tier" style="color:${tierColor};">${stab.tier}</div>
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
        const maxFails = localEventMaxFails(e);
        extras += ` <span class="we-badge" style="background:#6662;color:#888;">${e.consecutiveFails}/${maxFails}</span>`;
      }
      if (e.stall && !isTerminal) {
        extras += ' <span class="we-badge" style="background:#6688aa22;color:#6688aa;">停滞</span>';
      }
      let metaExtra = '';
      if (e.evolveResult && !isTerminal) {
        const resultColors = { '成功':'#7a9a7a', '保持':'#b8a070', '受挫':'#c46a6a' };
        const color = resultColors[e.evolveResult] || '#888';
        metaExtra = ` <span class="we-badge" style="background:${color}22;color:${color};">${e.evolveResult}</span>`;
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
        const keepRounds = localTerminalKeepRounds(e);
        const left = keepRounds - (curRound - e._terminalSince) + 1;
        if (left >= 1) {
          const cdColor = e.stage === '已完成' ? '#58e8b3' : '#e07465';
          countdownHtml = ` <span class="we-badge we-event-countdown" style="color:${cdColor};" title="该事件在 ${left} 轮后自动清退"><i class="fa-regular fa-clock"></i>剩余${left}轮</span>`;
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
      const stageBadge = isTerminal ? '' : ` <span class="we-badge" style="background:${color}22;color:${color};">${e.stage}</span>`;
      const metaText = isTerminal
        ? (e.desc ? u(e.desc) : '')
        : `${e.stageRound||1}/9 ${e.desc ? '— '+u(e.desc) : ''}${metaExtra}`;
      const stampHtml = isTerminal && terminalStamp
        ? `<div class="we-event-stamp" style="border-color:${terminalStamp.color};color:${terminalStamp.color};">${terminalStamp.text}</div>`
        : '';
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-event-delete" data-event-scope="${scope}" data-event-index="${eventIndex}" title="删除事件"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-event-copy" data-event-scope="${scope}" data-event-index="${eventIndex}" title="复制事件"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-event-edit" data-event-scope="${scope}" data-event-index="${eventIndex}" title="修改事件"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderEventEditor(e, scope, eventIndex) : '';
      return `<div class="${itemClass}" style="${itemStyle}">
        ${stampHtml}
        <div class="we-event-name"><span style="color:${levelColor};">${u(e.name)}</span> <span class="we-badge" style="background:${levelColor}22;color:${levelColor};">Lv.${e.level||'?'}</span> <span class="we-badge" style="background:${typeColor}22;color:${typeColor};">${typeName}</span>${countdownHtml}${stageBadge}${extras}</div>
        ${metaText ? `<div class="we-event-meta" ${metaStyle}>${metaText}</div>` : ''}
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
    const keepRounds = localTerminalKeepRounds(event);
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
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-event-editor-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
        </div>
      </div>`;
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
    return '<div class="we-rep-grid">' + Object.entries(rep).filter(([k]) => k !== 'lastChange').map(([key, rawVal]) => {
      const val = legacyMap[rawVal] || rawVal;
      const cn = dimLabels[key] || key;
      const idx = levels.indexOf(val);
      const color = levelColors[val] || '#888';
      const quote = (quotes[key] && quotes[key][val]) || '';
      const dotsHtml = levels.map((l, i) => {
        const active = i <= idx ? ' we-rep-dot-active' : '';
        const dotColor = i <= idx ? color : '#444';
        return `<span class="we-rep-dot${active}" style="background:${dotColor};" data-rep-scope="${scope || 'state'}" data-dim="${key}" data-level="${l}" title="${l}"></span>`;
      }).join('');
      return `<div class="we-rep-row">
        <span class="we-rep-dim">${cn}</span>
        <div class="we-rep-dots">${dotsHtml}</div>
        <span class="we-rep-quote" style="color:${color}">${quote}</span>
      </div>`;
    }).join('') + '</div>';
  }

  function renderEconomy(econ, scope) {
    if (!econ) return '<div class="we-empty">暂无经济数据</div>';
    const sc = scope || 'state';
    const climates = ['繁荣','平稳','衰退','动荡'];
    const climateColors = { '繁荣': '#3ecf8e', '平稳': '#7a8a9a', '衰退': '#d9a34a', '动荡': '#e05555' };
    const climateBg = { '繁荣': 'rgba(62,207,142,0.08)', '平稳': 'rgba(122,138,154,0.06)', '衰退': 'rgba(217,163,74,0.08)', '动荡': 'rgba(224,85,85,0.08)' };
    const climate = econ.climate || '平稳';
    const cColor = climateColors[climate] || '#7a8a9a';
    let html = '<div class="we-climate-bar" style="background:' + (climateBg[climate]||'rgba(122,138,154,0.06)') + ';">';
    html += '<span class="we-climate-dot" style="background:' + cColor + ';box-shadow:0 0 8px ' + cColor + '88;"></span>';
    html += '<span class="we-climate-label" style="color:' + cColor + '">' + climate + '</span>';
    html += '<div class="we-climate-btns">';
    for (const c of climates) {
      html += '<span class="we-climate-btn' + (c === climate ? ' we-climate-btn-on' : '') + '" style="' + (c === climate ? ('color:'+(climateColors[c]||'#7a8a9a')+';border-color:'+(climateColors[c]||'#7a8a9a')) : '') + '" data-climate-scope="' + sc + '" data-climate="' + c + '">' + c + '</span>';
    }
    html += '</div></div>';
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
      const editHtml = isEditing ? renderEnemyEditor(en, enemyIndex, scope) : '';
      return `<div class="we-blood-item">
        ${actionHtml}
        <div class="we-blood-title">${u(en.name)} <span class="we-badge we-badge-danger">${en.status||'追踪中'}</span><span class="we-badge" style="background:var(--we-purple);font-size:10px;">${en.type==='blood'?'血仇':'恩怨'}</span></div>
        <div class="we-blood-meta">原因: ${u(en.reason||'?')}</div>
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
    const editHtml = isEditing ? renderRIEditor(ri, scope) : '';

    if (ri.active) {
      return `<div class="we-accident-item we-regional-incident-item we-accident-triggered">
        ${actionHtml}
        ${u(ri.title)}<br>
        <span style="font-size:11px;color:var(--we-text3);">类型: ${u(getRegionalIncidentTypeLabel(ri.type))} | 范围: ${u(ri.scope||'?')} | 剩余: ${ri.duration||0}轮</span><br>
        <span style="font-size:11px;color:var(--we-text2);">${u(ri.impact||'')}</span>
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
        <div class="we-event-editor-grid">${fields}</div>
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

  // [FIX] 推演 prompt 分段卡片折叠绑定（模块级，供装配 + 局部刷新复用）。事件委托。
  function bindPromptSegToggle(root) {
    if (!root) return;
    root.addEventListener('click', function(e) {
      const head = e.target.closest('[data-we-seg-toggle]');
      if (!head) return;
      const card = head.parentElement;
      const body = card && card.querySelector('.we-prompt-seg-body');
      const arrow = head.querySelector('.we-prompt-seg-arrow');
      if (!body) return;
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
    });
  }

  // [FIX] 局部刷新调试卡的 renderDebug 部分：只替换 #we-debug-render 内容并重绑段折叠，
  // 不动其它选项卡 DOM（保护用户在其它 tab 未保存的输入）。切到调试 tab 时调。
  function refreshDebugRender() {
    const box = document.getElementById('we-debug-render');
    if (!box) return;
    box.innerHTML = renderDebug();
    bindPromptSegToggle(box.querySelector('.we-prompt-debug'));
    // 导出按钮在 renderDebug 输出内，重绑
    const exportPromptBtn = document.getElementById('we-export-prompt');
    if (exportPromptBtn) {
      exportPromptBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.prompt) { showToast('无 Prompt 可导出', true); return; }
        const blob = new Blob([dbg.prompt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'prompt-' + Date.now() + '.txt'; a.click();
        URL.revokeObjectURL(url);
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
        const blob = new Blob([dbg.rawResult], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'api-raw-' + Date.now() + '.txt'; a.click();
        URL.revokeObjectURL(url);
        showToast('API 返回已导出');
      };
    }
  }

  function updateMemoryPanelHeader() {
    const state = window.MEMORY_ENGINE_DATA?.loadState?.() || {};
    const eventMemory = state.event_memory || {};
    const memoryLayer = Number.isFinite(Number(state.chatLayer)) ? Math.max(0, Number(state.chatLayer)) : 0;
    const summaryLayer = Number.isFinite(Number(eventMemory.small_summary_layer))
      ? Math.max(0, Number(eventMemory.small_summary_layer)) : 0;
    const overviewCount = Array.isArray(eventMemory.big_summaries) ? eventMemory.big_summaries.length : 0;
    const roundEl = document.getElementById('we-header-round');
    if (roundEl) roundEl.textContent = '';
    const moodEl = document.getElementById('we-header-mood');
    if (!moodEl) return;
    const dot = moodEl.querySelector('.we-header-dot');
    const text = moodEl.querySelector('.we-header-mood-text');
    if (dot) {
      dot.style.background = 'var(--we-accent)';
      dot.style.boxShadow = '0 0 6px var(--we-accent)';
    }
    if (text) {
      text.textContent = `人物/实体至第 ${memoryLayer} 层 · 纪要至第 ${summaryLayer} 层 · 总述至第 ${overviewCount} 条`;
      text.style.color = 'var(--we-text2)';
    }
  }

  function refreshMemoryDebugRender() {
    const box = document.getElementById('we-memory-debug-render');
    if (!box) return;
    box.innerHTML = renderMemoryDebug();
    bindPromptSegToggle(box.querySelector('.we-prompt-debug'));
    bindMemoryDebugExportButtons();
  }

  function bindMemoryDebugExportButtons() {
    const download = (content, filename) => {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
    };
    const debug = () => window.MEMORY_ENGINE?.getLastDebug?.() || {};
    const promptButton = document.getElementById('we-memory-export-prompt');
    if (promptButton) promptButton.onclick = () => {
      const value = debug().prompt || debug().requestPrompt || '';
      if (!value) { showToast('无记忆 Prompt 可导出', true); return; }
      download(value, 'memory-prompt-' + Date.now() + '.txt'); showToast('记忆 Prompt 已导出');
    };
    const resultButton = document.getElementById('we-memory-export-raw-result');
    if (resultButton) resultButton.onclick = () => {
      const current = debug();
      const value = current.rawResult || current.apiResponse || current.response || '';
      if (!value) { showToast('无记忆 API 返回可导出', true); return; }
      download(typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'memory-api-raw-' + Date.now() + '.txt'); showToast('记忆 API 返回已导出');
    };
  }

  // ═══════════════════════════════════════════════════════════
  // [MAP] 引擎预设管理 UI（与 PR#12 只读分段展示同处调试卡）
  // 把推演 prompt 的 4 个硬编码段（①引擎角色/②因果10步/⑦JSON输出说明/⑧JSON示例）
  // 升级为可编辑、可保存、可切换、可导入导出的预设。保存走独立 storage key，
  // 不进 we-save-settings、不进 world_engine_settings。
  // ═══════════════════════════════════════════════════════════
  function getPresetMod() {
    return (window.WORLD_ENGINE_PRESET && typeof window.WORLD_ENGINE_PRESET.getAllPresets === 'function')
      ? window.WORLD_ENGINE_PRESET : null;
  }

  // 生成预设管理 HTML（选择器 + 操作按钮 + 4 段可编辑折叠卡 + 提示）。
  // 每段 textarea 初值 = 当前生效文本（有覆写用覆写，否则默认硬编码原文）。
  function renderPresetManage() {
    const P = getPresetMod();
    if (!P) return '<div class="we-empty">预设系统未加载</div>';

    const all = P.getAllPresets();
    const activeId = P.getActivePresetId();
    const active = P.getActivePreset();
    const overridden = P.getOverriddenSegKeys();
    const keys = P.EDITABLE_SEG_KEYS;
    const labels = P.SEG_LABELS;

    const optHtml = all.map(p =>
      '<option value="' + h(p.id) + '"' + (p.id === activeId ? ' selected' : '') + '>'
      + h(p.name) + (p.builtin ? '（内置）' : '') + '</option>').join('');

    const segCards = keys.map(k => {
      const text = P.getSegmentDisplayText(k) || '';
      const isOver = overridden.indexOf(k) >= 0;
      const meta = isOver ? '已自定义' : '默认（未改）';
      return '<div class="we-prompt-seg-card we-preset-seg-card' + (isOver ? ' we-preset-seg-card-over' : '') + '">'
        + '<div class="we-prompt-seg-head" data-we-preset-toggle>'
        + '<span class="we-prompt-seg-arrow">▶</span>'
        + '<span class="we-prompt-seg-label">' + h(labels[k] || k) + '</span>'
        + '<span class="we-prompt-seg-meta">' + meta + '</span>'
        + '</div>'
        + '<div class="we-prompt-seg-body we-preset-seg-body" style="display:none;">'
        + '<textarea class="we-preset-textarea" data-we-preset-seg="' + h(k) + '" rows="14" spellcheck="false" placeholder="留空则使用默认硬编码原文">'
        + h(text) + '</textarea>'
        + '<div class="we-preset-seg-hint">留空保存后回退默认原文。改 ⑦⑧ 可能导致推演解析失败，自行负责。可保留 {{user}}。</div>'
        + '</div>'
        + '</div>';
    }).join('');

    const builtinActive = !!(active && active.builtin);

    return '<div class="we-preset-manage">'
      + '<div class="we-preset-row">'
      + '<label class="we-preset-select-label">当前预设</label>'
      + '<select id="we-preset-select" class="we-preset-select">' + optHtml + '</select>'
      + '</div>'
      + '<div class="we-preset-active-desc">' + h(active && active.description || '') + '</div>'
      + '<div class="we-preset-actions">'
      + '<button class="we-btn we-btn-primary" id="we-preset-save">保存</button>'
      + '<button class="we-btn" id="we-preset-saveas">另存为</button>'
      + (builtinActive ? '' : '<button class="we-btn we-btn-danger" id="we-preset-delete">删除</button>')
      + '<button class="we-btn" id="we-preset-export">导出</button>'
      + '<button class="we-btn" id="we-preset-import">导入</button>'
      + '<input type="file" id="we-preset-import-file" accept=".json,application/json" style="display:none;">'
      + '</div>'
      + '<div class="we-preset-hint">'
      + '此处编辑的是「世界推演引擎」发给推演 AI 的 prompt 硬编码段。改了会改变推演行为本身，'
      + '请自行负责。内置「默认」预设不可删，编辑内置预设点「保存」会提示另存为副本。'
      + '</div>'
      + '<div class="we-prompt-seg-list">' + segCards + '</div>'
      + '</div>';
  }

  // [FIX] 局部刷新预设管理：只替换 #we-preset-manage 内容并重绑事件，不动其它 tab 输入。
  function refreshPresetManage() {
    const box = document.getElementById('we-preset-manage');
    if (!box) return;
    box.innerHTML = renderPresetManage();
    bindPresetEvents(box);
  }

  // 收集 4 个 textarea 的当前文本 → segments 对象（空串→null 表示回退默认）。
  function collectPresetSegmentsFromDOM() {
    const P = getPresetMod();
    if (!P) return {};
    const out = {};
    P.EDITABLE_SEG_KEYS.forEach(k => {
      const ta = document.querySelector('.we-preset-textarea[data-we-preset-seg="' + cssEscape(k) + '"]');
      if (!ta) { out[k] = null; return; }
      const v = ta.value;
      out[k] = (v == null || v.trim() === '') ? null : v;
    });
    return out;
  }

  // 简单的属性值转义（用于 querySelector 选择器里拼 seg key，key 全是固定小写带连字符，安全兜底）。
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // 绑定预设管理事件（选择器切换 + 保存/另存/删除/导入/导出 + 段折叠委托）。
  function bindPresetEvents(root) {
    const P = getPresetMod();
    if (!P) return;
    root = root || document.getElementById('we-preset-manage');
    if (!root) return;

    // 段折叠（事件委托，独立 data-attr，不与 bindPromptSegToggle 的 data-we-seg-toggle 冲突）。
    // [FIX] 委托只需绑一次：refreshPresetManage 每次只换 root.innerHTML（子节点全新），
    // root 节点本身不变，委托靠冒泡一直有效。用守卫避免每次刷新都 addEventListener 导致
    // 监听累积（点 10 次保存就会在同一个 root 上叠 10 层 click，折叠头点一次触发 10 次）。
    if (!root.__wePresetDelegated) {
      root.__wePresetDelegated = true;
      root.addEventListener('click', function (e) {
        const head = e.target.closest('[data-we-preset-toggle]');
        if (!head) return;
        const card = head.parentElement;
        const body = card && card.querySelector('.we-preset-seg-body');
        const arrow = head.querySelector('.we-prompt-seg-arrow');
        if (!body) return;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
      });
    }

    // 切换预设
    const sel = root.querySelector('#we-preset-select');
    if (sel) {
      sel.onchange = () => {
        const id = sel.value;
        P.setActivePreset(id);
        showToast('已切换预设');
        refreshPresetManage();
      };
    }

    // 保存：内置预设 → 提示另存为副本；自定义 → 更新当前。
    const saveBtn = root.querySelector('#we-preset-save');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const activeId = P.getActivePresetId();
        const active = P.getActivePreset();
        const segs = collectPresetSegmentsFromDOM();
        if (active && active.builtin) {
          // 内置预设不可覆盖：走另存为副本流程
          const name = prompt('当前是内置预设，保存会另存为新预设副本。请输入新预设名称：', active.name + ' 副本');
          if (name == null) return;
          const np = P.saveAsCustomPreset({ name: name || (active.name + ' 副本'), description: active.description, segments: segs });
          P.setActivePreset(np.id);
          showToast('已另存为新预设：' + np.name);
          refreshPresetManage();
          return;
        }
        P.saveCustomPreset({ id: activeId, name: active.name, description: active.description, segments: segs });
        showToast('预设已保存');
        refreshPresetManage();
      };
    }

    // 另存为：强制新 id
    const saveAsBtn = root.querySelector('#we-preset-saveas');
    if (saveAsBtn) {
      saveAsBtn.onclick = () => {
        const active = P.getActivePreset();
        const segs = collectPresetSegmentsFromDOM();
        const name = prompt('请输入新预设名称：', active.name + ' 副本');
        if (name == null) return;
        const np = P.saveAsCustomPreset({ name: name || (active.name + ' 副本'), description: active.description, segments: segs });
        P.setActivePreset(np.id);
        showToast('已另存为新预设：' + np.name);
        refreshPresetManage();
      };
    }

    // 删除：仅自定义
    const delBtn = root.querySelector('#we-preset-delete');
    if (delBtn) {
      delBtn.onclick = () => {
        const activeId = P.getActivePresetId();
        const active = P.getActivePreset();
        if (!active || active.builtin) { showToast('内置预设不可删除', true); return; }
        if (!confirm('确认删除预设「' + active.name + '」？此操作不可撤销。')) return;
        P.deleteCustomPreset(activeId);
        showToast('已删除预设');
        refreshPresetManage();
      };
    }

    // 导出当前预设
    const expBtn = root.querySelector('#we-preset-export');
    if (expBtn) {
      expBtn.onclick = () => {
        const json = P.exportPreset(P.getActivePresetId());
        if (!json) { showToast('无预设可导出', true); return; }
        const name = (P.getActivePreset().name || 'preset').replace(/[\\/:*?"<>|]/g, '_');
        setupDownload(json, 'world-engine-preset-' + name + '-' + Date.now() + '.json');
        showToast('预设已导出');
      };
    }

    // 导入：触发文件选择
    const impBtn = root.querySelector('#we-preset-import');
    const impFile = root.querySelector('#we-preset-import-file');
    if (impBtn && impFile) {
      impBtn.onclick = () => impFile.click();
      impFile.onchange = () => {
        const f = impFile.files && impFile.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const np = P.importPreset(String(reader.result || ''));
            showToast('已导入预设：' + np.name);
            refreshPresetManage();
          } catch (e) {
            showToast('导入失败: ' + (e && e.message || e), true);
          }
        };
        reader.onerror = () => showToast('读取文件失败', true);
        reader.readAsText(f, 'utf-8');
        // 清空 value 以便重复选同一文件
        impFile.value = '';
      };
    }
  }


  // ── 注入自检卡（只读）：读 WORLD_ENGINE_INJECT_INSPECTOR 最后一份快照，
  //    用大白话+role 分好的消息链回答「世界状态到底有没有真进发给大模型的 prompt」。
  //    数据全来自 inspector 只读快照；本函数纯拼 HTML，不触发任何副作用。
  //    返回的是 .we-prompt-debug 内部片段（折叠头复用 data-we-seg-toggle，由 bindPromptSegToggle 统一接管）。
  function renderInjectInspector(scope) {
    const memoryScope = scope === 'memory';
    const engine = window.MEMORY_ENGINE;
    const insp = window.WORLD_ENGINE_INJECT_INSPECTOR;
    const snap = insp?.getLastSnapshot?.(memoryScope ? 'memory' : 'world')
      || (memoryScope ? engine?.getLastInjectionDebug?.() : null)
      || (memoryScope ? engine?.getLastDebug?.()?.injection : null)
      || null;
    const status = snap ? snap.status : 'NOT_YET';
    const fallbackText = memoryScope ? {
      NOT_YET: '尚未生成，暂无记忆注入记录',
      SKIPPED_DISABLED: '本轮未注入：记忆注入已关闭',
      SKIPPED_REROLL: '本轮按设计未注入：同层重 roll',
      SKIPPED_OTHER: '本轮未注入：没有匹配到相关记忆',
      SUCCESS: '✅ 本轮记忆信息已进入正文',
      MISSING: '❌ 已注册却没进最终 prompt'
    } : {};
    const text = insp?.statusText ? insp.statusText(status, memoryScope ? 'memory' : 'world') : (fallbackText[status] || fallbackText.NOT_YET || '');
    const subject = memoryScope ? '人物记忆' : '世界状态';

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
      html += '<div style="font-size:11px;color:var(--we-text3);">发一条消息触发生成后，这里会显示「' + subject + '」有没有真正进入发给大模型的正文 prompt。</div>';
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

    // role 徽标
    const roleColor = { system: '#a371f7', user: '#58a6ff', assistant: '#3fb950', tool: '#d29922' };
    const roleBadge = (role) => {
      const c = roleColor[role] || 'var(--we-text3)';
      return '<span style="display:inline-block;min-width:62px;text-align:center;font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid ' + c + ';color:' + c + ';">' + h(role || '?') + '</span>';
    };

    if (snap.apiType === 'chat' && Array.isArray(snap.messages)) {
      html += '<div style="font-size:11px;color:var(--we-text2);margin-bottom:4px;">实际发出的消息链（共 ' + h(String(snap.messageCount)) + ' 条，按 role 分；点击任意条展开看完整内容）：</div>';
      html += snap.messages.map((m) => {
        const meta = (m.length != null ? m.length + ' 字' : '');
        const hasBody = (m.content != null && m.content.length > 0);
        if (m.isOurs) {
          // 本扩展注入那条：可折叠，展开看完整注入内容。
          const body = '<pre class="we-prompt-seg-pre">' + u(m.content || snap.ourContent || '') + '</pre>';
          return '<div class="we-prompt-seg-card" style="margin:3px 0;">'
            + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
            + '<span class="we-prompt-seg-arrow">▶</span>'
            + roleBadge(m.role)
            + '<span class="we-prompt-seg-label" style="color:#3fb950;">✅ 含本扩展注入</span>'
            + '<span class="we-prompt-seg-meta">' + meta + '</span>'
            + '</div>'
            + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
            + '</div>';
        }
        // 其它消息：也可折叠展开看完整内容（只读，不写任何存储）
        if (hasBody) {
          const body = '<pre class="we-prompt-seg-pre">' + u(m.content) + '</pre>';
          return '<div class="we-prompt-seg-card" style="margin:3px 0;">'
            + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
            + '<span class="we-prompt-seg-arrow">▶</span>'
            + roleBadge(m.role)
            + '<span class="we-prompt-seg-meta">' + meta + '</span>'
            + '</div>'
            + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
            + '</div>';
        }
        // 空内容：只读一行
        return '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px;color:var(--we-text3);">'
          + roleBadge(m.role)
          + '<span>' + meta + '</span>'
          + '</div>';
      }).join('');
    } else if (snap.apiType === 'text') {
      html += '<div style="font-size:11px;color:var(--we-text2);margin-bottom:4px;">文本补全 prompt 共 ' + h(String(snap.promptLength || 0)) + ' 字（已 flatten 成单串，无 role 之分）：</div>';
      if (snap.landed && snap.ourExcerpt) {
        const body = '<pre class="we-prompt-seg-pre">' + u(snap.ourExcerpt) + '</pre>';
        html += '<div class="we-prompt-seg-card" style="margin:3px 0;">'
          + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
          + '<span class="we-prompt-seg-arrow">▶</span>'
          + '<span class="we-prompt-seg-label" style="color:#3fb950;">✅ 哨兵命中处摘录</span>'
          + '</div>'
          + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
          + '</div>';
      }
    }

    return html + '</div>';
  }

  // [FIX] renderDebug：推演 prompt 全透明分段展示（只读，不改可编辑）。
  // 把推演 API 收到的整块 prompt 按 10 段拆开折叠展示 + AI 返回 JSON 高亮，只看最新一轮。
  // 数据源 evo.getLastDebug().segments（evolution.js 拼装侧镜像，与实际发出 prompt 字节级一致）。
  function renderDebug() {
    // 注入自检卡独立于推演数据：每次生成都会更新，故即便尚未推演也要先展示它。
    //   整块仍包在 .we-prompt-debug 里，复用 bindPromptSegToggle 的单一委托接管折叠。
    const injectCard = renderInjectInspector();
    const evo = window.WORLD_ENGINE_EVOLUTION;
    const wrap = (inner) => '<div class="we-prompt-debug">' + injectCard + inner + '</div>';
    if (!evo || !evo.getLastDebug) return wrap('<div class="we-empty">调试数据不可用</div>');
    const dbg = evo.getLastDebug();
    if (!dbg || !dbg.prompt) return wrap('<div class="we-empty">尚未推演，暂无调试数据</div>');

    const segments = Array.isArray(dbg.segments) ? dbg.segments : [];
    const totalLen = dbg.prompt.length || 0;
    // 段占比微条：每段宽度按字数占比
    const barHtml = segments.length
      ? '<div class="we-prompt-seg-bar">' + segments.map(seg => {
          const len = (seg.content || '').length;
          const pct = totalLen ? (len / totalLen * 100) : 0;
          return '<span class="we-prompt-seg-bar-cell" style="width:' + pct.toFixed(2) + '%" title="' + u(seg.label) + ' ' + len + '字"></span>';
        }).join('') + '</div>'
      : '';

    // 尝试把 content 里第一个 JSON 对象 pretty-print（用于状态段/示例段高亮）
    const tryPrettyJson = (text) => {
      if (!text) return null;
      const api = window.WORLD_ENGINE_API;
      // 直接 JSON.parse 失败则用 api.parseJSON 容错
      let obj = null;
      try { obj = JSON.parse(text); } catch (e) {
        if (api && api.parseJSON) { try { obj = api.parseJSON(text); } catch (e2) {} }
      }
      if (obj === null || typeof obj !== 'object') return null;
      try { return JSON.stringify(obj, null, 2); } catch (e) { return null; }
    };

    // 单段折叠卡片
    const segCard = (idx, seg) => {
      const content = seg.content || '';
      const len = content.length;
      const pct = totalLen ? (len / totalLen * 100).toFixed(1) : '0.0';
      const isEmpty = len === 0;
      // 状态段/示例段尝试 JSON 高亮
      let bodyHtml;
      if (isEmpty) {
        bodyHtml = '<div class="we-prompt-seg-empty">本轮未启用</div>';
      } else {
        const pretty = tryPrettyJson(content);
        const shown = pretty !== null ? pretty : content;
        bodyHtml = '<pre class="we-prompt-seg-pre' + (pretty !== null ? ' we-prompt-seg-pre-json' : '') + '">' + u(shown) + '</pre>';
      }
      return '<div class="we-prompt-seg-card" data-we-seg-key="' + u(seg.key) + '">'
        + '<div class="we-prompt-seg-head" data-we-seg-toggle>'
        + '<span class="we-prompt-seg-arrow">▶</span>'
        + '<span class="we-prompt-seg-label">' + u(seg.label) + '</span>'
        + '<span class="we-prompt-seg-meta">' + (isEmpty ? '空' : (len + '字 · ' + pct + '%')) + '</span>'
        + '</div>'
        + '<div class="we-prompt-seg-body" style="display:none;">' + bodyHtml + '</div>'
        + '</div>';
    };

    // AI 返回卡
    const rawResult = dbg.rawResult || '';
    const rawLen = rawResult.length;
    const parsedJson = tryPrettyJson(rawResult);
    const rawBodyHtml = rawLen
      ? (parsedJson !== null
          ? '<pre class="we-prompt-seg-pre we-prompt-seg-pre-json">' + u(parsedJson) + '</pre>'
          : '<pre class="we-prompt-seg-pre">' + u(rawResult) + '</pre>')
      : '<div class="we-prompt-seg-empty">无 API 返回</div>';
    const rawCard = '<div class="we-prompt-seg-card we-prompt-seg-card-raw">'
      + '<div class="we-prompt-seg-head" data-we-seg-toggle>'
      + '<span class="we-prompt-seg-arrow">▶</span>'
      + '<span class="we-prompt-seg-label">AI 返回（推演 API 原始结果）</span>'
      + '<span class="we-prompt-seg-meta">' + (rawLen ? (rawLen + '字' + (parsedJson !== null ? ' · JSON 已解析' : ' · 未能解析为 JSON')) : '空') + '</span>'
      + '</div>'
      + '<div class="we-prompt-seg-body" style="display:none;">' + rawBodyHtml + '</div>'
      + '</div>';

    return ''
      + '<div class="we-prompt-debug">'
      + injectCard
      + '<div class="we-prompt-debug-summary">发送给推演 API 的 Prompt 共 ' + totalLen + ' 字，分 ' + segments.length + ' 段（只读展示，与实际发出字节一致）</div>'
      + barHtml
      + '<div class="we-prompt-seg-list">' + segments.map((seg, i) => segCard(i, seg)).join('') + '</div>'
      + rawCard
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
    // 按时间模式的当前值
    const _stForTime = core.hasState() ? core.loadState() : null;
    const _cpForTime = core.restoreCheckpoint();
    const stTimeVal = (_stForTime && _stForTime.time != null) ? _stForTime.time : '';
    const cpTimeVal = (_cpForTime && _cpForTime.time != null) ? _cpForTime.time : '';
    const lastDayVal = (core.getLastStoryDay && core.getLastStoryDay() != null) ? core.getLastStoryDay() : '';
    const tv = (k, d) => (settings[k] != null && settings[k] !== '') ? settings[k] : d;
    const apiTemperature = Number.isFinite(Number(settings.temperature)) ? Math.max(0, Number(settings.temperature)) : 0.7;
    const apiMaxTokens = Math.max(1, parseInt(settings.maxTokens) || 2000);
    const apiAutoRetries = Math.max(0, parseInt(settings.apiAutoRetries) || 0);
    const apiTimeoutMs = Number.isFinite(Number(settings.apiTimeoutMs)) ? Number(settings.apiTimeoutMs) : 120000;
    const apiTimeoutSec = Math.max(0, Math.round(apiTimeoutMs / 1000));
    const injectMaxChars = Number.isFinite(Number(settings.injectMaxChars)) ? Math.max(0, Math.floor(Number(settings.injectMaxChars))) : 5000;

    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';

    const apiBody = `
      <div class="we-input-group">
        <label>连接方式</label>
        <select id="we-connection-mode" style="width:100%;">
          <option value="direct" ${settings.connectionMode !== 'proxy' ? 'selected' : ''}>直连（默认）</option>
          <option value="proxy" ${settings.connectionMode === 'proxy' ? 'selected' : ''}>经酒馆代理（解决跨域 CORS）</option>
        </select>
        <div style="font-size:11px;color:#888;margin-top:3px;">连不上 / 控制台报 CORS 错误时，切到「经酒馆代理」由酒馆服务端转发。</div>
      </div>
      <div class="we-input-group">
        <label>API URL（OpenAI 兼容）</label>
        <input type="text" id="we-api-url" value="${u(settings.apiUrl||'')}" placeholder="https://api.openai.com/v1">
        <div style="font-size:11px;color:#888;margin-top:3px;">填到「版本前缀」一级即可，/chat/completions 可加可不加（会自动补）。例：OpenAI <span style="color:#aaa;">https://api.openai.com/v1</span>；火山方舟 <span style="color:#aaa;">https://ark.cn-beijing.volces.com/api/v3</span>（或 <span style="color:#aaa;">.../api/coding/v3</span>）。务必带上自己的版本前缀。</div>
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
      </div>`;

    const evolveBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-world-engine-enabled" ${settings.engineEnabled !== false ? 'checked' : ''}>
          启用世界引擎
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">关闭后停止世界推演与世界状态注入，不影响记忆引擎。</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-first-layer-ai-opening" ${settings.firstLayerIsAiOpening !== false ? 'checked' : ''}>
          首楼为 AI 开场白
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">默认勾选：批量重填忽略第 0 层；取消勾选后，第 0 层按普通对话参与重填。</div>
      </div>
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
            <button class="we-btn" id="we-btn-filter-scan" type="button">🔍 扫描本聊天标签</button>
            <input type="text" id="we-filter-add-input" placeholder="手动加标签名(如 tucao)" style="flex:1;min-width:140px;">
            <button class="we-btn" id="we-btn-filter-add" type="button">+ 添加</button>
          </div>
          <div id="we-filter-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:4px;"></div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">自动生成的正则不一定生效——标签带属性(如 &lt;wlog time&gt;)、带 ~(如 &lt;konatan_planning~&gt;)、嵌套或闭标签异常时可能匹配失败。不生效请直接编辑下方文本框自行手写。未勾选标签不会保存。</div>
        </div>
        <textarea id="we-filter-regex" rows="4" style="width:100%;resize:vertical;" placeholder="每行一条；支持纯 pattern 或 /pattern/flags 字面量。例：\n<details>[\\s\\S]*?</details>\\n?\n/&lt;think&gt;[\\s\\S]*?&lt;\\/think&gt;/g">${u(tv('evolveFilterRegex',''))}</textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px;">
          <button class="we-btn" id="we-btn-filter-test" type="button">▶ 测试正则</button>
        </div>
        <div class="we-hint" id="we-filter-status" style="margin:0 0 4px;white-space:pre-wrap;"></div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">每行一条；支持纯 pattern（默认 g 全局）或 /pattern/flags 字面量（如 /.../gi）；空行忽略。仅影响喂后台推演的文本，不影响聊天正文与日期抓取。保存时自动校验每条，测试按钮可对最近一条对话试跑。</div>
      </div>`;

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
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">勾选后，事件链和风声的 Lv1–Lv4 全部注入正文；不勾选时，风声仅注入 Lv3/4，事件链注入 Lv3/4 以及 Lv1/2 中已爆发或已完成的事件。</div>
      </div>`;

    const linkBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-memory-link-enabled" ${settings.memoryLinkEnabled === true ? 'checked' : ''}>
          世界推演完成后联动记忆引擎
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">开启后，世界 API 的本轮返回会交给记忆 API 更新人物与实体，并把世界摘要新增为一条纪要。同楼层重 roll 使用独立联动 checkpoint 整体撤销旧结果后重做，不覆盖世界或记忆引擎原有 checkpoint。</div>
      </div>`;

    const displayMode = settings.displayMode === 'expand' ? 'expand' : 'mask';
    const currentTheme = getStoredTheme();
    const themeOptions = WE_THEMES.map(theme =>
      `<option value="${theme.id}" ${theme.id === currentTheme ? 'selected' : ''}>${theme.name}</option>`
    ).join('');
    const displayBody = `
      <div class="we-input-group">
        <label>主题配色</label>
        <select id="we-theme-select" style="width:100%;">${themeOptions}</select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">即时应用并自动记忆。深色：墨玉、夜阑、深海、夜合；浅色：云白、早樱。</div>
      </div>
      <div class="we-input-group">
        <label>主页显示模式</label>
        <select id="we-display-mode" style="width:100%;">
          <option value="mask" ${displayMode === 'mask' ? 'selected' : ''}>遮蔽模式（主页 + 分页进入）</option>
          <option value="expand" ${displayMode === 'expand' ? 'selected' : ''}>展开模式（所有内容平铺）</option>
        </select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">展开模式下世界摘要下方直接平铺全部 section，无需进分页。</div>
      </div>`;

    // 酒馆缓存与存档：存进当前聊天的 chat_metadata（随聊天文件保存到酒馆服务器，跨设备同步）。
    // 列表与状态在 bindEvents → setupChatcacheSection() 里动态填充。
    const chatcacheBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-sync-to-chat" ${settings.syncToChat === true ? 'checked' : ''}>
          跨设备实时同步（存进当前聊天）
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">开启后，本聊天的世界状态会持续写入酒馆聊天文件并随之跨设备同步；换设备打开同一聊天即可续上进度（冲突时较新版本胜出）。<b>不会</b>同步 API Key 等全局设置。</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-auto-backup" ${settings.autoBackup === true ? 'checked' : ''}>
          自动滚动备份（每当轮次推进存一条，保留最近 ${'3'} 条）
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">防误删误改。自动备份与命名存档都保存在本聊天里，跨设备可见。</div>
      </div>
      <div class="we-hint" id="we-chatcache-status" style="margin:4px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-chatcache-save">新建命名存档</button>
        <button class="we-btn" id="we-chatcache-import">导入存档</button>
        <input type="file" id="we-chatcache-import-file" accept=".json" style="display:none;">
      </div>
      <div class="we-chatcache-list" id="we-chatcache-snapshots"><div class="we-empty">暂无存档</div></div>`;

    // 批量重填世界推演：从第 1 个 AI 楼层分批推到指定楼层（清空重来）。
    const bf = (k, d) => { const v = settings[k]; return (v === undefined || v === null || v === '') ? d : v; };
    const backfillBody = `
      <div style="font-size:11px;color:var(--we-text3);margin-bottom:6px;">从第 1 个 AI 楼层开始，<b>分批</b>把世界状态重新推演到指定楼层。每批仅喂本批楼层的对话，但世界状态逐批累积、保持连贯。<b>会清空当前世界状态推倒重来</b>（开始前自动存一份备份快照）。</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>每批 AI 楼层数</label>
          <input type="number" id="we-backfill-batch" min="1" step="1" value="${bf('backfillBatchSize', 5)}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>结束楼层（0=全部）</label>
          <input type="number" id="we-backfill-end" min="0" step="1" value="${bf('backfillEndLayer', 0)}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>每批重试次数</label>
          <input type="number" id="we-backfill-retries" min="0" step="1" value="${bf('backfillRetries', 2)}"></div>
      </div>
      <div class="we-hint" id="we-backfill-status" style="margin:6px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-backfill-start">▶ 开始重填世界推演</button>
        <button class="we-btn" id="we-backfill-stop">■ 停止</button>
      </div>`;

    // [FIX] 选项卡化：返回按 section 分好的片段字典，由 renderSettingsView 归入各选项卡。
    //   每个 sec(...) 调用、body 内容、字段 id 与原先一字不改，只是不再直接拼成一串。
    const mech = (k, d) => { const v = settings[k]; return (v === undefined || v === null || v === '') ? d : v; };
    const numInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="flex:1;min-width:112px;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const compactNumInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="flex:1 1 0;min-width:0;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const wideNumInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="width:100%;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const mechanicsResetButton = (group) =>
      '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">'
      + '<button class="we-btn" type="button" data-we-mechanics-reset="' + group + '"><i class="fa-solid fa-arrow-rotate-left"></i> 恢复默认</button>'
      + '</div>';
    const regionalBody = `
      ${mechanicsResetButton('regional')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        区域突发事件是纯本地骰子：先由本地判定是否发生，再把事件类型和约束交给推演模型写成世界变化。
        概率越高，远方灾变、治安事件、交通断裂这类背景波动越频繁。
      </div>
      <div class="we-input-group">
        <label>区域突发事件参数</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-ri-chance', 'localRegionalIncidentChancePercent', '触发概率 %', 3, 0, '0.1')}
          ${numInput('we-local-ri-duration', 'localRegionalIncidentDuration', '持续轮数', 5, 1, '1')}
          ${numInput('we-local-ri-cooldown', 'localRegionalIncidentCooldown', '消散后冷却', 5, 1, '1')}
        </div>
      </div>`;

    const distantBody = `
      ${mechanicsResetButton('distant')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        生成一条与主角及既有账本无直接关系的远方事件链或风声（Lv2/Lv3）。<br>
        账本门槛：至少积累多少轮账本后才启用；触发概率：每个可触发轮命中的概率；成功后冷却：成功生成后暂停掷骰的轮数；事件链占比：命中后生成事件链的概率，剩余比例生成风声。
      </div>
      <div class="we-input-group">
        <label>远方随机事件参数</label>
        <div style="display:flex;gap:6px;flex-wrap:nowrap;">
          ${compactNumInput('we-local-distant-threshold', 'localDistantEventLedgerThreshold', '账本门槛', 10, 1, '1')}
          ${compactNumInput('we-local-distant-chance', 'localDistantEventChancePercent', '触发概率 %', 20, 0, '0.1')}
          ${compactNumInput('we-local-distant-cooldown', 'localDistantEventCooldown', '成功后冷却', 5, 1, '1')}
          ${compactNumInput('we-local-distant-event-percent', 'localDistantEventEventPercent', '事件链占比 %', 50, 0, '0.1')}
        </div>
      </div>`;

    const nearBody = `
      ${mechanicsResetButton('near')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        生成一条与当前对话、主角或所在区域有明确因果关系的近端事件链或风声（Lv2/Lv3）。<br>
        触发概率：每个可触发轮命中的概率；成功后冷却：成功生成后暂停掷骰的轮数；事件链占比：命中后生成事件链的概率，剩余比例生成风声。
      </div>
      <div class="we-input-group">
        <label>近端随机事件参数</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-near-chance', 'localNearEventChancePercent', '触发概率 %', 20, 0, '0.1')}
          ${numInput('we-local-near-cooldown', 'localNearEventCooldown', '成功后冷却', 5, 1, '1')}
          ${numInput('we-local-near-event-percent', 'localNearEventEventPercent', '事件链占比 %', 50, 0, '0.1')}
        </div>
      </div>`;

    const retryBody = `
      <div class="we-input-group">
        <label>API 异常自动重试次数（X）</label>
        <input type="number" id="we-api-auto-retries" min="0" step="1" value="${apiAutoRetries}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">默认 0 = 不重试。除主动停止或切换聊天造成的中止外，空返回、乱码、解析失败、HTTP 错误、超时和网络错误都会额外重试 X 次；总请求次数最多为 1 + X。</div>
      </div>`;

    const diceBody = `
      ${mechanicsResetButton('dice')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        每条事件链每轮掷 1d100。设阶段格数 r = 当前格数 / 9。<br>
        目标值 T = 阶段基础值 - 200 × r × (1 - r) + Lv修正 - 全局推进修正。<br>
        若 骰值 &gt; T：推进一格；若 骰值 &lt; T × 受挫系数：倒退一格；否则保持。<br>
        冲突型 Lv 修正 = -(Lv - 1) × 10，Lv 越高越容易爆发。推进型 Lv 修正 = +(Lv - 1) × 10，Lv 越高越难完成。
      </div>
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
      ${mechanicsResetButton('winddecay')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        风声本轮没有被同 ID 更新时，沉寂轮数 +1。沉寂轮数 ≤ grace 时不检查消散。<br>
        超过 grace 后：n = 沉寂轮数 - grace - 1。<br>
        消散率 P = clamp(base + linear × n + quadratic × n² - (Lv - 1) × 10, 5, 95)。<br>
        掷 1d100，若 骰值 ≤ P，则该风声消散。Lv 越高，越不容易消散。
      </div>
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
      ${mechanicsResetButton('retention')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        这里控制“东西在面板里留多久”和“每类最多存多少”。<br>
        正面终局事件（已爆发 / 已完成）保留轮数 = 基础保留 + Lv × 每级额外保留。<br>
        负面终局事件（已消散 / 已失败）下一轮清退；影响链、已终结仇敌、账本分别按各自保存轮数清退。
      </div>
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

    return {
      api: sec('set-api', 'API 配置', apiBody),
      evolve: sec('set-evolve', '推演模式', evolveBody),
      backfill: sec('set-backfill', '批量重填世界推演', backfillBody),
      retry: sec('set-api-retry', 'API 自动重试', retryBody),
      mechanics: sec('set-regional', '区域事件', regionalBody)
        + sec('set-near', '近端随机事件', nearBody)
        + sec('set-distant', '远方随机事件', distantBody)
        + sec('set-dice', '事件骰子', diceBody)
        + sec('set-winddecay', '风声消散', winddecayBody)
        + sec('set-retention', '保留上限', retentionBody),
      filter: sec('set-filter', '输入输出过滤器', filterBody),
      display: sec('set-display', '界面显示', displayBody),
      chatcache: sec('set-chatcache', '酒馆缓存与存档', chatcacheBody),
      inject: sec('set-inject', '正文注入', injectBody),
      link: sec('set-world-memory-link', '世界 → 记忆', linkBody)
    };
  }

  function renderSettingsAfterCheckpoint(options) {
    const memoryScope = options?.scope === 'memory';
    const settings = memoryScope
      ? (window.MEMORY_ENGINE_SETTINGS?.getSettings() || {})
      : ((window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings) ? window.WORLD_ENGINE_API.getSettings() : {});
    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';
    const worldbookBody = `
      <div class="we-worldbook-settings">
        <div class="we-input-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="we-worldbook-trigger" ${settings.worldbookTrigger === true ? 'checked' : ''}>
            启用蓝绿灯触发（跟随酒馆世界书）
          </label>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">关闭时：已选条目全部注入推演（现状）。开启后：🔵常驻条目恒注入，🟢关键词条目仅在近期对话命中其关键词时注入；每条可单独覆写。关键词扫描由本扩展自行完成，与酒馆解耦。</div>
        </div>
        <div class="we-worldbook-header">
          <div><div class="we-worldbook-summary" id="we-worldbook-summary">正在读取当前聊天世界书...</div></div>
          <button class="we-icon-btn" id="we-worldbook-reload" title="重新读取当前聊天世界书"><i class="fa-solid fa-rotate"></i></button>
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
    const toneBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-tone-import">导入</button>
        <button class="we-btn" id="we-tone-export">导出</button>
        <button class="we-btn" id="we-tone-clear">清除</button>
        <input type="file" id="we-tone-file" accept=".txt" style="display:none;">
      </div>
      <div class="we-hint" id="we-tone-status" style="margin-top:6px;"></div>`;
    // [FIX] 选项卡化：同样返回片段字典
    return {
      worldbook: sec('set-worldbook', memoryScope ? '记忆推演世界书' : '后台推演世界书', worldbookBody),
      data: sec('set-data', '数据导入/导出', dataBody),
      tone: sec('set-tone', '附加提示词', toneBody)
    };
  }

  function bindEvents(state) {
    const themeSelect = document.getElementById('we-theme-select');
    if (themeSelect) themeSelect.onchange = () => setTheme(themeSelect.value);
    const memoryThemeSelect = document.getElementById('we-memory-theme-select');
    if (memoryThemeSelect) memoryThemeSelect.onchange = () => setMemoryTheme(memoryThemeSelect.value);

    document.querySelectorAll('[data-we-mechanics-reset]').forEach(button => {
      button.onclick = () => {
        const group = button.dataset.weMechanicsReset;
        const defaults = MECHANICS_DEFAULT_FIELDS[group];
        if (!defaults) return;
        for (const [id, value] of Object.entries(defaults)) {
          const input = document.getElementById(id);
          if (input) value === null ? input.value = '' : input.value = String(value);
        }
        showToast('已恢复本区默认值，点击“保存设置”后生效');
      };
    });

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
        delete copy.id;
        delete copy.evolveResult;
        core.ensureEventFields(copy);
        core.assignEntityId(scopedState.events, copy, core.ENTITY_ID_PREFIXES.events);
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
          const K = localTerminalKeepRounds(event);
          const curRound = scopedState.round || 0;
          let left = Number(editor.querySelector('.we-event-edit-left').value);
          left = Number.isFinite(left) && left >= 1 ? Math.min(K, left) : K;
          event._terminalSince = curRound - K + left - 1;
        } else {
          delete event._terminalSince;
        }
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
        core.assignEntityId(state.factions, copy, core.ENTITY_ID_PREFIXES.factions);
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
        core.assignEntityId(scopedState.winds, copy, core.ENTITY_ID_PREFIXES.winds);
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
        core.assignEntityId(scopedState.worldTrends, copy, core.ENTITY_ID_PREFIXES.worldTrends);
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
        core.assignEntityId(state.enemies, copy, core.ENTITY_ID_PREFIXES.enemies);
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

    // ===== 世界摘要编辑器事件（仅编辑，不提供复制或删除） =====
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
    if (settingsOpenBtn) settingsOpenBtn.onclick = () => {
      const face = getEngineFace();
      if (typeof face.openSettings === 'function') face.openSettings();
      else if (face.id === 'world') _currentView = 'settings';
      refresh();
    };

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

    // [FIX] 设置页选项卡切换：纯 CSS 显隐，不重新渲染（保护输入内容 + 字段常驻 DOM 保证保存不丢）
    document.querySelectorAll('.we-settings-tab').forEach(tab => {
      tab.onclick = () => {
        const key = tab.dataset.tab;
        const face = getEngineFace();
        if (typeof face.onSettingsTab === 'function') face.onSettingsTab(key);
        else _settingsTab = key;
        document.querySelectorAll('.we-settings-tab').forEach(t =>
          t.classList.toggle('we-settings-tab--active', t.dataset.tab === key));
        document.querySelectorAll('.we-settings-panel').forEach(p =>
          p.style.display = (p.dataset.tab === key) ? '' : 'none');
        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        // [FIX] 切到调试 tab 时，局部刷新 renderDebug 拉最新一轮推演数据（不动其它 tab 输入）
        if (key === 'debug') {
          if (typeof face.refreshDebug === 'function') face.refreshDebug();
          else { refreshDebugRender(); refreshPresetManage(); }
        }
      };
    });

    // 「关于」卡内的版本下拉切换：复用 #we-preset-select 范式（点击弹出原生可滚动列表）。
    //   纯 CSS 显隐、不重渲染、不触碰其它 tab。
    const settingsTabs = document.getElementById('we-settings-tabs');
    const updateSettingsTabScroll = () => {
      if (!settingsTabs) return;
      const shell = settingsTabs.closest('.we-settings-tabs-shell');
      if (!shell) return;
      const max = Math.max(0, settingsTabs.scrollWidth - settingsTabs.clientWidth);
      shell.classList.toggle('is-left-shadow', settingsTabs.scrollLeft > 2);
      shell.classList.toggle('is-right-shadow', settingsTabs.scrollLeft < max - 2);
      shell.querySelectorAll('.we-settings-tab-scroll').forEach(btn => {
        const dir = Number(btn.dataset.dir) || 1;
        btn.disabled = max <= 2 || (dir < 0 ? settingsTabs.scrollLeft <= 2 : settingsTabs.scrollLeft >= max - 2);
      });
    };
    if (settingsTabs) {
      settingsTabs.addEventListener('scroll', updateSettingsTabScroll, { passive: true });
      const activeTab = settingsTabs.querySelector('.we-settings-tab--active');
      if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'center' });
      document.querySelectorAll('.we-settings-tab-scroll').forEach(btn => {
        btn.onclick = () => {
          const dir = Number(btn.dataset.dir) || 1;
          settingsTabs.scrollBy({ left: dir * Math.max(120, settingsTabs.clientWidth * 0.65), behavior: 'smooth' });
        };
      });
      setTimeout(updateSettingsTabScroll, 0);
    }

    const clSel = document.getElementById('we-changelog-select');
    if (clSel) {
      clSel.onchange = () => {
        const ver = clSel.value;
        document.querySelectorAll('.we-changelog-panel').forEach(p =>
          p.style.display = (p.dataset.ver === ver) ? '' : 'none');
      };
    }

    const refreshBtn = document.getElementById('we-btn-refresh');
    if (refreshBtn) refreshBtn.onclick = () => refresh();

    // 旧版内联绑定保留一个版本作兼容参考，但运行时统一走 bindFilterControls(scope)。
    if (false) {
    // —— 正则过滤：状态行渲染 + 测试按钮 ——
    // 把 core.validateFilterRegex 的结果写成 we-hint 状态行（复用 chatcache/backfill 的 we-hint 范式）。
    function renderFilterStatus(v, prefix) {
      const el = document.getElementById('we-filter-status');
      if (!el) return;
      const pfx = prefix || '';
      if (!v || (!v.ok && !v.bad.length)) { el.textContent = pfx + '（未填写正则）'; return; }
      if (!v.bad.length) { el.textContent = pfx + `✅ ${v.ok} 条全部生效`; return; }
      let s = pfx + `⚠️ ${v.ok} 条生效 / ${v.bad.length} 条失败：`;
      for (const b of v.bad) s += `\n行 ${b.line} 「${b.raw}」无效：${b.reason}`;
      el.textContent = s;
    }

    const testBtn = document.getElementById('we-btn-filter-test');
    if (testBtn) {
      testBtn.onclick = () => {
        const core = window.WORLD_ENGINE_CORE;
        const raw = (document.getElementById('we-filter-regex')?.value) || '';
        if (!raw.trim()) { showToast('未填写正则', true); renderFilterStatus(null); return; }
        if (!core || !core.validateFilterRegex) { showToast('core 模块不可用', true); return; }
        const v = core.validateFilterRegex(raw);
        if (v.bad.length) { renderFilterStatus(v, '测试中止——'); showToast(`有 ${v.bad.length} 条正则无效，请先修正`, true); return; }
        // 取最近一条非空对话文本（不限 user/ai，沿用 manualEvolve 取 chat 的范式）
        let sample = '';
        try {
          const ctx = SillyTavern.getContext();
          const chat = (ctx && ctx.chat) || [];
          for (let i = chat.length - 1; i >= 0; i--) {
            const t = chat[i] && String(chat[i].mes || '').trim();
            if (t) { sample = String(chat[i].mes); break; }
          }
        } catch (e) {}
        if (!sample) { showToast('当前聊天没有可测试的文本', true); return; }
        // 跑过滤 + 按顺序累计删除处数（与 filterDialogue 同序：每条在前一条的结果上 replace）
        let removed = 0, work = sample;
        for (const e of v.entries) {
          try {
            const re = new RegExp(e.pattern, e.flags);
            let m, n = 0;
            while ((m = re.exec(work)) !== null) { n++; if (m.index === re.lastIndex) re.lastIndex++; }
            work = work.replace(re, '');
            removed += n;
          } catch (err) { /* 不会进入 */ }
        }
        const filtered = work;
        const before = sample.slice(0, 60), after = filtered.slice(0, 60);
        const el = document.getElementById('we-filter-status');
        if (el) el.textContent = `已删除 ${removed} 处。\n前: ${before}${sample.length > 60 ? '…' : ''}\n后: ${after}${filtered.length > 60 ? '…' : ''}`;
        showToast(`已删除 ${removed} 处`);
      };
    }

    // —— 正则过滤「简单模式」：勾选标签自动生成 <tag>[\s\S]*?</tag>\n? ——
    // 解耦：底层仍是 #we-filter-regex 文本框(evolveFilterRegex 字段)为唯一真相源。
    //   勾选 ↔ 文本框双向同步；非 <tag> 形式的行(用户手写杂项)原样保留，不进勾选清单。
    // 反解析只认标准 <tag>...</tag> 形式；带 ~? / 带属性 / /pat/g / 纯 pattern 杂项 → 视为高级手写，保留。
    const SIMPLE_TAG_LINE = /^<([a-zA-Z_][\w-]*)>[\s\S]*?<\/\1>(?:\\n\?)?$/;
    const SCAN_TAG_RE = /<([a-zA-Z_][\w-]*)/g;

    // 当前标签清单：{ name, checked }[]。无状态派生物，从 textarea 反解析 + 扫描/手动添加累积。
    let _filterTags = [];

    // 从 textarea 反解析出标准 <tag> 形式的勾选标签（非标准行视为高级手写，返回 tags + 保留的杂项行）
    function parseTextareaTags(raw) {
      const tags = [];
      const advanced = [];
      for (const line of String(raw || '').split('\n')) {
        const m = line.match(SIMPLE_TAG_LINE);
        if (m) { if (!tags.includes(m[1])) tags.push(m[1]); }
        else if (line.trim()) advanced.push(line);
      }
      return { tags, advanced };
    }

    // 勾选标签 → 生成标准模板行；与高级手写行合并写回 textarea
    function writeTextareaFromTags(checkedTags, advancedLines) {
      const tagLines = checkedTags.map(t => `<${t}>[\\s\\S]*?</${t}>\\n?`);
      const all = tagLines.concat(advancedLines);
      const ta = document.getElementById('we-filter-regex');
      if (ta) ta.value = all.join('\n');
    }

    // 渲染勾选清单 chip 列表
    function renderFilterTags() {
      const box = document.getElementById('we-filter-tags');
      if (!box) return;
      box.innerHTML = '';
      for (const t of _filterTags) {
        const chip = document.createElement('label');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border:1px solid var(--we-border,#3a3a3a);border-radius:3px;font-size:12px;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!t.checked;
        cb.onchange = () => {
          t.checked = cb.checked;
          syncTextareaFromTags();
        };
        const name = document.createElement('span'); name.textContent = t.name;
        const del = document.createElement('span');
        del.textContent = '✕'; del.style.cssText = 'color:var(--we-text3);cursor:pointer;margin-left:2px;';
        del.onclick = (e) => { e.preventDefault(); _filterTags = _filterTags.filter(x => x.name !== t.name); renderFilterTags(); syncTextareaFromTags(); };
        chip.appendChild(cb); chip.appendChild(name); chip.appendChild(del);
        box.appendChild(chip);
      }
    }

    // 勾选变化 → 写回 textarea（保留高级手写行）
    function syncTextareaFromTags() {
      const ta = document.getElementById('we-filter-regex');
      const raw = ta ? ta.value : '';
      const { advanced } = parseTextareaTags(raw);
      const checked = _filterTags.filter(t => t.checked).map(t => t.name);
      writeTextareaFromTags(checked, advanced);
    }

    // textarea 手改 → 反解析更新勾选清单（保留清单里已有的非标准标签的勾选态）
    let _taSyncTimer = null;
    function syncTagsFromTextarea() {
      const ta = document.getElementById('we-filter-regex');
      if (!ta) return;
      const { tags } = parseTextareaTags(ta.value);
      // tags 是 textarea 里标准 <tag> 行对应的标签名（视为已勾选）
      const tagSet = new Set(tags);
      // 已在清单里的：按 textarea 是否还认它更新 checked；不在清单里的标准标签：加进去（勾选）
      for (const t of _filterTags) t.checked = tagSet.has(t.name);
      for (const name of tags) {
        if (!_filterTags.some(t => t.name === name)) _filterTags.push({ name, checked: true });
      }
      renderFilterTags();
    }

    // 扫描最新一条 AI 回复，提取其中出现的 <xxx 标签名
    function scanTagsFromLastAI() {
      let text = '';
      try {
        const ctx = SillyTavern.getContext();
        const chat = (ctx && ctx.chat) || [];
        for (let i = chat.length - 1; i >= 0; i--) {
          const m = chat[i];
          if (m && !m.is_user && String(m.mes || '').trim()) { text = String(m.mes); break; }
        }
      } catch (e) {}
      if (!text) { showToast('未找到 AI 回复', true); return; }
      const found = [];
      let m;
      SCAN_TAG_RE.lastIndex = 0;
      while ((m = SCAN_TAG_RE.exec(text)) !== null) {
        const name = m[1];
        if (name && !found.includes(name)) found.push(name);
      }
      if (!found.length) { showToast('最新 AI 回复里没发现标签', true); return; }
      // 合并进清单：已有的保留勾选态，新发现的默认勾选
      for (const name of found) {
        if (!_filterTags.some(t => t.name === name)) _filterTags.push({ name, checked: true });
      }
      renderFilterTags();
      syncTextareaFromTags();
      showToast(`扫描到 ${found.length} 个标签`);
    }

    // 绑定：扫描按钮
    const scanBtn = document.getElementById('we-btn-filter-scan');
    if (scanBtn) scanBtn.onclick = scanTagsFromLastAI;

    // 绑定：手动添加
    const addBtn = document.getElementById('we-btn-filter-add');
    const addInput = document.getElementById('we-filter-add-input');
    function doAddTag() {
      const v = (addInput && addInput.value || '').trim();
      if (!v) return;
      if (!/^[a-zA-Z_][\w-]*$/.test(v)) { showToast('标签名无效（只允许字母数字下划线连字符）', true); return; }
      if (!_filterTags.some(t => t.name === v)) _filterTags.push({ name: v, checked: true });
      if (addInput) addInput.value = '';
      renderFilterTags();
      syncTextareaFromTags();
    }
    if (addBtn) addBtn.onclick = doAddTag;
    if (addInput) addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddTag(); } });

    // 绑定：textarea 手改 → 反解析更新勾选（防抖）
    const filterTa = document.getElementById('we-filter-regex');
    if (filterTa) filterTa.addEventListener('input', () => {
      clearTimeout(_taSyncTimer);
      _taSyncTimer = setTimeout(syncTagsFromTextarea, 300);
    });

    // 初始化：打开设置页时从已存字段反解析出勾选状态
    syncTagsFromTextarea();
    }
    bindFilterControls('world');
    bindFilterControls('memory');

    const memorySaveBtn = document.getElementById('we-save-memory-settings');
    if (memorySaveBtn) {
      memorySaveBtn.onclick = () => {
        const gv = id => document.getElementById(id)?.value;
        const memoryCurrent = window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {};
        const temperatureRaw = parseFloat(gv('we-temperature'));
        const timeoutSecRaw = parseFloat(gv('we-api-timeout-sec'));
        const memorySettings = {
          ...memoryCurrent,
          engineEnabled: document.getElementById('we-memory-engine-enabled')?.checked !== false,
          firstLayerIsAiOpening: document.getElementById('we-memory-first-layer-ai-opening')?.checked !== false,
          apiUrl: gv('we-api-url') || '',
          apiKey: gv('we-api-key') || '',
          model: gv('we-model') || 'gpt-3.5-turbo',
          temperature: Number.isFinite(temperatureRaw) ? Math.max(0, temperatureRaw) : 0.2,
          maxTokens: Math.max(1, parseInt(gv('we-max-tokens')) || 2000),
          apiTimeoutMs: Number.isFinite(timeoutSecRaw) ? Math.max(0, Math.round(timeoutSecRaw * 1000)) : 120000,
          connectionMode: document.getElementById('we-connection-mode')?.value === 'proxy' ? 'proxy' : 'direct',
          evolveMode: gv('we-memory-evolve-mode') === 'manual' ? 'manual' : 'auto',
          evolveEveryX: 1,
          evolveReadRounds: 1,
          manualReadRounds: 1,
          smallSummaryEveryX: 1,
          bigSummaryEveryX: Math.max(1, parseInt(gv('we-memory-big-summary-every')) || 5),
          bigSummaryInjectLimit: Math.max(1, parseInt(gv('we-memory-big-summary-inject-limit')) || 3),
          injectIntoPrompt: document.getElementById('we-memory-inject')?.checked !== false,
          injectIntoWorldEngine: document.getElementById('we-memory-inject-world-engine')?.checked === true,
          worldEngineMemoryLimit: Math.max(1, parseInt(gv('we-memory-world-engine-limit')) || 5),
          searchDepth: Math.max(1, parseInt(gv('we-memory-search-depth')) || 5),
          maxPerCharacter: Math.max(1, parseInt(gv('we-memory-max-per-character')) || 20),
          apiAutoRetries: Math.max(0, parseInt(gv('we-memory-api-auto-retries')) || 0),
          filterRegex: gv('we-memory-filter-regex') || '',
          tonePrompt: gv('we-memory-tone-prompt') || '',
          worldbookEnabled: document.getElementById('we-memory-worldbook-enabled')?.checked === true,
          worldbookTrigger: document.getElementById('we-worldbook-trigger')?.checked === true,
          syncToChat: document.getElementById('we-memory-sync-to-chat')?.checked === true,
          autoBackup: document.getElementById('we-memory-auto-backup')?.checked === true,
          backfillBatchSize: Math.max(1, parseInt(gv('we-memory-backfill-batch')) || 5),
          summaryBackfillSmallEveryX: Math.max(1, parseInt(gv('we-memory-summary-backfill-small-every')) || 5),
          summaryBackfillBigEveryX: Math.max(1, parseInt(gv('we-memory-summary-backfill-big-every')) || 5),
          backfillEndLayer: Math.max(0, parseInt(gv('we-memory-backfill-end')) || 0),
          backfillRetries: Math.max(0, parseInt(gv('we-memory-backfill-retries')) || 0)
        };
        window.MEMORY_ENGINE_SETTINGS?.saveSettings(memorySettings);
        window.MEMORY_ENGINE?.applyInjection?.();
        showToast('设置已保存');
      };
    }

    const memoryData = window.MEMORY_ENGINE_DATA;
    const memoryCache = window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory');
    const memoryExportData = document.getElementById('we-memory-export-data');
    if (memoryExportData) memoryExportData.onclick = () => {
      if (!memoryData) { showToast('记忆数据模块未加载', true); return; }
      setupDownload(JSON.stringify(memoryData.exportData(), null, 2), 'memory-engine-data-' + Date.now() + '.json');
      showToast('已导出全部记忆数据（最新状态与存档点已分开标明）');
    };
    const memoryImportData = document.getElementById('we-memory-import-data');
    const memoryImportDataFile = document.getElementById('we-memory-import-data-file');
    if (memoryImportData && memoryImportDataFile) {
      memoryImportData.onclick = () => memoryImportDataFile.click();
      memoryImportDataFile.onchange = async () => {
        const file = memoryImportDataFile.files?.[0];
        if (!file) return;
        try {
          const imported = memoryData.importData(JSON.parse(await file.text()));
          window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.afterEvolution?.();
          window.MEMORY_ENGINE?.applyInjection?.();
          showToast(`记忆数据已导入，进度已衔接当前第 ${Math.max(0, Number(imported?.chatLayer) || 0)} 层`);
          refresh();
        } catch (error) {
          showToast('导入记忆数据失败：' + (error?.message || error), true);
        } finally {
          memoryImportDataFile.value = '';
        }
      };
    }

    const memorySnapshotSave = document.getElementById('we-memory-snapshot-save');
    if (memorySnapshotSave) memorySnapshotSave.onclick = () => {
      const name = prompt('给这份记忆存档起个名字：', '记忆存档 ' + new Date().toLocaleString());
      if (name == null) return;
      if (memoryCache?.createSnapshot?.(name)) { showToast('记忆存档已创建'); refresh(); }
      else showToast('存档失败（当前聊天无记忆数据或不可写）', true);
    };
    const memorySnapshotImport = document.getElementById('we-memory-snapshot-import');
    const memorySnapshotImportFile = document.getElementById('we-memory-snapshot-import-file');
    if (memorySnapshotImport && memorySnapshotImportFile) {
      memorySnapshotImport.onclick = () => memorySnapshotImportFile.click();
      memorySnapshotImportFile.onchange = async () => {
        const file = memorySnapshotImportFile.files?.[0];
        if (!file) return;
        try {
          if (memoryCache?.importSnapshot?.(JSON.parse(await file.text()))) { showToast('记忆存档已导入'); refresh(); }
          else showToast('不是有效的记忆存档文件', true);
        } catch (error) {
          showToast('导入记忆存档失败：' + (error?.message || error), true);
        } finally {
          memorySnapshotImportFile.value = '';
        }
      };
    }
    document.querySelectorAll('[data-memory-snap-action]').forEach(button => {
      button.onclick = () => {
        const row = button.closest('[data-memory-snap-id]');
        const id = row?.dataset.memorySnapId;
        const item = memoryCache?.listSnapshots?.().find(entry => entry.id === id);
        if (!id || !item) return;
        const action = button.dataset.memorySnapAction;
        if (action === 'restore') {
          if (!confirm('恢复记忆存档「' + item.name + '」？当前记忆数据将被替换。')) return;
          if (memoryCache.restoreSnapshot(id)) { showToast('记忆存档已恢复'); refresh(); }
          else showToast('恢复失败', true);
        } else if (action === 'rename') {
          const name = prompt('新的存档名称：', item.name);
          if (name == null) return;
          if (memoryCache.renameSnapshot(id, name)) { showToast('已重命名'); refresh(); }
        } else if (action === 'export') {
          const exported = memoryCache.exportSnapshot(id);
          if (exported) setupDownload(JSON.stringify(exported, null, 2), 'memory-snapshot-' + Date.now() + '.json');
        } else if (action === 'delete') {
          if (!confirm('删除记忆存档「' + item.name + '」？')) return;
          if (memoryCache.deleteSnapshot(id)) { showToast('已删除'); refresh(); }
        }
      };
    });

    const memoryArchiveStatus = document.getElementById('we-memory-archive-status');
    if (memoryArchiveStatus && memoryCache?.getStatus) {
      const status = memoryCache.getStatus();
      if (!status.usable) memoryArchiveStatus.textContent = '当前没有可用聊天（请先打开一个角色/群聊）。';
      else if (!status.apiAvailable) memoryArchiveStatus.textContent = '当前酒馆版本不支持写入 chat_metadata，酒馆缓存不可用。';
      else memoryArchiveStatus.textContent = `实时同步${status.syncEnabled ? '已开启' : '已关闭'} · 本地修订 ${status.localRev} / 云端 ${status.liveRev} · 共 ${status.snapshotCount} 条存档`;
    }
    const memorySyncBox = document.getElementById('we-memory-sync-to-chat');
    if (memorySyncBox) memorySyncBox.onchange = () => {
      window.MEMORY_ENGINE_SETTINGS?.patchSettings({ syncToChat: memorySyncBox.checked });
      if (memorySyncBox.checked) memoryCache?.pushLiveNow?.();
      showToast(memorySyncBox.checked ? '已开启记忆跨设备同步' : '已关闭记忆跨设备同步');
      refresh();
    };
    const memoryAutoBackupBox = document.getElementById('we-memory-auto-backup');
    if (memoryAutoBackupBox) memoryAutoBackupBox.onchange = () => {
      window.MEMORY_ENGINE_SETTINGS?.patchSettings({ autoBackup: memoryAutoBackupBox.checked });
      showToast(memoryAutoBackupBox.checked ? '已开启记忆自动备份' : '已关闭记忆自动备份');
    };

    const memoryBackfillStart = document.getElementById('we-memory-backfill-start');
    if (memoryBackfillStart) {
      memoryBackfillStart.onclick = async () => {
        if (window.MEMORY_ENGINE && typeof window.MEMORY_ENGINE.backfill === 'function') {
          try { await window.MEMORY_ENGINE.backfill(); }
          catch (error) { showToast(`记忆重填失败：${error?.message || error}`, true); }
          return;
        }
        showToast('记忆引擎尚未加载', true);
      };
    }
    const memoryRunNow = document.getElementById('we-memory-run-now');
    if (memoryRunNow) {
      memoryRunNow.onclick = async () => {
        memoryRunNow.disabled = true;
        try { await runMemoryExtract(); }
        finally { memoryRunNow.disabled = false; }
      };
    }
    const memoryBigSummaryNow = document.getElementById('we-memory-big-summary-now');
    if (memoryBigSummaryNow) {
      memoryBigSummaryNow.onclick = async () => {
        memoryBigSummaryNow.disabled = true;
        try {
          await window.MEMORY_ENGINE?.manualBigSummary?.();
          showToast('总述完成');
          refresh();
        } catch (error) { showToast(`总述失败：${error?.message || error}`, true); }
        finally { memoryBigSummaryNow.disabled = false; }
      };
    }
    const memorySummaryBackfillStart = document.getElementById('we-memory-summary-backfill-start');
    if (memorySummaryBackfillStart) {
      memorySummaryBackfillStart.onclick = async () => {
        memorySummaryBackfillStart.disabled = true;
        try { await window.MEMORY_ENGINE?.backfillSummaries?.(); }
        catch (error) { showToast(`纪要与总述重填失败：${error?.message || error}`, true); }
        finally { memorySummaryBackfillStart.disabled = false; }
      };
    }
    const memoryBackfillStop = document.getElementById('we-memory-backfill-stop');
    if (memoryBackfillStop) {
      memoryBackfillStop.onclick = () => {
        if (window.MEMORY_ENGINE && typeof window.MEMORY_ENGINE.stopBackfill === 'function') {
          window.MEMORY_ENGINE.stopBackfill();
          return;
        }
        showToast('当前没有运行中的记忆重填任务');
      };
    }

    const saveBtn = document.getElementById('we-save-settings');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const _modeRaw = document.getElementById('we-evolve-mode')?.value;
        const gv = id => document.getElementById(id)?.value;
        const temperatureRaw = parseFloat(gv('we-temperature'));
        const timeoutSecRaw = parseFloat(gv('we-api-timeout-sec'));
        const ns = {
          ...(window.WORLD_ENGINE_API ? window.WORLD_ENGINE_API.getSettings(true) : {}),
          engineEnabled: document.getElementById('we-world-engine-enabled')?.checked !== false,
          firstLayerIsAiOpening: document.getElementById('we-first-layer-ai-opening')?.checked !== false,
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || 'gpt-3.5-turbo',
          temperature: Number.isFinite(temperatureRaw) ? Math.max(0, temperatureRaw) : 0.7,
          maxTokens: Math.max(1, parseInt(gv('we-max-tokens')) || 2000),
          apiAutoRetries: Math.max(0, parseInt(gv('we-api-auto-retries')) || 0),
          apiTimeoutMs: Number.isFinite(timeoutSecRaw) ? Math.max(0, Math.round(timeoutSecRaw * 1000)) : 120000,
          connectionMode: document.getElementById('we-connection-mode')?.value === 'proxy' ? 'proxy' : 'direct',
          injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
          injectMaxChars: Math.max(0, parseInt(gv('we-inject-max-chars')) || 0),
          injectAllLevels: document.getElementById('we-inject-all-levels')?.checked === true,
          memoryLinkEnabled: document.getElementById('we-memory-link-enabled')?.checked === true,
          syncToChat: document.getElementById('we-sync-to-chat')?.checked === true,
          autoBackup: document.getElementById('we-auto-backup')?.checked === true,
          evolveMode: (_modeRaw === 'manual' || _modeRaw === 'time') ? _modeRaw : 'auto',
          evolveEveryX: Math.max(1, parseInt(document.getElementById('we-evolve-everyx')?.value) || 1),
          evolveReadRounds: Math.max(1, parseInt(document.getElementById('we-evolve-readrounds')?.value) || 1),
          manualReadRounds: Math.max(1, parseInt(document.getElementById('we-manual-readrounds')?.value) || 1),
          evolveFilterRegex: gv('we-filter-regex') || '',
          displayMode: document.getElementById('we-display-mode')?.value === 'expand' ? 'expand' : 'mask',
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
          localRegionalIncidentChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-ri-chance')) || 0)),
          localRegionalIncidentDuration: Math.max(1, parseInt(gv('we-local-ri-duration')) || 5),
          localRegionalIncidentCooldown: Math.max(1, parseInt(gv('we-local-ri-cooldown')) || 1),
          localDistantEventLedgerThreshold: Math.max(1, parseInt(gv('we-local-distant-threshold')) || 10),
          localDistantEventChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-distant-chance')) || 0)),
          localDistantEventCooldown: Math.max(1, parseInt(gv('we-local-distant-cooldown')) || 1),
          localDistantEventEventPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-distant-event-percent')) || 0)),
          localNearEventChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-near-chance')) || 0)),
          localNearEventCooldown: Math.max(1, parseInt(gv('we-local-near-cooldown')) || 1),
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

        // [FIX] 保存后校验正则过滤：复用 core.validateFilterRegex。非法条目不阻止保存（与现有数值 clamp 范式一致），
        //   但在状态行展示生效/失败+原因，按是否有失败调整下方 toast。
        let _filterBad = 0;
        try {
          const _core = window.WORLD_ENGINE_CORE;
          if (_core && _core.validateFilterRegex) {
            const _v = _core.validateFilterRegex(ns.evolveFilterRegex);
            renderFilterStatus(_v, '已保存：');
            _filterBad = _v.bad.length;
          }
        } catch (e) { /* 校验失败不影响保存 */ }

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
        showToast(_filterBad > 0 ? `已保存，但有 ${_filterBad} 条正则无效` : '设置已保存', _filterBad > 0);
      };
    }

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
      const worldbookScope = _engineFace;
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
          const isFirstVisit = worldbook.hasSelection ? !worldbook.hasSelection(worldbookScope) : false;
          const savedIds = worldbook.getSelectedIds(worldbookScope);
          _wbCachedEntries = entries;
          _wbCachedChatId = currentChatId;
          _wbCachedScope = worldbookScope;
          _wbCachedOverrides = worldbook.getOverrides ? { ...worldbook.getOverrides(worldbookScope) } : {};
          // 首次进入该聊天（存储中无记录）则自动全选启用条目
          if (isFirstVisit && entries.length) {
            const allIds = entries.filter(e => !e.disabled).map(e => e.id);
            worldbook.saveSelectedIds(allIds, worldbookScope);
            _wbCachedSelectedIds = new Set(allIds);
            showToast(`已自动全选 ${allIds.length} 条世界书条目`);
          } else {
            const enabledIds = new Set(entries.filter(e => !e.disabled).map(e => e.id));
            const validSavedIds = savedIds.filter(id => enabledIds.has(id));
            _wbCachedSelectedIds = new Set(validSavedIds);
            // 仅在有匹配条目时才回写，防止刷新后 entry.world 尚未加载导致 ID 全部不匹配、
            // 误将保存记录清空为 []（清空后下次开面板会误触发自动全选）
            if (validSavedIds.length > 0 && validSavedIds.length !== savedIds.length) {
              worldbook.saveSelectedIds(validSavedIds, worldbookScope);
            }
          }
          renderWorldbookList();
        } catch(error) {
          worldbookList.innerHTML = `<div class="we-empty">读取失败：${u(error.message)}</div>`;
          if (summary) summary.textContent = '读取失败';
          _wbCachedEntries = null;
          _wbCachedSelectedIds = null;
          _wbCachedOverrides = null;
          _wbCachedChatId = null;
          _wbCachedScope = null;
        } finally {
          if (reloadBtn) reloadBtn.disabled = false;
        }
      }

      function renderWorldbookList() {
        const entries = _wbCachedEntries;
        const selectedIds = _wbCachedSelectedIds || new Set();
        const overrides = _wbCachedOverrides || {};
        const triggerOn = worldbookScope === 'memory'
          ? window.MEMORY_ENGINE_SETTINGS?.getSettings()?.worldbookTrigger === true
          : !!(window.WORLD_ENGINE_WORLDBOOK?.triggerEnabled?.());
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
            ${worldEntries.map(entry => {
              const keys = entry.keys || [];
              const badge = entry.constant ? '🔵' : (entry.vectorized ? '🔗' : (keys.length ? '🟢' : '⚪'));
              const keyHint = keys.length ? ' · 关键词：' + keys.slice(0, 5).join('、') + (keys.length > 5 ? '…' : '') : '';
              const ov = overrides[entry.id] || 'auto';
              const overrideSel = (triggerOn && !entry.disabled) ? `
                <select class="we-wb-override" data-entry-id="${u(entry.id)}" title="该条触发方式">
                  <option value="auto"${ov === 'auto' ? ' selected' : ''}>跟随酒馆</option>
                  <option value="const"${ov === 'const' ? ' selected' : ''}>强制常驻</option>
                  <option value="key"${ov === 'key' ? ' selected' : ''}>强制关键词</option>
                  <option value="off"${ov === 'off' ? ' selected' : ''}>关闭</option>
                </select>` : '';
              return `
              <div class="we-worldbook-entry${entry.disabled ? ' is-disabled' : ''}">
                <label class="we-wb-entry-main">
                  <input class="we-worldbook-entry-check" type="checkbox" value="${u(entry.id)}" data-chars="${entry.content.length}" ${selectedIds.has(entry.id) && !entry.disabled ? 'checked' : ''} ${entry.disabled ? 'disabled' : ''}>
                  <span>
                    <strong>${badge} ${u(entry.title)}</strong>
                    <small>${entry.content.length} 字符${u(keyHint)}${entry.disabled ? ' · 世界书内已停用' : ''}</small>
                  </span>
                </label>${overrideSel}
              </div>`;
            }).join('')}
            </div>
          </div>`;
        }).join('');
          worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
            checkbox.onchange = () => {
              _wbCachedSelectedIds = new Set([...worldbookList.querySelectorAll('.we-worldbook-entry-check:checked')].map(cb => cb.value));
              updateWorldbookSummary();
            };
          });
          worldbookList.querySelectorAll('.we-wb-override').forEach(sel => {
            sel.onchange = () => {
              const id = sel.dataset.entryId;
              if (!id) return;
              if (!_wbCachedOverrides) _wbCachedOverrides = {};
              if (sel.value === 'auto') delete _wbCachedOverrides[id];
              else _wbCachedOverrides[id] = sel.value;
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

      if (reloadBtn) reloadBtn.onclick = () => { _wbCachedEntries = null; _wbCachedChatId = null; _wbCachedScope = null; loadWorldbookEntries(); };
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
        const ids = [..._wbCachedSelectedIds];
        if (worldbook.saveSelection) worldbook.saveSelection(ids, _wbCachedOverrides || {}, worldbookScope);
        else worldbook.saveSelectedIds(ids, worldbookScope);
        showToast(`已保存 ${_wbCachedSelectedIds.size} 条${worldbookScope === 'memory' ? '记忆' : '后台'}世界书条目`);
        updateWorldbookSummary();
      };
      const triggerBox = document.getElementById('we-worldbook-trigger');
      if (triggerBox) triggerBox.onchange = () => {
        if (worldbookScope === 'memory') {
          window.MEMORY_ENGINE_SETTINGS?.patchSettings({ worldbookTrigger: triggerBox.checked });
        } else {
          const wapi = window.WORLD_ENGINE_API;
          const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
          window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, worldbookTrigger: triggerBox.checked }));
          if (wapi && wapi.getSettings) wapi.getSettings(true);
        }
        showToast(triggerBox.checked ? '已开启蓝绿灯触发' : '已关闭蓝绿灯触发（恢复全部已选注入）');
        renderWorldbookList(); // 重渲染以显示/隐藏每条的触发覆写下拉
      };
      // refresh() 重建 DOM 时，如果 chatId 未变且已有缓存，直接渲染，避免勾选丢失
      const currentChatIdNow = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
      if (_wbCachedEntries && _wbCachedChatId === currentChatIdNow && _wbCachedScope === worldbookScope) {
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
          if (!isHidden) { refreshDebugRender(); refreshPresetManage(); } // [FIX] 局部刷新调试卡数据，不动其它 tab 输入
        }
      };
    }

    const fetchBtn = document.getElementById('we-fetch-models');
    if (fetchBtn) {
      fetchBtn.onclick = async () => {
        const api = window.WORLD_ENGINE_API;
        if (!api) { showToast('API 模块未加载', true); return; }
        const requestScope = _engineFace;
        const modelListElement = document.getElementById('we-model-list');
        const apiPatch = {
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || '',
          temperature: Number.isFinite(parseFloat(document.getElementById('we-temperature')?.value))
            ? Math.max(0, parseFloat(document.getElementById('we-temperature')?.value))
            : (requestScope === 'memory' ? 0.2 : 0.7),
          maxTokens: Math.max(1, parseInt(document.getElementById('we-max-tokens')?.value) || 2000),
          apiTimeoutMs: Number.isFinite(parseFloat(document.getElementById('we-api-timeout-sec')?.value)) ? Math.max(0, Math.round(parseFloat(document.getElementById('we-api-timeout-sec')?.value) * 1000)) : 120000,
          connectionMode: document.getElementById('we-connection-mode')?.value === 'proxy' ? 'proxy' : 'direct'
        };
        let requestSettings;
        if (requestScope === 'memory') {
          requestSettings = window.MEMORY_ENGINE_SETTINGS?.patchSettings(apiPatch) || apiPatch;
        } else {
          const worldSettings = {
            ...(api.getSettings ? api.getSettings(true) : {}),
            ...apiPatch,
            injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
            injectMaxChars: Math.max(0, parseInt(document.getElementById('we-inject-max-chars')?.value) || 0),
            injectAllLevels: document.getElementById('we-inject-all-levels')?.checked === true
          };
          window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify(worldSettings));
          if (api.getSettings) api.getSettings(true);
          requestSettings = worldSettings;
        }
        fetchBtn.disabled = true;
        fetchBtn.textContent = '获取中...';
        try {
          const models = await api.fetchModelList(requestSettings);
          const select = modelListElement;
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
    function saveTonePrompt(text) {
      const wapi = window.WORLD_ENGINE_API;
      const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
      window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, tonePrompt: text }));
      if (wapi && wapi.getSettings) wapi.getSettings(true);
    }
    function updateToneStatus() {
      const el = document.getElementById('we-tone-status');
      if (!el) return;
      const t = getTonePrompt().trim();
      el.textContent = t ? `当前已设置附加提示词（${t.length} 字）` : '当前未设置附加提示词';
    }
    updateToneStatus();

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
        updateToneStatus();
        showToast('附加提示词已清除');
      };
    }

    // ===== 酒馆缓存与存档 =====
    (function setupChatcacheSection() {
      const cc = window.WORLD_ENGINE_CHATCACHE;
      const listEl = document.getElementById('we-chatcache-snapshots');
      if (!cc || !listEl) return; // 不在设置页或模块缺失

      const statusEl = document.getElementById('we-chatcache-status');
      const fmtTime = (ms) => {
        if (!ms) return '';
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };

      function render() {
        const st = cc.getStatus();
        if (statusEl) {
          if (!st.usable) statusEl.textContent = '当前没有可用聊天（请先打开一个角色/群聊）。';
          else if (!st.apiAvailable) statusEl.textContent = '当前酒馆版本不支持写入 chat_metadata，酒馆缓存不可用。';
          else statusEl.textContent = `实时同步${st.syncEnabled ? '已开启' : '已关闭'} · 本地修订 ${st.localRev} / 云端 ${st.liveRev} · 共 ${st.snapshotCount} 条存档`;
        }
        const snaps = cc.listSnapshots();
        if (!snaps.length) { listEl.innerHTML = '<div class="we-empty">暂无存档</div>'; return; }
        listEl.innerHTML = snaps.map(s => `
          <div class="we-snapshot-row" data-snap-id="${u(s.id)}">
            <div class="we-snapshot-main">
              <div class="we-snapshot-name"><span class="we-snapshot-badge${s.auto ? ' is-auto' : ''}">${s.auto ? '自动' : '手动'}</span>${u(s.name)}</div>
              <div class="we-snapshot-meta">第 ${s.round || 0} 轮 · ${fmtTime(s.createdAt)}</div>
            </div>
            <div class="we-snapshot-actions">
              <button class="we-icon-btn" data-snap-action="restore" title="恢复到当前聊天"><i class="fa-solid fa-rotate-left"></i></button>
              <button class="we-icon-btn" data-snap-action="rename" title="重命名"><i class="fa-solid fa-pen"></i></button>
              <button class="we-icon-btn" data-snap-action="export" title="导出 JSON"><i class="fa-solid fa-download"></i></button>
              <button class="we-icon-btn" data-snap-action="delete" title="删除"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>`).join('');
        listEl.querySelectorAll('[data-snap-action]').forEach(btn => {
          btn.onclick = () => {
            const row = btn.closest('.we-snapshot-row');
            const id = row && row.dataset.snapId;
            if (!id) return;
            const action = btn.dataset.snapAction;
            const snap = cc.listSnapshots().find(s => s.id === id);
            if (action === 'restore') {
              if (!confirm(`恢复存档「${snap ? snap.name : id}」到当前聊天？\n当前状态会先自动备份，可再恢复回来。`)) return;
              if (cc.restoreSnapshot(id)) { showToast('已恢复存档'); refresh(); }
              else showToast('恢复失败', true);
            } else if (action === 'rename') {
              const name = prompt('新的存档名称：', snap ? snap.name : '');
              if (name == null) return;
              if (cc.renameSnapshot(id, name)) { showToast('已重命名'); render(); }
            } else if (action === 'export') {
              const obj = cc.exportSnapshot(id);
              if (!obj) { showToast('导出失败', true); return; }
              const safe = String(obj.name || id).replace(/[^\w一-龥-]+/g, '_');
              setupDownload(JSON.stringify(obj, null, 2), 'we-snapshot-' + safe + '-' + Date.now() + '.json');
              showToast('已导出存档');
            } else if (action === 'delete') {
              if (!confirm(`删除存档「${snap ? snap.name : id}」？不可恢复。`)) return;
              if (cc.deleteSnapshot(id)) { showToast('已删除'); render(); }
            }
          };
        });
      }

      // 立即生效并持久化单个开关（与 saveTonePrompt 同模式）
      const persist = (key, val) => {
        const wapi = window.WORLD_ENGINE_API;
        const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, [key]: val }));
        if (wapi && wapi.getSettings) wapi.getSettings(true);
      };

      const syncBox = document.getElementById('we-sync-to-chat');
      if (syncBox) syncBox.onchange = () => {
        persist('syncToChat', syncBox.checked);
        if (syncBox.checked && cc.pushLiveNow) cc.pushLiveNow(); // 开启即把本地播种进聊天
        showToast(syncBox.checked ? '已开启跨设备同步' : '已关闭跨设备同步');
        render();
      };
      const autoBox = document.getElementById('we-auto-backup');
      if (autoBox) autoBox.onchange = () => {
        persist('autoBackup', autoBox.checked);
        showToast(autoBox.checked ? '已开启自动备份' : '已关闭自动备份');
      };

      const ccSaveBtn = document.getElementById('we-chatcache-save');
      if (ccSaveBtn) ccSaveBtn.onclick = () => {
        const name = prompt('给这份存档起个名字：', '存档 ' + fmtTime(Date.now()));
        if (name == null) return;
        if (cc.createSnapshot(name)) { showToast('已存档'); render(); }
        else showToast('存档失败（当前聊天无世界数据或不可写）', true);
      };

      const ccImportBtn = document.getElementById('we-chatcache-import');
      const ccImportFile = document.getElementById('we-chatcache-import-file');
      if (ccImportBtn && ccImportFile) {
        ccImportBtn.onclick = () => ccImportFile.click();
        ccImportFile.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const obj = JSON.parse(ev.target.result);
              if (cc.importSnapshot(obj)) { showToast('已导入存档'); render(); }
              else showToast('不是有效的存档文件', true);
            } catch (err) { showToast('解析失败: ' + err.message, true); }
          };
          reader.readAsText(file);
          ccImportFile.value = '';
        };
      }

      render();
    })();

    // ===== 批量重填世界推演 =====
    (function setupBackfillSection() {
      const startBtn = document.getElementById('we-backfill-start');
      const stopBtn = document.getElementById('we-backfill-stop');
      if (!startBtn) return; // 不在设置页

      const persistBf = (key, val) => {
        const wapi = window.WORLD_ENGINE_API;
        const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, [key]: val }));
        if (wapi && wapi.getSettings) wapi.getSettings(true);
      };
      const batchEl = document.getElementById('we-backfill-batch');
      const endEl = document.getElementById('we-backfill-end');
      const retriesEl = document.getElementById('we-backfill-retries');
      if (batchEl) batchEl.onchange = () => persistBf('backfillBatchSize', Math.max(1, parseInt(batchEl.value) || 1));
      if (endEl) endEl.onchange = () => persistBf('backfillEndLayer', Math.max(0, parseInt(endEl.value) || 0));
      if (retriesEl) retriesEl.onchange = () => persistBf('backfillRetries', Math.max(0, parseInt(retriesEl.value) || 0));

      startBtn.onclick = () => runBackfill();
      if (stopBtn) stopBtn.onclick = () => {
        if (evolution && evolution.abort) { evolution.abort(); showToast('已发送停止信号'); }
      };
    })();

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

    // [FIX] 推演 prompt 分段卡片折叠（事件委托，逻辑在模块级 bindPromptSegToggle）
    bindPromptSegToggle(document.querySelector('.we-prompt-debug'));
    bindMemoryDebugExportButtons();

    // [FIX] 导出诊断包
    const exportDiagBtn = document.getElementById('we-export-diag');
    if (exportDiagBtn) {
      exportDiagBtn.onclick = () => {
        const diag = window.WORLD_ENGINE_DIAG;
        if (!diag || !diag.download) { showToast('诊断模块不可用', true); return; }
        try {
          diag.download();
          showToast('诊断包已导出');
        } catch (e) {
          showToast('诊断包导出失败: ' + (e && e.message || e), true);
        }
      };
    }
    const memoryExportDiagBtn = document.getElementById('we-memory-export-diag');
    if (memoryExportDiagBtn) memoryExportDiagBtn.onclick = () => {
      const diag = window.WORLD_ENGINE_DIAG;
      if (!diag?.download) { showToast('记忆诊断模块不可用', true); return; }
      try { diag.download('memory'); showToast('记忆诊断包已导出'); }
      catch (error) { showToast('记忆诊断包导出失败: ' + (error?.message || error), true); }
    };

    // [MAP] 引擎预设管理：整页装配后首次绑定（事件委托在 bindPresetEvents 内）。
    bindPresetEvents(document.getElementById('we-preset-manage'));
  }

  function showPanel() {
    if (!panelElement) buildPanel();
    applyEngineFaceTheme();
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

  function initDrag(panel, handle) {
    let dragging = false, startX, startY, startLeft, startTop;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', function(e) {
      if (e.target.closest('.we-panel-close') || e.target.closest('.we-panel-corner-actions') || e.target.closest('.we-engine-face-toggle')) return;
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
    });
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
    updateBallControls();
  }

  function setMemoryEvolvingUI(active, label) {
    _memoryRunningLabel = active ? String(label || '记忆任务') : '';
    const status = document.getElementById('we-memory-task-status');
    if (status) status.textContent = active ? `正在进行${_memoryRunningLabel}` : '当前没有运行中的记忆任务';
    updateBallControls();
  }

  function setInjectedScope(scope) {
    _injectedScope = scope === 'checkpoint' ? 'checkpoint' : 'state';
  }

  // 手动推演（供悬浮球卫星按钮调用）：显式指定基底，不看 isNewRound。
  //   重新推进 → 喂存档点 B（mode 'redo'），面板显示存档点；
  //   向前推进 → 喂当前状态 A（mode 'forward'），面板显示当前状态。
  async function runManualEvolve(mode, scope) {
    if (!window.WORLD_ENGINE || typeof window.WORLD_ENGINE.manualEvolve !== 'function') {
      showToast('手动推演入口未就绪', true);
      return;
    }
    const ok = await window.WORLD_ENGINE.manualEvolve(mode, scope);
    if (ok) showToast('推演完成');
    else if (evolution.getLastError?.()) showToast(evolution.getLastError(), true);
  }

  async function runMemoryExtract() {
    if (!window.MEMORY_ENGINE?.manualExtract) { showToast('记忆提取入口未就绪', true); return; }
    try {
      const result = await window.MEMORY_ENGINE.manualExtract();
      showToast(`记忆提取完成，写入或更新 ${result?.added || 0} 项`);
      return result;
    } catch (error) {
      showToast(`记忆提取失败：${error?.message || error}`, true);
    }
  }

  async function runMemoryReextract() {
    if (!window.MEMORY_ENGINE?.manualReextract) { showToast('记忆推演入口未就绪', true); return; }
    try {
      const result = await window.MEMORY_ENGINE.manualReextract();
      showToast(`记忆重新推演完成，写入或更新 ${result?.added || 0} 项`);
    } catch (error) { showToast(`记忆重新推演失败：${error?.message || error}`, true); }
  }

  // 批量「重填世界推演」：清空当前世界状态，从第 1 个 AI 楼层分批推到指定楼层。
  async function runBackfill() {
    if (isEvolving) { showToast('已有推演进行中，请稍候'); return; }
    if (evolution?.isRunning?.()) { showToast('已有推演进行中，请稍候'); return; }

    const st = window.WORLD_ENGINE_API ? window.WORLD_ENGINE_API.getSettings(true) : {};
    if (st.engineEnabled === false) { showToast('世界引擎已关闭', true); return; }
    const batchSize = Math.max(1, parseInt(st.backfillBatchSize) || 1);
    const retries = Math.max(0, parseInt(st.backfillRetries) || 0);
    let endLayer = Math.max(0, parseInt(st.backfillEndLayer) || 0);

    // 统计当前 AI 楼层数，给出确认信息
    let aiCount = 0;
    try {
      const ctx = SillyTavern.getContext();
      const chat = (ctx && ctx.chat) || [];
      const ignoreFirstLayer = st.firstLayerIsAiOpening !== false;
      for (let index = 0; index < chat.length; index++) {
        const m = chat[index];
        if (m && !m.is_user && String(m.mes || '').trim() && !(ignoreFirstLayer && index === 0)) aiCount++;
      }
    } catch (e) {}
    if (!aiCount) { showToast('当前聊天没有可推演的 AI 楼层', true); return; }
    const effectiveEnd = (endLayer > 0 && endLayer <= aiCount) ? endLayer : aiCount;
    const totalBatches = Math.max(1, Math.ceil(effectiveEnd / batchSize));

    const statusEl = document.getElementById('we-backfill-status');
    const setBfStatus = (t) => { if (statusEl) statusEl.textContent = t; };

    if (!confirm(
      `「重填世界推演」将清空当前世界状态，从第 1 个 AI 楼层重新推演到第 ${effectiveEnd} 层，` +
      `共约 ${totalBatches} 批、每批最多重试 ${retries} 次。\n` +
      `开始前会自动存一份备份快照。\n确定推倒重来？`
    )) return;

    // 回填前自动备份（chatcache 不可用则静默跳过）
    try {
      const cc = window.WORLD_ENGINE_CHATCACHE;
      if (cc && cc.createSnapshot) {
        const snap = cc.createSnapshot('回填前自动备份');
        if (snap) showToast('已存回填前备份快照');
      }
    } catch (e) { console.warn('[世界引擎] 回填前备份失败（不影响回填）', e); }

    isEvolving = true;
    setEvolvingUI(true, 'state');
    refresh(true);
    if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('回填中...');
    setBfStatus('开始回填...');

    try {
      const result = await evolution.backfillEvolve({
        batchSize, retries, endLayer,
        onProgress: (p) => {
          if (p.phase === 'batch-start') {
            setBfStatus(`第 ${p.batch}/${p.totalBatches} 批（第 ${p.layerFrom}-${p.layerTo} 层）推演中...`);
            if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`回填中 ${p.batch}/${p.totalBatches}`);
          } else if (p.phase === 'retry') {
            setBfStatus(`第 ${p.batch}/${p.totalBatches} 批失败，重试 ${p.attempt}/${retries}...`);
            if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`回填中 ${p.batch}/${p.totalBatches}`);
          } else if (p.phase === 'batch-done') {
            setBfStatus(`第 ${p.batch}/${p.totalBatches} 批完成（已推进到第 ${p.round} 轮）`);
            refresh(true);
          }
        }
      });

      if (result.done) {
        setBfStatus(`✅ 回填完成，共 ${result.completedBatches}/${result.totalBatches} 批`);
        showToast(`回填完成，共 ${result.completedBatches} 批`);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('回填完成');
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      } else if (result.reason === 'aborted') {
        setBfStatus(`🛑 已中止，完成 ${result.completedBatches}/${result.totalBatches} 批`);
        showToast(`回填已中止（完成 ${result.completedBatches} 批）`);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('回填已中止');
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      } else if (result.reason === 'no-ai-layers') {
        setBfStatus('当前聊天没有可推演的 AI 楼层');
        showToast('当前聊天没有可推演的 AI 楼层', true);
      } else if (result.reason === 'busy') {
        showToast('已有推演进行中，请稍候', true);
      } else {
        setBfStatus(`❌ 第 ${result.failedAt || '?'} 批失败，已停止（完成 ${result.completedBatches || 0} 批）`);
        showToast(`回填在第 ${result.failedAt || '?'} 批失败已停止`, true);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('回填失败', true);
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      }
    } catch (e) {
      setBfStatus('❌ 回填异常: ' + (e && e.message || e));
      showToast('回填异常: ' + (e && e.message || e), true);
    } finally {
      isEvolving = false;
      setEvolvingUI(false);
      refresh();
    }
  }

  // ========== 世界引擎悬浮球 ==========
  let inputButtonObserver = null;
  let inputButtonRetryTimer = null;
  const WE_BALL_POS_KEY = 'we-ball-pos';
  let _ballStatusTimer = null;

  function getFaceSettings() {
    const face = getEngineFace();
    return callEngineFace(face, 'getSettings', {}) || {};
  }

  function updateBallControls() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const face = getEngineFace();
    const active = Boolean(callEngineFace(face, 'isRunning', false));
    const runningLabel = String(callEngineFace(face, 'getRunningLabel', '') || '');
    const fwd = ball.querySelector('#we-sat-forward');
    const redo = ball.querySelector('#we-sat-redo');
    const abort = ball.querySelector('#we-sat-abort');
    const power = ball.querySelector('#we-sat-power');
    const engineSwitch = ball.querySelector('#we-sat-engine-switch');
    if (fwd) {
      fwd.style.display = face.showForward === true ? '' : 'none';
      fwd.classList.toggle('we-sat-off', active);
      fwd.title = face.forwardTitle || `向前推进${face.label}`;
    }
    if (redo) {
      redo.classList.toggle('we-sat-off', active);
      redo.title = `重新推演${face.label}`;
    }
    if (abort) {
      abort.classList.toggle('we-sat-off', !active);
      abort.title = active && runningLabel ? `停止${runningLabel}` : `停止${face.label}推演`;
    }
    if (power) {
      power.classList.toggle('on', getFaceSettings().engineEnabled === false);
      power.style.display = typeof face.setEnabled === 'function' ? '' : 'none';
      power.title = `开关${face.label}推演与注入`;
    }
    if (engineSwitch) {
      const targetId = face.id === 'memory' ? 'world' : 'memory';
      const target = getEngineFace(targetId);
      engineSwitch.dataset.targetEngine = target.id;
      engineSwitch.classList.toggle('we-sat-target-world', target.id === 'world');
      engineSwitch.classList.toggle('we-sat-target-memory', target.id === 'memory');
      engineSwitch.title = `切换到${target.label}`;
      engineSwitch.setAttribute('aria-label', engineSwitch.title);
    }
    ball.classList.toggle('we-ball-evolving', active);
    ball.title = active && runningLabel
      ? `${face.label}：正在进行${runningLabel}`
      : `${face.label}：单击打开面板`;
    ball.setAttribute('aria-label', ball.title);
    if (active) ball.classList.remove('we-ball-success', 'we-ball-fail');
  }

  function syncBallFace() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const face = getEngineFace();
    for (const registered of _engineFaceRegistry.values()) {
      if (registered.ballClass) ball.classList.remove(registered.ballClass);
    }
    if (face.ballClass) ball.classList.add(face.ballClass);
    ball.dataset.engineFace = face.id;
    ball.title = `${face.label}：单击打开面板`;
    ball.setAttribute('aria-label', ball.title);
    updateBallControls();
  }

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
      if (!document.getElementById('we-input-btn')) {
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

    if (/回填中/.test(text)) {
      // 批量回填：地球持续旋转 + 右下角显示「批/总」进度
      ball.classList.add('we-ball-evolving');
      if (badge) badge.textContent = '';
      const mb = /(\d+)\s*\/\s*(\d+)/.exec(text);
      if (mb && ring) {
        const cur = Number(mb[1]), total = Number(mb[2]) || 1;
        const pct = Math.max(0, Math.min(1, cur / total));
        ring.style.setProperty('--we-ring-pct', (pct * 360) + 'deg');
        ball.classList.add('we-ball-counting');
        if (count) count.textContent = `${cur}/${total}`;
      } else {
        clearCount();
      }
    } else if (/推演中/.test(text)) {
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

  // 给悬浮球的五颗卫星按钮绑事件；阻止冒泡，避免触发拖拽 / 打开面板
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
    wire('we-sat-forward', () => {
      callEngineFaceAction(getEngineFace(), 'forward');
    });
    wire('we-sat-redo', () => {
      callEngineFaceAction(getEngineFace(), 'redo');
    });
    wire('we-sat-abort', () => {
      const face = getEngineFace();
      const done = result => { if (result !== ENGINE_ACTION_FAILED) showToast('已发送停止信号'); };
      const result = callEngineFaceAction(face, 'abort');
      if (result && typeof result.then === 'function') result.then(done);
      else done(result);
    });

    // 「插头」跟随当前球面：世界面改 world_engine_settings，记忆面改 memory_engine_settings。
    // 每个已注册引擎各自管理总开关，且不改写用户选好的推演模式与注入选项。
    //   不用 we-sat-off(wire 内会拦 we-sat-off 不可点);用 .on class 标关闭态,power 永远可点。
    wire('we-sat-power', () => {
      const face = getEngineFace();
      const turnOff = getFaceSettings().engineEnabled !== false;
      const finish = result => {
        if (result === ENGINE_ACTION_FAILED) return;
        updateBallControls();
        showToast(turnOff ? `已关闭${face.label}推演与注入` : `已开启${face.label}推演与注入`);
        if (typeof _currentView !== 'undefined' && _currentView === 'settings') refresh();
      };
      const result = callEngineFaceAction(face, 'setEnabled', !turnOff);
      if (result && typeof result.then === 'function') result.then(finish);
      else finish(result);
    });
    wire('we-sat-engine-switch', () => {
      const shortcut = ball.querySelector('#we-sat-engine-switch');
      switchEngineFace(shortcut?.dataset.targetEngine || (getEngineFace().id === 'memory' ? 'world' : 'memory'));
    });
  }

  function buildInputButton() {
    if (!document.body) return;

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
        '<span class="we-ball-core"><span class="we-ball-globe"></span><span class="we-ball-memory"><span class="we-memory-scan"></span></span></span>' +
        '<span class="we-ball-count"></span>' +
        '<span class="we-ball-badge"></span>' +
        '<span class="we-ball-tip"></span>' +
        '<span class="we-sat we-sat-up" id="we-sat-forward" role="button" title="向前推进"><i class="fa-solid fa-forward"></i></span>' +
        '<span class="we-sat we-sat-right we-sat-off" id="we-sat-abort" role="button" title="停止推演"><i class="fa-solid fa-stop"></i></span>' +
        '<span class="we-sat we-sat-down" id="we-sat-redo" role="button" title="重新推进"><i class="fa-solid fa-rotate-right"></i></span>' +
        '<span class="we-sat we-sat-left" id="we-sat-power" role="button" title="插上=关闭推演与注入 / 拔下=开启"><i class="fa-solid fa-power-off"></i></span>' +
        '<span class="we-sat we-sat-lower-right we-sat-engine-switch" id="we-sat-engine-switch" role="button"></span>';
      btn.onclick = () => togglePanel();
      document.body.appendChild(btn);
      wireSatellites(btn);
      syncBallFace();
      applyBallPos(btn);
      makeBallDraggable(btn);
      window.addEventListener('resize', () => applyBallPos(btn));
      setEvolvingUI(isEvolving || Boolean(evolution?.isRunning?.()));
    } else if (btn.parentElement !== document.body) {
      document.body.appendChild(btn);
      applyBallPos(btn);
    }

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
      setBallState(text || '', !!isError);
      // 进度类（第 N/X 轮/天、回填中 i/M）只在悬浮球上显示；其余状态走屏幕顶部横幅
      if (text && !/第\s*\d+\s*\/\s*\d+\s*[轮天]/.test(text) && !/回填中/.test(text)) {
        showTopStatus(text, !!isError);
      }
    };

    buildPanel();
    observeInputButton();
  }

  return {
    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,
    setEvolvingUI, setMemoryEvolvingUI, setInjectedScope,
    registerEngineFace,
    listEngineFaces: () => { ensureBuiltinEngineFaces(); return _engineFaceOrder.map(id => ({ ...getEngineFace(id) })); },
    advanceEngineFace
  };
})();
