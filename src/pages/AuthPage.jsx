import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { useAuth } from '../components/AuthProvider'
import 'weui/dist/style/widget/weui-button/weui-button.css'
import 'weui/dist/style/widget/weui-cell/weui-cell.css'
import 'weui/dist/style/widget/weui-cell/weui-cell-form.css'
import 'weui/dist/style/widget/weui-page/weui-form.css'
import 'weui/dist/style/widget/weui-loading/weui-loading.css'
import './AuthPage.css'

gsap.registerPlugin(useGSAP)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function FormField({ id, label, icon: Icon, error, trailing, children }) {
  return (
    <div className={`login-field ${error ? 'login-field--error' : ''}`}>
      <label className="login-field-label" htmlFor={id}>{label}</label>
      <div className="weui-cells login-cells">
        <div className="weui-cell login-cell">
          <div className="login-field-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></div>
          <div className="weui-cell__bd">{children}</div>
          {trailing && <div className="weui-cell__ft">{trailing}</div>}
        </div>
      </div>
      {error && <p className="login-field-error" id={`${id}-error`}>{error}</p>}
    </div>
  )
}

function AuthPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { login, register, authError } = useAuth()
  const queryMode = params.get('mode') === 'register' ? 'register' : 'login'
  const pageRef = useRef(null)
  const formRef = useRef(null)
  const previousModeRef = useRef(queryMode)
  const [mode, setMode] = useState(queryMode)
  const [showPassword, setShowPassword] = useState(false)
  const [values, setValues] = useState({ identifier: '', username: '', inviteCode: '', email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [requestError, setRequestError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const redirect = useMemo(() => {
    const value = params.get('redirect') || '/labor-consult'
    return value.startsWith('/') && !value.startsWith('//') ? value : '/labor-consult'
  }, [params])

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const { contextSafe } = useGSAP(() => {
    if (reduceMotion()) return
    const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
    timeline
      .from('.login-hero-logo', { autoAlpha: 0, y: 12, duration: 0.32 }, 0)
      .from('.login-hero-copy > *', { autoAlpha: 0, y: 18, duration: 0.4, stagger: 0.04 }, 0.06)
      .from('.login-form-head > *', { autoAlpha: 0, y: 12, duration: 0.3, stagger: 0.04 }, 0.08)
      .from('.login-field, .login-submit, .login-switch', { autoAlpha: 0, y: 12, duration: 0.3, stagger: 0.035 }, 0.12)
  }, { scope: pageRef })

  useEffect(() => {
    setMode(queryMode)
  }, [queryMode])

  useEffect(() => {
    if (previousModeRef.current === mode) return
    previousModeRef.current = mode
    if (reduceMotion() || !formRef.current) return
    gsap.fromTo(formRef.current, { autoAlpha: 0.65, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out' })
  }, [mode])

  const animateField = contextSafe((event, focused) => {
    if (reduceMotion()) return
    const cell = event.currentTarget.closest('.login-cell')
    if (!cell) return
    gsap.to(cell, {
      y: focused ? -1 : 0,
      duration: 0.16,
      ease: 'power2.out'
    })
  })

  const animateButton = contextSafe((event, hovered) => {
    if (reduceMotion() || submitting) return
    gsap.to(event.currentTarget, { y: hovered ? -1 : 0, scale: hovered ? 1.005 : 1, duration: 0.16, ease: 'power2.out' })
  })

  const updateValue = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: '' }))
    setRequestError('')
  }

  const switchMode = () => {
    const nextMode = mode === 'login' ? 'register' : 'login'
    setMode(nextMode)
    setErrors({})
    setRequestError('')
    setNotice('')
    const copy = new URLSearchParams(params)
    copy.set('mode', nextMode)
    setParams(copy)
  }

  const validate = () => {
    const next = {}
    if (mode === 'register') {
      if (!values.inviteCode.trim()) next.inviteCode = '请输入邀请码'
      if (!values.username.trim()) next.username = '请输入用户名'
      else if (values.username.trim().length < 2 || values.username.trim().length > 32) next.username = '用户名需为 2–32 个字符'
      if (!EMAIL_PATTERN.test(values.email.trim())) next.email = '请输入有效的邮箱地址'
    } else if (!values.identifier.trim()) {
      next.identifier = '请输入用户名或邮箱'
    }
    if (!values.password) next.password = '请输入密码'
    else if (values.password.length < 8 || values.password.length > 128) next.password = '密码需为 8–128 位'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    if (!validate()) {
      if (!reduceMotion() && formRef.current) {
        gsap.fromTo(formRef.current, { x: -5 }, { x: 0, duration: 0.28, ease: 'elastic.out(1, 0.35)' })
      }
      return
    }

    setSubmitting(true)
    setRequestError('')
    setNotice('')
    try {
      if (mode === 'login') {
        await login({ identifier: values.identifier.trim(), password: values.password })
        navigate(redirect, { replace: true })
      } else {
        await register({
          inviteCode: values.inviteCode.trim(),
          username: values.username.trim(),
          email: values.email.trim(),
          password: values.password
        })
        setValues((current) => ({ ...current, password: '', inviteCode: '' }))
        setNotice('注册成功，请使用用户名或邮箱登录。')
        setMode('login')
        const copy = new URLSearchParams(params)
        copy.set('mode', 'login')
        setParams(copy)
      }
    } catch (error) {
      setRequestError(error.message || (mode === 'login' ? '登录失败，请稍后重试' : '注册失败，请检查填写内容'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={`login-page login-page--${mode}`} ref={pageRef}>
      <section className="login-hero" aria-label="法飞飞 AI 品牌介绍">
        <div className="login-hero-inner">
          <Link className="login-hero-logo" to="/" aria-label="法飞飞 AI，返回首页">
            <img src="/法飞飞标题.webp" alt="法飞飞AI" />
          </Link>
          <div className="login-hero-copy">
            <h1>让专业判断，<br /><em>先行一步</em></h1>
            <span className="login-hero-rule" aria-hidden="true" />
            <p>用 AI 连接法律与人力资源经验，<br />帮助企业识别风险、把握合规、做出更稳健的决策。</p>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-label={mode === 'login' ? '登录' : '邀请码注册'}>
        <div className="login-panel-inner" ref={formRef}>
          <div className="login-form-head">
            <h2>{mode === 'login' ? '欢迎回来' : '创建账号'}</h2>
            <p>{mode === 'login' ? '登录法飞飞AI，开启更安全的用工与合规管理' : '使用邀请码，开启专业工作空间'}</p>
          </div>

          {notice && <div className="login-success" role="status">{notice}</div>}
          <form className="weui-form login-form" onSubmit={handleSubmit} noValidate>
            <div className="weui-form__bd">
              {mode === 'register' && (
                <>
                  <FormField id="login-invite" label="邀请码" icon={KeyRound} error={errors.inviteCode}>
                    <input className="weui-input" id="login-invite" type="text" required autoComplete="off" placeholder="请输入邀请码" value={values.inviteCode} onChange={(event) => updateValue('inviteCode', event.target.value)} onFocus={(event) => animateField(event, true)} onBlur={(event) => animateField(event, false)} aria-invalid={Boolean(errors.inviteCode)} aria-describedby={errors.inviteCode ? 'login-invite-error' : undefined} />
                  </FormField>
                  <FormField id="login-username" label="用户名" icon={UserRound} error={errors.username}>
                    <input className="weui-input" id="login-username" type="text" required minLength={2} maxLength={32} autoComplete="username" placeholder="请输入用户名" value={values.username} onChange={(event) => updateValue('username', event.target.value)} onFocus={(event) => animateField(event, true)} onBlur={(event) => animateField(event, false)} aria-invalid={Boolean(errors.username)} aria-describedby={errors.username ? 'login-username-error' : undefined} />
                  </FormField>
                  <FormField id="login-email" label="邮箱" icon={Mail} error={errors.email}>
                    <input className="weui-input" id="login-email" type="email" required inputMode="email" autoComplete="email" placeholder="请输入邮箱" value={values.email} onChange={(event) => updateValue('email', event.target.value)} onFocus={(event) => animateField(event, true)} onBlur={(event) => animateField(event, false)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'login-email-error' : undefined} />
                  </FormField>
                </>
              )}
              {mode === 'login' && (
                <FormField id="login-identifier" label="用户名或邮箱" icon={UserRound} error={errors.identifier}>
                  <input className="weui-input" id="login-identifier" type="text" required autoComplete="username" placeholder="请输入用户名或邮箱" value={values.identifier} onChange={(event) => updateValue('identifier', event.target.value)} onFocus={(event) => animateField(event, true)} onBlur={(event) => animateField(event, false)} aria-invalid={Boolean(errors.identifier)} aria-describedby={errors.identifier ? 'login-identifier-error' : undefined} />
                </FormField>
              )}
              <FormField id="login-password" label="密码" icon={LockKeyhole} error={errors.password} trailing={
                <button className="login-password-toggle" type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              }>
                <input className="weui-input" id="login-password" type={showPassword ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? '请输入密码' : '至少 8 位'} value={values.password} onChange={(event) => updateValue('password', event.target.value)} onFocus={(event) => animateField(event, true)} onBlur={(event) => animateField(event, false)} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'login-password-error' : undefined} />
              </FormField>
            </div>

            {(requestError || authError) && <div className="login-request-error" role="alert">{requestError || authError}</div>}
            <button className={`weui-btn weui-btn_primary login-submit ${submitting ? 'weui-btn_loading' : ''}`} type="submit" disabled={submitting} onMouseEnter={(event) => animateButton(event, true)} onMouseLeave={(event) => animateButton(event, false)}>
              {submitting ? <><span className="weui-loading" aria-hidden="true" /> 正在提交…</> : <>{mode === 'login' ? '登录' : '完成注册'} <ArrowRight size={20} strokeWidth={2} aria-hidden="true" /></>}
            </button>
          </form>

          <div className="login-switch">
            <span className="login-switch-line" aria-hidden="true" />
            <button type="button" onClick={switchMode}>{mode === 'login' ? '邀请码注册' : '已有账号？返回登录'} <ArrowRight size={16} aria-hidden="true" /></button>
            <span className="login-switch-line" aria-hidden="true" />
          </div>
          {mode === 'register' && <div className="login-invite-note"><CheckCircle2 size={17} aria-hidden="true" /><span>邀请码由法飞飞团队审核后发放，每个邀请码只能注册一个账户。</span></div>}
          <div className="login-options"><a href="https://jsj.top/f/NctQWw" target="_blank" rel="noopener noreferrer">没有邀请码？申请体验</a></div>
        </div>
        <p className="login-account-note">账号数据由服务端安全保存，退出登录后需要重新登录。</p>
      </section>
    </main>
  )
}

export default AuthPage
