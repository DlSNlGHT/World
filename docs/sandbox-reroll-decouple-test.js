// sandbox 离线断言：重 roll 注入 + 推演基底/轮次三分（解耦 redo/重 roll）
// 等价重放 world-engine.js applyInjectionForCurrentRound 的同层重 roll 判据分支，
// 与 world-engine-evolution.js evolve() 的基底选择三分 + 轮次块三分。
// 判据从源码精确复制，喂 mock state/chatLayer，断言走哪条分支 / 注入哪份 / round 涨否。

const assert = require('assert');

// ───────────────── 注入判定（applyInjectionForCurrentRound 同层重 roll 分支 + 兜底） ─────────────────
// 复刻自 world-engine.js:201-244
function decideInjection(state, chatLayer, checkpoint) {
  // 返回: { branch: 'reroll-cp'|'reroll-none'|'less-cp'|'less-fallback'|'ge-current', inject: 'checkpoint'|'none'|'state' }
  const stateSL = Number(state.chatLayer);
  if (Number.isFinite(stateSL) && stateSL === chatLayer) {
    if (checkpoint) return { branch: 'reroll-cp', inject: 'checkpoint', cpRound: checkpoint.round };
    return { branch: 'reroll-none', inject: 'none' };
  }
  const stateLayer = Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : chatLayer;
  if (chatLayer < stateLayer) {
    if (checkpoint) return { branch: 'less-cp', inject: 'checkpoint', cpRound: checkpoint.round };
    return { branch: 'less-fallback', inject: 'state' };
  }
  return { branch: 'ge-current', inject: 'state' };
}

// ───────────────── 推演基底三分 + 轮次块三分 ─────────────────
// 复刻自 world-engine-evolution.js:745-774（基底）+ 973-982（轮次块）
function evolveSim({ mode, state, cp, hadStoredState, chatLayerNow, backup }) {
  // mode: 'forward' | 'redo' | undefined
  const isNew = mode === 'forward' ? true : mode === 'redo' ? false : isNewRoundSim(state, chatLayerNow);
  const isForward = isNew;

  // 基底选择三分
  let baseSource;          // 'state' | 'checkpoint' | 'state(autoroll)'
  let restored = false;    // 是否 Object.assign(cp)
  let rejectedRedo = false;
  if (isForward) {
    baseSource = 'state';
  } else if (mode === 'redo') {
    if (cp) { Object.assign(state, cp); restored = true; baseSource = 'checkpoint'; }
    else { rejectedRedo = true; return { rejectedRedo: true, roundAfter: state.round }; }
  } else {
    // 自动重 roll：不回存档点，直接当前 state 推
    baseSource = 'state(autoroll)';
  }

  // 轮次块三分
  const roundBefore = state.round;
  let savedCheckpoint = false;
  let savedFingerprint = false;
  let label;
  if (isForward) {
    state.round++;
    if (hadStoredState) { savedCheckpoint = true; /* saveCheckpoint(backup) */ }
    savedFingerprint = true;
    label = 'forward';
  } else {
    label = (mode === 'redo') ? 'redo' : 'autoroll';
  }
  // saveStateWithLayer：写 state.chatLayer = chatLayerNow
  state.chatLayer = chatLayerNow;

  return {
    baseSource, restored, label,
    roundBefore, roundAfter: state.round,
    roundChanged: state.round !== roundBefore,
    savedCheckpoint, savedFingerprint,
    stateChatLayerAfter: state.chatLayer,
  };
}

// core.isNewRound 等价：loadFingerprint() !== getChatFingerprint()
function isNewRoundSim(state, chatLayerNow) {
  const fp = state._fingerprint;
  const newFp = String(chatLayerNow);
  if (fp === '' || fp == null) return true;
  return fp !== newFp;
}

// ═════════════════════ T1-T8 注入判定 ═════════════════════
// 设：第6轮 forward 已完成。state.round=6, state.chatLayer=18, cp=第5轮(cp.round=5)

function makeState6() {
  return { round: 6, chatLayer: 18, _fingerprint: String(18) };
}
function cp5() { return { round: 5, chatLayer: 16 }; } // 第5轮存档点

