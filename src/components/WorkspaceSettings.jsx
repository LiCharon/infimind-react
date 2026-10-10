import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Monitor, Moon, Settings2, Sun, X } from 'lucide-react'
import gsap from 'gsap'
import { useWorkspaceLayout } from './WorkspaceContext'
import { DEFAULT_SHORTCUTS } from '../hooks/useWorkspaceSettings'
import 'weui/dist/style/weui.css'
import './WorkspaceSettings.css'

export default function WorkspaceSettings({ onClose }) {
  const { settings, updateSettings, t } = useWorkspaceLayout()
  const dialogRef = useRef(null)
  const [editingKeys, setEditingKeys] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [fontDraft, setFontDraft] = useState(String(settings.fontSize))
  useEffect(() => setFontDraft(String(settings.fontSize)), [settings.fontSize])
  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement
    dialog.showModal()
    const tween = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : gsap.fromTo(dialog, { opacity: 0, y: 8, scale: .99 }, { opacity: 1, y: 0, scale: 1, duration: .16, ease: 'power2.out' })
    return () => { tween?.kill(); dialog.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  const select = (key, options) => <select id={`settings-${key}`} value={settings[key]} onChange={(event) => updateSettings({ [key]: event.target.value })}>{options.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select>
  const row = (key, title, description, control) => <div className="workspace-setting-row"><label htmlFor={`settings-${key}`}><strong>{t(title)}</strong>{description && <small>{t(description)}</small>}</label>{control}</div>
  const changeShortcut = (action, key) => {
    const duplicate = Object.entries(settings.shortcuts).find(([other, value]) => other !== action && value === key && key !== 'disabled')
    if (duplicate) { setAnnouncement(t('此组合已被其他操作使用，请选择另一组。')); return }
    updateSettings({ shortcuts: { ...settings.shortcuts, [action]: key } })
    setAnnouncement(t('快捷键已保存'))
  }
  return <dialog ref={dialogRef} className="workspace-settings" aria-labelledby="workspace-settings-title" onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
    if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() }
  }}>
    <header className="workspace-settings-heading">{editingKeys ? <button type="button" aria-label={t('返回设置')} onClick={() => setEditingKeys(false)}><ChevronLeft size={20} /></button> : <Settings2 size={21} aria-hidden="true" />}<h2 id="workspace-settings-title">{t(editingKeys ? '快捷键' : '设置')}</h2><button type="button" aria-label={t('关闭设置')} onClick={onClose} autoFocus><X size={20} /></button></header>
    <div className="workspace-settings-body">
      {editingKeys ? <>
        <p className="workspace-settings-intro">{t('Mac 使用 ⌘，Windows 使用 Ctrl。编辑框中保留原生编辑快捷键。')}</p>
        {row('sendKey', '发送消息', 'Shift + Enter 始终换行', select('sendKey', [['enter', 'Enter 发送'], ['command-enter', '⌘ / Ctrl + Enter 发送']]))}
        {Object.entries({ search: '搜索历史会话', newChat: '新建会话', history: '展开 / 收起历史', settings: '打开设置' }).map(([action, label]) => row(`shortcut-${action}`, label, '', <select id={`settings-shortcut-${action}`} key={action} value={settings.shortcuts[action]} onChange={(event) => changeShortcut(action, event.target.value)}>{['k', 'n', 'b', ',', 'j', 'h', 's', 'disabled'].map((key) => <option key={key} value={key}>{key === 'disabled' ? t('停用') : `⌘ / Ctrl + ${key.toUpperCase()}`}</option>)}</select>))}
        <button type="button" className="workspace-settings-secondary" onClick={() => { updateSettings({ shortcuts: DEFAULT_SHORTCUTS, sendKey: 'enter' }); setAnnouncement(t('默认快捷键已恢复')) }}>{t('恢复默认快捷键')}</button>
        <p className="workspace-settings-feedback" role="status">{announcement}</p>
      </> : <>
        {row('language', '语言', '', select('language', [['zh-CN', '简体中文'], ['en', 'English']]))}
        <fieldset className="workspace-setting-appearance"><legend>{t('外观')}</legend><div>{[['light', '浅色', Sun], ['dark', '深色', Moon], ['system', '跟随系统', Monitor]].map(([value, label, Icon]) => <label key={value} className={settings.appearance === value ? 'selected' : ''}><input type="radio" name="workspace-appearance" value={value} checked={settings.appearance === value} onChange={() => updateSettings({ appearance: value })} /><Icon size={23} strokeWidth={1.6} aria-hidden="true" /><span>{t(label)}</span></label>)}</div></fieldset>
        {row('fontSize', '字号大小', '仅影响会话内容的字号', <span className="workspace-settings-size"><input id="settings-fontSize" type="number" min="12" max="24" step="1" value={fontDraft} onChange={(event) => { setFontDraft(event.target.value); const value = Number(event.target.value); if (value >= 12 && value <= 24) updateSettings({ fontSize: value }) }} onBlur={() => { const value = Math.max(12, Math.min(24, Number(fontDraft) || 16)); updateSettings({ fontSize: value }); setFontDraft(String(value)) }} /><span>px</span></span>)}
        {row('steps', '工作步骤展示', '选择希望看到多少分析过程细节', select('steps', [['compact', '精简'], ['standard', '标准'], ['detailed', '详细']]))}
        {row('analysisPanel', '显示分析与证据面板', '展示材料依据、分析报告与文档预览；不影响生成结果', <input id="settings-analysisPanel" type="checkbox" className="weui-switch" checked={settings.analysisPanel} onChange={(event) => updateSettings({ analysisPanel: event.target.checked })} />)}
        {row('shortcuts', '快捷键', '查看和编辑快捷键与发送操作', <button id="settings-shortcuts" aria-label={t('编辑快捷键')} type="button" className="workspace-settings-secondary" onClick={() => setEditingKeys(true)}>{t('编辑快捷键')}</button>)}
        {row('links', '网页链接默认打开方式', '选择会话中网页链接的打开位置', select('links', [['new-tab', '新标签页'], ['current-tab', '当前标签页']]))}
        {row('busySend', '繁忙时的发送行为', '插话会停止当前生成，排队会等待当前生成结束', select('busySend', [['interrupt', '插话发送'], ['queue', '排队发送']]))}
        <p className="workspace-settings-footnote">{t('偏好自动保存在当前浏览器，并按账户区分。')}</p>
      </>}
    </div>
  </dialog>
}
