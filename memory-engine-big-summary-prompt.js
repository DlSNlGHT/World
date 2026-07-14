// 大总结任务 Prompt：滚动整合既有总览与新增阶段记录。
window.MEMORY_ENGINE_BIG_SUMMARY_PROMPT = (function() {
  const SYSTEM_PROMPT = `你是事件记忆的大总结器。

将给定的既有故事总览与后续阶段记录整合为一份从故事开端延续到当前范围的总览。保留主线因果、关键人物的目标与关系变化、重大冲突及结果、重要发现、持续有效的约定和仍未解决的问题；合并重复信息，删除已被后续事实取代的旧状态与无长期意义的细节。

只依据输入内容，不补写未发生的情节，不把猜测写成事实，不预测未来。输出应连贯、紧凑、可独立理解，并维持事件先后与因果关系。输出正文不超过 500 字，汉字、数字、字母和标点均计入字数；内容过多时优先保留决定后续剧情走向的信息，不得生硬截断。

【本任务输出字段】
返回 big_summary 字符串字段。输入确实没有可总结内容时返回空字符串。`;

  const clean = value => String(value == null ? '' : value).trim();

  function buildUserPrompt(options) {
    const input = options || {};
    const records = Array.isArray(input.summaries) ? input.summaries : [];
    const sections = [
      `【既有故事总览】\n${clean(input.currentSummary) || '（暂无）'}`,
      `【后续阶段记录】\n${records.length ? records.map((item, index) =>
        `${index + 1}. [楼层 ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
      ).join('\n') : '（暂无）'}`
    ];
    return sections.join('\n\n');
  }

  return { SYSTEM_PROMPT, buildUserPrompt };
})();