// T1: 同层重 roll 有 cp → 注入存档点
{
  const r = decideInjection(makeState6(), 18, cp5());
  assert.strictEqual(r.branch, 'reroll-cp', 'T1 branch');
  assert.strictEqual(r.inject, 'checkpoint', 'T1 inject');
  assert.strictEqual(r.cpRound, 5, 'T1 cpRound=5(第5轮存档点)');
  console.log('✓ T1 同层重 roll 有 cp → 注入第5轮存档点');
}
// T2: 同层重 roll 无 cp → 不注入
{
  const r = decideInjection(makeState6(), 18, null);
  assert.strictEqual(r.branch, 'reroll-none', 'T2 branch');
  assert.strictEqual(r.inject, 'none', 'T2 inject');
  console.log('✓ T2 同层重 roll 无 cp → 不注入(unregister)');
}
// T3: 新轮次首次生成（chatLayer=19 > state.chatLayer=18）→ 注入当前状态
{
  const r = decideInjection(makeState6(), 19, cp5());
  assert.strictEqual(r.branch, 'ge-current', 'T3 branch');
  assert.strictEqual(r.inject, 'state', 'T3 inject');
  console.log('✓ T3 新轮次首次生成(楼层前进) → 注入当前状态(第6轮)');
}
// T4: 首推演前（state.chatLayer undefined）→ 注入当前状态
{
  const empty = { round: 0, chatLayer: undefined, _fingerprint: '' };
  const r = decideInjection(empty, 4, null);
  assert.strictEqual(r.branch, 'ge-current', 'T4 branch');
  assert.strictEqual(r.inject, 'state', 'T4 inject');
  console.log('✓ T4 首推演前(空state) → 注入当前状态(默认)');
}
// T5: 往前删旧层有 cp（chatLayer=15 < state.chatLayer=18）→ 注入存档点
{
  const r = decideInjection(makeState6(), 15, cp5());
  assert.strictEqual(r.branch, 'less-cp', 'T5 branch');
  assert.strictEqual(r.inject, 'checkpoint', 'T5 inject');
  console.log('✓ T5 往前删旧层有 cp → 注入存档点(不变)');
}
// T6: 往前删旧层无 cp → 回退当前状态
{
  const r = decideInjection(makeState6(), 15, null);
  assert.strictEqual(r.branch, 'less-fallback', 'T6 branch');
  assert.strictEqual(r.inject, 'state', 'T6 inject');
  console.log('✓ T6 往前删旧层无 cp → 回退当前状态');
}
// T7: 双生成插件扰动楼层（chatLayer=22 > state.chatLayer=18）→ 注入当前状态
{
  const r = decideInjection(makeState6(), 22, cp5());
  assert.strictEqual(r.branch, 'ge-current', 'T7 branch');
  assert.strictEqual(r.inject, 'state', 'T7 inject');
  console.log('✓ T7 双生成插件扰动楼层(22>18) → 注入当前状态(稳)');
}
// T8: 旧版 fingerprint 残留为 chat.length（=chatLayer+1=19）时同层重 roll：
//     state.chatLayer=18, chatLayer=18 → 仍命中同层分支（判据不依赖 fingerprint）
{
  const s = makeState6(); s._fingerprint = String(19); // 旧语义残留
  const r = decideInjection(s, 18, cp5());
  assert.strictEqual(r.branch, 'reroll-cp', 'T8 branch');
  console.log('✓ T8 旧版指纹残留(19)时同层重 roll → 仍命中(state.chatLayer 判据不受指纹影响)');
}

// ═════════════════════ E1-E6 推演基底/轮次三分 ═════════════════════

