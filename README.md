# 法飞飞AI - React版本

这是法飞飞AI用工风险专家网站的React复刻版本，完全使用React技术栈构建，所有内容都通过React组件渲染。

## 技术栈

- React 18.3.1
- Vite 5.4.1
- CSS3 (所有样式和动画)

## 功能特性

- ✅ 响应式设计，支持移动端和桌面端
- ✅ Banner轮播图，支持自动播放和手动控制
- ✅ 客户Logo无缝滚动动画
- ✅ 产品矩阵交互式展示
- ✅ 行业解决方案切换
- ✅ 核心优势标签页切换
- ✅ 解决方案卡片网格
- ✅ 滚动动画效果
- ✅ 移动端菜单
- ✅ 下拉菜单交互
- ✅ 右侧边栏固定定位

## 安装和运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 项目结构

```
infimind-react/
├── src/
│   ├── components/          # React组件
│   │   ├── Header.jsx       # 头部导航栏
│   │   ├── Banner.jsx       # Banner轮播图
│   │   ├── ClientLogos.jsx   # 客户Logo滚动
│   │   ├── ProductSection.jsx      # 产品矩阵
│   │   ├── IndustrySolutions.jsx   # 行业解决方案
│   │   ├── AdvantagesSection.jsx   # 核心优势
│   │   ├── SolutionsSection.jsx    # 解决方案卡片
│   │   ├── ClientWall.jsx          # 客户墙
│   │   ├── CTASection.jsx          # CTA部分
│   │   ├── Footer.jsx              # 页脚
│   │   └── RightSidebar.jsx        # 右侧边栏
│   ├── hooks/               # 自定义Hooks
│   ├── App.jsx              # 主应用组件
│   ├── main.jsx             # 入口文件
│   └── index.css            # 全局样式
├── index.html               # HTML模板
├── vite.config.js           # Vite配置
└── package.json             # 项目配置
```

## 组件说明

所有组件都是纯React组件，使用函数式组件和Hooks实现。每个组件都有对应的CSS文件，样式完全复刻了原项目的视觉效果和动画效果。

## 浏览器支持

- Chrome (最新版本)
- Firefox (最新版本)
- Safari (最新版本)
- Edge (最新版本)

