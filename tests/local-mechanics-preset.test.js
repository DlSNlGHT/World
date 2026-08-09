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
  WORLD_ENGINE_CORE: {},
  console
};
globalThis.window.window = globalThis.window;

eval.call(globalThis.window, fs.readFileSync(path.join(root, 'world-engine-presets.js'), 'utf8'));
const P = window.WORLD_ENGINE_PRESETS;

const normalized = P.normalizePreset({
  id: 'mechanic_profile',
  name: 'Mechanic Profile',
  localMechanics: {
    distantEvent: { ledgerThreshold: 0, chancePercent: 160, cooldownRounds: -2, eventPercent: 71 },
    nearEvent: { chancePercent: 37, cooldownRounds: 4, eventPercent: 66 },
    eventDice: { modifier: -12, setbackRatioPercent: -5, progressFailBase: 3.8, conflictFailBase: 0 },
    windDecay: { rumor: { base: 120, grace: -1, linear: 7.5, quadratic: 2.5 } },
    retention: { ledgerKeepRounds: 44, caps: { events: 0, blackbox: 21 } }
  }
});

assert.strictEqual(normalized.schemaVersion, 3);
assert.deepStrictEqual(normalized.localMechanics.distantEvent, {
  ledgerThreshold: 1,
  chancePercent: 100,
  cooldownRounds: 0,
  eventPercent: 71
});
assert.strictEqual(normalized.localMechanics.eventDice.setbackRatioPercent, 0);
assert.strictEqual(normalized.localMechanics.eventDice.progressFailBase, 4);
assert.strictEqual(normalized.localMechanics.eventDice.conflictFailBase, 1);
assert.strictEqual(normalized.localMechanics.windDecay.rumor.base, 95);
assert.strictEqual(normalized.localMechanics.windDecay.rumor.grace, 0);
assert.strictEqual(normalized.localMechanics.windDecay.announcement.base, 10);
assert.strictEqual(normalized.localMechanics.retention.caps.events, 1);
assert.strictEqual(normalized.localMechanics.retention.caps.blackbox, 21);
assert.strictEqual(normalized.localMechanics.retention.caps.winds, 12);

assert.strictEqual(P.saveCustomPreset({
  ...normalized,
  regionalIncidents: { chance: 0.14, durationRounds: 9, cooldownRounds: 2, types: [] }
}), true);
P.setActivePreset('mechanic_profile');

let settings = {
  localRegionalIncidentUsePreset: true,
  localRegionalIncidentChancePercent: 88,
  localRegionalIncidentDuration: 88,
  localRegionalIncidentCooldown: 88,
  localDistantEventUsePreset: true,
  localDistantEventChancePercent: 1,
  localNearEventUsePreset: true,
  localNearEventChancePercent: 1,
  localEventDiceUsePreset: true,
  localEventDiceModifier: 99,
  localWindDecayUsePreset: true,
  localWindRumorBase: 1,
  localRetentionUsePreset: true,
  localCapBlackbox: 1
};
window.WORLD_ENGINE_API = { getSettings: () => settings };

eval.call(globalThis.window, fs.readFileSync(path.join(root, 'world-engine-evolution.js'), 'utf8'));
const L = window.WORLD_ENGINE_EVOLUTION._LOCAL_MECHANICS;

assert.strictEqual(L.resolveSetting('localRegionalIncidentChancePercent', 3), 14);
assert.strictEqual(L.resolveSetting('localRegionalIncidentDuration', 5), 9);
assert.strictEqual(L.resolveSetting('localDistantEventChancePercent', 20), 100);
assert.strictEqual(L.resolveSetting('localNearEventChancePercent', 20), 37);
assert.strictEqual(L.resolveSetting('localEventDiceModifier', 0), -12);
assert.strictEqual(L.resolveSetting('localWindRumorBase', 25), 95);
assert.strictEqual(L.resolveSetting('localCapBlackbox', 12), 21);

settings.localNearEventUsePreset = false;
settings.localNearEventChancePercent = 73;
assert.strictEqual(L.resolveSetting('localNearEventChancePercent', 20), 73, 'manual group override should win when follow is disabled');
settings.localRegionalIncidentUsePreset = false;
settings.localRegionalIncidentChancePercent = 3;
assert.strictEqual(L.resolveSetting('localRegionalIncidentChancePercent', 3), 3, 'explicit manual mode must allow the factory numeric value');
settings.localRegionalIncidentUsePreset = true;

const regional = L.tunedRegionalConfig();
assert.strictEqual(regional.chance, 0.14);
assert.strictEqual(regional.durationRounds, 9);
assert.strictEqual(regional.cooldownRounds, 2);

// API settings migration: legacy customized groups stay manual; untouched groups start following presets.
mem.world_engine_settings = JSON.stringify({
  localNearEventChancePercent: 64,
  localNearEventCooldown: 5,
  localNearEventEventPercent: 50,
  localDistantEventChancePercent: 20
});
delete window.WORLD_ENGINE_API;
eval.call(globalThis.window, fs.readFileSync(path.join(root, 'world-engine-api.js'), 'utf8'));
const migrated = window.WORLD_ENGINE_API.getSettings(true);
assert.strictEqual(migrated.localNearEventUsePreset, false);
assert.strictEqual(migrated.localDistantEventUsePreset, true);
assert.strictEqual(migrated.localEventDiceUsePreset, true);

const uiSource = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
[
  'we-local-ri-use-preset',
  'we-local-distant-use-preset',
  'we-local-near-use-preset',
  'we-local-dice-use-preset',
  'we-local-wind-use-preset',
  'we-local-retention-use-preset'
].forEach((id) => assert(uiSource.includes(id), 'settings UI should expose ' + id));
assert(uiSource.includes('localRetentionUsePreset:'), 'settings save should persist follow-preset switches');

console.log('local-mechanics preset tests: normalization / runtime precedence / legacy migration passed');
