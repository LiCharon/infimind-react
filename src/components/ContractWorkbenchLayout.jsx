import React from 'react'

/**
 * Shared shell for contract workbench tools. Product-specific navigation,
 * conversation content, composer actions and optional document panes are slots.
 */
export default function ContractWorkbenchLayout({
  className = '',
  sidebarClassName = '',
  sidebar,
  sidebarCollapsed = false,
  hideSidebar = false,
  headerLeft,
  title,
  subtitle,
  headerTools,
  conversationRef,
  children,
  composer,
  documentPane
}) {
  const classes = ['contract-chat', className, sidebarCollapsed && 'sidebar-collapsed'].filter(Boolean).join(' ')

  return (
    <main className={classes}>
      {!hideSidebar && <aside className={['chat-sidebar', sidebarClassName].filter(Boolean).join(' ')}>{sidebar}</aside>}
      <section className="chat-column">
        <header className="chat-header">
          <div className="header-left">{headerLeft}</div>
          <div className="chat-title"><strong>{title}</strong><small>{subtitle}</small></div>
          <div className="header-tools">{headerTools}</div>
        </header>
        <div className="conversation" ref={conversationRef}>{children}</div>
        {composer}
      </section>
      {documentPane}
    </main>
  )
}
