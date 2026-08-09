const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mem = {};

globalThis.window = {
  WORLD_ENGINE_STORE: {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null),
    setItem: (key, value) => { mem[key] = String(value); },
    removeItem: (key) => { delete mem[key]; },
    keys: () => Object.keys(mem)
  },
  WORLD_ENGINE_CORE: {
    getCustomModuleStateKey: () => 'world_engine_phase7-chat_customModuleState'
  }
};

globalThis.window.window = globalThis.window;
globalThis.window.console = console;
globalThis.window.Date = Date;

eval.call(globalThis.window, fs.readFileSync(path.join(root, 'world-engine-presets.js'), 'utf8'));
const P = window.WORLD_ENGINE_PRESETS;

const freePreset = {
  id: 'phase7_free',
  name: 'Phase 7 Free',
  description: 'Export/import free preset',
  mode: 'free',
  builtin: false,
  localMechanics: {
    nearEvent: { chancePercent: 7, cooldownRounds: 11, eventPercent: 80 },
    eventDice: { modifier: -4 }
  },
  modules: [
    { id: 'events', kind: 'builtin', enabled: true, order: 1 },
    {
      id: 'cultivation',
      name: 'Cultivation',
      kind: 'custom',
      enabled: true,
      order: 2,
      container: 'array',
      field: 'cultivation',
      itemKey: 'name',
      rules: 'Track cultivation state.',
      fields: {
        name: { type: 'string', description: 'name', example: 'A', display: true },
        realm: { type: 'enum', enum: ['mortal', 'adept'], description: 'realm', example: 'mortal', display: true }
      },
      display: { style: 'cards', titleField: 'name', badgeFields: ['realm'] },
      mechanics: { stages: { states: ['seed', 'bloom'], progressField: 'progress', progressMax: 2 } }
    }
  ]
};

assert.strictEqual(P.saveCustomPreset(freePreset), true);
window.WORLD_ENGINE_STORE.setItem('world_engine_phase7-chat_customModuleState', JSON.stringify({
  cultivation: [{ name: 'A', realm: 'adept' }]
}));

const exported = P.exportPreset('phase7_free');
const payload = JSON.parse(exported);
assert.strictEqual(payload.schemaVersion, 3);
assert.strictEqual(payload.mode, 'free');
assert.strictEqual(payload.localMechanics.nearEvent.cooldownRounds, 11);
assert.strictEqual(payload.localMechanics.eventDice.modifier, -4);
assert.strictEqual(payload.modules[1].mechanics.stages.progressMax, 2);
assert.deepStrictEqual(payload.customModuleState.cultivation, [{ name: 'A', realm: 'adept' }]);

window.WORLD_ENGINE_STORE.removeItem('world_engine_custom_presets');
window.WORLD_ENGINE_STORE.removeItem('world_engine_phase7-chat_customModuleState');
const imported = P.importPreset(exported);
assert(imported, 'import should return preset');
assert.strictEqual(imported.schemaVersion, 3);
assert.strictEqual(imported.mode, 'free');
assert.strictEqual(imported.localMechanics.nearEvent.chancePercent, 7);
assert.strictEqual(imported.modules[1].field, 'cultivation');
assert.strictEqual(imported.modules[1].mechanics.stages.progressMax, 2);
const restoredState = JSON.parse(window.WORLD_ENGINE_STORE.getItem('world_engine_phase7-chat_customModuleState'));
assert.deepStrictEqual(restoredState.cultivation, [{ name: 'A', realm: 'adept' }]);

const legacy = P.normalizePreset({ id: 'legacy_classic', name: 'Legacy Classic' });
assert.strictEqual(legacy.schemaVersion, 3);
assert.strictEqual(legacy.mode, 'classic');
assert.deepStrictEqual(legacy.modules, []);
assert.strictEqual(legacy.localMechanics.distantEvent.chancePercent, 20);

const legacyImported = P.importPreset(JSON.stringify({ id: 'legacy_free', name: 'Legacy Free', mode: 'free', modules: [] }));
assert(legacyImported.importWarnings.some((warning) => warning.includes('旧版预设')));
assert.strictEqual(legacyImported.schemaVersion, 3);

console.log('Phase 7 persistence tests: 16 passed');
