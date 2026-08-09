/**
 * world-engine-presets.js
 * 世界引擎 — 预设系统 (World Engine Preset System)
 *
 * 提供多套世界观模板（古风、现代、赛博朋克、西幻、末日废土），
 * 支持自定义预设、术语替换引擎、以及从世界书自动生成预设。
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // Storage keys
  // ─────────────────────────────────────────────
  const STORAGE_KEY_ACTIVE = 'world_engine_active_preset';
  const STORAGE_KEY_CUSTOM = 'world_engine_custom_presets';
  const DEFAULT_PRESET_ID = 'ancient_chinese';
  const PRESET_SCHEMA_VERSION = 3;
  const PRESET_EXPORT_TYPE = 'worldEnginePresetExport';
  const LOCAL_MECHANICS_DEFAULTS = {
    distantEvent: { ledgerThreshold: 10, chancePercent: 20, cooldownRounds: 5, eventPercent: 50 },
    nearEvent: { chancePercent: 20, cooldownRounds: 5, eventPercent: 50 },
    eventDice: { modifier: 0, setbackRatioPercent: 40, progressFailBase: 2, conflictFailBase: 6 },
    windDecay: {
      announcement: { base: 10, grace: 4, linear: 3, quadratic: 1 },
      report: { base: 20, grace: 2, linear: 4, quadratic: 2 },
      rumor: { base: 25, grace: 1, linear: 5, quadratic: 3 },
      sentiment: { base: 8, grace: 5, linear: 2, quadratic: 1 }
    },
    retention: {
      terminalBaseKeepRounds: 2,
      terminalLevelKeepRounds: 2,
      influenceKeepRounds: 8,
      enemyTerminalKeepRounds: 20,
      ledgerKeepRounds: 20,
      caps: { events: 16, factions: 15, winds: 12, worldTrends: 4, influence: 12, enemies: 8, economySignals: 8, blackbox: 12 }
    }
  };

  // ─────────────────────────────────────────────
  // Helper — deep clone
  // ─────────────────────────────────────────────
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ═════════════════════════════════════════════
  //  BUILT-IN PRESETS
  // ═════════════════════════════════════════════

  // ── 1. 古风 / 武侠 ──────────────────────────
  const ANCIENT_CHINESE = {
    id: 'ancient_chinese',
    name: '古风/武侠',
    description: '以古代中国为背景的江湖武侠世界观，朝堂、市井、草莽、同道四大声望维度，刀光剑影、恩怨江湖。',
    builtin: true,

    reputation: {
      dimensions: {
        authority: { name: '朝堂之上', description: '在朝廷、官府等权力体系中的声望' },
        common:    { name: '市井之间', description: '在普通百姓与民间社会中的口碑' },
        shadow:    { name: '草莽之中', description: '在江湖、黑道与地下势力中的名声' },
        circuit:   { name: '同道之间', description: '在同行、同业或同门圈子中的评价' }
      },
      levels: ['天怒人怨', '声名狼藉', '默默无闻', '受人尊敬', '万众敬仰'],
      verdicts: {
        authority: {
          '天怒人怨': '朝堂视为眼中钉，已被通缉问罪，官面上人人喊打',
          '声名狼藉': '在官场名声极坏，被当成麻烦与危险分子，处处提防',
          '默默无闻': '朝堂无人识其名，进不了当权者的眼',
          '受人尊敬': '官面上颇有声望，被视作可用可信之人',
          '万众敬仰': '深得当权者倚重，朝堂之上一言九鼎'
        },
        common: {
          '天怒人怨': '百姓恨之入骨，提起就唾骂，避之如蛇蝎',
          '声名狼藉': '市井口碑极差，被当成祸害，街坊见了绕道走',
          '默默无闻': '街面上没什么人听过他，泯然众人',
          '受人尊敬': '百姓念其好，口碑甚佳，当他是仗义之人',
          '万众敬仰': '万民拥戴，所到之处百姓夹道，被奉若再生父母'
        },
        shadow: {
          '天怒人怨': '江湖人人喊打，黑市报他名字就有人想动手',
          '声名狼藉': '草莽看不起他，当成欺软怕硬的怂货，没人愿与之共事',
          '默默无闻': '道上没人认得他，江湖查无此人',
          '受人尊敬': '江湖上有几分名头，道上的人敬他三分有种',
          '万众敬仰': '草莽奉为豪杰，一句话能调动一方江湖人马'
        },
        circuit: {
          '天怒人怨': '同行视为行业败类，被逐出圈子，人人喊打',
          '声名狼藉': '同道鄙其手艺与人品，背了砸招牌、卖同行的名声',
          '默默无闻': '行当里没人知道这号人',
          '受人尊敬': '同行敬重其技艺与德行，是行里数得上的人物',
          '万众敬仰': '被尊为一代宗师，同道奉其为标杆'
        }
      }
    },

    factions: {
      statuses: ['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解'],
      statusVerdicts: {
        '鼎盛': '钱粮充裕、人手鼎盛，内部上下一心、铁板一块，行事带着不容置疑的底气与排场',
        '稳固': '运转如常、根基稳健，无明显内忧外患，按部就班地推进既定事务',
        '倾轧': '架子还撑着，内里却派系倾轧、核心不和，许多决策都因内斗而迟滞、自相掣肘',
        '困顿': '资源枯竭或被外部封锁，正咬牙硬撑，处处捉襟见肘，经不起再受打击',
        '衰落': '已失去关键支柱、地盘或核心人物，人心浮动、节节败退，正一步步滑向瓦解',
        '瓦解': '名存实亡、只剩空架子，号令难出、众叛亲离，随时可能彻底散伙'
      },
      relations: ['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇'],
      relationVerdicts: {
        '血盟': '与{{user}}生死与共、绝对信任，会不惜代价相助，视其安危如自身存亡',
        '盟友': '与{{user}}地位平等、互为奥援，在共同利益上主动支援、共享情报，但各有底线',
        '友好': '认可{{user}}，愿意优先合作、行个方便、释放善意，尚未到结盟交心的地步',
        '中立': '对{{user}}不亲不疏，一切按自身利害行事，无既定立场',
        '冷淡': '已注意到{{user}}但兴致缺缺，保持距离、不愿深交，暂无主动行动的打算',
        '敌对': '与{{user}}公开对立，会在明处施压、阻挠、为难，乃至寻机正面冲突',
        '世仇': '与{{user}}不死不休，必欲除之而后快，会不择手段、持续寻隙下死手'
      }
    },

    economy: {
      climates: ['繁荣', '平稳', '衰退', '动荡'],
      climateVerdicts: {
        '繁荣': '市面繁盛，商路通畅、百业兴旺，钱货流转顺畅，物价稳中偏高',
        '平稳': '市面如常，物价随时节自然起落，没有大的波动',
        '衰退': '市面萧条，需求萎缩、商号接连倒闭，少数刚需之物反而紧俏涨价',
        '动荡': '经济秩序濒临崩坏，物价失控、商路受阻，人心惶惶，以物易物回潮'
      }
    },

    regionalIncidents: {
      chance: 0.03,
      durationRounds: 5,
      cooldownRounds: 5,
      types: [
        { type: 'banditry',       label: '盗匪劫掠',     weight: 18, guide: '山贼路匪劫道，截断商路或劫掠村镇，过路行人被洗劫，村庄被烧毁，镖局商队蒙受重大损失，官府可能出兵清剿或张贴悬赏' },
        { type: 'fire',           label: '大火',         weight: 14, guide: '天干物燥引发大火，可能烧毁粮仓、民居或城市街区，百姓流离失所，物资紧缺，城中人心惶惶，各方势力趁火打劫或出手相救' },
        { type: 'massacre',       label: '恶性凶案',     weight: 10, guide: '发生骇人听闻的命案，可能是仇杀、灭门或连环凶案，人心恐慌，官府严查，江湖中人互相猜忌，各方势力被卷入漩涡' },
        { type: 'flood',          label: '洪涝',         weight: 10, guide: '暴雨连绵或河堤决口，引发洪灾，农田被淹、村庄被毁，灾民涌入城镇求生，粮价飙升，疫病随之而来，赈灾与趁乱并存' },
        { type: 'infrastructure', label: '道路水利崩坏', weight: 10, guide: '桥梁断裂、官道塌方或水渠淤塞，交通与灌溉中断，商路改道，物资运输受阻，沿线百姓苦不堪言，修缮工程牵动各方利益' },
        { type: 'plague',         label: '疫病',         weight: 9,  guide: '瘟疫爆发，病者日增，城镇封锁隔离，药材价格暴涨，庸医横行，百姓恐慌逃散，官府与民间医者竭力应对，谣言四起' },
        { type: 'famine',         label: '饥荒粮荒',     weight: 8,  guide: '旱涝蝗灾导致颗粒无收，粮仓见底，百姓食不果腹，易子而食的传闻开始流传，粮商囤积居奇，官府开仓还是封仓引发激烈博弈' },
        { type: 'riot',           label: '骚乱暴动',     weight: 8,  guide: '民怨沸腾引发暴动，愤怒的人群冲击官衙粮仓，打砸抢烧，秩序崩坏，官府弹压或安抚两难，各方势力试图利用或平息动乱' },
        { type: 'rebellion',      label: '民变叛乱',     weight: 5,  guide: '有人揭竿而起、竖旗造反，聚众对抗官府，攻城略地或占山为王，朝廷调兵遣将围剿，地方豪强面临站队抉择，局势动荡不安' },
        { type: 'military',       label: '军务突变',     weight: 4,  guide: '边关告急、敌国入侵、驻军哗变或军事调动，战争阴云笼罩，征兵令下达，军资征调搅动民间，各方势力在战与和之间博弈' },
        { type: 'earthquake',     label: '地震山崩',     weight: 2,  guide: '大地震动、山体崩塌，房屋倒塌、道路断绝，死伤惨重，幸存者在废墟中挣扎求生，救援与趁乱劫掠同时上演' },
        { type: 'storm',          label: '风暴雪灾',     weight: 2,  guide: '狂风暴雪席卷而来，天寒地冻、道路封死，行旅困于途中，柴薪告罄、冻死者日增，各处据点被迫固守待援' }
      ]
    },

    termMap: {},

    customRules: '',

    engineSegments: { engineRole: '', causalSteps: '' }
  };

  // ── 2. 现代都市 ─────────────────────────────
  const MODERN = {
    id: 'modern',
    name: '现代都市',
    description: '以当代城市为背景的现代世界观，权力圈层、公众舆论、地下世界、业界同行四大声望维度，都市丛林、暗流涌动。',
    builtin: true,

    reputation: {
      dimensions: {
        authority: { name: '权力圈层', description: '在政界、执法机构等权力体系中的评价' },
        common:    { name: '公众舆论', description: '在普通市民与社交媒体中的口碑' },
        shadow:    { name: '地下世界', description: '在黑道、灰色地带与地下势力中的声望' },
        circuit:   { name: '业界同行', description: '在所属行业、职业圈子中的评价' }
      },
      levels: ['全民公敌', '臭名昭著', '籍籍无名', '广受好评', '家喻户晓'],
      verdicts: {
        authority: {
          '全民公敌': '被列入重点关注名单，多个执法部门联合追查，政界人士与其划清界限，碰他就是政治自杀',
          '臭名昭著': '在权力圈子里被视为不稳定因素，相关部门暗中监控，没有官员愿意公开与其往来',
          '籍籍无名': '权力圈层中无人知晓此人，连基层公务员都没听过这个名字',
          '广受好评': '在政商圈中颇受信任，高层愿意倾听其意见，能调动一定行政资源',
          '家喻户晓': '权力核心圈的座上宾，一个电话就能影响政策走向，各方争相拉拢'
        },
        common: {
          '全民公敌': '社交媒体上被全网声讨，人肉搜索后无处藏身，走在街上都会被人认出来骂',
          '臭名昭著': '网上口碑极差，经常被挂上热搜批判，邻居同事避之不及',
          '籍籍无名': '路人一个，搜索引擎里查不到任何相关信息，谁也不认识他',
          '广受好评': '在社区和网络上风评很好，被当作正能量代表，走到哪都有人打招呼',
          '家喻户晓': '全民偶像级别的存在，媒体争相报道，公众号召力堪比顶流明星'
        },
        shadow: {
          '全民公敌': '黑道上下都想取他人头，暗网上挂着高额悬赏，任何地下势力都不敢收留他',
          '臭名昭著': '地下世界把他当笑话和软柿子，没有组织愿意跟他合作，见面就是找茬',
          '籍籍无名': '地下世界没人听说过他，连小混混都不知道有这号人',
          '广受好评': '道上有些名头，地下势力知道他不好惹，愿意给几分薄面',
          '家喻户晓': '地下世界的传奇人物，一句话就能调动整个灰色产业链，黑白两道都要给面子'
        },
        circuit: {
          '全民公敌': '被整个行业拉黑，同行视为害群之马，行业协会公开除名，没有公司敢录用',
          '臭名昭著': '业界风评极差，被当成不守规矩、砸招牌的典型，同行私下交流时经常拿他当反面教材',
          '籍籍无名': '行业里没人知道他是谁，简历投出去石沉大海',
          '广受好评': '业内公认的实力派，同行尊重其专业能力，是行业论坛和峰会的常客',
          '家喻户晓': '行业内封神级人物，被奉为标杆和导师，一举一动都能影响行业风向'
        }
      }
    },

    factions: {
      statuses: ['全盛', '稳健', '内斗', '困境', '衰退', '解体'],
      statusVerdicts: {
        '全盛': '资金充裕、人才济济，内部高度团结、执行力极强，在业界拥有压倒性的话语权和资源优势',
        '稳健': '运营正常、财务健康，没有明显危机，按既定战略稳步推进各项业务',
        '内斗': '表面风光依旧，内部却派系林立、高层互撕，决策效率大幅下降，核心人才开始流失',
        '困境': '现金流紧张或遭遇重大外部压力，正在艰难维持运转，经不起任何意外打击',
        '衰退': '已丢失核心业务或关键人物，市场份额持续萎缩，士气低落，止损方案也难以挽回颓势',
        '解体': '名存实亡，核心团队已散，债务缠身或遭司法清算，随时可能正式宣布解散'
      },
      relations: ['铁盟', '盟友', '友好', '中立', '疏远', '敌对', '死敌'],
      relationVerdicts: {
        '铁盟': '与{{user}}是铁杆同盟、绝对互信，会倾尽资源相互支持，一荣俱荣、一损俱损',
        '盟友': '与{{user}}建立了正式合作关系，在共同利益上互通有无、协同行动，但各有保留',
        '友好': '对{{user}}印象不错，愿意优先合作、提供便利，但尚未发展到深度绑定的程度',
        '中立': '对{{user}}不偏不倚，一切以自身利害为准，没有预设立场',
        '疏远': '注意到{{user}}的存在但刻意保持距离，不愿深入接触，态度冷淡但不至于敌对',
        '敌对': '与{{user}}公开对立，会在商业、舆论等层面施压打击，不排除正面冲突',
        '死敌': '与{{user}}势不两立、你死我活，会不择手段地进行全方位打击，绝不罢休'
      }
    },

    economy: {
      climates: ['繁荣', '平稳', '衰退', '动荡'],
      climateVerdicts: {
        '繁荣': '经济景气上行，就业率高、消费旺盛，投资活跃，各行各业利润丰厚，街头商铺人满为患',
        '平稳': '经济运转如常，CPI温和波动，没有大规模裁员或倒闭潮，市民生活按部就班',
        '衰退': '经济下行压力明显，企业裁员潮涌现，消费萎缩，房价下跌，失业率攀升，市面冷清',
        '动荡': '经济秩序濒临崩溃，货币大幅贬值，银行挤兑频发，供应链断裂，物价飞涨，社会恐慌蔓延'
      }
    },

    regionalIncidents: {
      chance: 0.03,
      durationRounds: 5,
      cooldownRounds: 5,
      types: [
        { type: 'terrorism',    label: '恐怖袭击',       weight: 8,  guide: '发生恐怖袭击事件，可能是炸弹、枪击或车辆冲撞人群，造成重大伤亡，全城进入紧急状态，警方大规模搜捕，公众陷入恐慌，安保等级骤升' },
        { type: 'blackout',     label: '大规模停电',     weight: 14, guide: '电网故障导致大面积停电，交通瘫痪、电梯困人、通信中断，医院启动备用电源，超市被哄抢，城市陷入混乱，黑暗中犯罪率飙升' },
        { type: 'cyberattack',  label: '网络攻击',       weight: 12, guide: '重大网络攻击瘫痪了关键基础设施，银行系统宕机、政府网站被黑、个人数据泄露，电子支付全面中断，城市运转严重受阻' },
        { type: 'explosion',    label: '爆炸事故',       weight: 10, guide: '工业区或仓储设施发生严重爆炸，冲击波波及周边社区，有毒气体扩散，紧急疏散附近居民，消防队全力扑救，伤亡情况牵动全城' },
        { type: 'traffic',      label: '重大交通事故',   weight: 10, guide: '发生特大交通事故，可能是连环追尾、客运车辆翻覆或地铁事故，造成重大人员伤亡，相关路段长时间封锁，救援牵动全城关注' },
        { type: 'epidemic',     label: '传染病爆发',     weight: 9,  guide: '不明传染病在城市中爆发，感染人数迅速攀升，医院人满为患，政府紧急启动防疫响应，部分区域封控，口罩和药品被抢购一空' },
        { type: 'financial',    label: '金融崩盘',       weight: 8,  guide: '股市暴跌、大型金融机构爆雷，投资者血本无归，银行出现挤兑潮，大量企业资金链断裂，失业潮涌现，经济信心崩溃' },
        { type: 'protest',      label: '大规模抗议',     weight: 10, guide: '因社会不公或政策争议引发大规模抗议游行，数万人涌上街头，交通瘫痪，警民对峙，部分区域出现打砸，政府面临巨大舆论压力' },
        { type: 'gang_war',     label: '帮派火并',       weight: 8,  guide: '地下势力之间爆发大规模火并，枪击和暴力事件频发，波及无辜市民，警方全力介入扫荡，城市某些区域沦为交战区，居民不敢出门' },
        { type: 'corruption',   label: '贪腐丑闻曝光',   weight: 5,  guide: '高层人物的重大贪腐丑闻被曝光，涉案金额惊人，牵连出复杂的利益链条，媒体连续追踪报道，公众信任崩塌，多方势力急于撇清关系' },
        { type: 'earthquake',   label: '地震',           weight: 4,  guide: '城市遭遇强烈地震，建筑物倒塌、道路开裂，水电气供应中断，被困者等待救援，余震不断，全城进入应急状态' },
        { type: 'storm',        label: '极端天气',       weight: 2,  guide: '超强台风或极端暴雨袭击城市，内涝严重，道路变河，地下车库被淹，航班全部取消，数万居民紧急转移，城市功能近乎停摆' }
      ]
    },

    termMap: {
      '朝堂之上': '权力圈层',
      '市井之间': '公众舆论',
      '草莽之中': '地下世界',
      '同道之间': '业界同行',
      '天怒人怨': '全民公敌',
      '声名狼藉': '臭名昭著',
      '默默无闻': '籍籍无名',
      '受人尊敬': '广受好评',
      '万众敬仰': '家喻户晓',
      '鼎盛': '全盛',
      '稳固': '稳健',
      '倾轧': '内斗',
      '困顿': '困境',
      '衰落': '衰退',
      '瓦解': '解体',
      '血盟': '铁盟',
      '盟友': '盟友',
      '友好': '友好',
      '中立': '中立',
      '冷淡': '疏远',
      '敌对': '敌对',
      '世仇': '死敌',
      '繁荣': '繁荣',
      '平稳': '平稳',
      '衰退': '衰退',
      '动荡': '动荡',
      '盗匪劫掠': '恐怖袭击',
      '大火': '大规模停电',
      '恶性凶案': '网络攻击',
      '洪涝': '爆炸事故',
      '道路水利崩坏': '重大交通事故',
      '疫病': '传染病爆发',
      '饥荒粮荒': '金融崩盘',
      '骚乱暴动': '大规模抗议',
      '民变叛乱': '帮派火并',
      '军务突变': '贪腐丑闻曝光',
      '地震山崩': '地震',
      '风暴雪灾': '极端天气',
      '朝廷': '政府',
      '官府': '执法机构',
      '百姓': '市民',
      '江湖': '地下世界',
      '武林': '业界',
      '门派': '组织',
      '帮派': '帮派',
      '镖局': '物流公司',
      '商队': '商业团队',
      '银两': '资金',
      '粮草': '物资',
      '兵马': '人手',
      '城池': '城区',
      '村镇': '社区',
      '山寨': '据点'
    },

    customRules: '',

    engineSegments: { engineRole: '', causalSteps: '' }
  };

  // ── 3. 赛博朋克 / 科幻 ─────────────────────
  const CYBERPUNK = {
    id: 'cyberpunk',
    name: '赛博朋克/科幻',
    description: '霓虹闪烁的未来都市，巨型企业统治一切，黑客与街头浪人在暗网与底层街区挣扎求生，高科技低生活。',
    builtin: true,

    reputation: {
      dimensions: {
        authority: { name: '企业评级', description: '在巨型企业与公权机构中的信用评级' },
        common:    { name: '市民口碑', description: '在普通市民与底层社区中的口碑' },
        shadow:    { name: '暗网声望', description: '在暗网、黑市与地下组织中的声望' },
        circuit:   { name: '技术圈评价', description: '在黑客、技术人员与研发圈子中的评价' }
      },
      levels: ['头号通缉', '恶名远扬', '无人知晓', '颇有名气', '传奇人物'],
      verdicts: {
        authority: {
          '头号通缉': '被多家巨型企业联合通缉，信用评级降至最低，面部数据已录入全球监控网络，任何正规设施都会触发警报',
          '恶名远扬': '企业安全部门将其标记为高风险目标，信用评分极低，正规渠道的服务对其关闭，处处受到AI监控的重点关注',
          '无人知晓': '企业数据库中查无此人的信用记录，不在任何关注名单上，对公权系统而言如同透明人',
          '颇有名气': '在企业圈中拥有良好信用评级，能获取优质资源与服务，部分企业高管愿意与其直接对话',
          '传奇人物': '被多家巨型企业视为战略级合作伙伴，信用评级达到最高等级，在公权体系中拥有近乎无限的资源调配权'
        },
        common: {
          '头号通缉': '底层社区视其为灾星，贫民窟的居民一看到他就关门落锁，没有人敢提供庇护',
          '恶名远扬': '市民们对他避之不及，被当成危险分子和麻烦制造者，社区公告板上流传着对他的警告',
          '无人知晓': '街头无人认识，在人潮中只是又一个没有姓名的赛博朋克，不会引起任何注意',
          '颇有名气': '底层社区把他当成值得信赖的人，走在街头会有人主动打招呼，有困难时愿意向他求助',
          '传奇人物': '底层民众奉其为救世主般的存在，他的名字在贫民窟口口相传，所到之处人群自动让路致敬'
        },
        shadow: {
          '头号通缉': '暗网上他的人头悬赏金额惊人，每一个地下组织都想拿他换取利益，黑市对他关闭一切通道',
          '恶名远扬': '暗网上口碑极差，被当成不守规矩的废物，掮客和中间人拒绝为他牵线搭桥',
          '无人知晓': '暗网中查无此人的任何交易记录，没有掮客听说过这个代号',
          '颇有名气': '在暗网圈子里有一定声望，掮客愿意为他介绍高端委托，黑市给他开放特殊通道',
          '传奇人物': '暗网中封神级别的存在，一个代号就能让整个地下世界为之动摇，传说级的佣兵和黑客'
        },
        circuit: {
          '头号通缉': '技术圈视其为叛徒和毒瘤，所有开源社区和技术论坛将其永久封禁，同行恨不得将其数字身份彻底抹除',
          '恶名远扬': '技术圈鄙视其行径，被当成盗取他人成果的寄生虫，没有团队愿意与之协作',
          '无人知晓': '技术圈中没人知道这个ID，在任何论坛和社区都没有留下痕迹',
          '颇有名气': '在技术圈中被认可为有实力的专家，代码和作品被广泛引用，受邀参与核心项目',
          '传奇人物': '被尊为技术圈的神话级人物，其编写的程序或攻破的系统成为教科书案例，整个技术社区以其为标杆'
        }
      }
    },

    factions: {
      statuses: ['垄断', '运营', '内耗', '困局', '萎缩', '破产'],
      statusVerdicts: {
        '垄断': '资金充沛、技术领先，内部高度整合，在所控领域拥有近乎垄断的支配地位，行事作风强硬果决',
        '运营': '日常运转正常、现金流健康，没有重大安全事件或内部危机，按既定计划推进项目和扩张',
        '内耗': '表面运转如常，内部却派系倾轧严重，核心技术团队和管理层互相掣肘，关键项目因内斗停滞',
        '困局': '遭遇资金冻结或核心技术被窃，正在艰难维持基本运营，任何额外打击都可能致命',
        '萎缩': '已丧失核心竞争力或关键人才，市场份额被蚕食殆尽，内部人心涣散，正在不可逆转地走向消亡',
        '破产': '名存实亡，总部大楼已被查封或废弃，核心人员跑路，资产被其他企业瓜分，只剩残余代码在暗网流通'
      },
      relations: ['共生体', '合作方', '友好', '中立', '冷处理', '对抗', '歼灭令'],
      relationVerdicts: {
        '共生体': '与{{user}}形成深度共生关系，数据共享、资源互通，双方安危紧密绑定，背叛等同于自毁',
        '合作方': '与{{user}}签订了正式合作协议，在商定领域内互通情报和资源，但各自保留核心机密',
        '友好':   '对{{user}}持积极态度，愿意优先提供合作机会与信息支持，但尚未建立正式合作框架',
        '中立':   '对{{user}}不持预设立场，一切根据利益评估决定行动，既不主动支援也不刻意阻挠',
        '冷处理': '注意到{{user}}的存在但选择无视，拒绝一切接触请求，保持最大距离',
        '对抗':   '与{{user}}公开对立，会动用商业手段、网络攻击或雇佣武力进行打压，随时可能升级为武装冲突',
        '歼灭令': '对{{user}}下达了歼灭指令，动用一切可用资源——雇佣兵、AI猎杀程序、暗杀小队——不惜代价将其彻底消灭'
      }
    },

    economy: {
      climates: ['繁荣', '平稳', '衰退', '崩溃'],
      climateVerdicts: {
        '繁荣': '企业利润暴涨，新项目层出不穷，消费市场火热，底层社区也能分到一些残羹冷炙，整体氛围相对乐观',
        '平稳': '市场运转如常，企业按部就班地收割利润，物价在可控范围内波动，没有大规模的经济震荡',
        '衰退': '多家企业大规模裁员，底层失业率飙升，黑市交易反而活跃起来，合法市场萎缩严重',
        '崩溃': '经济秩序全面崩坏，数字货币剧烈波动，企业信用体系瓦解，物资依靠暴力分配，底层社区倒退回以物易物'
      }
    },

    regionalIncidents: {
      chance: 0.03,
      durationRounds: 5,
      cooldownRounds: 5,
      types: [
        { type: 'hacking',        label: '大规模数据泄露', weight: 14, guide: '某巨型企业或政府数据库遭到黑客攻破，数百万人的个人数据、生物信息和财务记录在暗网上被公开出售，受害者面临身份盗用和勒索，企业声誉崩塌' },
        { type: 'blackout',       label: '区域断电',       weight: 12, guide: '电网节点遭到攻击或过载崩溃，大范围区域陷入黑暗，电梯困人、自动驾驶车辆失控、生命维持设备告急，底层社区趁机打砸哄抢' },
        { type: 'ai_malfunction', label: 'AI系统失控',     weight: 10, guide: 'AI管理系统出现严重故障或被植入恶意代码，自动化工厂失控生产危险品、交通AI引导车辆相撞、安保机器人攻击平民，技术团队紧急介入排查' },
        { type: 'reactor',        label: '反应堆泄漏',     weight: 6,  guide: '城市供能的微型反应堆发生泄漏事故，辐射云扩散到周边居住区，居民紧急疏散，防护物资被哄抢，企业急于推卸责任' },
        { type: 'gang_war',       label: '帮派街战',       weight: 12, guide: '底层帮派之间因地盘或利益爆发大规模武装冲突，改装武器和战斗义体横行街头，波及无辜平民，企业安保部队可能介入或坐视不管' },
        { type: 'riot',           label: '贫民区暴动',     weight: 10, guide: '底层社区积压已久的不满爆发，贫民涌上街头冲击企业设施和富人区围墙，催泪弹和镇暴机器人出动，局势急剧恶化' },
        { type: 'contamination',  label: '化学污染',       weight: 8,  guide: '工业废料非法排放或化工厂事故导致大面积化学污染，空气中弥漫刺鼻气味，水源被污染，居民出现中毒症状，净化设备供不应求' },
        { type: 'cyber_plague',   label: '数字病毒蔓延',   weight: 8,  guide: '一种新型数字病毒在网络中快速传播，感染义体和神经接口导致使用者出现幻觉、失控甚至脑死亡，所有人被迫断开网络连接' },
        { type: 'drone_swarm',    label: '无人机群失控',   weight: 6,  guide: '企业或军方的无人机群控制信号被劫持或AI判断失误，大量武装无人机在城市上空盘旋攻击，防空系统被启动，市民躲入地下避难' },
        { type: 'corp_war',       label: '企业武装冲突',   weight: 6,  guide: '两家巨型企业之间的商业竞争升级为武装冲突，私人军队在城市中展开交火，重型武器被投入使用，整个街区沦为战场' },
        { type: 'earthquake',     label: '地质塌陷',       weight: 4,  guide: '过度开发的地下空间发生大规模塌陷，地面建筑倾斜倒塌，地下管网断裂，有毒气体和污水涌出，被困者在废墟中等待救援' },
        { type: 'storm',          label: '酸雨风暴',       weight: 4,  guide: '严重的酸雨风暴席卷城市，腐蚀建筑外墙和户外设备，未及时避难的人皮肤灼伤，空气过滤系统超负荷运转，户外活动全部停止' }
      ]
    },

    termMap: {
      '朝堂之上': '企业评级',
      '市井之间': '市民口碑',
      '草莽之中': '暗网声望',
      '同道之间': '技术圈评价',
      '天怒人怨': '头号通缉',
      '声名狼藉': '恶名远扬',
      '默默无闻': '无人知晓',
      '受人尊敬': '颇有名气',
      '万众敬仰': '传奇人物',
      '鼎盛': '垄断',
      '稳固': '运营',
      '倾轧': '内耗',
      '困顿': '困局',
      '衰落': '萎缩',
      '瓦解': '破产',
      '血盟': '共生体',
      '盟友': '合作方',
      '友好': '友好',
      '中立': '中立',
      '冷淡': '冷处理',
      '敌对': '对抗',
      '世仇': '歼灭令',
      '繁荣': '繁荣',
      '平稳': '平稳',
      '衰退': '衰退',
      '动荡': '崩溃',
      '盗匪劫掠': '大规模数据泄露',
      '大火': '区域断电',
      '恶性凶案': 'AI系统失控',
      '洪涝': '反应堆泄漏',
      '道路水利崩坏': '帮派街战',
      '疫病': '贫民区暴动',
      '饥荒粮荒': '化学污染',
      '骚乱暴动': '数字病毒蔓延',
      '民变叛乱': '无人机群失控',
      '军务突变': '企业武装冲突',
      '地震山崩': '地质塌陷',
      '风暴雪灾': '酸雨风暴',
      '朝廷': '巨型企业',
      '官府': '企业安保',
      '百姓': '市民',
      '江湖': '暗网',
      '武林': '技术圈',
      '门派': '企业',
      '帮派': '帮派',
      '镖局': '物流企业',
      '商队': '商业团队',
      '银两': '信用点',
      '粮草': '物资',
      '兵马': '武装力量',
      '城池': '城区',
      '村镇': '底层社区',
      '山寨': '据点'
    },

    customRules: '',

    engineSegments: { engineRole: '', causalSteps: '' }
  };

  // ── 4. 西方奇幻 ─────────────────────────────
  const WESTERN_FANTASY = {
    id: 'western_fantasy',
    name: '西方奇幻',
    description: '剑与魔法的大陆，王国与公会并立，魔物横行、巨龙盘踞，勇者与法师在冒险中书写传奇。',
    builtin: true,

    reputation: {
      dimensions: {
        authority: { name: '王廷之上', description: '在王室、贵族与骑士团等权力体系中的声望' },
        common:    { name: '平民之间', description: '在普通平民、农夫与城镇居民中的口碑' },
        shadow:    { name: '暗影之中', description: '在盗贼公会、黑市与地下势力中的名声' },
        circuit:   { name: '行会之间', description: '在冒险者行会、法师塔与各类职业公会中的评价' }
      },
      levels: ['千夫所指', '声名狼藉', '默默无闻', '受人敬重', '名震大陆'],
      verdicts: {
        authority: {
          '千夫所指': '王廷已发出通缉令，骑士团奉命追捕，所有城门悬挂其画像，贵族们视其为王国的叛徒和毒瘤',
          '声名狼藉': '在王廷中声名扫地，被贵族当成危险的不稳定因素，没有领主愿意为其提供庇护或雇佣',
          '默默无闻': '王廷中无人知晓此人的名字，对贵族而言只是芸芸众生中的一粒微尘',
          '受人敬重': '在王廷中颇有声望，贵族们愿意倾听其建言，部分领主主动示好寻求合作',
          '名震大陆': '深受王室信赖，被封为王国柱石，在议事厅中一言九鼎，各国使节争相拜会'
        },
        common: {
          '千夫所指': '平民恨之入骨，走到哪里都会被投掷烂菜叶和石块，母亲用他的名字吓唬哭闹的孩子',
          '声名狼藉': '平民视其为不祥之人，酒馆拒绝他入内，商贩不愿与其交易，街上的人见了纷纷绕道',
          '默默无闻': '在平民中毫无知名度，只是路过城镇的普通旅人，不会引起任何人的注意',
          '受人敬重': '平民视其为仁义之士，酒馆中常有人传唱他的事迹，走在街上会有人主动鞠躬致意',
          '名震大陆': '被平民奉若英雄，吟游诗人传唱其传奇，所到之处万人空巷，孩子们争相模仿其冒险事迹'
        },
        shadow: {
          '千夫所指': '地下世界对其发出了公开猎杀令，盗贼公会悬赏其项上人头，任何黑市门路对他都已关闭',
          '声名狼藉': '在暗影中被当成不可信赖的蠢货，盗贼公会鄙视他，黑市掮客拒绝与其交易',
          '默默无闻': '在暗影世界中查无此人的记录，没有任何地下组织听说过这个名字',
          '受人敬重': '在地下世界有一定名号，盗贼公会认可其手段，黑市愿意为他打开特殊通道',
          '名震大陆': '暗影世界的传奇，盗贼公会奉其为暗夜之王，一个暗号就能调动整个地下网络为其效力'
        },
        circuit: {
          '千夫所指': '各大行会联合将其除名，冒险者公会拒绝其一切委托，法师塔将其列入禁止往来名单',
          '声名狼藉': '在行会中风评极差，被当成败坏行规的害群之马，没有团队愿意接纳他同行冒险',
          '默默无闻': '行会的公告板上找不到他的任何冒险记录，对同行而言是一个完全陌生的名字',
          '受人敬重': '在行会中被公认为实力出众的冒险者，同行敬重其技艺与品行，经常被推荐参与高难度委托',
          '名震大陆': '被尊为传奇冒险者，行会为其设立专属席位，新手冒险者以其为榜样，其冒险经历被编入行会教材'
        }
      }
    },

    factions: {
      statuses: ['鼎盛', '稳固', '纷争', '困顿', '衰落', '覆灭'],
      statusVerdicts: {
        '鼎盛': '兵强马壮、金库充盈，内部团结一致如同铁桶，领地繁荣昌盛，在大陆上声威赫赫',
        '稳固': '运转有序、根基稳健，领地安宁无大患，按既定方针稳步发展壮大势力',
        '纷争': '表面维持着秩序，内部却派系对立、明争暗斗，重要决策因内讧而迟缓，核心成员相互猜忌',
        '困顿': '遭受重大打击或资源断绝，正在咬牙苦撑，兵员不足、物资匮乏，再有变故便可能崩溃',
        '衰落': '已失去关键要塞或核心人物，士气低落、逃兵日增，领地不断被蚕食，正走向覆灭的边缘',
        '覆灭': '已经名存实亡，城堡化为废墟、旗帜倒地，残余势力四散逃亡，辉煌不再只余传说'
      },
      relations: ['誓盟', '同盟', '友善', '中立', '冷淡', '敌对', '死仇'],
      relationVerdicts: {
        '誓盟': '与{{user}}缔结了神圣誓约，以诸神为证同生共死，会不惜一切代价相助，背叛等同于受诸神诅咒',
        '同盟': '与{{user}}建立了正式同盟关系，在共同的敌人面前并肩作战、互通情报，但各自保有底线',
        '友善': '对{{user}}持有好感，愿意在交易和冒险中优先合作、提供善意支持，但尚未缔结正式盟约',
        '中立': '对{{user}}不偏不倚，一切以自身利益为准则行事，不主动为敌也不主动为友',
        '冷淡': '对{{user}}态度冷漠，刻意保持距离，拒绝深入往来，但不至于主动发起敌对行动',
        '敌对': '与{{user}}公开为敌，会在领地边境施压、阻挠其行动，不排除发动军事冲突',
        '死仇': '与{{user}}结下不死不休的血仇，会倾尽全力追杀、围剿，不达目的誓不罢休'
      }
    },

    economy: {
      climates: ['繁荣', '平稳', '萧条', '动荡'],
      climateVerdicts: {
        '繁荣': '商路畅通、集市繁华，各地物产丰富，金币流转顺畅，冒险者的委托报酬水涨船高',
        '平稳': '市场运转如常，物价随季节自然起伏，商人们按部就班地经营生意，没有大的波动',
        '萧条': '战乱或灾荒导致市场萎缩，商队减少、店铺歇业，基本物资开始短缺涨价，平民苦不堪言',
        '动荡': '经济秩序濒临崩坏，货币贬值严重，商路被匪盗截断，集市关闭，人们重新回到以物易物的蛮荒时代'
      }
    },

    regionalIncidents: {
      chance: 0.03,
      durationRounds: 5,
      cooldownRounds: 5,
      types: [
        { type: 'monster',      label: '魔物入侵',       weight: 14, guide: '大量魔物从荒野涌入人类领地，袭击村庄和商队，冒险者公会紧急发布讨伐委托，守备队在城墙上严阵以待，平民逃入城中避难' },
        { type: 'banditry',     label: '盗贼劫掠',       weight: 12, guide: '盗贼团伙大肆劫掠商路和村庄，烧杀抢掠，旅人不敢上路，领主派出骑士巡逻但收效甚微，悬赏金不断提高' },
        { type: 'plague',       label: '瘟疫蔓延',       weight: 10, guide: '不明瘟疫在城镇中蔓延，感染者日增，草药和治愈法术供不应求，神殿的治疗师筋疲力尽，部分区域被隔离封锁' },
        { type: 'dark_ritual',  label: '黑暗仪式',       weight: 8,  guide: '邪教徒在暗处举行黑暗仪式，企图召唤恶魔或释放封印中的远古邪恶，诡异的魔力波动在夜间扩散，居民噩梦连连、家畜暴毙' },
        { type: 'dragon',       label: '巨龙袭击',       weight: 4,  guide: '一头巨龙从沉睡中苏醒，盘踞在山巅向周边领地喷吐烈焰，城镇被烧毁，勇士们组队讨伐但伤亡惨重，领主悬赏天文数字求人屠龙' },
        { type: 'undead',       label: '亡灵潮',         weight: 8,  guide: '死灵法师的力量搅动了安息者的灵魂，大量亡灵从墓地和古战场涌出，骷髅兵和幽灵侵袭村镇，神殿的祭司全力施展驱散术' },
        { type: 'famine',       label: '饥荒',           weight: 10, guide: '天灾或战祸导致庄稼颗粒无收，粮仓见底，饥民四处流浪乞食，粮商趁机囤积居奇，饿殍遍地的惨状引发社会动荡' },
        { type: 'revolt',       label: '农民起义',       weight: 8,  guide: '不堪重税和压迫的农民揭竿而起，手持农具的起义军攻占领主庄园，贵族仓皇出逃，各方势力在镇压与支持之间抉择' },
        { type: 'cursed_land',  label: '诅咒之地扩散',   weight: 6,  guide: '被诅咒的土地在不断扩张，植物枯萎变异、动物发狂攻击人类，进入其中的人精神错乱，法师团体紧急研究净化之法' },
        { type: 'portal',       label: '异界裂隙',       weight: 4,  guide: '空间结构出现裂缝，通往异界的裂隙在大地上撕开，奇异的生物从中涌出，扭曲的魔力污染周围环境，法师塔全力研究封印方法' },
        { type: 'earthquake',   label: '地震',           weight: 4,  guide: '大地剧烈震动，城堡坍塌、道路断裂，矿洞崩塌困住矿工，山体滑坡掩埋村庄，幸存者在废墟中艰难求生' },
        { type: 'blizzard',     label: '暴风雪',         weight: 6,  guide: '猛烈的暴风雪席卷大地，大雪封山断路，旅人冻死在途中，柴薪和粮食告急，城镇被迫紧闭城门等待风雪消散' }
      ]
    },

    termMap: {
      '朝堂之上': '王廷之上',
      '市井之间': '平民之间',
      '草莽之中': '暗影之中',
      '同道之间': '行会之间',
      '天怒人怨': '千夫所指',
      '声名狼藉': '声名狼藉',
      '默默无闻': '默默无闻',
      '受人尊敬': '受人敬重',
      '万众敬仰': '名震大陆',
      '鼎盛': '鼎盛',
      '稳固': '稳固',
      '倾轧': '纷争',
      '困顿': '困顿',
      '衰落': '衰落',
      '瓦解': '覆灭',
      '血盟': '誓盟',
      '盟友': '同盟',
      '友好': '友善',
      '中立': '中立',
      '冷淡': '冷淡',
      '敌对': '敌对',
      '世仇': '死仇',
      '繁荣': '繁荣',
      '平稳': '平稳',
      '衰退': '萧条',
      '动荡': '动荡',
      '盗匪劫掠': '魔物入侵',
      '大火': '盗贼劫掠',
      '恶性凶案': '瘟疫蔓延',
      '洪涝': '黑暗仪式',
      '道路水利崩坏': '巨龙袭击',
      '疫病': '亡灵潮',
      '饥荒粮荒': '饥荒',
      '骚乱暴动': '农民起义',
      '民变叛乱': '诅咒之地扩散',
      '军务突变': '异界裂隙',
      '地震山崩': '地震',
      '风暴雪灾': '暴风雪',
      '朝廷': '王廷',
      '官府': '领主',
      '百姓': '平民',
      '江湖': '暗影世界',
      '武林': '行会',
      '门派': '骑士团',
      '帮派': '盗贼公会',
      '镖局': '商队护卫',
      '商队': '商队',
      '银两': '金币',
      '粮草': '物资',
      '兵马': '兵力',
      '城池': '城堡',
      '村镇': '村庄',
      '山寨': '据点'
    },

    customRules: '',

    engineSegments: { engineRole: '', causalSteps: '' }
  };

  // ── 5. 末日废土 ─────────────────────────────
  const POST_APOCALYPTIC = {
    id: 'post_apocalyptic',
    name: '末日废土',
    description: '文明崩塌后的荒芜世界，辐射遍地、变异横行，幸存者在废墟中挣扎求生，物资就是一切。',
    builtin: true,

    reputation: {
      dimensions: {
        authority: { name: '据点评价', description: '在主要幸存者据点与管理层中的评价' },
        common:    { name: '幸存者口碑', description: '在普通幸存者和流民中的口碑' },
        shadow:    { name: '拾荒者圈', description: '在拾荒者、走私客与黑市交易者中的名声' },
        circuit:   { name: '同行评价', description: '在同类职业者（猎人、机械师、医生等）中的评价' }
      },
      levels: ['人人喊杀', '避之不及', '查无此人', '值得信赖', '废土传奇'],
      verdicts: {
        authority: {
          '人人喊杀': '各大据点联合发布格杀令，守卫见其即开枪射击，任何收留他的人都会被逐出据点',
          '避之不及': '据点管理层将其列入黑名单，禁止入内交易或补给，被当成危险的不稳定分子',
          '查无此人': '据点的登记簿上查无此人的记录，管理层对他毫无印象，只是又一个路过的无名流浪者',
          '值得信赖': '在据点中享有良好信誉，管理层信任其能力和人品，愿意委以重要任务和优先交易权',
          '废土传奇': '被各大据点奉为守护者级别的存在，管理层以最高规格接待，其意见直接影响据点重大决策'
        },
        common: {
          '人人喊杀': '幸存者们视其为人渣败类，提起他就咬牙切齿，有人见到他就会自发组织围攻',
          '避之不及': '在幸存者中口碑极差，被当成招灾惹祸的瘟神，营地里的人看到他就赶紧把孩子拉进屋',
          '查无此人': '没有幸存者听说过他的名字，在废土上只是一个不起眼的孤独身影',
          '值得信赖': '幸存者们信赖他，愿意与他分享物资和情报，营地中有人主动为他留出位置和口粮',
          '废土传奇': '幸存者们口口相传他的事迹，被奉为废土上的希望之光，他出现的地方人们就觉得安心'
        },
        shadow: {
          '人人喊杀': '拾荒者圈子对他恨之入骨，黑市挂出了天价悬赏，所有走私通道对他永久关闭',
          '避之不及': '拾荒者们不屑与其为伍，被当成出卖同行的叛徒，黑市拒绝和他做任何交易',
          '查无此人': '拾荒者圈子里没人听说过这个人，黑市交易记录中找不到任何痕迹',
          '值得信赖': '在拾荒者圈中有几分名头，黑市愿意给他开放优质货源，走私客乐意带他一程',
          '废土传奇': '拾荒者圈的神话级人物，传说他能在最危险的废墟中全身而退，黑市为他准备最好的货品'
        },
        circuit: {
          '人人喊杀': '同行们联合抵制他，视其为行业的耻辱和威胁，有人放话要亲手解决他',
          '避之不及': '同行鄙视其行事作风，认为他败坏了整个行当的规矩，没有人愿意与其搭档',
          '查无此人': '同行中没有人知道他的名号，在相关圈子里毫无存在感',
          '值得信赖': '同行认可其专业能力和职业操守，是值得信赖的搭档，遇到高难度任务会第一时间想到他',
          '废土传奇': '被同行尊为业内传奇，其技艺和事迹成为后辈学习的典范，一句话就能召集整个圈子的精英'
        }
      }
    },

    factions: {
      statuses: ['全盛', '稳固', '内讧', '挣扎', '衰败', '覆灭'],
      statusVerdicts: {
        '全盛': '物资充沛、人手充足，据点防御工事固若金汤，内部秩序井然，在废土上是令人敬畏的强大势力',
        '稳固': '日常运转正常、物资储备够用，没有迫在眉睫的威胁，按既定计划组织搜索和防御',
        '内讧': '表面还维持着秩序，内部却因物资分配或领导权爆发激烈争斗，成员互相猜忌，随时可能分裂',
        '挣扎': '物资告急或遭受重创，正在咬牙苦撑，每一顿饭每一颗子弹都要精打细算，再有打击就撑不住了',
        '衰败': '已失去关键据点或核心成员，人心涣散、成员出逃，领地不断被蚕食，正加速走向终结',
        '覆灭': '据点已被攻破或废弃，成员死散殆尽，只剩断壁残垣和零星的幸存者在废墟中游荡'
      },
      relations: ['生死之交', '盟友', '友好', '中立', '警惕', '敌对', '不死不休'],
      relationVerdicts: {
        '生死之交': '与{{user}}是过命的交情、绝对信任，会把最后一颗子弹和最后一口水留给对方，共同进退',
        '盟友':     '与{{user}}建立了互助协议，在物资交换和防御上互相支援，但各自保留核心资源',
        '友好':     '对{{user}}态度友善，愿意在交易中给出公道价、分享非核心情报，但尚未达到深度互信',
        '中立':     '对{{user}}既不亲近也不排斥，一切以自身生存利益为准则，无预设立场',
        '警惕':     '对{{user}}保持高度警惕，虽未主动敌对但严密监视其一切动向，拒绝交易和接触',
        '敌对':     '与{{user}}公开为敌，会在物资争夺、领地冲突中直接动手，遭遇时即刻交火',
        '不死不休': '与{{user}}结下血海深仇，发誓将其彻底消灭，会主动发起突袭和追杀，不惜付出重大代价'
      }
    },

    economy: {
      climates: ['丰裕', '勉强维持', '匮乏', '崩溃'],
      climateVerdicts: {
        '丰裕': '物资相对充裕，搜索队频频满载而归，交易市场货品齐全，据点居民不必为温饱发愁',
        '勉强维持': '物资供应紧巴巴地维持着，口粮定量配给，虽不富裕但尚可度日，意外损失可能打破平衡',
        '匮乏': '物资严重不足，食物和净水开始定量限制，药品弹药奇缺，为争夺有限资源的冲突日益频繁',
        '崩溃': '物资供应体系彻底崩溃，据点口粮耗尽，净水来源被污染，人们为一罐食物不惜杀人，弱肉强食成为唯一法则'
      }
    },

    regionalIncidents: {
      chance: 0.03,
      durationRounds: 5,
      cooldownRounds: 5,
      types: [
        { type: 'mutant_horde',      label: '变异兽潮',   weight: 16, guide: '大批变异生物从荒野深处涌来，成群结队地冲击据点围墙，守卫拼死抵抗，弹药消耗巨大，部分防线被突破后引发恐慌' },
        { type: 'raider',            label: '掠夺者袭击', weight: 14, guide: '武装掠夺者团伙发起大规模袭击，火力猛烈地攻打据点或截杀外出搜索队，烧杀抢掠后扬长而去，留下满目疮痍' },
        { type: 'radiation',         label: '辐射风暴',   weight: 10, guide: '一场强烈的辐射风暴席卷而来，盖格计数器疯狂作响，所有人被迫躲入地下掩体，暴露在外的物资和作物被辐射污染' },
        { type: 'contamination',     label: '水源污染',   weight: 10, guide: '据点赖以生存的水源被污染——可能是化学残留、辐射泄漏或有人蓄意投毒，饮用者出现中毒症状，净水设备不堪重负' },
        { type: 'plague',            label: '变异瘟疫',   weight: 8,  guide: '一种由辐射催生的变异病原体在幸存者中传播，感染者出现恐怖的身体变异，药品短缺导致无法有效治疗，据点面临隔离或弃守的抉择' },
        { type: 'famine',            label: '食物短缺',   weight: 10, guide: '连续的搜索行动颗粒无收，库存粮食见底，定量口粮一减再减，饥饿的居民开始偷盗和打斗，据点秩序岌岌可危' },
        { type: 'sandstorm',         label: '沙尘暴',     weight: 8,  guide: '铺天盖地的沙尘暴席卷废土，能见度降为零，户外行动完全停止，建筑被沙尘侵蚀，通讯设备失灵，困在外面的搜索队生死未卜' },
        { type: 'structure_collapse', label: '建筑坍塌',   weight: 8,  guide: '年久失修的废墟建筑突然大面积坍塌，正在其中搜索物资的人被埋，救援行动危险重重，周围建筑也随时可能跟着倒下' },
        { type: 'bandit',            label: '流匪劫道',   weight: 6,  guide: '零散的流匪在据点周边设伏劫道，袭击落单的搜索者和小型商队，虽然规模不大但防不胜防，外出行动的风险大增' },
        { type: 'power_failure',     label: '能源枯竭',   weight: 4,  guide: '据点的发电设备故障或燃料耗尽，照明、净水和通讯系统全部停摆，黑暗中据点防御能力骤降，寻找替代能源成为当务之急' },
        { type: 'earthquake',        label: '余震',       weight: 4,  guide: '一次强烈余震袭来，本就摇摇欲坠的废墟进一步崩塌，地裂吞没道路，地下管道破裂释放有毒气体，幸存者在废墟中挣扎' },
        { type: 'acid_rain',         label: '酸雨',       weight: 2,  guide: '有毒的酸雨倾盆而下，腐蚀一切暴露在外的金属和皮肤，作物被毁、积蓄的雨水无法饮用，外出活动必须穿戴全套防护装备' }
      ]
    },

    termMap: {
      '朝堂之上': '据点评价',
      '市井之间': '幸存者口碑',
      '草莽之中': '拾荒者圈',
      '同道之间': '同行评价',
      '天怒人怨': '人人喊杀',
      '声名狼藉': '避之不及',
      '默默无闻': '查无此人',
      '受人尊敬': '值得信赖',
      '万众敬仰': '废土传奇',
      '鼎盛': '全盛',
      '稳固': '稳固',
      '倾轧': '内讧',
      '困顿': '挣扎',
      '衰落': '衰败',
      '瓦解': '覆灭',
      '血盟': '生死之交',
      '盟友': '盟友',
      '友好': '友好',
      '中立': '中立',
      '冷淡': '警惕',
      '敌对': '敌对',
      '世仇': '不死不休',
      '繁荣': '丰裕',
      '平稳': '勉强维持',
      '衰退': '匮乏',
      '动荡': '崩溃',
      '盗匪劫掠': '变异兽潮',
      '大火': '掠夺者袭击',
      '恶性凶案': '辐射风暴',
      '洪涝': '水源污染',
      '道路水利崩坏': '变异瘟疫',
      '疫病': '食物短缺',
      '饥荒粮荒': '沙尘暴',
      '骚乱暴动': '建筑坍塌',
      '民变叛乱': '流匪劫道',
      '军务突变': '能源枯竭',
      '地震山崩': '余震',
      '风暴雪灾': '酸雨',
      '朝廷': '据点管理层',
      '官府': '据点守卫',
      '百姓': '幸存者',
      '江湖': '拾荒者圈',
      '武林': '同行',
      '门派': '据点',
      '帮派': '掠夺者团伙',
      '镖局': '护送队',
      '商队': '搜索队',
      '银两': '物资',
      '粮草': '口粮',
      '兵马': '武装人手',
      '城池': '据点',
      '村镇': '营地',
      '山寨': '藏身处'
    },

    customRules: '',

    engineSegments: { engineRole: '', causalSteps: '' }
  };

  // ═════════════════════════════════════════════
  //  BUILT-IN PRESET REGISTRY
  // ═════════════════════════════════════════════
  const BUILTIN_PRESETS = [
    ANCIENT_CHINESE,
    MODERN,
    CYBERPUNK,
    WESTERN_FANTASY,
    POST_APOCALYPTIC
  ];

  // Build a quick-lookup map for built-in presets
  const builtinMap = {};
  BUILTIN_PRESETS.forEach(function (p) {
    builtinMap[p.id] = p;
  });

  // Canonical backend labels stay stable. Presets may change display wording through
  // termMap and editor metadata, but the evolution JSON schema keeps these values.
  const INTERNAL_SCHEMA = {
    reputationLevels: ['天怒人怨', '声名狼藉', '默默无闻', '受人尊敬', '万众敬仰'],
    factionStatuses: ['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解'],
    factionRelations: ['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇'],
    economyClimates: ['繁荣', '平稳', '衰退', '动荡']
  };

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeText(value, fallback) {
    var text = value == null ? '' : String(value).trim();
    return text || fallback || '';
  }

  // 字段名安全检查：允许中文(不建议但兼容)，仅拒绝会破坏 prompt/JSON 的字符
  function isSafeFieldName(name) {
    return !!name && !/[\u0000-\u001f"\\]/.test(name);
  }

  function normalizeStringArray(value, fallback) {
    var arr = Array.isArray(value)
      ? value.map(function (item) { return normalizeText(item, ''); }).filter(Boolean)
      : [];
    return arr.length ? arr : deepClone(fallback || []);
  }

  function normalizeStringMap(value, fallback) {
    var result = {};
    var source = isPlainObject(value) ? value : null;
    if (source) {
      Object.keys(source).forEach(function (key) {
        var safeKey = normalizeText(key, '');
        if (!safeKey) return;
        result[safeKey] = normalizeText(source[key], '');
      });
    }
    if (Object.keys(result).length) return result;
    return deepClone(fallback || {});
  }

  const VERDICT_CONFIGS = {
    reputation: {
      axes: ['authority', 'common', 'shadow', 'circuit'],
      levels: INTERNAL_SCHEMA.reputationLevels
    },
    factionStatus: {
      axes: ['status'],
      levels: INTERNAL_SCHEMA.factionStatuses
    },
    factionRelation: {
      axes: ['relation'],
      levels: INTERNAL_SCHEMA.factionRelations
    },
    economyClimate: {
      axes: ['climate'],
      levels: INTERNAL_SCHEMA.economyClimates
    }
  };

  const VerdictEngine = {
    getLevels(config, axis) {
      if (Array.isArray(config.levels)) return config.levels;
      return (config.levels && config.levels[axis]) || [];
    },

    normalizeAxis(config, axis, value, fallback, termMap) {
      var result = {};
      var source = isPlainObject(value) ? value : {};
      var levels = VerdictEngine.getLevels(config, axis);
      levels.forEach(function (level) {
        var displayKey = termMap && termMap[level];
        var text = source[level];
        if ((text == null || text === '') && displayKey) text = source[displayKey];
        result[level] = normalizeText(text, fallback && fallback[level] || '');
      });
      return result;
    },

    normalizeAxes(config, value, fallback, termMap) {
      var result = {};
      var source = isPlainObject(value) ? value : {};
      (config.axes || []).forEach(function (axis) {
        result[axis] = VerdictEngine.normalizeAxis(
          config,
          axis,
          source[axis],
          fallback && fallback[axis],
          termMap
        );
      });
      return result;
    },

    normalizeSingleAxis(config, value, fallback, termMap) {
      var axis = (config.axes && config.axes[0]) || 'value';
      return VerdictEngine.normalizeAxis(config, axis, value, fallback, termMap);
    },

    getText(config, verdicts, axis, level, fallback) {
      var levels = VerdictEngine.getLevels(config, axis);
      if (levels.indexOf(level) === -1) return fallback || '';
      var scoped = verdicts && verdicts[axis] ? verdicts[axis] : verdicts;
      return normalizeText(scoped && scoped[level], fallback || '');
    }
  };

  function normalizeVerdicts(value, fallback) {
    return isPlainObject(value) ? deepClone(value) : deepClone(fallback || {});
  }

  function normalizeKeyedVerdicts(value, keys, fallback, termMap) {
    return VerdictEngine.normalizeSingleAxis({ axes: ['value'], levels: keys }, value, fallback, termMap);
  }

  function normalizeReputationVerdicts(value, fallback, termMap) {
    return VerdictEngine.normalizeAxes(VERDICT_CONFIGS.reputation, value, fallback, termMap);
  }

  function normalizeDimensions(value, fallback) {
    var result = {};
    var source = isPlainObject(value) ? value : {};
    Object.keys(fallback || {}).forEach(function (key) {
      var raw = isPlainObject(source[key]) ? source[key] : {};
      var fb = fallback[key] || {};
      result[key] = {
        name: normalizeText(raw.name, fb.name || key),
        description: normalizeText(raw.description, fb.description || '')
      };
    });
    return result;
  }

  function normalizeIncidentTypes(value, fallback) {
    var source = Array.isArray(value) ? value : [];
    var result = source.map(function (item) {
      if (!isPlainObject(item)) return null;
      var type = normalizeText(item.type, '');
      var label = normalizeText(item.label, type);
      var weight = Number(item.weight);
      if (!type || !Number.isFinite(weight) || weight <= 0) return null;
      return {
        type: type,
        label: label,
        weight: weight,
        guide: normalizeText(item.guide, '')
      };
    }).filter(Boolean);
    return result.length ? result : deepClone(fallback || []);
  }

  function normalizeSchemaFieldSpec(value) {
    if (!isPlainObject(value)) return null;
    var result = {
      type: normalizeText(value.type, 'string'),
      description: normalizeText(value.description || value.desc, '')
    };
    if (value.label != null) result.label = normalizeText(value.label, '');
    if (Object.prototype.hasOwnProperty.call(value, 'display')) result.display = value.display !== false;
    if (Array.isArray(value.enum)) {
      result.enum = value.enum.map(function (item) { return normalizeText(item, ''); }).filter(Boolean);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'example')) result.example = deepClone(value.example);
    if (isPlainObject(value.itemFields)) {
      var itemFields = normalizeSchemaFieldMap(value.itemFields);
      if (Object.keys(itemFields).length) result.itemFields = itemFields;
    }
    return result;
  }

  function normalizeSchemaFieldMap(value) {
    var result = {};
    if (!isPlainObject(value)) return result;
    Object.keys(value).forEach(function (fieldName) {
      var safeName = normalizeText(fieldName, '');
      if (!safeName || !isSafeFieldName(safeName)) return;
      var spec = normalizeSchemaFieldSpec(value[fieldName]);
      if (spec) result[safeName] = spec;
    });
    return result;
  }

  function normalizeSchemaOverrides(value) {
    var result = {};
    if (!isPlainObject(value)) return result;
    Object.keys(value).forEach(function (moduleId) {
      var safeModuleId = normalizeText(moduleId, '');
      var raw = value[moduleId];
      if (!safeModuleId || !isPlainObject(raw)) return;
      var entry = {};
      if (raw.title != null) entry.title = normalizeText(raw.title, '');
      if (raw.description != null) entry.description = normalizeText(raw.description, '');
      if (Array.isArray(raw.hiddenFields)) {
        entry.hiddenFields = raw.hiddenFields.map(function (field) { return normalizeText(field, ''); }).filter(Boolean);
      }
      var fields = normalizeSchemaFieldMap(raw.fields);
      var addFields = normalizeSchemaFieldMap(raw.addFields);
      var overrideFields = normalizeSchemaFieldMap(raw.overrideFields);
      if (Object.keys(fields).length) entry.fields = fields;
      if (Object.keys(addFields).length) entry.addFields = addFields;
      if (Object.keys(overrideFields).length) entry.overrideFields = overrideFields;
      if (Object.keys(entry).length) result[safeModuleId] = entry;
    });
    return result;
  }
  var KNOWN_SCHEMA_TYPES = ['string', 'number', 'boolean', 'enum', 'array<string>', 'object', 'array<object>'];

  // 校验 schemaOverrides 形状，返回告警字符串数组（不抛错，不阻断导入）
  function validateSchemaOverrides(raw) {
    var warnings = [];
    if (raw == null) return warnings;
    if (!isPlainObject(raw)) { warnings.push('schemaOverrides 不是对象，已忽略'); return warnings; }
    Object.keys(raw).forEach(function (moduleId) {
      var mod = raw[moduleId];
      if (!isPlainObject(mod)) { warnings.push('模块「' + moduleId + '」的结构覆盖不是对象，已忽略'); return; }
      ['fields', 'addFields', 'overrideFields'].forEach(function (bucket) {
        var fm = mod[bucket];
        if (fm === undefined) return;
        if (!isPlainObject(fm)) { warnings.push(moduleId + '.' + bucket + ' 不是对象，已忽略'); return; }
        Object.keys(fm).forEach(function (name) {
          var trimmed = normalizeText(name, '');
          if (!trimmed) { warnings.push('模块「' + moduleId + '」含空字段名，已忽略'); return; }
          if (!isSafeFieldName(trimmed)) { warnings.push('字段名「' + name + '」含非法字符，已忽略'); return; }
          if (/[^\x00-\x7F]/.test(trimmed)) warnings.push('字段名「' + trimmed + '」含非英文字符，建议改用英文');
          else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) warnings.push('字段名「' + trimmed + '」命名不规范，建议只用字母、数字、下划线');
          var spec = fm[name];
          if (isPlainObject(spec) && spec.type != null) {
            var t = String(spec.type);
            if (KNOWN_SCHEMA_TYPES.indexOf(t) === -1) warnings.push('字段「' + trimmed + '」的类型「' + t + '」非标准类型，将按文本处理');
          }
        });
      });
    });
    return warnings;
  }

  function isStrictIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value || '');
  }

  function isBuiltinModuleId(id) {
    return Array.isArray(BUILTIN_MODULE_IDS) && BUILTIN_MODULE_IDS.indexOf(id) !== -1;
  }

  function normalizeDisplayConfig(value) {
    if (!isPlainObject(value)) return null;
    var style = normalizeText(value.style, 'cards');
    if (['cards', 'table', 'keyvalue', 'list'].indexOf(style) === -1) style = 'cards';
    var result = { style: style };
    ['titleField', 'subtitleField', 'emptyText'].forEach(function (key) {
      if (value[key] != null) result[key] = normalizeText(value[key], '');
    });
    ['badgeFields', 'bodyFields', 'fields', 'columns', 'hiddenInPanel'].forEach(function (key) {
      if (Array.isArray(value[key])) result[key] = value[key].map(function (item) { return normalizeText(item, ''); }).filter(Boolean);
    });
    if (Number.isFinite(Number(value.perPage)) && Number(value.perPage) > 0) result.perPage = Math.floor(Number(value.perPage));
    if (Object.prototype.hasOwnProperty.call(value, 'paged')) result.paged = value.paged !== false;
    return result;
  }

  function normalizeMechanicsConfig(value) {
    return isPlainObject(value) ? deepClone(value) : {};
  }

  function normalizeModuleDescriptor(raw, index) {
    if (typeof raw === 'string') raw = { id: raw, kind: 'builtin' };
    if (!isPlainObject(raw)) return null;
    var id = normalizeText(raw.id || raw.moduleId, '');
    if (!id || !isStrictIdentifier(id)) return null;
    var rawKind = normalizeText(raw.kind, '');
    var kind = (rawKind === 'builtin' || isBuiltinModuleId(id)) && rawKind !== 'custom' ? 'builtin' : 'custom';
    var order = Number(raw.order);
    var base = {
      id: id,
      kind: kind,
      enabled: raw.enabled !== false,
      order: Number.isFinite(order) ? order : index + 1
    };
    if (raw.name != null) base.name = normalizeText(raw.name, '');

    if (kind === 'builtin') {
      return base;
    }

    var container = normalizeText(raw.container, 'array');
    if (['none', 'scalar', 'object', 'array'].indexOf(container) === -1) container = 'array';
    var field = normalizeText(raw.field, id);
    if (!isStrictIdentifier(field)) field = id;
    base.name = base.name || id;
    base.rules = normalizeText(raw.rules, '');
    base.container = container;
    base.field = container === 'none' ? null : field;
    if (raw.description != null) base.description = normalizeText(raw.description, '');
    if (raw.title != null) base.title = normalizeText(raw.title, '');
    if (container === 'array') base.itemKey = normalizeText(raw.itemKey, 'name');
    if (container === 'scalar') {
      base.scalarType = normalizeText(raw.scalarType || raw.type, 'string');
      if (Object.prototype.hasOwnProperty.call(raw, 'example')) base.example = deepClone(raw.example);
    }
    if (container === 'array' || container === 'object') base.fields = normalizeSchemaFieldMap(raw.fields);
    var display = normalizeDisplayConfig(raw.display);
    if (display) base.display = display;
    base.mechanics = normalizeMechanicsConfig(raw.mechanics);
    return base;
  }

  function migratePreset(raw) {
    var source = isPlainObject(raw) ? deepClone(raw) : {};
    var version = Math.max(0, Math.round(Number(source.schemaVersion || 0)) || 0);
    if (!source.mode) source.mode = 'classic';
    if (!Array.isArray(source.modules)) source.modules = [];
    if (source.mode !== 'free') source.modules = [];
    source.schemaVersion = version || 1;
    return source;
  }

  function collectPresetImportWarnings(raw, normalized) {
    var warnings = [];
    var source = isPlainObject(raw) ? raw : {};
    if (!source.schemaVersion) warnings.push('旧版预设已迁移到 schemaVersion ' + PRESET_SCHEMA_VERSION);
    if (source.mode && source.mode !== 'classic' && source.mode !== 'free') warnings.push('未知 mode 已回退为 classic: ' + source.mode);
    if (normalized.mode === 'free') {
      if (!Array.isArray(source.modules) || !source.modules.length) warnings.push('free 预设缺少 modules[]，已导入为空自由预设');
      var normalizedCount = Array.isArray(normalized.modules) ? normalized.modules.length : 0;
      var sourceCount = Array.isArray(source.modules) ? source.modules.length : 0;
      if (sourceCount && normalizedCount < sourceCount) warnings.push('部分 modules[] 条目未通过校验，已跳过');
    }
    return warnings;
  }

  function readCurrentCustomModuleState() {
    try {
      var core = window.WORLD_ENGINE_CORE;
      var store = getStore();
      if (!core || typeof core.getCustomModuleStateKey !== 'function' || !store || typeof store.getItem !== 'function') return null;
      var raw = store.getItem(core.getCustomModuleStateKey());
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      console.warn('[WorldEngine Presets] Failed to read custom module state for export', e);
      return null;
    }
  }

  function restoreCustomModuleState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      var core = window.WORLD_ENGINE_CORE;
      var store = getStore();
      if (!core || typeof core.getCustomModuleStateKey !== 'function' || !store || typeof store.setItem !== 'function') return false;
      store.setItem(core.getCustomModuleStateKey(), JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[WorldEngine Presets] Failed to restore custom module state from import', e);
      return false;
    }
  }
  function normalizeModuleDescriptors(value) {
    if (!Array.isArray(value)) return [];
    var seen = {};
    var result = [];
    value.forEach(function (item, index) {
      var descriptor = normalizeModuleDescriptor(item, index);
      if (!descriptor || seen[descriptor.id]) return;
      seen[descriptor.id] = true;
      result.push(descriptor);
    });
    return result;
  }

  // 自由模式：顶部状态条跟踪的「模块 + 字段 + 分档短语」。
  // 数值字段用 min 从高到低分档；枚举/字符串字段用 value 精确匹配。无效则返回 null（UI 回退到稳定度小字）。
  function normalizeHeaderMood(raw) {
    if (!isPlainObject(raw)) return null;
    var moduleId = normalizeText(raw.module || raw.moduleId || raw.id, '');
    if (!moduleId) return null;
    var tiersRaw = Array.isArray(raw.tiers) ? raw.tiers : [];
    var tiers = tiersRaw.map(function (t) {
      if (!isPlainObject(t)) return null;
      var phrase = normalizeText(t.phrase || t.text || t.label, '');
      if (!phrase) return null;
      var entry = { phrase: phrase };
      if (t.min != null && Number.isFinite(Number(t.min))) entry.min = Number(t.min);
      if (t.value != null && String(t.value).trim() !== '') entry.value = normalizeText(t.value, '');
      if (t.color != null) entry.color = normalizeText(t.color, '');
      if (entry.min === undefined && entry.value === undefined) return null;
      return entry;
    }).filter(Boolean);
    var defaultText = normalizeText(raw['default'] || raw.initial || raw.fallback, '');
    if (!tiers.length && !defaultText) return null;
    var result = { module: moduleId, tiers: tiers };
    var field = normalizeText(raw.field, '');
    if (field) result.field = field;
    if (defaultText) result.fallback = defaultText;
    if (raw.color != null) result.color = normalizeText(raw.color, '');
    return result;
  }

  function normalizeMechanicNumber(value, fallback, min, max, integer) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = fallback;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return integer ? Math.round(n) : n;
  }

  // 预设随附的本地骰子/生命周期配置。旧预设缺字段时完整回退出厂行为，
  // 因而 schema 升级不会改变已有世界；生成器提供字段时则按世界观自动调参。
  function normalizeLocalMechanics(raw) {
    raw = isPlainObject(raw) ? raw : {};
    var d = LOCAL_MECHANICS_DEFAULTS;
    var distant = isPlainObject(raw.distantEvent) ? raw.distantEvent : {};
    var near = isPlainObject(raw.nearEvent) ? raw.nearEvent : {};
    var dice = isPlainObject(raw.eventDice) ? raw.eventDice : {};
    var wind = isPlainObject(raw.windDecay) ? raw.windDecay : {};
    var retention = isPlainObject(raw.retention) ? raw.retention : {};
    var caps = isPlainObject(retention.caps) ? retention.caps : {};

    function windRow(name) {
      var src = isPlainObject(wind[name]) ? wind[name] : {};
      var fallback = d.windDecay[name];
      return {
        base: normalizeMechanicNumber(src.base, fallback.base, 0, 95, false),
        grace: normalizeMechanicNumber(src.grace, fallback.grace, 0, undefined, true),
        linear: normalizeMechanicNumber(src.linear, fallback.linear, 0, undefined, false),
        quadratic: normalizeMechanicNumber(src.quadratic, fallback.quadratic, 0, undefined, false)
      };
    }

    return {
      distantEvent: {
        ledgerThreshold: normalizeMechanicNumber(distant.ledgerThreshold, d.distantEvent.ledgerThreshold, 1, undefined, true),
        chancePercent: normalizeMechanicNumber(distant.chancePercent, d.distantEvent.chancePercent, 0, 100, false),
        cooldownRounds: normalizeMechanicNumber(distant.cooldownRounds, d.distantEvent.cooldownRounds, 0, undefined, true),
        eventPercent: normalizeMechanicNumber(distant.eventPercent, d.distantEvent.eventPercent, 0, 100, false)
      },
      nearEvent: {
        chancePercent: normalizeMechanicNumber(near.chancePercent, d.nearEvent.chancePercent, 0, 100, false),
        cooldownRounds: normalizeMechanicNumber(near.cooldownRounds, d.nearEvent.cooldownRounds, 0, undefined, true),
        eventPercent: normalizeMechanicNumber(near.eventPercent, d.nearEvent.eventPercent, 0, 100, false)
      },
      eventDice: {
        modifier: normalizeMechanicNumber(dice.modifier, d.eventDice.modifier, -100, 100, false),
        setbackRatioPercent: normalizeMechanicNumber(dice.setbackRatioPercent, d.eventDice.setbackRatioPercent, 0, 100, false),
        progressFailBase: normalizeMechanicNumber(dice.progressFailBase, d.eventDice.progressFailBase, 0, undefined, true),
        conflictFailBase: normalizeMechanicNumber(dice.conflictFailBase, d.eventDice.conflictFailBase, 1, undefined, true)
      },
      windDecay: {
        announcement: windRow('announcement'),
        report: windRow('report'),
        rumor: windRow('rumor'),
        sentiment: windRow('sentiment')
      },
      retention: {
        terminalBaseKeepRounds: normalizeMechanicNumber(retention.terminalBaseKeepRounds, d.retention.terminalBaseKeepRounds, 0, undefined, true),
        terminalLevelKeepRounds: normalizeMechanicNumber(retention.terminalLevelKeepRounds, d.retention.terminalLevelKeepRounds, 0, undefined, true),
        influenceKeepRounds: normalizeMechanicNumber(retention.influenceKeepRounds, d.retention.influenceKeepRounds, 1, undefined, true),
        enemyTerminalKeepRounds: normalizeMechanicNumber(retention.enemyTerminalKeepRounds, d.retention.enemyTerminalKeepRounds, 1, undefined, true),
        ledgerKeepRounds: normalizeMechanicNumber(retention.ledgerKeepRounds, d.retention.ledgerKeepRounds, 1, undefined, true),
        caps: {
          events: normalizeMechanicNumber(caps.events, d.retention.caps.events, 1, undefined, true),
          factions: normalizeMechanicNumber(caps.factions, d.retention.caps.factions, 1, undefined, true),
          winds: normalizeMechanicNumber(caps.winds, d.retention.caps.winds, 1, undefined, true),
          worldTrends: normalizeMechanicNumber(caps.worldTrends, d.retention.caps.worldTrends, 1, undefined, true),
          influence: normalizeMechanicNumber(caps.influence, d.retention.caps.influence, 1, undefined, true),
          enemies: normalizeMechanicNumber(caps.enemies, d.retention.caps.enemies, 1, undefined, true),
          economySignals: normalizeMechanicNumber(caps.economySignals, d.retention.caps.economySignals, 1, undefined, true),
          blackbox: normalizeMechanicNumber(caps.blackbox, d.retention.caps.blackbox, 1, undefined, true)
        }
      }
    };
  }

  function normalizePreset(raw, options) {
    options = options || {};
    var source = migratePreset(raw);
    var base = ANCIENT_CHINESE;
    var id = normalizeText(source.id, options.fallbackId || ('custom_' + Date.now()));
    var termMap = normalizeStringMap(source.termMap, {});
    var mode = source.mode === 'free' ? 'free' : 'classic';
    var preset = {
      id: id,
      schemaVersion: PRESET_SCHEMA_VERSION,
      mode: mode,
      name: normalizeText(source.name, '自定义预设'),
      description: normalizeText(source.description, base.description),
      builtin: options.builtin === true ? true : source.builtin === true,
      reputation: {
        dimensions: normalizeDimensions(source.reputation && source.reputation.dimensions, base.reputation.dimensions),
        levels: INTERNAL_SCHEMA.reputationLevels.slice(),
        verdicts: normalizeReputationVerdicts(source.reputation && source.reputation.verdicts, base.reputation.verdicts, termMap)
      },
      factions: {
        statuses: INTERNAL_SCHEMA.factionStatuses.slice(),
        statusVerdicts: VerdictEngine.normalizeSingleAxis(VERDICT_CONFIGS.factionStatus, source.factions && source.factions.statusVerdicts, base.factions.statusVerdicts, termMap),
        relations: INTERNAL_SCHEMA.factionRelations.slice(),
        relationVerdicts: VerdictEngine.normalizeSingleAxis(VERDICT_CONFIGS.factionRelation, source.factions && source.factions.relationVerdicts, base.factions.relationVerdicts, termMap)
      },
      economy: {
        climates: INTERNAL_SCHEMA.economyClimates.slice(),
        climateVerdicts: VerdictEngine.normalizeSingleAxis(VERDICT_CONFIGS.economyClimate, source.economy && source.economy.climateVerdicts, base.economy.climateVerdicts, termMap)
      },
      regionalIncidents: {
        chance: normalizeMechanicNumber(source.regionalIncidents && source.regionalIncidents.chance, base.regionalIncidents.chance, 0, 1, false),
        durationRounds: normalizeMechanicNumber(source.regionalIncidents && source.regionalIncidents.durationRounds, base.regionalIncidents.durationRounds, 1, undefined, true),
        cooldownRounds: normalizeMechanicNumber(source.regionalIncidents && source.regionalIncidents.cooldownRounds, base.regionalIncidents.cooldownRounds, 0, undefined, true),
        types: normalizeIncidentTypes(source.regionalIncidents && source.regionalIncidents.types, base.regionalIncidents.types)
      },
      localMechanics: normalizeLocalMechanics(source.localMechanics),
      termMap: termMap,
      ui: normalizeUI(source.ui),
      customRules: normalizeText(source.customRules, ''),
      // 引擎段落覆写：留空 = 使用内置默认。只存覆写不存默认拷贝
      //（默认文本单一真相源 = world-engine-evolution.js 的 DEFAULT_SEGS）。
      engineSegments: {
        engineRole: normalizeText(source.engineSegments && source.engineSegments.engineRole, ''),
        causalSteps: normalizeText(source.engineSegments && source.engineSegments.causalSteps, '')
      },
      schemaOverrides: normalizeSchemaOverrides(source.schemaOverrides),
      disabledModules: Array.isArray(source.disabledModules)
        ? source.disabledModules.filter(function (m) { return typeof m === 'string' && m; })
        : [],
      modules: mode === 'free' ? normalizeModuleDescriptors(source.modules) : [],
      headerMood: mode === 'free' ? normalizeHeaderMood(source.headerMood) : null,
      // 是否显示顶部「世界稳定度」仪表；默认显示，仅当明确为 false 时隐藏。
      showStability: source.showStability !== false
    };
    return preset;
  }

  // ═════════════════════════════════════════════
  //  STORAGE HELPERS
  // ═════════════════════════════════════════════

  function getStore() {
    if (window.WORLD_ENGINE_STORE) return window.WORLD_ENGINE_STORE;
    // Fallback minimal shim (should not be needed in production)
    console.warn('[WorldEngine Presets] window.WORLD_ENGINE_STORE not found, using in-memory fallback');
    var mem = {};
    return {
      getItem: function (k) { return mem[k] !== undefined ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = v; }
    };
  }

  function loadActivePresetId() {
    var store = getStore();
    var id = store.getItem(STORAGE_KEY_ACTIVE);
    return id || DEFAULT_PRESET_ID;
  }

  function saveActivePresetId(id) {
    var store = getStore();
    store.setItem(STORAGE_KEY_ACTIVE, id);
  }

  function loadCustomPresets() {
    var store = getStore();
    var raw = store.getItem(STORAGE_KEY_CUSTOM);
    if (!raw) return [];
    try {
      var arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(function (p) { return p && p.id && p.name; })
        .map(function (p) { return normalizePreset(p, { builtin: false }); });
    } catch (e) {
      console.error('[WorldEngine Presets] Failed to parse custom presets:', e);
      return [];
    }
  }

  function saveCustomPresetsArray(arr) {
    var store = getStore();
    store.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(arr));
  }

  // ═════════════════════════════════════════════
  //  CORE API
  // ═════════════════════════════════════════════

  /**
   * Get all presets (built-in + custom).
   * @returns {Array} deep-cloned array of preset objects
   */
  function getAllPresets() {
    var custom = loadCustomPresets();
    return deepClone(BUILTIN_PRESETS.map(function (p) {
      return normalizePreset(p, { builtin: true });
    }).concat(custom));
  }

  /**
   * Get built-in presets only.
   * @returns {Array}
   */
  function getBuiltinPresets() {
    return deepClone(BUILTIN_PRESETS.map(function (p) {
      return normalizePreset(p, { builtin: true });
    }));
  }

  /**
   * Get custom (user-created) presets only.
   * @returns {Array}
   */
  function getCustomPresets() {
    return deepClone(loadCustomPresets());
  }

  /**
   * Find a preset by ID across built-in and custom.
   * @param {string} id
   * @returns {Object|null}
   */
  function findPresetById(id) {
    if (builtinMap[id]) return normalizePreset(builtinMap[id], { builtin: true });
    var custom = loadCustomPresets();
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) return normalizePreset(custom[i], { builtin: false });
    }
    return null;
  }

  /**
   * Get the currently active preset object.
   * Falls back to ancient_chinese if the stored ID is invalid.
   * @returns {Object}
   */
  function getActivePreset() {
    var id = loadActivePresetId();
    var preset = findPresetById(id);
    if (!preset) {
      console.warn('[WorldEngine Presets] Active preset "' + id + '" not found, falling back to default');
      saveActivePresetId(DEFAULT_PRESET_ID);
      return deepClone(builtinMap[DEFAULT_PRESET_ID]);
    }
    return preset;
  }

  /**
   * Get the currently active preset's ID.
   * @returns {string}
   */
  function getActivePresetId() {
    return loadActivePresetId();
  }

  /**
   * Switch to a preset by ID.
   * @param {string} id
   * @returns {boolean} true if successfully switched
   */
  function setActivePreset(id) {
    var preset = findPresetById(id);
    if (!preset) {
      console.error('[WorldEngine Presets] Cannot switch to unknown preset: ' + id);
      return false;
    }
    saveActivePresetId(id);
    console.log('[WorldEngine Presets] Switched active preset to: ' + preset.name + ' (' + id + ')');
    return true;
  }

  /**
   * Save a custom preset. If a custom preset with the same ID already exists, it will be overwritten.
   * Built-in presets cannot be overwritten via this function.
   * @param {Object} preset — must include at least id and name
   * @returns {boolean}
   */
  function saveCustomPreset(preset) {
    if (!preset || !preset.id || !preset.name) {
      console.error('[WorldEngine Presets] Invalid preset: must have id and name');
      return false;
    }
    if (builtinMap[preset.id]) {
      console.error('[WorldEngine Presets] Cannot overwrite built-in preset: ' + preset.id);
      return false;
    }
    preset = normalizePreset(preset, { builtin: false });
    var custom = loadCustomPresets();
    var found = false;
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === preset.id) {
        custom[i] = preset;
        found = true;
        break;
      }
    }
    if (!found) {
      custom.push(preset);
    }
    saveCustomPresetsArray(custom);
    console.log('[WorldEngine Presets] Saved custom preset: ' + preset.name + ' (' + preset.id + ')');
    return true;
  }

  /**
   * Delete a custom preset by ID. Built-in presets cannot be deleted.
   * If the deleted preset was the active one, falls back to default.
   * @param {string} id
   * @returns {boolean}
   */
  function deleteCustomPreset(id) {
    if (builtinMap[id]) {
      console.error('[WorldEngine Presets] Cannot delete built-in preset: ' + id);
      return false;
    }
    var custom = loadCustomPresets();
    var newList = custom.filter(function (p) { return p.id !== id; });
    if (newList.length === custom.length) {
      console.warn('[WorldEngine Presets] Custom preset not found: ' + id);
      return false;
    }
    saveCustomPresetsArray(newList);
    // If the deleted preset was active, fall back to default
    if (loadActivePresetId() === id) {
      saveActivePresetId(DEFAULT_PRESET_ID);
      console.log('[WorldEngine Presets] Deleted active preset, falling back to default');
    }
    console.log('[WorldEngine Presets] Deleted custom preset: ' + id);
    return true;
  }

  // ═════════════════════════════════════════════
  //  TERM REPLACEMENT ENGINE
  // ═════════════════════════════════════════════

  /**
   * Apply the active preset's termMap to a piece of text.
   * Replaces all occurrences of each key in termMap with its value.
   * Keys are sorted by length (longest first) to avoid partial replacements.
   * @param {string} text
   * @returns {string} — the text with all terms replaced
   */
  // Canonical enum VALUES that the evolution LLM must echo back verbatim.
  // They must NEVER be substituted inside the backend evolution prompt,
  // otherwise the returned JSON can no longer be parsed against the schema.
  var ENUM_VALUE_SET = (function () {
    var s = {};
    [].concat(
      INTERNAL_SCHEMA.reputationLevels,
      INTERNAL_SCHEMA.factionStatuses,
      INTERNAL_SCHEMA.factionRelations,
      INTERNAL_SCHEMA.economyClimates
    ).forEach(function (v) { s[v] = true; });
    return s;
  })();

  // Low-level: replace every key of `map` in `text` (longest key first).
  function replaceWithMap(text, map) {
    if (!text || typeof text !== 'string') return text;
    if (!map || typeof map !== 'object') return text;
    var keys = Object.keys(map);
    if (keys.length === 0) return text;
    keys.sort(function (a, b) { return b.length - a.length; });
    var result = text;
    for (var i = 0; i < keys.length; i++) {
      var oldTerm = keys[i];
      var newTerm = map[oldTerm];
      // Skip no-op / empty replacements to avoid accidental deletions.
      if (!oldTerm || newTerm == null || newTerm === '' || oldTerm === newTerm) continue;
      var escaped = oldTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), newTerm);
    }
    return result;
  }

  /**
   * Display-side replacement: applies the FULL termMap (including enum-value
   * wording) to text that is only shown to the user / injected as narrative
   * guidance — never parsed back as JSON.
   */
  function applyTermMap(text) {
    return text;
  }

  function applyDisplayTerms(text) {
    return text;
  }

  function buildPromptTermMap(preset) {
    var map = (preset && preset.termMap) || {};
    var out = {};
    Object.keys(map).forEach(function (k) {
      var v = map[k];
      if (!k || v == null || v === '' || v === k) return;
      if (ENUM_VALUE_SET[k]) return;              // never touch enum values
      out[k] = v;
      var m = k.match(/^(.{2})(之上|之间|之中)$/);   // 朝堂之上→朝堂 …
      if (m && !map[m[1]] && !ENUM_VALUE_SET[m[1]]) out[m[1]] = v;
    });
    return out;
  }

  /**
   * Prompt-side replacement: safe to apply to text sent to the evolution LLM,
   * because canonical enum values are preserved.
   */
  function applyPromptTerms(text) {
    return text;
  }

  // ═════════════════════════════════════════════
  //  EXPORT / IMPORT
  // ═════════════════════════════════════════════

  /**
   * Export a preset as a JSON string.
   * @param {string} id
   * @returns {string|null}
   */
  function exportPreset(id) {
    var preset = findPresetById(id);
    if (!preset) {
      console.error('[WorldEngine Presets] Cannot export: preset not found: ' + id);
      return null;
    }
    var payload = deepClone(preset);
    payload.schemaVersion = PRESET_SCHEMA_VERSION;
    if (payload.mode === 'free') {
      var customState = readCurrentCustomModuleState();
      if (customState && Object.keys(customState).length) payload.customModuleState = customState;
    }
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Import a preset from a JSON string. The imported preset is always marked as non-builtin.
   * If the ID conflicts with a built-in preset, a suffix is appended.
   * @param {string} jsonString
   * @returns {Object|null} — the imported preset, or null on failure
   */
  function importPreset(jsonString) {
    try {
      var parsed = JSON.parse(jsonString);
      var customModuleState = parsed && parsed.customModuleState;
      var preset = parsed && parsed.type === PRESET_EXPORT_TYPE && parsed.preset ? parsed.preset : parsed;
      if (!preset || !preset.id || !preset.name) {
        console.error('[WorldEngine Presets] Import failed: JSON must contain id and name');
        return null;
      }
      // Ensure it is not treated as built-in
      preset.builtin = false;
      // Avoid ID collision with built-in presets
      if (builtinMap[preset.id]) {
        preset.id = preset.id + '_imported_' + Date.now();
        console.warn('[WorldEngine Presets] ID conflicted with built-in preset, new ID: ' + preset.id);
      }
      var normalized = normalizePreset(preset, { builtin: false });
      var warnings = collectPresetImportWarnings(preset, normalized);
      if (warnings.length) console.warn('[WorldEngine Presets] Import warnings: ' + warnings.join('; '));
      saveCustomPreset(normalized);
      if (customModuleState) restoreCustomModuleState(customModuleState);
      var result = deepClone(normalized);
      if (warnings.length) result.importWarnings = warnings;
      return result;
    } catch (e) {
      console.error('[WorldEngine Presets] Import failed:', e);
      return null;
    }
  }

  // ═════════════════════════════════════════════

  var BUILTIN_MODULE_IDS = [
    'world', 'events', 'factions', 'winds', 'influence', 'contact',
    'reputation', 'economy', 'enemies', 'regional', 'blackbox', 'trends'
  ];

  var BUILTIN_MODULE_NAMES = {
    world: '世界运转',
    events: '事件链',
    factions: '势力',
    winds: '风声',
    influence: '影响链',
    contact: '信息传播与知情边界',
    reputation: '声誉',
    economy: '经济',
    enemies: '仇敌录',
    regional: '区域突发事件',
    blackbox: '信息黑盒',
    trends: '天下大势'
  };

  function normalizeGeneratedDisabledModules(value) {
    if (!Array.isArray(value)) return [];
    var known = new Set(BUILTIN_MODULE_IDS);
    var seen = new Set();
    var result = [];
    value.forEach(function (id) {
      id = typeof id === 'string' ? id.trim() : '';
      if (!known.has(id) || seen.has(id)) return;
      seen.add(id);
      result.push(id);
    });
    return result;
  }

  function normalizeGenerationModuleSelection(options) {
    options = options || {};
    var fixed = options.moduleCountMode === 'fixed';
    var count = Math.round(Number(options.moduleCount));
    if (!Number.isFinite(count)) count = BUILTIN_MODULE_IDS.length;
    count = Math.max(1, Math.min(BUILTIN_MODULE_IDS.length, count));
    return {
      autoCrop: options.autoCropModules === true,
      mode: fixed ? 'fixed' : 'auto',
      count: count,
      enabled: options.autoCropModules === true || fixed
    };
  }

  function buildModuleSelectionPrompt(selection) {
    if (!selection || !selection.enabled) return '';
    var lines = [];
    var moduleList = BUILTIN_MODULE_IDS.map(function (id) {
      return '- ' + id + ' = ' + BUILTIN_MODULE_NAMES[id];
    }).join('\n');
    lines.push('## 模块裁剪');
    lines.push('本次仍生成 classic 十二模块预设，但你必须判断哪些内置模块适合这个世界。');
    lines.push('可用模块 ID：\n' + moduleList);
    lines.push('请在顶层 JSON 返回 `disabledModules` 数组，数组内容只能使用以上 moduleId。被列入 disabledModules 的模块会在推演规则、输出字段和面板中关闭。');
    if (selection.mode === 'fixed') {
      lines.push('用户指定最终启用模块数量必须恰好为 ' + selection.count + ' 个，因此 disabledModules 必须恰好包含 ' + (BUILTIN_MODULE_IDS.length - selection.count) + ' 个不同模块 ID。');
    } else {
      lines.push('请只关闭与世界观明显不相关或会造成噪音的模块；如果十二模块都适合，返回空数组。');
    }
    return lines.join('\n') + '\n\n';
  }

  function validateGeneratedDisabledModules(disabledModules, selection) {
    var disabled = normalizeGeneratedDisabledModules(disabledModules);
    if (!selection || !selection.enabled) return [];
    if (selection.mode === 'fixed') {
      var enabledCount = BUILTIN_MODULE_IDS.length - disabled.length;
      if (enabledCount !== selection.count) {
        throw new Error('[WorldEngine Presets] AI 返回的模块数量不一致：要求启用 ' + selection.count + ' 个，实际启用 ' + enabledCount + ' 个。请重试生成，或调整模块数量为委任 AI 决定。');
      }
    }
    return disabled;
  }

  function normalizeGenerationMode(options) {
    options = options || {};
    return options.generationMode === 'free' || options.mode === 'free' || options.freeMode === true ? 'free' : 'classic';
  }

  function buildBuiltinModuleReferenceText() {
    return BUILTIN_MODULE_IDS.map(function (id) {
      return '- ' + id + ' = ' + BUILTIN_MODULE_NAMES[id];
    }).join('\n');
  }

  function parseGenerationJson(response) {
    if (!response) throw new Error('[WorldEngine Presets] API returned empty response');
    var jsonStr = response;
    var jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      var braceStart = response.indexOf('{');
      var braceEnd = response.lastIndexOf('}');
      if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
        jsonStr = response.substring(braceStart, braceEnd + 1);
      }
    }
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('[WorldEngine Presets] Failed to parse API response as JSON: ' + e.message + '\nRaw response:\n' + response.substring(0, 500));
    }
  }

  function validateGeneratedFreeModules(value, selection) {
    var modules = normalizeModuleDescriptors(value);
    if (!modules.length) throw new Error('[WorldEngine Presets] AI did not return any free modules.');
    var reservedFields = {
      events: true,
      factions: true,
      worldTrends: true,
      winds: true,
      economy: true,
      reputation: true,
      enemies: true,
      influenceChain: true,
      regionalIncident: true,
      blackbox: true,
      world_digest: true
    };
    var seenFields = {};
    modules.forEach(function (module) {
      if (!module || module.enabled === false || module.kind === 'builtin') return;
      if (!module.field && module.container !== 'none') throw new Error('[WorldEngine Presets] Custom free module missing field: ' + module.id);
      if (module.field && reservedFields[module.field]) throw new Error('[WorldEngine Presets] Custom free module field conflicts with built-in field: ' + module.field);
      if (module.field && seenFields[module.field]) throw new Error('[WorldEngine Presets] Duplicate custom free module field: ' + module.field);
      if (module.field) seenFields[module.field] = true;
      if ((module.container === 'array' || module.container === 'object') && !Object.keys(module.fields || {}).length) {
        throw new Error('[WorldEngine Presets] Custom free module needs fields: ' + module.id);
      }
      if (module.container === 'array' && module.itemKey && module.fields && !module.fields[module.itemKey]) {
        throw new Error('[WorldEngine Presets] Custom free module itemKey must match a field: ' + module.id + '.' + module.itemKey);
      }
    });
    var enabledCount = modules.filter(function (module) { return module.enabled !== false; }).length;
    if (!enabledCount) {
      throw new Error('[WorldEngine Presets] AI returned only disabled free modules.');
    }
    if (selection && selection.mode === 'fixed' && enabledCount !== selection.count) {
      throw new Error('[WorldEngine Presets] AI returned ' + enabledCount + ' free modules, but ' + selection.count + ' were requested. Please retry generation or switch module count back to AI choice.');
    }
    return modules;
  }

  // 用户在生成时手填的「指导提示词」。返回一段可直接拼进 prompt 的高优先级指令；
  // 留空则返回空串，完全不影响原有生成逻辑。
  function buildUserGuidanceSection(userGuidance) {
    var g = String(userGuidance == null ? '' : userGuidance).trim();
    if (!g) return '';
    if (g.length > 4000) g = g.substring(0, 4000).trim();
    return '## 用户额外指导（最高优先级，请优先满足，但绝不能违反上面要求的输出格式）\n\n'
      + g + '\n\n';
  }

  function buildLocalMechanicsGenerationRequirements() {
    return '- 必须生成顶层 localMechanics，让本地机制随世界观预设一起生成：高动荡/高信息流世界可提高近端与远方触发率，慢热/日常世界应降低概率并拉长冷却；信息传播快的世界可缩短风声 grace 或提高衰减，档案/传说型世界应延长保留；容量上限按世界复杂度设置。不要机械照抄示例值。\n'
      + '- localMechanics 的百分比范围 0-100；cooldownRounds/grace/保留轮数/容量上限用非负整数（要求至少 1 的字段按示例）；windDecay.base 范围 0-95。事件/风声模块未启用时这些参数会保留但不会触发对应机制。\n'
      + '- regionalIncidents 也是本地机制的一部分：chance、持续/冷却与事件类型必须和上述 localMechanics 的节奏相协调。\n';
  }

  function buildLocalMechanicsJsonTemplate() {
    return '  "localMechanics": {\n'
      + '    "distantEvent": { "ledgerThreshold": 10, "chancePercent": 20, "cooldownRounds": 5, "eventPercent": 50 },\n'
      + '    "nearEvent": { "chancePercent": 20, "cooldownRounds": 5, "eventPercent": 50 },\n'
      + '    "eventDice": { "modifier": 0, "setbackRatioPercent": 40, "progressFailBase": 2, "conflictFailBase": 6 },\n'
      + '    "windDecay": {\n'
      + '      "announcement": { "base": 10, "grace": 4, "linear": 3, "quadratic": 1 },\n'
      + '      "report": { "base": 20, "grace": 2, "linear": 4, "quadratic": 2 },\n'
      + '      "rumor": { "base": 25, "grace": 1, "linear": 5, "quadratic": 3 },\n'
      + '      "sentiment": { "base": 8, "grace": 5, "linear": 2, "quadratic": 1 }\n'
      + '    },\n'
      + '    "retention": {\n'
      + '      "terminalBaseKeepRounds": 2, "terminalLevelKeepRounds": 2, "influenceKeepRounds": 8,\n'
      + '      "enemyTerminalKeepRounds": 20, "ledgerKeepRounds": 20,\n'
      + '      "caps": { "events": 16, "factions": 15, "winds": 12, "worldTrends": 4, "influence": 12, "enemies": 8, "economySignals": 8, "blackbox": 12 }\n'
      + '    }\n'
      + '  },\n';
  }

  function buildFreeGenerationPrompt(source, options) {
    options = options || {};
    var builtinRefs = buildBuiltinModuleReferenceText();
    var selection = normalizeGenerationModuleSelection(options);
    var countPrompt = '';
    if (selection.mode === 'fixed') {
      countPrompt = '- 用户指定 modules[] 中启用模块总数必须恰好为 ' + selection.count + ' 个；内置引用和自定义模块合计计数，disabled:false/未写 enabled 都算启用。\n';
    } else if (selection.autoCrop) {
      countPrompt = '- 用户开启了 AI 自动裁剪；请只保留对该世界观真正有用的模块，不要为了凑数加入无关模块。\n';
    }
    var systemPrompt = '你是一个世界观结构设计专家。用户会给你世界书条目和/或角色卡描述。你需要自行判断这个世界真正需要被追踪的机制，并输出世界引擎自由模式预设。';
    var userPrompt = '请分析以下设定内容，生成一个自由模式世界引擎预设。\n\n'
      + source.sections + '\n\n'
      + buildUserGuidanceSection(options.userGuidance)
      + '## 自由模式要求\n\n'
      + '- 不要套用固定十二模块；请按世界观自行决定需要哪些模块。\n'
      + countPrompt
      + '- 可以生成纯自定义模块，也可以混合引用少量内置模块。\n'
      + '- 若引用内置模块，modules[] 条目只写 `{ "id": "events", "kind": "builtin", "enabled": true, "order": 1 }` 这种形状。可引用内置模块：\n' + builtinRefs + '\n'
      + '- 自定义模块 id 和 field 必须是英文标识符，使用 camelCase 或 snake_case；不要使用内置 state 字段：events/factions/worldTrends/winds/economy/reputation/enemies/influenceChain/regionalIncident/blackbox/world_digest。\n'
      + '- 自定义模块 container 只能是 array/object/scalar/none；array/object 必须提供 fields；array 必须提供 itemKey 且 itemKey 必须存在于 fields。\n'
      + '- fields 的每个字段至少写 label、type、description、example、display；label 是该字段在界面上显示的【中文名】（例如 intimacy 的 label 写「亲密度」），必须填写，不能省略，也不要直接用英文字段名当 label；type 可用 string/number/boolean/enum/array<string>/object。\n'
      + '- rules 写给推演 AI 的模块规则，说明什么时候新增、更新、删除或保持该模块数据。\n'
      + '- display 说明 UI 展示方式：style 可用 cards/table/keyvalue/list，titleField/badgeFields/bodyFields 只能引用 fields。\n'
      + '- mechanics 可选，只在需要时配置：dice 支持 mode=threshold/decay/trigger；stages 支持 states 或 order；verdicts 支持 axes 和 levels。\n'
      + buildLocalMechanicsGenerationRequirements()
      + '- headerMood 指定【顶部状态条】跟踪的模块与字段（自由模式下默认的稳定度只看内置模块，所以纯自定义世界必须靠 headerMood 才能让顶部那行字随剧情变化）：module 写上面某个模块的 id，field 写该模块里一个最能代表整体氛围的数值或枚举字段 key；tiers 是分档短语——数值字段用 min 从高到低分档（每档一句贴合世界观的氛围短语），枚举字段改用 value 精确匹配该字段的每个取值。另外必须填写 default：世界刚生成、第 0 轮还没有任何数据时顶部显示的初始短语（用来替换默认的「海静不扬波」），写一句贴合该世界开场氛围的话。务必填写 headerMood 和其中的 default。\n\n'
      + '- showStability：布尔值，是否需要顶部「世界稳定度/压力」仪表。若这个自由世界以人物关系、恋爱、日常为核心、没有宏观局势压力，设为 false；否则 true。拿不准设为 true。\n\n'
      + '请严格按以下 JSON 返回，只返回 JSON：\n\n'
      + '```json\n'
      + '{\n'
      + '  "name": "预设显示名称",\n'
      + '  "description": "一句话描述这个自由世界预设",\n'
      + '  "mode": "free",\n'
      + '  "showStability": true,\n'
      + '  "regionalIncidents": {\n'
      + '    "chance": 0.03, "durationRounds": 5, "cooldownRounds": 5,\n'
      + '    "types": [{ "type": "英文标识", "label": "中文名称", "weight": 10, "guide": "世界观专属事件示例" }]\n'
      + '  },\n'
      + buildLocalMechanicsJsonTemplate()
      + '  "modules": [\n'
      + '    { "id": "events", "kind": "builtin", "enabled": true, "order": 1 },\n'
      + '    {\n'
      + '      "id": "customModuleId",\n'
      + '      "name": "模块显示名",\n'
      + '      "kind": "custom",\n'
      + '      "enabled": true,\n'
      + '      "order": 2,\n'
      + '      "container": "array",\n'
      + '      "field": "customModuleId",\n'
      + '      "itemKey": "name",\n'
      + '      "rules": "用中文写清楚该模块如何根据剧情更新。",\n'
      + '      "fields": {\n'
      + '        "name": { "label": "名称", "type": "string", "description": "条目名称", "example": "示例名称", "display": true },\n'
      + '        "status": { "label": "状态", "type": "enum", "enum": ["低", "中", "高"], "description": "状态", "example": "中", "display": true }\n'
      + '      },\n'
      + '      "display": { "style": "cards", "titleField": "name", "badgeFields": ["status"], "bodyFields": [], "emptyText": "暂无记录" },\n'
      + '      "mechanics": {}\n'
      + '    }\n'
      + '  ],\n'
      + '  "customRules": "可选：整个自由预设的额外总规则",\n'
      + '  "engineSegments": {\n'
      + '    "causalSteps": "可选：为本世界观定制的因果检查步骤（将替换推演引擎默认的检查清单）。若提供：用中文按 1. 2. 3. 编号写 6-10 条；第 1 条必须是私密信息处理原则（未被目击、未传播的行为不得影响任何公开状态）；随后为上面每个启用模块各写一条更新时机与因果条件（什么情况下才允许更新该模块、依据什么）；最后一条必须禁止角色直接读取面板信息行动。若内置默认清单已够用，返回空字符串。"\n'
      + '  },\n'
      + '  "ui": { "labels": {}, "moods": {}, "summaryEmpty": "世界尚未开始时显示的一句话" },\n'
      + '  "headerMood": {\n'
      + '    "module": "上面某个模块的 id",\n'
      + '    "field": "该模块里一个数值或枚举字段的 key",\n'
      + '    "default": "世界刚开始、还没有任何数据时顶部显示的短语",\n'
      + '    "tiers": [\n'
      + '      { "min": 70, "phrase": "高档位时顶部显示的氛围短语" },\n'
      + '      { "min": 35, "phrase": "中档位短语" },\n'
      + '      { "min": 0, "phrase": "低档位短语" }\n'
      + '    ]\n'
      + '  }\n'
      + '}\n'
      + '```\n\n'
      + '注意：modules[] 至少 1 个启用模块；不要返回解释文字；所有说明和值使用中文。id/field/字段名（fields 的 key）使用英文标识符，但每个字段必须额外提供中文 label 作为界面显示名——界面只显示 label，绝不显示英文字段名。';
    return { systemPrompt: systemPrompt, userPrompt: userPrompt };
  }

  async function generateFreePresetFromSource(source, options) {
    if (!window.WORLD_ENGINE_API || typeof window.WORLD_ENGINE_API.callApi !== 'function') {
      throw new Error('[WorldEngine Presets] window.WORLD_ENGINE_API.callApi is not available');
    }
    var prompt = buildFreeGenerationPrompt(source, options);
    var response = await window.WORLD_ENGINE_API.callApi(prompt.systemPrompt + '\n\n' + prompt.userPrompt, 8000, 0.7);
    var parsed = parseGenerationJson(response);
    var timestamp = Date.now();
    var preset = {
      id: 'worldbook_free_' + timestamp,
      mode: 'free',
      name: parsed.name || '世界书自由预设',
      description: parsed.description || '基于设定自动生成的自由模式预设',
      builtin: false,
      modules: validateGeneratedFreeModules(parsed.modules, normalizeGenerationModuleSelection(options)),
      disabledModules: [],
      schemaOverrides: parsed.schemaOverrides || {},
      customRules: parsed.customRules || '',
      // 引擎角色不开放给生成器（换人设收益小、写坏输出纪律风险大）；只接受因果步骤定制
      engineSegments: {
        engineRole: '',
        causalSteps: (parsed.engineSegments && typeof parsed.engineSegments.causalSteps === 'string')
          ? parsed.engineSegments.causalSteps.trim()
          : ''
      },
      ui: parsed.ui || {},
      headerMood: parsed.headerMood || null,
      showStability: parsed.showStability !== false,
      regionalIncidents: parsed.regionalIncidents || ANCIENT_CHINESE.regionalIncidents,
      localMechanics: parsed.localMechanics || {},
      termMap: {}
    };
    saveCustomPreset(preset);
    console.log('[WorldEngine Presets] Generated and saved free preset from worldbook: ' + preset.name + ' (' + preset.id + ')');
    var stored = findPresetById(preset.id);
    return stored || deepClone(preset);
  }
  function truncateGenerationText(text, maxLength, label) {
    text = String(text || '').trim();
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '\n\n[...' + label + '\u5185\u5bb9\u8fc7\u957f\uff0c\u5df2\u622a\u65ad...]';
  }

  function readUserPersonaText() {
    try {
      if (window.WORLD_ENGINE_CORE && typeof window.WORLD_ENGINE_CORE.getUserPersona === 'function') {
        return truncateGenerationText(window.WORLD_ENGINE_CORE.getUserPersona() || '', 4000, '\u7528\u6237 persona');
      }
    } catch (e) {}
    return '';
  }


  function summarizeActivePresetForGeneration() {
    try {
      var preset = getActivePreset();
      if (!preset) return '';
      var dimensions = {};
      var rawDimensions = preset.reputation && preset.reputation.dimensions || {};
      Object.keys(rawDimensions).forEach(function (key) {
        var item = rawDimensions[key] || {};
        dimensions[key] = { name: item.name || key, description: item.description || '' };
      });
      var eventTypes = (preset.regionalIncidents && preset.regionalIncidents.types || []).slice(0, 20).map(function (item) {
        return {
          type: item.type,
          label: item.label,
          weight: item.weight,
          guide: item.guide
        };
      });
      var summary = {
        name: preset.name || '',
        description: preset.description || '',
        disabledModules: Array.isArray(preset.disabledModules) ? preset.disabledModules : [],
        schemaOverrides: preset.schemaOverrides || {},
        customRules: preset.customRules || '',
        reputationDimensions: dimensions,
        regionalIncidents: {
          chance: preset.regionalIncidents && preset.regionalIncidents.chance,
          durationRounds: preset.regionalIncidents && preset.regionalIncidents.durationRounds,
          cooldownRounds: preset.regionalIncidents && preset.regionalIncidents.cooldownRounds,
          types: eventTypes
        },
        localMechanics: preset.localMechanics || normalizeLocalMechanics({}),
        ui: {
          labels: preset.ui && preset.ui.labels || {},
          moods: preset.ui && preset.ui.moods || {},
          summaryEmpty: preset.ui && preset.ui.summaryEmpty || ''
        }
      };
      return truncateGenerationText(JSON.stringify(summary, null, 2), 9000, '\u4e16\u754c\u9884\u8bbe');
    } catch (e) {
      console.warn('[WorldEngine Presets] Failed to summarize active preset', e);
      return '';
    }
  }

  async function buildGenerationSource(options) {
    options = options || {};
    if (!window.WORLD_ENGINE_WORLDBOOK || typeof window.WORLD_ENGINE_WORLDBOOK.loadCurrentEntries !== 'function') {
      throw new Error('[WorldEngine Presets] window.WORLD_ENGINE_WORLDBOOK.loadCurrentEntries is not available');
    }

    var entries = await window.WORLD_ENGINE_WORLDBOOK.loadCurrentEntries();
    entries = Array.isArray(entries) ? entries : [];
    var explicitIds = Array.isArray(options.worldbookEntryIds)
      ? options.worldbookEntryIds.filter(function (id) { return typeof id === 'string' && id; })
      : null;
    var selectedIds = explicitIds || ((typeof window.WORLD_ENGINE_WORLDBOOK.getSelectedIds === 'function')
      ? window.WORLD_ENGINE_WORLDBOOK.getSelectedIds()
      : []);
    var hasSelection = explicitIds !== null
      ? true
      : ((typeof window.WORLD_ENGINE_WORLDBOOK.hasSelection === 'function')
        ? window.WORLD_ENGINE_WORLDBOOK.hasSelection()
        : false);
    var selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);
    entries = entries.filter(function (entry) {
      if (!entry || entry.disabled === true) return false;
      return hasSelection ? selectedSet.has(entry.id) : true;
    });

    var contentParts = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var title = entry.title || entry.comment || entry.key || entry.uid || ('Entry ' + i);
      var body = entry.content || '';
      if (String(body).trim()) {
        contentParts.push('\u3010' + title + '\u3011\n' + String(body).trim());
      }
    }

    var worldbookText = truncateGenerationText(contentParts.join('\n\n'), 12000, '\u4e16\u754c\u4e66');
    var characterText = '';
    if (options.includeCharacterDescription === true &&
        window.WORLD_ENGINE_WORLDBOOK &&
        typeof window.WORLD_ENGINE_WORLDBOOK.loadCurrentCharacterProfile === 'function') {
      characterText = truncateGenerationText(window.WORLD_ENGINE_WORLDBOOK.loadCurrentCharacterProfile() || '', 8000, '\u89d2\u8272\u5361');
    }
    var personaText = options.includeUserPersona === false ? '' : readUserPersonaText();
    var presetText = options.includePreset === true ? summarizeActivePresetForGeneration() : '';


    if (!worldbookText.trim() && !characterText.trim() && !personaText.trim() && !presetText.trim()) {
      throw new Error('[WorldEngine Presets] No worldbook entries, character description, user persona, or active preset found.');
    }

    var sections = [];
    if (worldbookText.trim()) sections.push('## \u4e16\u754c\u4e66\u5185\u5bb9\n\n' + worldbookText);
    if (characterText.trim()) sections.push('## \u5f53\u524d\u89d2\u8272\u5361\u63cf\u8ff0\n\n' + characterText);
    if (personaText.trim()) sections.push('## \u7528\u6237 persona\n\n' + personaText);
    if (presetText.trim()) sections.push('## \u5f53\u524d\u4e16\u754c\u9884\u8bbe\n\n' + presetText);
    return {
      worldbookText: worldbookText,
      characterText: characterText,
      personaText: personaText,
      presetText: presetText,
      sections: sections.join('\n\n')
    };
  }

  //  AUTO-GENERATE FROM WORLDBOOK
  // ═════════════════════════════════════════════

  /**
   * Auto-generate a preset by reading the worldbook and optionally the current
   * character card, then asking the LLM to produce direct world-specific wording.
   * @param {Object} options
   * @param {boolean} options.includeCharacterDescription
   * @returns {Promise<Object>} — the generated preset object
   */
  async function generateFromWorldbook(options) {
    options = options || {};
    var includeCharacterDescription = options.includeCharacterDescription === true;
    var moduleSelection = normalizeGenerationModuleSelection(options);
    var moduleSelectionPrompt = buildModuleSelectionPrompt(moduleSelection);

    var source = await buildGenerationSource({
      includeCharacterDescription: includeCharacterDescription,
      includeUserPersona: options.includeUserPersona !== false,
      worldbookEntryIds: Array.isArray(options.worldbookEntryIds) ? options.worldbookEntryIds : null
    });
    if (normalizeGenerationMode(options) === 'free') {
      return generateFreePresetFromSource(source, options);
    }
    var worldbookText = source.worldbookText;
    var characterSection = source.characterText
      ? '## \u5f53\u524d\u89d2\u8272\u5361\u63cf\u8ff0\n\n' + source.characterText + '\n\n'
      : '';
    var personaSection = source.personaText
      ? '## \u7528\u6237 persona\n\n' + source.personaText + '\n\n'
      : '';

    // 3. Build the generation prompt
    var systemPrompt = '你是一个世界观分析专家。用户会给你世界书条目和/或当前 SillyTavern 角色卡描述。你需要分析其中描述的世界类型（奇幻、科幻、历史、现代、末日等），然后生成一套完整的世界引擎预设。';

    var userPrompt = '请分析以下设定内容，判断其世界观类型，然后生成一套完整的世界引擎预设。\n\n'
      + '## 世界书内容\n\n' + (worldbookText || '（未提供世界书条目）') + '\n\n'
      + characterSection
      + personaSection
      + buildUserGuidanceSection(options.userGuidance)
      + moduleSelectionPrompt
      + '## 要求\n\n'
      + '请严格按以下JSON格式返回结果（只返回JSON，不要返回其他内容）：\n\n'
      + '```json\n'
      + '{\n'
      + '  "name": "预设显示名称",\n'
      + '  "description": "对这个世界观的一句话描述",\n'
      + '  "showStability": true,\n'
      + '  "disabledModules": [],\n'
      + '  "reputation": {\n'
      + '    "dimensions": {\n'
      + '      "authority": { "name": "权力维度名称", "description": "描述" },\n'
      + '      "common": { "name": "民众维度名称", "description": "描述" },\n'
      + '      "shadow": { "name": "暗面维度名称", "description": "描述" },\n'
      + '      "circuit": { "name": "同行维度名称", "description": "描述" }\n'
      + '    },\n'
      + '    "verdicts": {\n'
      + '      "authority": { "天怒人怨": "...", "声名狼藉": "...", "默默无闻": "...", "受人尊敬": "...", "万众敬仰": "..." },\n'
      + '      "common":    { "天怒人怨": "...", "声名狼藉": "...", "默默无闻": "...", "受人尊敬": "...", "万众敬仰": "..." },\n'
      + '      "shadow":    { "天怒人怨": "...", "声名狼藉": "...", "默默无闻": "...", "受人尊敬": "...", "万众敬仰": "..." },\n'
      + '      "circuit":   { "天怒人怨": "...", "声名狼藉": "...", "默默无闻": "...", "受人尊敬": "...", "万众敬仰": "..." }\n'
      + '    }\n'
      + '  },\n'
      + '  "factions": {\n'
      + '    "statusVerdicts":   { "鼎盛": "...", "稳固": "...", "倾轧": "...", "困顿": "...", "衰落": "...", "瓦解": "..." },\n'
      + '    "relationVerdicts": { "血盟": "...（用{{user}}指代玩家）", "盟友": "...", "友好": "...", "中立": "...", "冷淡": "...", "敌对": "...", "世仇": "..." }\n'
      + '  },\n'
      + '  "economy": {\n'
      + '    "climateVerdicts": { "繁荣": "...", "平稳": "...", "衰退": "...", "动荡": "..." }\n'
      + '  },\n'
      + '  "regionalIncidents": {\n'
      + '    "chance": 0.03,\n'
      + '    "durationRounds": 5,\n'
      + '    "cooldownRounds": 5,\n'
      + '    "types": [\n'
      + '      { "type": "英文标识", "label": "中文名称", "weight": 10, "guide": "该事件的详细示例场景描述" }\n'
      + '    ]\n'
      + '  },\n'
      + buildLocalMechanicsJsonTemplate()
      + '  "schemaOverrides": {\n'
      + '    "factions": {\n'
      + '      "addFields": {\n'
      + '        "resources": { "type": "array<string>", "description": "该势力真正掌握、会影响行动能力的世界专属资源", "example": ["净水站", "弹药库"], "display": true },\n'
      + '        "threatLevel": { "type": "number", "description": "该势力对主角或当前局势造成的可追踪威胁等级，1-5", "example": 4, "display": true }\n'
      + '      }\n'
      + '    },\n'
      + '    "events": {\n'
      + '      "addFields": {\n'
      + '        "riskOwner": { "type": "string", "description": "最直接推动或承担该事件风险的势力、人物或机制", "example": "边境军需官", "display": true },\n'
      + '        "pressure": { "type": "enum", "enum": ["低", "中", "高", "临界"], "description": "事件对世界局势形成的压力等级", "example": "高", "display": true }\n'
      + '      }\n'
      + '    }\n'
      + '  },\n'
      + '  "ui": {\n'
      + '    "labels": {\n'
      + '      "世界核心": "...", "稳定度": "...", "事件": "...", "势力": "...", "风声": "...", "大势": "...",\n'
      + '      "局势": "...", "关系": "...", "资源": "...", "天下大势": "...", "区域事件": "...", "账本": "...",\n'
      + '      "事件链": "...", "影响链": "...", "声誉": "...", "仇敌录": "...", "经济": "...", "秘密": "...", "世界摘要": "...",\n'
      + '      "天下太平": "...", "暗流浮动": "...", "局势紧张": "...", "动荡失序": "...", "崩坏边缘": "..."\n'
      + '    },\n'
      + '    "moods": { "天下太平": "...", "暗流浮动": "...", "局势紧张": "...", "动荡失序": "...", "崩坏边缘": "..." },\n'
      + '    "summaryEmpty": "世界尚未开始时显示的一句话",\n'
      + '    "moduleLabels": {\n'
      + '      "world": "模块一：世界运转", "events": "模块二：事件链", "factions": "模块三：势力",\n'
      + '      "winds": "模块四：风声", "influence": "模块五：影响链", "contact": "模块六：信息传播与知情边界",\n'
      + '      "reputation": "模块七：声誉", "economy": "模块八：经济", "enemies": "模块九：仇敌录",\n'
      + '      "regional": "模块十：区域突发事件", "blackbox": "模块十一：信息黑盒", "trends": "模块十二：天下大势"\n'
      + '    }\n'
      + '  }\n'
      + '}\n'
      + '```\n\n'
      + '注意事项：\n'
      + '- 所有文本使用中文。\n'
      + '- 【关键】verdicts / statusVerdicts / relationVerdicts / climateVerdicts 的 key 必须原样使用上面给出的固定中文枚举（天怒人怨/声名狼藉/默默无闻/受人尊敬/万众敬仰；鼎盛/稳固/倾轧/困顿/衰落/瓦解；血盟/盟友/友好/中立/冷淡/敌对/世仇；繁荣/平稳/衰退/动荡），不要翻译、不要改写、不要增减——这些是世界引擎的内部固定枚举。\n'
      + '- 不要返回 levels / statuses / relations / climates 这些数组，它们由引擎固定，无需生成。\n'
      + '- verdicts 的“描述文字”才用目标世界观的风格来写，要生动具体、贴合世界观。\n'
      + '- 不要返回 termMap。不要使用“原始术语 -> 替换词”的方式；请直接在 reputation.dimensions、verdicts 描述、ui.labels、ui.moods、schemaOverrides 的说明与示例中写出贴合当前世界的显示文本。\n'
      + '- regionalIncidents.types 需要约12种，weight 总和约为100。\n'
      + buildLocalMechanicsGenerationRequirements()
      + '- ui.labels 直接定义界面显示文案：key 必须原样使用上面给出的中文词，value 是当前世界观下自然的叫法（例如赛博朋克可把“世界核心”改为“系统核心”、“账本”改为“事件日志”）。\n'
      + '- ui.moods 的 key 必须用固定的五档（天下太平/暗流浮动/局势紧张/动荡失序/崩坏边缘），value 是该世界观下对应稳定度档位的一句氛围短语（替换古风诗句）。\n'
      + '- ui.moduleLabels 定义12个推演模块在“模块开关”面板里的显示名：key 必须原样使用上面给出的英文 moduleId（world/events/factions/winds/influence/contact/reputation/economy/enemies/regional/blackbox/trends），value 保留“模块X：”前缀、只把冒号后的词替换成当前世界观的叫法（例如赛博朋克“模块三：势力”→“模块三：企业”，“模块十一：信息黑盒”→“模块十一：暗网档案”）。必须12个模块全部给出，不要遗漏。\n'
      + '- showStability：布尔值。是否需要顶部「世界稳定度」仪表（追踪宏观局势、势力博弈、经济动荡、危机升级汇总的总压力）。若世界以人物关系、恋爱、日常、单一场景为核心、缺乏宏观势力/经济/冲突动态，设为 false；若为王朝、势力争霸、末世、战争、政治等宏观叙事，设为 true。拿不准时设为 true。\n'
      + '- 只返回JSON，不要有额外文字\n'
      + '- 如果本次要求返回 disabledModules，必须放在顶层，且只能包含这些英文 moduleId：' + BUILTIN_MODULE_IDS.join(', ')
      + '\n- schemaOverrides 设计原则：只为“世界运转真正重要、会反复追踪、会影响推演判断”的概念新增字段；不要把长设定、背景介绍、一次性描述塞进字段。'
      + '\n- schemaOverrides 字段数量必须克制：优先每个相关模块新增 1-3 个关键字段；如果世界书没有强需求，可以返回空对象 {}。'
      + '\n- schemaOverrides 类型优先级：能枚举就用 enum，能量化就用 number，能判断开关就用 boolean；普通 string 只用于名称、归属、短说明；array/object 只用于确实需要多个条目或结构化数据。'
      + '\n- schemaOverrides 每个新增字段必须包含 type、description、example、display；display=true 表示适合在主面板卡片展示，display=false 表示只用于推演结构或高级数据，不直接展示。'
      + '\n- schemaOverrides 可用模块：events、factions、trends、winds、economy、reputation、enemies、influence、regional、blackbox。优先修改最贴合世界核心玩法的模块，不要每个模块都硬加字段。'
      + '\n- schemaOverrides 字段名用英文 camelCase，例如 threatLevel、magicDensity、courtFavor；字段说明和值使用当前世界观语言。'
      + '\n- 世界类型建议：末世优先考虑 resources、dangerLevel、baseStatus、scarcityIndex；宫廷优先考虑 stance、favor、leverage、secretDebt；科幻优先考虑 fleetPower、techTier、colonyStatus、supplyLine；魔法优先考虑 magicDensity、school、tabooRisk、manaReserve。只选择真正适合当前世界的字段。'
      + '\n- schemaOverrides 不要删除基础字段，除非世界书明确说明该概念完全不适用；隐藏字段用 hiddenFields，修改字段说明或枚举用 overrideFields，新增字段用 addFields。';

    // 4. Call the API
    if (!window.WORLD_ENGINE_API || typeof window.WORLD_ENGINE_API.callApi !== 'function') {
      throw new Error('[WorldEngine Presets] window.WORLD_ENGINE_API.callApi is not available');
    }

    var response = await window.WORLD_ENGINE_API.callApi(systemPrompt + '\n\n' + userPrompt, 8000, 0.7);
    if (!response) {
      throw new Error('[WorldEngine Presets] API returned empty response');
    }

    // 5. Parse the result
    var parsed = parseGenerationJson(response);

    // 6. Build a valid preset from the parsed data
    var timestamp = Date.now();
    var preset = {
      id: 'worldbook_generated_' + timestamp,
      name: parsed.name || '世界书生成预设',
      description: parsed.description || '基于世界书自动生成的预设',
      builtin: false,
      reputation: parsed.reputation || ANCIENT_CHINESE.reputation,
      factions: parsed.factions || ANCIENT_CHINESE.factions,
      economy: parsed.economy || ANCIENT_CHINESE.economy,
      regionalIncidents: parsed.regionalIncidents || ANCIENT_CHINESE.regionalIncidents,
      localMechanics: parsed.localMechanics || {},
      termMap: {},
      ui: parsed.ui || {},
      schemaOverrides: parsed.schemaOverrides || {},
      disabledModules: validateGeneratedDisabledModules(parsed.disabledModules, moduleSelection),
      customRules: '',
      showStability: parsed.showStability !== false
    };

    // Validate basic structure integrity — fill in missing nested fields with defaults
    if (!preset.reputation.dimensions) preset.reputation.dimensions = ANCIENT_CHINESE.reputation.dimensions;
    if (!preset.reputation.levels) preset.reputation.levels = ANCIENT_CHINESE.reputation.levels;
    if (!preset.reputation.verdicts) preset.reputation.verdicts = ANCIENT_CHINESE.reputation.verdicts;
    if (!preset.factions.statuses) preset.factions.statuses = ANCIENT_CHINESE.factions.statuses;
    if (!preset.factions.statusVerdicts) preset.factions.statusVerdicts = ANCIENT_CHINESE.factions.statusVerdicts;
    if (!preset.factions.relations) preset.factions.relations = ANCIENT_CHINESE.factions.relations;
    if (!preset.factions.relationVerdicts) preset.factions.relationVerdicts = ANCIENT_CHINESE.factions.relationVerdicts;
    if (!preset.economy.climates) preset.economy.climates = ANCIENT_CHINESE.economy.climates;
    if (!preset.economy.climateVerdicts) preset.economy.climateVerdicts = ANCIENT_CHINESE.economy.climateVerdicts;
    if (!preset.regionalIncidents.types) preset.regionalIncidents.types = ANCIENT_CHINESE.regionalIncidents.types;

    // Auto-save the generated preset (saveCustomPreset normalizes it)
    saveCustomPreset(preset);
    console.log('[WorldEngine Presets] Generated and saved preset from worldbook: ' + preset.name + ' (' + preset.id + ')');

    // Return the normalized stored version so callers get the same shape the
    // engine will actually use (canonical enums, filled defaults).
    var stored = findPresetById(preset.id);
    return stored || deepClone(preset);
  }

  // ═════════════════════════════════════════════


  /**
   * Generate a concise extra evolution prompt from the same setting sources used
   * by world-preset generation: worldbook, optional character card, and persona.
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async function generateTonePrompt(options) {
    options = options || {};
    var source = await buildGenerationSource({
      includeCharacterDescription: options.includeCharacterDescription === true,
      includeUserPersona: options.includeUserPersona !== false,
      includePreset: options.includePreset === true
    });

    if (!window.WORLD_ENGINE_API || typeof window.WORLD_ENGINE_API.callApi !== 'function') {
      throw new Error('[WorldEngine Presets] window.WORLD_ENGINE_API.callApi is not available');
    }

    var guidanceSection = buildUserGuidanceSection(options.userGuidance);
    var prompt = 'You generate an extra prompt for World Engine background simulation. Output concise Simplified Chinese text only.\n\n'
      + source.sections + '\n\n'
      + guidanceSection
      + 'Requirements:\n'
      + '- Return only the prompt body. Do not return JSON, explanations, or code fences.\n'
      + '- Make simulation fit this world: world operating logic, priorities, hard constraints, trackable states, and common failure modes.\n'
      + '- Do not retell lore, write plot, decide for the user or characters, or invent unsupported factions/rules.\n'
      + '- Keep it restrained, about 300-800 Chinese characters, with clear short rules or bullets.\n'
      + '- Prefer executable guidance: how resources change, factions react, danger escalates, secrets surface, and technology/magic/institutions constrain events.\n'
      + '- If an active preset section is provided, align with its schemaOverrides, disabled modules, event types, and custom rules; do not contradict that structure.\n'
      + '- If character card or persona conflicts with worldbook, worldbook rules win; use character/persona only as current perspective and focus.';

    var response = await window.WORLD_ENGINE_API.callApi(prompt, 2200, 0.55);
    var text = String(response || '').trim();
    text = text.replace(new RegExp('^' + String.fromCharCode(96, 96, 96) + '(?:text|markdown)?\\s*', 'i'), '')
      .replace(new RegExp('\\s*' + String.fromCharCode(96, 96, 96) + '\\s*$', 'i'), '')
      .trim();
    if (!text) throw new Error('[WorldEngine Presets] API returned empty tone prompt');
    if (text.length > 3000) text = text.substring(0, 3000).trim();
    return text;
  }

  //  UI CHROME LABELS (per world-view)
  //  Canonical Chinese chrome words -> display wording. Stability tier KEYS
  //  stay canonical (logic unchanged); only the displayed text is swapped.
  // ═════════════════════════════════════════════
  var ANCIENT_UI = {
    labels: {},  // identity: canonical wording IS the ancient wording
    moods: {
      '天下太平': '海静不扬波', '暗流浮动': '暗水带花流', '局势紧张': '云急风更恶',
      '动荡失序': '乾坤含疮痍', '崩坏边缘': '坤轴欹将折'
    },
    poems: {
      situation: '天下云集响应', events: '事至而应',
      relations: '同声相应，同气相求', resources: '地藏无尽藏'
    },
    mottos: {
      trends: '天下之势，以渐而成', regional: '一方有警，四面皆惊', ledger: '毫厘皆有来历',
      events: '牵一发而全身动', winds: '风起于青萍之末', influence: '牵枝而动叶',
      reputation: '人之有誉，如影随形', factions: '大树之下，草不沾霜', enemies: '仇者快，亲者痛',
      economy: '食者民之本，货者民用之资', blackbox: '墙有耳，伏寇在侧'
    },
    summaryEmpty: '世界正在苏醒，一切尚未可知。'
  };

  var PRESET_UI_OVERRIDES = {
    modern: {
      labels: {
        '世界核心': '社会全局', '风声': '舆情', '大势': '大趋势', '天下大势': '宏观趋势',
        '账本': '大事记', '事件账本': '大事记', '仇敌录': '宿敌录', '秘密': '隐私',
        '世界摘要': '全局摘要', '天下太平': '社会安定', '暗流浮动': '暗流涌动',
        '局势紧张': '局势紧张', '动荡失序': '秩序动摇', '崩坏边缘': '濒临失控'
      },
      moods: {
        '天下太平': '风平浪静', '暗流浮动': '暗流涌动', '局势紧张': '气氛渐紧',
        '动荡失序': '秩序松动', '崩坏边缘': '濒临失控'
      },
      poems: {},
      summaryEmpty: '世界正在运转，一切照常。'
    },
    cyberpunk: {
      labels: {
        '世界核心': '系统核心', '稳定度': '秩序指数', '势力': '阵营', '风声': '情报',
        '大势': '趋势', '局势': '态势', '天下大势': '宏观趋势', '账本': '事件日志',
        '事件账本': '事件日志', '声誉': '声望', '仇敌录': '威胁名单', '秘密': '隐秘数据',
        '世界摘要': '系统摘要', '天下太平': '秩序井然', '暗流浮动': '暗流涌动',
        '局势紧张': '警报上升', '动荡失序': '系统失序', '崩坏边缘': '濒临熔毁'
      },
      moods: {
        '天下太平': '霓虹如常运转', '暗流浮动': '数据暗流低鸣', '局势紧张': '警报频率上升',
        '动荡失序': '防火墙正在崩解', '崩坏边缘': '核心即将熔毁'
      },
      poems: {},
      summaryEmpty: '系统正在启动，数据尚未同步。'
    },
    western_fantasy: {
      labels: {
        '世界核心': '世界之核', '风声': '传闻', '大势': '时局', '天下大势': '时代洪流',
        '账本': '编年史', '事件账本': '编年史', '仇敌录': '宿敌录', '秘密': '秘辛',
        '世界摘要': '世界纪要', '天下太平': '四海升平', '暗流浮动': '暗潮涌动',
        '局势紧张': '山雨欲来', '动荡失序': '烽烟四起', '崩坏边缘': '末日将临'
      },
      moods: {
        '天下太平': '风和日丽，万物安宁', '暗流浮动': '暗影悄然滋长', '局势紧张': '山雨欲来风满楼',
        '动荡失序': '战火席卷大地', '崩坏边缘': '诸神黄昏将至'
      },
      poems: {},
      summaryEmpty: '世界尚在沉睡，传说未启。'
    },
    post_apocalyptic: {
      labels: {
        '世界核心': '废土核心', '稳定度': '秩序残值', '势力': '派系', '风声': '流言',
        '大势': '局势', '天下大势': '废土大局', '账本': '残存记录', '事件账本': '残存记录',
        '声誉': '名声', '仇敌录': '死敌录', '秘密': '藏匿', '世界摘要': '废土纪要',
        '天下太平': '勉强维生', '暗流浮动': '暗流涌动', '局势紧张': '危机四伏',
        '动荡失序': '秩序崩坏', '崩坏边缘': '濒临灭绝'
      },
      moods: {
        '天下太平': '废土难得的平静', '暗流浮动': '危险悄然逼近', '局势紧张': '空气中弥漫血腥',
        '动荡失序': '秩序彻底瓦解', '崩坏边缘': '末日近在眼前'
      },
      poems: {},
      summaryEmpty: '废土沉寂，幸存者尚未现身。'
    }
  };

  function normalizeUI(raw) {
    var src = isPlainObject(raw) ? raw : {};
    return {
      labels: normalizeStringMap(src.labels, {}),
      moods: normalizeStringMap(src.moods, {}),
      moduleLabels: normalizeStringMap(src.moduleLabels, {}),
      poems: normalizeStringMap(src.poems, {}),
      mottos: normalizeStringMap(src.mottos, {}),
      summaryEmpty: normalizeText(src.summaryEmpty, '')
    };
  }

  // poems & mottos do NOT inherit ancient defaults once a genre override exists,
  // so non-ancient worlds simply hide the 古风 flavor lines unless they define
  // their own. labels & moods do inherit (missing keys fall back to canonical).
  function mergeUI(base, ov) {
    base = base || ANCIENT_UI;
    var hasOv = !!ov;
    ov = ov || {};
    return {
      labels: Object.assign({}, base.labels, ov.labels || {}),
      moods: Object.assign({}, base.moods, ov.moods || {}),
      moduleLabels: Object.assign({}, base.moduleLabels, ov.moduleLabels || {}),
      poems: hasOv ? Object.assign({}, ov.poems || {}) : Object.assign({}, base.poems),
      mottos: hasOv ? Object.assign({}, ov.mottos || {}) : Object.assign({}, base.mottos),
      summaryEmpty: ov.summaryEmpty || base.summaryEmpty
    };
  }

  function getActiveUI() {
    var p = getActivePreset();
    var ov = null;
    if (p && p.ui && (
        (p.ui.labels && Object.keys(p.ui.labels).length) ||
        (p.ui.moods && Object.keys(p.ui.moods).length) ||
        (p.ui.moduleLabels && Object.keys(p.ui.moduleLabels).length) ||
        p.ui.summaryEmpty)) {
      ov = p.ui;
    } else if (p && PRESET_UI_OVERRIDES[p.id]) {
      ov = PRESET_UI_OVERRIDES[p.id];
    }
    return mergeUI(ANCIENT_UI, ov);
  }

  function uiLabel(key) {
    if (!key) return key;
    var u = getActiveUI();
    return (u.labels && u.labels[key]) || key;
  }
  function uiMood(tier) {            // '' => caller keeps its own default
    var u = getActiveUI();
    return (u.moods && u.moods[tier]) || '';
  }
  function uiModuleLabel(moduleId) { // '' => caller falls back to default module name
    if (!moduleId) return '';
    var u = getActiveUI();
    return (u.moduleLabels && u.moduleLabels[moduleId]) || '';
  }
  function uiPoem(view) {            // '' => caller hides the poem line
    var u = getActiveUI();
    return (u.poems && u.poems[view] != null) ? u.poems[view] : '';
  }
  function uiMotto(sectionId) {      // '' => caller hides the motto line
    var u = getActiveUI();
    return (u.mottos && u.mottos[sectionId] != null) ? u.mottos[sectionId] : '';
  }
  function uiSummaryEmpty() {
    var u = getActiveUI();
    return u.summaryEmpty || ANCIENT_UI.summaryEmpty;
  }

  // ═════════════════════════════════════════════
  //  PUBLIC API — expose on window
  // ═════════════════════════════════════════════
  window.WORLD_ENGINE_PRESETS = {
    getActivePreset:    getActivePreset,
    getActivePresetId:  getActivePresetId,
    setActivePreset:    setActivePreset,
    getAllPresets:       getAllPresets,
    getBuiltinPresets:  getBuiltinPresets,
    getCustomPresets:   getCustomPresets,
    saveCustomPreset:   saveCustomPreset,
    deleteCustomPreset: deleteCustomPreset,
    applyTermMap:       applyTermMap,
    applyDisplayTerms:  applyDisplayTerms,
    applyPromptTerms:   applyPromptTerms,
    uiLabel:            uiLabel,
    uiMood:             uiMood,
    uiModuleLabel:      uiModuleLabel,
    uiPoem:             uiPoem,
    uiMotto:            uiMotto,
    uiSummaryEmpty:     uiSummaryEmpty,
    normalizePreset:    normalizePreset,
    normalizeLocalMechanics: normalizeLocalMechanics,
    getLocalMechanicsDefaults: function () { return deepClone(LOCAL_MECHANICS_DEFAULTS); },
    migratePreset:      migratePreset,
    getInternalSchema:  function () { return deepClone(INTERNAL_SCHEMA); },
    _VERDICT_ENGINE: VerdictEngine,
    _VERDICT_CONFIGS: VERDICT_CONFIGS,
    generateFromWorldbook: generateFromWorldbook,
    _buildGenerationSource: buildGenerationSource,
    _buildFreeGenerationPrompt: buildFreeGenerationPrompt,
    generateTonePrompt: generateTonePrompt,
    exportPreset:       exportPreset,
    importPreset:       importPreset,
    validateSchemaOverrides: validateSchemaOverrides,
    _normalizeModuleDescriptors: normalizeModuleDescriptors
  };

  console.log('[WorldEngine Presets] Module loaded. Built-in presets: ' + BUILTIN_PRESETS.map(function (p) { return p.name; }).join(', '));
})();
