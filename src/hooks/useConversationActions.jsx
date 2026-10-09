import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArrowLeft, Pin } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useWorkspaceLayout } from '../components/WorkspaceContext'

export const conversationId = (item) => item?.threadId || item?.id || ''

export function useConversationActions({ items, active, toolKey, query = '', onNew, onSelect, onManage }) {
  const { conversationMeta, updateConversationMeta, setConversationActions, openConversationMenu, isSideChat, t } = useWorkspaceLayout()
  const { pathname } = useLocation()
  const [showArchived, setShowArchived] = useState(false)
  const handlers = useRef(null)
  const id = conversationId(active)
  const metaKey = (item) => `${toolKey}:${conversationId(item)}`
  const getMeta = (item) => conversationMeta[metaKey(item)] || {}
  const titleOf = (item) => getMeta(item).title || (['新对话', '新咨询', '新的用工咨询', '新起草任务', '新案件', '新审查任务'].includes(item?.title) ? t(item.title) : item?.title) || t('新对话')
  const activeMeta = getMeta(active)
  const title = titleOf(active)
  const pinned = Boolean(activeMeta.pinned)
  const archived = Boolean(activeMeta.archived)
  const archivedCount = items.filter((item) => getMeta(item).archived).length
  const visibleItems = items.filter((item) => Boolean(getMeta(item).archived) === showArchived && titleOf(item).toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(Boolean(getMeta(b).pinned)) - Number(Boolean(getMeta(a).pinned)) || Number(b.updatedAt || new Date(b.createdAt).getTime() || 0) - Number(a.updatedAt || new Date(a.createdAt).getTime() || 0))

  useLayoutEffect(() => {
    handlers.current = {
      createNew: () => onNew(),
      rename(targetId, nextTitle) {
        const target = items.find((item) => conversationId(item) === targetId)
        if (!target) return
        updateConversationMeta(metaKey(target), { title: nextTitle })
        onManage?.(targetId)
      },
      togglePin(targetId) {
        const target = items.find((item) => conversationId(item) === targetId)
        if (!target) return
        updateConversationMeta(metaKey(target), { pinned: !getMeta(target).pinned })
        onManage?.(targetId)
      },
      toggleArchive(targetId) {
        const target = items.find((item) => conversationId(item) === targetId)
        if (!target) return
        const wasArchived = Boolean(getMeta(target).archived)
        updateConversationMeta(metaKey(target), { archived: !wasArchived })
        onManage?.(targetId)
        // Managing a different history row must not change the open chat or draft.
        if (targetId !== id) return
        setShowArchived(false)
        if (!wasArchived) {
          const next = items.find((item) => conversationId(item) !== targetId && !getMeta(item).archived)
          if (next) onSelect(next)
          else onNew()
        }
      }
    }
  })

  const actions = useMemo(() => ({
    id, title, pinned, archived,
    createNew: () => handlers.current.createNew(),
    rename: (value) => handlers.current.rename(id, value),
    togglePin: () => handlers.current.togglePin(id),
    toggleArchive: () => handlers.current.toggleArchive(id)
  }), [id, title, pinned, archived])

  useEffect(() => {
    setConversationActions(actions)
  }, [actions, setConversationActions])
  useEffect(() => () => setConversationActions(null), [setConversationActions])

  // A refresh must not reopen a conversation that was moved to the archive.
  useEffect(() => {
    if (archived && !showArchived) {
      const next = items.find((item) => conversationId(item) !== id && !getMeta(item).archived)
      if (next) onSelect(next)
      else onNew()
    }
    // Actions run through the latest handlers; avoid restarting while tokens stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, archived, showArchived])

  const historyControls = !isSideChat && (archivedCount > 0 || showArchived) ? (
    <div className="workspace-history-controls">
      <button type="button" onClick={() => setShowArchived((value) => !value)}>
        {showArchived ? <ArrowLeft size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
        {showArchived ? t('返回历史会话') : `${t('已归档')} (${archivedCount})`}
      </button>
      {showArchived && !visibleItems.length && <small>{t('暂无已归档会话')}</small>}
    </div>
  ) : null
  const renderTitle = (item) => <>{getMeta(item).pinned && <Pin className="workspace-history-pin" size={12} aria-label={t('已置顶')} />}{titleOf(item)}</>
  const getHistoryMenuProps = (item) => {
    const openMenu = (event, keyboard = false) => {
      event.preventDefault()
      event.stopPropagation()
      const trigger = event.currentTarget
      const rect = trigger.getBoundingClientRect()
      const targetId = conversationId(item)
      const meta = getMeta(item)
      openConversationMenu({
        path: pathname, trigger,
        x: keyboard ? rect.left + 16 : event.clientX,
        y: keyboard ? rect.bottom : event.clientY,
        actions: {
          id: targetId, title: titleOf(item), pinned: Boolean(meta.pinned), archived: Boolean(meta.archived),
          rename: (value) => handlers.current?.rename(targetId, value),
          togglePin: () => handlers.current?.togglePin(targetId),
          toggleArchive: () => handlers.current?.toggleArchive(targetId)
        }
      })
    }
    return {
      'aria-haspopup': 'menu',
      onContextMenu: (event) => openMenu(event, event.clientX === 0 && event.clientY === 0),
      onKeyDown: (event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event, true)
      }
    }
  }
  return { visibleItems, titleOf, renderTitle, historyControls, showArchived, getHistoryMenuProps }
}
