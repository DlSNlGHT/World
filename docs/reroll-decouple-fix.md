# 重 roll 注入/推演解耦（v2.3.18）

本文档记录 2026-06-29 用户实测坐实、并修复的两个连锁 bug 的根因与修法。

## 现象（用户实测）

火影沙盒（syncToChat / auto / everyX=1），第5轮→开新第6楼→自动推演第6轮→swipe重roll第6楼：

1. **症状A**：注入日志 `对话层数 18 >= 18 注入当前状态 (round 6)` —— 注入了第6轮当前状态，而非第5轮存档点。
2. **症状B**：推演日志 `✅ 推演完成（重roll/redo），轮次不变：第 5 轮` —— 轮次停在5而非6。

## 根因

| 症状 | 根因 | 代码位置 |
|---|---|---|
| **B** | evolve 入口 `isNew=false` 时无差别 `Object.assign(state,cp)` 把 state 恢复成存档点(第5轮)→推演→round=5。`重roll(同楼再推=当前轮不变)` 与 `redo(手动回存档点)` 被混为同一路径。 | evolution.js:749-774 |
| **A** | `_pendingReroll` 闸门依赖酒馆 swipe 事件时序，易被 GENERATION_ENDED 提前清零 / 双生成插件撞窗口 → 重roll注入时闸门已开 → 走兜底 `>=` 分支注入当前状态。 | world-engine.js:207-222 |

## 修法（两文件，三处）

### 1. evolution.js：evolve 基底选择三分（line 744-774）

```diff
- if (isNew) { forward }
- else { 
-   // isNew=false → 无差别从存档点恢复（重roll/redo 混同）
-   Object.assign(state, cp)
- }

+ const isForward = isNew          // mode='forward' 或 自动新轮次
+ if (isForward) { 新轮次 }
+ else if (mode === 'redo') {
+   // redo: 从存档点恢复（保留原 Object.assign 恢复 + 无cp守卫）
+ } else {
+   // 自动重roll: 不从存档点恢复，直接在当前 state 上推
+ }
```

### 2. evolution.js：轮次块三分（line 968-978）

`if(isForward)` 内 `round++ / saveCheckpoint(backup) / saveFingerprint` 不变；else 分支日志区分 redo/自动重roll，轮次不变。

### 3. world-engine.js：注入判据换纯数值 + 删 _pendingReroll

判据从 `_pendingReroll && fpLayer===chatLayer` → `Number.isFinite(state.chatLayer) && state.chatLayer === chatLayer`。

**为何 `state.chatLayer===chatLayer` 能可靠区分同层重roll与新轮次首次生成：**

`state.chatLayer` 只在 evolve 完成时由 `saveStateWithLayer`（core.js:218）写。新轮次首次生成时 evolve 尚未跑（1.5s 延迟）→ state.chatLayer 仍是上一轮的值 → `chatLayer > state.chatLayer` → 不命中重roll分支 → 走 `>=` 注入当前状态 ✓。重roll 时 evolve 已完成 → state.chatLayer == chatLayer → 命中 → 注入存档点 ✓。

### 边界场景表

| # | 场景 | chatLayer | state.chatLayer | 命中? | 注入 | 正确? |
|---|---|---|---|---|---|---|
| 1 | 首次推演前(fp空) | 任意 | undefined | No (isFinite=false) | 当前状态(默认) | ✓ |
| 2 | 新轮次首次生成 | 20 | 18(上一轮) | No (>不等) | 当前状态(第6轮) | ✓ |
| 3 | 同层重roll | 18 | 18(第6轮) | **Yes** | 存档点(第5轮) | ✓ |
| 4 | 同层重roll无cp | 18 | 18 | Yes | unregister | ✓ |
| 5 | 往前删到旧层有cp | 15 | 18 | No (<不等)→走`<`分支 | 存档点 | ✓ |
| 6 | 双生成插件扰动 | 22 | 18 | No (>不等) | 当前状态 | ✓ |

## 不改的部分

- inject/core/store 存储逻辑零改动（花瓶铁律）
- 手动 forward/redo 语义不变
- checkpoint 存储时机不变
- 首层无 cp 场景不变
- 时间模式不受影响
