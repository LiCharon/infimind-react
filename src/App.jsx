import React, { useState, useEffect, createContext } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import HomePage from './pages/HomePage'
import AboutPage from './pages/AboutPage'
import ContractRewritePage from './pages/ContractRewritePage'
import ContractDraftPage from './pages/ContractDraftPage'
import LaborConsultPage from './pages/LaborConsultPage'
import LaborContractAnalysisPage from './pages/LaborContractAnalysisPage'
import LaborArbitrationPage from './pages/LaborArbitrationPage'
import ToolHubPage from './pages/ToolHubPage'
import AuthPage from './pages/AuthPage'
import ToolConversationPage from './pages/ToolConversationPage'
import MedicalCalculatorPage from './pages/MedicalCalculatorPage'
import PensionCalculationPage from './pages/PensionCalculationPage'
import CitationVerificationComparePage from './pages/CitationVerificationComparePage'
import QRCodeModal from './components/QRCodeModal'
import { AuthProvider, useAuth } from './components/AuthProvider'

export const QRCodeContext = createContext()

function ProtectedPage({ children }) {
  const location = useLocation()
  const { user, status } = useAuth()
  if (status === 'loading') return <div className="auth-loading">正在验证登录状态…</div>
  if (user) return React.cloneElement(children, { key: user.id })
  const redirect = `${location.pathname}${location.search}`
  return <Navigate to={`/auth?mode=login&redirect=${encodeURIComponent(redirect)}`} replace />
}

function App() {
  const [isQRModalOpen, setIsQRModalOpen] = useState(false)

  // 确保任何路由页面挂载后 body 都可见。
  // index.css 中 body 默认 opacity:0，仅当存在 .loaded 时为 opacity:1。
  // 原先只有 HomePage 会添加该 class，导致直接访问 /contract-rewrite
  // 或 /aboutus（含整页刷新、无痕窗口）时 body 始终透明 → 白屏但 DOM 完整。
  // 在根组件统一添加，避免每个页面各自处理。
  useEffect(() => {
    document.body.classList.add('loaded')
  }, [])

  const openQRModal = () => {
    setIsQRModalOpen(true)
  }

  const closeQRModal = () => {
    setIsQRModalOpen(false)
  }

  return (
    <AuthProvider>
      <QRCodeContext.Provider value={{ openQRModal }}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/aboutus" element={<AboutPage />} />
            <Route path="/contract-rewrite" element={<ProtectedPage><ContractRewritePage /></ProtectedPage>} />
            <Route path="/contract-draft" element={<ProtectedPage><ContractDraftPage /></ProtectedPage>} />
            <Route path="/labor-consult" element={<ProtectedPage><LaborConsultPage /></ProtectedPage>} />
            <Route path="/tools" element={<ProtectedPage><ToolHubPage /></ProtectedPage>} />
            <Route path="/tools/contract-review" element={<ProtectedPage><ContractRewritePage /></ProtectedPage>} />
            <Route path="/tools/contract-draft" element={<ProtectedPage><ContractDraftPage /></ProtectedPage>} />
            <Route path="/tools/labor-consult" element={<ProtectedPage><LaborConsultPage /></ProtectedPage>} />
            <Route path="/tools/labor-contract" element={<ProtectedPage><LaborContractAnalysisPage /></ProtectedPage>} />
            <Route path="/tools/arbitration" element={<ProtectedPage><LaborArbitrationPage /></ProtectedPage>} />
            <Route path="/tools/medical-calculator" element={<ProtectedPage><MedicalCalculatorPage /></ProtectedPage>} />
            <Route path="/tools/pension-calc1" element={<ProtectedPage><PensionCalculationPage toolId="pension-calc1" /></ProtectedPage>} />
            <Route path="/tools/pension-calc2" element={<ProtectedPage><PensionCalculationPage toolId="pension-calc2" /></ProtectedPage>} />
            <Route path="/tools/:toolId" element={<ProtectedPage><ToolConversationPage /></ProtectedPage>} />
            <Route path="/auth" element={<AuthPage />} />
            {import.meta.env.DEV && <Route path="/__demo/citation-verification" element={<CitationVerificationComparePage />} />}
          </Routes>
          <QRCodeModal isOpen={isQRModalOpen} onClose={closeQRModal} />
        </BrowserRouter>
      </QRCodeContext.Provider>
    </AuthProvider>
  )
}

export default App
