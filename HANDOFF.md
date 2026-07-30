# 法飞飞商业合同审查项目交接说明

> 更新时间：2026-07-28（Asia/Shanghai）
> 工作区：`/Users/ypc/Desktop/桌面 - ypc的MacBook Air/项目开发/讯飞法飞飞AI/infimind-react`
> 当前分支：`main`，HEAD：`703326b feat(contract-review): 三轮审核 + 自动改写 + 行内三明治视图`
> **当前有一大批未提交改动（见第 6 节），是最近两个会话的成果，已通过静态验证但未做真实合同端到端验证。**
> CodeGraph：`.codegraph/` 已初始化（codegraph CLI 可用，`codegraph status/query`），该目录未跟踪，默认不提交。

---

## 1. 我们在做什么任务

`/contract-rewrite` 是"商业合同审查与批注"产品：用户上传合同 → Agent 1 结构分析 → 知识库检索 → Agent 2 最多三轮审查 → 代码统一定位 → Agent 3 逐条改写 → 前端"行内三明治视图"批注稿 + 导出 Word。

**最近两个会话在解决高强度测试（多份长合同）暴露的三个问题：**

1. **批注位置混乱**，尤其"新增补充条款"类批注锚点乱飞。
2. **多轮审查重复报告**：即使 prompt 要求基于上轮复审，同一问题换措辞仍会重复出现，需要代码级去重。
3. **整行标注看不清**：问题点标注整条条款，原文全部划线，用户看不清具体问题子句；且一个条款有多个问题时每个批注都把整条划掉。

**本轮追加的第四个问题（用户截图确认）**：围绕同一条款的多个"新增"批注（如提前还款/收款确认/还款顺序）语义上是一段连贯补充约定，却渲染成三个独立块，且锚点原文重复三遍。已用"同锚点 add 展示层合并"解决。

---

## 2. 已完成的工作（最近两个会话，未提交）

### 2.1 精确定位与子句级 span（`server/services/annotation-locator.js`）

- `findQuoteSpansInRange`：把 finding 的 quote 精确映射为行内字符区间 `quoteSpans: [{line, start, end}]`，产出 `quoteText` 和 `quoteStatus('exact'|'none')`；只做精确子串命中，无法映射时不猜，前端回退整条显示。
- `findClauseEnd` / `isClauseHeadingLine`：识别"第X条"标题，求条款末尾行，供 add 锚点兜底。
- `findCodeLocatedRange` 增加最低分门槛（有 location 线索 0.10，无 0.18），不再 0 分放行到标题行。
- `buildReviewResult` 输出的 finding 新增：`quoteText`、`quoteSpans`、`quoteStatus`、`clauseEnd`；`originalText` 保留整条条款作上下文。
- `renderReviewReport` 输出"问题子句"行。

### 2.2 代码级去重 `findingSimilarity`（同文件，阈值经实测调过）

判重信号：quote 相似度（`quoteSimilarity`）+ 标题/风险描述相似度（`bidirectionalOverlap`，bigram）+ 行区间重叠 + location 相同。规则要点：

- quote 完全相等（=1）**不等于**同一问题：缺失条款类批注会共用同一锚点行（如"到期时还本付息"）。此时要求"问题同一性" `issueMatch`：`issueSim(标题+风险) ≥ 0.35` 或 `标题 ≥ 0.3 且 风险 ≥ 0.15` 才判重。实测：真重复（违约金比例缺失 vs 违约金未约定具体比例）riskSim=0.268 可合并；不同缺失项（提前还款 vs 还款顺序）标题撞词 0.43 但 riskSim=0，不合并。
- quote 仅为包含关系（0.55~0.85）时返回真实长度比，需 titleSim ≥ 0.45 才判重；`quoteSim ≥ 0.85` 的截断/扩写直接判重。
- `buildReviewResult` 内的二次判重已把 `risk` 传入比对（之前没有，issueSim 会退化为只有标题）。

去重是双层的：路由层跨轮 `findingSimilarity` 拦（`roundSnapshots` 带 `dropped` 计数，SSE 消息会报"去重过滤 N 条"）+ `buildReviewResult` 定位后再拦一次。Agent 2 prompt 也配合：前轮清单带原文摘录和风险，明确"换标题/换措辞/拆合表述都已记录"。

### 2.3 add 锚点解析（`server/services/revision-merger.js`）

