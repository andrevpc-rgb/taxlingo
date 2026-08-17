// src/components/SubscriptionModal.jsx
//
// Seleção de plano + checkout Asaas (PIX/cartão recorrente). Chama a Edge
// Function create-asaas-checkout (ver supabase/functions/) e redireciona
// pra URL de pagamento que ela devolve. A ativação de fato (liberar acesso
// ilimitado, avisar o RH com o company_code) acontece depois, via webhook
// (supabase/functions/asaas-webhook) — o front só inicia o checkout.

import React, { useEffect, useState } from 'react';
import { X, Check, Crown, Zap, AlertCircle } from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';
import { isSupabaseConfigured } from '../lib/supabase';
import * as api from '../lib/api';

const PLANS = [
  {
    id: 'starter',
    label: 'Starter',
    price: 'R$ 297/mês',
    seatsLimit: 10,
    icon: Zap,
    color: 'sky',
    features: ['Até 10 colaboradores', 'Todos os 7 níveis de carreira', 'Painel do Gestor', 'Suporte por e-mail'],
  },
  {
    id: 'pro',
    label: 'Pro',
    price: 'R$ 897/mês',
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

export default function SubscriptionModal({ onClose }) {
  const { currentCompany, isManager } = useGame();
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(isSupabaseConfigured);

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

  if (!isManager) return null;

  const handleSubscribe = async (planId) => {
    setError(null);
    if (!cpfCnpj.trim()) {
      setError('Informe o CPF/CNPJ da empresa para gerar a cobrança.');
      return;
    }
    setLoadingPlan(planId);
    try {
      const { checkoutUrl } = await api.createCheckoutSession({
        companyId: currentCompany.id,
        plan: planId,
        cpfCnpj: cpfCnpj.trim(),
      });
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err.message || 'Não foi possível iniciar o checkout.');
      setLoadingPlan(null);
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

        <h2 className="mb-1 text-lg font-extrabold text-slate-800">Assinatura TaxLingo</h2>
        <p className="mb-5 text-sm text-slate-400">
          {currentCompany?.name ? `Escolha o plano de ${currentCompany.name}.` : 'Escolha um plano.'}
        </p>

        {!isSupabaseConfigured && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Checkout precisa do Supabase + Asaas configurados (ver .env.local e supabase/functions).
          </div>
        )}

        {!loadingSubscription && subscription?.status === 'active' && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">
            <Check className="h-4 w-4 shrink-0" />
            Plano {subscription.plan} ativo — até {subscription.seatsLimit} colaboradores.
          </div>
        )}

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
                  {loadingPlan === plan.id ? 'Abrindo checkout...' : 'Assinar'}
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

        <p className="mt-4 text-[11px] text-slate-400">
          Pagamento processado pelo Asaas (PIX ou cartão recorrente). Depois da confirmação, o código da
          empresa é enviado por e-mail e o acesso dos colaboradores é liberado automaticamente.
        </p>
      </div>
    </div>
  );
}
