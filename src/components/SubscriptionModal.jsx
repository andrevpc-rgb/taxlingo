// src/components/SubscriptionModal.jsx
//
// Renovação/Upgrade do Plano Corporativo DA EMPRESA JÁ LOGADA (currentCompany
// — nunca cria empresa nova por aqui, isso é o Painel de Contingência do
// master ou o fluxo de lead em AuthModal.jsx). Ao clicar "Assinar", chama a
// Edge Function create-asaas-checkout e mostra o QR Code/copia-e-cola do
// PIX (ou o link da fatura, se o PIX não vier) DIRETO NA TELA — sem
// redirecionar pra fora do app. A ativação de fato (somar 30 dias em
// companies.expires_at, ajustar max_users) acontece depois, via webhook
// (supabase/functions/asaas-webhook), quando o Asaas confirma o pagamento;
// esta tela só gera a cobrança.
//
// Nitrus continua com o fluxo antigo de redirecionamento (não devolve
// QR/copia-e-cola) — ver createNitrusCheckoutSession.

import React, { useEffect, useState } from 'react';
import { X, Check, Crown, Zap, AlertCircle, Copy, ExternalLink } from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';
import { isSupabaseConfigured } from '../lib/supabase';
import * as api from '../lib/api';

const PLANS = [
  {
    id: 'starter',
    label: 'Starter',
    price: 'R$ 297/mês',
    seatsLimit: 30,
    icon: Zap,
    color: 'sky',
    features: ['Até 30 colaboradores', 'Todos os 7 níveis de carreira', 'Painel do Gestor', 'Suporte por e-mail'],
  },
  {
    id: 'pro',
    label: 'Pro',
    price: 'R$ 497/mês',
    seatsLimit: 50,
    icon: Crown,
    color: 'amber',
    features: ['Até 50 colaboradores', 'Todos os 7 níveis de carreira', 'Painel do Gestor', 'Suporte prioritário'],
  },
];

