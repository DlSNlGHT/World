const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mem = {};
let lastPrompt = '';
let responseMode = 'valid';

const disabledForFive = ['winds', 'influence', 'contact', 'enemies', 'regional', 'blackbox', 'trends'];

globalThis.window = {
  WORLD_ENGINE_STORE: {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null),
    setItem: (key, value) => { mem[key] = value; },
    removeItem: (key) => { delete mem[key]; },
    keys: () => Object.keys(mem)
  },
  WORLD_ENGINE_CORE: { getUserPersona: () => '' },
  WORLD_ENGINE_WORLDBOOK: {
    hasSelection: () => true,
    getSelectedIds: () => ['campus::1'],
    loadCurrentEntries: async () => [
      { id: 'campus::1', title: 'Modern Campus', content: 'student council clubs city daily life', disabled: false }
    ],
    loadCurrentCharacterProfile: () => ''
  },
  WORLD_ENGINE_API: {
    callApi: async (prompt) => {
      lastPrompt = prompt;
      return JSON.stringify({
        name: responseMode === 'valid' ? 'Classic Five' : 'Classic Wrong Count',
        description: 'Generated classic preset with module selection.',
        disabledModules: responseMode === 'valid' ? disabledForFive : [],
        localMechanics: {
          distantEvent: { ledgerThreshold: 12, chancePercent: 9, cooldownRounds: 8, eventPercent: 35 },
          nearEvent: { chancePercent: 28, cooldownRounds: 3, eventPercent: 70 }
        },
        schemaOverrides: {},
        ui: { labels: {}, moods: {}, moduleLabels: {}, summaryEmpty: 'Empty.' }
      });
    }
  }
};

globalThis.window.window = globalThis.window;
globalThis.window.console = console;
globalThis.window.Date = Date;

eval.call(globalThis.window, fs.readFileSync(path.join(root, 'world-engine-presets.js'), 'utf8'));

const P = window.WORLD_ENGINE_PRESETS;

async function main() {
  const generated = await P.generateFromWorldbook({
    generationMode: 'classic',
    includeUserPersona: false,
    worldbookEntryIds: ['campus::1'],
    autoCropModules: true,
    moduleCountMode: 'fixed',
    moduleCount: 5
  });

  assert(lastPrompt.includes('disabledModules'));
  assert(lastPrompt.includes('"localMechanics"'));
  assert(lastPrompt.includes('不要机械照抄示例值'));
  const templateMatch = lastPrompt.match(/```json\s*([\s\S]*?)```/);
  assert(templateMatch && JSON.parse(templateMatch[1]), 'classic generation JSON template should stay parseable');
  assert(lastPrompt.includes('恰好为 5 个'));
  assert.strictEqual(generated.mode, 'classic');
  assert.deepStrictEqual(generated.disabledModules, disabledForFive);
  assert.strictEqual(generated.localMechanics.distantEvent.chancePercent, 9);
  assert.strictEqual(generated.localMechanics.nearEvent.eventPercent, 70);

  responseMode = 'invalid';
  await assert.rejects(
    () => P.generateFromWorldbook({
      generationMode: 'classic',
      includeUserPersona: false,
      worldbookEntryIds: ['campus::1'],
      moduleCountMode: 'fixed',
      moduleCount: 5
    }),
    /模块数量不一致/
  );

  console.log('Generation module option tests: 8 passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