- `resolveAddAnchor`：优先用 Agent 3 的 `insertAfterQuote` 逐字定位（多处命中时按 location 就近）；失败则条款标题锚点插到 `clauseEnd`；再失败插到 finding 行后；全失败 `anchorStatus: 'unresolved'`，**不猜位置**。
- Agent 3 prompt 新增可选字段 `insertAfterQuote`（引用锚点行正文，不要引用章节标题）和 `sequence`（同位置多个新增的顺序）。
- `mergeRevisions(findings, agentOutput, contractText)` 第三个参数必传；revision 新增 `sequence`、`insertAfterLine`、`anchorText`、`anchorStatus`。
- `sortRevisions`：add 按 `insertAfterLine` 排序，其余按 `lineStart`，次序按 `sequence`。

### 2.4 同锚点 add 展示层合并 `coalesceAdjacentAdds`（同文件末尾）

- **调用时机是关键**：在路由 `contract-rewrite.js` 的分批补全（retry）循环**完成之后、SSE 发送之前**调用。匹配/补全/`matchedIds`/`hasRewrite`/stats 全程保持 per-finding 的 1:1 口径，合并只是渲染前归并。
- 规则：`insertAfterLine` 相同且 ≥2 条 add → 按 `sequence` 排序合并：`rewrittenText` 用 `\n` 拼接、`riskNote` 用 ①②③ 编号、`level` 取最高（高>中>低）、`findingId` 复合（`finding-1+finding-2+finding-3`）、附 `mergedFindingIds`/`mergedCount`。单条 add 不动。
- `rewritePayload.stats` 保持 per-finding（total/modify/add/delete），新增 `blocks` 字段（展示块数）供前端判断是否有合并。

### 2.5 前端（`src/pages/ContractRewritePage.jsx` + `.css`）

- `RevisionDocument`：add 修订块挂在 `insertAfterLine` 之后（锚点缺失退回 `lineEnd`）；add 的锚点行不再标为问题行。导出 Word 的分组逻辑与此一致。
- 子句级标注：新增 `MarkedLineText` 组件——文档体内有精确 `quoteSpans` 的行只给问题子句加橙色波浪线 `.quote-mark`（含前导空白偏移校正、重叠区间合并）；无精确 span 时回退整行 `clause-flagged`。
- 三明治视图 `OriginalRow`：整条条款灰色显示作上下文，仅问题子句 `<s class="quote-strike">` 划线；`quoteStatus` 非 exact 或 indexOf 失败时回退整条划线 `.strike-all`；add 没有"被替换原文"，显示「位置：插入于 ××× 之后」（`.anchor-text`，不划线）。
- 导出 Word：原文行同样只划问题子句（`<s>`），add 显示插入位置；Word 内联 CSS 已同步。
- 计数口径：文档卡片和底部汇总的"N 处修订"改用 `rewriteStats.total`（finding 数）；`stats.blocks < total` 时追加「同一位置的多条新增已合并展示」。旧 localStorage 数据无 `blocks` 字段，自动按原样渲染。
- 底部提示文案已更新为子句划线语义。

### 2.6 验证状态

- 后端 10 项场景回归全部通过（共用锚点不合并、换措辞去重、同句截写去重、add 三合一、复合 id、批注编号、sequence 拼接、modify 不动、stats 口径、单 add 不合并）。测试脚本当时是 `node --input-type=module -e` 内联跑的，**没有落盘成测试文件**。
- `node --check` 三个后端文件通过；`npm run build` 通过；`git diff --check` 干净。
- **未做**：真实合同端到端验证（见第 4 节）。

---

## 3. 架构速览

### 关键文件

- 前端：`src/pages/ContractRewritePage.jsx`（对话页 + `RevisionDocument`/`SandwichBlock`/`OriginalRow`/`MarkedLineText` + 导出 Word）、`src/pages/ContractRewritePage.css`。
- 后端路由：`server/routes/contract-rewrite.js`（SSE 管线：analysis → knowledge → review×3 → rewrite → 补全 → 合并 → `rewrite.result`）。
- 定位/去重：`server/services/annotation-locator.js`（`buildReviewResult`/`findingSimilarity`/`findQuoteSpansInRange`）。
- 配对/合并：`server/services/revision-merger.js`（`mergeRevisions`/`resolveAddAnchor`/`coalesceAdjacentAdds`）。
- 提示词：`server/prompts/agent-2-review.js`（quote 只摘最小问题片段；缺失事项给锚点 quote）、`agent-3-rewrite.js`（1 finding = 1 revision；add 可带 insertAfterQuote/sequence）。

### 数据流（finding → revision → 前端）

finding：`id, level, title, location, anchor, originalText(整条), quoteText, quoteSpans, quoteStatus, clauseEnd, risk, advice, replacement, evidence, lineStart, lineEnd`
revision：finding 字段 + `action(modify/add/delete), rewrittenText, riskNote, sequence, insertAfterLine, anchorText, anchorStatus, hasRewrite`；合并块另有 `mergedFindingIds, mergedCount`。
stats：`{ rounds, total, matched, modify, add, delete, blocks }` —— total/modify/add/delete 是 per-finding，blocks 是合并后展示块数。

