// src/components/AuthModal.jsx
import React, { useState } from 'react';
import { LogIn, UserPlus, AlertCircle, Sparkles, Gift, Mail, Check } from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';

const TEST_ACCOUNTS = [
  { label: 'Andréia · Contabilidade Alfa', email: 'andreia@alfa.com', password: 'demo123' },
  { label: 'Juliana · Beta Consultoria', email: 'juliana@beta.com', password: 'demo123' },
  { label: 'Patrícia · Grupo Gamma', email: 'patricia@gamma.com', password: 'demo123' },
];

// Lead capture: "Testar Grátis por 24 Horas" — pede só o e-mail, cria uma
// conta temporária no backend (Edge Function) e manda as credenciais por
// e-mail. Some sozinho depois de enviado; não trava a tela de login.
function FreeTrialSection() {
  const { startFreeTrial, authLoading } = useGame();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    const result = await startFreeTrial(email);
    if (result.ok) {
      setSent(true);
    } else {
      setError(result.error);
    }
  };

  if (sent) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">
        <Check className="h-4 w-4 shrink-0" />
        Enviamos suas credenciais de teste para {email}. Confira sua caixa de entrada (e o spam).
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-amber-600 transition-colors hover:border-amber-400"
      >
        <Gift className="h-4 w-4" />
        Testar Grátis por 24 Horas
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-amber-600">
        <Gift className="h-4 w-4" />
        Teste Grátis por 24 Horas
      </p>
      <p className="text-[11px] text-amber-600">
        Sem cadastro de empresa. Mandamos uma senha temporária pro seu e-mail, válida por 24h.
      </p>
      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-400" />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@empresa.com"
          className="w-full rounded-xl border-2 border-amber-200 bg-white py-2 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none focus:border-amber-400"
        />
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={authLoading}
        className="w-full rounded-xl bg-amber-500 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {authLoading ? 'Enviando...' : 'Enviar acesso de teste'}
      </button>
    </form>
  );
}

function LoginForm() {
  const { login, authError, clearAuthError } = useGame();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
    login(email, password);
  };

  const fillTestAccount = (account) => {
    clearAuthError();
    setEmail(account.email);
    setPassword(account.password);
  };

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
            E-mail
          </label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com"
            className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
            Senha
          </label>
          <input
            id="login-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
          />
        </div>

        {authError && (
          <p className="flex items-center gap-1.5 text-xs font-bold text-rose-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {authError}
          </p>
        )}

        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] active:translate-y-0.5 active:shadow-none"
        >
          <LogIn className="h-4 w-4" />
          Entrar
        </button>
      </form>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
          <Sparkles className="h-3.5 w-3.5" />
          Contas de teste
        </p>
        <div className="space-y-1.5">
          {TEST_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => fillTestAccount(account)}
              className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-left text-xs font-bold text-slate-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50"
            >
              {account.label}
              <span className="ml-1 font-normal text-slate-400">— {account.email}</span>
            </button>
          ))}
        </div>
      </div>

      <FreeTrialSection />
    </div>
  );
}

function RegisterForm() {
  const { register, authError } = useGame();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyCode, setCompanyCode] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
    register({ name, email, password, jobTitle, companyCode });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="register-name" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
          Nome completo
        </label>
        <input
          id="register-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome"
          className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
      </div>
      <div>
        <label htmlFor="register-email" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
          E-mail
        </label>
        <input
          id="register-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@empresa.com"
          className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
      </div>
      <div>
        <label htmlFor="register-password" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
          Senha
        </label>
        <input
          id="register-password"
          type="password"
          required
          minLength={4}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 4 caracteres"
          autoComplete="new-password"
          className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
      </div>
      <div>
        <label htmlFor="register-job-title" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
          Cargo na empresa
        </label>
        <input
          id="register-job-title"
          type="text"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Ex: Analista Fiscal, Estagiário de Contabilidade..."
          className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
      </div>
      <div>
        <label htmlFor="register-code" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
          Código da empresa
        </label>
        <input
          id="register-code"
          type="text"
          required
          value={companyCode}
          onChange={(e) => setCompanyCode(e.target.value)}
          placeholder="Ex: ALFA2026"
          className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold uppercase text-slate-700 outline-none focus:border-emerald-400"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          Peça o código ao seu RH. Contas de teste: ALFA2026, BETA2026, GAMMA2026.
        </p>
      </div>

      {authError && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-rose-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {authError}
        </p>
      )}

      <button
        type="submit"
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] active:translate-y-0.5 active:shadow-none"
      >
        <UserPlus className="h-4 w-4" />
        Criar conta
      </button>
    </form>
  );
}

export default function AuthModal() {
  const { clearAuthError } = useGame();
  const [tab, setTab] = useState('login'); // 'login' | 'register'

  const switchTab = (nextTab) => {
    clearAuthError();
    setTab(nextTab);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-lg font-black text-white">
            T
          </div>
          <h1 className="text-lg font-extrabold text-slate-800">TaxLingo</h1>
          <p className="text-xs font-medium text-slate-400">Treinamento gamificado de Reforma Tributária</p>
        </div>

        <div className="mb-5 flex gap-2 rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => switchTab('login')}
            className={`flex-1 rounded-xl py-2 text-xs font-extrabold uppercase tracking-wide transition-colors ${
              tab === 'login' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => switchTab('register')}
            className={`flex-1 rounded-xl py-2 text-xs font-extrabold uppercase tracking-wide transition-colors ${
              tab === 'register' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'
            }`}
          >
            Cadastrar
          </button>
        </div>

        {tab === 'login' ? <LoginForm /> : <RegisterForm />}
      </div>
    </div>
  );
}
