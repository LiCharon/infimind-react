import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

dotenv.config({ path: '.env.local' })

/**
 * 标签页图标（favicon）的 <head> 声明。
 *
 * 为什么四行都要有：老 Safari（15 以下）不认 PNG 的 `rel="icon"`，只认 /favicon.ico，
 * 所以 ico 必须放第一行兜底；现代浏览器则优先用声明了 sizes 的 PNG，取哪个由浏览器决定。
 * apple-touch-icon 给 iOS 添加到主屏用（iOS 不支持透明，该文件是白底不透明）。
 * 资源均由 public/logo.png（纯符号标识）生成，见 public/favicon-*。
 */
const FAVICON_LINKS = [
  '    <link rel="icon" href="/favicon.ico" sizes="any">',
  '    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
  '    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
  '    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
].join('\n')

// 动态生成HTML的插件
function generateHTMLPlugin() {
  /**
   * ⚠️ `X-UA-Compatible: IE=edge` 不是历史包袱，它解决一个现网问题：
   * **360 浏览器等双核浏览器会默认落进 IE 兼容模式**，而 IE 内核根本不认识
   * `<script type="module">` —— 表现是整页白屏（不是崩溃）。加上这条 meta
   * 会强制它们使用可用的最高内核（Chromium/WebKit），走正常渲染路径。
   *
   * 注意 index.html 是**构建产物**（已在 .gitignore 中，且本插件仅在文件不存在时生成），
   * 所以修复必须写在这里，直接改 index.html 会在下次构建时被沿用/覆盖而不生效。
   */
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
${FAVICON_LINKS}
    <title>法飞飞-你的用工风险专家</title>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
</body>
</html>`
  const ensureHtml = () => {
    const htmlPath = resolve(__dirname, 'index.html')
    if (!existsSync(htmlPath)) {
      writeFileSync(htmlPath, htmlContent)
      return
    }
    // 已存在的 index.html 可能是旧版本（缺 X-UA-Compatible 或缺 favicon 声明）。
    // 逐项检查、只补缺失的那部分，避免每次构建都无谓改动文件时间戳，
    // 也避免覆盖掉文件里已有的其它内容。
    const current = readFileSync(htmlPath, 'utf8')
    let next = current
    if (!next.includes('X-UA-Compatible')) {
      next = next.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n    <meta http-equiv="X-UA-Compatible" content="IE=edge">')
    }
    if (!next.includes('rel="icon"')) {
      next = next.replace('    <title>', `${FAVICON_LINKS}\n    <title>`)
    }
    if (next !== current) writeFileSync(htmlPath, next)
  }
  return {
    name: 'generate-html',
    configureServer(server) {
      // 在开发服务器启动时生成HTML
      server.middlewares.use((req, res, next) => {
        if (req.url === '/') ensureHtml()
        next()
      })
    },
    buildStart() {
      ensureHtml()
    }
  }
}

export default defineConfig({
  plugins: [react(), generateHTMLPlugin()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.LOCAL_SERVER_PORT || 8789}`,
        changeOrigin: true
      }
    }
  },
  
  build: {
    // 启用代码压缩（使用esbuild，更快）
    minify: 'esbuild',
    // 如果需要更好的压缩率，可以安装terser并使用：
    // minify: 'terser',
    // terserOptions: {
    //   compress: {
    //     drop_console: true,
    //     drop_debugger: true,
    //   },
    // },
    
    // 代码分割和分包策略
    rollupOptions: {
      output: {
        // 手动分包
        manualChunks: {
          // 将React相关库单独打包
          'react-vendor': ['react', 'react-dom'],
          // 将framer-motion单独打包（较大）
          'framer-motion': ['framer-motion'],
          // 将lucide-react图标库单独打包
          'icons': ['lucide-react'],
        },
        // 优化chunk命名
        chunkFileNames: 'js/[name]-[hash].js',
        entryFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.')
          const ext = info[info.length - 1]
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return `images/[name]-[hash][extname]`
          }
          if (/woff2?|eot|ttf|otf/i.test(ext)) {
            return `fonts/[name]-[hash][extname]`
          }
          return `assets/[name]-[hash][extname]`
        },
      },
    },
    
    // 资源内联阈值（小于4kb的资源内联为base64）
    assetsInlineLimit: 4096,
    
    // 启用CSS代码分割
    cssCodeSplit: true,
    
    // 生成source map（生产环境可关闭以减小体积）
    sourcemap: false,
    
    // 压缩CSS
    cssMinify: true,
    
    // 构建目标
    target: 'es2015',
    
    // chunk大小警告阈值
    chunkSizeWarningLimit: 1000,
  },
  
  // 优化依赖预构建
  optimizeDeps: {
    include: ['react', 'react-dom', 'framer-motion'],
  },
})
