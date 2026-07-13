import React, { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { 
  Briefcase
} from 'lucide-react'
import Header from '../components/Header'
import Footer from '../components/Footer'
import RightSidebar from '../components/RightSidebar'
import './AboutPage.css'

const AboutPage = () => {
  const location = useLocation()

  // 页面加载时滚动到顶部（如果没有hash）
  useEffect(() => {
    // 如果URL中没有hash，滚动到顶部
    if (!window.location.hash) {
      // 立即滚动到顶部
      window.scrollTo({
        top: 0,
        behavior: 'instant'
      })
      
      // 使用多个延迟确保页面完全加载后也滚动到顶部
      const scrollToTop = () => {
        window.scrollTo({
          top: 0,
          behavior: 'instant'
        })
      }
      
      // 立即执行
      scrollToTop()
      
      // 使用多个延迟时间
      const delays = [0, 50, 100, 200, 300, 500]
      delays.forEach(delay => {
        setTimeout(scrollToTop, delay)
      })
      
      // 使用requestAnimationFrame确保DOM已更新
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToTop()
        })
      })
    }
  }, [location.pathname])

  // 滚动动画
  useEffect(() => {
    const revealOnScroll = () => {
      const reveals = document.querySelectorAll(
        '.fade-in, .fade-in-up, .fade-in-up-delay-1, .fade-in-up-delay-2, .fade-in-up-delay-3, ' +
        '.slide-in-left, .slide-in-right, .scale-in, .section-scroll'
      )
      
      reveals.forEach((element) => {
        if (element.classList.contains('visible')) {
          return
        }
        
        const windowHeight = window.innerHeight
        const elementTop = element.getBoundingClientRect().top
        const elementBottom = element.getBoundingClientRect().bottom
        const elementHeight = element.getBoundingClientRect().height
        const elementVisible = Math.min(elementHeight * 0.2, 200)
        
        if (elementTop < windowHeight - elementVisible && elementBottom > elementVisible) {
          element.classList.add('visible')
        }
      })
    }

    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -100px 0px',
      threshold: 0.1
    }
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
        }
      })
    }, observerOptions)
    
    const animatedElements = document.querySelectorAll(
      '.fade-in, .fade-in-up, .fade-in-up-delay-1, .fade-in-up-delay-2, .fade-in-up-delay-3, ' +
      '.slide-in-left, .slide-in-right, .scale-in, .section-scroll'
    )
    
    animatedElements.forEach((el) => {
      observer.observe(el)
    })
    
    window.addEventListener('scroll', revealOnScroll, { passive: true })
    revealOnScroll()

    return () => {
      window.removeEventListener('scroll', revealOnScroll)
      observer.disconnect()
    }
  }, [])

  // 核心团队成员
  const teamMembers = [
    {
      name: '夏孙明',
      role: '创始人/首席法律顾问',
      description: '十八年以上专业人力资源法律经验，为企业提供人力资源法律风险全流程管理。服务客户囊括国有企业、大型事业单位、大型民营企业，如小米、LG、中国移动、中国电信、中国五矿、中石油、中信投资、上海复星集团等，帮助顾问单位混改、裁员和引流，节约大量成本，稳定内部管理。',
      positions: [
        '新华网大学生就业创业公益律师团发起人',
        '创业酵母总法律顾问',
        '人民法治研究院互联网法治研究中心主任',
        '创业黑马、梅花创投、经纬创投等创投机构实战创业导师'
      ],
      image: '/夏律.webp'
    },
    {
      name: '孔令金',
      role: '联合创始人/投资人',
      description: '深耕法律科技与投融资领域15年，积累司法系统资深资源与头部投资基金从业经验。以法律科技为锚点，串联投资、财税、政企服务全产业链，打造了一站式企业合规与价值增长解决方案。',
      positions: [
        '铭程资本董事长',
        '受聘多家国央企董事'
      ],
      image: '/孔令金.webp'
    },
    {
      name: '王毅臣',
      role: '合伙人/副总裁',
      description: '资深AI场景应用专家，5年实战经验。合作过亚马逊云科技、海亮集团、广发银行等30余家各行业头部企业。精通跨行业需求洞察与技术嫁接，致力于将前沿AI能力转化为各垂直领域的落地解决方案与商业价值。',
      positions: [
        '前国家级直播电商产业园副总裁',
        '两岸企业家峰会文创小组电商联盟 技术顾问',
        'G20美丽杭州宣传大使（青年）'
      ],
      image: '/王毅臣.webp'
    }
  ]

  // 投资人
  const investors = [
    {
      name: '刘庆峰',
      description: '科大讯飞董事长，人工智能领域领军人物。长期致力于智能语音技术研发与产业化，获得2023年度国家科技进步奖一等奖。担任全国人大代表，在AI人才培养、自主可控大模型生态建设等方面提出重要建议。',
      positions: [],
      image: '/刘庆峰.webp'
    },
    {
      name: '吴世春',
      description: '梅花创投创始合伙人，知名天使投资人，在创投领域拥有丰富经验和卓越成就。多次获得清科集团、投中集团等权威机构评选的最佳天使投资人荣誉，入选福布斯中国最佳创投人榜单。投资案例包括理想汽车、小牛电动、58同城多家行业头部企业。',
      positions: [],
      image: '/吴世春.webp'
    }
    ]

  return (
    <div className="about-page">
      <Header />

        {/* Company Introduction */}
        <section className="company-intro section-scroll">
          <div className="container">
            <div className="section-header fade-in-up">
              <span className="section-label">关于法飞飞AI</span>
              <h2 className="section-title">法飞飞AI用工风险专家</h2>
            </div>
            <div className="intro-content fade-in-up-delay-1">
              <p className="intro-text">
              “法飞飞”AI用工风险小程序，是科大讯飞、梅花创投等领衔投资的AI法律智能体，通过AI赋能，一站式解决您的企业全流程用工风险管理问题！
              </p>
              <p className="intro-text">
              “法飞飞”通过整合科大讯飞在语音交互、法律智能体等法律专业领域的人工智能技术及法律行业数据积累，结合首席法律顾问夏孙明律师18年的劳动法实践经验及最新专业数据库进行深入研发，实现了劳动仲裁胜率AI分析及方案解决、各类用工模版自动调用、新员工入职背景调查及自主化报告、员工手册风险检测及修订，劳动合同电子签名及续约提醒，调岗降薪的流程及证据固定、离职员工电子档案存证。
              任何用工风险一键咨询或直接联系您专属用工法务顾问！
              </p>
            </div>
          </div>
        </section>

        {/* Investors */}
        <section className="core-team section-scroll">
          <div className="container">
            <div className="section-header fade-in-up">
              <span className="section-label">投资人</span>
              <h2 className="section-title">投资人</h2>
            </div>
            <div className="team-grid">
              {investors.map((investor, index) => (
                <div key={index} className={`team-card fade-in-up-delay-${index + 1}`}>
                  <div className="team-image-wrapper">
                    <img 
                      src={investor.image} 
                      alt={investor.name}
                      className="team-image"
                      loading="lazy"
                    />
                  </div>
                  <div className="team-info">
                    <h3 className="team-name">{investor.name}</h3>
                    <p className="team-description">{investor.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Core Team */}
        <section className="core-team section-scroll">
          <div className="container">
            <div className="section-header fade-in-up">
              <span className="section-label">企业领导</span>
              <h2 className="section-title">企业领导</h2>
            </div>
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div key={index} className={`team-card fade-in-up-delay-${index + 1}`}>
                  <div className="team-image-wrapper">
                    <img 
                      src={member.image} 
                      alt={member.name}
                      className="team-image"
                      loading="lazy"
                    />
                  </div>
                  <div className="team-info">
                    <h3 className="team-name">{member.name}</h3>
                    <p className="team-role">{member.role}</p>
                    <p className="team-description">{member.description}</p>
                    <div className="team-positions">
                      {member.positions.map((position, idx) => (
                        <div key={idx} className="position-item">
                          <Briefcase size={16} />
                          <span>{position}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

      <Footer />
      <RightSidebar />
    </div>
  )
}

export default AboutPage
