import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
import { writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

dotenv.config({ path: '.env.local' })

// 动态生成HTML的插件
function generateHTMLPlugin() {
  return {
    name: 'generate-html',
    configureServer(server) {
      // 在开发服务器启动时生成HTML
      server.middlewares.use((req, res, next) => {
        const htmlPath = resolve(__dirname, 'index.html')
        if (!existsSync(htmlPath) && req.url === '/') {
          const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>法飞飞-你的用工风险专家</title>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
</body>
</html>`
          writeFileSync(htmlPath, htmlContent)
        }
        next()
      })
    },
    buildStart() {
      // 构建时生成HTML
      const htmlPath = resolve(__dirname, 'index.html')
      if (!existsSync(htmlPath)) {
        const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>法飞飞-你的用工风险专家</title>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
</body>
</html>`
        writeFileSync(htmlPath, htmlContent)
      }
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
