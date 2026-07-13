import React from 'react'
import './RightSidebar.css'

const RightSidebar = () => {
  return (
    <div className="right-sidebar">
      <div className="sidebar-item">
        <div className="sidebar-avatar">👨‍💼</div>
        <div className="sidebar-label">用工咨询</div>
        <a href="tel:15910378671" className="sidebar-phone">159 1037 8671</a>
        <a href="https://jsj.top/f/NctQWw" target="_blank" rel="noopener noreferrer" className="sidebar-btn">免费咨询</a>
        <div className="sidebar-wx">💬 专家在线</div>
      </div>
    </div>
  )
}

export default RightSidebar

