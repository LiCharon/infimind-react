import { Clock3, X } from 'lucide-react'
export default function QueuedMessages({ composer }) {
  if (!composer.queued.length) return null
  return <section className="workspace-send-queue" aria-label={composer.t('排队中的消息')}>
    {composer.queued.map(({ id, snapshot }) => <div key={id}><Clock3 size={13} aria-hidden="true" /><span title={snapshot.text || snapshot.files.map((file) => file.name).join(', ')}>{snapshot.text || snapshot.files.map((file) => file.name).join(', ')}</span><button type="button" aria-label={composer.t('取消排队')} onClick={() => composer.remove(id)}><X size={14} /></button></div>)}
    <small>{composer.t('当前生成结束后自动发送')}</small>
  </section>
}