const COLOR_CLASSES = {
  sky: { border: 'border-sky-200', bg: 'bg-sky-50', text: 'text-sky-600', button: 'bg-sky-500 shadow-[0_4px_0_0_#0369a1]' },
  amber: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-600', button: 'bg-amber-500 shadow-[0_4px_0_0_#b45309]' },
};

const PAYMENT_PROVIDERS = [
  { id: 'asaas', label: 'Asaas' },
  { id: 'nitrus', label: 'Nitrus' },
];

export default function SubscriptionModal({ onClose }) {
  const { user, currentCompany, isManager } = useGame();
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [provider, setProvider] = useState('asaas');
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(isSupabaseConfigured);
  const [checkoutResult, setCheckoutResult] = useState(null); // { checkoutUrl, pixQrCode, pixCopyPaste, plan } | null
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !currentCompany) {
      setLoadingSubscription(false);
      return;
    }
    let active = true;
    api
      .fetchSubscription(currentCompany.id)
      .then((sub) => active && setSubscription(sub))
      .catch(() => {})
      .finally(() => active && setLoadingSubscription(false));
    return () => {
      active = false;
    };
  }, [currentCompany]);

  // Pré-preenche com o CNPJ já cadastrado na empresa (companies.cnpj), se
  // existir — a pessoa só precisa digitar na primeira renovação.
  useEffect(() => {
    if (currentCompany?.cnpj) setCpfCnpj(currentCompany.cnpj);
  }, [currentCompany?.cnpj]);

  if (!isManager) return null;

  const handleSubscribe = async (planId) => {
    setError(null);
    setCheckoutResult(null);
    if (!cpfCnpj.trim()) {
      setError('Informe o CPF/CNPJ da empresa para gerar a cobrança.');
      return;
    }
    setLoadingPlan(planId);
    try {
      if (provider === 'nitrus') {
        // Nitrus não devolve QR/copia-e-cola pra mostrar na tela — mantém o
        // redirecionamento de sempre.
        const { checkoutUrl } = await api.createNitrusCheckoutSession({
          companyId: currentCompany.id,
          adminEmail: user.email,
          adminName: user.name,
          plan: planId,
          cpfCnpj: cpfCnpj.trim(),
        });
        window.location.href = checkoutUrl;
        return;
      }

      const result = await api.createCheckoutSession({
        companyId: currentCompany.id,
        plan: planId,
        cpfCnpj: cpfCnpj.trim(),
      });
      setCheckoutResult({ ...result, plan: planId });
    } catch (err) {
      setError(err.message || 'Não foi possível iniciar o checkout.');
    } finally {
      setLoadingPlan(null);
    }
  };

  const copyPixCode = async () => {
    if (!checkoutResult?.pixCopyPaste) return;
    try {
      await navigator.clipboard.writeText(checkoutResult.pixCopyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponível — o código já está visível na tela pra copiar na mão.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-8">
      <div
        className="relative w-full max-w-lg overflow-y-auto rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-xl"
        style={{ maxHeight: '90vh' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="mb-1 text-lg font-extrabold text-slate-800">Renovação e Upgrade do Plano Corporativo</h2>
        <p className="mb-5 text-sm text-slate-400">
          {currentCompany?.name ? `Renove ou troque o plano de ${currentCompany.name}.` : 'Renove ou troque de plano.'}{' '}
          Pra uma conta pessoal (sem empresa), veja o <strong>Plano Individual</strong> na tela de login.
        </p>

        {!isSupabaseConfigured && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Checkout precisa do Supabase + Asaas/Nitrus configurados (ver .env.local e supabase/functions).
          </div>
        )}

        {!loadingSubscription && subscription?.status === 'active' && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">
            <Check className="h-4 w-4 shrink-0" />
            Plano {subscription.plan} ativo — até {subscription.seatsLimit} colaboradores.
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
            Forma de cobrança
          </label>
          <div className="flex gap-2">
            {PAYMENT_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={`flex-1 rounded-2xl border-2 px-4 py-2 text-sm font-extrabold transition-colors ${
                  provider === p.id
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="checkout-cpf-cnpj" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
            CPF/CNPJ para cobrança
          </label>
          <input
            id="checkout-cpf-cnpj"
            type="text"
            value={cpfCnpj}
            onChange={(e) => setCpfCnpj(e.target.value)}
            placeholder="Só números"
            className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            const classes = COLOR_CLASSES[plan.color];
            return (
              <div key={plan.id} className={`rounded-2xl border-2 ${classes.border} ${classes.bg} p-4`}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${classes.text}`} />
                  <h3 className="text-base font-extrabold text-slate-800">{plan.label}</h3>
                </div>
                <p className="mb-3 text-xl font-extrabold text-slate-800">{plan.price}</p>
                <ul className="mb-4 space-y-1.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5 text-xs font-medium text-slate-600">
                      <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${classes.text}`} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={!isSupabaseConfigured || loadingPlan !== null}
                  onClick={() => handleSubscribe(plan.id)}
                  className={`w-full rounded-2xl px-4 py-2.5 text-xs font-extrabold uppercase tracking-wide text-white transition-transform active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 ${classes.button}`}
                >
                  {loadingPlan === plan.id ? 'Gerando cobrança...' : 'Assinar'}
                </button>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-1.5 text-xs font-bold text-rose-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {checkoutResult && (
          <div className="mt-5 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
            <p className="mb-3 text-sm font-extrabold text-emerald-700">
              Cobrança do plano {PLANS.find((p) => p.id === checkoutResult.plan)?.label ?? checkoutResult.plan} gerada!
              Pague por PIX abaixo ou pela fatura — o acesso é liberado automaticamente assim que o Asaas confirmar.
            </p>

            {checkoutResult.pixQrCode && (
              <div className="mb-3 flex justify-center">
                <img
                  src={checkoutResult.pixQrCode}
                  alt="QR Code PIX para pagamento"
                  className="h-48 w-48 rounded-xl border-2 border-white bg-white p-1"
                />
              </div>
            )}

            {checkoutResult.pixCopyPaste && (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-emerald-700">
                  PIX Copia e Cola
                </label>
                <div className="flex items-center gap-2 rounded-xl border-2 border-emerald-200 bg-white px-3 py-2">
                  <code className="flex-1 truncate text-xs text-slate-600">{checkoutResult.pixCopyPaste}</code>
                  <button
                    type="button"
                    onClick={copyPixCode}
                    className="shrink-0 text-emerald-600 hover:text-emerald-800"
                    aria-label="Copiar código PIX"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                {copied && <p className="mt-1 text-xs font-bold text-emerald-600">Copiado!</p>}
              </div>
            )}

            {checkoutResult.checkoutUrl && (
              <a
                href={checkoutResult.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-emerald-300 bg-white px-4 py-2.5 text-xs font-extrabold uppercase tracking-wide text-emerald-700 hover:border-emerald-400"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ver fatura (boleto ou cartão)
              </a>
            )}
          </div>
        )}

        <p className="mt-4 text-[11px] text-slate-400">
          Pagamento processado pelo {provider === 'nitrus' ? 'Nitrus' : 'Asaas'} (PIX, boleto ou cartão). Depois da
          confirmação, o plano é renovado por mais 30 dias automaticamente — sem precisar trocar o código da
          empresa nem recadastrar ninguém.
        </p>
      </div>
    </div>
  );
}
