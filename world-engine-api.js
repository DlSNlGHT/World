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
      // [FIX] 连接方式：'direct'=浏览器直连（默认，原有行为）；'proxy'=经酒馆服务端转发，绕过第三方 API 的 CORS 限制
      connectionMode: 'direct',
      injectIntoPrompt: true,
      injectIntoWorldbook: true, // 世界书注入：利用聊天世界书 constant 条目注入（与黑科技同策略）
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
      evolveFilterRegex: '',
      tonePrompt: '',
      // 按时间推演模式
      evolveTimeFront: 0,
      evolveTimeBack: 80,
      evolveTimeRe1: '', evolveTimeRe2: '', evolveTimeRe3: '',
      evolveTimeRe4: '', evolveTimeRe5: '', evolveTimeRe6: '',
      evolveTimeMul1: 360, evolveTimeMul2: 30, evolveTimeMul3: 1,
      evolveTimeThreshold: 1,
      evolveTimeMaxRounds: 10
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
    console.log('[世界引擎] 调用 API（经酒馆代理）:', base, payload.model);
    const resp = await fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: tavernHeaders(),
      body: JSON.stringify(payload),
      signal: signal || null
    });
    if (!resp.ok) {
      let detail = '';
      try { const err = await resp.json(); detail = err.error?.message || JSON.stringify(err); } catch(e) {}
      throw new Error(`HTTP ${resp.status}: ${detail}`);
    }
    const data = await resp.json();
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

    const body = {
      model: settings.model || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: temperature ?? settings.temperature ?? 0.7,
      max_tokens: maxTokens ?? settings.maxTokens ?? 2000
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

    console.log('[世界引擎] 调用 API:', url, body.model);

    const resp = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: signal || null
    });

    if (!resp.ok) {
      let detail = '';
      try { const err = await resp.json(); detail = err.error?.message || JSON.stringify(err); } catch(e) {}
      throw new Error(`HTTP ${resp.status}: ${detail}`);
    }

    const data = await resp.json();
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
      const resp = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: tavernHeaders(),
        body: JSON.stringify({
          chat_completion_source: 'openai',
          reverse_proxy: baseUrl,
          proxy_password: settings.apiKey || ''
        })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data && data.error) throw new Error('酒馆代理拉取模型失败（请检查 URL/密钥是否正确）');
      if (data.data && Array.isArray(data.data)) {
        return data.data.map(m => m.id);
      }
      throw new Error('无法解析模型列表');
    }

    const url = baseUrl + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => m.id);
    }
    throw new Error('无法解析模型列表');
  }

  return { callApi, parseJSON, getSettings, fetchModelList };
})();
