import React, { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { savePrototypeUser } from '../utils/prototype-auth'
import './AuthPage.css'

export default function AuthPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const initialMode = params.get('mode') === 'register' ? 'register' : 'login'
  const [mode, setMode] = useState(initialMode)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ account: '', password: '', inviteCode: '', name: '' })
  const redirect = useMemo(() => {
    const value = params.get('redirect') || '/tools'
    return value.startsWith('/') && !value.startsWith('//') ? value : '/tools'
  }, [params])

  const switchMode = (next) => {
    setMode(next)
    const copy = new URLSearchParams(params)
    copy.set('mode', next)
    setParams(copy)
  }

  const submit = (event) => {
    event.preventDefault()
    savePrototypeUser({ name: form.name.trim() || form.account.trim() || '体验用户', account: form.account.trim() })
    navigate(redirect)
  }

  return (
    <main className="auth-page">
      <section className="auth-story" role="img" aria-label="法飞飞 AI：让法律更简单，让企业更安心。专业可靠、高效便捷、值得信赖。" />

      <section className="auth-panel">
        <Link to="/" className="auth-back">返回官网 <ArrowRight size={17} /></Link>
        <div className="auth-form-wrap">
          <div className="auth-tabs" role="tablist">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} type="button">登录</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')} type="button">邀请码注册</button>
          </div>
          <div className="auth-heading">
            <h2>{mode === 'login' ? '欢迎回来' : '创建法飞飞账户'}</h2>
            <p>{mode === 'login' ? '登录后继续使用你的工具和历史任务。' : '使用团队提供的邀请码完成注册。'}</p>
          </div>
          <form onSubmit={submit}>
            {mode === 'register' && <label>邀请码<input required value={form.inviteCode} onChange={(e) => setForm({ ...form, inviteCode: e.target.value })} placeholder="请输入邀请码" /></label>}
            {mode === 'register' && <label>姓名<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="怎么称呼你" /></label>}
            <label>手机号或邮箱<div className="auth-icon-field"><UserRound size={22} aria-hidden="true" /><input required autoComplete="username" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="请输入手机号或邮箱" /></div></label>
            <label>密码<div className="password-field auth-icon-field"><LockKeyhole size={22} aria-hidden="true" /><input required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="至少 6 位" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
            <button className="auth-submit" type="submit">{mode === 'login' ? '登录并继续' : '注册并进入工作台'} <ArrowRight size={18} /></button>
          </form>
          {mode === 'register' && <div className="auth-invite-note"><CheckCircle2 size={17} /><span>邀请码由法飞飞团队审核后发放，每个邀请码有独立的使用范围。</span></div>}
          <div className="auth-options"><label className="auth-remember"><input type="checkbox" />下次自动登录（原型）</label><a className="auth-apply" href="https://jsj.top/f/NctQWw" target="_blank" rel="noopener noreferrer">没有邀请码？申请体验</a></div>
          <p className="auth-prototype-note">交互原型：当前表单仅演示页面流程，不会提交真实账户数据。</p>
        </div>
      </section>
    </main>
  )
}