// E1: 手动 forward → round++ + 存档点前移 + 刷新指纹
{
  const s = { round: 5, chatLayer: 16, _fingerprint: String(16) };
  const r = evolveSim({ mode: 'forward', state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 18, backup: { round: 5, chatLayer: 16 } });
  assert.strictEqual(r.label, 'forward', 'E1 label');
  assert.strictEqual(r.roundAfter, 6, 'E1 round 6');
  assert.strictEqual(r.roundChanged, true, 'E1 round changed');
  assert.strictEqual(r.savedCheckpoint, true, 'E1 savedCheckpoint(forward前移)');
  assert.strictEqual(r.savedFingerprint, true, 'E1 savedFingerprint');
  assert.strictEqual(r.stateChatLayerAfter, 18, 'E1 state.chatLayer=18');
  console.log('✓ E1 手动 forward → round 5→6 + 存档点前移 + 指纹刷新');
}
// E2: 手动 redo（有 cp）→ Object.assign(cp)恢复 + round 不变(=存档点轮次) + 不存档点/不刷新指纹
{
  // redo 场景：当前 state 是第6轮（forward后），redo 应回存档点(第5轮)重推，轮次=5
  const s = { round: 6, chatLayer: 18, _fingerprint: String(18) };
  const cp = { round: 5, chatLayer: 16, memories: [], events: [], factions: [], worldTrends: [], winds: [], enemies: [], influenceChain: [] };
  const r = evolveSim({ mode: 'redo', state: s, cp, hadStoredState: true, chatLayerNow: 18, backup: { round: 6, chatLayer: 18 } });
  assert.strictEqual(r.label, 'redo', 'E2 label');
  assert.strictEqual(r.restored, true, 'E2 Object.assign(cp)恢复');
  assert.strictEqual(s.round, 5, 'E2 state 被恢复成存档点 round=5');
  assert.strictEqual(r.roundAfter, 5, 'E2 round 不变=5(存档点轮次)');
  assert.strictEqual(r.roundChanged, false, 'E2 round 不涨');
  assert.strictEqual(r.savedCheckpoint, false, 'E2 不存 checkpoint');
  assert.strictEqual(r.savedFingerprint, false, 'E2 不刷新指纹');
  console.log('✓ E2 手动 redo → 回存档点(第5轮)重推 + 轮次=5 + 不动存档点/指纹');
}
// E3: 手动 redo 无 cp → return false + error
{
  const s = { round: 6, chatLayer: 18, _fingerprint: String(18) };
  const r = evolveSim({ mode: 'redo', state: s, cp: null, hadStoredState: true, chatLayerNow: 18, backup: s });
  assert.strictEqual(r.rejectedRedo, true, 'E3 rejectedRedo');
  console.log('✓ E3 手动 redo 无 cp → 拒绝(return false + error)');
}
// E4: 自动新轮次（mode=undefined, isNewRound=true）→ 等价 forward
{
  // 新楼层 19，fingerprint 还是 18（evolve 尚未为新轮跑）→ isNewRound=true
  const s = { round: 6, chatLayer: 18, _fingerprint: String(18) };
  const r = evolveSim({ mode: undefined, state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 19, backup: { round: 6, chatLayer: 18 } });
  assert.strictEqual(r.label, 'forward', 'E4 label');
  assert.strictEqual(r.roundAfter, 7, 'E4 round 7');
  assert.strictEqual(r.savedCheckpoint, true, 'E4 savedCheckpoint');
  console.log('✓ E4 自动新轮次(楼层前进) → round 6→7 + 存档点前移');
}
// E5: 自动重 roll（mode=undefined, isNewRound=false）→ 不回存档点 + round 不变(=当前轮=6) + 不存档点/不刷新指纹
{
  // 重 roll 同楼：楼层 18 不变，fingerprint=18 → isNewRound=false → 自动重 roll 分支
  const s = { round: 6, chatLayer: 18, _fingerprint: String(18) };
  const r = evolveSim({ mode: undefined, state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 18, backup: { round: 6, chatLayer: 18 } });
  assert.strictEqual(r.label, 'autoroll', 'E5 label');
  assert.strictEqual(r.baseSource, 'state(autoroll)', 'E5 不回存档点');
  assert.strictEqual(r.restored, false, 'E5 不 Object.assign(cp)');
  assert.strictEqual(r.roundAfter, 6, 'E5 round 不变=6(当前轮)★症状B核心★');
  assert.strictEqual(r.roundChanged, false, 'E5 round 不涨');
  assert.strictEqual(r.savedCheckpoint, false, 'E5 不存 checkpoint → 存档点保持第5轮(供注入)');
  assert.strictEqual(r.savedFingerprint, false, 'E5 不刷新指纹');
  assert.strictEqual(s.round, 6, 'E5 state.round 保持 6 (未被存档点覆盖)');
  console.log('✓ E5 ★自动重 roll → 不回存档点 + round 保持当前轮=6 + 存档点保持第5轮(供注入)★');
}
// E6: 自动重 roll 无 cp（首层场景）→ 不报错，当前 state 推
{
  const s = { round: 1, chatLayer: 2, _fingerprint: String(2) };
  const r = evolveSim({ mode: undefined, state: s, cp: null, hadStoredState: false, chatLayerNow: 2, backup: s });
  assert.strictEqual(r.label, 'autoroll', 'E6 label');
  assert.strictEqual(r.restored, false, 'E6 无 cp 不恢复');
  assert.strictEqual(r.rejectedRedo, undefined, 'E6 不报错(非redo守卫)');
  assert.strictEqual(r.roundAfter, 1, 'E6 round 不变=1');
  assert.strictEqual(r.savedCheckpoint, false, 'E6 hadStoredState=false 不存 checkpoint(首次)');
  console.log('✓ E6 自动重 roll 无 cp(首层) → 当前 state 推 + 不报错');
}

console.log('\n全部 14 断言通过 ✅');
