# 法飞飞商业合同审查项目交接说明

> 更新时间：2026-07-16 23:15（Asia/Shanghai）  
> 工作区：`/Users/ypc/Desktop/桌面 - ypc的MacBook Air/项目开发/讯飞法飞飞AI/infimind-react`  
> 当前分支：`main`  
> 当前 HEAD：`ff068ad fix(contract-review): unify annotation source and positioning`

## 1. 当前任务是什么

我们正在把原来的 `/contract-rewrite` “合同改写试用页”替换成新的“商业合同审查与批注”产品，并把前后端完整部署到腾讯云宝塔面板。

完整业务链路目标：

1. 用户上传 PDF、Word 或合同图片。
2. Agent 1 分析合同结构、主体和缺失项。
3. Agent 2 输出结构化风险结论。
4. 服务端代码把每条风险确定性定位到合同原文。
5. 正常对话报告和“风险批注待确认”页面必须使用同一份风险数据。
6. 用户勾选风险批注。
7. Agent 3 只根据用户确认的风险生成修订稿。
8. 待填写内容统一显示为 `____`。

当前最紧急的问题不是 Agent 链路，而是：

> 用户在本地普通浏览器运行当前源代码时仍然看到白屏。构建通过，新浏览器自动化可以正常渲染，但用户真实浏览器的运行时异常还没有抓到，因此问题尚未闭环。

## 2. 项目入口和常用命令

前端路由：

- 首页：`/`
- 商业合同审查：`/contract-rewrite`

常用命令：

```bash
npm install
npm run dev
npm run build
npm run preview
npm run server
```

知识库相关：

```bash
npm run import:templates
npm run evaluate:knowledge-base
```

注意：服务器部署时不要随便运行 `npm run import:templates`。服务器如果没有原始 Word 模板源目录，重新导入可能破坏当前已生成的知识库。

## 3. 当前代码架构

### 3.1 前端

主要文件：

- `src/App.jsx`
  - `/contract-rewrite` 渲染 `ContractRewritePage`。
- `src/pages/ContractRewritePage.jsx`
  - 新对话式合同审查页面。
  - 文件上传、SSE 流式审查、风险确认、生成修订稿。
  - 历史对话和审查任务存储。
  - “剩余用量”查询面板。
- `src/pages/ContractRewritePage.css`
  - 合同审查页面全部样式。
- `src/components/Header.jsx`
  - 首页产品菜单的商业合同审查入口。
- `public/logo.png`
  - 新的蓝橙色法飞飞图标，仅替换橙色星形图标，文字仍由页面渲染。

前端接口：

```text
POST /api/contract-rewrite
POST /api/contract-finalize
POST /api/contract-chat
GET  /api/account/balance
```

### 3.2 后端 Agent 链路

主要文件：

- `server/routes/contract-rewrite.js`
  - 审查、对话、确认批注后改写、知识库状态、剩余用量接口。
- `server/prompts/agent-1-analysis.js`
  - 合同结构分析提示词。
- `server/prompts/agent-2-review.js`
  - 风险审核提示词，要求只返回严格 JSON。
- `server/prompts/agent-3-rewrite.js`
  - 根据确认批注生成修订稿。
- `server/services/annotation-locator.js`
  - 使用代码将 Agent 2 的逐字 quote 定位到原文。
  - 将同一份 findings 渲染成对话报告。
- `server/services/review-session-store.js`
  - 保存单次审查的合同原文和 canonical findings。
- `server/services/knowledge-base.js`
  - SQLite 知识库和证据检索。
- `server/services/vector-store.js`
  - 可选 Qdrant 向量库。
- `server/services/evidence-reranker.js`
  - 可选 SiliconFlow reranker 或本地 heuristic。

Agent 2 的结构化结果必须包含：

```json
{
  "conclusion": "...",
  "findings": [
    {
      "level": "高",
      "title": "...",
      "location": "第X条",
      "quote": "合同原文逐字摘录",
      "risk": "...",
      "advice": "...",
      "replacement": "",
      "evidence": ["E1"]
    }
  ],
  "completeness": ["..."]
}
```

