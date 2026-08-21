// src/components/MasterContingencyPanel.jsx
//
// Só renderizado (ver AdminDashboard.jsx) pra quem está logado com
// role='master' — é o "break glass" pro caso do link de pagamento do Asaas
// falhar: libera Plano Individual ou Corporativo direto pela interface,
// sem depender do webhook. Toda ação passa pela Edge Function
// admin-provision, que confere de novo no servidor que quem está chamando
// é master mesmo (nunca confia só nisto aqui estar visível na tela).

import React, { useEffect, useState } from 'react';
import { ShieldAlert, UserPlus, Building2, RefreshCcw, Check, AlertCircle, Copy, UserCog } from 'lucide-react';
import * as api from '../lib/api';
import { isSupabaseConfigured } from '../lib/supabase.js';

function ResultCard({ result }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponível — a informação já está visível na tela pra copiar na mão.
    }
  };

  return (
    <div className="space-y-1.5 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs">
      {result.companyCode && (
        <p className="flex items-center justify-between gap-2 font-bold text-emerald-700">
          <span>
            Código da empresa: <code className="rounded bg-white px-1.5 py-0.5">{result.companyCode}</code>
          </span>
          <button type="button" onClick={() => copy(result.companyCode)} className="text-emerald-600 hover:text-emerald-800">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </p>
      )}
      {result.tempPassword && (
        <p className="flex items-center justify-between gap-2 font-bold text-emerald-700">
          <span>
            Senha temporária: <code className="rounded bg-white px-1.5 py-0.5">{result.tempPassword}</code>
          </span>
          <button type="button" onClick={() => copy(result.tempPassword)} className="text-emerald-600 hover:text-emerald-800">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </p>
      )}
      {result.alreadyExisted && (
        <p className="font-bold text-emerald-700">Esse e-mail já tinha conta — não mandamos senha nova.</p>
      )}
      {copied && <p className="font-bold text-emerald-500">Copiado!</p>}
    </div>
  );
}

function IndividualForm() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await api.adminProvisionIndividual({ email: email.trim(), name: name.trim() });
      setResult(data);
      setEmail('');
      setName('');
    } catch (err) {
      setError(err.message || 'Não foi possível criar o acesso.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-2xl border-2 border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
        <UserPlus className="h-4 w-4" />
        Liberar Plano Individual manualmente
      </p>
      <p className="text-[11px] text-slate-400">Cria a conta na hora, com 30 dias de acesso — igual ao pagamento pelo Asaas.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (opcional)"
          className="flex-1 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          className="flex-1 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      <ResultCard result={result} />
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {loading ? 'Criando...' : 'Criar acesso individual'}
      </button>
    </form>
  );
}

function CorporateForm({ prefill, onConsumePrefill }) {
  const [companyName, setCompanyName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [maxUsers, setMaxUsers] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('365');
  const [pendingSignupId, setPendingSignupId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!prefill) return;
    setCompanyName(prefill.company_name ?? '');
    setCnpj(prefill.cpf_cnpj ?? '');
    setMaxUsers(prefill.seats_requested ? String(prefill.seats_requested) : '');
    setPendingSignupId(prefill.id);
    onConsumePrefill();
  }, [prefill, onConsumePrefill]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await api.adminProvisionCorporate({
        companyName: companyName.trim(),
        cnpj: cnpj.trim(),
        maxUsers: maxUsers ? Number(maxUsers) : null,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        pendingSignupId,
      });
      setResult(data);
      setCompanyName('');
      setCnpj('');
      setMaxUsers('');
      setPendingSignupId(null);
    } catch (err) {
      setError(err.message || 'Não foi possível criar/ativar a empresa.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-2xl border-2 border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
        <Building2 className="h-4 w-4" />
        Criar/ativar Plano Corporativo manualmente
      </p>
      <p className="text-[11px] text-slate-400">
        Gera um código de empresa novo. Se vier de um lead (botão "Ativar" abaixo), marca o lead como concluído.
      </p>
      <input
        type="text"
        required
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        placeholder="Nome da empresa"
        className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={cnpj}
          onChange={(e) => setCnpj(e.target.value)}
          placeholder="CNPJ (opcional)"
          className="flex-1 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
        <input
          type="number"
          min="1"
          value={maxUsers}
          onChange={(e) => setMaxUsers(e.target.value)}
          placeholder="Limite de vagas"
          className="flex-1 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
        <input
          type="number"
          min="1"
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(e.target.value)}
          placeholder="Vence em (dias)"
          className="flex-1 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
      </div>
      {pendingSignupId && (
        <p className="text-[11px] font-bold text-indigo-500">Ativando o lead selecionado — vai marcar como concluído.</p>
      )}
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      <ResultCard result={result} />
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {loading ? 'Salvando...' : pendingSignupId ? 'Ativar empresa' : 'Criar empresa'}
      </button>
    </form>
  );
}