### 命令与端口

```bash
npm run dev        # 前端
npm run server     # 后端，默认端口 LOCAL_SERVER_PORT || 8789
npm run build      # vite 构建
npm run lint       # ⚠️ 当前跑不了：ESLint 9 需要 eslint.config.js，仓库没有（历史遗留，非本次改动引入）
codegraph status   # 代码索引；codegraph query "符号名" 查定义/引用
```

前端只调 `POST /api/contract-rewrite`、`POST /api/contract-chat`、`GET /api/account/balance`。`POST /api/contract-finalize` 是旧接口，前端不调，待清理。

---

## 4. 当前卡在哪儿

1. **缺真实端到端验证**：所有改动只过了合成数据冒烟 + build。必须用真实长合同（尤其那份"微信借款 8000 元"的借款合同，用户截图来源）跑一轮，确认：三条缺失项不被去重误吞、合并为一个新增块、子句划线位置正确、导出 Word 一致。
2. **改动未提交**：见第 6 节文件清单。端到端验证通过后才建议提交。
3. 历史遗留（与本轮无关但仍是卡点）：
   - 用户真实浏览器白屏问题加了多层兜底，仍需真实环境复核（构建通过+全新浏览器正常都不算数）。
   - `agent-api-v2/` 和 `agent-api-v2.zip` 是 2026-07-16 旧包，**不含** revision-merger 和三轮自动改写链路，且 zip 内含 `.env.local`（敏感），不能按现状部署。
   - 端口事实源不统一：代码默认 `8789`，旧部署文档写 `8790`，上线前必须二选一。
   - 侧栏"充值用量"链接仍指向 DeepSeek 官方平台，业务逻辑错误，未移除（`ContractRewritePage.jsx` 余额弹层里）。
   - 关键链路无自动化测试覆盖。

---

## 5. 下一步计划

1. **真实合同端到端回归**（本地 `npm run dev` + `npm run server`）：
   - 借款合同：三条还款相关补充应合并为一个新增块（位置行显示一次锚点、新增文本一段连贯、批注 ①②③），审查报告仍列 3 条 finding；
   - 多份长合同：观察跨轮去重的 `dropped` 计数是否合理（误吞或漏重都要回查 `findingSimilarity` 阈值）；
   - 子句划线：长条款只划问题子句，add 锚点行不被误标；
   - 导出 Word 与页面一致；快速/深度两种模式各跑一次。
2. **验证通过后提交**。按功能分组提交（定位+去重 / add 锚点+合并 / 前端展示），提交前 `git status --short` + `git diff --check` 逐项过，不要 `git add .` 一把梭。
3. 把内联冒烟脚本固化成测试文件（如 `server/scripts/test-dedup.js` 或正规测试框架），目前判重阈值只在一台机器上手工验证过。
4. 遗留事项（按旧计划）：复核真实浏览器白屏 → 移除 DeepSeek 充值入口 → 清理 legacy finalize 接口 → 重新打部署包（必须排除 `.env.local`）→ 部署后端并统一端口 → 线上回归。

部署要点（沿用旧文档，仍然有效）：

- 前端解压到 `/www/wwwroot/www.flylegal.cn/dist/`，SPA `try_files $uri $uri/ /index.html;`，`index.html` 不缓存、hash 文件长缓存。
- 后端 Node 22，工作目录为后端包根；Nginx `location /api/` 反代到 `127.0.0.1:8789`（或 8790，必须与 Node 实际端口一致），`proxy_buffering off`、`proxy_read_timeout 600s`，`proxy_pass` 后不要加多余路径。
- 部署后验证：`curl http://127.0.0.1:8789/api/health`、`/api/knowledge-base/status`、`/api/account/balance`，再查 `https://www.flylegal.cn/api/knowledge-base/status`。若 404 说明 Nginx 还指向旧后端/旧端口。

---

## 6. Git 和工作区状态

HEAD `703326b` 之上的未提交改动（即第 2 节全部内容）：

```text
 M HANDOFF.md
 M server/prompts/agent-2-review.js      # 缺失事项锚点规则 + 前轮清单带原文/风险
 M server/prompts/agent-3-rewrite.js     # insertAfterQuote/sequence 字段
 M server/routes/contract-rewrite.js     # 跨轮去重接线 + coalesceAdjacentAdds 接入
 M server/services/annotation-locator.js # quoteSpans + findingSimilarity + 阈值修正
 M server/services/revision-merger.js    # resolveAddAnchor + coalesceAdjacentAdds
 M src/pages/ContractRewritePage.jsx     # 子句划线 + add 挂载 + 合并展示 + 计数口径
 M src/pages/ContractRewritePage.css     # .quote-mark / .quote-strike / .anchor-text
 ?? .codegraph/                          # 不提交
```

