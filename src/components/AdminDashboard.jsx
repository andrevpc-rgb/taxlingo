// src/components/AdminDashboard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Clock,
  Activity,
  Award,
  Search,
  ArrowUp,
  ArrowDown,
  Target,
  CircleDot,
  CreditCard,
  BookOpenCheck,
  Gem,
  AlertCircle,
  BarChart3,
} from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';
import { CAREER_LEVELS, TOPIC_LABELS } from '../data/mockData';
import { isSupabaseConfigured } from '../lib/supabase';
import * as api from '../lib/api';
import SubscriptionModal from './SubscriptionModal';
import MasterContingencyPanel from './MasterContingencyPanel';

const ACTIVE_WITHIN_DAYS = 7; // "Colaboradores Ativos" = logins/lições nos últimos 7 dias

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

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
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

// ---------------------------------------------------------------------------
// Dados reais da equipe da empresa do gestor logado.
// Modo Supabase: busca via api.fetchCompanyTeam/fetchCompanyProgress/
// fetchCompanyTopicAttempts, tudo protegido pelas policies de RLS
// (users_select_self_or_company / user_progress_select_self_or_company /
// question_attempts_select_self_or_company) — nenhuma delas exige RPC, o
// próprio Postgres já filtra pra "só a própria empresa" quando quem chama é
// admin/master (ver supabase/schema.sql).
// Modo mock: usa state.users local, filtrado por empresa (sem progresso por
// pergunta — o motor local não rastreia isso pergunta a pergunta).
// ---------------------------------------------------------------------------
function useCompanyData(companyId) {
  const { user, users: mockUsers } = useGame();

  const mockTeam = useMemo(
    () => (user ? mockUsers.filter((u) => u.companyId === user.companyId) : []),
    [user, mockUsers]
  );

  const [remote, setRemote] = useState({ loading: true, error: null, team: [], progress: [], topicAttempts: [] });

  useEffect(() => {
    if (!isSupabaseConfigured || !companyId) return undefined;
    let active = true;
    setRemote((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const team = await api.fetchCompanyTeam(companyId);
        const ids = team.map((u) => u.id);
        const [progress, topicAttempts] = await Promise.all([
          api.fetchCompanyProgress(ids),
          api.fetchCompanyTopicAttempts(ids),
        ]);
        if (!active) return;
        setRemote({ loading: false, error: null, team, progress, topicAttempts });
      } catch (err) {
        if (!active) return;
        setRemote({
          loading: false,
          error: err.message || 'Não foi possível carregar os dados da equipe.',
          team: [],
          progress: [],
          topicAttempts: [],
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [companyId]);

  if (!isSupabaseConfigured) {
    return { loading: false, error: null, team: mockTeam, progress: [], topicAttempts: [] };
  }
  return remote;
}

export default function AdminDashboard() {
  const { user, currentCompany } = useGame();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('xp'); // 'xp' | 'time' | 'accuracy'
  const [sortDir, setSortDir] = useState('desc');
  const [showSubscription, setShowSubscription] = useState(false);

  const { loading, error, team, progress, topicAttempts } = useCompanyData(user?.companyId);

  const kpis = useMemo(() => {
    const total = team.length;
    const activeCount = team.filter((u) => daysSince(u.lastStudyDate) <= ACTIVE_WITHIN_DAYS).length;
    const totalMinutes = team.reduce((sum, u) => sum + (u.timeSpentMinutes ?? 0), 0);
    const engagedCount = team.filter((u) => (u.streak ?? 0) > 0).length;
    const totalXp = team.reduce((sum, u) => sum + (u.xp ?? 0), 0);

    // Lições concluídas + taxa de acerto: modo Supabase usa user_progress.score
    // (gravado pra toda lição agora, regular ou exame — ver GameContext.jsx);
    // modo mock só tem histórico de EXAME (examAttempts) no motor local, então
    // usa isso como aproximação.
    const completedLessons = isSupabaseConfigured
      ? progress.length
      : team.reduce((sum, u) => sum + (u.examAttempts?.length ?? 0), 0);
    const scores = isSupabaseConfigured
      ? progress.map((p) => p.score).filter((s) => s != null)
      : team.flatMap((u) => (u.examAttempts ?? []).map((a) => a.scorePct));

    return {
      total,
      activeCount,
      totalHours: (totalMinutes / 60).toFixed(1),
      engagementRate: total > 0 ? engagedCount / total : 0,
      completedLessons,
      avgAccuracy: average(scores),
      totalXp,
    };
  }, [team, progress]);

  const levelDistribution = useMemo(() => {
    const counts = {};
    team.forEach((u) => {
      if (!u.currentLevelId) return;
      counts[u.currentLevelId] = (counts[u.currentLevelId] ?? 0) + 1;
    });
    const total = team.length || 1;
    return CAREER_LEVELS.map((level) => ({
      id: level.id,
      title: level.title,
      count: counts[level.id] ?? 0,
      share: (counts[level.id] ?? 0) / total,
    }));
  }, [team]);

  const topicPerformance = useMemo(() => {
    const buckets = {};
    topicAttempts.forEach((a) => {
      const bucket = buckets[a.topic] ?? (buckets[a.topic] = { total: 0, correct: 0 });
      bucket.total += 1;
      if (a.isCorrect) bucket.correct += 1;
    });
    return Object.entries(buckets)
      .map(([topic, b]) => ({
        topic,
        label: TOPIC_LABELS[topic] ?? topic,
        total: b.total,
        accuracy: b.total > 0 ? b.correct / b.total : 0,
      }))
      .sort((a, b) => a.accuracy - b.accuracy); // pior desempenho primeiro — mais acionável pro gestor
  }, [topicAttempts]);

  const tableRows = useMemo(() => {
    const filtered = team.filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()));
    const withExtras = filtered.map((u) => {
      const userScores = isSupabaseConfigured
        ? progress.filter((p) => p.userId === u.id).map((p) => p.score).filter((s) => s != null)
        : (u.examAttempts ?? []).map((a) => a.scorePct);
      return {
        ...u,
        avgScore: average(userScores),
        isActive: daysSince(u.lastStudyDate) <= ACTIVE_WITHIN_DAYS,
      };
    });

    const sorted = [...withExtras].sort((a, b) => {
      let diff = 0;
      if (sortKey === 'xp') diff = a.xp - b.xp;
      if (sortKey === 'time') diff = (a.timeSpentMinutes ?? 0) - (b.timeSpentMinutes ?? 0);
      if (sortKey === 'accuracy') diff = (a.avgScore ?? -1) - (b.avgScore ?? -1);
      return sortDir === 'asc' ? diff : -diff;
    });

    return sorted;
  }, [team, progress, search, sortKey, sortDir]);

  if (!user) return null;

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

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

      {error && (
        <p className="mb-6 flex items-center gap-1.5 rounded-2xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {loading ? (
        <p className="mb-6 text-sm font-bold text-slate-400">Carregando dados da equipe...</p>
      ) : (
        <>
          {/* A. Métricas Globais */}
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
            <KpiCard
              icon={<Users className="h-5 w-5 text-emerald-600" />}
              colorClass="bg-emerald-50"
              value={`${kpis.activeCount}/${kpis.total}`}
              label="Colaboradores ativos"
              sublabel={`estudaram nos últimos ${ACTIVE_WITHIN_DAYS} dias`}
            />
            <KpiCard
              icon={<BookOpenCheck className="h-5 w-5 text-purple-600" />}
              colorClass="bg-purple-50"
              value={kpis.completedLessons}
              label="Lições concluídas"
              sublabel="soma de toda a equipe"
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
              sublabel="colaboradores com ofensiva ativa"
            />
            <KpiCard
              icon={<Award className="h-5 w-5 text-indigo-600" />}
              colorClass="bg-indigo-50"
              value={kpis.avgAccuracy !== null ? pct(kpis.avgAccuracy) : '—'}
              label="Taxa média de acertos"
              sublabel="% geral de acerto das questões"
            />
            <KpiCard
              icon={<Gem className="h-5 w-5 text-cyan-600" />}
              colorClass="bg-cyan-50"
              value={kpis.totalXp}
              label="XP total da equipe"
              sublabel="soma de toda a equipe"
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
                      <SortHeader label="Taxa de acerto" sortKey="accuracy" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
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
                      <td className="px-4 py-3 text-slate-600">{row.avgScore !== null ? pct(row.avgScore) : '—'}</td>
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

          {/* C. Distribuição por Nível */}
          <div className="mb-8">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide text-slate-500">
              <BarChart3 className="h-4 w-4" />
              Distribuição por Nível
            </h2>
            <div className="space-y-2 rounded-2xl border-2 border-slate-100 bg-white p-4">
              {levelDistribution.map((row) => (
                <div key={row.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600">{row.title}</span>
                    <span className="font-extrabold text-slate-500">
                      {row.count} {row.count === 1 ? 'pessoa' : 'pessoas'}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: pct(row.share) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* D. Desempenho por Tema */}
          <div>
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wide text-slate-500">
              <Target className="h-4 w-4" />
              Desempenho por Tema
            </h2>
            {!isSupabaseConfigured ? (
              <p className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 text-xs font-bold text-slate-400">
                Esse gráfico usa dados reais de tentativas por pergunta — disponível só com o Supabase configurado
                (ver .env.local).
              </p>
            ) : topicPerformance.length === 0 ? (
              <p className="rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 text-xs font-bold text-slate-400">
                Ainda não há tentativas suficientes registradas pra calcular isso.
              </p>
            ) : (
              <div className="space-y-2 rounded-2xl border-2 border-slate-100 bg-white p-4">
                {topicPerformance.map((row) => (
                  <div key={row.topic}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-600">
                        {row.label} <span className="text-slate-400">· {row.total} tentativas</span>
                      </span>
                      <span
                        className={`font-extrabold ${row.accuracy < 0.6 ? 'text-rose-500' : row.accuracy < 0.8 ? 'text-amber-500' : 'text-emerald-500'}`}
                      >
                        {pct(row.accuracy)} de acerto
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${row.accuracy < 0.6 ? 'bg-rose-400' : row.accuracy < 0.8 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: pct(row.accuracy) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {showSubscription && <SubscriptionModal onClose={() => setShowSubscription(false)} />}
    </div>
  );
}
