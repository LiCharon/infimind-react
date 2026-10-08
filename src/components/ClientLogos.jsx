import React from 'react'
import './ClientLogos.css'

const ClientLogos = () => {
  const logos = [
    { name: '小米', path: '/小米logo.webp' },
    { name: '泡泡玛特', path: '/泡泡玛特.webp' },
    { name: '盛世投资', path: '/盛世投资logo.webp' },
    { name: '知乎', path: '/知乎logo.webp' },
    { name: '复星集团', path: '/复星logo.webp' },
    { name: '嘉宾商学', path: '/嘉宾商学logo.webp' },
    { name: '陌陌', path: '/陌陌logo.webp' },
    { name: '绿洲游戏', path: '/绿洲游戏logo.webp' },
    { name: '宝宝树', path: '/宝宝树logo.webp' },
    { name: '叮叮懒人菜', path: '/叮叮懒人菜logo.webp' },
    { name: '九章云极', path: '/九章云极logo.webp' },
    { name: '探探', path: '/探探logo.webp' },
    { name: '蓝城兄弟', path: '/蓝城兄弟logo.webp' },
    { name: '真视通', path: '/真视通.webp' },
    { name: '赤子城', path: '/赤子城logo.webp' },
  ]

  // 复制logos以创建无缝滚动效果
  const duplicatedLogos = [...logos, ...logos]

  return (
    <section className="client-logos fade-in-up">
      <div className="logo-scroll">
        {duplicatedLogos.map((logo, index) => (
          <div key={index} className="logo-item">
            <img 
              src={logo.path} 
              alt={logo.name}
              className="logo-image"
              loading="lazy"
              decoding="async"
            />
          </div>
        ))}
      </div>
    </section>
  )
}

export default ClientLogos

