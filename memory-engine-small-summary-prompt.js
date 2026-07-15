// 纪要任务 Prompt：只负责把一段连续对话压缩为阶段性事件记录。
window.MEMORY_ENGINE_SMALL_SUMMARY_PROMPT = (function() {
  const SYSTEM_PROMPT = `你是事件记忆的纪要整理器。

阅读给定的连续对话，概括这一阶段实际发生、被确认或发生明确变化的重要事件。保留关键参与者、行动、结果、承诺、冲突、发现、关系转折与尚未解决的问题；忽略寒暄、重复表达、写作指令和没有后续意义的细枝末节。

只依据给定对话，不补写未发生的情节，不把猜测写成事实，不预测未来。历史参考只用于理解人物、指代和事件承接，small_summary 只记录待总结对话中新发生或明确变化的内容，不得重复抄写历史。叙述应按发生顺序组织，使用紧凑、连贯、可独立理解的中文。输出正文不超过 200 字，不少于50字，汉字、数字、字母均计入字数；内容过多时优先保留会影响后续剧情的信息，不得生硬截断。

【本任务输出字段】
返回 small_summary 字符串字段。`;

  const clean = value => String(value == null ? '' : value).trim();

  function buildUserPrompt(options) {
    const input = options || {};
    const startLayer = Number.isFinite(Number(input.startLayer)) ? Number(input.startLayer) : 0;
    const endLayer = Number.isFinite(Number(input.endLayer)) ? Number(input.endLayer) : startLayer;
    const big = Array.isArray(input.historyBigSummaries) ? input.historyBigSummaries : [];
    const small = Array.isArray(input.historySmallSummaries) ? input.historySmallSummaries : [];
    const history = [
      big.length ? `【最近一条总述】\n${big.map((item, index) =>
        `${index + 1}. [楼层 ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
      ).join('\n')}` : '',
      small.length ? `【最近四条纪要】\n${small.map((item, index) =>
        `${index + 1}. [楼层 ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
      ).join('\n')}` : ''
    ].filter(Boolean).join('\n\n');
    return `${history ? `【只读历史参考】\n${history}\n\n` : ''}【总结范围】\n楼层 ${startLayer} 至 ${endLayer}\n\n【待总结对话】\n${clean(input.conversation) || '（空）'}`;
  }

  return { SYSTEM_PROMPT, buildUserPrompt };
})();
