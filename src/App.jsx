import React, { useState, createContext } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import AboutPage from './pages/AboutPage'
import ContractRewritePage from './pages/ContractRewritePage'
import QRCodeModal from './components/QRCodeModal'

export const QRCodeContext = createContext()

function App() {
  const [isQRModalOpen, setIsQRModalOpen] = useState(false)

  const openQRModal = () => {
    setIsQRModalOpen(true)
  }

  const closeQRModal = () => {
    setIsQRModalOpen(false)
  }

  return (
    <QRCodeContext.Provider value={{ openQRModal }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/aboutus" element={<AboutPage />} />
          <Route path="/contract-rewrite" element={<ContractRewritePage />} />
        </Routes>
        <QRCodeModal isOpen={isQRModalOpen} onClose={closeQRModal} />
      </BrowserRouter>
    </QRCodeContext.Provider>
  )
}

export default App