function SetRoleForm() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await api.adminSetUserRole({ email: email.trim(), role });
      setResult(data);
      setEmail('');
    } catch (err) {
      setError(err.message || 'Não foi possível definir o papel dessa conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-2xl border-2 border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
        <UserCog className="h-4 w-4" />
        Definir Gestor / Colaborador
      </p>
      <p className="text-[11px] text-slate-400">
        A pessoa precisa já ter se cadastrado com o código da empresa. Use pra dar acesso ao Painel do Gestor pra
        quem vai administrar a conta corporativa.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail já cadastrado"
          className="flex-1 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        >
          <option value="admin">Gestor (admin)</option>
          <option value="employee">Colaborador</option>
        </select>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {result && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
          <Check className="h-3.5 w-3.5 shrink-0" />
          {result.email} agora é {result.role === 'admin' ? 'Gestor' : 'Colaborador'}
          {result.companyName ? ` de ${result.companyName}` : ''}.
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {loading ? 'Salvando...' : 'Definir papel'}
      </button>
    </form>
  );
}

function PendingLeadsList({ onActivate }) {
  const [leads, setLeads] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setLeads(await api.fetchPendingCorporateLeads());
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os leads.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Leads Plano Corporativo pendentes</p>
        <button type="button" onClick={load} className="text-slate-400 hover:text-slate-600" aria-label="Recarregar">
          <RefreshCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {loading && !leads && <p className="text-xs text-slate-400">Carregando...</p>}
      {leads && leads.length === 0 && <p className="text-xs text-slate-400">Nenhum lead pendente.</p>}
      {leads && leads.length > 0 && (
        <div className="space-y-2">
          {leads.map((lead) => (
            <div key={lead.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-slate-100 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-700">{lead.company_name}</p>
                <p className="truncate text-[11px] text-slate-400">
                  {lead.admin_email} {lead.seats_requested ? `· ${lead.seats_requested} vagas` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onActivate(lead)}
                className="shrink-0 rounded-lg bg-indigo-500 px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-white"
              >
                Ativar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MasterContingencyPanel() {
  const [prefill, setPrefill] = useState(null);

  return (
    <div className="mb-8 rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-amber-500" />
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-amber-700">Painel de Contingência</h2>
      </div>
      <p className="mb-4 text-xs text-amber-700">
        Só visível pra conta master. Use quando o link de pagamento do Asaas falhar — libera acesso manualmente,
        sem depender do webhook.
      </p>

      {!isSupabaseConfigured ? (
        <p className="rounded-2xl border-2 border-amber-200 bg-white px-4 py-3 text-xs font-bold text-amber-600">
          Esse painel precisa do Supabase configurado (ver .env.local) — as Edge Functions de liberação manual não
          existem no modo de demonstração local.
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <IndividualForm />
            <CorporateForm prefill={prefill} onConsumePrefill={() => setPrefill(null)} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <SetRoleForm />
            <PendingLeadsList onActivate={setPrefill} />
          </div>
        </>
      )}
    </div>
  );
}
