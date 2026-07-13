import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
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

// 渲染React应用
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

