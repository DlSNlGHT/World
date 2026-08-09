// world-engine-api.js — 独立 API 调用（支持自定义 OpenAI 兼容 API）
window.WORLD_ENGINE_API = (function() {
  let cachedSettings = null;

  function getChatId() {
    try {
      if (window.WORLD_ENGINE_CORE && typeof window.WORLD_ENGINE_CORE.getChatId === 'function') {
        return window.WORLD_ENGINE_CORE.getChatId() || 'default';
      }
      const ctx = window.SillyTavern && typeof window.SillyTavern.getContext === 'function' ? window.SillyTavern.getContext() : null;
      return (ctx && (ctx.chatId || ctx.chat_id || ctx.chat)) || 'default';
    } catch (e) {
      return 'default';
    }
  }

  function getChatTonePrompt() {
    try {
      const store = window.WORLD_ENGINE_STORE;
      if (!store || typeof store.getItem !== 'function') return null;
      return store.getItem('world_engine_tone_prompt_' + getChatId());
    } catch (e) {
      return null;
    }
  }

  function setChatTonePrompt(text) {
    try {
      const store = window.WORLD_ENGINE_STORE;
      if (!store || typeof store.setItem !== 'function') return false;
      store.setItem('world_engine_tone_prompt_' + getChatId(), text || '');
      return true;
    } catch (e) {
      return false;
    }
  }

  function getSettings(forceRefresh) {
    if (forceRefresh) cachedSettings = null;
    if (cachedSettings) return cachedSettings;
    const defaults = {
      apiUrl: '',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      // [移植 v2.3.21·pigment 适配] 上游默认 2000；pigment 推演一直用 8000（世界状态 JSON 大，
      // 2000 必截断），此字段此前无 UI 无调用方，默认直接取 8000 保持推演现状
      maxTokens: 8000,
      // [移植上游 1211a27] 仅 API fault 自动重试；0 = 不重试。
      apiAutoRetries: 0,
      useStProxy: true,
      injectIntoPrompt: true,
      // 悬浮球开关：关闭后从酒馆「魔法棒」扩展菜单打开面板，推进钮移到面板标题栏
      showFloatingBall: true,
      // [移植 v2.4.1] 正文注入最大字符数。0 = 不限制
      injectMaxChars: 5000,
      // false 保持原等级筛选；true 时事件链与风声 Lv1-Lv4 全部注入正文。
      injectAllLevels: false,
      evolveMode: 'auto',
      evolveEveryX: 1,
      evolveReadRounds: 1,
      // [移植 v2.3.20 区间] 手动推演读取轮数上限（存档点锚定，实际读 min(经过轮数, 此上限)）
      manualReadRounds: 1,
      evolveFilterRegex: '',
      worldbookTrigger: false,
      tonePrompt: '',
      // 按时间推演模式
      evolveTimeFront: 0,
      evolveTimeBack: 80,
      evolveTimeRe1: '', evolveTimeRe2: '', evolveTimeRe3: '',
      evolveTimeRe4: '', evolveTimeRe5: '', evolveTimeRe6: '',
      evolveTimeMul1: 360, evolveTimeMul2: 30, evolveTimeMul3: 1,
      evolveTimeThreshold: 1,
      evolveTimeMaxRounds: 10,
      // [移植 v2.4.1] 本地机制调参。默认值 = 原硬编码行为。
      //   区域事件三项默认值另有「跟随预设」语义：保持默认时用预设/内置值，改动后覆盖预设（见 evolution.js tunedRegionalConfig）
      localRegionalIncidentChancePercent: 3,
      localRegionalIncidentDuration: 5,
      localRegionalIncidentCooldown: 5,
      // 远方/近端随机动态。仅在当前预设启用 canonical events/winds 时运行。
      localDistantEventLedgerThreshold: 10,
      localDistantEventChancePercent: 20,
      localDistantEventCooldown: 5,
      localDistantEventEventPercent: 50,
      localNearEventChancePercent: 20,
      localNearEventCooldown: 5,
      localNearEventEventPercent: 50,
      localEventDiceModifier: 0,
      localEventSetbackRatioPercent: 40,
      localProgressFailBase: 2,
      localConflictFailBase: 6,
      localTerminalBaseKeepRounds: 2,
      localTerminalLevelKeepRounds: 2,
      localInfluenceKeepRounds: 8,
      localEnemyTerminalKeepRounds: 20,
      localLedgerKeepRounds: 20,
      localCapEvents: 16,
      localCapFactions: 15,
      localCapWinds: 12,
      localCapWorldTrends: 4,
      localCapInfluence: 12,
      localCapEnemies: 8,
      localCapEconomySignals: 8,
      localCapBlackbox: 12,
      localWindAnnouncementBase: 10,
      localWindAnnouncementGrace: 4,
      localWindAnnouncementLinear: 3,
      localWindAnnouncementQuadratic: 1,
      localWindReportBase: 20,
      localWindReportGrace: 2,
      localWindReportLinear: 4,
      localWindReportQuadratic: 2,
      localWindRumorBase: 25,
      localWindRumorGrace: 1,
      localWindRumorLinear: 5,
      localWindRumorQuadratic: 3,
      localWindSentimentBase: 8,
      localWindSentimentGrace: 5,
      localWindSentimentLinear: 2,
      localWindSentimentQuadratic: 1,
      // [FIX 移植自上游 2.3.15] API 请求超时（毫秒）。0 = 不超时（旧行为）。默认 120s：
      //   推演请求若落入网络黑洞（代理无响应/上游不返回也不报错），fetch 会永久挂起，
      //   evolve 的 _isRunning 永不复位，此后所有自动推演被 isRunning() 守卫静默跳过，
      //   直到用户切一次聊天才解锁。超时让挂起请求按失败处理，finally 正常复位。
      apiTimeoutMs: 120000
    };
    const raw = window.WORLD_ENGINE_STORE.getItem('world_engine_settings');
    let parsed = {};
    if (raw) {
      try { parsed = JSON.parse(raw) || {}; } catch(e) {}
    }
    cachedSettings = { ...defaults, ...parsed };
    const chatTonePrompt = getChatTonePrompt();
    if (chatTonePrompt !== null) {
      cachedSettings.tonePrompt = chatTonePrompt;
    } else if (typeof parsed.tonePrompt === 'string' && parsed.tonePrompt) {
      cachedSettings.tonePrompt = parsed.tonePrompt;
      if (setChatTonePrompt(parsed.tonePrompt)) {
        try {
          delete parsed.tonePrompt;
          window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify(parsed));
        } catch (e) {}
      }
    }
    return cachedSettings;
  }

  function normalizeUrl(url) {
    let u = url.trim().replace(/\/+$/, '');
    if (!u) return '';
    if (u.endsWith('/chat/completions')) return u;
    // 已带版本前缀（/v1、/v3、/api/v3、/api/coding/v3 等）→ 只补 /chat/completions，不再硬塞 /v1；
    // 否则火山方舟等自定义版本前缀会被拼成 .../v3/v1/chat/completions 而 404。
    // 裸 host（无版本段）仍按 OpenAI 风格补 /v1/chat/completions，保持旧配置不破。
    if (/\/v\d+$/.test(u)) return u + '/chat/completions';
    return u + '/v1/chat/completions';
  }

  // API 基址（去掉末尾 /chat/completions），例如 https://host/v1
  function getApiBase(settings) {
    const u = normalizeUrl(settings.apiUrl);
    if (!u) return '';
    return u.replace(/\/chat\/completions$/, '');
  }

  // 是否可走 SillyTavern 后端转发（服务器对服务器，无浏览器 CORS）
  // 需同时满足：用户开关开启（默认开） + 处于酒馆环境
  function canUseStProxy() {
    try {
      if (getSettings().useStProxy === false) return false;
      return typeof SillyTavern !== 'undefined'
        && typeof SillyTavern.getContext === 'function'
        && typeof SillyTavern.getContext().getRequestHeaders === 'function';
    } catch (e) {
      return false;
    }
  }

  // 取 ST 的请求头（含 CSRF token）
  function getContextHeaders() {
    try {
      const ctx = SillyTavern.getContext();
      const h = ctx.getRequestHeaders();
      if (h && !h['Content-Type']) h['Content-Type'] = 'application/json';
      return h;
    } catch (e) {
      return { 'Content-Type': 'application/json' };
    }
  }

  function isMixedContent(url) {
    try {
      const target = new URL(url, window.location.href);
      return window.location.protocol === 'https:' && target.protocol === 'http:';
    } catch(e) {
      return false;
    }
  }

  function buildNetworkErrorMessage(error, url) {
    const message = error && error.message ? error.message : String(error || '');
    if (error && error.name === 'AbortError') {
      return 'API 请求已取消';
    }
    if (isMixedContent(url)) {
      return 'API 请求被浏览器拦截：当前页面是 HTTPS，但 API URL 是 HTTP。请改用 HTTPS 地址，或使用同源/后端代理。';
    }
    if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
      return [
        'API 请求没有成功发出或没有拿到响应。',
        '常见原因：API 服务未启动、地址/端口填错、浏览器 CORS 拦截、证书异常、本地代理拦截，或目标接口不允许网页直接调用。',
        '当前请求地址：' + url,
        '建议：优先把 API URL 换成允许浏览器跨域的 OpenAI 兼容代理；如果使用官方或中转接口，通常需要后端代理转发。'
      ].join('\n');
    }
    return message || 'API 网络请求失败';
  }

  function timeoutError(timeoutMs) {
    return new Error('API 请求超时（' + Math.max(1, Math.ceil(timeoutMs / 1000)) + 's 无响应），已中止本次请求');
  }

  async function readResponseBody(resp) {
    const text = await resp.text();
    let data = null;
    let parseError = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { parseError = e; }
    }
    return { resp, data, text, parseError };
  }

  function responseDetail(result) {
    const data = result && result.data;
    const text = result && result.text;
    if (data && data.error && data.error.message) return data.error.message;
    if (data && data.message) return data.message;
    if (data) return JSON.stringify(data);
    return text ? String(text).slice(0, 500) : '';
  }

  // [FIX 移植自上游 2.3.15，v2.3.21 增强] 带超时的 fetch：把调用方传入的 signal（用户主动中止 /
  //   切聊天）与内部超时计时器合并到同一次请求。超时触发 => controller.abort()，但抛出的是普通
  //   Error（非 AbortError），这样 evolve 的 catch 会按「推演失败」处理并复位 _isRunning。
  //   [v2.3.21] 超时覆盖完整请求生命周期：fetch resolve 只代表响应头到达，正文读取仍可能卡住
  //   （服务端半开响应），故正文读取（readResponseBody）也在超时窗口内完成。
  //   apiTimeoutMs <= 0 时不设超时（保留旧行为）。
  async function fetchResponseWithTimeout(url, options) {
    const { signal: externalSignal, ...rest } = options || {};
    let timeoutMs = 120000;
    try {
      const t = Number(getSettings().apiTimeoutMs);
      if (Number.isFinite(t)) timeoutMs = t;
    } catch (e) {}

    if (!(timeoutMs > 0)) {
      const resp = await fetch(url, { ...rest, signal: externalSignal || null });
      return readResponseBody(resp);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      const resp = await fetch(url, { ...rest, signal: controller.signal });
      return await readResponseBody(resp);
    } catch (e) {
      if (timedOut) throw timeoutError(timeoutMs);
      throw e;   // 外部中止 => 原样抛 AbortError
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  async function fetchJson(url, options) {
    let result;
    try {
      result = await fetchResponseWithTimeout(url, options);
    } catch(e) {
      throw new Error(buildNetworkErrorMessage(e, url));
    }

    const resp = result.resp;
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${responseDetail(result) || resp.statusText || '请求失败'}`);
    }

    if (result.parseError) {
      throw new Error('API 返回不是有效 JSON: ' + (result.parseError.message || result.parseError));
    }
    return result.data || {};
  }

  // [移植 v2.3.22] API 请求参数结构化日志：核对实际请求参数用。
  //   不输出 API Key，也不展开完整 prompt 正文（只给字符数）。
  function timeoutSeconds(timeoutMs) {
    timeoutMs = Number(timeoutMs) || 0;
    return timeoutMs > 0 ? Math.max(1, Math.ceil(timeoutMs / 1000)) : 0;
  }

  function messageChars(messages) {
    return (messages || []).reduce((total, msg) => total + String(msg && msg.content || '').length, 0);
  }

  function logRequestParams(label, target, settings, body) {
    console.log('[世界引擎] API 请求参数:', {
      useStProxy: settings.useStProxy !== false,
      transport: label,
      target,
      model: body.model,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      timeout_sec: timeoutSeconds(settings.apiTimeoutMs),
      message_count: Array.isArray(body.messages) ? body.messages.length : 0,
      prompt_chars: messageChars(body.messages),
      stream: false
    });
  }

  /**
   * 调用独立 API（非酒馆自带），OpenAI 兼容格式
   */
  async function callApi(prompt, maxTokens, temperature, signal) {
    try {
      const _core = window.WORLD_ENGINE_CORE;
      if (_core && typeof _core.substituteMacros === 'function') prompt = _core.substituteMacros(prompt);
    } catch (e) {}
    const settings = getSettings();
    const url = normalizeUrl(settings.apiUrl);
    if (!url) throw new Error('未配置 API URL，请在设置中填写');

    // [移植 v2.3.21] 未显式传参时读取用户设置（温度/最大输出 token），并做合法化夹紧
    const selectedTemperature = temperature ?? settings.temperature;
    const selectedMaxTokens = maxTokens ?? settings.maxTokens;
    const model = settings.model || 'gpt-3.5-turbo';
    const messages = [{ role: 'user', content: prompt }];
    const temp = Number.isFinite(Number(selectedTemperature)) ? Math.max(0, Number(selectedTemperature)) : 0.7;
    const maxTok = Math.max(1, parseInt(selectedMaxTokens) || 8000);

    let data;
    if (canUseStProxy()) {
      // 经由 SillyTavern 后端转发（服务器对服务器，无浏览器 CORS）
      const base = getApiBase(settings);
      logRequestParams('st-proxy', base, settings, { model, temperature: temp, max_tokens: maxTok, messages });
      data = await fetchJson('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getContextHeaders(),
        body: JSON.stringify({
          chat_completion_source: 'openai',
          reverse_proxy: base,
          proxy_password: settings.apiKey || '',
          model: model,
          messages: messages,
          temperature: temp,
          max_tokens: maxTok,
          stream: false
        }),
        signal: signal || null
      });
      if (data && data.error) {
        throw new Error('SillyTavern 后端转发失败：' + (data.message || '无法连接到目标 API，请检查 API URL、密钥或中转是否可用'));
      }
    } else {
      // 回退：浏览器直连（非酒馆环境/独立运行，会受 CORS 限制）
      const headers = { 'Content-Type': 'application/json' };
      if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;
      logRequestParams('direct', url, settings, { model, temperature: temp, max_tokens: maxTok, messages });
      data = await fetchJson(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ model: model, messages: messages, temperature: temp, max_tokens: maxTok }),
        signal: signal || null
      });
    }

    const choice = data.choices?.[0];
    if (!choice) throw new Error('API 返回缺少 choices[0]');
    if (choice.finish_reason === 'length') {
      console.warn('[世界引擎] API 输出达到长度上限，将读取截断前已完整返回的字段');
    }
    return choice.message?.content || '';
  }

  function repairTruncatedJSON(content) {
    const rootStart = content.indexOf('{');
    if (rootStart === -1) return null;

    const stack = [];
    const candidates = [];
    let inString = false;
    let escaped = false;

    for (let i = rootStart; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        stack.pop();
      } else if (char === ',' && stack.length > 0) {
        candidates.push({
          end: i,
          suffix: stack.slice().reverse().map(open => open === '{' ? '}' : ']').join('')
        });
      }
    }

    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = content.slice(rootStart, candidates[i].end) + candidates[i].suffix;
      try {
        return JSON.parse(candidate);
      } catch(e) {}
    }
    return null;
  }

  /**
   * 解析 API 返回的 JSON（容错处理）
   */
  function parseJSON(text) {
    let content = String(text || '').trim();
    content = content.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      return JSON.parse(content);
    } catch(e) {}

    // 从夹杂说明、思考文本或多个代码块的返回中提取顶层 JSON；
    // 模型的最终答案通常位于最后，因此采用最后一个有效对象。
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    let result = null;
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (char === '}' && depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            result = JSON.parse(content.slice(start, i + 1));
          } catch(e2) {}
          start = -1;
        }
      }
    }
    return result || repairTruncatedJSON(content);
  }

  /**
   * 获取模型列表（OpenAI 兼容格式）
   */
  async function fetchModelList() {
    const settings = getSettings();
    const base = getApiBase(settings);
    if (!base) throw new Error('未配置 API URL，请在设置中填写');

    if (canUseStProxy()) {
      // 经由 SillyTavern 后端拉取模型列表（无浏览器 CORS）
      const data = await fetchJson('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: getContextHeaders(),
        body: JSON.stringify({
          chat_completion_source: 'openai',
          reverse_proxy: base,
          proxy_password: settings.apiKey || ''
        })
      });
      if (data && data.error) {
        throw new Error('SillyTavern 后端无法获取模型列表，请检查 API URL、密钥或中转是否可用');
      }
      if (data && Array.isArray(data.data)) {
        return data.data.map(m => (typeof m === 'string' ? m : m && m.id)).filter(Boolean);
      }
      throw new Error('无法解析模型列表');
    }

    // 回退：浏览器直连（会受 CORS 限制）
    const url = base + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;

    const data = await fetchJson(url, { headers });
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => m.id);
    }
    throw new Error('无法解析模型列表');
  }

  return { callApi, parseJSON, getSettings, fetchModelList };
})();
