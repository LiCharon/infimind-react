# Design QA — 商业合同审查助手

- Source visual truth: `/Users/ypc/Desktop/截屏2026-07-13 16.30.18.png`（默认对话态）和 `/Users/ypc/Desktop/截屏2026-07-13 16.30.29.png`（文档展开态）
- Implementation route: `http://127.0.0.1:5175/contract-rewrite`
- Intended viewport: desktop browser
- States checked: 默认对话、展开文档、展开批注

## Comparison history

### Pass 1

- Layout target: 默认状态采用左侧历史栏 + 单一对话主栏；展开后隐藏历史栏，保留左侧对话并在右侧显示大幅文档内容。
- Implementation evidence: Browser DOM confirms default state includes `历史对话`、对话输入器和 `查看批注稿`；点击后确认存在合同文档、下载操作与批注开关；再次点击确认显示 `3 处待确认`。
- Primary interactions tested: 打开批注稿、切换批注显示。
- Console health: local application had no console errors or warnings.

### Pass 2

- User-directed fix: moved document opening into the conversation result and removed message avatars.
- User-directed fix: made the composer position relative to `.chat-column`; browser layout metrics confirm its center matches the chat-column center.
- Browser DOM evidence: no assistant-avatar node remains; the document card is rendered only when the streamed `rewrite` state is present, and opens the same document state on click.
- Console health: local application had no console errors or warnings.

## Fidelity review

- Typography: 使用系统无衬线字体、轻量小号工具栏文字和更大的文档标题，匹配参考图的层级。
- Spacing and layout: 默认页保留侧栏和居中的长对话列；文档页将聊天收窄到左侧，正文在右侧留出宽松阅读空间。
- Colors and tokens: 采用白底、浅灰分割线和小范围橙色品牌强调，避免仪表盘式的多色状态。
- Image and asset fidelity: 参考图不包含需要复用的业务图片；界面图标使用项目现有图标库。
- Copy and content: 文案改为合同审查、风险建议和批注稿，不复用参考图中的业务文本。

## Blocking evidence

- Browser-rendered implementation screenshot: unavailable. The in-app Browser screenshot API produced a fully blank 1280px-wide image despite a populated DOM and successful interactions. Therefore an image-to-image visual comparison with the supplied screenshots could not be completed.
- Focused-region comparison: blocked for the same screenshot capture issue.

## Final result

blocked
