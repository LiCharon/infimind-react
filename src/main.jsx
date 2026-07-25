import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// 动态添加meta标签和字体链接
function setupHTML() {
  const head = document.head
  
  // 添加字体预连接
  if (!document.querySelector('link[rel="preconnect"][href="https://fonts.googleapis.com"]')) {
    const preconnect1 = document.createElement('link')
    preconnect1.rel = 'preconnect'
    preconnect1.href = 'https://fonts.googleapis.com'
    head.appendChild(preconnect1)
    
    const preconnect2 = document.createElement('link')
    preconnect2.rel = 'preconnect'
    preconnect2.href = 'https://fonts.gstatic.com'
    preconnect2.crossOrigin = 'anonymous'
    head.appendChild(preconnect2)
  }
  
  // 添加字体样式
  if (!document.querySelector('link[href*="fonts.googleapis.com"]')) {
    const link = document.createElement('link')
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
    link.rel = 'stylesheet'
    head.appendChild(link)
  }
}

// 初始化
setupHTML()

/**
 * 全局错误捕获层（在 React 挂载之前安装）。
 *
 * 用于诊断用户本地浏览器白屏：即使 React 根本没挂起来（例如模块加载错误、
 * 同步抛出异常、未处理 Promise rejection），也能在页面上显示第一条错误，
 * 而不是一片空白。错误同时写入 window.__BOOT_ERROR__，便于用户复制反馈。
 *
 * 开发与生产都启用：生产只显示 message + 第一行 stack，不暴露服务器内部信息。
 */
function installGlobalErrorOverlay() {
  const showError = (title, detail) => {
    try {
      window.__BOOT_ERROR__ = { title, detail, time: new Date().toISOString() }
      // eslint-disable-next-line no-console
      console.error('[BootError]', title, detail)
    } catch (_) {
      // 忽略
    }
    // 避免重复叠加
    if (document.getElementById('__boot_error_overlay__')) return
    const host =
      document.getElementById('root') && document.getElementById('root').shadowRoot
        ? document.getElementById('root').shadowRoot
        : document.body
    if (!host) return
    const overlay = document.createElement('div')
    overlay.id = '__boot_error_overlay__'
    overlay.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:#0b1020', 'color:#e6e8ee',
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
      'padding:24px', 'box-sizing:border-box',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';'))
    const card = document.createElement('div')
    card.setAttribute('style', [
      'max-width:760px', 'width:100%',
      'background:#121a30', 'border:1px solid #2a3556',
      'border-radius:16px', 'padding:28px',
      'box-shadow:0 20px 60px rgba(0,0,0,0.45)',
    ].join(';'))
    const titleEl = document.createElement('div')
    titleEl.textContent = '⚠ ' + title
    titleEl.setAttribute('style', 'font-size:18px;font-weight:700;margin-bottom:12px;color:#ff9b9c')
    const detailEl = document.createElement('pre')
    const detailText =
      typeof detail === 'string'
        ? detail
        : (detail && (detail.stack || detail.message || JSON.stringify(detail))) || ''
    detailEl.textContent = detailText
    detailEl.setAttribute('style', [
      'background:#0b1020', 'border:1px solid #2a3556', 'border-radius:10px',
      'padding:14px 16px', 'font-size:12px', 'color:#c8cee0',
      'white-space:pre-wrap', 'word-break:break-word', 'max-height:260px', 'overflow:auto',
    ].join(';'))
    const hint = document.createElement('div')
    hint.textContent = '提示：请按 F12 打开控制台，复制红色错误及 Network 中失败的 JS 请求反馈。'
    hint.setAttribute('style', 'margin-top:14px;font-size:12px;color:#6b7490;line-height:1.6')
    const reloadBtn = document.createElement('button')
    reloadBtn.textContent = '重新加载'
    reloadBtn.onclick = () => window.location.reload()
    reloadBtn.setAttribute('style', [
      'margin-top:16px', 'padding:10px 18px', 'background:#3b82f6', 'color:#fff',
      'border:none', 'border-radius:10px', 'font-size:14px', 'font-weight:600', 'cursor:pointer',
    ].join(';'))
    card.appendChild(titleEl)
    card.appendChild(detailEl)
    card.appendChild(hint)
    card.appendChild(reloadBtn)
    overlay.appendChild(card)
    try {
      host.appendChild(overlay)
    } catch (_) {
      // 忽略
    }
  }

  window.addEventListener('error', (event) => {
    // 资源加载错误（event.target 为元素）单独标记
    const target = event.target
    if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK' || target.tagName === 'IMG')) {
      const src = target.src || target.href || ''
      showError('脚本/资源加载失败', `资源：${src}\n这通常是白屏的直接原因：浏览器无法加载该 JS/CSS。\n请检查 Network 面板，或确认本地服务进程端口是否正确。`)
      return
    }
    const err = event.error || event.message
    showError('页面加载遇到错误（运行时异常）', err)
  }, true) // 使用捕获阶段以拿到资源加载错误

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    showError('未处理的 Promise 异常', reason)
  })
}
installGlobalErrorOverlay()

// 渲染React应用
// ErrorBoundary 包在最外层，捕获任何路由页面的渲染异常，
// 避免用户本地浏览器因渲染崩溃直接白屏而无法定位原因。
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

