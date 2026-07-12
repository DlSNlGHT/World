// world-engine-api.js — 独立 API 调用（支持自定义 OpenAI 兼容 API）
window.WORLD_ENGINE_API = (function() {
  let cachedSettings = null;

  function getSettings(forceRefresh) {
    if (forceRefresh) cachedSettings = null;
    if (cachedSettings) return cachedSettings;
    const defaults = {
      apiUrl: '',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2000,
      apiAutoRetries: 0,
      // [FIX] 连接方式：'direct'=浏览器直连（默认，原有行为）；'proxy'=经酒馆服务端转发，绕过第三方 API 的 CORS 限制
      connectionMode: 'direct',
      injectIntoPrompt: true,
      injectMaxChars: 5000,
      // 正文注入等级筛选：false=仅注入高等级信息（兼容旧行为），true=事件链与风声不按等级过滤
      injectAllLevels: false,
      evolveMode: 'auto',
      // 酒馆缓存：把按聊天隔离的存档镜像进 chat_metadata，实现跨设备同步与防丢失存档（默认关闭）
      syncToChat: false,   // 实时同步：工作区状态持续镜像进聊天，换设备打开同一聊天即可续上
      autoBackup: false,   // 滚动自动备份：每当轮次推进，自动存一条到聊天（保留最近几条）
      worldbookTrigger: false, // 世界书蓝绿灯触发：🔵常驻恒注入 / 🟢关键词命中才注入（默认关闭=全部已选注入）
      // 批量重填世界推演：从第 1 个 AI 楼层分批推到指定楼层（清空重来）
      backfillBatchSize: 5,    // 每批 AI 楼层数（每多少层调一次推演）
      backfillRetries: 2,      // 每批独立重试次数（推演失败时重试上限）
      backfillEndLayer: 0,     // 结束 AI 楼层（0 = 推到最后一个 AI 楼层）
      evolveEveryX: 1,
      evolveReadRounds: 1,
      manualReadRounds: 1,
      evolveFilterRegex: '',
      tonePrompt: '',
      // 按时间推演模式
      evolveTimeFront: 0,
      evolveTimeBack: 80,
      evolveTimeRe1: '', evolveTimeRe2: '', evolveTimeRe3: '',
      evolveTimeRe4: '', evolveTimeRe5: '', evolveTimeRe6: '',
      evolveTimeMul1: 360, evolveTimeMul2: 30, evolveTimeMul3: 1,
      evolveTimeThreshold: 1,
      evolveTimeMaxRounds: 10,
      // Local mechanism tuning. Defaults match the previous hard-coded behavior.
      localRegionalIncidentChancePercent: 3,
      localRegionalIncidentDuration: 5,
      localRegionalIncidentCooldown: 5,
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
      // [FIX] API 请求超时（毫秒）。0 = 不超时（旧行为）。默认 120s：
      //   推演请求若落入网络黑洞（代理无响应/上游不返回也不报错），fetch 会永久挂起，
      //   evolve 的 _isRunning 永不复位，此后所有自动推演被 isRunning() 守卫静默跳过，
      //   直到用户切一次聊天才解锁。超时让挂起请求按失败处理，finally 正常复位。
      apiTimeoutMs: 120000
    };
    const raw = window.WORLD_ENGINE_STORE.getItem('world_engine_settings');
    if (raw) {
      try { cachedSettings = { ...defaults, ...JSON.parse(raw) }; return cachedSettings; } catch(e) {}
    }
    cachedSettings = defaults;
    return cachedSettings;
  }

  // [FIX] 规整 chat/completions URL：只补 /chat/completions，不再替用户塞 /v1 等版本前缀。
  //   火山方舟等 OpenAI 兼容端点用自定义版本前缀（/api/v3、/api/coding/v3），旧逻辑会硬塞
  //   /v1 把 URL 拼成 .../v3/v1/chat/completions 而全部 404。版本前缀由用户在设置里填到完整，
  //   旁边有格式提示。三处调用点（getProxyBase / callApi / fetchModelList）语义一致受益。
  function normalizeUrl(url) {
    let u = url.trim().replace(/\/+$/, '');
    if (!u) return '';
    if (u.endsWith('/chat/completions')) return u;
    return u + '/chat/completions';
  }

  // [FIX] 经酒馆代理用：从完整的 chat/completions URL 还原出 base（形如 https://host/v1），
  // 交给酒馆后端，由它自己拼 /chat/completions 与 /models。
  function getProxyBase(settings) {
    return normalizeUrl(settings.apiUrl).replace(/\/chat\/completions$/, '');
  }

  // [FIX] 调酒馆自身后端端点需要携带其 CSRF/鉴权头；仅在酒馆环境中可用。
  function tavernHeaders() {
    try {
      const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      if (ctx && typeof ctx.getRequestHeaders === 'function') {
        const h = ctx.getRequestHeaders();
        if (h && !h['Content-Type'] && !h['content-type']) h['Content-Type'] = 'application/json';
        return h;
      }
    } catch (e) {}
    throw new Error('经酒馆代理需要在酒馆环境中运行（未取到酒馆请求头）');
  }

  function timeoutError(timeoutMs) {
    return new Error('API 请求超时（' + Math.max(1, Math.ceil(timeoutMs / 1000)) + 's 无响应），已中止本次请求');
  }

  function timeoutSeconds(timeoutMs) {
    timeoutMs = Number(timeoutMs) || 0;
    return timeoutMs > 0 ? Math.max(1, Math.ceil(timeoutMs / 1000)) : 0;
  }

  function messageChars(messages) {
    return (messages || []).reduce((total, msg) => total + String(msg && msg.content || '').length, 0);
  }

  function logRequestParams(label, target, settings, body) {
    console.log('[世界引擎] API 请求参数:', {
      connectionMode: settings.connectionMode === 'proxy' ? 'proxy' : 'direct',
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
    if (data) return JSON.stringify(data);
    return text ? String(text).slice(0, 500) : '';
  }

  function requireJson(result, label) {
    if (result.parseError) {
      throw new Error((label || 'API') + ' 返回不是有效 JSON：' + result.parseError.message);
    }
    return result.data || {};
  }

  // 超时覆盖完整请求生命周期：fetch resolve 只代表响应头到达，正文读取仍可能卡住。
  async function fetchResponseWithTimeout(url, options, signal, timeoutMs) {
    timeoutMs = Number(timeoutMs) || 0;
    if (!(timeoutMs > 0)) {
      const resp = await fetch(url, { ...options, signal: signal || null });
      return readResponseBody(resp);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      return await readResponseBody(resp);
    } catch (e) {
      if (timedOut) throw timeoutError(timeoutMs);
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }

  // [FIX] 经酒馆服务端转发的推演调用：浏览器 → 同源酒馆后端（无 CORS）→ 服务端代发到第三方 API。
  // 走 OpenAI source + reverse_proxy 路线，这样可把我们自己的 URL/KEY 透传给上游。
  async function callApiViaProxy(settings, body, signal) {
    const base = getProxyBase(settings);
    if (!base) throw new Error('未配置 API URL，请在设置中填写');
    const payload = {
      chat_completion_source: 'openai',
      reverse_proxy: base,
      proxy_password: settings.apiKey || '',
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: false
    };
    logRequestParams('tavern-proxy', base, settings, payload);
    const result = await fetchResponseWithTimeout('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: tavernHeaders(),
      body: JSON.stringify(payload)
    }, signal, settings.apiTimeoutMs);
    const resp = result.resp;
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${responseDetail(result)}`);
    }
    const data = requireJson(result, '酒馆代理');
    if (data && data.error) {
      throw new Error('酒馆代理返回错误：' + (data.error.message || JSON.stringify(data.error)));
    }
    const choice = data.choices?.[0];
    if (!choice) throw new Error('API 返回缺少 choices[0]');
    if (choice.finish_reason === 'length') {
      console.warn('[世界引擎] API 输出达到长度上限，将读取截断前已完整返回的字段');
    }
    return choice.message?.content || '';
  }

  /**
   * 调用独立 API（非酒馆自带），OpenAI 兼容格式
   */
  async function callApi(prompt, maxTokens, temperature, signal) {
    const settings = getSettings();
    const selectedTemperature = temperature ?? settings.temperature;
    const selectedMaxTokens = maxTokens ?? settings.maxTokens;

    const body = {
      model: settings.model || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: Number.isFinite(Number(selectedTemperature)) ? Math.max(0, Number(selectedTemperature)) : 0.7,
      max_tokens: Math.max(1, parseInt(selectedMaxTokens) || 2000)
    };

    // [FIX] 经酒馆代理：绕过第三方 API 的 CORS 限制，由酒馆 Node 服务端转发
    if (settings.connectionMode === 'proxy') {
      return callApiViaProxy(settings, body, signal);
    }

    const url = normalizeUrl(settings.apiUrl);
    if (!url) throw new Error('未配置 API URL，请在设置中填写');

    const headers = {
      'Content-Type': 'application/json'
    };
    if (settings.apiKey) {
      headers['Authorization'] = 'Bearer ' + settings.apiKey;
    }

    logRequestParams('direct', url, settings, body);

    const result = await fetchResponseWithTimeout(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }, signal, settings.apiTimeoutMs);
    const resp = result.resp;

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${responseDetail(result)}`);
    }

    const data = requireJson(result, 'API');
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
    const baseUrl = normalizeUrl(settings.apiUrl).replace(/\/chat\/completions$/, '');

    // [FIX] 经酒馆代理：用酒馆 /status 端点拉模型列表，绕过 CORS
    if (settings.connectionMode === 'proxy') {
      if (!baseUrl) throw new Error('未配置 API URL，请在设置中填写');
      const result = await fetchResponseWithTimeout('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: tavernHeaders(),
        body: JSON.stringify({
          chat_completion_source: 'openai',
          reverse_proxy: baseUrl,
          proxy_password: settings.apiKey || ''
        })
      }, null, settings.apiTimeoutMs);
      if (!result.resp.ok) throw new Error(`HTTP ${result.resp.status}: ${responseDetail(result)}`);
      const data = requireJson(result, '酒馆代理');
      if (data && data.error) throw new Error('酒馆代理拉取模型失败（请检查 URL/密钥是否正确）');
      if (data.data && Array.isArray(data.data)) {
        return data.data.map(m => m.id);
      }
      throw new Error('无法解析模型列表');
    }

    const url = baseUrl + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;

    const result = await fetchResponseWithTimeout(url, { headers }, null, settings.apiTimeoutMs);
    if (!result.resp.ok) throw new Error(`HTTP ${result.resp.status}: ${responseDetail(result)}`);
    const data = requireJson(result, 'API');
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => m.id);
    }
    throw new Error('无法解析模型列表');
  }

  return { callApi, parseJSON, getSettings, fetchModelList };
})();