模型不得输出行号或坐标。代码根据 quote 定位原文。

## 4. 已经完成的工作

### 4.1 批注统一数据源

此前最大的问题是：

- 正常对话报告有 38 条风险，但确认页只显示 26 条。
- 有时报告到第 13.4 条，确认页却分析到第 16.4 条。
- 确认页会出现报告里没有的第 14.2 条。
- 有时显示 18 条但只能选择 3 条。
- 有时直接显示 0 条批注。

根因是正常对话报告和批注确认页曾经各自解析或生成风险，事实来源不统一。

现在的方案：

1. Agent 2 只输出完整 JSON。
2. `annotation-locator.js` 解析 JSON。
3. 服务端代码定位 quote。
4. 形成唯一 `reviewResult.findings`。
5. 创建 `reviewSession`。
6. 对话报告由同一份 findings 渲染。
7. 确认页只使用 `reviewSession.findings`。
8. Agent 3 接收 `reviewSessionId + selectedFindingIds`。

不要恢复“从 Markdown 报告重新解析批注”的旧逻辑。

### 4.2 程序定位批注

定位不再由模型输出行号。

当前行为：

- 精确匹配模型 quote。
- 必要时做受控的文本归一化修复。
- 无法唯一定位的结论进入 `unresolved`，不会成为可勾选批注。
- 对话报告和确认页使用已验证 finding。

用户明确要求：

> 生成的批注必须对应原文，不能允许没有原文位置的批注进入修订稿。

### 4.3 修订稿占位符

前端会把：

```text
【待填写】
【待填写费用明细】
[待填写]
```

统一转换为：

```text
____
```

### 4.4 乱码文件标题

批注确认页曾显示类似：

```text
=== 文件: 4.2ä...docx ===
```

已经加入 `stripLegacyFileMarkers`，移除旧文件拼接标记。不要重新把上传文件名拼进合同正文。

### 4.5 风险确认页 UI 清理

已经移除或要求移除：

- “本轮模型发现 X 条 / 已验证 X 条 / 自动修复定位 X 条”统计 UI。
- 确认页顶部乱码文件标题。

当前源代码仍保留 `unresolved` 的“待核查定位项”区域。用户此前明确表示不希望模型负责定位；后续应确认是否彻底隐藏这块 UI，仅在服务端日志记录 unresolved。

### 4.6 新合同审查页面

页面标题和入口文字已经改成：

```text
商业合同审查与批注
```

当前源码中已不存在“合同改写功能试用”文字。

### 4.7 Logo

合同审查侧栏使用：

```text
public/logo.png
```

只用图标，不在图片内重复“法飞飞”文字。

### 4.8 剩余用量功能

合同审查左侧底部新增“剩余用量”面板。

已完成：

- `GET /api/account/balance`
- 调用 DeepSeek `/user/balance`
- 前端只显示人民币。
- 用户可见文案统一使用“剩余用量/用量”，不显示“API余额”。
- 删除“余额由当前配置的 DeepSeek API Key 查询”说明文字。

未闭环问题：

- 当前页面仍有“充值用量”链接，指向 `https://platform.deepseek.com/`。
- 用户已经指出：项目调用的是开发者个人账号 API Key，普通用户登录自己的 DeepSeek 账号充值不会增加项目 Key 的余额。
- 因此这个链接的业务逻辑是错误的。下一会话应移除该链接，或设计项目自己的充值/计费系统，不能继续引导用户去 DeepSeek 官方账号充值。

### 4.9 后端部署目录

已创建：

```text
agent-api-v2/
agent-api-v2.zip
```

`agent-api-v2/` 包含：

- `server/`
- `package.json`
- `package-lock.json`
- `.env.example`
- `.env.local`
- SQLite 知识库、索引和模板文本

默认部署端口：

```text
8790
```

初始部署采用：

```text
RAG_VECTOR_URL=
RAG_RERANKER_MODE=heuristic
```

