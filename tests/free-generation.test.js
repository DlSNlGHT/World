const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mem = {};
let lastPrompt = '';
let responseMode = 'campus';

globalThis.window = {
  WORLD_ENGINE_STORE: {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null),
    setItem: (key, value) => { mem[key] = value; },
    removeItem: (key) => { delete mem[key]; },
    keys: () => Object.keys(mem)
  },
  WORLD_ENGINE_CORE: {
    getUserPersona: () => '',
    renderUserName: (text) => text
  },
  WORLD_ENGINE_WORLDBOOK: {
    hasSelection: () => true,
    getSelectedIds: () => ['campus::1'],
    loadCurrentEntries: async () => [
      { id: 'campus::1', title: 'Modern Campus', content: 'student council clubs city daily life', disabled: false },
      { id: 'xianxia::2', title: 'Xianxia Realm', content: 'cultivation realms sect trials spirit qi', disabled: false },
      { id: 'wasteland::3', title: 'Wasteland Holdout', content: 'water ration diesel generator raider pressure', disabled: false }
    ],
    loadCurrentCharacterProfile: () => ''
  },
  WORLD_ENGINE_API: {
    callApi: async (prompt) => {
      lastPrompt = prompt;
      if (responseMode === 'empty') return JSON.stringify({ name: 'Broken Free', description: 'bad', modules: [] });
      return JSON.stringify(makeResponse(responseMode));
    }
  }
};

globalThis.window.window = globalThis.window;
globalThis.window.console = console;
globalThis.window.Date = Date;
globalThis.document = { addEventListener: () => {} };

function customModule(id, field, rules, statusValues) {
  return {
    id,
    name: id,
    kind: 'custom',
    enabled: true,
    order: 2,
    container: 'array',
    field,
    itemKey: 'name',
    rules,
    fields: {
      name: { type: 'string', description: 'entry name', example: id + ' item', display: true },
      status: { type: 'enum', enum: statusValues, description: 'current state', example: statusValues[0], display: true }
    },
    display: { style: 'cards', titleField: 'name', badgeFields: ['status'], bodyFields: [], emptyText: 'No entries' },
    mechanics: {}
  };
}

function makeResponse(mode) {
  if (mode === 'xianxia') {
    return {
      name: 'Xianxia Free',
      description: 'Tracks sect cultivation arcs.',
      mode: 'free',
      modules: [customModule('cultivationTracks', 'cultivationTracks', 'Track cultivation breakthroughs, sect trials, and spirit qi changes.', ['mortal', 'adept'])],
      // 生成器只允许返回 causalSteps；engineRole 即使被 AI 擅自返回也必须被丢弃
      engineSegments: {
        engineRole: 'AI 擅自生成的人设（应被丢弃）',
        causalSteps: '1. 私密行为未被目击不得影响公开状态。\n2. cultivationTracks 仅在突破/受创时更新。\n3. 禁止直接读取面板信息行动。'
      }
    };
  }
  if (mode === 'wasteland') {
    return {
      name: 'Wasteland Free',
      description: 'Tracks survival logistics.',
      mode: 'free',
      modules: [customModule('settlementResources', 'settlementResources', 'Track water, fuel, generator stability, and raider pressure.', ['scarce', 'stable'])]
    };
  }
  return {
    name: 'Campus Free',
    description: 'Tracks modern campus life without fantasy noise.',
    mode: 'free',
    modules: [
      { id: 'events', kind: 'builtin', enabled: true, order: 1 },
      customModule('campusSystems', 'campusSystems', 'Track clubs, student council, and school-life institutions only when plot changes them.', ['stable', 'tense'])
    ],
    localMechanics: {
      distantEvent: { ledgerThreshold: 18, chancePercent: 6, cooldownRounds: 12, eventPercent: 30 },
      nearEvent: { chancePercent: 32, cooldownRounds: 2, eventPercent: 75 },
      retention: { ledgerKeepRounds: 30, caps: { events: 9 } }
    },
    regionalIncidents: {
      chance: 0.01,
      durationRounds: 2,
      cooldownRounds: 14,
      types: [{ type: 'campusFestival', label: '校园祭风波', weight: 100, guide: '社团、学生会与校方因活动安排产生连锁变化。' }]
    },
    ui: { summaryEmpty: 'Campus is quiet.' }
  };
}

eval.call(globalThis.window, fs.readFileSync(path.join(root, 'world-engine-presets.js'), 'utf8'));
eval.call(globalThis.window, fs.readFileSync(path.join(root, 'world-engine-rules-loader.js'), 'utf8'));

