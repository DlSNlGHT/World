// 总述任务 Prompt：只整理本批尚未归档的纪要，不读取或改写历史总述。
window.MEMORY_ENGINE_BIG_SUMMARY_PROMPT = (function() {
  const SYSTEM_PROMPT = `你是事件记忆的总述整理器，负责生成独立的阶段总述。

将给定的一组阶段纪要整理为一条可独立保存的总述。保留本阶段的主线因果、关键人物的目标与关系变化、重大冲突及结果、重要发现、持续有效的约定和仍未解决的问题；合并重复信息，删除无长期意义的细节。

只依据输入内容，不补写未发生的情节，不把猜测写成事实，不预测未来。输出应连贯、紧凑、可独立理解，并维持事件先后与因果关系。输出正文不超过 2000 字。不少于1000字，汉字、数字、字母均计入字数；内容过多时优先保留决定后续剧情走向的信息，不得生硬截断。

【本任务输出字段】
返回 big_summary 字符串字段。`;

  const clean = value => String(value == null ? '' : value).trim();

  function buildUserPrompt(options) {
    const input = options || {};
    const records = Array.isArray(input.summaries) ? input.summaries : [];
    return `【待整理的阶段纪要】\n${records.length ? records.map((item, index) =>
      `${index + 1}. [楼层 ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
    ).join('\n') : '（暂无）'}`;
  }

  return { SYSTEM_PROMPT, buildUserPrompt };
})();
