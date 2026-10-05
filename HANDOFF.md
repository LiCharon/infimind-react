# 法飞飞 AI 合同工作台交接说明

## 当前交付（2026-10-05，提交合并与描述精简）

[带教仓库PR #8](https://github.com/spaceyzx216/infimind-react/pull/8)以PR #7合并点为基线。按用户要求，将首次交付的19个提交合并为两个：功能、共享机制与测试一个提交，README/HANDOFF及既有报告一个提交。最终SHA以PR提交页与git log为准。

本次只调整提交历史及README/HANDOFF中的交付记录，功能代码、测试、资料和配置与首次交付保持一致；旧历史保留在本地backup/pr8-before-squash-*分支，不推送备份。推送使用明确旧SHA的force-with-lease，避免覆盖远端新增提交，不改带教main。

PR描述按“相对PR #7的变化、模块实现、共享影响、验证和待验收”组织，删除逐提交流水及重复长说明。完整机制与分批证据仍见README和下方历史；11组后端、4组页面、49个JS检查、构建通过及lint的0 errors/105 warnings仍是首次交付批次结果，不追记为合并后重跑。带教/法务交付后复核，未合并或部署。

## 首次交付记录（2026-10-05，历史）

用户已授权分组提交、推送个人fork并向带教仓库创建PR，详细正文直接写入PR描述；不合并、不部署、不重启在用服务。带教/公司法务在代码交付后复核。

- 目标已实时核对为spaceyzx216/infimind-react:main，HEAD=4f14e90baa86052cc913d14803c4f9df30bb452c，正好是PR #7合并点；已fetch到upstream/main。本批创建前没有开放PR，fork没有同名远端分支。
- 来源为LiCharon/infimind-react:feat-employment-consultation。保留已有16提交，追加后端368a4fe（59文件）与前端52256d8（22文件），文档为第三提交；最终HEAD与推送/PR结果以Git和GitHub为准，不用提交前HEAD判断交付版本。
- 后端组包含src/utils中的共享结果/历史/上下文/进度纯函数、两模块实现、相关回归、虚构fixtures及已获准的五份仲裁参考意见。前端组包含公共组件、各页面/路由和五个页面测试/验证脚本，避免漏静态import依赖。
- 暂存快照隔离验证：11组后端回归全部退出0，仲裁分阶段96项；49个JS语法检查通过。预加载内存法规库及外部fetch拒绝器，不外发真实材料，不写现役数据。
- 4组Edge/API桩页面回归全部退出0；Vite使用临时端口55341且已停止。lint为0 errors/105 warnings，构建2300模块并输出到新系统临时目录；git diff --cached --check通过。参考意见末尾空行与分类器行尾空格只作空白修正。
- 总稿保留在约定的仓库外路径，PR页面直接承载独立可读的完整说明，包括技术选择、流程决策、接口/数据兼容、复现命令和试用步骤。临时证据和仓库外法务包不自动随Git，不把它们当评审访问前提。

以下“当前交付准备”是提交前快照，其未授权Git写操作、旧HEAD、远端未核对和未推送说法均限于当时；本节更新交付授权与验证状态。

## 提交前准备快照（2026-10-05，历史）

**按用户确认，本次范围从PR #7合并点 `4f14e90baa86052cc913d14803c4f9df30bb452c` 开始，以劳动合同/派遣和劳动仲裁答辩开发优化为核心；开发自测与既有用户试用记录已具备，可以进入提交评审环节。带教和公司法务在代码交付后复核，不作为提交前阻塞。** 本会话仍不暂存、提交、推送、创建远程PR、合并、部署或重启在用服务。

- 目标为带教仓库 `spaceyzx216/infimind-react`，来源个人fork `LiCharon/infimind-react:feat-employment-consultation`；本地HEAD `4ae12b6`。审查使用PR #7基线，不再默认过期origin/main。本轮只读ls-remote遇连接重置，远端最新集成分支未验证；提交时核对平台base分支选择，勿把本地范围统计当实际远端PR已创建。
- PR #7后已有16提交，已提交diff73文件/+29314/-78；还包括咨询、知识检索/引用、知识库产物、起草任务页、ESLint及公司法条目，不全部归为仲裁或“小样式修改”。最终磁盘范围：相对PR #7共有91个已跟踪差异文件、45个未跟踪，共136个去重路径；工作树39已跟踪修改+45未跟踪，暂存区为空。
- 五份 `server/data/labor-arbitration/references/1.txt–5.txt` 已获用户授权交付到带教仓库，须随仲裁运行实现纳入交付，仍是参考而非本案事实/金标；本轮没有外发到模型或远端仓库。
- 已修复未识别材料兜底：输入框补说明后点原发送按钮，后台识别一次，成功同次继续分析，不再提供额外识别按钮；classify可选clarification最多16000字符，仍核对原文引用。空/坏/无法识别材料不因说明放行；旧unsupported角色不再覆盖新判断，失败保留材料。修改只涉及现有分类器、路由、合同页及相关测试，无新必填字段/依赖/数据库变化。
- 已修复test:tasks法规库隔离：脚本内部先初始化内存库，不再要求作者临时预加载；2026-10-04首次隔离遗漏保留历史，未回写/清理现役库。

### 10月5日第二轮交互更新（当前流程）

用户选择无额外识别按钮方案；页面按具体文件区分没有正文、解析失败、类型未知、上传拒绝和服务临时故障，给对应处理路径。类型未知补用途/签署双方后发送，服务故障可直接再次发送；只尝试一次，成功使用新返回角色继续提交，失败保留输入/材料。classificationStatus可选字段由程序标识模型服务状态，旧响应兼容；分类不决定法律效力，也不绕过原文依据。

派遣协议才显示“分析视角”，默认空且必选；派遣单位/用工单位两选项传reviewPerspective。用工单位对配套劳动合同只读；单独派遣劳动合同不显示协议视角。已用两份仓库虚构fixtures验证，选择后清掉旧的请选择提示。未新增业务立场规则或默认替用户选边。

本轮劳动合同完整脚本、test:tasks、test:interrupt、四组合成API页面、lint与新临时目录构建通过；lint0 errors/105 warnings、构建2300模块。原有10月5日第一轮其它检查保留各批次，不混成真实模型或法务验收。证据 `C:/Users/lenovo/AppData/Local/Temp/fafee-pr-flow-20261005-cd8774dadb464eea9105a8c3c7bed968` 未随Git交付；测试Vite5198已停止，未重启在用服务。

### 10月5日第一轮修复验证（历史按钮方案）

`npm run test:labor-contract-analysis`、`npm run test:tasks`、`npm run test:interrupt`、`npm run test:contract-draft`、`node server/scripts/test-arbitration-staged.js`（96项）、`test-arbitration-hardening.js`、`test-labor-analysis-batches.js`均退出0。新增分类回归先在“说明未传入”断言失败，修复后通过。

Edge/模型桩：共享账号10路径、工作台、合同完整原文/批注/恢复与新类型兜底、仲裁v2流程回归均通过；隔离Vite5198已停止。`npm run lint`退出0、0 errors/105 warnings；临时outDir构建退出0、2300模块，未改dist。其它10月4日检查保留批次，不追记为10月5日再次运行。

lint过时说法另见规则AGENTS和第一阶段报告：报告已纠正；AGENTS按用户禁止范围保持只读。准确建议：将命令区旧“不可用”改为“eslint.config.js已存在；运行npm run lint，以当次结果为准”；规则修改留给获准维护者。

### 提交后事项与接手

1. 带教审查模块流程、接口及工程取舍；法务逐项复核法律/地区/时点、证据属性、风险和文书适用性。开发及用户试用记录不是法务签字结论。
2. 容量/限流、多实例删除协调、内容魔数校验、复杂扫描件与长合同/配套材料继续原后续安排；本轮未发现新增阻塞工程回归和构建的问题，不表示全面安全审计完成。
3. 部署时仍须备份SQLite/上传目录并在副本核对新增活动任务索引和90/365天清理影响；新API启动立即清理，代码回退不能恢复已删资料。提交PR不等于上线。
4. 建议三次可运行提交：共享后端+两模块后端/回归，共享前端+全部页面/路由，README/HANDOFF/既有报告文档。参考意见、fixtures、分类器、公共组件和结果utils不能漏。已有16提交由PR #7基线一并评审。

唯一总稿：[法飞飞本次PR整合说明-20261004.md](../../docs/法飞飞本次PR整合说明-20261004.md)，已在原文件补10月5日修复与逐模块决策，附独立可复制PR正文；仓库外资料需通过团队渠道另交付，临时日志不随Git。

以下10月4日及更早内容均是当时快照。其“待确认基线/资料许可/兜底未修复”等状态已由本节更新，不作为当前待办；数字和测试不跨批次混用。

## 整合审查历史（2026-10-04）

**劳动合同、派遣、仲裁及共享机制的文档已由本轮统一核对；已复验的工程路径通过，可交带教试用。PR目标、法务结论和发布运行态仍待确认，不等于已提交或已部署。** 本轮职责来自用户明确授权；流程/展示由用户与带教验收，法律判断、风险档位、条文与正式文书适用性由公司法务验收。README是现行机制说明，本文保留交付条件和批次证据。

### Git与交付边界

- 仓库：`infimind-react`；分支 `feat-employment-consultation`；HEAD `4ae12b6`。本轮初始37个已跟踪修改、45个未跟踪文件、暂存区为空；计数仅是2026-10-04本次读取的工作树快照，不是整个PR文件数。
- `origin` 为个人fork `LiCharon/infimind-react`，`upstream` 为带教仓库 `spaceyzx216/infimind-react`。本地 `origin/main=371d036`，本地提交历史已有PR #5/#6/#7合并记录；没有本地 `upstream/main` 引用。本轮未fetch、未核对远端最新main。不能直接把origin/main当目标。
- 相对旧origin/main有42个已有提交；相对本地PR #7合并点 `4f14e90` 有16个已有提交，包含双通道知识库、起草任务接入、咨询、检索/引用评测、ESLint及劳动合同初版。这些不是本轮未提交仲裁成果。base/head必须由用户/团队确定后重新核对，详见总稿候选范围。
- 本会话唯一修改README/HANDOFF；合同与仲裁旧会话不再同时写这两份。保留所有代码、共享文件及未跟踪材料；不暂存、提交、推送、建远程PR、合并、部署、重启服务或清场。
- 总稿：[法飞飞本次PR整合说明-20261004.md](../../docs/法飞飞本次PR整合说明-20261004.md)。仓库外资料不会随Git交付；实际PR须复制其正文与验证摘要。仲裁专项PR稿只作模块材料，不再作为整合总说明。

### 模块与共享影响

| 范围 | 当前交付事实与接手重点 |
| --- | --- |
| 普通劳动合同 / 派遣劳动合同 | 后台九主题、最多三轮分批增量、显式完成标记、有限重试与检查点、筛选评分后归并修订；完整原文累计批注、无法定位保留提醒、复制/下载和恢复。派遣劳动合同走劳动合同链路并核对派遣关系 |
| 派遣协议 | 后台八主题，单份或与配套合同成套；共用劳动合同产品ID，按analysisType分发独立工作流。协议上传仍需选择派遣单位/用工单位视角，用工单位不代改配套劳动合同。日期/期限/月度日期和明确主体的职业健康职责有程序校验 |
| 仲裁v2 | 上传先分析、最多三个必要追问、聊天或按钮按需草稿；请求/费用子项、来源、陈述属性与冲突、分项重算保留全案上下文、固定章节四标签、程序检查/独立模型辅助复核、一次修补、有效分析保留、版本失效和v1兼容 |
| 共享前端 | ContractWorkbenchLayout目前用于商业审查和劳动合同页；ToolComposerControls、ToolOverviewLink、ToolAccountPanel及公共样式影响审查、起草、咨询、劳动合同、仲裁及通用工具页。通用页样式接入不代表其法律业务已实现 |
| 共享后端 | 显式productId分发、任务/SSE/检查点、取消信号、权限及历史分页、解析PDF/OCR/Office、原件90天与会话365天、清理/删除重试、归并/修订/定位与标题服务；各模块独立规则仍独立 |

无新增业务表或本轮未提交依赖变化，**但SQLite初始化新增劳动合同活动任务部分唯一索引** `idx_tasks_active_labor_contract_analysis_thread`；不是“没有任何数据库变化”。相对不同base，既有提交可能已含依赖和数据库/知识库产物变化，必须按确认的base另核对。

### 本轮整合复验与限制

2026-10-04，本轮使用Node `v24.15.0`、npm `11.12.1`，实际重新执行：

- `npm run lint`：退出0，**0 errors、105 warnings**，未运行自动修复。ESLint配置在 `47ed903` 已提交；AGENTS仍写“lint不可用”属规则文件过期，本轮只列建议、不修改。
- `node server/scripts/test-arbitration-staged.js`：模型桩96项通过；`test-labor-arbitration.js`、`test-arbitration-hardening.js`通过。
- `npm run test:labor-contract-analysis`、`node server/scripts/test-labor-analysis-batches.js`（70风险故障恢复样例）、`test-labor-progress.js`通过。
- `npm run test:tasks`、`test:interrupt`、`test:auth`、`test:auth:client`、`test:contract-draft`、`test:consolidation`、`test:concurrency`、`test:word-annotations`通过。Word提取15条批注，Mammoth有忽略v:line/w:cr的warning；隔离回归不是容量测试。
- Edge/Playwright合成API：共享账号10条工具路径、工作台、劳动合同完整原文/批注/下载/恢复及仲裁v2来源/按需出稿/版本/取消/390px通过。使用独立Vite `127.0.0.1:5198`，API全部拦截；三个mjs在临时副本只改目标URL、Playwright导入及截图目录，仓库脚本未改。测试服务已停止。
- `npm run build -- --outDir <新建系统临时目录>`：退出0，2300模块；Vite提示outDir在仓库外且不会清空，这是本轮隔离输出设置，未改dist。51个变更/新增JS与MJS文件 `node --check` 通过；`git diff --check`通过（LF/CRLF提示单独记录）。

测试隔离补充：首次直接运行 `test:tasks` 时，咨询runner仍打开默认现役 `labor.db` 并执行初始化；主数据库文件修改时间仍为2026-09-26，Git未显示其变化，但这不能证明完全未触碰数据库（SQLite共享内存文件存在）。本轮未回写或清理该库。随后临时模块先加载 `law-whitelist.initialize(':memory:')`，再执行原任务测试，退出0。首次运行不归类为完全隔离；该历史版本使用预加载，当前10月5日已内置隔离，见文首。

日志/构建/截图：`C:/Users/lenovo/AppData/Local/Temp/fafee-pr-audit-20261004-5de0f099e2c0483190d230022fbc6033/`，仲裁截图为 `fafee-arbitration-staged-ui-9jn5xx8k`。这是本机临时证据，未随Git交付。未运行真实模型、实际Redis/BullMQ集成、真实中文OCR或默认用工咨询测试；后者会初始化/写现役知识库。历史53项内存副本通过不能称本轮全量咨询通过。

历史模型与OCR分批保留：仲裁 `8jdTQc` 四请求初步分析、`Xx3zRY` 十请求草稿、`2yRyeD` 六轮材料变化、`W7PsJC` HTTP/BullMQ/真实Edge，以及2026-10-03虚构中文OCR摘要均在磁盘找到并核对摘要，**本轮没有重新执行**。各提示词/参数批次独立，不合并作稳定性统计。法务包是12份多轮结果/42条请求条目，不是42个案件或法务结论。

合同历史虚构评测也在 `系统临时目录/fafee-labor-batch-benchmark/` 找到：`mT1eZE` 快速20.402秒、`R2A7bh` 深度106.021秒、`6ZnpDg` 派遣59.635/73.964秒、`We1hxO` 正向控制无风险；旧 `X1mrDA` 有期限筛查失败。各目录metrics可核查，但没有当前整树版本绑定，不承诺固定耗时、无漏检或当前真实模型已复验。未找到独立的仓库外交付版合同测试记录；总稿已提供可独立阅读的摘要与复现命令。

### 配置、运行与发布前提

- 两模式模型ID都为 `deepseek-flash`；旧 `DEEPSEEK_MODEL` / `DEEPSEEK_FLASH_MODEL` 被当前封装忽略。劳动合同/派遣深度仅审查和最终核对low；仲裁v2深度high；起草按模式low；商业主Agent沿用默认enabled/high，咨询主回答fast=high、thinking=max且均enabled。详见README模式表，不能统一声称“全工具快速关闭思考”。
- 有效留存配置为 `TASK_SOURCE_RETENTION_DAYS=90`、`TASK_SESSION_RETENTION_DAYS=365`；模板仍含旧模型和旧留存变量，本轮不修改环境文件。新原件上传起计时；正文/任务会话按同用户/产品/会话最近有效创建任务计时；阅读、标题、停用材料、队列创建失败不续期。
- API启动会立即清理到期文件/会话，随后每小时清理；历史原件采用更早期限，已清理数据无法靠回退代码恢复。部署前备份SQLite与私有上传目录，在副本核对活动任务重复和留存影响。新唯一索引遇同用户/同会话重复活动任务会初始化失败，本轮未打开真实业务库检查。
- API/独立Worker共享SQLite、私有上传路径与队列配置；模型/检索网络、LibreOffice路径、OCR中文语言资源和SSE代理需在发布环境验收。没有PostgreSQL接入，也未新增模型视觉接口。
- 账号面板显示服务端模型Key的账户余额，充值打开DeepSeek平台；不是独立用户额度或新增计费系统。上下文控件优先用最近单次promptTokens，累计usage是另一口径。
- **本轮未核对在用5173/8789或生产服务是否加载当前整树代码**。合同旧会话曾记录某轮API/Worker加载质量修复；仲裁某轮记录原服务未重启，两者属于不同模块/批次，不能推出当前全量已加载。只验证本轮独立测试进程，未重启在用服务。

### 待确认与待验收

1. 用户/团队确认实际PR目标仓库、base/head及SHA；确认既有咨询/知识库/起草提交是否在目标基线已存在，防止带入过期origin/main下的大范围改动。
2. 团队确认五份 `server/data/labor-arbitration/references/1.txt–5.txt` 能否进入目标仓库及资料访问范围；测试使用许可不等于公开发布许可。工作流运行与一项加固测试会读取这些文件，不能无替代方案漏交付。
3. 带教实际试用三模块及既有工具无回退；合同更长文本、行业和复杂配套材料进一步业务验收按既有安排暂缓，不重新定义范围。
4. 法务逐项核对企业立场、派遣职责/期限、事实/证据状态、风险档位、地区/时点、金额参数及正式文书适用性。独立模型和程序算术检查都不替代法务。
5. 代码只读审查发现的未识别类型交互缺口：`LaborContractAnalysisPage.jsx` 的unsupported分支阻止提交，输入说明不重新调用分类；`classify`接口也未接收该说明。建议复用现有分类入口做一次显式重新识别，仍不新增必填问卷；涉及接口/交互改动需确认后另修，本轮未改。部署容量、多实例删除协调、内容魔数校验等按原计划后续处理。
6. 文档可审查，目标基线与材料授权未决，法务/发布环境未验收；不自动执行Git写操作、发布或清理。

以下2026-10-03及更早记录均为历史批次，状态数字、分支、运行和测试结论仅适用于各记录时间。当前状态统一看本节，使用/API/配置看README。

## 劳动仲裁修复历史（2026-10-03）

本节保留2026-10-03仲裁及共享修复的历史批次，当前仲裁以文首2026-10-04分阶段v2为准；本节旧“带教业务验收”安排不代替公司法务验收。下方更早记录也仅作历史参考。该批次未提交、推送、部署，劳动合同的既有进行中修改保留。

- 仲裁保持企业侧对话、低/中/高风险及完整草稿；展示顺序和四标签沿用小程序文本结构。结果嵌套字段容错，请求及草稿完整性检查最多修补一次；不完整结果不当作正式文书。法规名称/状态匹配提示在页面和复制草稿中均保留，法律适用与证据真实性仍由带教验收。
- 修正共享 PDF API，扫描页逐页走已有本地 OCR，支持取消、保留页码和识别警告。文字 PDF、模拟扫描页、损坏/空文件、DOCX 及本机虚构中文 PNG/扫描 PDF 已验证；高置信度仍会错认个别汉字，所有 OCR 都保留核对提醒。Tesseract 曾打印语言资源警告，部署运行与复杂扫描仍待演练，没有新增依赖或模型视觉接口。
- 仲裁正文每文件保存上限 200 万字符；模型单轮读取材料预算 8 万字符，每份材料保留相关片段，避免新增大文件挤掉旧申请书。有截取或读取失败时，分析和草稿明确范围。取消首轮后补读原件的正文会保存回源任务，原件清理后仍可继续。
- 共享任务保存策略改为新原件上传后 90 天、会话/正文/草稿自最近有效提交后 365 天，查看不续期，队列创建失败不续期；新配置见 README。旧会话按最新有效任务计算期限，历史文件已有更早期限时沿用较早时间；不能恢复已经清理的文件。原件到期不再锁定有正文的仲裁案件，缺正文可原案件重传；会话到期禁止继续提交，并由既有清理器清除。
- 历史按用户/产品/案件隔离并分页，仲裁页以服务器记录合并本地缓存，刷新或回到页面可同步其它窗口的新回答、恢复任务及版本，保留未发送内容。材料面板折叠显示，支持停止/恢复使用；替换为停用旧材料后上传新材料，旧回答不改写成新事实。
- 仲裁与劳动合同删除先清文件再清数据库；文件失败返回 `deleted:false`，保留会话可重试。清理批次只删到期文件，不误删目录内其它文件；上传/删除互斥为当前 API 进程内保护。未知 `productId` 明确失败，不再误走商业合同审查。
- 复用边界：PDF/取消、共享任务保存期、历史分页和文件清理为底座能力；请求覆盖、四标签及仲裁证据口径属于仲裁业务。兼容 SSE 的短期进程缓存没有迁移，不能声称所有工具会话已统一持久化；跨实例协调、并发/容量优化后续处理。
- 已运行：`node server/scripts/test-labor-arbitration.js`、`node server/scripts/test-arbitration-hardening.js`、`npm run test:tasks`、`test:interrupt`、`test:labor-contract-analysis`、`test:contract-draft`、`test:word-annotations`、`test:consolidation`、`test:concurrency`。用工咨询前 7 组在内存库隔离副本中通过（53/0），未运行会写现役知识库的默认全量脚本。Edge + Playwright 虚构 API 验证插话、停止失败/创建失败输入保留、刷新/多窗口、材料停用、到期和窄屏；构建输出放系统临时目录，不改 dist。
- 待带教：用获准样例确认逐请求结论、风险档位、法规适用及文书可提交程度；扫描中文材料在发布环境演练。数值胜诉率、并发峰值、多租户不属于本次工程验收。

- 追加真实测试：五份获准意见、虚构四请求深度分析、无请求、跨案/注入、长材料及 HTTP/BullMQ 三轮链路通过；真实 Edge 浏览器无 API mock 验证上传、先取消再插话、追问、文书、恢复、到期及删除。已停止本轮专用服务，未重启原服务；现有本地后端不因此自动加载修复。
- 真实反例带来的修复：快速/深度输出预算 16,384/32,768、请求超时 180/300 秒；明确请求标题与事实编号；工伤简称/组合费用覆盖；总请求与逐项支付立场一致；首次取消后的追问不再提交首轮分析；职务不得当姓名。修补仍限一次，失败不保存为成功结果。共享上传拒绝扩展名伪装并统一超限中文 JSON（超大 413、数量 400），80 MB + 1 字节及 7 文件实际拒绝测试通过。
- 真实模型风险档位和请求分组在重复调用中会变化，结构检查不是法律准确率；完整批次及身份补测、浏览器/OCR证据见独立测试记录。带教应核对已有输出再决定业务规则，不把模型桩或单次成功当成生产验收。

实施计划另见仓库外 `../../docs/劳动仲裁答辩实现计划.md`，本次验证及输出位置见 `../../docs/劳动仲裁答辩测试记录-20261003.md`；本交接只记录本轮已实现状态，不承载实施计划。

## 第一、二阶段代码收尾（2026-09-22历史快照）

- 第一阶段「合同审查、合同起草两个功能的稳定性闭环」已完成：真实 DeepSeek + Redis/BullMQ + 独立 Worker（并发 1）联合验收通过；本轮补齐了起草页的任务接入，完整起草提交到 `POST /api/tasks/contract-draft`，按 `taskId` 订阅、恢复和取消，普通咨询/澄清仍走兼容 SSE。
- **合同审查已任务化**：审查页上传合同后走 `POST /api/tasks/contract-review`，接口只负责鉴权、接收文件并返回 `taskId`，Worker 负责解析、结构分析、证据检索、多轮审查、归并和修订。任务状态为 `queued` / `running` / `retry_waiting` / `succeeded` / `failed` / `cancel_requested` / `cancelled`。
- **合同起草页面已接入任务化**：完整起草、重新生成和全文更新使用 `POST /api/tasks/contract-draft`；页面消费 `GET /api/tasks/:taskId/events?after=<seq>`，刷新或重开历史对话时按 `taskId` 恢复，取消使用起草页同一停止按钮；无法入队的咨询和澄清回退到 `POST /api/contract-draft`。
- **同对话串行约束由数据库保证**：`tasks` 表对 `user_id + thread_id` 上的活动任务建立部分唯一索引，前端判断只是软约束，重复提交无法绕过。命中时合同审查返回 `409 review_task_conflict`，起草返回对应冲突码。
- **生成中停止与插队发送**：审查页发送与停止共用同一按钮（空闲发送 / 生成中空输入停止 / 生成中已有输入则停止上一轮并立即发送）。被中断的半截内容标记为 `interrupted`，可作为下一轮上下文但不作为正式审查结果；旧请求迟到的事件不会覆盖新回复。
- **后台任务入口已收敛**：左侧只保留「历史对话」，不再渲染独立的「后台任务」栏。刷新或重新打开对话时按关联的 `taskId` 恢复排队、运行、取消、失败与成功状态；`GET /api/tasks` 保留为服务端通用查询能力，不新增独立任务中心。
- 业务请求使用 15 分钟 HS256 JWT；随机刷新令牌仅保存在 `HttpOnly`、`SameSite=Lax` Cookie，登录绝对期限为 7 天。JWT 仅保存在页面内存，刷新页面时通过刷新令牌恢复登录。**刷新令牌是随机串，与 `JWT_SECRET` 无关**；轮换 `JWT_SECRET` 只影响已签发的 access token，刷新一次即可恢复。
- 已验证（2026-09-22）：`npm run test:tasks`、`test:contract-draft`、`test:interrupt`、`test:concurrency`、`test:consolidation`、`test:auth`、`test:auth:client`、临时输出目录构建、`git diff --check`，以及 Edge + 本地 mock API 的起草页 smoke。
- 2026-09-22当时checkout分支为 `feat-kb-whole-template`（基于上游合并后的 main `4f14e90`），含 3 个未推送提交：双通道交付+评测与 e2e 工具、severity 补齐后的知识库、起草页任务平台迁移。**PR #7（`feat/kb-eval-metrics`）已由上游以 merge 方式合入**（`4f14e90 Merge pull request #7`），该分支的远端副本停在 `2d7c901`。工作区另有 3 份文档修改（本交接说明、README、第一阶段验收报告）；知识库模板与起草页代码均无未提交改动。**不要用 reset、checkout 或清理命令覆盖这些文档改动。**
- **知识库双通道交付（本轮新增，2026-09-22）**：审查在原有 12 条证据之外，额外注入 1 份**同类型的完整好合同**作结构参照（`knowledge-base.getWholeTemplateForReview` → workflow knowledge 阶段选交付中得分最高的正向模板 → Agent 2 提示词规则 9）。范本是「结构参照」而非风险证据：不计入证据精度、不进 `evidence` 编号。环境变量 `RAG_WHOLE_TEMPLATE=off` 可整体回退。41 例实测：证据通道 0.6593/0.7187 与基线逐位一致（零扰动），**合并召回（证据∪范本）0.8028**；全量 e2e A/B 证据利用率 7.85/12→11.83/12、引用率 46.7%→61.2%，批注数与等级分布持平。
- **2026-09-22知识库快照（本轮未查询真实库）**：70 模板 / 1453 条款 / 604 风险规则 / 41 评测用例；severity 按 `rescore-severity.js` 三维打分补齐为 **高350 / 中235 / 低19**（与规则产出完全一致，可复现）。⚠️ **41 个评测用例是入库脚本自动生成的副产物**（`knowledge-base.js` 内每导入一份"坏例"生成一条；期望类别 = 该文档风险规则的类别去重），且 `resetKnowledgeBase()` 重建时会 `DELETE FROM evaluation_cases` ⇒ **人工金标必须存放在数据库之外**（当前权威副本为工作区的 `金标核对-41例-*.csv`，含 `template_id` 供重建后回灌）。
- 第二阶段 2A～2F 已完成；知识库评测门禁的 Qdrant/Embedding 本地验证已通过：`npm run check:kb` 41 例门禁通过，当前 `topK=12`、实际 `perDocumentCap=5`、向量口径为 `hybrid-ready`。官网小范围试用发布、真实后端 Edge 全链路和线上模型仍需单独复验；本轮未宣称已部署或 live verified。门禁的口径指纹已含 `cap`/`limit`（`2d7c901`）并据此重建基线，`npm run check:kb` 复验通过（4 项断言全绿）。

## 2026-09-15 认证与工具台状态（历史记录；当前状态以文首2026-10-04整合交接为准）

- 官网已实现“邀请码注册 → 登录 → 进入工具台 → 使用工具 → 退出后重新登录”。注册、登录、刷新、当前用户和退出接口均在服务端实现；业务 API 除健康检查和认证接口外均要求有效 JWT。
- 业务请求使用 15 分钟 HS256 JWT；随机刷新令牌仅保存在 `HttpOnly`、`SameSite=Lax` Cookie，登录绝对期限为 7 天。JWT 仅保存在页面内存，刷新页面时通过刷新令牌恢复登录；退出会撤销刷新令牌并清空页面凭证，关闭网页不会主动退出。
- SQLite 业务库保存用户、邀请码和刷新令牌的哈希；密码使用 `crypto.scrypt` 加盐哈希。邀请码一人一码，注册在事务内核销。真实密钥仅放入 `.env.local` 或服务器环境变量，不提交 Git。
- 工具台保留 9 个入口：合同审查与合同起草继续走现有真实后端和 SSE；其余 7 个工具复用会话原型。浏览器本地历史按“用户 ID + 工具 ID”隔离，JWT 不使用 localStorage 保存。
- 已验证：`npm run test:auth`、`npm run test:auth:client`、`npm run test:concurrency`、`npm run test:consolidation`、`npm run build`、相关 `node --check` 和 `git diff --check`。服务器数据库、正式模型 API Key、部署和线上验收仍为后续工作。

## 2026-09-14 前端原型说明（历史记录；当前状态以文首2026-10-04整合交接为准）

- 本地运行目录是包含 `package.json` 的 `法飞飞/infimind-react`，执行 `npm run dev`。当前开发预览为 `http://127.0.0.1:5173`；进程停止后需重新启动，以终端实际地址为准。
- 已调整产品演示视频：移除外围白卡、预览标题、矩阵分类标题及右下角入口，桌面视频高度为 700px、宽度按素材比例；保留底部立即体验。登录左侧改用预裁好的贴图 `public/auth-visual.jpg`（800×938，由登录页参考草图左半边裁出，原图存 `docs/reference/auth-reference.png`），CSS 用 `background-size: auto 100%` 按高度等比铺满，右侧表单为真实表单；自动登录复选框仅演示，不改变登录存储策略。工具台使用统一浅橙色和桌面多列紧凑布局，全部入口保留。
- 工具台布局曾做过一版「紧凑一屏」改造（固定 4 列 / 卡片压扁 / flex 摊开剩余高度），已按用户要求**回退**，现为上面这一版原始样式；改造版留存于工作区 `.tooling/backup/ToolHubPage.compact.{css,jsx}`，需要时可再取回。
- 会话导航统一复用 `ToolOverviewLink`，文字入口返回 `/tools`；已移除侧栏重复的当前工具说明。官网入口在工具总览。
- **架构边界**：合同审查和起草仍是两个现有页面，保留各自业务逻辑与历史存储；其余七个工具复用 `ToolConversationPage`，通过工具配置、路由参数和独立 localStorage key 区分。当前不是全站已完成共用工作台抽取。后续沿“公共工作台结构 + 工具配置 + 专属业务区域”增量设计，不复制整页扩展。
- **当时的原型边界（2026-09-14）**：登录仅本地模拟，邀请码未校验；历史目前按工具隔离，没有真实账号权限隔离。不能以此替代后端鉴权。七个新增工具返回明确标注的演示消息，不代表业务能力已接通。数据库、真实注册和完整公共外壳抽取不在当时修改范围。
- 本次验证：`npm run build`；Edge + Playwright 检查登录前置、回到工具台顶部、两个新增工具间历史隔离及刷新保留、两个合同页导航、390px 登录/工具台横向溢出和浏览器运行错误。未测试真实合同上传/模型调用，未发布线上。
- 追加验证（2026-09-14 晚，登录页贴图 + 工具台回退）：登录页与工具台在 1920×1080 / 1800×1000 / 1683×973 / 1672×941 / 1600×900 / 1440×900 / 1366×768 / 1280×960 / 1280×800 / 2560×1440 / 390×844 共 11 档下，**开发态与生产构建预览各跑一轮**，断言横向溢出为 0、登录贴图 200、无 console error / pageerror / HTTP≥400。用户实际视口为 1683×973（由截图侧栏宽度反推，缩放 1.52）。
- 收尾状态：代码及本地运行态 `changed-and-verified`；本节说明 `changed-and-verified`；规则未修改；记忆 `out-of-scope`；现有工作区改动保留、未提交。旧文档与全项目治理审计 `pending`，下方内容保留为 2026-08-13 历史快照，不作为本次运行事实。

> 更新时间：2026-08-13（Asia/Shanghai）· **以下为历史快照，非当前状态**
> 工作区：`/Users/ypc/Desktop/infimind-react`（当时路径；当前开发机路径为 `E:\桌面\资料\法智科讯\法飞飞\infimind-react`）
> Git 基线：`main` / `214ee60 feat: import annotated labor contract templates`（当时基线）
> 状态：当时的工作区未提交改动，后来已记录提交并合入main；“工作区干净”仅是该历史记录时点，不描述2026-10-04工作树。
> 本节保留仅用于追溯，不要照此执行；当前状态见文首2026-10-04整合交接。

---

## 0. 2026-08-13 任务交接（历史快照，内容已完成并合入 main，仅作追溯）

> **本节已过时，不要照此执行。** 该轮「`notice` 批注」工作已完成并合入上游 main（相关提交见 `git log`）。
> 其中「仓库当前目录不是 Git 仓库」「工作区包含未提交改动」等描述在当时或许成立，**后续历史核对已纠正**：当时记录仓库正常、工作区干净及git fsck无错误；2026-10-04本轮未运行fsck，且工作树有未提交修改。
> 当前状态请看文首2026-10-04整合交接。

### 正在做什么

修复合同审查修订稿中的一类展示误导：有些 finding 只要求用户确认或填写业务事实，原合同文字本身不需要改动。例如“本协议有效期：自____年__月__日至____年__月__日。”已经预留日期空位，批注只需提醒“请明确协议起止日期”。此前模型常把原片段原样放入 `replacementText`，页面于是显示“改为：本协议有效期……”，用户容易以为系统错误地把原条款照抄了一遍。

### 已完成

1. 已用 CodeGraph 初始化并索引当前项目（`.codegraph/` 为本地索引元数据），并结合本文件定位审查链路：
   `Agent 3 提示词 → revision-merger 校验/归并 → ContractRewritePage 行内卡片及 Word 导出`。
2. 在 `server/prompts/agent-3-rewrite.js` 增加局部操作 `notice`：
   - 用于“仅提示确认/补全，原文无需改写”；
   - 要求 `replacementText` 为空；
   - 明确禁止把 `targetQuote` 原样复制成替换文本。
3. 在 `server/services/revision-merger.js` 支持 `notice`，并兼容模型仍输出旧格式的情况：当 `operation: "replace"` 且 `replacementText` 与模型给出的 `targetQuote` 规范化后相同时，自动降级为 `notice`，且清空 `replacementText`。
4. 在 `src/pages/ContractRewritePage.jsx` 的页面卡片与 `exportWord` 中支持 `notice`：显示“提示 + 批注说明”，不显示“改为”，也不展开重复的完整修订条款。
5. 在 `server/scripts/test-finding-consolidation.js` 加入“原文不改、仅提醒”的回归断言。

### 当前状态／卡点

代码、回归和构建均已完成，**当前没有技术卡点**。尚未用真实合同端到端调用模型并在浏览器中人工确认视觉效果；这属于下一步验收，而不是代码阻塞。

本轮已通过：

```bash
npm run test:consolidation
npm run test:word-annotations
npm run test:concurrency
npm run build
node --check server/prompts/agent-3-rewrite.js
node --check server/services/revision-merger.js
```

`test:word-annotations` 会输出 mammoth 对 `v:line`、`w:cr` 的既有非致命警告，最终测试通过。`node --check` 不支持 `.jsx` 扩展名；前端语法由 `npm run build` 验证。

### 下一步建议

1. 启动前端和后端，上传一份含“有效期日期空位”条款的真实或脱敏 DOCX/PDF，检查页面第 N 条批注是否显示为“提示：请明确协议起止日期”，且不含“改为：原条款”。
2. 从该结果导出 Word，确认 Word 中同样是“提示”而非“改为”。
3. 观察真实模型是否稳定输出 `notice`；即使未稳定，`revision-merger` 的“原样替换→notice”兼容逻辑仍会覆盖完全照抄的常见情形。
4. 若继续迭代，考虑把 `notice` 在视觉上与真实文本修改进一步区分（例如不使用修改色高亮）；本轮按最小改动保留原有定位高亮，方便用户看到提醒对应的条款。

### 绝对不要再踩的坑

- 不要把“需要填写/确认”一律实现成 `replace`：原文不变时必须使用 `notice`，`replacementText` 为空。
- 不要只在前端用字符串相等判断掩盖问题；模型输出必须先在服务端 `revision-merger` 规范化，才能同时覆盖页面、历史数据和 Word 导出。
- `nearestQuoteMatch` 的返回 `targetQuote` 可能因定位器上下文与模型入参不同；识别“原样照抄”时应比较模型传入的 `rawEdit.targetQuote` 与 `replacementText`，不能只和定位后的文本比较。
- `annotation-locator` 对可精确定位的 quote 有至少 6 个规范化字符的安全阈值。测试片段太短会触发既有 fallback，不代表 `notice` 逻辑失效。
- ~~仓库当前目录不是 Git 仓库；不要假定 `git status`、提交或回滚可用。更不要使用破坏性清理命令覆盖现有用户改动。~~ **（已失效）** 本仓库是正常 Git 仓库，`git status` / `git commit` / `git push` 均可正常使用。但本机有一个已知问题：`.git/refs` 下**新建**的 ref 目录会被反复清空，处理办法见第 10 节。
- 不要删除 `.codegraph/`，除非明确不再需要本地代码图谱；有源文件修改后执行 `codegraph sync .` 保持索引最新。

---

## 1. 商业审查/起草历史能力基线（不包含本轮三模块验收）

项目有官网和一套共用外壳的双工作台：

| 工作台 | 路由 | 用户目标 | 正式交付物 |
| --- | --- | --- | --- |
| 合同审查与批注 | `/contract-rewrite` | 上传合同、审查风险、获取可追溯修改建议 | 原文定位的修订稿，可导出 Word |
| 合同智能起草 | `/contract-draft` | 描述交易或上传参考材料、持续补充事实 | Markdown 合同初稿、待确认信息，可复制或下载 Word |

两个页面均支持历史会话、独立任务、流式进度、余额浮层、附件上传与右侧文档展开。
**任务事实源已迁移到服务端 SQLite**：审查任务、事件、检查点与结果均由 `tasks` / `task_events` / `task_checkpoints` / `task_files` 持久化，浏览器 `localStorage` 只作为缓存；按 `taskId` 可查询、补拉事件并在 Worker 重启后恢复。
（历史说明：服务端 ReviewSession 仍是内存态，默认 2 小时过期，仅服务于 SSE 追问链路；异步任务不再依赖它。）

## 2. 用户关键流程

### 2.1 合同审查

```text
上传合同与审查重点
  → 文件解析/OCR
  → Agent 1：结构分析
  → 知识库检索与审查计划
  → Agent 2：最多三轮增量审查与代码去重
  → 原文定位、可信 finding 校验
  → Agent 4：已定位问题归并
  → Agent 3：逐条结构化修订
  → 前端行内标记、就近修订卡与 Word 导出
```

审查页没有附件时走普通追问 `/api/contract-chat`；**有附件时走异步任务接口 `POST /api/tasks/contract-review`**（返回 `taskId`，由 Worker 执行完整审查管线，通过 `GET /api/tasks/:taskId/events?after=<seq>` 回放与订阅事件）。
`POST /api/contract-rewrite` 仍保留为 SSE 直连接口。快速/深度思考模式只在审查页提供。

### 2.2 合同起草与可重复生成

```text
首次需求/新增参考材料 → 合同类型识别 → 生成完整初稿
已有初稿后的普通提问   → 根据当前草稿回答，不重复输出全文
明确要求重写/更新/重新生成 → 将当前草稿作为上下文，再生成一份新初稿
```

完整起草优先走 `/api/tasks/contract-draft`；已有草稿时前端携带 `parentTaskId`、`currentDraft` 和历史快照，服务端按 `draft` 操作生成新版本；`chat`、澄清和普通追问继续走 `/api/contract-draft` SSE。起草页用 Enter 发送，Shift+Enter 换行；中文输入法组合态不会误发。

## 3. 主要代码位置

| 范围 | 文件 | 职责 |
| --- | --- | --- |
| 路由与工作台入口 | `src/App.jsx`、`src/components/Header.jsx` | 官网与两个工作台入口 |
| 审查界面 | `src/pages/ContractRewritePage.jsx`、`.css` | 多会话、SSE 消费、修订稿、导出、Enter 发送 |
| 起草界面 | `src/pages/ContractDraftPage.jsx`、`.css` | 起草/追问/重生成、待确认面板、Word 下载 |
| API 编排 | `server/routes/contract-rewrite.js` | 上传校验、审查与起草 SSE、余额、追问 |
| 文件解析 | `server/services/file-parser.js` | PDF、Word、Office、文本、OCR、Word 批注/修订读取 |
| LLM 客户端 | `server/services/llm-client.js` | DeepSeek 兼容 Chat Completions、重试、流式响应 |
| 审查 Agent | `server/agents/contract-*.js`、`server/prompts/agent-*.js` | 分析、审查、归并、修订 |
| 起草提示词 | `server/prompts/contract-draft*.js` | 类型识别、专项条款与输出格式约束 |
| 审查可信性 | `server/services/annotation-locator.js`、`revision-merger.js` | finding 定位/去重、锚点、修订合并 |
| 任务 API | `server/routes/tasks.js` | 任务创建、列表、详情、事件订阅、取消；串行冲突返回 409 |
| 任务服务 | `server/services/task-service.js`、`task-queue.js`、`task-processor.js`、`task-runtime.js` | 状态机、队列（BullMQ / SQLite 降级）、阶段推进、检查点 |
| 工作流注册表 | `server/workflows/contract-review.js`、`contract-draft.js` | 按 `productId` 分派的各产品工作流 |
| Worker 入口 | `server/worker.js` | 独立进程消费任务；`TASK_RUN_WORKER=false` 时与 API 分离 |
| 前端请求状态 | `src/utils/thread-request-state.js` | 按 `threadId` 的运行态与取消标记 |

## 4. 接口与流式事件

| 接口 | 用途 | 主要事件/响应 |
| --- | --- | --- |
| `POST /api/tasks/contract-review` | **审查页主路径**：创建合同审查异步任务 | `202` + `taskId` |
| `POST /api/tasks/contract-draft` | 创建合同起草异步任务；咨询类请求不入队 | `202` + `taskId` |
| `GET /api/tasks` | 当前用户最近任务；服务端通用查询能力 | JSON |
| `GET /api/tasks/:taskId` | 任务状态、阶段摘要、结果或失败原因 | JSON |
| `GET /api/tasks/:taskId/events?after=<seq>` | 回放并持续订阅任务事件；断线后用递增序号补拉 | SSE |
| `POST /api/tasks/:taskId/cancel` | 取消当前用户的排队或运行中任务 | JSON |
| `POST /api/contract-rewrite` | 上传并审查合同（SSE 直连，保留） | `stage.start`、`stage.progress`、`analysis.delta`、`review.delta`、`review.round`、`rewrite.result`、`error` |
| `POST /api/contract-chat` | 审查页普通追问 | `chat.start`、`chat.delta`、`done` |
| `POST /api/contract-draft` | 兼容 SSE：普通对话、意图澄清及无法入队的起草请求 | `chat.*` 或 `draft.progress`、`draft.type`、`draft.start`、`draft.delta`、`draft.complete`、`error` |
| `POST /api/contract-finalize` | 历史确认后改写接口 | 保留兼容；当前主界面不调用 |
| `GET /api/account/balance` | 读取模型账户余额 | JSON |

除健康检查和 `/api/auth/*` 外，所有 `/api` 接口都要求 `Authorization: Bearer <JWT>`，未登录返回 `401`；跨用户访问任务返回 `404`。
同对话重复提交会命中串行约束，返回 `409`（审查为 `review_task_conflict`）。

SSE 连接需要 Nginx 关闭代理缓冲并保留较长读取超时；不要把事件先汇总后再返回，否则前端进度与流式文本会失效。

## 5. 附件解析能力与部署依赖

前后端白名单一致支持：

- PDF、DOC、DOCX、RTF、ODT；
- XLS/XLSX/ODS、PPT/PPTX/ODP；
- TXT、Markdown、CSV/TSV、JSON、XML、HTML；
- PNG、JPG/JPEG、WebP、BMP、TIFF/TIF、GIF。

处理原则：DOC 优先使用 macOS `textutil`，失败或 Linux 环境回退到 LibreOffice/soffice；RTF 在转换器返回空文本时回退本地控制字解析；Office 文件经 LibreOffice 转为文本；图片先用 `jimp` 放大、灰度化、增强对比度，再使用 `chi_sim + eng` OCR，低置信度会补跑稀疏文本模式。

生产环境要求：

1. Node.js **24**（见 `.nvmrc`；`server` / `worker` 脚本使用 `--use-env-proxy`，需 Node ≥ 22.21）；执行 `npm ci` 安装依赖。
2. 安装 `libreoffice`/`soffice` 与中文字体（Ubuntu 常用 `libreoffice fonts-noto-cjk`）。没有它时 DOC、Office 格式无法可靠转换。
3. Tesseract.js 首次 OCR 需取得中英语言模型；生产环境要保证可下载，或预热/缓存语言模型。
4. Multer 使用内存存储，单文件上限 80MB、一次最多 6 个。OCR 与 Office 转换会占用 CPU/内存，线上建议至少 4GB 内存，并在 Nginx 同步配置请求体限制与超时。

## 6. 本地运行与验证

```bash
npm ci
npm run dev                 # Vite 前端
npm run server              # Express 后端，默认 8789 或 LOCAL_SERVER_PORT
npm run worker              # 独立任务 Worker（生产建议与 API 分离）
npm run build               # 前端生产构建
npm run test:tasks          # 任务平台：创建、事件回放、检查点、Fake LLM、越权、取消、重试
npm run test:contract-draft # 合同起草任务适配：意图分流、草稿快照、恢复、重试、取消、兼容 SSE
npm run test:interrupt      # 同对话串行、插队取消边界、迟到事件保护、taskId 恢复、越权
npm run test:concurrency    # 会话请求隔离回归
npm run test:consolidation  # finding 归并回归
npm run test:auth           # 邀请码、并发注册、密码/刷新令牌保密、JWT、恢复、退出
npm run test:auth:client    # 浏览器侧鉴权客户端回归
```

**运行环境注意**：`better-sqlite3` 是按 Node 24 编译的原生模块（`NODE_MODULE_VERSION` 137）。若 PATH 首个命中 Node 22，`npm run test:*` 会报 `ERR_DLOPEN_FAILED`，需把 Node 24 目录前置到 PATH。

2026-10-04更正：仓库已有 `eslint.config.js`，`npm run lint`实际退出0、0 errors/105 warnings。旧“缺flat config”是文档核对遗漏，不能沿用；其余语法/构建/回归仍应执行，构建使用新临时目录。

`npm run test:word-annotations` 需要本机安装 LibreOffice，缺少时会以 `spawn libreoffice ENOENT` 失败，属环境缺失而非代码回归。

## 7. 上线检查

1. 前端 `dist/` 部署到站点目录；SPA 使用 `try_files $uri $uri/ /index.html`。
2. `/api/` 反代到 Node 实际端口；配置 `proxy_buffering off`、`proxy_read_timeout 600s`，并统一 Nginx、`.env.local` 与 Node 端口。
3. 设置 DeepSeek API 环境变量，绝不提交或打包 `.env.local`。
4. 验证 `/api/health`、`/api/knowledge-base/status`、`/api/account/balance`，再做一次真实 DOC、XLSX、扫描图片和 PDF 的端到端上传。
5. 检查首次 OCR 的语言模型下载/缓存、LibreOffice 路径与中文字体。

## 8. 当前风险与下一步

- 新增文件格式与 OCR 预处理已通过语法、构建、Word 批注、并发和归并回归；仍应使用真实客户的 DOC、表格、演示文稿和低清扫描件做线上验收。
- `jimp` 新增依赖后，`npm audit` 报告依赖树风险；上线前应由维护者评估并安排依赖升级，不要盲目执行破坏性 `npm audit fix --force`。
- 起草意图路由会额外调用一次轻量分类；需观察线上延迟、分类误判与模型用量。
- **审查与起草的联合验收已在真实链路通过**（真实 DeepSeek + Redis/BullMQ + 独立 Worker 并发 1）。仍建议在浏览器中人工过一遍停止、插队与刷新恢复的交互效果。
- 生产拆分 API 与 Worker 时，在 API 进程设 `TASK_RUN_WORKER=false`，再单独运行 `npm run worker`；两者必须共享同一 SQLite 数据库与 Redis 配置。

## 9. 安全边界

- 模型密钥只留在后端环境变量；浏览器不得得到密钥。
- Node 服务仅监听本机或内网，由 Nginx 反代；不要直接暴露服务端口。
- 合同及上传材料具有敏感性；临时转换目录会在解析后清理，但部署日志不得记录正文。
- 输出是辅助起草/审查，不构成法律意见；高风险交易、签署、授权、税务与监管事项仍需人工专业复核。