const P = window.WORLD_ENGINE_PRESETS;
const R = window.WORLD_ENGINE_RULES;
assert(P && typeof P.generateFromWorldbook === 'function', 'generateFromWorldbook should exist');
assert(P && typeof P._buildFreeGenerationPrompt === 'function', 'free generation prompt hook should exist');
assert(R && typeof R.getActiveModuleDescriptors === 'function', 'rules loader should exist');

async function generateAndAssert(mode, entryId, field, promptNeedle, promptExcluded, options = {}) {
  responseMode = mode;
  const generated = await P.generateFromWorldbook({
    generationMode: 'free',
    includeUserPersona: false,
    includeCharacterDescription: false,
    worldbookEntryIds: [entryId],
    ...options
  });
  assert(lastPrompt.includes('自由模式'));
  assert(lastPrompt.includes('modules[]'));
  assert(lastPrompt.includes('"localMechanics"'));
  const templateMatch = lastPrompt.match(/```json\s*([\s\S]*?)```/);
  assert(templateMatch && JSON.parse(templateMatch[1]), 'free generation JSON template should stay parseable');
  assert(lastPrompt.includes(promptNeedle));
  if (promptExcluded) assert(!lastPrompt.includes(promptExcluded));
  if (options.moduleCountMode === 'fixed') assert(lastPrompt.includes('恰好为 ' + options.moduleCount + ' 个'));
  assert.strictEqual(generated.mode, 'free');
  assert(generated.modules.some((module) => module.field === field));

  P.setActivePreset(generated.id);
  const descriptors = R.getActiveModuleDescriptors();
  assert(descriptors.some((descriptor) => descriptor.field === field));
  const rulesText = R.getAllRulesText();
  assert(rulesText.includes(field));
  const schemas = R.getActiveOutputSchemas();
  assert(schemas.some((schema) => schema.field === field));
  return generated;
}

async function main() {
  const campus = await generateAndAssert('campus', 'campus::1', 'campusSystems', 'student council clubs', 'cultivation realms', { moduleCountMode: 'fixed', moduleCount: 2 });
  assert.strictEqual(campus.modules[0].kind, 'builtin');
  assert.strictEqual(campus.modules[0].id, 'events');
  assert.strictEqual(campus.localMechanics.distantEvent.cooldownRounds, 12);
  assert.strictEqual(campus.localMechanics.nearEvent.chancePercent, 32);
  assert.strictEqual(campus.localMechanics.retention.ledgerKeepRounds, 30);
  assert.strictEqual(campus.localMechanics.retention.caps.events, 9);
  assert.strictEqual(campus.localMechanics.retention.caps.winds, 12, 'missing generated values should use stable defaults');
  assert.strictEqual(campus.regionalIncidents.chance, 0.01);
  assert.strictEqual(campus.regionalIncidents.types[0].type, 'campusFestival');
  // 生成模板应包含引擎段落定制说明；响应未带 engineSegments 时双空（跟随默认）
  assert(lastPrompt.includes('"engineSegments"'), '生成模板应含 engineSegments 字段说明');
  assert(lastPrompt.includes('causalSteps'), '生成模板应含 causalSteps 说明');
  assert.deepStrictEqual(campus.engineSegments, { engineRole: '', causalSteps: '' });

  const xianxia = await generateAndAssert('xianxia', 'xianxia::2', 'cultivationTracks', 'cultivation realms', 'water ration');
  // causalSteps 采纳；engineRole 不开放给生成器，即使 AI 返回也丢弃
  assert(xianxia.engineSegments.causalSteps.includes('cultivationTracks 仅在突破/受创时更新'));
  assert.strictEqual(xianxia.engineSegments.engineRole, '');
  await generateAndAssert('wasteland', 'wasteland::3', 'settlementResources', 'water ration', 'student council clubs');

  responseMode = 'campus';
  await assert.rejects(
    () => P.generateFromWorldbook({ generationMode: 'free', includeUserPersona: false, worldbookEntryIds: ['campus::1'], moduleCountMode: 'fixed', moduleCount: 1 }),
    /returned 2 free modules/
  );

  responseMode = 'empty';
  await assert.rejects(
    () => P.generateFromWorldbook({ generationMode: 'free', includeUserPersona: false, worldbookEntryIds: ['campus::1'] }),
    /did not return any free modules/
  );

  console.log('Free generation tests: 44 passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
