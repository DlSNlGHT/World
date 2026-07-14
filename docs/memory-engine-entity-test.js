const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storage = new Map();
let injection = '';
let apiResponse = '';

global.window = global;
global.document = { getElementById: () => null };
global.SillyTavern = {
  getContext: () => ({
    chat: [
      { is_user: true, name: '玩家', mes: '嘉宁三十年正月十五，沈鹤亭在黑礁湾代表听潮阁取出断潮剑。' },
      { is_user: false, name: '角色', mes: '断潮剑在交战中折损，沈鹤亭确信它还能修复，并在此觉醒听潮能力。' }
    ],
    setExtensionPrompt: (_name, content) => { injection = content; }
  })
};
global.WORLD_ENGINE_STORE = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};
global.WORLD_ENGINE_CORE = {
  getChatId: () => 'entity-test',
  filterDialogue: value => value
};
global.WORLD_ENGINE_API = { callApi: async () => apiResponse };
global.WORLD_ENGINE_UI = { setMemoryEvolvingUI: () => {} };

for (const file of ['memory-engine-settings.js', 'memory-engine-data.js', 'memory-engine-prompt.js', 'memory-engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  storage.set('memory_engine_state_entity-test', JSON.stringify({
    personal_memory: [], knowledge_index: {},
    world_memory: { organization: [], item: [{ id: 'item_000001', name: '旧物', description: '旧结构。', history: [] }], ability: [], location: [] },
    round: 0, chatLayer: null
  }));
  const migrated = MEMORY_ENGINE_DATA.loadState();
  assert(migrated.entity_memory.object[0].name === '旧物' && !migrated.world_memory, '开发期旧实体结构应迁移到 entity_memory.object');

  storage.set('memory_engine_state_entity-test', JSON.stringify({
    personal_memory: [], knowledge_index: {}, round: 0, chatLayer: null
  }));
  apiResponse = JSON.stringify({
    personal_memory: [{
      name: ['沈鹤亭'], known_by: [], memory: '沈鹤亭确信断潮剑还能修复。', time: '嘉宁三十年正月十五'
    }],
    entity_updates: [
      { type: 'organization', name: '听潮阁', description: '活动于沿海地区的情报组织。', event: '', time: '' },
      { type: 'object', name: '断潮剑', description: '一柄剑格刻有海浪纹的旧剑，目前剑身折损。', event: '断潮剑在黑礁湾交战中折损。', time: '嘉宁三十年正月十五' },
      { type: 'ability', name: '听潮', description: '能够从潮声中分辨远处动静的感知能力。', event: '沈鹤亭在黑礁湾觉醒听潮。', time: '嘉宁三十年正月十五' },
      { type: 'location', name: '黑礁湾', description: '遍布黑色礁石的海湾。', event: '沈鹤亭在此取出断潮剑。', time: '刚才' }
    ]
  });

  const first = await MEMORY_ENGINE.manualExtract();
  assert(first.addedPersonal === 1, '应写入一条人物记忆');
  let state = MEMORY_ENGINE_DATA.loadState();
  assert(state.entity_memory.object[0].id === 'obj_000001', '物件 ID 应由本地生成');
  assert(state.entity_memory.organization[0].id === 'org_000001', '组织 ID 应由本地生成');
  assert(state.entity_memory.ability[0].id === 'ability_000001', '能力 ID 应由本地生成');
  assert(state.entity_memory.location[0].id === 'location_000001', '地点 ID 应由本地生成');
  assert(state.entity_memory.location[0].history[0].time === '', '无法换算的相对时间应清空');
  assert(state.entity_memory.organization[0].history.length === 0, '空 event 不得写入本地历史');
  assert(injection.includes('【物件：断潮剑】'), '命中名称后应注入物件记忆');
  assert(injection.includes('【地点：黑礁湾】'), '命中名称后应注入地点记忆');
  assert(injection.includes('【组织：听潮阁】'), '命中名称后应注入组织记忆');
  assert(injection.includes('【能力：听潮】'), '命中名称后应注入能力记忆');

  apiResponse = JSON.stringify({
    personal_memory: [],
    entity_updates: [
      { type: 'object', name: '断潮剑', description: '一柄剑格刻有海浪纹的旧剑，剑身已用玄铁修复。', event: '断潮剑在黑礁湾交战中折损。', time: '嘉宁三十年正月十五' },
      { type: 'object', name: '断潮剑', description: '一柄剑格刻有海浪纹的旧剑，剑身已用玄铁修复。', event: '断潮剑以玄铁修复。', time: '嘉宁三十年正月十六' },
      { type: 'organization', name: '听潮阁', description: '', event: '听潮阁宣告解散。', time: '嘉宁三十年正月十六' }
    ]
  });
  await MEMORY_ENGINE.manualExtract();
  state = MEMORY_ENGINE_DATA.loadState();
  assert(state.entity_memory.object.length === 1, '同类型同名实体应归并');
  assert(state.entity_memory.object[0].history.length === 2, '重复事件应去重，新事件应追加到本地历史');
  assert(state.entity_memory.object[0].description.includes('已用玄铁修复'), 'API 返回的当前描述应直接覆盖本地描述');
  assert(state.entity_memory.organization[0].description === '活动于沿海地区的情报组织。', 'API 返回空描述时应保留本地原描述');
  assert(state.entity_memory.organization[0].history[0].event === '听潮阁宣告解散。', '空描述不得阻止 event 写入本地历史');

  apiResponse = JSON.stringify({
    personal_memory: [],
    entity_updates: [{ type: 'object', name: '断潮剑', description: '', event: '事'.repeat(51), time: '' }]
  });
  let overlongRejected = false;
  try { await MEMORY_ENGINE.manualExtract(); } catch (error) { overlongRejected = /事件超过 50 字/.test(error.message); }
  assert(overlongRejected, '超过 50 字的 event 应被拒绝');

  apiResponse = JSON.stringify([{ name: ['旧版人物'], known_by: [], memory: '旧版人物记得这次测试。', time: '' }]);
  await MEMORY_ENGINE.manualExtract();
  state = MEMORY_ENGINE_DATA.loadState();
  assert(state.personal_memory.some(person => person.names.includes('旧版人物')), '应兼容旧版人物数组响应');

  const beforeEdit = {
    personal_memory: [
      { id: 'char_000001', names: ['知情人'], memory: {} },
      { id: 'char_000002', names: ['记忆主人'], memory: { '某日': ['记忆主人记得一件事。'] } }
    ],
    knowledge_index: {
      '知情人': [{ ownerId: 'char_000002', time: '某日', memory: '记忆主人记得一件事。' }],
      '记忆主人': [{ ownerId: 'char_000002', time: '某日', memory: '记忆主人记得一件事。' }]
    },
    entity_memory: { organization: [{ id: 'org_000001', name: '旧组织', description: '', history: [] }], object: [], ability: [], location: [] },
    entity_index: { 'organization:旧组织': 'org_000001' },
    event_memory: { small_summaries: [], big_summary: null, small_summary_layer: null, big_summary_cursor: 0 },
    round: 0, chatLayer: null
  };
  const afterEdit = JSON.parse(JSON.stringify(beforeEdit));
  afterEdit.personal_memory[0].names = ['新知情人'];
  afterEdit.entity_memory.organization[0].name = '新组织';
  MEMORY_ENGINE.repairStateIndexes(afterEdit, beforeEdit);
  assert(afterEdit.knowledge_index['新知情人']?.some(record => record.ownerId === 'char_000002'), '人物改名后应保留其知晓的他人记忆');
  assert(!afterEdit.knowledge_index['知情人'], '人物改名后不应残留旧别名索引');
  assert(afterEdit.entity_index['organization:新组织'] === 'org_000001', '实体改名后应重建名称索引并保留稳定 ID');

  console.log('memory-engine entity tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
