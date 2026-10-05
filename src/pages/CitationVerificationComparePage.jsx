import React, { useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CircleHelp,
  FileSearch,
  Info,
  Scale,
  ShieldCheck
} from 'lucide-react'
import './CitationVerificationComparePage.css'

const scenarios = [
  {
    id: 'article-unchecked',
    tab: '法规收录，条号未核验',
    question: '员工被安排跨市调岗，公司需要提前通知吗？',
    citation: '《中华人民共和国劳动合同法》第9999条',
    lawStatus: '法规名称已匹配，基准状态为现行有效',
    current: {
      label: '已核实',
      tone: 'success',
      note: '当前通过条件主要落在法规名称、版本和效力状态匹配；没有核对这个条号是否真实存在。'
    },
    proposed: {
      law: { label: '已核实', tone: 'success', detail: '法规已收录 · 现行有效' },
      article: { label: '未核验', tone: 'pending', detail: '当前没有条号级核验依据' },
      summary: '法规状态：1/1 已核实　·　条号：0/1 已核实，1/1 未核验'
    },
    caveat: '第9999条是演示用虚构条号。当前真实校验不会据此确认条文存在或支持回答。'
  },
  {
    id: 'law-unlisted',
    tab: '法规未收录',
    question: '示例：某地工资支付规定是否适用于这类情形？',
    citation: '《示例地方工资规定》第21条',
    lawStatus: '该示例法规名称不在当前基准库中',
    current: {
      label: '未收录，需人工核实',
      tone: 'warning',
      note: '未匹配到法规基准项，因此目前无法确认法规的版本或效力状态。'
    },
    proposed: {
      law: { label: '无法核实', tone: 'warning', detail: '法规名称未在基准库中匹配' },
      article: { label: '无法校验', tone: 'muted', detail: '法规未确认，条号状态未知' },
      summary: '法规状态：0/1 已核实，1/1 待人工核实　·　条号：无法判断'
    },
    caveat: '“未收录”不等于法规不存在；这个示例名称也是虚构的。'
  }
]

function StatusPill({ tone, children, icon: Icon }) {
  return (
    <span className={`citation-demo-status citation-demo-status--${tone}`}>
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
      {children}
    </span>
  )
}

function CurrentCard({ scenario }) {
  const isPassed = scenario.current.tone === 'success'
  return (
    <article className="citation-demo-card citation-demo-card--current">
      <header className="citation-demo-card-head">
        <div className="citation-demo-step">01</div>
        <div>
          <p className="citation-demo-kicker">CURRENT DISPLAY</p>
          <h2>当前校验展示</h2>
        </div>
        <span className="citation-demo-current-tag">现状</span>
      </header>

      <div className="citation-demo-current-summary">
        <div className={`citation-demo-big-icon ${isPassed ? 'is-success' : 'is-warning'}`}>
          {isPassed ? <ShieldCheck size={23} /> : <AlertTriangle size={23} />}
        </div>
        <div>
          <strong>{isPassed ? '1/1 处通过' : '0/1 处通过'}</strong>
          <span>法规引用核实</span>
        </div>
      </div>

      <div className={`citation-demo-reference citation-demo-reference--${scenario.current.tone}`}>
        <div className="citation-demo-reference-icon"><Scale size={16} /></div>
        <div className="citation-demo-reference-copy">
          <strong>{scenario.citation}</strong>
          <StatusPill
            tone={scenario.current.tone}
            icon={isPassed ? BadgeCheck : AlertTriangle}
          >
            {scenario.current.label}
          </StatusPill>
        </div>
      </div>

      <p className="citation-demo-explainer">{scenario.current.note}</p>
      <div className="citation-demo-card-foot">
        <Info size={15} />
        <span>{scenario.lawStatus}</span>
      </div>
    </article>
  )
}

