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

### 3. world-engine.js：注入判据换酒馆原生 type + 删 _pendingReroll

> ⚠️ **v2.3.18 的数值判据 `state.chatLayer===chatLayer` 经真机探针证伪，v2.3.19 改用酒馆原生 type。**

**v2.3.18（已废弃的中间方案）**：判据 `Number.isFinite(state.chatLayer) && state.chatLayer === chatLayer`。
理论上「新轮次首次生成时 evolve 未跑、state.chatLayer 仍是上一轮 → chatLayer > state.chatLayer 不命中」。

**真机探针证伪（2026-06-29，叠加「蚀心入魔·数据库」插件）**：酒馆 `GENERATION_STARTED` 在用户楼 push 进 chat **之前** emit（探针实测：GEN_STARTED 时 chatLen=23，下一事件 MSG_SENT 才 chatLen=24）。所以**新一轮发消息**时 chatLayer 仍 == 上一轮 state.chatLayer → 数值判据误判成重 roll → 注入了上一轮存档点。用户「没重 roll 却注入旧状态」即此。

**v2.3.19（最终方案）**：重 roll 判据改用**酒馆原生 type**（不靠楼层数值推断）：

```js
// onGenerationStarted(type, _opts, dryRun)
if (dryRun) return;                                  // 预热/算token轮跳过，杜绝「生成完又注入」
const isReroll = (type === 'swipe' || type === 'regenerate');
applyInjectionForCurrentRound({ isReroll });
// onMessageSwiped → applyInjectionForCurrentRound({ isReroll: true })
```

`applyInjectionForCurrentRound(opts)`：`opts.isReroll` → 注入存档点（无 cp 则不注入）；否则走原 `chatLayer < stateLayer`（往前删旧层注存档点）/ `>=`（注当前状态）兜底。

**为何 type 可靠**：`swipe`（消息下箭头，script.js:9986）/ `regenerate`（底部重新生成，script.js:11304）是酒馆对「重写同一楼正文」的原生标记，与楼层/事件时序无关，对任何插件通用。`normal`/`continue`/`impersonate`/`quiet` 都不是重 roll。

### 边界场景表（v2.3.19 type 判据）

| # | 场景 | type | dryRun | isReroll | 注入 | 正确? |
|---|---|---|---|---|---|---|
| 1 | 新轮发消息（chatLayer 暂==state.chatLayer） | normal | false | false | 当前状态 | ✓（治 v2.3.18 回归）|
| 2 | swipe 箭头重 roll | swipe | false | true | 存档点 | ✓ |
| 3 | 底部重新生成（用户实测路径） | regenerate | false | true | 存档点 | ✓ |
| 4 | 数据库插件预热/算 token | * | true | — | 不动注入 | ✓（不再重复注入）|
| 5 | 续写 | continue | false | false | 当前状态 | ✓ |
| 6 | 往前删到旧层（chatLayer<state.chatLayer） | normal | false | false | 走`<`分支注存档点 | ✓ |
| 7 | 真重 roll 无 cp | swipe/regenerate | false | true | unregister | ✓ |

## 不改的部分

- inject/core/store 存储逻辑零改动（花瓶铁律）
- 手动 forward/redo 语义不变
- checkpoint 存储时机不变
- 首层无 cp 场景不变
- 时间模式不受影响
