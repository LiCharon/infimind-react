import { useWorkspaceText } from './WorkspaceContext'
import { Feather } from 'lucide-react'

export default function SideChatEmptyState() {
  const t = useWorkspaceText()
  return (
    <div className="workspace-side-chat-empty">
      <Feather className="workspace-side-chat-mark" size={34} strokeWidth={1.4} aria-hidden="true" />
      <h1>{t("法飞飞，陪你梳理")}</h1>
      <p>{t("从一个新问题开始。")}</p>
      <small>{t("临时会话，不存入历史")}<br />{t("关闭应用或刷新页面后清空")}</small>
    </div>
  )
}
