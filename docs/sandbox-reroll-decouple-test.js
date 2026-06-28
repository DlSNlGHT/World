// sandbox 离线断言 v2.3.19：重 roll 注入判据改用酒馆原生 type（swipe/regenerate）+ dryRun 跳过。
// 等价重放 world-engine.js 的 onGenerationStarted(type,opts,dryRun) → applyInjectionForCurrentRound(opts)
// 与 evolution.js evolve() 基底/轮次三分（后者 v2.3.18 已验证，这里复跑回归保护）。

const assert = require('assert');

// ───────── onGenerationStarted：把酒馆 type/dryRun 翻译成 isReroll / 是否跳过 ─────────
// 复刻自 world-engine.js onGenerationStarted
function onGenStarted(type, dryRun) {
  if (dryRun) return { skipped: true };            // 预热轮不重判注入
  const isReroll = (type === 'swipe' || type === 'regenerate');
  return { skipped: false, isReroll };
}

// ───────── applyInjectionForCurrentRound(opts)：重 roll 靠 opts.isReroll，否则走 chatLayer 兜底 ─────────
// 复刻自 world-engine.js applyInjectionForCurrentRound
function decideInjection(state, chatLayer, checkpoint, opts) {
  const isReroll = !!(opts && opts.isReroll);
  if (isReroll) {
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

// 第6轮 forward 完成：state.round=6, state.chatLayer=20, cp=第5轮
function makeState6() { return { round: 6, chatLayer: 20 }; }
function cp5() { return { round: 5, chatLayer: 18 }; }

// ═══════ G1-G5：onGenerationStarted type 翻译 ═══════
{
  // G1 normal 新生成 → 非重 roll，不跳过
  const r = onGenStarted('normal', false);
  assert.deepStrictEqual(r, { skipped: false, isReroll: false }, 'G1');
  console.log('✓ G1 type=normal → 非重 roll');
}
{
  // G2 swipe（箭头）→ 重 roll
  const r = onGenStarted('swipe', false);
  assert.deepStrictEqual(r, { skipped: false, isReroll: true }, 'G2');
  console.log('✓ G2 type=swipe → 重 roll');
}
{
  // G3 regenerate（底部重新生成）→ 重 roll ★用户实际用的就是这个★
  const r = onGenStarted('regenerate', false);
  assert.deepStrictEqual(r, { skipped: false, isReroll: true }, 'G3');
  console.log('✓ G3 type=regenerate → 重 roll（★用户实测路径★）');
}
{
  // G4 dryRun（数据库插件预热/算 token）→ 跳过，不重判注入
  const r = onGenStarted('normal', true);
  assert.deepStrictEqual(r, { skipped: true }, 'G4');
  console.log('✓ G4 dryRun → 跳过（不再「生成完又注入」）');
}
{
  // G5 continue（续写）→ 非重 roll（接着当前 AI 楼写，注入当前状态）
  const r = onGenStarted('continue', false);
  assert.deepStrictEqual(r, { skipped: false, isReroll: false }, 'G5');
  console.log('✓ G5 type=continue → 非重 roll（注入当前状态）');
}

// ═══════ I1-I6：注入判定（修复 v2.3.18 回归现场）═══════
{
  // I1 ★核心回归★：新一轮发消息，GEN_STARTED 时用户楼未落地 chatLayer 仍==20==state.chatLayer，
  //   但 type=normal → isReroll=false → 注入当前状态（不再被误判成重 roll 注入存档点）
  const r = decideInjection(makeState6(), 20, cp5(), { isReroll: false });
  assert.strictEqual(r.branch, 'ge-current', 'I1 branch');
  assert.strictEqual(r.inject, 'state', 'I1 inject');
  console.log('✓ I1 ★新轮发消息 chatLayer==state.chatLayer 但 type=normal → 注入当前状态（治 v2.3.18 回归）★');
}
{
  // I2 真重 roll（regenerate）同层有 cp → 注入存档点
  const r = decideInjection(makeState6(), 20, cp5(), { isReroll: true });
  assert.strictEqual(r.branch, 'reroll-cp', 'I2 branch');
  assert.strictEqual(r.cpRound, 5, 'I2 cpRound=5');
  console.log('✓ I2 真重 roll(regenerate) → 注入第5轮存档点');
}
{
  // I3 真重 roll 无 cp → 不注入
  const r = decideInjection(makeState6(), 20, null, { isReroll: true });
  assert.strictEqual(r.branch, 'reroll-none', 'I3 branch');
  console.log('✓ I3 真重 roll 无 cp → 不注入');
}
{
  // I4 新轮次 AI 楼已落地（chatLayer 22 > 20）type=normal → 注入当前状态
  const r = decideInjection(makeState6(), 22, cp5(), { isReroll: false });
  assert.strictEqual(r.branch, 'ge-current', 'I4 branch');
  console.log('✓ I4 新轮 AI 楼落地(22>20) type=normal → 注入当前状态');
}
{
  // I5 往前删到旧层（chatLayer 15 < 20）非重 roll → 仍走 < 分支注入存档点
  const r = decideInjection(makeState6(), 15, cp5(), { isReroll: false });
  assert.strictEqual(r.branch, 'less-cp', 'I5 branch');
  console.log('✓ I5 往前删旧层(15<20) → 注入存档点（兜底不变）');
}
{
  // I6 首推演前空 state（chatLayer 任意）非重 roll → 注入当前状态（默认）
  const r = decideInjection({ round: 0, chatLayer: undefined }, 4, null, { isReroll: false });
  assert.strictEqual(r.branch, 'ge-current', 'I6 branch');
  console.log('✓ I6 首推演前空 state → 注入当前状态（默认）');
}

// ═══════ E1-E5：evolution 基底/轮次三分回归保护（v2.3.18 逻辑不变）═══════
function isNewRoundSim(fp, chatLayerNow) {
  if (fp === '' || fp == null) return true;
  return fp !== String(chatLayerNow);
}
function evolveSim({ mode, state, cp, hadStoredState, chatLayerNow, fp }) {
  const isNew = mode === 'forward' ? true : mode === 'redo' ? false : isNewRoundSim(fp, chatLayerNow);
  const isForward = isNew;
  let restored = false, rejectedRedo = false, baseSource;
  if (isForward) baseSource = 'state';
  else if (mode === 'redo') {
    if (cp) { Object.assign(state, cp); restored = true; baseSource = 'checkpoint'; }
    else return { rejectedRedo: true, roundAfter: state.round };
  } else baseSource = 'state(autoroll)';
  const roundBefore = state.round;
  let savedCheckpoint = false, label;
  if (isForward) { state.round++; if (hadStoredState) savedCheckpoint = true; label = 'forward'; }
  else label = (mode === 'redo') ? 'redo' : 'autoroll';
  state.chatLayer = chatLayerNow;
  return { baseSource, restored, rejectedRedo, label, roundAfter: state.round, roundChanged: state.round !== roundBefore, savedCheckpoint };
}
{
  // E1 自动重 roll（regenerate）：fp==chatLayer → isNewRound=false → autoroll → round 不变
  const s = { round: 6, chatLayer: 20 };
  const r = evolveSim({ mode: undefined, state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 20, fp: '20' });
  assert.strictEqual(r.label, 'autoroll', 'E1 label');
  assert.strictEqual(r.roundAfter, 6, 'E1 round 不变=6');
  assert.strictEqual(r.savedCheckpoint, false, 'E1 不存档点');
  console.log('✓ E1 自动重 roll → round 保持 6 + 存档点不动');
}
{
  // E2 自动新轮次：fp(20)!=chatLayer(22) → isNewRound=true → forward → round++
  const s = { round: 6, chatLayer: 20 };
  const r = evolveSim({ mode: undefined, state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 22, fp: '20' });
  assert.strictEqual(r.label, 'forward', 'E2 label');
  assert.strictEqual(r.roundAfter, 7, 'E2 round 7');
  console.log('✓ E2 自动新轮次 → round 6→7 + 存档点前移');
}
{
  // E3 手动 redo 有 cp → 回存档点 round=5
  const s = { round: 6, chatLayer: 20 };
  const r = evolveSim({ mode: 'redo', state: s, cp: { round: 5, chatLayer: 18, memories:[], events:[], factions:[], worldTrends:[], winds:[], enemies:[], influenceChain:[] }, hadStoredState: true, chatLayerNow: 20 });
  assert.strictEqual(r.label, 'redo', 'E3 label'); assert.strictEqual(r.restored, true, 'E3 restored'); assert.strictEqual(r.roundAfter, 5, 'E3 round 5');
  console.log('✓ E3 手动 redo → 回存档点 round=5');
}
{
  // E4 手动 redo 无 cp → 拒绝
  const s = { round: 6, chatLayer: 20 };
  const r = evolveSim({ mode: 'redo', state: s, cp: null, hadStoredState: true, chatLayerNow: 20 });
  assert.strictEqual(r.rejectedRedo, true, 'E4 reject');
  console.log('✓ E4 手动 redo 无 cp → 拒绝');
}
{
  // E5 手动 forward → round++
  const s = { round: 5, chatLayer: 18 };
  const r = evolveSim({ mode: 'forward', state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 20 });
  assert.strictEqual(r.label, 'forward', 'E5 label'); assert.strictEqual(r.roundAfter, 6, 'E5 round 6'); assert.strictEqual(r.savedCheckpoint, true, 'E5 cp');
  console.log('✓ E5 手动 forward → round 5→6 + 存档点前移');
}

console.log('\n全部 16 断言通过 ✅（G5 type翻译 + I6 注入 + E5 推演回归）');
