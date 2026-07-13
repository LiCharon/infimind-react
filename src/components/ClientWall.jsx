import React from 'react'
import './ClientWall.css'

const ClientWall = () => {
  const clients = [
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

  return (
    <section id="clients" className="client-wall section-scroll">
      <div className="container">
        <h2 className="client-wall-title fade-in-up">先进企业的共同选择</h2>
        <p className="client-wall-desc fade-in-up-delay-1">法飞飞AI用工风险专家已服务众多知名企业，成为他们用工风险管理的首选伙伴</p>
        
        <div className="client-logos-grid">
          {clients.map((client, index) => {
            const delayClass = `fade-in-up-delay-${(index % 3) + 1}`
            return (
            <div key={index} className={`client-logo ${delayClass}`}>
              <img 
                src={client.path} 
                alt={client.name}
                className="client-logo-image"
                loading="lazy"
                decoding="async"
              />
            </div>
          )})}
        </div>
      </div>
    </section>
  )
}

export default ClientWall

