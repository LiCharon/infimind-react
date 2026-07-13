import React, { useEffect, useState } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import Header from '../components/Header'
import Banner from '../components/Banner'
import Footer from '../components/Footer'
import RightSidebar from '../components/RightSidebar'
import ClientLogos from '../components/ClientLogos'
import { Suspense, lazy } from 'react'

// 非首屏组件使用懒加载
const ProductSection = lazy(() => import('../components/ProductSection'))
const IndustrySolutions = lazy(() => import('../components/IndustrySolutions'))
const ClientWall = lazy(() => import('../components/ClientWall'))
const CTASection = lazy(() => import('../components/CTASection'))

// 加载中的占位组件
const LoadingPlaceholder = () => (
  <div style={{ 
    minHeight: '200px', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center',
    background: '#fafafa'
  }}>
    <div style={{ 
      width: '40px', 
      height: '40px', 
      border: '4px solid #f3f3f3',
      borderTop: '4px solid #FD7002',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    }} />
    <style>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  </div>
)

function HomePage() {

  // 响应式检测
  const [isMobile, setIsMobile] = useState(false)
  const [scrollRange, setScrollRange] = useState(600)

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth <= 768
      setIsMobile(mobile)
      setScrollRange(mobile ? window.innerHeight * 0.8 : 600)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 滚动动画 - 内容区域轻微向上移动（响应式）
  const { scrollY } = useScroll()
  const contentY = useTransform(scrollY, [0, scrollRange], [0, isMobile ? -30 : -50])
  
  useEffect(() => {
    document.body.classList.add('loaded')
    
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

    let ticking = false
    
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          revealOnScroll()
          ticking = false
        })
        ticking = true
      }
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
    
    window.addEventListener('scroll', onScroll, { passive: true })
    revealOnScroll()

    return () => {
      window.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="app">
      <Header />
      
      {/* 固定背景 - Banner */}
      <Banner />
      
      {/* Scrollable Content Container */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Spacer to push content below initial video view */}
        <div 
          style={{ 
            height: '100vh', 
            width: '100%', 
            pointerEvents: 'none'
          }} 
        />
        
        {/* Main Content Area */}
        <motion.main 
          className="main-content"
          style={{ 
            y: contentY,
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y'
          }}
        >
          <ClientLogos />
          <Suspense fallback={<LoadingPlaceholder />}>
            <ProductSection />
          </Suspense>
          <Suspense fallback={<LoadingPlaceholder />}>
            <IndustrySolutions />
          </Suspense>
          <Suspense fallback={<LoadingPlaceholder />}>
            <ClientWall />
          </Suspense>
          <Suspense fallback={<LoadingPlaceholder />}>
            <CTASection />
          </Suspense>
        </motion.main>
      </div>
      
      <Footer />
      <RightSidebar />
    </div>
  )
}

export default HomePage

