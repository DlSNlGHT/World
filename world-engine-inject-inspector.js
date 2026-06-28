// world-engine-inject-inspector.js — 注入自检查看器（解耦 / 纯只读）
//
// 为什么有这个模块：registerInjection() 的 return true 只代表「调 ST setExtensionPrompt 没抛异常」，
//   从不证明那段世界状态真的进了最终发给大模型的 prompt。客户「注入不成功」无从判断，我们也判断不了。
//   本模块订阅 ST 两个「黄金事件」，读取**我们注入之后 ST 真正拼好的 prompt 链**，按 role 分好，
//   用大白话判定本轮注入：✅成功 / ❌注册了却没进正文 / ⏸按设计跳过(关了 or 同层重roll) / —还没生成。
//
// 铁律（绝不搞 bug）：
//   - 纯只读：只读事件 eventData、ctx.extensionPrompts、core/api 的 getter；不写任何存储、不改注入逻辑、不动数据结构。
//   - 绝不 mutate eventData（不写 .prompt / .chat）。
//   - 不持有 live 引用：立刻拷成轻量描述对象 + 复制字符串。
//   - 整个 handler try/catch 包死：即便 ST 换版本 eventData 形状变了，throw 也被吞，绝不影响生成。
//   - 只留最后一份快照，内存有界。
//
// 撤回成本：删本文件 + 删 world-engine.js MODULES 一行 + 删 init 一行（+ 删 UI renderDebug 顶部卡 + diag 一段）。
window.WORLD_ENGINE_INJECT_INSPECTOR = (function() {
  'use strict';

  // 与 world-engine.js 的 INJECTION_NAME 对应（我们注册到 ST extension_prompts 用的 key）。
  const INJECTION_NAME = 'world-engine-world';

  // 着陆哨兵：buildContext() 输出永远以「【世界状态】」开头（world-engine-inject.js），
  //   该子串无任何 {{...}} 宏，不被 ST substituteParams 改写 → 拿它判「注入是否进了最终 prompt」最稳。
  //   （注：拿完整注入串做 indexOf 会因 {{user}} 等宏被展开而假阴性，故只认这个无宏哨兵。）
  const SENTINEL = '【世界状态】';

  // 事件名（字面量；运行时优先用 ctx.event_types 的常量，取不到再回退字面量）。
  const EV_TEXT = 'generate_after_combine_prompts';   // 文本补全/经典 API：eventData={prompt,dryRun}
  const EV_CHAT = 'chat_completion_prompt_ready';      // 对话补全/OpenAI 类：eventData={chat:[{role,content}],dryRun}

  let _subscribed = false;
  let _last = null;  // 只留最后一份快照

  function getCtx() {
    try { return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null; }
    catch (e) { return null; }
  }

  // —— 在事件当下采集只读环境字段（此刻 extension_prompts 仍持有本轮注册） ——
  function snapEnv(ctx) {
    const api = window.WORLD_ENGINE_API;
    const core = window.WORLD_ENGINE_CORE;
    let injectEnabled = true, registeredAtSend = false, sameLayerReroll = false, round = null;

    try { injectEnabled = !(api && api.getSettings && api.getSettings(true).injectIntoPrompt === false); } catch (e) {}

    // 独立确认「我们这轮到底注册没注册」——区分「注册了没着陆=真bug」与「我们自己没注册=按设计跳过」。
    try {
      const ep = ctx && ctx.extensionPrompts;
      const entry = ep && ep[INJECTION_NAME];
      registeredAtSend = !!(entry && entry.value && String(entry.value).length);
    } catch (e) {}

    // 同层重 roll 判据（与 world-engine.js applyInjectionForCurrentRound 同一 fingerprint 口径）。
    try {
      const fp = core && core.loadFingerprint ? core.loadFingerprint() : '';
      const fpLayer = (fp !== '' && Number.isFinite(Number(fp))) ? Number(fp) : null;
      const chatLayer = core && core.getChatLayer ? core.getChatLayer() : null;
      sameLayerReroll = (fpLayer != null && chatLayer != null && fpLayer === chatLayer);
    } catch (e) {}

    try { round = core && core.loadState ? core.loadState().round : null; } catch (e) {}

    return { injectEnabled, registeredAtSend, sameLayerReroll, round };
  }

  // —— 对话补全：从真·最终 chat 数组采 role 分好的链（克隆，不持有 live 引用） ——
  //   每条都克隆完整 content 供 UI 只读展开（用户需要核对全部 role 的实际内容，不只是我们注入那条）。
  //   仅留最后一份快照、内存有界；diag 导出侧不带 content（隐私：含角色卡/世界书/聊天历史原文）。
  function snapChat(chat, env) {
    const messages = [];
    let landed = false, ourContent = '', ourIndex = -1;
    for (let i = 0; i < chat.length; i++) {
      const m = chat[i] || {};
      const content = (m.content != null) ? String(m.content) : '';
      const isOurs = content.indexOf(SENTINEL) >= 0;
      messages.push({ role: m.role || '?', length: content.length, isOurs: isOurs, content: content });
      if (isOurs && !landed) {
        landed = true;
        ourIndex = i;
        ourContent = content; // 我们自己的世界状态数据，完整保留
      }
    }
    return {
      apiType: 'chat',
      ts: nowTs(),
      round: env.round,
      injectEnabled: env.injectEnabled,
      registeredAtSend: env.registeredAtSend,
      sameLayerReroll: env.sameLayerReroll,
      landed: landed,
      messageCount: messages.length,
      messages: messages,
      ourIndex: ourIndex,
      ourContent: ourContent,
      status: deriveStatus(env, landed),
    };
  }

  // —— 文本补全：prompt 已 flatten 成单串，链不可分 role；存长度 + 哨兵命中 + 哨兵附近摘录 ——
  function snapText(prompt, env) {
    const text = String(prompt || '');
    const idx = text.indexOf(SENTINEL);
    const landed = idx >= 0;
    let excerpt = '';
    if (landed) {
      const a = Math.max(0, idx - 40);
      const b = Math.min(text.length, idx + 300);
      excerpt = (a > 0 ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : '');
    }
    return {
      apiType: 'text',
      ts: nowTs(),
      round: env.round,
      injectEnabled: env.injectEnabled,
      registeredAtSend: env.registeredAtSend,
      sameLayerReroll: env.sameLayerReroll,
      landed: landed,
      promptLength: text.length,
      ourExcerpt: excerpt,
      status: deriveStatus(env, landed),
    };
  }

  // —— 状态机：纯从只读字段推导，诚实不过 claim ——
  function deriveStatus(env, landed) {
    if (!env.injectEnabled) return 'SKIPPED_DISABLED';
    if (!env.registeredAtSend) return env.sameLayerReroll ? 'SKIPPED_REROLL' : 'SKIPPED_OTHER';
    return landed ? 'SUCCESS' : 'MISSING';
  }

  function nowTs() { try { return Date.now(); } catch (e) { return 0; } }

  // —— 事件处理：共用骨架，全程 try/catch，dryRun 一律忽略，绝不改 eventData ——
  function onChatPromptReady(eventData) {
    try {
      if (!eventData || eventData.dryRun) return;            // 忽略算 token 的预热轮
      if (!Array.isArray(eventData.chat)) return;            // 形状防御
      const ctx = getCtx();
      _last = snapChat(eventData.chat, snapEnv(ctx));        // 不持有 eventData.chat 本体
    } catch (e) { /* 只读自检绝不影响生成 */ }
  }

  function onTextPromptReady(eventData) {
    try {
      if (!eventData || eventData.dryRun) return;
      if (typeof eventData.prompt !== 'string') return;
      const ctx = getCtx();
      _last = snapText(eventData.prompt, snapEnv(ctx));
    } catch (e) {}
  }

  // —— 初始化：订阅黄金事件（单订阅守卫，由主入口显式调用，避免加载时序竞态） ——
  function init() {
    if (_subscribed) return;
    try {
      const ctx = getCtx();
      if (!ctx || !ctx.eventSource || typeof ctx.eventSource.on !== 'function') {
        console.warn('[世界引擎] 注入自检：eventSource 不可用，跳过订阅');
        return;
      }
      const et = ctx.event_types || {};
      ctx.eventSource.on(et.CHAT_COMPLETION_PROMPT_READY || EV_CHAT, onChatPromptReady);
      ctx.eventSource.on(et.GENERATE_AFTER_COMBINE_PROMPTS || EV_TEXT, onTextPromptReady);
      _subscribed = true;
      console.log('[世界引擎] 注入自检查看器就绪（只读订阅 prompt-ready 事件）');
    } catch (e) {
      console.warn('[世界引擎] 注入自检订阅失败（非致命）:', e && e.message);
    }
  }

  // 返回最后一份快照（只读副本引用；UI/diag 只读不写）。无则 null。
  function getLastSnapshot() { return _last; }

  // 状态码 → 大白话（UI 与 diag 共用，单一真相源）。
  const STATUS_TEXT = {
    NOT_YET: '尚未生成，暂无注入记录',
    SKIPPED_DISABLED: '本轮未注入：注入正文已关闭（插头/设置）',
    SKIPPED_REROLL: '本轮按设计未注入：同层重 roll（swipe/重新生成）',
    SKIPPED_OTHER: '本轮未注入：尚未触发推演或无世界状态',
    SUCCESS: '✅ 本轮世界状态已进入正文',
    MISSING: '❌ 已注册却没进最终 prompt——这才是真正的注入失败（疑被其它扩展清除/深度越界）',
  };
  function statusText(status) { return STATUS_TEXT[status] || STATUS_TEXT.NOT_YET; }

  return { init, getLastSnapshot, statusText, SENTINEL };
})();
