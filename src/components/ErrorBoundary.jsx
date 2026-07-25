import React from 'react'

/**
 * 根级 Error Boundary。
 *
 * 目的：用户本地浏览器出现白屏时，能直接在页面上看到第一条渲染异常，
 * 而不是一片空白。这样无需用户配合打开 DevTools 也能拿到错误信息。
 *
 * 行为：
 * - 捕获子树渲染异常，显示错误摘要与堆栈（开发环境）。
 * - 提供「清理本页历史数据后重试」按钮：仅清除合同审查相关 localStorage，
 *   不触碰其他站点数据，避免丢失复现条件以外的用户数据。
 * - 生产环境不暴露服务器内部信息，只显示通用错误与堆栈首行。
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // 完整堆栈只打到控制台，便于复制
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] 渲染异常：', error, info)
    this.setState({ info })
    // 同时写入一个便于用户复制的全局变量
    try {
      window.__LAST_RENDER_ERROR__ = {
        message: error?.message || String(error),
        stack: error?.stack || '',
        componentStack: info?.componentStack || '',
        time: new Date().toISOString(),
      }
    } catch (_) {
      // 忽略
    }
  }

  handleReload = () => {
    try {
      window.location.reload()
    } catch (_) {
      // 忽略
    }
  }

  handleClearHistory = () => {
    // 仅清除合同审查页面相关的本地存储键，避免误删其他数据
    const keysToClear = [
      'cr_threads',
      'cr_tasks',
      'cr_review_session',
      'contract_rewrite_threads',
      'contract_rewrite_tasks',
      'contract_rewrite_review_session',
    ]
    keysToClear.forEach((k) => {
      try {
        localStorage.removeItem(k)
      } catch (_) {
        // 忽略
      }
    })
    // 兜底：扫描 localStorage 中疑似合同审查历史的键
    try {
      const allKeys = Object.keys(localStorage)
      allKeys.forEach((k) => {
        const lk = k.toLowerCase()
        if (
          lk.includes('contract') ||
          lk.includes('rewrite') ||
          lk.includes('review') ||
          lk.includes('cr_threads') ||
          lk.includes('cr_tasks')
        ) {
          try {
            localStorage.removeItem(k)
          } catch (_) {
            // 忽略
          }
        }
      })
    } catch (_) {
      // 忽略
    }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { error, info } = this.state
    const isDev = import.meta.env?.DEV
    const message = error?.message || String(error)
    const stack = error?.stack || ''
    const componentStack = info?.componentStack || ''
    const firstStackLine = stack.split('\n')[1] || ''

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b1020',
          color: '#e6e8ee',
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          padding: '24px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: 760,
            width: '100%',
            background: '#121a30',
            border: '1px solid #2a3556',
            borderRadius: 16,
            padding: '28px 28px 24px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'rgba(255,77,79,0.15)',
                color: '#ff6b6b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              !
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>页面加载遇到问题</div>
              <div style={{ fontSize: 13, color: '#9aa3b8', marginTop: 2 }}>
                法飞飞合同助手未能正常渲染。下方是错误信息，可截图反馈。
              </div>
            </div>
          </div>

          <div
            style={{
              background: '#0b1020',
              border: '1px solid #2a3556',
              borderRadius: 10,
              padding: '14px 16px',
              marginBottom: 18,
            }}
          >
            <div style={{ fontSize: 12, color: '#9aa3b8', marginBottom: 6 }}>错误信息</div>
            <div style={{ fontSize: 14, color: '#ff9b9c', wordBreak: 'break-word', lineHeight: 1.5 }}>
              {message}
            </div>
            {isDev && stack && (
              <pre
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: '#c8cee0',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 220,
                  overflow: 'auto',
                  borderTop: '1px solid #2a3556',
                  paddingTop: 10,
                }}
              >
{stack}
{componentStack}
              </pre>
            )}
            {!isDev && firstStackLine && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#9aa3b8' }}>{firstStackLine.trim()}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={this.handleReload}
              style={{
                flex: 1,
                minWidth: 140,
                padding: '11px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              重新加载页面
            </button>
            <button
              onClick={this.handleClearHistory}
              style={{
                flex: 1,
                minWidth: 140,
                padding: '11px 16px',
                background: 'transparent',
                color: '#e6e8ee',
                border: '1px solid #2a3556',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              清理本页历史数据后重试
            </button>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: '#6b7490', lineHeight: 1.6 }}>
            提示：如反复出现，请按 F12 打开控制台，复制红色错误及「Network」中失败的 JS 请求反馈。
            点击「清理本页历史数据」仅会移除合同审查相关的本地存储，不会影响其他网站数据。
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
