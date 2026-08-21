// src/components/AuthModal.jsx
import React, { useState } from 'react';
import {
  LogIn,
  UserPlus,
  AlertCircle,
  Gift,
  Mail,
  Check,
  CreditCard,
  Info,
  KeyRound,
  Building2,
} from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';
import { isSupabaseConfigured } from '../lib/supabase';
import * as api from '../lib/api';
import { PLANS } from '../data/mockData';

// Link de pagamento fixo do Asaas para o Plano Individual — configurado
// direto no painel do Asaas (não é um checkout gerado dinamicamente pela
// nossa Edge Function). O próprio checkout hospedado pelo Asaas já coleta
// nome/e-mail/CPF do comprador, então não precisa de formulário nenhum
// aqui — só levar a pessoa pra lá. A confirmação do pagamento
// (asaas-webhook, evento PAYMENT_RECEIVED) cria a conta sozinha e manda
// e-mail/senha de acesso por e-mail.
const ASAAS_INDIVIDUAL_PAYMENT_LINK = 'https://www.asaas.com/c/4vramk3few3gyne9';

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

// "Esqueci minha senha": pede só o e-mail e chama
// supabase.auth.resetPasswordForEmail() (via GameContext.resetPasswordForEmail).
// O link do e-mail loga numa sessão de recuperação que cai direto na tela
// de definir senha nova (ver ResetPasswordForm.jsx / App.jsx).
function ForgotPasswordSection({ onClose }) {
  const { resetPasswordForEmail } = useGame();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await resetPasswordForEmail(email);
    setLoading(false);
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
        Mandamos um link de redefinição para {email}. Confira sua caixa de entrada (e o spam).
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-2xl border-2 border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
          <KeyRound className="h-4 w-4" />
          Redefinir senha
        </p>
        <button type="button" onClick={onClose} className="text-[11px] font-bold text-slate-400 hover:text-slate-600">
          Cancelar
        </button>
      </div>
      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@empresa.com"
          className="w-full rounded-xl border-2 border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
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
        disabled={loading}
        className="w-full rounded-xl bg-slate-700 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {loading ? 'Enviando...' : 'Enviar link de redefinição'}
      </button>
    </form>
  );
}

// Plano Individual: pra quem não tem (nem precisa de) uma empresa. Vai
// direto pro link de pagamento do Asaas — sem formulário nosso, sem
// cadastro prévio. A conta só passa a existir quando o pagamento é
// confirmado (ver asaas-webhook).
function IndividualPlanSection() {
  const plan = PLANS.individual;

  return (
    <div className="space-y-1.5 rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50 p-3">
      <a
        href={ASAAS_INDIVIDUAL_PAYMENT_LINK}
        className="flex w-full items-center justify-between gap-2 rounded-xl bg-sky-500 px-3 py-2.5 text-xs font-extrabold uppercase tracking-wide text-white transition-transform active:translate-y-0.5"
      >
        <span className="flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Assinar Plano Individual
        </span>
        <span className="normal-case tracking-normal">{plan.price}</span>
      </a>
      <p className="text-[11px] text-sky-600">
        {plan.description} Pagamento direto pelo Asaas — sem código de empresa. Depois de confirmado, mandamos seu
        e-mail e senha de acesso por e-mail.
      </p>
    </div>
  );
}

// Plano Corporativo: preenche o formulário e já recebe por e-mail uma
// proposta com o link de pagamento pronto (gerado no Asaas pela Edge
// Function create-corporate-lead) — não precisa esperar contato manual.
// O CNPJ é obrigatório aqui porque a function usa ele pra achar/criar o
// cliente de cobrança no Asaas antes de gerar o link.
function CorporatePlanSection() {
  const [expanded, setExpanded] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [seatsRequested, setSeatsRequested] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!isSupabaseConfigured) {
      setError('Esse formulário precisa do Supabase configurado (ver .env.local).');
      return;
    }
    setLoading(true);
    try {
      await api.submitCorporateLead({
        companyName: companyName.trim(),
        cnpj: cnpj.trim(),
        contactEmail: contactEmail.trim(),
        phone: phone.trim(),
        seatsRequested: seatsRequested ? Number(seatsRequested) : null,
      });
      setSent(true);
    } catch (err) {
      setError(err.message || 'Não foi possível enviar sua solicitação.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">
        <Check className="h-4 w-4 shrink-0" />
        Mandamos a proposta com o link de pagamento pra {contactEmail} — o acesso da equipe é liberado
        automaticamente assim que o pagamento for confirmado.
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50 px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-indigo-600 transition-colors hover:border-indigo-400"
      >
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Plano Corporativo
        </span>
        <span className="normal-case tracking-normal text-indigo-500">Fale com a gente</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-indigo-600">
        <Building2 className="h-4 w-4" />
        Plano Corporativo
      </p>
      <p className="text-[11px] text-indigo-600">
        Pra escritórios e empresas treinarem o time inteiro. Deixe os dados que a gente entra em contato pra fechar.
      </p>
      <input
        type="text"
        required
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        placeholder="Nome da empresa"
        className="w-full rounded-xl border-2 border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
      />
      <input
        type="text"
        required
        value={cnpj}
        onChange={(e) => setCnpj(e.target.value)}
        placeholder="CNPJ (só números)"
        className="w-full rounded-xl border-2 border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
      />
      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-400" />
        <input
          type="email"
          required
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="E-mail do responsável"
          className="w-full rounded-xl border-2 border-indigo-200 bg-white py-2 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
        />
      </div>
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Telefone (opcional)"
        className="w-full rounded-xl border-2 border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
      />
      <input
        type="number"
        min="1"
        value={seatsRequested}
        onChange={(e) => setSeatsRequested(e.target.value)}
        placeholder="Quantidade de vagas desejadas"
        className="w-full rounded-xl border-2 border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
      />
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-indigo-500 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {loading ? 'Enviando...' : 'Solicitar contato'}
      </button>
    </form>
  );
}

function LoginForm() {
  const { login, authError } = useGame();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const handleSubmit = (event) => {
    event.preventDefault();
    login(email, password);
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

        {!showForgotPassword && (
          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className="text-xs font-bold text-slate-400 hover:text-slate-600"
          >
            Esqueci minha senha
          </button>
        )}

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

      {showForgotPassword && <ForgotPasswordSection onClose={() => setShowForgotPassword(false)} />}

      <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Comprou o Plano Individual? Sua conta já foi criada — só entrar com o e-mail e a senha que mandamos por
        e-mail depois do pagamento. Não precisa de código de empresa.
      </p>

      <FreeTrialSection />
      <IndividualPlanSection />
      <CorporatePlanSection />
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
