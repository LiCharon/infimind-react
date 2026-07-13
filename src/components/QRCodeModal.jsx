import React from 'react'
import { X } from 'lucide-react'
import './QRCodeModal.css'

const QRCodeModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null

  return (
    <div className="qr-modal-overlay" onClick={onClose}>
      <div className="qr-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="qr-modal-close" onClick={onClose}>
          <X size={24} />
        </button>
        <div className="qr-modal-body">
          <h3 className="qr-modal-title">前往小程序使用</h3>
          <p className="qr-modal-desc">请使用微信扫描下方二维码</p>
          <div className="qr-code-container">
            <img 
              src="/小程序码.webp" 
              alt="法飞飞AI小程序码"
              className="qr-code-image"
              onError={(e) => {
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'flex'
              }}
            />
            <div className="qr-code-placeholder" style={{ display: 'none' }}>
              <p>小程序码</p>
              <p style={{ fontSize: '0.9rem', color: '#999', marginTop: '0.5rem' }}>
                请将小程序码图片放置在 public/小程序码.webp
              </p>
            </div>
          </div>
          <p className="qr-modal-tip">打开微信扫一扫，体验法飞飞AI用工风险专家</p>
        </div>
      </div>
    </div>
  )
}

export default QRCodeModal