**绝对不要执行** `git reset --hard`、`git checkout -- .`、`git clean -fd`——以上全部是未提交的工作成果。也不要删除不理解的模板、数据库、媒体文件。

---

## 7. 密钥和安全

- 不要提交 `.env.local`；`agent-api-v2.zip` 已确认内含 `.env.local`，按敏感材料处理，不要外发。
- 不要开放 Node 公网端口，只经 Nginx 反代。
- 服务器上不要随便跑 `npm run import:templates`：没有原始 Word 模板源目录时重新导入会破坏已生成的知识库。

---

## 8. 已踩过的坑：绝对不要再踩

### 本轮新踩的坑（判重与合并）

1. **quote 完全相等 ≠ 同一问题**。缺失条款类批注按 prompt 要求引用同一锚点行，三条不同问题 quote 一字不差。判重必须看"问题同一性"（标题+风险描述），不能只看 quote。
2. **quote 包含关系也不能直接判重**。整行锚点包含另一条问题的子句片段是常态（"任何一方违约，应向对方支付违约金。"包含"应向对方支付违约金"），包含只给真实长度比，需标题佐证。
3. **标题撞词分不开真假重复**。"违约金比例缺失/违约金未约定具体比例"（titleSim 0.417，真重复）和"缺少提前还款约定/缺少还款顺序约定"（titleSim 0.429，不同问题）仅靠标题阈值无法区分，风险描述相似度（0.268 vs 0.0）才是分界线。调阈值时用真实数据验证，别拍脑袋。
4. **展示层合并绝不能提前**。`coalesceAdjacentAdds` 若放进 `mergeRevisions` 内部，按 `findingId` 做键的分批补全覆盖逻辑直接失效（合并块对不上任何单一 findingId）。合并只能发生在 retry 完成之后、SSE 之前。
5. **统计口径必须 per-finding**。审查报告说 3 个问题、修订稿说 1 处新增，用户会以为丢了批注。stats 按 finding 计，`blocks` 单独报，前端文案对齐。
6. **不要让 Agent 3 合并批注**。协议是 1 finding = 1 revision，合并交给代码做（确定性）；放开协议会让匹配/补全/统计全部复杂化。
7. **`npm run lint` 跑不了是历史遗留**（ESLint 9 无 flat config），别以为是自己的改动弄坏的；验证后端用 `node --check`，前端用 `npm run build`。

### 历史坑（仍然有效）

8. 正常报告和确认/修订分别生成风险 → 两处口径必漂移；批注只能来自同一份 canonical findings。
9. 让模型输出行号做定位 → 模型行号不可信；定位必须由程序用 quote/location 完成，prompt 已禁止模型输出定位字段。
10. 把确认页或修订稿当第二次审核 → 改写只消费已定位 findings，不产生新风险。
11. 把无法定位的模型结论也做成批注 → 定位失败的进 unresolved，不猜、不展示。
12. 只看"生成数量"不核对数据来源 → 每条批注的原文必须能在合同里找到。
13. 只更新 dist 期待 Agent 链路变化 → 提示词/三轮/合并在后端，必须重新部署后端。
14. 部署旧的 `agent-api-v2.zip` → 它不含当前链路且含 `.env.local`。
15. 看到白屏就认定目录层级错；用全新浏览器测过就宣称用户环境已修复 → 两者都被证伪过。
16. 把 DeepSeek 官方充值入口直接给普通用户 → 业务逻辑错误，待移除。
17. 随意清理脏工作区、一次性 `git add .` → 工作区常有未提交成果和大文件/密钥/部署包。
18. 端口事实源不统一（8789 vs 8790）→ 代码、`.env.local`、Nginx 三处必须对齐。

### 实用技巧

- 看中文截图：主会话没有读图工具时，用 macOS 自带 Vision OCR（无需安装）：写个 swift 脚本调 `VNRecognizeTextRequest`（`recognitionLanguages = ["zh-Hans"]`），`swift /tmp/ocr.swift <图>`。本机 tesseract 只有 eng 语言包。
- `codegraph query "符号名"` 比 grep 更适合查定义和引用关系；索引过期时先 `codegraph index`。

---

## 9. 给新会话的第一句话建议

先跑 `git status --short` 确认第 6 节的未提交改动还在，然后按第 5 节第 1 步做真实合同端到端验证——这批改动（子句划线、add 锚点与合并、代码级去重）过了合成就绪验证，但还没见过真实合同。