function ProposedCard({ scenario }) {
  return (
    <article className="citation-demo-card citation-demo-card--proposed">
      <header className="citation-demo-card-head">
        <div className="citation-demo-step">02</div>
        <div>
          <p className="citation-demo-kicker">PROPOSED DISPLAY</p>
          <h2>区分法规与条号</h2>
        </div>
        <span className="citation-demo-proposed-tag">模拟建议</span>
      </header>

      <div className="citation-demo-proposal-ref">
        <FileSearch size={16} />
        <strong>{scenario.citation}</strong>
      </div>

      <div className="citation-demo-checks">
        <div className="citation-demo-check-row">
          <div className="citation-demo-check-icon"><BookOpenCheck size={17} /></div>
          <div className="citation-demo-check-copy">
            <span>法规收录与效力</span>
            <small>{scenario.proposed.law.detail}</small>
          </div>
          <StatusPill tone={scenario.proposed.law.tone} icon={scenario.proposed.law.tone === 'success' ? BadgeCheck : AlertTriangle}>
            {scenario.proposed.law.label}
          </StatusPill>
        </div>
        <div className="citation-demo-check-row">
          <div className="citation-demo-check-icon citation-demo-check-icon--article"><CircleHelp size={17} /></div>
          <div className="citation-demo-check-copy">
            <span>条号是否存在 / 条文是否支持</span>
            <small>{scenario.proposed.article.detail}</small>
          </div>
          <StatusPill tone={scenario.proposed.article.tone} icon={CircleHelp}>
            {scenario.proposed.article.label}
          </StatusPill>
        </div>
      </div>

      <div className="citation-demo-proposed-summary">
        <span>建议统计口径</span>
        <strong>{scenario.proposed.summary}</strong>
      </div>
      <p className="citation-demo-card-foot citation-demo-card-foot--proposed">
        <Info size={15} />
        <span>{scenario.caveat}</span>
      </p>
    </article>
  )
}

export default function CitationVerificationComparePage() {
  const [activeScenarioId, setActiveScenarioId] = useState(scenarios[0].id)
  const scenario = scenarios.find((item) => item.id === activeScenarioId) || scenarios[0]

  return (
    <main className="citation-demo-page">
      <div className="citation-demo-shell">
        <header className="citation-demo-topbar">
          <div className="citation-demo-brand-mark"><Scale size={18} /></div>
          <span>法飞飞 AI</span>
          <span className="citation-demo-topbar-divider">/</span>
          <span className="citation-demo-topbar-muted">用工咨询 · 引用展示模拟</span>
          <span className="citation-demo-local-badge"><span /> 本地模拟，不连接后台</span>
        </header>

        <section className="citation-demo-intro">
          <p className="citation-demo-eyebrow">CITATION STATUS · UI CONCEPT</p>
          <h1>“引用通过”到底确认了什么？</h1>
          <p>切换示例，直观看当前展示与“法规状态 / 条号状态分开显示”的差别。</p>
        </section>

        <section className="citation-demo-scenario" aria-label="选择演示案例">
          <div className="citation-demo-scenario-label">
            <span>演示案例</span>
            <small>共 2 个边界情形</small>
          </div>
          <div className="citation-demo-tabs" role="tablist" aria-label="引用校验案例">
            {scenarios.map((item, index) => (
              <button
                aria-selected={item.id === activeScenarioId}
                className={item.id === activeScenarioId ? 'active' : ''}
                key={item.id}
                onClick={() => setActiveScenarioId(item.id)}
                role="tab"
                type="button"
              >
                <span className="citation-demo-tab-index">0{index + 1}</span>
                {item.tab}
              </button>
            ))}
          </div>
          <div className="citation-demo-question">
            <span>模拟用户问题</span>
            <p>{scenario.question}</p>
          </div>
        </section>

        <section className="citation-demo-comparison" aria-label="当前和建议展示对比">
          <CurrentCard scenario={scenario} />
          <div className="citation-demo-connector" aria-hidden="true"><ArrowRight size={18} /></div>
          <ProposedCard scenario={scenario} />
        </section>

        <section className="citation-demo-impact" aria-labelledby="citation-demo-impact-title">
          <div className="citation-demo-impact-heading">
            <span className="citation-demo-impact-icon"><Info size={17} /></span>
            <div>
              <h2 id="citation-demo-impact-title">如果采用建议，产品会变什么？</h2>
              <p>状态更准确，回答本身不因此自动变化。</p>
            </div>
          </div>
          <div className="citation-demo-impact-items">
            <div><span className="impact-dot impact-dot--quiet" /><strong>会改变</strong><p>引用卡片标签、颜色和汇总数字</p></div>
            <div><span className="impact-dot impact-dot--blue" /><strong>不直接改变</strong><p>模型回答正文、引用原文和证据顺序</p></div>
            <div><span className="impact-dot impact-dot--amber" /><strong>还不能承诺</strong><p>条号真实存在、条文内容支持结论</p></div>
          </div>
        </section>

        <footer className="citation-demo-footer">
          <Info size={14} />
          这是前端交互草图，只展示口径差异；没有修改真实校验逻辑，也不是法律判断结果。
        </footer>
      </div>
    </main>
  )
}
