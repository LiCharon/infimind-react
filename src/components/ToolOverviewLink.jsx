import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import './ToolOverviewLink.css'

export default function ToolOverviewLink() {
  return <Link className="tool-overview-link" to="/tools" aria-label="工具总览" title="工具总览"><ArrowLeft size={20} /></Link>
}
