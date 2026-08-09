// world-engine-rules-loader.js — 世界引擎全部规则
// 规则按 UI 面板区块分模块，共 12 个模块
window.WORLD_ENGINE_RULES = (function() {

  // ===================== 规则原文 =====================

  const RULES = [
    // ========== 模块一：世界运转 ==========
    {
      moduleId: 'world',
      comment: '模块一：世界运转',
      content: `<world_engine>
世界是活的。不在{{user}}视线内的人也在过自己的生活。

一、核心原则（世界非中心化）
本世界是一个独立运转的生态系统，{{user}}只是其中的一个参与者，而非世界的中心。
- NPC有自己的生活目标、日程、社交圈和情感，不会无缘无故围绕{{user}}转。
- 事件链、风声、团体进度等即使与{{user}}无关，也会自动推进。
- 持续中的天下大势是每轮推演都必须考虑的世界级约束。
- AI在生成剧情时，应优先考虑世界的独立运转（后台推演），其次才是{{user}}的参与和感知。
- {{user}}可以通过面板看到世界的全貌（玩家全知），但主角本人只能感知到与他相关或他恰好遇到的部分。
- 禁止默认"所有事情都与{{user}}有关"。与{{user}}无关的事件是世界的常态，不是例外。

二、感知边界
- 面板记录的是玩家可见的世界状态，不等于{{user}}或NPC已经知道。
- 正文中的角色只能依据其亲眼所见、亲耳所闻、合法传播、通讯、汇报、调查、组织命令或实际接触到的信息行动。
- 远处、隐秘、未传播或仅存在于面板中的状态，不得直接进入角色认知；必须先经过风声、主动接触、事件链爆发、物资/价格变化、交通阻断、通讯、汇报、调查等合理路径，才能影响正文反应。

三、推演轮次与时间感知
每次世界引擎调用代表一次后台推演轮，不等于输入上下文中的每一轮对话。推演前必须先根据新增剧情、场景节奏、行动消耗、移动距离、等待/休息/交谈/战斗/办事等线索，自行估计“自上次世界状态更新以来”经过的剧情时间。该时间可以是片刻、几分钟、数小时、数日或更久，也可以几乎没有明显流逝。

后台变化必须与这次估计的时间跨度匹配：
- 时间很短时，未在场人物通常只产生轻微或即时反应；长期计划、跨区域传播、经济与势力结构不应大幅变化。
- 时间较长时，未在场人物可按日程推进活动；风声、事件链、势力、经济可出现与时间尺度相称的变化。
- 事件链仍按骰子系统提供的基线推进，但 API 必须结合本轮实际经过的剧情时间与新增事实判断是否沿用、放缓、停滞或因明确因果改写。
- 风声只根据本轮新增传播节点、传播范围变化或持续发酵情况更新；公告和消息通常保持稳定，流言可能夸张或扭曲，舆情可能随新信息转向。

本轮推演重点是“相对上一次世界状态发生了什么变化”。输入上下文中的旧对话只作为背景和因果依据，不得把已经处理过的历史内容再次当作新变化。轮次推进的结果应在面板世界摘要中体现；若本轮时间跨度很短且新增事实不足，世界摘要可以说明局势基本稳定或只有轻微变化。

四、地域与势力具名
涉及地理位置或势力范围时，必须使用具体名称，不得用"全城""全国""某势力"等模糊词。
- 若世界观已预设城市/国家/势力名，则沿用（如"帝都长安"、"北境王国"）。
- 若未预设，AI应自行创造合理名称并保持前后一致，且符合世界背景。
- 风声的传播范围、事件链的影响区域、远距离层的描述均须遵守此规则。

</world_engine>`
    },
    // ========== 模块二：事件链 ==========
    {
      moduleId: 'events',
      comment: '模块二：事件链',
      content: `<event_chain>

一、双类型事件链

事件链分为两类：冲突型（conflict）与推进型（progress）。事件 type 一旦确定不得改动；同一 id 的事件后续更新必须沿用原 type。若研发过程中已经形成可独立演化的冲突，或冲突后已经启动可独立推进的善后工程，应新建另一条事件链，并在影响链中记录两者的传导关系。

【归纳优先：先识别主事项，再判断是否新建】
事件链不是事实清单、任务步骤或新闻标题，而是需要跨轮追踪的主事项。创建新事件前，必须先与已有 events 比较核心目标或矛盾、主要对象和连续执行过程。

若新内容仍在处理同一目标或矛盾，或只是已有事项的准备、执行、沟通、移动、调查、试验、阻碍、代价、局部结果、传播或善后，应沿用原 id，更新 desc、stage、level 或 stall，不得拆成新事件。时间、地点、参与者或影响范围相同只能辅助判断，不能单独决定归并。

判断是否另建事件链，主要看新内容是否围绕不同于已有事项的核心目标、矛盾或持续行动展开。事项即使仍处于筹划、试探、调查起步或矛盾初现阶段，只要已经出现具体迹象，并具有继续发展的可能，也可以建立事件链；不必等到行动路径、资源条件或成败边界完全明确。若新内容明显只是已有事项的执行环节或直接后果，则优先沿用原事件链。新的持续主体、资源体系或责任关系可作为拆分依据，但不是硬性要求。

事件类型不同不自动构成拆链理由。普通争执、事故或局部对抗仍可作为推进事件的阻碍；普通修复、救治或善后仍可作为冲突事件的结果。只有冲突或推进事项已经能够独立演化时，才分别建链，并用 influenceChain 记录传导关系。

【创建准入：事件链只记录可演化的主事项】
叙事中出现过的行动、冲突、计划、结果、变化或后续影响，不自动成为事件链。events 用于记录已经露出可追踪迹象，并可能在后续继续发展、受阻、转向或收束的事项。事项可以处于较早阶段；只要它不只是瞬间发生的一次性动作，并已表现出一定的延续可能，就可以纳入事件链继续观察。

出现以下迹象时，可以考虑创建事件链，不需要预先证明多种未来走向：
1. 已经出现具体言行、初步计划、试探行动、调查迹象、资源准备、持续矛盾或其他可追踪依据。
2. 主体、目标对象或作用范围至少有一项可以识别；其余部分暂不明确，不妨碍事项在早期阶段进入事件链。
3. 事项存在继续发展的合理空间。即使尚不能确定一定会跨越多个轮次，也不必等待其完全成熟后再创建。

纯粹的情绪表达、没有任何现实迹象的猜测、明确已经结束且没有后续空间的一次性事项，通常无需创建事件链。当前场景中的行动若已经显露持续矛盾、后续安排、调查方向或进一步行动的可能，仍可作为早期事件纳入。已有事项的明确局部步骤则优先归入原事件链。其他无需建链的影响可写入世界摘要、风声、声誉、势力、经济、黑盒或影响链。

已爆发/已完成原则上用于收束已有事件链。首次识别的重大事项若本体仍有未决目标或执行过程，应按实际进程创建为非终局事件；若只是后果持续而事项本体已经闭合，则不得创建事件链。

1. 冲突型（conflict）— 用于报复、通缉、派系摩擦、追杀、战争、清算等会滚向爆发的矛盾链。
正常推进顺序固定为：萌芽 → 发酵 → 逼近 → 已爆发。
  - 萌芽：冲突刚出现苗头，只有少数人察觉，尚未形成公开压力。
  - 发酵：矛盾开始扩散，组织、人手、传闻或报复动机正在聚集。
  - 逼近：冲突即将落到具体行动或直接影响，已经接近爆发点。
  - 已爆发：冲突结果落地，追杀、通缉、械斗、封锁、清算等已经发生。
  - 已消散：冲突失去动机、执行者、资源、目标或时效，已经确定不会继续爆发。不是正常推进阶段，只能由AI根据明确因果直接判定。
冲突型 level 表示冲突烈度和失控势能，Lv 越高越容易推进。

2. 推进型（progress）— 用于研发、建设、训练、调查、派人办事、商路开辟、资源筹措、制度改革等会滚向完成的事务链。
正常推进顺序固定为：筹备 → 执行 → 关键 → 已完成。
  - 筹备：资源、人手、材料、情报、路线或计划正在准备，尚未全面展开。
  - 执行：事项已经实际开始，有持续投入、行动痕迹和阶段性消耗。
  - 关键：接近结果，最容易被干扰、截胡、反转、延期或付出代价。
  - 已完成：成果落地并进入世界状态，可能生成后续事件、风声、经济或势力变化。
  - 已失败：事项因执行者退出、资源耗尽、关键条件永久丧失、被有效反制或时效过期而确定无法完成。不是正常推进阶段，只能由AI根据明确因果直接判定。
推进型 level 表示完成难度与影响规模，Lv 越高越难推进。

二、推进机制（本地骰子 + API 双重驱动）

每条事件链每个阶段有 stageRound: 1-8 的阶段内进度，达到 9 时晋级到下一阶段。
- 本地系统每轮先掷骰给出一个基线推进（正常推进、受挫倒退或保持），并负责终局晋级（已爆发/已完成）。调用本规则时，传入的 stage 与 stageRound 已经是本轮骰子推进后的值，evolveResult 标注本轮骰子结果（成功/受挫/保持）。
- 在此基线之上，你（API）有权根据当前世界状态、本轮对话与因果逻辑，自行决断事件进程：可以沿用骰子结果，也可以改写 stage 与 stageRound（以你返回的值为准），让进程符合剧情真实走向。骰子负责防止事件停滞，你负责保证进程合理。
- 所有终局都可由你根据明确因果直接判定，包括正面终局「已爆发」（冲突型）/「已完成」（推进型）——剧情已经走到爆发或完成时，你可以直接给出，不必等骰子一格格爬。
- 其中「已消散」（冲突型）与「已失败」（推进型）两个负面终局只能由你判定，骰子永远不会自动给出。

三、事件链分级

【冲突型事项分级】
- Lv.1 个人摩擦：口角、普通斗殴、小额偷窃。演化上限：当事人及直接上级/亲属报复。极值后果：挨打、赔钱。
- Lv.2 局部冲突：重伤他人、砸毁店铺、公然羞辱。演化上限：所在街区或单一普通团体。极值后果：区域悬赏、帮派追击。
- Lv.3 区域震荡：杀死核心人物、屠杀平民、炸毁设施。演化上限：整个城市或多个顶级势力。极值后果：全城通缉、不死不休。
- Lv.4 世界危机：刺杀君主、引发灭城。演化上限：无限制。

【推进型事项分级】
- Lv.1 个人/小规模事项：单人或少数人能完成，资源需求低。例：打探普通消息、修补装备、配一副常见药、派人送信、招募临时帮手。
- Lv.2 局部事务：需要稳定人手、材料、路线或小型组织配合。例：建立临时据点、研发改良配方、训练小队、安排潜入、打通短程货路。
- Lv.3 区域级计划：需要多个组织、关键人物或稀缺资源协同。例：建造大型工坊、研发军用技术、策反关键人物、部署区域情报网、迁移大批物资。
- Lv.4 世界/政权级工程：超大规模、长期、跨区域或改变权力结构的计划。例：铸造镇国神器、建立新政权制度、重构大陆商路、研发颠覆性技术、大规模移民筑城。
推进型 level 表示完成难度与影响规模，不表示危险烈度。Lv越高，推进越慢、阻力越大。

四、特权修正法则

当受害者的地位/权力高于{{user}}时，事件的实际定级发生"特权跃升"：
- 若受害者为【核心人物/特权阶级/朝堂高层】：所有Lv.1行为自动跃升为Lv.2（如：顶撞权贵=重罪）；Lv.2行为自动跃升为Lv.3（如：打伤权贵=全城通缉）。
- 若受害者为【顶级势力领袖/皇室】：任何冒犯起步即为Lv.3甚至Lv.4。
- 反之，若{{user}}权力地位远高于受害者，事件级别可被权力强行压低。

五、消散、失败与停滞

事件链不是命运。事件链可以停滞，也可以走向负面终局。AI不得为推进事件链而违反世界规则或势力平衡。

【停滞与负面终局的区别】
- 停滞：当前无法推进，但仍存在合理恢复条件。设置 stall=true，保持当前 stage，并在desc中写明恢复条件。
- 已消散：冲突已永久失去动机、执行者、资源、目标或时效。直接设置 stage="已消散"。
- 已失败：事项已永久失去完成条件或目标已不可达成。直接设置 stage="已失败"。
- 仅仅连续多轮没有进展，不足以判定已消散或已失败。
- 已爆发、已消散、已完成、已失败均为终局，进入后不得恢复为非终局阶段；如需重新开始，必须创建新事件链。

【消散/失败/停滞判断条件（满足任一）】
1. 物理阻断：执行方无法物理到达目标
2. 能力不足：执行方实力/资源不足以完成当前阶段
3. 信息断裂：执行方丢失目标踪迹且无合法途径重新获取（受信息传播铁律约束）
4. 资源耗尽：执行方资源枯竭，无力继续
5. 被反制：{{user}}或第三方成功实施有效反制
6. 时间过期：事件链有时效性，超时自然消亡

六、能力、路径与可达性
事件链推进必须符合执行主体的真实能力、资源、信息、地理距离、组织效率和外部阻力。事件链不会因为“需要推进”而自动获得条件。
若执行主体暂时缺少必要条件，事件链应停滞、放缓、转向准备，或进入失败/消散判断，而不是强行推进。

禁止事项：
- 禁止为推进事件链赋予执行主体超出其设定的能力、资源、情报或行动范围。
- 禁止让执行主体无视地理距离、环境危险、势力边界、信息断裂或物理阻隔。
- 禁止凭空补出关键条件；关键条件必须来自已有状态、明确行动、风声传播、资源投入、盟友协助、调查进展或合理时间积累。

【停滞期间的替代行为】
事件链停滞≠原地消失。执行主体可转入与其能力相称的低烈度准备：收集信息、积攒资源、寻找协助、等待条件变化、调整目标或改变路线。desc 中应写明停滞原因与恢复条件。
</event_chain>`
    },
    // ========== 模块三：势力 ==========
    {
      moduleId: 'factions',
      comment: '模块三：势力',
      content: `<factions>

一、势力创建准入（强制）
叙事中出现的一群人不自动成为势力。只有同时满足以下条件，才创建新的势力对象：
1. 有稳定名称或可持续识别的共同身份。
2. 有共同利益、目标或维护物，成员不是偶然聚在一起。
3. 有最低限度的组织、决策或协调能力，能够作为整体采取行动。
4. 有跨轮次持续存在并影响世界的能力。
5. 该势力必须是能相对{{user}}独立运转的外部集体。

临时围观者、一次性商队、普通宾客、散兵游勇、临时同行者、没有组织的百姓或“某地所有人”不得创建为势力。若现有世界中符合条件的势力不足3个，不得为了凑数虚构补齐。每个正式势力应有名称、维护物、排斥物、攻击性、内部权力结构和信息网络；缺少这些要素的对象只留在叙事中。
{{user}}自己的随从、班底、临时队伍、直属资产或完全受{{user}}控制的组织，不创建为 factions。
更新已有势力只依据真实变化：目标、控制范围、核心人物、关系、状态或权力支柱发生实质改变时才返回。普通日常运作不得伪造字段变化。势力彻底解散、被吞并或失去集体行动能力时，应明确反映为“瓦解”；不得把已经消失的组织继续当作活跃行动者。

二、群体行为逻辑
触发→传播→讨论→决策→行动。

三、{{user}}与群体关系演变
- 符合维护物 → 拉拢。
- 触碰维护物 → 敌意。
- 符合排斥物 → 排挤。
- 表现价值 → 私下接触。
- 选边站 → 得一方失另一方。

四、群体并非铁板一块
内部应有不同声音和派系。核心人物的个人目的可与团体整体目标不一致，甚至相悖。

五、势力字段（每轮输出）
每轮按以下字段描述各势力：
- id：已有势力沿用系统分配的 id；新势力必须显式填 null，禁止省略
- name：势力名称。改名、易帜或称号变化不改变 id；真正分裂出的新势力才创建新对象
- scope：势力直接控制或具有重大影响力的地理范围
- status：整体运势——"鼎盛"/"稳固"/"倾轧"/"困顿"/"衰落"/"瓦解"。
  鼎盛=有钱有人有势，内部铁板一块。稳固=正常运行无重大危机。倾轧=内部有派系斗争或核心人物不和，但架子还没散。困顿=资源枯竭或被外部封锁，正在咬牙硬撑。衰落=失去支柱/地盘/核心人物，滑向瓦解。瓦解=只差终局确认，已名存实亡。
- relation：该势力对{{user}}的态度，七级（以"中立"为正中）——"血盟"/"盟友"/"友好"/"中立"/"冷淡"/"敌对"/"世仇"。
  血盟=绝对信任，生死与共；盟友=地位平等，互相支援；友好=认同{{user}}，优先合作；中立=不关心不排斥；冷淡=已注意到但不打算采取行动；敌对=公开对抗；世仇=不死不休。
- currentGoal：当前目标文字
- core_person：核心人物姓名
- powerPillars：该势力当前拥有的权力支柱，最多3个，每个为1-4字的名称字符串（如"武力威慑"/"官场人脉"/"财政支持"/"民众拥护"等）。只有稳固有效、有实际力量的支柱才列入；已崩溃或失效的支柱不得保留。
※ 若为临时组建的亲属复仇团体，core_person 写"无（牵头人：XXX）"。

六、势力之间的关系
用固定词表描述势力间的关系状态，仅限使用以下7个层级词：血盟、盟友、友好、中立、冷淡、敌对、世仇。禁用层级外模糊词。
关系演变：共同行动→关系改善；冲突→关系恶化；{{user}}调解或挑拨→可改变关系。
关系影响：盟友之间共享信息、互相支援；敌对势力可能发生公开冲突，影响事件链。

七、强制介入机制
以下情况必须强制介入：relation变为敌对或世仇；{{user}}显著影响团体进度；团体成员主动接触；经济导致势力status降为困顿或衰落时下轮必须介入。

八、核心人物
每个正式势力必须有至少1名核心掌权人物。核心人物必须是掌握实际权力或资源的人。
- 【世界书优先】优先检索角色卡已预设的配角，若其社会地位与团体首领匹配，则直接提拔。
- 【自行创造】若无匹配预设角色，则自行创建，赋予姓名、职务、性格特征及个人目的。
- 【个人目的】核心人物的个人目的可与团体目标一致，也可相悖。
- 【权力影响】核心人物掌握团体最高权力。其死亡将导致团体陷入内斗、分裂、解散，或触发仇敌事件链。

九、权力支柱与权力瓦解
每个正式团体必须声明其当前拥有的 powerPillars，最多3个，每个为1-4字的名称字符串（如"武力威慑""官场人脉""财政支持"）。只列出当前稳固有效的支柱，已崩溃或失效的不得保留。
支柱变化必须写入 influenceChain，说明哪个支柱因何事件被摧毁/动摇/新建立。
{{user}}可通过事件链逐个摧毁核心人物的权力支柱。每摧毁一个支柱，其实际控制力下降，团体status应反映此变化。
所有支柱被摧毁后，该人物将失去权力及核心人物地位。此时若被杀死，不再触发type=blood，仅按仇敌录模块中"普通成员被杀"处理（type=grudge）。
</factions>`
    },
    // ========== 模块四：风声 ==========
    {
      moduleId: 'winds',
      comment: '模块四：风声',
      content: `<winds>

风声是世界中正在传播的公开说法，是事件、势力、经济、声誉与主动接触之间的信息中介。它不是客观真相记录，也不是无意义的气氛列表。

一、风声结构
- id：已有风声沿用系统分配的 id；新风声必须显式填 null，禁止省略。
- topic：风声主题。同一传播脉络允许随说法或焦点变化而改名，但必须沿用 id；禁止重复创建近义条目。
- type："announcement"/"report"/"rumor"/"sentiment"，分别表示公告、消息、流言、舆情。
- level：实际传播规模。Lv1=圈内少数人；Lv2=地方；Lv3=州郡、省份、等大区；Lv4=国家、国际、天下。
- content：当前正在传播的具体说法。
- scope：当前实际传播到的具体地区或圈层。
- source：来源与传播链。与{{user}}相关时必须写完整信息链。

二、归并优先
风声记录的是正在传播的“信息主题”，不是事实清单、细节清单、版本清单或后续标题。风声可以是真实消息、流言、误传、夸张说法或片面理解；不因真假而排除。
创建风声前，必须先判断新信息是否与已有风声属于同一信息主题。
若它们共享同一核心对象、核心事件/事项、核心说法、传播含义或社会指向，应更新已有风声，不得新建。
同一信息主题的补充、续传、细节增加、范围扩大、语气变化、版本变形、可信度变化、情绪升温或影响扩散，都应合并到原风声中，更新 content、level、scope、source 等字段。禁止仅因标题变化、措辞变化、版本后缀或传播阶段变化，创建重复风声。
只有当新信息的核心传播含义发生改变，已经指向不同对象、不同判断、不同利益关系、不同风险判断或不同群体行动时，才允许创建新风声。

三、生成边界
- 当一项具体信息被公开发布、由目击者转述、经现实渠道传递、开始在小范围内流传，或形成可以辨认的群体议论时，即可创建风声。传播可以处于起始阶段，不要求已经形成较大规模。
- 新风声应有明确的信息主题，并至少具有一定的传播价值，例如可能引起他人关注、讨论、判断或回应，或者仍有继续转述、扩散、变形的空间。不要求它已经实际改变人物行动、声誉、经济、势力或事件链，也不要求预先证明会持续多个轮次。
- 私信、密令、秘密情报等仅有明确接收者的信息不属于风声；泄露并开始传播后才创建。
- 单人随口一句且无人听闻或转述、普通寒暄、没有明确主题的闲话、纯环境气氛，以及没有带来新信息的机械复述，通常不创建风声。
- “事情重大”本身不等于“已经传播”。若尚未发生公开发布、他人听闻、转述、传递或共同议论，即使事情足够重要，也不创建风声。公告被正式公开发布，本身即可视为传播开始。
- 禁止每轮强制生成风声，禁止用"世界平静无大事"等占位风声凑数。
- 公告只证明发布者公开说过这件事，不保证内容为真；流言也可能恰好为真。风声不使用可信度或热度字段。

四、传播与升级
- 每轮检查已有风声是否获得新的合法传播节点。没有传播节点时，level 与 scope 保持不变。
- 连续多轮没有实质更新的风声会由本地系统判定消散，并在下一轮后台推演前直接删除。
- 若一条风声本轮仍在传播、变质、扩大范围或持续影响世界，必须返回相同 id 的更新；仅原样复述而没有实际变化不算更新。
- 风声寿命与消散由本地系统管理，禁止输出或操纵内部计数。
- 同一场景可即时传播；同一区域通常需1-2轮；跨区域通常需3-5轮；世界观内的广播、网络、法术通讯等可缩短时间。
- level 只表示传播规模，不表示事情的重要性或真假。
- 公告和消息传播时通常保持内容稳定；流言可能夸张、扭曲或分化；舆情可因新信息转向。
- 风声可以长期停留在原等级，但必须有持续传播或影响作为依据。

五、跨系统联动（强制）
- 风声只有传播到相关对象所在范围或圈层后，该对象才能据此行动。
- 风声可改变势力目标、资源调度或对{{user}}关注度；可触发、推进、延缓或终结事件链；可改变声誉；可促成调查、接触、封锁、抢购等行为。
- 重大经济 signals 应产生对应风声，公众因风声采取行动后又可反过来改变经济。
- 与{{user}}有关的行为只有形成覆盖对应圈层的风声后，才能改变该圈层声誉。
- 仇敌只有通过覆盖其情报来源的风声或其他合法渠道获知线索后，才能据此追踪。
- 每当风声造成跨系统变化，必须写入 influenceChain，明确"哪条风声 → 谁获知 → 采取何种行动或形成何种判断"。
- 没有实际外溢影响的风声只更新自身，禁止硬造联动。
</winds>`
    },
    // ========== 模块五：影响链 ==========
    {
      moduleId: 'influence',
      comment: '模块五：影响链',
      content: `<influence_chain>

influenceChain 用于记录重要变化在世界中的传播过程。它不是新的事件链，不参与骰子推进，不表示 stage 进度。它回答的是"什么触发了变化、直接改变了什么、又产生了什么后续余波"。

一、可记录的影响
- 事件链对风声、经济、声誉、势力行动、NPC接触的影响
- 天下大势对事件链、势力行动、经济与风声的长期约束
- 风声传播对势力判断、公众态度、官方动作的影响
- 经济变化对资源、物价、行动能力、势力计划的影响
- 声誉变化对不同圈层NPC态度和主动接触的影响
- 黑盒信息泄露或未泄露对外界认知、调查方向、错误判断的影响
- 一个事件链对另一个事件链的加速、延缓、转向、消散或失败影响

【创建准入】
只有触发源已经使另一个系统的持久状态发生实质变化时，才创建 influenceChain。必须同时满足：
1. trigger 是已经发生或已经生效的明确触发源。
2. impact 是已经发生、可观察或可验证的直接改变，不是猜测。
3. 变化跨越至少两个系统，或使另一个持续实体改变目标、状态、资源、范围或行动。
4. 这段传导对理解后续世界状态确有必要。

仅有潜在可能、情绪或气氛变化、同一事项内部的普通步骤、事件链自身的常规进度、字段之间没有真实状态改变的文字关联，均不得创建影响链。“可能引发后续”不能充当 impact；有因果依据但尚未发生的趋势只能写入 fallout。

二、三段结构
每条 influenceChain 必须使用三段结构：
- trigger：触发源。引发变化的具体事件、行动、天下大势、风声、经济变化、声誉变化或黑盒信息。
- impact：直接影响。触发源已经真实改变了什么世界状态。
- fallout：后续余波。该影响进一步扩散后产生的次生变化或下一步趋势。

三、禁止事项
- 不得把 influenceChain 当成新的事件链创建 stage 或 stageRound。
- 不得把普通事件进度流水账全部塞入 influenceChain；只有产生跨系统外溢影响时才记录。
- impact 必须是已经发生的直接变化；fallout 必须是由该影响继续扩散产生的余波，不得重复改写 trigger。
- 不得借 influenceChain 泄露黑盒信息给不知情NPC。
- 同一 trigger 已有记录时更新该记录，不要无限堆叠重复记录。
- 只有直接影响或后续余波出现实质变化时才更新同一记录；不得换一种说法重复返回。
- 当传导已经完成且没有新的余波时，不再更新。影响链是有限期因果记录，不得把它续写成永久事件链。
</influence_chain>`
    },
    // ========== 模块六：信息传播与知情边界 ==========
    {
      moduleId: 'contact',
      comment: '模块六：信息传播与知情边界',
      content: `<contact_and_info>

一、知情边界
NPC、势力、黑市、仇敌都没有读档能力，也不能读取面板信息。AI在让任何对象获知一条信息前，必须能回答：“它通过什么路径知道？”答不上来，就视为不知道。

合法获知路径包括：
- 亲眼目睹或亲耳听见。
- 被合法知情者直接告知。
- 公开信息，如公告、告示、公开宣布。
- 风声已经传播到其所在范围或圈层。
- 所属组织的情报网络覆盖该信息，并经过合理传导时间。
- 现场物证或痕迹被有能力者调查并解读。
- 世界观内明确存在且该对象有权使用的通讯、监控、追踪、占卜或类似手段。

禁止事项：
- 禁止“NPC就是知道了”。
- 禁止把面板信息直接泄露给角色。
- 禁止用“消息传得快”“有人听说了”替代具体传播路径。
- 禁止让未接触传播链的对象据此行动。

二、痕迹不等于指向
物证、痕迹、传闻通常只能证明“发生了什么”，不能自动证明“是谁做的”。
若要把事件指向{{user}}或某个身份，必须存在额外关联证据：目击者识别、独特特征、独特物品/技能、主动透露、可追溯记录、长期调查结果等。
缺少关联证据时，NPC只能形成模糊判断、错误猜测或待调查疑点，不得直接锁定{{user}}。

三、身份隔离
{{user}}的匿名、化名、伪装身份默认与本体隔离。只有在出现合法关联证据后，其他对象才能把两个身份联系起来。情报组织、黑市、仇敌也必须遵守该规则；“擅长情报”只代表更容易展开调查，不代表自动全知。
</contact_and_info>`
    },
    // ========== 模块七：声誉 ==========
    {
      moduleId: 'reputation',
      comment: '模块七：声誉',
      content: `<reputation>

一、四维声誉
{{user}}的声誉拆为四个独立维度，每个维度5级，独立升降，互不冲销。
- 朝堂之上：掌权建制力量对{{user}}的评价——朝廷/议会/公司董事会/教廷/联邦等。评价标准：守法/逆法、可用/危险、顺从/挑衅。
- 市井之间：普通百姓/市民/街头舆论对{{user}}的口碑。评价标准：仁善/暴戾、慷慨/贪婪、保护者/威胁者。
- 草莽之中：体制外力量对{{user}}的看法——绿林、走私者、佣兵、独立黑客、中间人、地下帮派等所有不在台面上吃饭的人。评价标准：不是你是否违法，而是你是否有种。敢以私力对抗体制不公的人受尊敬；只敢欺负弱者的人被鄙视。
- 同道之间：{{user}}所在行当/职业圈内的同行评价。评价标准：技艺高低、是否守行规、是否对同行有贡献。

五级层级（每个维度通用，从低到高）：天怒人怨 → 声名狼藉 → 默默无闻 → 受人尊敬 → 万众敬仰
中点为"默默无闻"，向下两级为负评（声名狼藉、天怒人怨），向上两级为正评（受人尊敬、万众敬仰）。

【变化准入】
声誉不是行为评分器，而是相关圈层已经形成的群体评价。只有同时满足“行为或结果已被合法传播到对应圈层”与“该信息足以改变该圈层对{{user}}的总体判断”时，才能调整对应维度。
单个NPC的喜欢、厌恶、感激或记仇，应体现在个人或势力关系中；没有形成圈层认知时不得写入声誉。轻微礼貌、普通交易、日常胜负和重复传播旧事，通常不足以跨越声誉等级。
只有出现足以改变当前等级的新事实时才返回 reputation；没有实质变化时不得用 lastChange 制造更新。声誉维度不会因暂时无人谈论而自动清零，后续只能由新的、已传播的群体评价改变。

二、声誉判定原则
声誉变化不是行为打分，而是“对应圈层在获知信息后形成的总体评价变化”。判断时按以下顺序：

1. 传播前提  
   行为、结果或传闻必须已经通过合法风声覆盖对应圈层；未传播、仅单人知晓、仅受害者知晓或仍在黑盒中的行为，不改变四维声誉。

2. 圈层视角  
   同一事实在不同圈层中的评价可以不同：
   - 朝堂：关注秩序、合法性、统治稳定、制度威信。
   - 市井：关注百姓安危、生活利益、公平感、是否为害地方。
   - 草莽：关注义气、胆色、反抗不公、是否欺压弱者；单纯犯罪不自动加分。
   - 同道：关注技艺、行规、行业贡献、同行信任。

3. 群体评价  
   声誉只记录圈层层面的总体评价，不记录单个 NPC 的喜欢、感激、恐惧或记仇。单一团体内部仇怨应写入 factions、enemies 或其他关系，不直接改变整体声誉。

4. 变化强度  
   只有新信息足以改变当前等级时，才调整声誉。轻微礼貌、普通交易、日常胜负、重复旧闻或没有扩散的新细节，不应改变等级。

5. 多维影响限制  
   同一事实可以影响多个维度，但必须分别符合对应圈层的评价逻辑；通常不超过 3 个维度。不得为了丰富面板强行多维加减。

三、不同观察者看不同维度
新生成NPC/团体的初始态度，按其所属圈子读取对应维度：
- 朝堂/权贵/统治阶层 → 看【朝堂之上】
- 平民/百姓/市民 → 看【市井之间】
- 草莽/地下/体制外人士 → 看【草莽之中】
- 同行/同职业/同道中人 → 看【同道之间】
- 跨圈子人士（如朝堂卧底进草莽）→ 取两个维度的综合判断

四、复合声誉效应
- 朝堂+市井双高 → "民心所向"事件链（官方授勋/民意拥戴机会）
- 市井+草莽双高 → "替天行道"事件链（百姓和草莽都认{{user}}是英雄，朝堂反而紧张）
- 草莽+同道双高 → "一方豪杰"事件链（双线人脉，草莽和同行都敬你三分）
- 朝堂高+草莽高 → "双面身份"事件链（暴露风险随时间累积）
- 任一维度跌至天怒人怨 → 该圈子内"通缉/追杀/驱逐/封杀"事件链

</reputation>`
    },
    // ========== 模块八：经济 ==========
    {
      moduleId: 'economy',
      comment: '模块八：经济',
      content: `<world_economy>

经济脉搏是世界的血液循环，不是{{user}}的个人账本。它追踪的是整体经济气候和市场中值得注意的变化。

一、经济气候

climate 表示当前区域的经济温度，用四词描述：
- 繁荣：贸易旺盛、商路安全、物价稳定偏高
- 平稳：日常运作、物价按季节自然波动
- 衰退：需求萎缩、商号倒闭、少数刚需品反而暴涨
- 动荡：战乱/灾荒/封锁导致经济秩序崩坏，以物易物回潮

climate 的 scope 是{{user}}当前所在区域及其直接关联的经济圈。远处的经济冷暖通过 signals 补充。

二、市场信号

signals 记录当前市场上值得注意的经济变化。跟踪标准：
- 该变化足以影响势力行动、NPC决策或事件链走向
- 不是日常波动——日常波动不配进 signals
- 一般不超过3条

每项包含：
- summary：一句话描述变化和影响
- scope：影响的地理范围（具体区域名，不能写"全境"）

AI 必须让每条 signal 有因果：变化的背后必须有可追溯的事件链或外部原因（天气、战事、贸易中断、新技术、囤积行为、投机）。不能凭空波动。

【创建、更新与退出】
- 只有变化已经发生在市场、物流、供需、价格或资源配置中时，才创建 signal；仅预测“可能涨价/可能短缺”不得落盘。
- 同一经济变化应更新原有 signal，不得因措辞、地点别称或后果扩展而重复创建近义条目。
- 只有幅度、范围、原因或对行动的影响发生实质变化时才更新。
- 市场恢复正常、影响已被吸收或变化已不再影响任何决策时，应从 signals 中移除，不得作为历史新闻永久保留。
- climate 只有区域整体经济温度确实跨档时才改变；单一商品或单一商铺的变化通常只进入 signal，不能代表整个经济圈。

三、风声与事件链联动

- 物价暴涨、物资枯竭等重大变化 → 产生至少1条经济消息或舆情（见模块四）。
- 人们获知经济风声并采取抢购、囤积、撤资等行动后，可反过来改变经济与事件链。
- 禁止无视距离让经济信息瞬间全城皆知——signals 的 scope 和风声的 scope 必须一致。

四、经济与事件链联动

- 连续多轮出现同一方向的严重 signal → API 应创建一个推进型事件链，表示当地正在尝试解决（开辟新商路、寻找替代品等）。
- 重大经济变化 → 影响势力间关系（受损方和受益方之间紧张度上升）。

五、禁止事项

- 禁止追踪{{user}}的个人钱包或背包。这是世界引擎，不是账房。
- 禁止日常琐碎波动进入 signals。
- 禁止物资价格毫无原因地波动。
- 禁止所有区域经济趋势完全一致。
</world_economy>`
    },
    // ========== 模块九：仇敌录 ==========
    {
      moduleId: 'enemies',
      comment: '模块九：仇敌录',
      content: `<enemies>

仇敌是因{{user}}的具体伤害行为而产生的、不可逆的个人恩怨。仇敌的核心特征是永不淡化和跨区域追踪。它与势力层面的态度对立（factions.relation）是两套完全不同的东西——势力对立源于立场和利益，可以谈判；仇敌源于伤害，不可谈判。

每条仇敌记录都有系统 id。更新已有仇敌时必须沿用原 id，即使姓名、称号或组织名称改变；新仇敌必须显式填 null，禁止省略。

【创建与更新总则】
先检查下述血仇或非致死恩怨的完整触发条件；不满足时不得因为角色表现出愤怒、敌意或扬言报复就创建仇敌。仇敌是需要长期追踪的不可逆个人恩怨，不是普通反派名单。
已有仇敌只有在定位进展、报复能力、行动阶段、组织主体或终结事实发生实质变化时才更新；不得每轮仅改写仇恨措辞。暂时无力行动只改变其行动状态，不会自动删除仇敌。

一、仇敌类型
1. 血仇（type: "blood"）— 触发条件（满足任一）：{{user}}杀死某团体的核心人物（但失去权力的前核心人物除外，见势力模块的权力瓦解）；{{user}}导致某人至亲身亡或永久致残。
   特性：永不淡化、不可谈判、复仇动机永不消失。即使复仇方资源耗尽，仇恨不会消退，只会因能力不足而暂时停滞。

2. 非致死恩怨（type: "grudge"）— 触发条件（必须同时满足）：
   - 不可逆伤害：{{user}}的行为造成了无法恢复的重大损失（废去武功、夺走毕生基业、设局导致破产/流放/被剥夺身份等）。
   - 明确复仇意愿：受害者有强烈的、明确的复仇动机，不是泛泛的"不喜欢"或"怀恨在心"。
   - 有追踪/报复能力：受害者有能力（资源、武艺、人脉、情报网）对{{user}}实施实际的追踪或报复。
   不满足以上三项的不算grudge。被{{user}}辱骂、一次商业竞争失败、街头斗殴受伤——这些都不够资格进入仇敌录，应在叙事中由AI自然体现，不落盘。
   特性：同样永不淡化，但恐怖程度通常低于血仇。

二、仇敌行为与追踪
- 血仇提供动机，不提供能力。追杀受势力等级约束：弱势力无法渗透强势力地盘。
- 跨区域追踪需要时间。仇敌必须先通过合法手段定位{{user}}（情报网、线人、风声等），然后才能组织行动。
- 仇敌status = "执行中"时，每隔5-10轮才有几率真正发起一次追杀/报复行动。
- 若仇敌势力 < {{user}}所在地保护势力，追杀强制停滞，转为"追踪中"并积蓄力量。

三、仇敌触发（团体视角）
当{{user}}的行为触发type=blood时，AI必须根据被杀者的身份判定团体走向：
1. 被杀者为团体核心人物（失去权力的前核心人物除外）：
   - 走向A（同仇敌忾）：若凝聚力较高且有明确继承人，继承人成为新核心，创建冲突型事件链。
   - 走向B（内斗）：若派系林立，团体陷入争权夺利，复仇被搁置，原进度停滞。
   - 走向C（解散）：若凝聚力低或资源枯竭，团体直接解散，从活跃面板移除。
2. 被杀者为普通成员（或已失去权力的前核心人物）：创建临时复仇团体，名称格式："[被杀者姓名]的亲属复仇队"。创建冲突型事件链。
无论哪种路径，都必须在enemies中追加一条仇敌录条目，并在influenceChain中记录传导关系。

四、仇敌终结
只有当仇敌被{{user}}彻底消灭（杀死核心复仇者、摧毁复仇组织），才能标记status="已终结"。
- 已终结的条目会保留20轮备忘后自动清除。
- 反杀后{{user}}声誉可回升，但最高只能达到"受人尊敬"（若声誉模块启用）。
- 对应的冲突型事件链同步标记为已终结。

五、禁止事项
- 禁止仅因"被{{user}}辱骂""商业竞争失败""街头斗殴轻伤"等可逆伤害创建仇敌条目。
- 禁止将势力层面的态度对立（factions.relation = "敌对"）自动等同于仇敌。
- 禁止为仇敌赋予超出其势力的能力。弱势力不能凭空召唤强援、渗透强领地或全知定位。
</enemies>`
    },
    // ========== 模块十：区域突发事件 ==========
    {
      moduleId: 'regional',
      comment: '模块十：区域突发事件',
      content: `<regional_incident>

一、系统定位
本系统只负责生成区域级突发事件——足以影响一个地区的重大事件。
不处理低价值事件

二、职责划分
区域突发事件是否触发、以及触发哪种类型，完全由本地系统判定。本地不触发时，本规则不会要求你生成区域突发事件，你也不得自发生成。
仅当本地判定触发并向你注入「区域突发强制指令」时，你才按指令指定的类型，生成具体事件标题、发生地点、影响范围、传播风声与外溢影响。

三、事件类型
- banditry 盗匪劫掠：山贼、水匪、流寇、贼伙、劫镖、截船、抢粮、抢盐、屠掠村寨或商队。
- fire 大火：坊市、粮仓、码头、寺院、官署、工坊、船队、货栈发生区域性火灾。
- massacre 恶性凶案：连环杀人、灭门案、客栈血案、商队被屠、码头尸案等足以引发恐慌的案件。
- flood 洪涝：河水暴涨、堤坝决口、码头被淹、村田被毁、桥梁被冲毁。
- infrastructure 道路水利崩坏：官道塌方、桥梁坍塌、渡口停摆、堤坝裂口、水闸损毁、驿路断绝。
- plague 疫病：人疫、畜疫、水源染病、村落封闭、码头拒载、城中高热病人暴增。
- famine 饥荒粮荒：粮仓见底、赈粮断供、粮价暴涨、灾民抢粮、大户闭仓、乡村断炊。
- riot 骚乱暴动：码头械斗、饥民抢粮、香客踩踏、盐铺被砸、关卡冲突、市井冲突扩大。
- rebellion 民变叛乱：流民立寨、乡兵反官、税役暴动、邪教聚众、地方叛乱。
- military 军务突变：守军哗变、军粮被劫、边军溃逃、敌军越境、关隘戒严、军营夜惊。
- earthquake 地震山崩：地震、山崩、矿山塌陷、地裂、山村被埋。
- storm 风暴雪灾：台风、暴雪、沙暴、寒潮、海风毁船、大风摧毁棚屋。

四、API生成要求
当本地骰子触发并注入强制指令后，API必须：
1. 根据指定类型生成区域级突发事件，事件影响一个明确的区域、道路、城镇、关隘、码头或其他地理范围。
2. 事件必须产生可传播的风声。
3. 事件必须造成至少一种外溢影响：经济变化、势力行动、治安变化、事件链变化、声誉变化、黑盒变化或新的影响链。
4. 事件与{{user}}当前行为没有直接因果，不得写成已有仇敌、已有势力、已有事件链的阴谋结果。
5. 不得凭空毁灭核心舞台，不得无故摧毁{{user}}核心资产。
6. 如果事件未发生在{{user}}所在区域，不得强行打断{{user}}当前行动，只作为后台世界变化、远方消息或风声传播。
7. 禁止将"区域突发事件"写成某个已有势力早已策划的阴谋。

五、数据结构
{
  "regionalIncident": {
    "active": true,
    "title": "事件标题",
    "type": "事件类型",
    "scope": "影响范围",
    "impact": "一句话概括区域后果"
  }
}
cooldown 由本地维护，API 不得输出或修改此字段。

六、API返回最低要求
触发后至少返回 regionalIncident、winds、influenceChain。视情况可额外返回 events、economy、factions、reputation、blackbox。
</regional_incident>`
    },
    // ========== 模块十一：信息黑盒 ==========
    {
      moduleId: 'blackbox',
      comment: '模块十一：信息黑盒',
      content: `<secret_asset>

一、信息黑盒定义（防上帝视角铁律）
在剧情运行中，存在两类需要被放入【信息黑盒】严格隔离的内容：
1. 隐秘行为（secretActions）：{{user}}在无人目击、未留痕迹的情况下完成的行动（如深山杀牛、密室暗杀、无声潜入）。关键属性是痕迹——有没有目击者、有没有物证。
2. 隐秘资产（secretAssets）：{{user}}暗中持有、未公开展示的一切资源（如密信、毒药、把柄、藏匿的物资、暗桩线人、隐秘身份）。关键属性是暴露度和可用性。
- secretActions 字段：每项 { action, witnesses: "无/仅XX" }
- secretAssets 字段：每项 { name, exposure: 0-100, status: "有效/过期/暴露/失效" }

【创建准入】
信息未知不等于必须进入黑盒。只有需要跨轮次持续保护知情边界或追踪未来用途/暴露风险时，才写入：
- secretActions：行为已经发生，且其“谁知道、留下何种可调查痕迹”会影响未来判断或行动。
- secretAssets：{{user}}实际控制该资源，资源具有未来可调用价值，并且隐秘性、暴露度或有效期需要持续追踪。

普通内心想法、尚未实施的念头、无后续价值的小动作、公开物品、临时拿取后立即消耗的物品、与未来世界状态无关的隐私，不得进入黑盒。不得把“NPC目前不知道的所有事情”都收进黑盒。
已有条目只有在知情者、痕迹、暴露度、控制权、有效性或用途发生实质变化时才更新。行为已经公开且知情边界不再需要隔离时，不再作为活跃秘密维护；资产已消耗、失效、失去控制或彻底公开时，应更新状态并停止把它当作可用暗牌。

二、知情权校验与物理隔离法则（最高优先级）
1. 物理屏障原则：对于黑盒中的内容，所有未在案发现场、未直接参与的NPC，默认处于"完全、彻底不知情"的物理隔离状态。
2. 禁绝上帝视角：AI绝对禁止将{{user}}的隐秘行为自动转化为全知事件。例如：{{user}}在深山里杀了一头牛，只要没有目击者，就算到了城里，也绝对没有任何人知道牛死了，更不可能知道是{{user}}杀的。
3. 强制校验：AI在描写任何NPC（包括对话、动作、神态、心理活动）前，必须核对该NPC是否在黑盒的"知情名单"中。
4. 绝对无知表现：若NPC不知情，AI绝对不可让其表现出任何暗示、怀疑、"话里有话"或"第六感"。不知情就是像白纸一样，NPC的反应必须彻底基于其当前的公开认知。
5. 痕迹推理约束：若{{user}}留下明显物证，NPC必须通过符合其智力和身份的具体"调查行动"才能逐渐获取信息，绝不能直接"顿悟"或"猜到"。

三、隐秘资产运作机制
- exposure：0-100，暴露风险。0=绝对隐秘，100=已完全公开。{{user}}频繁活动、当地警戒升级、向他人展示或暗示，均会导致暴露度上升。达到50有遭遇战/走漏风险，达到90可能被查抄/公开。
- status：有效/过期/暴露/失效。有效=仍可调用；过期=情报过时；暴露=已被发现；失效=已不可用（如物资被查抄、线人断联、身份被识破）。
- 资产演化：情报有时效性，相关事件发生后可能自动过期。物资藏匿点暴露度随时间自然上升，附近活动加速上升。线人/暗桩暴露后可被反向利用，身份暴露后失去行动灵活性。低暴露度+高有效性=安全资产；低暴露度+已过期=无人知道但已无用；高暴露度+已失效=已被发现且作废。
</secret_asset>`
    },
    // ========== 模块十二：天下大势 ==========
    {
      moduleId: 'trends',
      comment: '模块十二：天下大势',
      content: `<world_trends>

天下大势是已经改变国家、国际或整个世界运行方式的长期局势。它不是普通风声，也不是等待推进的事件链，而是其他系统行动时必须考虑的世界级约束。

一、数据结构
每条包含：
- id：已有大势沿用系统分配的 id；新大势必须显式填 null，禁止省略。
- name：大势名称。措辞变化不改变 id。
- scope：实际影响范围。
- status："持续中"/"已结束"。
- description：当前局势及其正在如何约束世界行动。
- source：形成该大势的明确来源。

二、形成条件
每轮检查以下候选来源：
- Lv4 冲突型事件进入"已爆发"。
- Lv4 推进型事件进入"已完成"，且成果改变国家或国际格局。
- Lv4 风声背后的事实被广泛确认，并持续影响多个势力。
- 长期局势已经形成。

候选来源不等于自动创建。只有同时满足"长期持续、广域影响、跨系统作用、迫使多个势力持续调整行动"时，才创建天下大势。全国节庆、单次公告、短期轰动、普通重大新闻不算天下大势。

三、持续与结束
- 天下大势不参与骰子，不自动消散，也不因某轮未返回而删除。
- 所有 status="持续中" 的天下大势，每轮都必须作为事件链、势力、经济、风声与NPC行动的背景约束。
- 大势本身没有 effects 字段。具体影响应落实到对应系统，并在产生跨系统变化时写入 influenceChain。
- 只有出现明确改变局势的事实时才更新 description；只有局势确定结束时才标记为"已结束"。
- 已结束的大势是历史结果，不得重新变为持续中；若类似局势再次发生，应创建新名称的大势。
</world_trends>`
    }
  ];

  // ===================== 对外接口 =====================

  function loadRules(baseUrl) {
    return new Promise((resolve) => {
      console.log('[世界引擎] 规则已内置在 JS 中，共', RULES.length, '条');
      resolve({ count: RULES.length, comments: RULES.map(r => r.comment) });
    });
  }

  /** 获取所有模块的 id 与中文名，供 UI 显示开关 */
  function getModuleList() {
    // 改为从统一描述符派生（单一来源）。输出形状与原 RULES.map 完全一致。
    return getModuleDescriptors().map(function (d) { return { moduleId: d.id, comment: d.name }; });
  }

  // ======== 模块描述符构造器（阶段 1 · 纯增量只读 API）========
  // 把现有 RULES + OUTPUT_SCHEMAS + MODULE_FIELD_MAP + BUILTIN_MECHANICS 合成统一描述符。
  // 注意：此函数定义在 OUTPUT_SCHEMAS / BUILTIN_MECHANICS 之前出现的位置，但它们是
  // 同一闭包内的 const/函数，运行时调用即可访问（不在加载期求值），因此安全。
  function getModuleDescriptors() {
    return RULES.map(function (r, i) {
      var schema = (typeof OUTPUT_SCHEMAS !== 'undefined') ? OUTPUT_SCHEMAS[r.moduleId] : null;
      var mech = (typeof BUILTIN_MECHANICS !== 'undefined') ? BUILTIN_MECHANICS[r.moduleId] : null;
      var container = schema ? schema.container : 'none';
      return {
        id: r.moduleId,
        name: r.comment,
        kind: 'builtin',
        order: i + 1,
        enabled: true,
        rules: r.content,
        container: container,
        field: MODULE_FIELD_MAP[r.moduleId] || null,
        itemKey: (mech && mech.itemKey) || (container === 'array' ? 'name' : null),
        fields: schema ? JSON.parse(JSON.stringify(schema.fields)) : null,
        mechanics: mech ? JSON.parse(JSON.stringify(mech)) : {},
        display: null  // builtin 走专属渲染函数；自定义模块才用 display 驱动通用渲染
      };
    });
  }

  let _lastActiveModuleDescriptorWarnings = [];

  function cloneDescriptor(descriptor) {
    return descriptor ? JSON.parse(JSON.stringify(descriptor)) : null;
  }

  function getActivePresetObject() {
    if (!window.WORLD_ENGINE_PRESETS || !window.WORLD_ENGINE_PRESETS.getActivePreset) return null;
    try { return window.WORLD_ENGINE_PRESETS.getActivePreset(); }
    catch (e) { return null; }
  }

  function getActivePresetMode() {
    const preset = getActivePresetObject();
    return preset && preset.mode === 'free' ? 'free' : 'classic';
  }

  function applyActiveBuiltinOverrides(descriptor, ref) {
    const d = cloneDescriptor(descriptor);
    if (!d) return null;
    const disabled = getDisabledModules();
    d.enabled = (!ref || ref.enabled !== false) && disabled.indexOf(d.id) === -1;
    if (ref && Number.isFinite(Number(ref.order))) d.order = Number(ref.order);
    if (ref && ref.name) d.name = ref.name;
    if (d.container !== 'none') {
      const merged = getModuleOutputSchema(d.id);
      if (merged) { d.fields = merged.fields; d.container = merged.container; d.description = merged.description || d.description || ''; }
    }
    try {
      if (window.WORLD_ENGINE_PRESETS && window.WORLD_ENGINE_PRESETS.uiModuleLabel) {
        const lbl = window.WORLD_ENGINE_PRESETS.uiModuleLabel(d.id);
        if (lbl) d.name = lbl;
      }
    } catch (e) {}
    return d;
  }

  function getClassicActiveModuleDescriptors() {
    return getModuleDescriptors().map(function (descriptor) { return applyActiveBuiltinOverrides(descriptor); });
  }

  function isStrictIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value || '');
  }

  function getReservedOutputFields() {
    const reserved = new Set(['world_digest']);
    getModuleDescriptors().forEach(function (d) { if (d.field) reserved.add(d.field); });
    return reserved;
  }

  function normalizeCustomActiveDescriptor(raw, index) {
    if (!raw || raw.kind !== 'custom') return null;
    const id = raw.id || '';
    if (!isStrictIdentifier(id)) return null;
    const container = raw.container || 'array';
    if (['none', 'scalar', 'object', 'array'].indexOf(container) === -1) return null;
    const field = container === 'none' ? null : (raw.field || id);
    if (field && !isStrictIdentifier(field)) return null;
    const d = cloneDescriptor(raw);
    d.kind = 'custom';
    d.enabled = raw.enabled !== false && getDisabledModules().indexOf(id) === -1;
    d.order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : index + 1;
    d.name = d.name || id;
    d.rules = d.rules || '';
    d.container = container;
    d.field = field;
    if (container === 'array' && !d.itemKey) d.itemKey = 'name';
    if ((container === 'array' || container === 'object') && !isPlainObject(d.fields)) d.fields = {};
    if (!isPlainObject(d.mechanics)) d.mechanics = {};
    if (!isPlainObject(d.display)) d.display = null;
    return d;
  }

  function getFreeActiveModuleDescriptors(preset) {
    const builtinById = {};
    getModuleDescriptors().forEach(function (descriptor) { builtinById[descriptor.id] = descriptor; });
    const modules = Array.isArray(preset && preset.modules) ? preset.modules : [];
    const list = [];
    const seenIds = new Set();
    const seenFields = new Set();
    const warnings = [];
    modules.forEach(function (raw, index) {
      if (typeof raw === 'string') raw = { id: raw, kind: 'builtin', order: index + 1 };
      if (!raw || !raw.id) return;
      const id = raw.id;
      if (seenIds.has(id)) { warnings.push('重复模块 id 已跳过：' + id); return; }
      const base = builtinById[id];
      let descriptor = null;
      if ((raw.kind === 'builtin' || base) && base) {
        descriptor = applyActiveBuiltinOverrides(base, { ...raw, order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index + 1 });
      } else {
        descriptor = normalizeCustomActiveDescriptor(raw, index);
      }
      if (!descriptor) { warnings.push('模块描述符无效，已跳过：' + id); return; }
      const field = descriptor.field || (descriptor.container !== 'none' ? descriptor.id : null);
      if (field) {
        if (seenFields.has(field)) { warnings.push('模块字段名重复，已跳过：' + field); return; }
        if (descriptor.kind === 'custom' && getReservedOutputFields().has(field)) { warnings.push('自定义模块字段名与内置字段冲突，已跳过：' + field); return; }
        seenFields.add(field);
      }
      seenIds.add(id);
      list.push(descriptor);
    });
    _lastActiveModuleDescriptorWarnings = warnings;
    return list;
  }

  // 激活态描述符：classic 维持内置 12 模块；free/mixed 从 preset.modules[] 解析。
  function getActiveModuleDescriptors() {
    const preset = getActivePresetObject();
    if (!preset || preset.mode !== 'free') {
      _lastActiveModuleDescriptorWarnings = [];
      return getClassicActiveModuleDescriptors();
    }
    return getFreeActiveModuleDescriptors(preset);
  }

  function getActiveModuleDescriptorWarnings() {
    getActiveModuleDescriptors();
    return _lastActiveModuleDescriptorWarnings.slice();
  }

  function buildRulesTextFromDescriptors(descriptors, options) {
    options = options || {};
    var list = Array.isArray(descriptors) ? descriptors.slice() : [];
    var enabledRules = list.filter(function (d) {
      return d && d.enabled !== false && typeof d.rules === 'string' && d.rules.trim();
    });

    if (enabledRules.length === 0) {
      return options.emptyText || '【所有模块均已禁用，无可用规则】';
    }

    enabledRules.sort(function (a, b) {
      var ao = Number(a.order);
      var bo = Number(b.order);
      if (!Number.isFinite(ao)) ao = 9999;
      if (!Number.isFinite(bo)) bo = 9999;
      return ao - bo;
    });

    const orderedRules = enabledRules.map(function (d) {
      var name = d.name || d.id || '未命名模块';
      return '========== ' + name + ' ==========' + '\n' + String(d.rules || '').trim();
    });
    let text = '## 世界推演规则（原文，共' + enabledRules.length + '条）\n\n' + orderedRules.join('\n\n');

    if (options.applyTerms !== false && window.WORLD_ENGINE_PRESETS && window.WORLD_ENGINE_PRESETS.applyTermMap) {
      text = window.WORLD_ENGINE_PRESETS.applyTermMap(text);
    }

    if (options.appendCustomRules !== false && window.WORLD_ENGINE_PRESETS && window.WORLD_ENGINE_PRESETS.getActivePreset) {
      const preset = window.WORLD_ENGINE_PRESETS.getActivePreset();
      if (preset && preset.customRules && preset.customRules.trim()) {
        text += '\n\n========== 用户自定义规则 ==========' + '\n' + preset.customRules.trim();
      }
    }

    return text;
  }

  function getAllRulesText() {
    const descriptors = getActiveModuleDescriptors();
    console.log('[getAllRulesText] RULES:', descriptors.length);
    if (!descriptors.length) return '【世界规则加载失败，所有规则不可用】';

    descriptors.forEach(function (d) {
      if (d && d.enabled === false) console.log('[getAllRulesText] 已禁用模块:', d.name || d.id);
    });

    return buildRulesTextFromDescriptors(descriptors);
  }

  function getCoreRulesSummary() {
    if (RULES.length === 0) return '';

    const summary = `
【世界引擎·世界行为规则】

世界运转：
- 世界是活的，不围着{{user}}转：每轮都让台前幕后的人各过各的日子——赶路的赶路、做买卖的做买卖、勾心斗角的接着斗，哪怕跟主角八竿子打不着。与{{user}}无关的事是常态，别把什么都安到他头上。
- 不在场的人也在动：每轮正文都该露出"世界自己在走"的痕迹——别处传来的新动静、某人换了地方或不在了、某件事又往前拱了一步，而不是主角不出场世界就定格。
- 主角不是全知：他只感知眼前和恰好撞上的事；远方的变化靠风声、传闻、行商、告示捎到他耳边，没捎到就当他不知道，别让他凭空知晓远处行情。
- 每轮世界向前走一步：时间在流动，与剧情里过了多久无关，别让世界停在原地等主角。

事件链（注入格式：名称(类型, Lv.等级) 当前阶段 阶段进度/9 [本轮动向]，例：雪鹞营南调(推进型, Lv.4) 关键 4/9 [保持]）：
- 先会读这行：上例＝一桩叫「雪鹞营南调」的推进型大事，正处"关键"阶段、该阶段推进到 4/9，本轮按兵未动。下面逐项拆解。
- 两种类型：冲突型＝会滚向爆发的矛盾（报复、追杀、派系火并、战争清算）；推进型＝会滚向完成的事务（研发、建设、调查、办事、开商路）。
- 等级 Lv1-4 ＝这桩事的份量与波及面，演时排场要配得上：
  · Lv1 个人级（街头摩擦／打探小消息），动静止于当事人；
  · Lv2 局部级（伤人砸店／建据点、训小队），波及一条街或一个小团体；
  · Lv3 区域级（杀核心人物／建大工坊、布情报网），能搅动整座城或多家大势力；
  · Lv4 世界级（刺王杀驾／铸国器、改商路），足以改写一国格局。
  冲突型 Lv 越高越凶险、越易失控；推进型 Lv 越高越艰难、推得越慢。别把 Lv4 大事写成街头小打小闹。
- 阶段 ＝这事走到哪一步，正文的紧张度随阶段层层加码：
  · 冲突型：萌芽（刚冒苗头，少数人察觉）→发酵（扩散、聚人聚势聚动机）→逼近（一触即发）→已爆发（追杀／械斗／通缉等已落地）；
  · 推进型：筹备（备人备料备情报）→执行（实际开干、持续投入）→关键（临门一脚，最易被搅黄或反转）→已完成（成果落地）。
- 进度/9 ＝当前阶段内的进度条，越近 9 越逼近下一阶段。4/9 是过半未到顶，别演得像马上跨阶段，也别当它还没起步。

- [本轮动向] ＝这一轮的势头：[成功]＝向前拱了一步，[受挫]＝被顶回去一点，[保持]＝原地胶着没动。本轮该推、该退还是该僵，照它来，别跟它对着干。（终局事件不带这个标记）
- 其余：事件按自身逻辑走、不围着主角转；停滞≠放弃，受阻方会转入外围低调准备（布眼线、攒资源、找帮手）而非凭空消失；受害者地位越高，冲突级别跃升越狠（顶撞权贵≈重罪）。
势力：
- 关系是这势力对{{user}}的态度，NPC 的言行得落在这态度上：盟友不会无故翻脸，敌对/世仇不会突然示好。
- 势力按自己的目标活，不围着{{user}}转；只有在合法获知消息、且地盘够得着时，才会主动找上{{user}}或动手。
- 势力只在自己范围内说了算，越界搞{{user}}得有铺垫，不能凭空在别人地盘呼风唤雨。
- 敌对只是立场对头，可以谈；跟死咬着{{user}}不放的仇敌是两码事。

天下大势：
- 什么是天下大势：它不是一桩具体事件，也不是哪条等着爆发的事件链，而是已经笼罩整个时代的大背景——战争、夺嫡、大灾、政权更替、商路重构这类长期、广域、改写规则的局势。它是世界的"天气"，范围内所有人都活在它底下，谁也躲不开。
- 它是恒在的底色，不必每幕都当主角，但要持续渗进细节：物价物资（征粮则粮贵、封路则货缺）、人的处境与话题（壮丁被征、难民南下、人人自危）、行事的限制（关卡盘查严、某些买卖断了、某些路走不得）。哪怕主角在做毫不相干的事，大势也该在背景里隐隐压着。
- 影响范围＝大势笼罩到哪：范围内的势力、买卖、出行、人心都被它牵着走；范围外只是远方的隆隆雷声，靠风声捎来。
- 它是长期局势，不会因一两轮没提就消失；除非剧情里它明确落幕，否则它一直在那儿约束世界——别把它演没了，也别擅自给它收尾。

风声（注入格式：[类型 Lv.规模 传到的地方] 说法，例：[流言 Lv.3 青石关及周边] 青石关守军要被南调）：
- 风声是世界的耳语，要让它在正文里被人说出口：茶楼议论、码头闲谈、墙上告示、客商捎话、街坊嚼舌——别让它只躺着不出声。{{user}}人在风声传到的地方或圈层时，就该有人提起、有人深信、有人将信将疑。
- 四种类型，可信度与口吻各不同：公告＝官府或势力公开说过，"说过"是真的、内容未必真；消息＝有来路的传递，较可靠；流言＝越传越走样，常夸大、扭曲、张冠李戴；舆情＝一群人的情绪和风向，未必有准信。按类型演出不同的可信度，别把流言当铁证、也别把公告当真相。
- Lv 规模＝传得多广：Lv1 圈内数人／Lv2 一地／Lv3 一州一郡／Lv4 一国乃至天下。规模越大，越多不相干的人也在谈论、也被波及。
- 传到的地方＝风声的边界：人在这范围或圈层内才听得到、才会据此反应；范围外的人对此一无所知，别让没传到的地方有人凭空接茬。

信息传播：
- NPC获知信息必须有合法途径：亲眼目睹、他人告知、物证推断、公开信息、情报网络。
- 禁止"就是知道了"。禁止面板信息泄露给NPC。
- 痕迹≠指向。物证只能推断"发生了什么"，不能直接跳到"是谁干的"。
- 匿名/化名默认与本体无关联，暴露需要条件（特征暴露、技能暴露、主动透露等）。

知情与接触：
- 角色接触必须建立在合法知情、行动路径和自身目的之上；接触者应有独立生活痕迹、明确因果、符合性格。禁止为了制造互动而凭空安排接触。
- 没有合法传播链、定位线索、通讯、汇报、调查、组织命令或现实接近路径时，NPC、势力、黑市、仇敌都不得直接对面板信息作出反应。
- {{user}}主动躲藏、匿名或伪装时，外界必须先满足定位或身份关联条件，才能形成有效接触或追踪。

仇敌录：
- 仇敌分为血仇（type=blood，核心人物被杀/至亲身亡致残）和非致死恩怨（type=grudge，不可逆伤害+明确复仇意愿+有追踪能力）。
- 仇敌永不淡化、追着{{user}}跑。血仇提供动机不提供能力，追杀受势力等级约束。
- 跨区域追踪需要时间，必须先合法定位{{user}}才能组织行动。

区域突发事件：
- 本轮若发生了区域级突发事件（山贼劫道、大火、洪涝、疫病、饥荒等），必须把它演出来，别让它有名无实、没有下文。
- 演法看距离：若发生在{{user}}所在地，化为当前场景的压力——烟火、惊乱、封路、逃难、盘查、物价飞涨等可感细节，逼他直面或绕行；若在远处，则借风声、行商、告示、逃难者传到他耳中，不硬打断他当前行动。
- 它是世界自身的天灾人祸，与{{user}}的行为链无关，也不是已有势力策划的阴谋；别接到主角头上，也别替他背锅。

经济：
- 市面冷暖要演出来：注入的「市面繁荣/平稳/衰退/动荡」是当前这片地方的经济底色——繁荣则摊贩云集、货畅人旺、物价稳中带俏；衰退动荡则商铺关张、物价失控、街面萧条、人心惶惶。把它落成{{user}}采买、投宿、赶路时摸得到的物价、人气与治安氛围，别让它只当背景旁白。
- 「信号」是眼下最值得注意的局部异动，要在它标注的地区具体显形：某物翻价、断货抢购、商号倒闭改行、脚夫罢运、关卡盘剥等，并据此影响{{user}}能买到什么、花多少钱、路好不好走、撞见什么人。
- 经济按地域走：信号只在自己范围那片生效，远处行情靠风声、行商、邸报才传得到，别全境一个样。

声誉：
- 声誉要演出来：NPC 对{{user}}的眼神、用词、礼数、开价、肯不肯帮忙，都该主动体现其所属圈子那一维的高低——受尊敬者得敬意、方便与折扣，声名狼藉者遭冷脸、抬价、提防甚至驱赶，名声越极端反应越鲜明。声誉是活的社交货币，不是面板摆设。
- 各看各的维：百姓看市井、官差看朝堂、道上人看草莽、同行看同道，跨圈子取综合；四维独立、不互相染色，某维高不代表别维买账（草莽高反而可能让朝堂更忌惮）。
- 默默无闻是默认态=该圈子没听过{{user}}，当普通陌生人即可，别硬给强烈反应；有反应也分级——天怒人怨才喊打喊杀，声名狼藉只是提防绕道，受人尊敬≠万众敬仰，别把"有几分名头"演成"夹道相迎"。
- 声誉只在已传到该圈子、该地区时才生效：异地、初来乍到、消息没覆盖处，哪怕别处声名赫赫，本地人也当你查无此人。

信息黑盒（注入两类，例：[行为] 深夜灭口张三（目击:无）；[资产] 城南暗桩（暴露:30%，有效））：
- 黑盒是只有{{user}}（及注入里写明的目击者）才知道的暗面。最高铁律：不在知情名单里的 NPC 必须彻底不知情——不许暗示、不许怀疑、不许"第六感"、不许话里有话；不知情的人就当那事压根没发生。
- [行为]＝{{user}}做过却没张扬的事，看"目击"定谁知道：标"无"则世上无人知晓，谁都不能据此反应；标"仅XX"则只有 XX 知情，其余人照旧蒙在鼓里。
- [资产]＝{{user}}暗中攥着的牌（暗桩、密信、毒药、把柄、藏匿物资等），该用就用、可调用可使坏可翻盘——这是他的底牌，别让它吃灰。
- 暴露% 是悬顶之剑：越高越接近败露，逼近高位或状态转「暴露」时，可安排盘查、有人起疑、线索浮头来制造紧张；状态为「过期／失效」的资产已不顶用，别再让它发挥作用。
    `.trim();

    // Apply preset term replacements
    if (window.WORLD_ENGINE_PRESETS && window.WORLD_ENGINE_PRESETS.applyTermMap) {
      return window.WORLD_ENGINE_PRESETS.applyTermMap(summary);
    }

    return summary;
  }

  const MODULE_FIELD_MAP = {
    events: 'events',
    factions: 'factions',
    winds: 'winds',
    influence: 'influenceChain',
    reputation: 'reputation',
    economy: 'economy',
    enemies: 'enemies',
    regional: 'regionalIncident',
    blackbox: 'blackbox',
    trends: 'worldTrends'
  };

  // ======== 模块描述符层（阶段 1 · 纯增量，不改变任何现有行为）========
  // BUILTIN_MECHANICS：把盘点表里每个内置模块用到的「特权机制」登记成元数据。
  // 注意：这里只做「标签 / 形状」描述，不复制 evolution.js 里的常量表（避免双源漂移）；
  // classic 推演仍然走 evolution.js 原有代码。Phase 2 才把通用引擎接到这些标签上。
  // 详见 docs/内置模块盘点表.md 与 docs/模块描述符规格.md。
  const BUILTIN_MECHANICS = {
    world:      {},
    contact:    {},
    events:     { dice:{ mode:'threshold', levelField:'level' }, stages:{ typeField:'type' }, lifecycle:{ terminalRetain:true }, merge:'arrayByKey', itemKey:'name' },
    factions:   { verdicts:{ axes:['status','relation'] }, merge:'arrayByKey', itemKey:'name' },
    winds:      { dice:{ mode:'decay', byTypeField:'type' }, merge:'arrayByKey', itemKey:'topic' },
    influence:  { lifecycle:{ expireRounds:8, cap:12 }, merge:'arrayByKey', itemKey:'trigger' },
    reputation: { verdicts:{ axes:['authority','common','shadow','circuit'] }, merge:'objectAssign' },
    economy:    { verdicts:{ axes:['climate'] }, lifecycle:{ signalsCap:8 }, merge:'objectAssign' },
    enemies:    { lifecycle:{ terminalRetainRounds:20, cap:8 }, merge:'arrayByKey', itemKey:'name' },
    regional:   { dice:{ mode:'trigger' }, merge:'objectReplaceGated' },
    blackbox:   { lifecycle:{ cap:12 }, merge:'objectReplace' },
    trends:     { lifecycle:{ terminalRemove:['已结束'] }, merge:'arrayByKey', itemKey:'name' }
  };

  function getBuiltinMechanics(moduleId) {
    return BUILTIN_MECHANICS[moduleId] ? JSON.parse(JSON.stringify(BUILTIN_MECHANICS[moduleId])) : {};
  }

  const OUTPUT_SCHEMAS = {
    events: {
      moduleId: 'events', field: 'events', title: 'events', container: 'array',
      description: '事件链数组。只返回本轮有推进、停滞、转向、结束或新建的事件。',
      fields: {
        id: { type: 'string|null', description: '系统身份。更新已有事件必须原样返回当前 id；新事件必须显式填 null，禁止省略或编造。', example: 'event_1' },
        name: { type: 'string', description: '事件名称。改名不代表创建新事件，同一事件沿用 id。', example: '血刃门复仇' },
        type: { type: 'enum', description: 'conflict 或 progress。新事件必须明确类型。', example: 'conflict' },
        level: { type: 'number', description: '1-4，表示冲突强度或推进规模。', example: 2 },
        stage: { type: 'string', description: '当前阶段。必须符合对应 type 的阶段体系。', example: '发酵' },
        stageRound: { type: 'number', description: '当前阶段进度，通常为 1-9。', example: 5 },
        desc: { type: 'string', description: '本轮事件变化说明。', example: '追兵抵达渡口，开始封锁船只。' },
        stall: { type: 'boolean', description: '是否因阻碍而停滞。可省略。', example: false }
      }
    },
    factions: {
      moduleId: 'factions', field: 'factions', title: 'factions', container: 'array',
      description: '势力数组。用于记录组织、团体、家族、门派、公司或其他可持续行动的集体。',
      fields: {
        id: { type: 'string|null', description: '系统身份。更新已有势力必须原样返回当前 id；新势力必须显式填 null，禁止省略或编造。', example: 'faction_1' },
        name: { type: 'string', description: '势力名称。改名、易帜不改变 id；真正分裂出的新势力才创建新对象。', example: '血刃门' },
        scope: { type: 'string', description: '势力影响范围。', example: '北境三郡' },
        status: { type: 'enum', description: '整体状态。使用当前预设定义的势力状态。', example: '稳定' },
        relation: { type: 'enum', description: '该势力对{{user}}的态度。使用当前预设定义的关系层级。', example: '敌对' },
        currentGoal: { type: 'string', description: '势力当前目标。', example: '夺回码头控制权' },
        core_person: { type: 'string', description: '核心人物名称。', example: '门主沈缺' },
        powerPillars: { type: 'array<string>', description: '当前权力支柱，最多 3 个短词。', example: ['武力', '财源'] }
      }
    },
    trends: {
      moduleId: 'trends', field: 'worldTrends', title: 'worldTrends', container: 'array',
      description: '天下大势数组。用于长期、广域、跨系统的局势变化。',
      fields: {
        id: { type: 'string|null', description: '系统身份。更新已有大势必须原样返回当前 id；新大势必须显式填 null，禁止省略或编造。', example: 'trend_1' },
        name: { type: 'string', description: '大势名称。措辞变化不改变 id。', example: '北境军粮短缺' },
        scope: { type: 'string', description: '影响范围。', example: '北境诸郡' },
        status: { type: 'enum', description: '持续中或已结束。', example: '持续中' },
        description: { type: 'string', description: '当前局势说明。', example: '粮道受阻，军需价格持续上涨。' },
        source: { type: 'string', description: '形成该大势的来源。', example: '边境战事与商路封锁' }
      }
    },
    winds: {
      moduleId: 'winds', field: 'winds', title: 'winds', container: 'array',
      description: '风声数组。用于记录正在传播的信息、谣言、公告、情绪或报道。',
      fields: {
        id: { type: 'string|null', description: '系统身份。更新已有风声必须原样返回当前 id；新风声必须显式填 null，禁止省略或编造。', example: 'wind_1' },
        topic: { type: 'string', description: '风声主题。同一传播脉络允许改名，但必须沿用 id。', example: '渡口封锁' },
        type: { type: 'enum', description: 'announcement/report/rumor/sentiment。', example: 'report' },
        level: { type: 'number', description: '1-4，表示传播范围。', example: 2 },
        content: { type: 'string', description: '正在传播的说法。', example: '北渡口被血刃门封锁。' },
        scope: { type: 'string', description: '传播范围或圈层。', example: '北渡口附近' },
        source: { type: 'string', description: '信息来源。', example: '船夫与脚夫' }
      }
    },
    economy: {
      moduleId: 'economy', field: 'economy', title: 'economy', container: 'object',
      description: '经济对象。只在市场、道路、资源、价格、物流发生实质变化时返回。',
      fields: {
        climate: { type: 'enum', description: '当前经济温度。使用当前预设定义的经济状态。', example: '平稳' },
        signals: { type: 'array<object>', description: '市场信号，每项包含 summary 与 scope。', example: [{ summary: '粮价上涨', scope: '北境' }] },
        currencySystem: { type: 'string', label: '货币体系', description: '当前流通的货币/计价体系。', example: '官铸铜钱为主，边境兼用银两' },
        scarcityIndex: { type: 'number', label: '稀缺指数', description: '关键物资稀缺程度，0-100，越高越紧缺。', example: 35 },
        tradeRoutes: { type: 'array<string>', label: '贸易路线', description: '当前主要贸易路线，最多 5 条短语。', example: ['北境粮道', '西关盐路'] }
      }
    },
    reputation: {
      moduleId: 'reputation', field: 'reputation', title: 'reputation', container: 'object',
      description: '声誉对象。只在{{user}}名声确有变化时返回相关维度。',
      fields: {
        authority: { type: 'enum', description: '权力/官方维度声誉。', example: '默默无闻' },
        common: { type: 'enum', description: '民间/公众维度声誉。', example: '默默无闻' },
        shadow: { type: 'enum', description: '隐秘圈层维度声誉。', example: '默默无闻' },
        circuit: { type: 'enum', description: '同行/专业圈层维度声誉。', example: '默默无闻' },
        lastChange: { type: 'string', description: '本轮声誉变化原因。', example: '无变化' }
      }
    },
    enemies: {
      moduleId: 'enemies', field: 'enemies', title: 'enemies', container: 'array',
      description: '仇敌数组。用于不可逆的个人恩怨，不等同于势力关系敌对。',
      fields: {
        id: { type: 'string|null', description: '系统身份。更新已有仇敌必须原样返回当前 id；新仇敌必须显式填 null，禁止省略或编造。', example: 'enemy_1' },
        name: { type: 'string', description: '仇敌名称。姓名、称号变化不改变 id。', example: '血刃门少主' },
        reason: { type: 'string', description: '与{{user}}结仇的具体原因。', example: '{{user}}杀死其亲族。' },
        type: { type: 'enum', description: 'blood 或 grudge。', example: 'blood' },
        status: { type: 'enum', description: '追踪中、等待中、执行中或已结束。', example: '追踪中' }
      }
    },
    influence: {
      moduleId: 'influence', field: 'influenceChain', title: 'influenceChain', container: 'array',
      description: '影响链数组。只记录真实产生外溢影响的跨系统传导。',
      fields: {
        trigger: { type: 'string', description: '触发源。', example: '渡口封锁的风声传开' },
        impact: { type: 'string', description: '已经发生的直接影响。', example: '商队改道，粮价上涨。' },
        fallout: { type: 'string', description: '后续可能继续扩散的影响。', example: '北境军需进一步紧张。' }
      }
    },
    regional: {
      moduleId: 'regional', field: 'regionalIncident', title: 'regionalIncident', container: 'object',
      description: '区域突发事件对象。只在区域突发事件生成或更新时返回。',
      fields: {
        active: { type: 'boolean', description: '事件是否激活。', example: true },
        title: { type: 'string', description: '突发事件标题。', example: '北渡口大火' },
        type: { type: 'string', description: '事件类型。', example: 'fire' },
        scope: { type: 'string', description: '影响范围。', example: '北渡口' },
        impact: { type: 'string', description: '当前影响摘要。', example: '货运停摆，难民聚集。' }
      }
    },
    blackbox: {
      moduleId: 'blackbox', field: 'blackbox', title: 'blackbox', container: 'object',
      description: '信息黑盒对象。用于未公开、未传播、只有少数人知道的信息。',
      fields: {
        secretActions: { type: 'array<object>', description: '隐秘行为，每项包含 action 与 witnesses。', example: [{ action: '密室会谈', witnesses: '无' }], itemFields: {} },
        secretAssets: { type: 'array<object>', description: '隐秘资产，每项包含 name、exposure、status。', example: [{ name: '密信', exposure: 20, status: '隐藏' }], itemFields: {} }
      }
    }
  };

  function cloneSchemaValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  // 字段名安全检查：拒绝会破坏 prompt/JSON 的字符（空、控制符、引号、反斜杠）
  function isSafeFieldName(name) {
    return typeof name === 'string' && name.trim() !== '' && !/[\u0000-\u001f"\\]/.test(name);
  }

  function normalizeFieldSpec(spec) {
    if (!isPlainObject(spec)) return null;
    const normalized = {
      type: String(spec.type || 'string'),
      description: String(spec.description || spec.desc || '')
    };
    if (Object.prototype.hasOwnProperty.call(spec, 'example')) normalized.example = cloneSchemaValue(spec.example);
    if (spec.label) normalized.label = String(spec.label);
    if (Object.prototype.hasOwnProperty.call(spec, 'display')) normalized.display = spec.display !== false;
    if (Array.isArray(spec.enum)) normalized.enum = spec.enum.map(String).filter(Boolean);
    if (isPlainObject(spec.itemFields)) {
      const itemFields = {};
      Object.keys(spec.itemFields).forEach(key => {
        const childSpec = normalizeFieldSpec(spec.itemFields[key]);
        if (childSpec) itemFields[key] = childSpec;
      });
      normalized.itemFields = itemFields;
    }
    return normalized;
  }

  function mergeOutputSchema(baseSchema, override) {
    const merged = cloneSchemaValue(baseSchema);
    if (!isPlainObject(override)) return merged;
    if (override.title) merged.title = String(override.title);
    if (override.description) merged.description = String(override.description);
    if (!isPlainObject(merged.fields)) merged.fields = {};

    const hidden = Array.isArray(override.hiddenFields) ? override.hiddenFields.map(String) : [];
    hidden.forEach(field => { delete merged.fields[field]; });

    const replaceFields = isPlainObject(override.fields) ? override.fields : null;
    if (replaceFields) {
      Object.keys(replaceFields).forEach(field => {
        if (!isSafeFieldName(field)) return;
        const spec = normalizeFieldSpec(replaceFields[field]);
        if (spec) merged.fields[field] = spec;
      });
    }

    const overrideFields = isPlainObject(override.overrideFields) ? override.overrideFields : {};
    Object.keys(overrideFields).forEach(field => {
      if (!isSafeFieldName(field)) return;
      const spec = normalizeFieldSpec(overrideFields[field]);
      if (!spec) return;
      const prevSpec = merged.fields[field] || {};
      const mergedSpec = Object.assign({}, prevSpec, spec);
      if (isPlainObject(prevSpec.itemFields) || isPlainObject(spec.itemFields)) {
        mergedSpec.itemFields = Object.assign({}, prevSpec.itemFields || {}, spec.itemFields || {});
      }
      merged.fields[field] = mergedSpec;
    });

    const addFields = isPlainObject(override.addFields) ? override.addFields : {};
    Object.keys(addFields).forEach(field => {
      if (!isSafeFieldName(field)) return;
      const spec = normalizeFieldSpec(addFields[field]);
      if (spec) merged.fields[field] = spec;
    });

    return merged;
  }

  function getActivePresetSchemaOverrides() {
    if (!window.WORLD_ENGINE_PRESETS || !window.WORLD_ENGINE_PRESETS.getActivePreset) return {};
    const preset = window.WORLD_ENGINE_PRESETS.getActivePreset();
    return preset && isPlainObject(preset.schemaOverrides) ? preset.schemaOverrides : {};
  }

  function getDisabledModules() {
    if (!window.WORLD_ENGINE_PRESETS || !window.WORLD_ENGINE_PRESETS.getActivePreset) return [];
    const preset = window.WORLD_ENGINE_PRESETS.getActivePreset();
    return preset && Array.isArray(preset.disabledModules) ? preset.disabledModules : [];
  }

  function getBaseModuleOutputSchema(moduleId) {
    const base = OUTPUT_SCHEMAS[moduleId];
    return base ? cloneSchemaValue(base) : null;
  }

  function getModuleOutputSchema(moduleId) {
    const base = OUTPUT_SCHEMAS[moduleId];
    if (!base) return null;
    const overrides = getActivePresetSchemaOverrides();
    return mergeOutputSchema(base, overrides[moduleId]);
  }

  function buildOutputSchemaFromDescriptor(descriptor) {
    if (!descriptor || descriptor.enabled === false) return null;
    if (descriptor.kind === 'builtin' && descriptor.id && OUTPUT_SCHEMAS[descriptor.id]) {
      return getModuleOutputSchema(descriptor.id);
    }
    const container = descriptor.container || 'none';
    if (container === 'none') return null;
    const field = descriptor.field || descriptor.id;
    if (!field || !isSafeFieldName(field)) return null;
    const schema = {
      moduleId: descriptor.id || field,
      field: field,
      title: descriptor.title || field,
      container: container,
      description: descriptor.description || '',
      fields: isPlainObject(descriptor.fields) ? cloneSchemaValue(descriptor.fields) : {}
    };
    if (container === 'scalar') {
      schema.scalarType = descriptor.scalarType || descriptor.type || 'string';
      if (Object.prototype.hasOwnProperty.call(descriptor, 'example')) schema.example = cloneSchemaValue(descriptor.example);
    }
    return schema;
  }

  function compareOutputDescriptorOrder(a, b) {
    if (getActivePresetMode() === 'free') {
      const aoFree = Number(a && a.order);
      const boFree = Number(b && b.order);
      return (Number.isFinite(aoFree) ? aoFree : 9999) - (Number.isFinite(boFree) ? boFree : 9999);
    }
    const outputIds = Object.keys(OUTPUT_SCHEMAS);
    const ai = outputIds.indexOf(a && a.id);
    const bi = outputIds.indexOf(b && b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    const ao = Number(a && a.order);
    const bo = Number(b && b.order);
    return (Number.isFinite(ao) ? ao : 9999) - (Number.isFinite(bo) ? bo : 9999);
  }

  function getActiveOutputSchemas() {
    return getActiveModuleDescriptors()
      .filter(function (descriptor) { return descriptor && descriptor.enabled !== false && descriptor.container !== 'none'; })
      .sort(compareOutputDescriptorOrder)
      .map(buildOutputSchemaFromDescriptor)
      .filter(Boolean);
  }

  function getDisabledOutputFields() {
    if (getActivePresetMode() === 'free') {
      return getActiveModuleDescriptors()
        .filter(function (d) { return d && d.enabled === false && d.field; })
        .map(function (d) { return d.field; });
    }
    const disabled = getDisabledModules();
    const fieldById = {};
    getModuleDescriptors().forEach(d => { if (d.field) fieldById[d.id] = d.field; });
    return disabled.map(id => fieldById[id]).filter(Boolean);
  }

  function getAllowedOutputFields() {
    const fields = getActiveOutputSchemas().map(schema => schema.field);
    if (fields.indexOf('world_digest') === -1) fields.push('world_digest');
    return fields;
  }

  function formatExampleValue(spec) {
    if (spec && Object.prototype.hasOwnProperty.call(spec, 'example')) return cloneSchemaValue(spec.example);
    const type = spec && spec.type ? spec.type : 'string';
    if (type.indexOf('array') === 0) return [];
    if (type === 'number') return 1;
    if (type === 'boolean') return true;
    if (type === 'object') return {};
    return '示例';
  }

  function buildSchemaExample(schema) {
    if (schema.container === 'scalar') {
      return formatExampleValue({ type: schema.scalarType || 'string', example: schema.example });
    }
    const item = {};
    Object.keys(schema.fields || {}).forEach(field => {
      item[field] = formatExampleValue(schema.fields[field]);
    });
    return schema.container === 'array' ? [item] : item;
  }

  function buildOutputExampleJSON() {
    const example = {};
    getActiveOutputSchemas().forEach(schema => {
      example[schema.field] = buildSchemaExample(schema);
    });
    example.world_digest = '本轮世界状态摘要，50-200字。';
    return JSON.stringify(example, null, 2);
  }

  function buildOutputInstructionsText() {
    const lines = [
      '## JSON 输出字段说明',
      '',
      '你必须输出一个 JSON 对象。只输出本轮有实质变化的字段；禁止为了凑数制造无意义内容。',
      '除 world_digest 外，允许的顶层字段由当前预设的模块结构决定。'
    ];

    getActiveOutputSchemas().forEach(schema => {
      const containerLabel = schema.container === 'array' ? '数组' : (schema.container === 'scalar' ? '标量' : '对象');
      lines.push('', '### ' + schema.field + '（' + containerLabel + '）');
      if (schema.description) lines.push(schema.description);
      if (schema.container === 'scalar') {
        lines.push('- value [' + (schema.scalarType || 'string') + ']: 直接返回该字段的值。');
        return;
      }
      Object.keys(schema.fields || {}).forEach(field => {
        const spec = schema.fields[field] || {};
        const type = spec.type ? ' [' + spec.type + ']' : '';
        lines.push('- ' + field + type + ': ' + (spec.description || ''));
        if (isPlainObject(spec.itemFields) && Object.keys(spec.itemFields).length) {
          Object.keys(spec.itemFields).forEach(sub => {
            const subSpec = spec.itemFields[sub] || {};
            const subType = subSpec.type ? ' [' + subSpec.type + ']' : '';
            lines.push('  · ' + field + '[].' + sub + subType + ': ' + (subSpec.description || ''));
          });
        }
      });
    });

    lines.push('', '### world_digest（字符串）');
    lines.push('本轮世界状态摘要，50-200字。');
    lines.push('', '## JSON 输出示例', buildOutputExampleJSON());
    return lines.join('\n');
  }
  function getRuleCount() {
    return RULES.length;
  }

  return {
    loadRules,
    getAllRulesText,
    getCoreRulesSummary,
    getRuleCount,
    getModuleList,
    getModuleDescriptors,
    getActiveModuleDescriptors,
    getActiveModuleDescriptorWarnings,
    buildRulesTextFromDescriptors,
    getBuiltinMechanics,
    getBaseModuleOutputSchema,
    getModuleOutputSchema,
    buildOutputSchemaFromDescriptor,
    getActiveOutputSchemas,
    getDisabledOutputFields,
    getAllowedOutputFields,
    buildOutputInstructionsText,
    buildOutputExampleJSON
  };
})();
