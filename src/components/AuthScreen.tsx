import { useState } from 'react'
import { ArrowRight, Leaf, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email'))
    const password = String(data.get('password'))
    setLoading(true)
    setError('')
    setMessage('')
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setLoading(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    if (mode === 'register' && !result.data.session) {
      setMessage('Registrazione completata. Apri la email di conferma per attivare il tuo account Vatia.')
      form.reset()
    }
  }

  return (
    <main className="auth-shell app-shell">
      <section className="auth-card">
        <div className="brand auth-brand"><div className="brand-mark"><Leaf size={23} strokeWidth={2.4} /></div><span>vatia</span><small>PRO</small></div>
        <span className="eyebrow">IL TUO STUDIO, OVUNQUE</span>
        <h1>{mode === 'login' ? 'Bentornato nel tuo spazio.' : 'Crea il tuo spazio Vatia.'}</h1>
        <p className="auth-intro">Gestisci pazienti, diari e piani alimentari in un ambiente riservato e sincronizzato.</p>
        <form className="auth-form" onSubmit={submit}>
          <label>Email<div className="auth-input"><Mail size={17} /><input name="email" type="email" autoComplete="email" required placeholder="nome@studio.it" /></div></label>
          <label>Password<div className="auth-input"><LockKeyhole size={17} /><input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required placeholder="Almeno 8 caratteri" /></div></label>
          {error && <div className="auth-feedback error" role="alert">{error}</div>}
          {message && <div className="auth-feedback success" role="status">{message}</div>}
          <button className="button primary auth-submit" disabled={loading} type="submit">
            {loading ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
            {loading ? 'Attendi…' : mode === 'login' ? 'Accedi a Vatia' : 'Crea account'}
          </button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage('') }}>
          {mode === 'login' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
        </button>
        <small className="auth-privacy">Dati protetti da autenticazione e regole di accesso per singolo account.</small>
      </section>
    </main>
  )
}