即先使用本地 SQLite 和 heuristic，不要求同时部署 Qdrant/SiliconFlow。

## 5. 当前白屏问题：已知事实

### 5.1 线上旧构建验证

对白屏发生时的线上版本做过直接 HTTP 校验：

- `/contract-rewrite` 返回 200。
- HTML MIME 正确。
- 主 JS 返回 200，MIME 为 `application/javascript`。
- CSS 返回 200，MIME 为 `text/css`。
- React vendor、framer-motion、icons 分包全部返回 200。
- 线上文件与本地对应构建产物 SHA-256 完全一致。

因此已经排除：

- `dist/dist` 嵌套目录。
- 主 JS 缺失。
- CSS 缺失。
- vendor 分包缺失。
- 线上文件与本地文件内容不一致。

绝对不要再次仅根据“白屏”就断定是 `dist` 目录层级问题。必须先检查响应和浏览器控制台。

### 5.2 本地自动验证

用 Vite production preview 和全新 Edge 数据目录测试，同一份构建可以正常渲染：

```text
商业合同审查与批注
法飞飞合同助手
上传合同或输入你特别关注的审查重点…
```

随后向浏览器注入了故意损坏的历史存储数据，包括：

- `title: null`
- 错误时间格式
- 非字符串消息内容
- 损坏附件数组
- 无效审查任务

加入存储迁移后，自动测试仍能正常渲染。

### 5.3 已加入但尚未证实能解决用户白屏的修复

`src/pages/ContractRewritePage.jsx` 新增：

- `normalizeStoredMessage`
- `normalizeStoredThreads`
- `normalizeStoredTasks`
- `readStorage` 结构校验
- `writeStorage` 异常保护

这可以避免旧 localStorage 数据直接使 React 首次渲染崩溃。

但是：

> 用户在最后一次反馈中明确说：“本地还是白屏”。

因此不能把 localStorage 当成已经确认的最终根因。它只是已修复的一个潜在崩溃点。

### 5.4 当前最新构建

最新本地 `dist/index.html` 引用：

```text
/js/index-DNjwAjzy.js
/assets/index-CdY73dba.css
```

最新前端部署包：

```text
fafee-dist-contents-20260716-2216.zip
```

SHA-256：

```text
a70c24948aa087054841f9d9f7e04471c89164e2f7498655e5e8b378ec9eb78b
```

注意：这个最新包包含 localStorage 迁移修复，但用户随后仍报告本地白屏。不要在没有进一步诊断前声称该包已经解决白屏。

## 6. 当前卡在哪里

卡点是没有拿到用户真实本地浏览器的运行时错误。

构建成功不代表运行时成功。全新自动化浏览器正常，也不代表用户现有浏览器环境正常。

下一会话第一步必须获得以下证据之一：

1. 用户本地白屏页面的 DevTools Console 第一条红色错误。
2. Network 中失败或被阻止的 JS 请求。
3. 在根组件加入 Error Boundary 后显示出的错误信息。
4. 确认用户实际打开的是哪个本地 URL 和哪个 Vite 进程。

优先怀疑但尚未证明：

- 用户浏览器仍连接旧的 Vite 进程。
- 用户打开了错误端口或另一份项目目录。
- 浏览器扩展拦截脚本。
- 用户真实历史数据还有未覆盖的数据结构。
- 页面存在另一个只在用户浏览器环境触发的运行时错误。
- HMR 状态损坏，需要彻底停止并重启开发服务。

不要继续盲猜。先抓 Console。

## 7. 下一步执行计划

### 第一步：关闭所有旧开发进程

检查运行中的 Vite：

```bash
pgrep -af "vite|npm run dev"
```

只终止确认属于本项目的旧进程，不要批量 kill 其他项目。

重新启动：

```bash
cd "/Users/ypc/Desktop/桌面 - ypc的MacBook Air/项目开发/讯飞法飞飞AI/infimind-react"
npm run dev
```

记录终端显示的精确 URL。

### 第二步：抓真实控制台

在用户看到白屏的 Edge 页面：

