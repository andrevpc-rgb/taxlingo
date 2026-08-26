// src/components/ManageUsersPanel.jsx
//
// Aba "Gerenciar Usuários" do Painel de Contingência (só master, ver
// MasterContingencyPanel.jsx) — lista todo mundo, de todas as empresas, com
// um botão pra criar colaborador manualmente (sem precisar do código da
// empresa nem de cadastro próprio) e um seletor por linha pra reatribuir
// qualquer usuário existente a outra empresa. Tudo passa pela Edge Function
// admin-provision (list_users/create_user/update_user_company), que confere
// de novo no servidor que quem chama é master mesmo.

import React, { useEffect, useMemo, useState } from 'react';
import { Users, UserPlus, Search, RefreshCcw, AlertCircle, Check } from 'lucide-react';
import * as api from '../lib/api';
import { useGame } from '../context/GameContext.jsx';

function CreateUserForm({ onCreated }) {
  const { companies } = useGame();
  const [expanded, setExpanded] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await api.adminCreateUser({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        jobTitle: jobTitle.trim(),
        companyId,
      });
      setResult(data);
      setFullName('');
      setEmail('');
      setPassword('');
      setJobTitle('');
      setCompanyId('');
      onCreated();
    } catch (err) {
      setError(err.message || 'Não foi possível criar o usuário.');
    } finally {
      setLoading(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 rounded-xl bg-slate-700 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white"
      >
        <UserPlus className="h-4 w-4" />+ Novo Usuário/Colaborador
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-2xl border-2 border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
          <UserPlus className="h-4 w-4" />
          Novo Usuário/Colaborador
        </p>
        <button type="button" onClick={() => setExpanded(false)} className="text-[11px] font-bold text-slate-400 hover:text-slate-600">
          Cancelar
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nome completo"
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
        <input
          type="text"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha inicial"
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
        <input
          type="text"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Cargo"
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
      </div>

      <select
        required
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
        className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
      >
        <option value="">Selecione a empresa...</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name} ({company.code})
          </option>
        ))}
      </select>

      {error && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {result && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
          <Check className="h-3.5 w-3.5 shrink-0" />
          {result.email} criado(a) em {result.companyName}.
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {loading ? 'Criando...' : 'Criar usuário'}
      </button>
    </form>
  );
}

function CompanyCell({ user, companies, onChanged }) {
  const [companyId, setCompanyId] = useState(user.company_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const dirty = companyId !== (user.company_id ?? '');

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.adminUpdateUserCompany({ userId: user.id, companyId });
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err.message || 'Não foi possível trocar a empresa.');
    } finally {
      setSaving(false);
    }
  };

  if (user.role === 'master') {
    return <span className="text-[11px] text-slate-400">—</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={companyId}
        onChange={(e) => {
          setCompanyId(e.target.value);
          setSaved(false);
        }}
        className="rounded-lg border-2 border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 outline-none focus:border-emerald-400"
      >
        <option value="">Sem empresa</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name} ({company.code})
          </option>
        ))}
      </select>
      {dirty && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
        >
          {saving ? '...' : 'Salvar'}
        </button>
      )}
      {saved && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
      {error && <span className="text-[10px] font-bold text-rose-600">{error}</span>}
    </div>
  );
}

export default function ManageUsersPanel() {
  const { companies } = useGame();
  const [users, setUsers] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await api.adminListUsers());
    } catch (err) {
      setError(err.message || 'Não foi possível carregar os usuários.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (u) => u.full_name?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term)
    );
  }, [users, search]);

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
          <Users className="h-4 w-4" />
          Gerenciar Usuários
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome/e-mail..."
              className="rounded-xl border-2 border-slate-200 py-1.5 pl-8 pr-3 text-xs font-bold text-slate-600 outline-none focus:border-emerald-400"
            />
          </div>
          <button type="button" onClick={load} className="text-slate-400 hover:text-slate-600" aria-label="Recarregar">
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mb-4">
        <CreateUserForm onCreated={load} />
      </div>

      {error && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {loading && !users && <p className="text-xs text-slate-400">Carregando...</p>}

      {users && (
        <div className="overflow-x-auto rounded-xl border-2 border-slate-100">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b-2 border-slate-100 text-left">
                <th className="px-3 py-2 font-extrabold uppercase tracking-wide text-slate-400">Nome</th>
                <th className="px-3 py-2 font-extrabold uppercase tracking-wide text-slate-400">E-mail</th>
                <th className="px-3 py-2 font-extrabold uppercase tracking-wide text-slate-400">Cargo</th>
                <th className="px-3 py-2 font-extrabold uppercase tracking-wide text-slate-400">Papel</th>
                <th className="px-3 py-2 font-extrabold uppercase tracking-wide text-slate-400">Empresa</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 font-bold text-slate-700">{u.full_name}</td>
                  <td className="px-3 py-2 text-slate-500">{u.email}</td>
                  <td className="px-3 py-2 text-slate-500">{u.job_title ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{u.role}</td>
                  <td className="px-3 py-2">
                    <CompanyCell user={u} companies={companies} onChanged={load} />
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
