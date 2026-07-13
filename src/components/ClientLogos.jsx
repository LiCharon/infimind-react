import React from 'react'
import './ClientLogos.css'

const ClientLogos = () => {
  const logos = [
    { name: '小米', path: '/小米logo.webp' },
    { name: '泡泡玛特', path: '/泡泡玛特.webp' },
    { name: '中国移动', path: '/中国移动logo.webp' },
    { name: '中国电信', path: '/中国电信logo.webp' },
    { name: '复星集团', path: '/复星logo.webp' },
    { name: '平安证券', path: '/中国平安logo.webp' },
    { name: '陌陌', path: '/陌陌logo.webp' },
    { name: '绿洲游戏', path: '/绿洲游戏logo.webp' },
    { name: '宝宝树', path: '/宝宝树logo.webp' },
    { name: 'LG', path: '/Lg的logo.webp' },
    { name: '中石油', path: '/中国石油logo.webp' },
    { name: '鲜芋仙', path: '/鲜芋仙.webp' },
    { name: '中国民生信托', path: '/中国民生信托logo.webp' },
    { name: '真视通', path: '/真视通.webp' },
    { name: '中国泛海', path: '/中国泛海.webp' },
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