1. 按 `F12`。
2. 打开 Console。
3. 刷新页面。
4. 复制第一条红色错误及完整堆栈。
5. 打开 Network，筛选 JS，检查是否有红色失败项。

不要先清空浏览器全部数据，否则可能丢失复现条件。

### 第三步：加入 Error Boundary

如果无法方便取得 Console，在 React 根节点增加 Error Boundary：

- 捕获渲染异常。
- 页面显示错误摘要和“清理本页历史数据后重试”按钮。
- 开发环境显示 stack。
- 生产环境不要暴露密钥或服务器内部信息。

这样以后即使再有异常，也不能只显示白屏。

### 第四步：验证旧存储迁移

至少测试：

- 无 localStorage。
- 合法历史数据。
- 非法 JSON。
- 数组中含 null。
- thread 缺 title/messages/id。
- message.content 不是字符串。
- files/annotations/unresolved 不是数组。
- localStorage 写入抛异常。

### 第五步：恢复强制加载入口

用户此前要求首页合同入口强制加载新页面：

```jsx
<Link
  reloadDocument
  to="/contract-rewrite"
  className="product-item"
>
```

重要：

> 当前 `src/components/Header.jsx` 中没有 `reloadDocument`，而且该文件当前不在 Git 修改列表中。

白屏解决后，需要重新确认并加回这个属性，再构建测试。不要误以为它已经存在。

### 第六步：重新构建和部署

```bash
npm run build
git diff --check
```

部署包必须解压到：

```text
/www/wwwroot/www.flylegal.cn/dist/
```

网站运行目录应为：

```text
/www/wwwroot/www.flylegal.cn/dist
```

SPA 配置：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

建议：

- `index.html` 不缓存。
- 带 hash 的 JS/CSS 可长期缓存。
- 每次部署同时上传新 `index.html` 和全部新 hash 文件。

### 第七步：部署新 Agent 后端

服务器目录建议：

```text
/www/wwwroot/www.flylegal.cn/agent-api-v2
```

Node 22，工作目录必须是 `agent-api-v2`，端口 8790。

Nginx：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8790;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

`proxy_pass` 后面不要加多余路径，避免 `/api` 被错误重写。

验证：

```bash
curl http://127.0.0.1:8790/api/health
curl -i http://127.0.0.1:8790/api/knowledge-base/status
curl -i https://www.flylegal.cn/api/knowledge-base/status
```

如果线上 `/api/knowledge-base/status` 仍然 404，说明 Nginx 还指向旧后端。

### 第八步：完整回归

必须至少跑一次：

1. 从首页点击“商业合同审查与批注”。
2. 页面直接显示新 UI。
3. 上传合同。
4. 对话报告生成。
5. 确认页批注数量与报告完全一致。
6. 每条批注能定位原文。
7. 全选和单选正常。
8. 生成修订稿。
9. 修订稿待填写内容为 `____`。
10. 下载和复制正常。
11. 快速模式和深度思考模式各测一次。
12. “剩余用量”接口正常。

## 8. 部署现状和历史判断

之前线上探测曾得到：

```json
{"status":"ok","service":"contract-rewrite-local"}
```

但同时：

- `/api/knowledge-base/status` 为 404。
- `/api/account/balance` 为 404。
- 在线审核输出仍是旧版 Markdown Agent 链路。

这说明当时线上 `/api` 指向旧 Node 服务。

该状态可能已经变化，下一会话必须重新在线验证，不能直接当作当前事实。

仅更新 `dist` 永远不会更新 Agent 提示词和服务端审查链路。

## 9. Git 和工作区状态

当前分支：

```text
main
```

当前 HEAD：

```text
ff068ad fix(contract-review): unify annotation source and positioning
```

工作区非常脏，包含大量用户修改和未跟踪文件：

- 前端页面与样式。
- 后端 Agent、知识库和检索服务。
- SQLite 数据库。
- 大量知识库模板文本。
- `agent-api-v2/` 和部署 zip。
- 多个 dist zip。
- 视频、图片、logo。

