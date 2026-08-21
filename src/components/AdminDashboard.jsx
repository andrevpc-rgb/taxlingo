// src/components/AdminDashboard.jsx
import React, { useMemo, useState } from 'react';
import {
  Users,
  Clock,
  Activity,
  Award,
  Search,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Target,
  CircleDot,
  CreditCard,
} from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';
import { CAREER_LEVELS, mockTopicGaps } from '../data/mockData';
import SubscriptionModal from './SubscriptionModal';
import MasterContingencyPanel from './MasterContingencyPanel';

const ACTIVE_WITHIN_DAYS = 3; // define o status "Ativo" na tabela e o KPI de colaboradores ativos
const ENGAGEMENT_WINDOW_DAYS = 7;
const STUCK_AFTER_DAYS = 10;

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const a = new Date(`${dateStr}T00:00:00`);
  const b = new Date();
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function getLevelTitle(levelId) {
  return CAREER_LEVELS.find((level) => level.id === levelId)?.title ?? '—';
}

function lastExamAttempt(user) {
  const attempts = user.examAttempts ?? [];
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function KpiCard({ icon, label, value, sublabel, colorClass }) {
  return (
    <div className="rounded-2xl border-2 border-slate-100 bg-white p-4">
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${colorClass}`}>{icon}</div>
      <p className="text-2xl font-extrabold text-slate-800">{value}</p>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      {sublabel && <p className="mt-0.5 text-[11px] text-slate-400">{sublabel}</p>}
    </div>
  );
}

function SortHeader({ label, sortKey, activeKey, dir, onSort }) {
  const isActive = sortKey === activeKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-left text-[11px] font-extrabold uppercase tracking-wide ${
        isActive ? 'text-emerald-600' : 'text-slate-400'
      }`}
    >
      {label}
      {isActive && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );
}

export default function AdminDashboard() {
  const { user, users, currentCompany } = useGame();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('xp'); // 'xp' | 'time' | 'exam'
  const [sortDir, setSortDir] = useState('desc');
  const [showSubscription, setShowSubscription] = useState(false);

  const companyUsers = useMemo(
    () => (user ? users.filter((u) => u.companyId === user.companyId) : []),
    [users, user]
  );

  const kpis = useMemo(() => {
    const total = companyUsers.length;
    const activeCount = companyUsers.filter((u) => daysSince(u.lastStudyDate) <= ACTIVE_WITHIN_DAYS).length;
    const totalMinutes = companyUsers.reduce((sum, u) => sum + (u.timeSpentMinutes ?? 0), 0);
    const engagedCount = companyUsers.filter(
      (u) => u.streak > 0 && daysSince(u.lastStudyDate) <= ENGAGEMENT_WINDOW_DAYS
    ).length;
    const allAttempts = companyUsers.flatMap((u) => u.examAttempts ?? []);
    const avgExamScore =
      allAttempts.length > 0 ? allAttempts.reduce((sum, a) => sum + a.scorePct, 0) / allAttempts.length : null;

    return {
      activeCount,
      total,
      totalHours: (totalMinutes / 60).toFixed(1),
      engagementRate: total > 0 ? engagedCount / total : 0,
      avgExamScore,
    };
  }, [companyUsers]);

  const tableRows = useMemo(() => {
    const filtered = companyUsers.filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()));
    const withExtras = filtered.map((u) => {
      const last = lastExamAttempt(u);
      return {
        ...u,
        lastExamScore: last?.scorePct ?? null,
        isActive: daysSince(u.lastStudyDate) <= ACTIVE_WITHIN_DAYS,
      };
    });

    const sorted = [...withExtras].sort((a, b) => {
      let diff = 0;
      if (sortKey === 'xp') diff = a.xp - b.xp;
      if (sortKey === 'time') diff = (a.timeSpentMinutes ?? 0) - (b.timeSpentMinutes ?? 0);
      if (sortKey === 'exam') diff = (a.lastExamScore ?? -1) - (b.lastExamScore ?? -1);
      return sortDir === 'asc' ? diff : -diff;
    });

    return sorted;
  }, [companyUsers, search, sortKey, sortDir]);

  const needsSupport = useMemo(() => {
    return companyUsers
      .map((u) => {
        const stuckDays = daysSince(u.currentLevelSince);
        const isStuck = stuckDays > STUCK_AFTER_DAYS && Number.isFinite(stuckDays);
        const recentAtLevel = (u.examAttempts ?? []).filter((a) => a.levelId === u.currentLevelId).slice(-2);
        const failedTwice = recentAtLevel.length === 2 && recentAtLevel.every((a) => !a.passed);
        const reasons = [];
        if (isStuck) reasons.push(`Travado(a) há ${stuckDays} dias em ${getLevelTitle(u.currentLevelId)}`);
        if (failedTwice) reasons.push('Reprovado(a) 2x seguidas no Exame de Transição');
        return { user: u, reasons };
      })
      .filter((entry) => entry.reasons.length > 0);
  }, [companyUsers]);

  if (!user) return null;

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortedTopicGaps = [...mockTopicGaps].sort((a, b) => b.missRate - a.missRate);

  return (
    <div className="mx-auto max-w-md px-4 py-6 pb-24 md:max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-xl font-extrabold text-slate-800">Painel do Gestor</h1>
          <p className="text-sm text-slate-400">
            Acompanhamento de treinamento de {currentCompany?.name ?? 'sua empresa'}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSubscription(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-slate-600 hover:border-emerald-300"
        >
          <CreditCard className="h-4 w-4" />
          <span className="hidden sm:inline">Assinatura</span>
        </button>
      </div>

      {user.role === 'master' && <MasterContingencyPanel />}

      {/* A. Métricas Globais */}
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={<Users className="h-5 w-5 text-emerald-600" />}
          colorClass="bg-emerald-50"
          value={`${kpis.activeCount}/${kpis.total}`}
          label="Colaboradores ativos"
          sublabel={`estudaram nos últimos ${ACTIVE_WITHIN_DAYS} dias`}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5 text-sky-600" />}
          colorClass="bg-sky-50"
          value={`${kpis.totalHours}h`}
          label="Tempo total de treinamento"
          sublabel="soma de toda a equipe"
        />
        <KpiCard
          icon={<Activity className="h-5 w-5 text-amber-600" />}
          colorClass="bg-amber-50"
          value={pct(kpis.engagementRate)}
          label="Taxa média de engajamento"
          sublabel="ofensiva ativa nos últimos 7 dias"
        />
        <KpiCard
          icon={<Award className="h-5 w-5 text-indigo-600" />}
          colorClass="bg-indigo-50"
          value={kpis.avgExamScore !== null ? pct(kpis.avgExamScore) : '—'}
          label="Nota média nos exames"
          sublabel="todas as tentativas de transição"
        />
      </div>

      {/* B. Tabela por colaborador */}
      <div className="mb-8">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Equipe</h2>
          <div className="relative w-full sm:w-48">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome..."
              className="w-full min-h-[2.75rem] rounded-xl border-2 border-slate-200 py-1.5 pl-9 pr-3 text-xs font-bold text-slate-600 outline-none focus:border-emerald-400 sm:min-h-0"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border-2 border-slate-100 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b-2 border-slate-100 text-left">
                <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Nome</th>
                <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Nível atual</th>
                <th className="px-4 py-3">
                  <SortHeader label="XP" sortKey="xp" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Ofensiva</th>
                <th className="px-4 py-3">
                  <SortHeader label="Tempo de uso" sortKey="time" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-4 py-3">
                  <SortHeader label="Último exame" sortKey="exam" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg" aria-hidden="true">
                        {row.avatarUrl}
                      </span>
                      <div>
                        <p className="font-bold text-slate-700">{row.name}</p>
                        <p className="text-xs text-slate-400">{row.jobTitle ?? '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{getLevelTitle(row.currentLevelId)}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{row.xp}</td>
                  <td className="px-4 py-3 text-slate-600">{row.streak} dias</td>
                  <td className="px-4 py-3 text-slate-600">{formatMinutes(row.timeSpentMinutes ?? 0)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.lastExamScore !== null ? pct(row.lastExamScore) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${
                        row.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      <CircleDot className="h-3 w-3" />
                      {row.isActive ? 'Ativo' : 'Ausente'}
                    </span>
                  </td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                    Nenhum colaborador encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* C. Diagnóstico de gargalos */}
      <div className="mb-8">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide text-slate-500">
          <Target className="h-4 w-4" />
          Conceitos com mais erros da equipe
        </h2>
        <p className="mb-3 text-xs text-slate-400">
          Estimativa ilustrativa com base no conteúdo mais desafiador de cada nível — o rastreamento de acerto por
          pergunta ainda não está conectado.
        </p>
        <div className="space-y-2 rounded-2xl border-2 border-slate-100 bg-white p-4">
          {sortedTopicGaps.map((gap) => (
            <div key={gap.topic}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-600">
                  {gap.topic} <span className="text-slate-400">· {getLevelTitle(gap.levelId)}</span>
                </span>
                <span className="font-extrabold text-rose-500">{pct(gap.missRate)} de erro</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-rose-400" style={{ width: pct(gap.missRate) }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alerta de colaboradores precisando de suporte */}
      <div>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide text-slate-500">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Colaboradores precisando de suporte
        </h2>

        {needsSupport.length === 0 ? (
          <p className="rounded-2xl border-2 border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-600">
            Ninguém travado ou reprovado no momento. 🎉
          </p>
        ) : (
          <div className="space-y-2">
            {needsSupport.map(({ user: flaggedUser, reasons }) => (
              <div
                key={flaggedUser.id}
                className="flex items-start gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 px-4 py-3"
              >
                <span className="text-lg" aria-hidden="true">
                  {flaggedUser.avatarUrl}
                </span>
                <div>
                  <p className="text-sm font-extrabold text-amber-700">
                    {flaggedUser.name} <span className="font-medium text-amber-500">· {flaggedUser.jobTitle ?? '—'}</span>
                  </p>
                  <ul className="mt-0.5 space-y-0.5 text-xs font-medium text-amber-600">
                    {reasons.map((reason) => (
                      <li key={reason}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showSubscription && <SubscriptionModal onClose={() => setShowSubscription(false)} />}
    </div>
  );
}
