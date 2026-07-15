// world-engine-chatcache.js — 酒馆缓存与存档（跨设备同步 + 防丢失存档）
//
// 背景：world-engine-store.js 把存档放在 IndexedDB / localStorage，按「设备 + 浏览器」隔离。
// 换设备或换浏览器后，这些存档不会跟过去。而 SillyTavern 的 chat_metadata 会被序列化进聊天文件、
// 保存到酒馆服务器，并随聊天本身跨设备同步（见 script.js：开聊天时 chat_metadata 由文件头载入，
// saveChat 时又写回文件头）。本模块把「本扩展、当前聊天」的存档镜像进 chat_metadata.world_engine，
// 从而实现两件事：
//   1) 实时同步（live）：开启后，工作区状态持续镜像进聊天；换设备打开同一聊天即可续上进度
//      （冲突按「较新修订号胜出」——Lamport 计数器，避免依赖跨设备时钟）。
//   2) 聊天存档（snapshots）：命名手动存档 + 滚动自动备份，可恢复 / 重命名 / 导出 / 删除 / 导入，防丢失。
//
// 关键约束：
//   - 绝不把全局设置（world_engine_settings，内含 API Key）写进聊天文件；只镜像「按聊天隔离」的 5 个键。
//   - 永远用 SillyTavern.getContext() 取最新引用：chat_metadata 在切聊天时被整体替换，缓存旧引用会写错聊天。
//   - 写 chat_metadata 时只动 world_engine 这一个键（updateChatMetadata 做顶层浅合并），
//     保留 integrity、其他扩展（如作者注释 note）写入的数据不被覆盖。
window.WORLD_ENGINE_CHATCACHE = (function() {
  const NS = 'world_engine';            // chat_metadata 下的命名空间键
  const SCHEMA_VERSION = 1;
  const MAX_AUTO_BACKUPS = 3;           // 滚动自动备份保留条数（防丢失，控体积）
  const MAX_MANUAL_BACKUPS = 20;        // 命名手动存档上限（含导入）
  const TICK_DELAY = 1500;              // 写聊天去抖（毫秒），与一次推演里的多次 setItem 合并
  const SIZE_WARN_BYTES = 1024 * 1024;  // 命名空间体积软告警阈值（约 1MB）

  function core() { return window.WORLD_ENGINE_CORE; }
  function api() { return window.WORLD_ENGINE_API; }
  function store() { return window.WORLD_ENGINE_STORE; }

  function getCtx() {
    try { return SillyTavern.getContext(); } catch (e) { return null; }
  }

  // 当前是否处于「真实聊天」中（有 chatId 且非占位 default）——只有这样写 chat_metadata 才有意义
  function chatUsable(ctx) {
    return !!(ctx && ctx.chatId && ctx.chatId !== 'default');
  }

  function settings() {
    const a = api();
    return a && a.getSettings ? a.getSettings() : {};
  }
  function syncEnabled() { return settings().syncToChat === true; }
  function autoBackupEnabled() { return settings().autoBackup === true; }

  // —— 按聊天隔离的 5 个存档键（命名与 core.js / worldbook.js 保持一致；改这里前先核对源模块）——
  //   state:       world_engine_<id>                      (core.js loadState/saveState)
  //   checkpoint:  world_engine_<id>_checkpoint           (core.js getCheckpointKey)
  //   fingerprint: world_engine_<id>_fingerprint          (core.js getFingerprintKey)
  //   anchorLayer: world_engine_<id>_anchorLayer          (core.js getAnchorLayerKey，旧版遗留)
  //   worldbook:   world_engine_worldbook_selection_<id>  (worldbook.js getSelectionKey)
  const SLOTS = {
    state:       id => `world_engine_${id}`,
    checkpoint:  id => `world_engine_${id}_checkpoint`,
    fingerprint: id => `world_engine_${id}_fingerprint`,
    anchorLayer: id => `world_engine_${id}_anchorLayer`,
    worldbook:   id => `world_engine_worldbook_selection_${id}`
  };
  const SLOT_NAMES = Object.keys(SLOTS);

  // 本地修订号键：仅设备本地记账（Lamport 计数器），不属于 slot、不进聊天、不触发同步
  function revKey(id) { return `world_engine_${id}_syncrev`; }

  // 安装存档期间挂起同步槽，避免「写回 store → 又被当成新写入推回聊天」的回弹
  let _suspend = false;
  // 自动备份基线轮次：仅在轮次较此推进时才新增一条自动备份（打开聊天时以当前轮次为基线）
  let _lastAutoRound = null;

  // ========== slot 打包 / 安装 ==========

  // 判断某个 store key 是否属于「当前聊天」的可同步 slot；不是则返回 null
  function slotOfKey(key, id) {
    for (const name of SLOT_NAMES) if (SLOTS[name](id) === key) return name;
    return null;
  }

  function hasAnyLocal(id) {
    for (const name of SLOT_NAMES) if (store().getItem(SLOTS[name](id)) != null) return true;
    return false;
  }

  // 剥离 state / checkpoint 里纯调试、可由 ensureArrays 重建的字段，给聊天文件瘦身
  function stripHeavy(rawJson) {
    try {
      const o = JSON.parse(rawJson);
      delete o.lastInjection;
      delete o.lastEvolveResult;
      return JSON.stringify(o);
    } catch (e) { return rawJson; }
  }

  // 把当前聊天的 slot 原样打包成 { slotName: rawString }（缺失的 slot 不放）
  function packChat(id) {
    const data = {};
    for (const name of SLOT_NAMES) {
      const raw = store().getItem(SLOTS[name](id));
      if (raw == null) continue;
      data[name] = (name === 'state' || name === 'checkpoint') ? stripHeavy(raw) : raw;
    }
    return data;
  }

  // 逐 slot 比较两份 pack 是否相同。slot 值都是字符串，直接 === 比对，避免 JSON.stringify 双向序列化。
  // 用于 live 内容去重（无变化不推聊天）与自动备份去重比对。
  function sameData(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (a[k] !== b[k]) return false;
    return true;
  }

  // 估算 namespace 序列化后字节数：data 本就是字符串，累加各 slot 长度即可，
  // 避免每次 writeNamespace 都把整份 ns（最多 ~24 份完整状态）JSON.stringify 仅为取 .length 做软告警。
  function nsSize(ns) {
    let n = 0;
    if (ns.live && ns.live.data) {
      const d = ns.live.data;
      for (const k in d) n += (d[k] || '').length;
      n += 64; // live 元数据（rev/updatedAt/chatId）开销
    }
    if (Array.isArray(ns.snapshots)) {
      for (const s of ns.snapshots) {
        const d = s && s.data;
        if (d) for (const k in d) n += (d[k] || '').length;
        n += 80; // snapshot 元数据开销
      }
    }
    return n;
  }

  // 把一份 pack 安装回 store；exact=true 时删除 pack 里不存在的 slot（精确还原）
  function installPack(data, id, exact) {
    data = data || {};
    _suspend = true;
    try {
      for (const name of SLOT_NAMES) {
        const key = SLOTS[name](id);
        if (Object.prototype.hasOwnProperty.call(data, name) && data[name] != null) {
          store().setItem(key, data[name]);
        } else if (exact) {
          // [FIX] checkpoint/fingerprint 是自动推演的计数锚点，缺了会令 anchor 回退全空、触发死锁
          //   （见 world-engine.js runAutoEvolution 的 anchor 兜底）。云端 live.data 缺这俩时，保留本地已有值，
          //   不随 exact 删除；其余 slot（state/worldbook/anchorLayer）仍按精确还原语义删。
          if (name === 'checkpoint' || name === 'fingerprint') continue;
          store().removeItem(key);
        }
      }
    } finally {
      _suspend = false;
    }
  }

  function currentRound(id) {
    try { return JSON.parse(store().getItem(SLOTS.state(id)) || '{}').round || 0; }
    catch (e) { return 0; }
  }

  // ========== chat_metadata 命名空间读写 ==========

  function readNamespace() {
    const ctx = getCtx();
    const md = ctx && ctx.chatMetadata;
    const ns = md && md[NS];
    return (ns && typeof ns === 'object') ? ns : null;
  }

  function ensureNamespace() {
    const ns = readNamespace() || {};
    ns.v = SCHEMA_VERSION;
    if (!ns.live) ns.live = null;
    if (!Array.isArray(ns.snapshots)) ns.snapshots = [];
    pruneSnapshots(ns); // 升级后旧条数可能超过现 limit，即时收敛（堵住"仅在下一次 addSnapshot 才 prune"的迁移缺口）
    return ns;
  }

  // 写整个命名空间并持久化到聊天文件。updateChatMetadata 做顶层浅合并，只替换 world_engine 键。
  function writeNamespace(ns) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return false;
    try {
      const size = nsSize(ns);
      if (size > SIZE_WARN_BYTES) {
        console.warn(`[世界引擎] 酒馆缓存体积偏大（约 ${(size / 1024).toFixed(0)}KB），可能拖慢聊天保存，建议减少存档条数。`);
      }
      if (typeof ctx.updateChatMetadata === 'function') {
        ctx.updateChatMetadata({ [NS]: ns });
      } else if (ctx.chatMetadata) {
        ctx.chatMetadata[NS] = ns; // 退路：直接挂在当前 chat_metadata 上
      } else {
        return false;
      }
      // 持久化：优先用去抖版（group 安全，会在切聊天时自动放弃保存）
      if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
      else if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
      else if (typeof ctx.saveChat === 'function') ctx.saveChat();
      return true;
    } catch (e) {
      console.warn('[世界引擎] 写 chat_metadata 失败', e);
      return false;
    }
  }

  // ========== Lamport 修订号 ==========

  function localRev(id) {
    const v = parseInt(store().getItem(revKey(id)) || '0', 10);
    return Number.isFinite(v) ? v : 0;
  }
  function setLocalRev(id, rev) {
    _suspend = true; // 修订号不是 slot，但仍走 store；挂起以防触发 tick
    try { store().setItem(revKey(id), String(rev)); } finally { _suspend = false; }
  }

  // 把本地工作区作为 live 推上聊天，修订号 +1（用于：开启同步播种、本地较新收敛、恢复后置顶）
  // force=true 时无条件推送（恢复存档后即使内容相同也要把 live 指向恢复后的状态）；
  // 否则当新打包内容与 ns.live.data 完全一致时，返回当前 rev 不 +1、不写盘——
  // 避免无变化的 slot 写入也触发一次整份聊天文件保存（升级后高频卡顿的主因之一）。
  // 返回：带 nsArg 时返回新 rev（或 null 表示未推）；不带 nsArg 时返回 true/false。
  function pushLiveNow(nsArg, force) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return nsArg ? null : false;
    const id = ctx.chatId;
    const data = packChat(id);
    // 安全护栏：本地没有任何存档时，绝不用空内容覆盖聊天里已有的 live。
    // 否则「丢了本地数据的设备」一旦先开同步，就会把别处真实存档清空（exact 安装会删 slot）。
    if (Object.keys(data).length === 0) return nsArg ? null : false;
    const ns = nsArg || ensureNamespace();
    // 内容去重：无变化时不推送、不 bump rev（force 除外）
    if (!force && ns.live && ns.live.chatId === id && sameData(ns.live.data, data)) {
      const curRev = (ns.live && ns.live.rev) || localRev(id);
      return nsArg ? curRev : true;
    }
    const rev = Math.max(localRev(id), (ns.live && ns.live.rev) || 0) + 1;
    ns.live = { rev, updatedAt: Date.now(), chatId: id, data };
    if (nsArg) return rev; // 调用方负责 writeNamespace + setLocalRev
    if (writeNamespace(ns)) { setLocalRev(id, rev); return true; }
    return false;
  }

  // ========== 同步槽回调 + 去抖 tick ==========

  let _tickTimer = null;
  function scheduleTick() {
    if (!syncEnabled() && !autoBackupEnabled()) return;
    if (_tickTimer) clearTimeout(_tickTimer);
    _tickTimer = setTimeout(() => { _tickTimer = null; runTick(); }, TICK_DELAY);
  }

  // 一次 tick 把「live 同步」与「自动备份」合并为一次聊天写入，减少聊天保存次数
  function runTick() {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return;
    const id = ctx.chatId;
    if (!syncEnabled() && !autoBackupEnabled()) return;
    const ns = ensureNamespace();
    let changed = false;
    let revToSet = null;

    if (syncEnabled()) {
      const prevRev = (ns.live && ns.live.rev) || 0;
      const r = pushLiveNow(ns, false); // 内容去重：无变化时返回当前 rev、不更新 ns.live
      if (r != null && r !== prevRev) { revToSet = r; changed = true; }
    }
    if (autoBackupEnabled() && addAutoBackupIfAdvanced(ns, id)) {
      changed = true;
    }
    if (changed && writeNamespace(ns) && revToSet != null) setLocalRev(id, revToSet);
  }

  function onStoreWrite(key, value) {
    try { memoryScope.onStoreWrite(key); }
    catch (e) { console.warn('[记忆引擎] 酒馆缓存写入调度失败（已隔离）', e); }
    if (_suspend) return;
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return;
    if (!slotOfKey(key, ctx.chatId)) return; // 只关心当前聊天的 slot；设置键、其他聊天键一律忽略
    scheduleTick();
  }
  function onStoreRemove(key) { onStoreWrite(key, null); }

  // ========== 聊天加载：实时同步的恢复 / 收敛 ==========

  function onChatLoaded() {
    try { memoryScope.onChatLoaded(); }
    catch (e) { console.warn('[记忆引擎] 酒馆缓存恢复失败（已隔离）', e); }
    // 丢弃上一个聊天遗留的 pending tick，避免它在 B 上下文意外写盘 / 生成自动备份
    if (_tickTimer) { clearTimeout(_tickTimer); _tickTimer = null; }
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return;
    const id = ctx.chatId;
    _lastAutoRound = currentRound(id); // 以打开时轮次为基线，仅之后推进才自动备份
    if (!syncEnabled()) return;        // 实时同步关闭时不自动改本地工作区（存档为纯手动）

    const ns = readNamespace();
    const lr = localRev(id);
    const remoteData = (ns && ns.live && ns.live.data) || {};
    const remoteRev = (ns && ns.live && ns.live.rev) || 0;
    // 聊天里还没有 live（或 live 内容为空 / 已损坏）：本地有数据则推上去做种子
    if (!ns || !ns.live || Object.keys(remoteData).length === 0) {
      if (hasAnyLocal(id)) pushLiveNow();
      return;
    }
    if (remoteRev > lr) {
      installPack(remoteData, id, true); // 远端较新 → 采用
      setLocalRev(id, remoteRev);
      console.log(`[世界引擎] 酒馆缓存：采用云端较新存档 rev ${remoteRev}（本地 ${lr}）`);
    } else if (remoteRev < lr) {
      pushLiveNow(); // 本地较新 → 推上去收敛
    }
    // remoteRev === lr：已同步，无需处理
  }

  // ========== 存档 / 备份 ==========

  function genId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function addSnapshot(ns, snap, id) {
    snap.id = snap.id || genId();
    snap.createdAt = snap.createdAt || Date.now();
    snap.chatId = id;
    snap.v = SCHEMA_VERSION;
    ns.snapshots.unshift(snap); // 新→旧
    pruneSnapshots(ns);
    return snap;
  }

  // 自动备份滚动保留 MAX_AUTO_BACKUPS 条；手动 / 导入保留 MAX_MANUAL_BACKUPS 条；维持原有新→旧顺序
  function pruneSnapshots(ns) {
    const keepAuto = ns.snapshots.filter(s => s.auto).slice(0, MAX_AUTO_BACKUPS);
    const keepManual = ns.snapshots.filter(s => !s.auto).slice(0, MAX_MANUAL_BACKUPS);
    ns.snapshots = ns.snapshots.filter(s => (s.auto ? keepAuto : keepManual).includes(s));
  }

  function addAutoBackupIfAdvanced(ns, id) {
    const round = currentRound(id);
    if (round <= 0) return false;
    if (_lastAutoRound != null && round <= _lastAutoRound) return false;
    const packed = packChat(id);
    const newestAuto = ns.snapshots.find(s => s.auto);
    if (newestAuto && sameData(newestAuto.data, packed)) {
      _lastAutoRound = round; // 与最新自动备份内容相同 → 跳过，但更新基线
      return false;
    }
    addSnapshot(ns, { name: `自动备份 · 第${round}轮`, auto: true, round, data: packed }, id);
    _lastAutoRound = round;
    return true;
  }

  // —— 对外（UI）接口 ——

  function listSnapshots() {
    const ns = readNamespace();
    return ns && Array.isArray(ns.snapshots) ? ns.snapshots.slice() : [];
  }

  // 手动命名存档；返回创建的 snapshot 或 null
  function createSnapshot(name) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return null;
    const id = ctx.chatId;
    if (!hasAnyLocal(id)) return null;
    const ns = ensureNamespace();
    const round = currentRound(id);
    const snap = addSnapshot(ns, {
      name: String(name || `存档 · 第${round}轮`).trim().slice(0, 60) || `存档 · 第${round}轮`,
      auto: false, round, data: packChat(id)
    }, id);
    return writeNamespace(ns) ? snap : null;
  }

  // 恢复某存档到当前聊天（覆盖工作区）。恢复前自动备份当前状态以便回退。
  function restoreSnapshot(snapId) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return false;
    const id = ctx.chatId;
    const ns = ensureNamespace();
    const snap = ns.snapshots.find(s => s.id === snapId);
    if (!snap) return false;
    if (hasAnyLocal(id)) {
      addSnapshot(ns, {
        name: `恢复前自动备份 · 第${currentRound(id)}轮`, auto: true, round: currentRound(id), data: packChat(id)
      }, id);
    }
    installPack(snap.data, id, true);
    normalizeAfterRestore(id); // 楼层/指纹归一化到当前层数，避免被误判为重 roll（与「数据导入」一致）
    // 在同一个 ns 上更新 live（指向恢复后的状态），最后只落盘一次，避免两次 writeNamespace 互相覆盖
    let revToSet = null;
    if (syncEnabled()) revToSet = pushLiveNow(ns, true); // force：恢复后即使内容相同也要把 live 指向恢复后的状态，避免下次 onChatLoaded 被云端旧值覆盖
    if (writeNamespace(ns) && revToSet != null) setLocalRev(id, revToSet);
    return true;
  }

  // 恢复历史存档后：把 state/checkpoint 的 chatLayer、fingerprint 对齐到「当前对话层数」。
  // 与 ui.js 的「数据导入」逻辑一致，否则旧层数会让正文注入/推演把本轮误判为重 roll。
  function normalizeAfterRestore(id) {
    const layer = core().getChatLayer();
    _suspend = true;
    try {
      const stateRaw = store().getItem(SLOTS.state(id));
      if (stateRaw != null) {
        const st = JSON.parse(stateRaw); st.chatLayer = layer;
        store().setItem(SLOTS.state(id), JSON.stringify(st));
      }
      const cpRaw = store().getItem(SLOTS.checkpoint(id));
      if (cpRaw != null) {
        const cp = JSON.parse(cpRaw); cp.chatLayer = layer;
        store().setItem(SLOTS.checkpoint(id), JSON.stringify(cp));
      }
      store().setItem(SLOTS.fingerprint(id), String(layer));
    } catch (e) {
      console.warn('[世界引擎] 恢复后归一化失败', e);
    } finally {
      _suspend = false;
    }
  }

  function renameSnapshot(snapId, name) {
    const ns = ensureNamespace();
    const snap = ns.snapshots.find(s => s.id === snapId);
    if (!snap) return false;
    snap.name = String(name || snap.name).trim().slice(0, 60) || snap.name;
    return writeNamespace(ns);
  }

  function deleteSnapshot(snapId) {
    const ns = ensureNamespace();
    const before = ns.snapshots.length;
    ns.snapshots = ns.snapshots.filter(s => s.id !== snapId);
    if (ns.snapshots.length === before) return false;
    return writeNamespace(ns);
  }

  // 导出单条存档为可下载对象（UI 负责落成文件）
  function exportSnapshot(snapId) {
    const ns = readNamespace();
    const snap = ns && ns.snapshots.find(s => s.id === snapId);
    if (!snap) return null;
    return {
      type: 'world-engine-chat-snapshot', v: SCHEMA_VERSION,
      name: snap.name, round: snap.round, createdAt: snap.createdAt,
      exportedAt: Date.now(), data: snap.data
    };
  }

  // 从导出对象导入为一条新存档；返回创建的 snapshot 或 null
  function importSnapshot(obj) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return null;
    if (!obj || obj.type !== 'world-engine-chat-snapshot' || !obj.data || typeof obj.data !== 'object') return null;
    const ns = ensureNamespace();
    const snap = addSnapshot(ns, {
      name: (String(obj.name || '导入存档').trim().slice(0, 52) || '导入存档') + '（导入）',
      auto: false, round: obj.round || 0, data: obj.data
    }, ctx.chatId);
    return writeNamespace(ns) ? snap : null;
  }

  // 面板状态展示用
  function getStatus() {
    const ctx = getCtx();
    const usable = chatUsable(ctx);
    const ns = readNamespace();
    return {
      usable,
      chatId: usable ? ctx.chatId : null,
      apiAvailable: !!(ctx && typeof ctx.updateChatMetadata === 'function' && typeof ctx.saveMetadataDebounced === 'function'),
      syncEnabled: syncEnabled(),
      autoBackupEnabled: autoBackupEnabled(),
      liveRev: ns && ns.live ? ns.live.rev : 0,
      localRev: usable ? localRev(ctx.chatId) : 0,
      liveUpdatedAt: ns && ns.live ? ns.live.updatedAt : null,
      snapshotCount: ns && ns.snapshots ? ns.snapshots.length : 0
    };
  }

  // ========== 记忆引擎 scope ==========
  // 共用本模块的聊天上下文、chat_metadata 写入、存档交互和 store sink；只更换设置与 slot。
  const memoryScope = (function() {
    const MEMORY_NS = 'memory_engine';
    const MSLOTS = {
      state: id => `memory_engine_state_${id}`,
      checkpoint: id => `memory_engine_checkpoint_${id}`,
      worldbook: id => `memory_engine_worldbook_selection_${id}`
    };
    let suspend = false, tickTimer = null, lastAutoState = null;
    const msettings = () => window.MEMORY_ENGINE_SETTINGS?.getSettings?.() || {};
    const syncOn = () => msettings().syncToChat === true;
    const backupOn = () => msettings().autoBackup === true;
    const mrevKey = id => `memory_engine_${id}_syncrev`;
    const mrev = id => Math.max(0, parseInt(store().getItem(mrevKey(id)) || '0') || 0);
    function setMrev(id, rev) { suspend = true; try { store().setItem(mrevKey(id), String(rev)); } finally { suspend = false; } }
    function isSlot(key, id) { return Object.values(MSLOTS).some(make => make(id) === key); }
    function hasLocal(id) { return Object.values(MSLOTS).some(make => store().getItem(make(id)) != null); }
    function mpack(id) {
      const data = {};
      for (const name in MSLOTS) { const raw = store().getItem(MSLOTS[name](id)); if (raw != null) data[name] = raw; }
      return data;
    }
    function minstall(data, id, exact) {
      suspend = true;
      try {
        for (const name in MSLOTS) {
          if (Object.prototype.hasOwnProperty.call(data || {}, name)) store().setItem(MSLOTS[name](id), data[name]);
          else if (exact) store().removeItem(MSLOTS[name](id));
        }
      } finally { suspend = false; }
    }
    function meta(id) {
      try {
        const state = JSON.parse(store().getItem(MSLOTS.state(id)) || '{}');
        const entities = ['organization', 'object', 'ability', 'location']
          .reduce((sum, type) => sum + (Array.isArray(state.entity_memory?.[type]) ? state.entity_memory[type].length : 0), 0);
        return { round: Number(state.round) || 0, characters: Array.isArray(state.personal_memory) ? state.personal_memory.length : 0, entities };
      } catch (e) { return { round: 0, characters: 0, entities: 0 }; }
    }
    function read() { const ns = getCtx()?.chatMetadata?.[MEMORY_NS]; return ns && typeof ns === 'object' ? ns : null; }
    function ensure() {
      const ns = read() || { v: SCHEMA_VERSION, live: null, snapshots: [] };
      ns.v = SCHEMA_VERSION; if (!Array.isArray(ns.snapshots)) ns.snapshots = [];
      const auto = ns.snapshots.filter(s => s.auto).slice(0, MAX_AUTO_BACKUPS);
      const manual = ns.snapshots.filter(s => !s.auto).slice(0, MAX_MANUAL_BACKUPS);
      ns.snapshots = ns.snapshots.filter(s => (s.auto ? auto : manual).includes(s));
      return ns;
    }
    function write(ns) {
      const ctx = getCtx(); if (!chatUsable(ctx)) return false;
      try {
        if (typeof ctx.updateChatMetadata === 'function') ctx.updateChatMetadata({ [MEMORY_NS]: ns });
        else if (ctx.chatMetadata) ctx.chatMetadata[MEMORY_NS] = ns; else return false;
        if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
        else if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
        else if (typeof ctx.saveChat === 'function') ctx.saveChat();
        return true;
      } catch (e) { console.warn('[记忆引擎] 写聊天缓存失败', e); return false; }
    }
    function add(ns, input, id) {
      const info = meta(id);
      const snap = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: input.name, auto: !!input.auto, round: input.round ?? info.round, characters: input.characters ?? info.characters, entities: input.entities ?? info.entities, createdAt: Date.now(), chatId: id, v: SCHEMA_VERSION, data: input.data };
      ns.snapshots.unshift(snap);
      const autos = ns.snapshots.filter(s => s.auto).slice(0, MAX_AUTO_BACKUPS);
      const manuals = ns.snapshots.filter(s => !s.auto).slice(0, MAX_MANUAL_BACKUPS);
      ns.snapshots = ns.snapshots.filter(s => (s.auto ? autos : manuals).includes(s));
      return snap;
    }
    function pushLiveNow(nsArg, force) {
      const ctx = getCtx(); if (!chatUsable(ctx) || !hasLocal(ctx.chatId)) return false;
      const ns = nsArg || ensure(), data = mpack(ctx.chatId);
      if (!force && ns.live?.data && sameData(ns.live.data, data)) return nsArg ? ns.live.rev : true;
      const rev = Math.max(mrev(ctx.chatId), Number(ns.live?.rev) || 0) + 1;
      ns.live = { rev, updatedAt: Date.now(), chatId: ctx.chatId, data };
      if (nsArg) return rev;
      if (write(ns)) { setMrev(ctx.chatId, rev); return true; }
      return false;
    }
    function runTick() {
      tickTimer = null;
      const ctx = getCtx(); if (!chatUsable(ctx)) return;
      const ns = ensure(); let changed = false, rev = null;
      if (syncOn()) { const old = Number(ns.live?.rev) || 0; rev = pushLiveNow(ns, false); if (rev !== old) changed = true; }
      const stateRaw = store().getItem(MSLOTS.state(ctx.chatId));
      if (backupOn() && stateRaw && stateRaw !== lastAutoState) {
        const data = mpack(ctx.chatId), newest = ns.snapshots.find(s => s.auto);
        if (!newest || !sameData(newest.data, data)) { const info = meta(ctx.chatId); add(ns, { name: `自动备份 · 第${info.round}轮`, auto: true, data }, ctx.chatId); changed = true; }
        lastAutoState = stateRaw;
      }
      if (changed && write(ns) && rev != null) setMrev(ctx.chatId, rev);
    }
    function onStoreWrite(key) {
      const ctx = getCtx(); if (suspend || !chatUsable(ctx) || !isSlot(key, ctx.chatId) || (!syncOn() && !backupOn())) return;
      clearTimeout(tickTimer); tickTimer = setTimeout(runTick, TICK_DELAY);
    }
    function onChatLoaded() {
      clearTimeout(tickTimer); tickTimer = null;
      const ctx = getCtx(); if (!chatUsable(ctx)) return;
      lastAutoState = store().getItem(MSLOTS.state(ctx.chatId));
      if (!syncOn()) return;
      const ns = read(), remoteRev = Number(ns?.live?.rev) || 0, local = mrev(ctx.chatId);
      if (!ns?.live?.data || !Object.keys(ns.live.data).length) { if (hasLocal(ctx.chatId)) pushLiveNow(); }
      else if (remoteRev > local) { minstall(ns.live.data, ctx.chatId, true); setMrev(ctx.chatId, remoteRev); }
      else if (remoteRev < local) pushLiveNow();
    }
    function listSnapshots() { return (read()?.snapshots || []).slice(); }
    function createSnapshot(name) {
      const ctx = getCtx(); if (!chatUsable(ctx) || !hasLocal(ctx.chatId)) return null;
      const ns = ensure(), snap = add(ns, { name: String(name || '记忆存档').slice(0, 60), auto: false, data: mpack(ctx.chatId) }, ctx.chatId);
      return write(ns) ? snap : null;
    }
    function restoreSnapshot(id) {
      const ctx = getCtx(); if (!chatUsable(ctx)) return false;
      const ns = ensure(), snap = ns.snapshots.find(s => s.id === id); if (!snap) return false;
      if (hasLocal(ctx.chatId)) add(ns, { name: '恢复前自动备份', auto: true, data: mpack(ctx.chatId) }, ctx.chatId);
      minstall(snap.data, ctx.chatId, true);
      // 从其它聊天导入/恢复的记忆链不能继续沿用旧楼层游标；折叠为当前聊天 Root 后再向前累计。
      try {
        const memoryData = window.MEMORY_ENGINE_DATA;
        const restored = memoryData?.loadState?.();
        if (restored?.timeline?.originChatId && restored.timeline.originChatId !== ctx.chatId) {
          memoryData.saveState(memoryData.rebaseToCurrentChat(restored));
        }
      } catch (e) { console.warn('[记忆引擎] 跨聊天存档重定位失败', e); }
      const rev = syncOn() ? pushLiveNow(ns, true) : null;
      if (!write(ns)) return false; if (rev != null) setMrev(ctx.chatId, rev); return true;
    }
    function renameSnapshot(id, name) { const ns = ensure(), snap = ns.snapshots.find(s => s.id === id); if (!snap) return false; snap.name = String(name || snap.name).slice(0, 60); return write(ns); }
    function deleteSnapshot(id) { const ns = ensure(), before = ns.snapshots.length; ns.snapshots = ns.snapshots.filter(s => s.id !== id); return ns.snapshots.length !== before && write(ns); }
    function exportSnapshot(id) { const s = listSnapshots().find(x => x.id === id); return s ? { type: 'memory-engine-chat-snapshot', v: SCHEMA_VERSION, name: s.name, round: s.round, characters: s.characters, entities: s.entities, createdAt: s.createdAt, data: s.data } : null; }
    function importSnapshot(obj) {
      const ctx = getCtx(); if (!chatUsable(ctx) || obj?.type !== 'memory-engine-chat-snapshot' || !obj.data) return null;
      const ns = ensure(), snap = add(ns, { name: String(obj.name || '导入存档') + '（导入）', auto: false, round: obj.round, characters: obj.characters, entities: obj.entities, data: obj.data }, ctx.chatId);
      return write(ns) ? snap : null;
    }
    function getStatus() { const ctx = getCtx(), ns = read(); return { usable: chatUsable(ctx), apiAvailable: !!(ctx && (typeof ctx.updateChatMetadata === 'function' || ctx.chatMetadata)), syncEnabled: syncOn(), autoBackupEnabled: backupOn(), localRev: chatUsable(ctx) ? mrev(ctx.chatId) : 0, liveRev: Number(ns?.live?.rev) || 0, snapshotCount: ns?.snapshots?.length || 0 }; }
    return { onStoreWrite, onChatLoaded, pushLiveNow, getStatus, listSnapshots, createSnapshot, restoreSnapshot, renameSnapshot, deleteSnapshot, exportSnapshot, importSnapshot };
  })();

  // ========== 初始化 ==========

  let _inited = false;
  function init() {
    if (_inited) return;
    _inited = true;
    store().setSyncSink({ onWrite: onStoreWrite, onRemove: onStoreRemove });
    // 聊天缓存属于共用底座，生命周期不能挂靠在世界或任一业务引擎上。
    // 本监听器在各引擎监听器之前注册，切聊天时先恢复所有已知 scope。
    const ctx = getCtx();
    if (ctx?.eventSource?.on) {
      const eventName = ctx.event_types?.CHAT_LOADED || 'chat_loaded';
      const guard = window.WORLD_ENGINE_GUARD_EVENT;
      const handler = typeof guard === 'function'
        ? guard('共用缓存', '聊天加载', onChatLoaded)
        : function() { try { onChatLoaded(); } catch (e) { console.error('[共用缓存] 聊天加载事件处理失败', e); } };
      ctx.eventSource.on(eventName, handler);
    }
    // 扩展加载时聊天通常已就绪（页面刷新、扩展中途启用）：对当前聊天做一次恢复 / 收敛
    try { onChatLoaded(); } catch (e) { console.warn('[世界引擎] 酒馆缓存初始化恢复失败', e); }
  }

  function forScope(scope) {
    if (scope === 'memory') return memoryScope;
    if (scope == null || scope === '' || scope === 'world') return null;
    throw new Error(`未知聊天缓存 scope: ${scope}`);
  }

  return {
    init, onChatLoaded, pushLiveNow, getStatus,
    listSnapshots, createSnapshot, restoreSnapshot, renameSnapshot, deleteSnapshot,
    exportSnapshot, importSnapshot,
    forScope
  };
})();