绝对不要执行：

```bash
git reset --hard
git checkout -- .
git clean -fd
```

也不要删除不理解的模板、数据库或媒体文件。

后续提交前必须按功能分组检查：

```bash
git status --short
git diff --check
git diff --stat
```

不要一次性 `git add .`，除非逐项确认所有大文件、数据库、密钥和部署包确实应该进入 Git。

## 10. 密钥和安全注意事项

### 10.1 不要提交 `.env.local`

`agent-api-v2/.env.local` 是部署配置文件，当前包含真实服务配置，至少有一个真实第三方密钥。

绝对不要：

- 提交到 Git。
- 上传到公开网盘。
- 把内容粘贴到 issue、PR 或聊天。
- 在日志中输出完整密钥。

### 10.2 `agent-api-v2.zip` 需要审计

当前 `agent-api-v2.zip` 很可能包含 `.env.local`。

如果该压缩包只通过安全渠道上传到自己的服务器，可以使用；但不要公开分发。

更稳妥的做法：

1. 重新打一个不含 `.env.local` 的代码包。
2. 在服务器上手工创建 `.env.local`。
3. 如果密钥曾被公开暴露，立即轮换。

### 10.3 不要开放 8790 公网端口

Node 端口只监听或只允许本机访问，由 Nginx 反代。

腾讯云安全组仅开放必要的：

- 80
- 443
- 受限来源的 22

## 11. 已踩过的坑：绝对不要再踩

### 坑 1：正常报告和确认页分别生成风险

禁止。

必须只有一份 canonical findings。报告、确认页、Agent 3 全部引用同一 review session。

### 坑 2：让模型输出行号作为定位

禁止。

模型只提供逐字 quote 和语义判断，定位由代码完成。

### 坑 3：确认页重新分析合同

禁止。

确认页是展示和选择，不是第二次审核。

### 坑 4：把无法定位的模型结论也做成可选批注

禁止。

无法唯一定位就不进入修订稿。可以日志记录或进入人工复核队列。

### 坑 5：只看“生成数量”，不核对数据来源

报告显示 38 条、确认页显示 26 条，不是简单的 UI 数字问题，而是事实源分叉。

修复时必须从服务端数据流排查，不要只改前端计数。

### 坑 6：只更新 dist，期待 Agent 链路变化

不可能。

Agent、提示词、知识库和 review session 都在 Node 后端，必须部署 `agent-api-v2` 并切换 Nginx `/api/`。

### 坑 7：看到白屏就认定目录层级错

这次已经证实目录和文件存在，线上文件哈希也一致。

以后必须按顺序：

1. 检查 HTML。
2. 检查 JS/CSS 状态码和 MIME。
3. 检查分包。
4. 检查 Console。
5. 再判断代码或部署。

### 坑 8：用全新浏览器测试通过，就宣称用户环境已修复

不可以。

全新数据目录正常只能证明构建可运行，不能证明用户真实浏览器状态正常。

### 坑 9：把 DeepSeek 官方充值入口直接给普通用户

项目 Key 属于开发者账号，用户充值自己账号不会增加项目用量。

必须移除官方充值链接，或建设自己的账户、订单、支付和用量系统。

### 坑 10：泄露密钥

不要在命令输出、文档、Git、截图或部署包公开真实 Key。

### 坑 11：随意清理脏工作区

当前大量未提交文件属于用户工作成果。不得 reset、clean 或批量删除。

### 坑 12：缓存策略配置错误

`index.html` 应禁止缓存；hash JS/CSS 可以缓存。

不能让新 HTML 指向尚未上传的 JS，也不能只上传 JS 不上传新 HTML。

## 12. 给新会话的第一句话建议

新会话开始后，先做：

```text
阅读 HANDOFF.md。当前优先级不是继续改 Agent，而是抓取用户本地普通浏览器白屏时的第一条 Console 错误。构建和全新 Edge 已正常，localStorage 迁移也做过合成回归，但用户仍报告白屏，不能继续猜原因。
```
