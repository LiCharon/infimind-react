import React from 'react'
import './ClientWall.css'

const ClientWall = () => {
  const clients = [
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

