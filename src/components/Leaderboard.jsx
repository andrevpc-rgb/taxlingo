// src/components/Leaderboard.jsx
import React, { useEffect, useState } from 'react';
import { Crown, Megaphone, Medal, Building2, Globe2, CalendarClock, Trophy } from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';
import { HIGHLIGHT_THRESHOLD } from '../data/mockData';

const PODIUM_STYLES = {
  1: { order: 'order-2', height: 'h-32', ring: 'ring-amber-400', badge: 'bg-amber-400', label: '1º' },
  2: { order: 'order-1', height: 'h-24', ring: 'ring-slate-300', badge: 'bg-slate-300', label: '2º' },
  3: { order: 'order-3', height: 'h-20', ring: 'ring-orange-400', badge: 'bg-orange-400', label: '3º' },
};

function PodiumSpot({ entry, isYou, subtitle, xpValue }) {
  const style = PODIUM_STYLES[entry.position];

  return (
    <div className={`flex flex-1 flex-col items-center ${style.order}`}>
      {entry.position === 1 && <Crown className="mb-1 h-5 w-5 fill-amber-400 text-amber-500 sm:h-6 sm:w-6" />}
      <div
        className={`flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-xl ring-4 sm:h-14 sm:w-14 sm:text-2xl ${style.ring}`}
      >
        <span aria-hidden="true">{entry.avatarUrl}</span>
      </div>
      <p className="mt-2 max-w-[5rem] truncate text-center text-[11px] font-extrabold text-slate-700 sm:max-w-[6.5rem] sm:text-xs">
        {entry.name}
        {isYou && <span className="text-emerald-500"> (você)</span>}
      </p>
      {subtitle && (
        <p className="max-w-[5rem] truncate text-center text-[9px] text-slate-400 sm:max-w-[6.5rem] sm:text-[10px]">
          {subtitle}
        </p>
      )}
      <p className="text-[10px] font-bold text-slate-400 sm:text-[11px]">{xpValue} XP</p>
      <div
        className={`mt-2 flex w-full items-end justify-center rounded-t-xl ${style.badge} ${style.height} pb-2`}
      >
        <span className="text-base font-black text-white drop-shadow sm:text-lg">{style.label}</span>
      </div>
    </div>
  );
}

function LeaderboardRow({ entry, isYou, subtitle, xpValue }) {
  const isHighlighted = entry.position <= HIGHLIGHT_THRESHOLD;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 ${
        isYou ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100 bg-white'
      }`}
    >
      <span className="w-6 text-center text-sm font-extrabold text-slate-400">{entry.position}</span>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg">
        <span aria-hidden="true">{entry.avatarUrl}</span>
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-slate-700">
          {entry.name}
          {isYou && <span className="text-emerald-500"> (você)</span>}
        </p>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
      {isHighlighted && <Medal className="h-4 w-4 text-amber-400" />}
      <span className="text-sm font-extrabold text-slate-600">{xpValue} XP</span>
    </div>
  );
}

export default function Leaderboard() {
  const [tab, setTab] = useState('company'); // 'company' | 'global'
  const [period, setPeriod] = useState('weekly'); // 'weekly' | 'alltime'
  const {
    user,
    currentCompany,
    companyLeaderboard,
    globalLeaderboard,
    weeklyCompanyLeaderboard,
    weeklyGlobalLeaderboard,
    companies,
    refreshLeaderboards,
  } = useGame();

  // Busca o XP mais recente dos colegas ao abrir a aba — o contexto só
  // refaz isso sozinho quando A PRÓPRIA sessão loga ou termina uma lição,
  // não quando outra pessoa da empresa progride enquanto você já estava
  // com o app aberto.
  useEffect(() => {
    refreshLeaderboards?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) return null;

  // Plano Corporativo de verdade (Starter/Pro, com limite de vagas real —
  // `maxUsers` só vem preenchido nesse caso; contas Individuais/Teste
  // Grátis são "empresas" de 1 pessoa só, com maxUsers null, e continuam
  // vendo o Ranking Geral normalmente). Privacidade B2B: colaborador de uma
  // empresa cliente não deve ver nem aparecer pra outras empresas.
  const isCorporatePlan = currentCompany?.maxUsers != null;
  const effectiveTab = isCorporatePlan ? 'company' : tab;

  const scoped = {
    company: { weekly: weeklyCompanyLeaderboard, alltime: companyLeaderboard },
    global: { weekly: weeklyGlobalLeaderboard, alltime: globalLeaderboard },
  };
  const entries = scoped[effectiveTab][period];
  const xpKey = period === 'weekly' ? 'weeklyXp' : 'xp';
  const sorted = [...entries].sort((a, b) => a.position - b.position);
  const podium = sorted.filter((entry) => entry.position <= 3);
  const rest = sorted.filter((entry) => entry.position > 3);

  const getSubtitle = (entry) => {
    const jobTitle = entry.jobTitle ?? '—';
    if (effectiveTab === 'company') return jobTitle;
    const companyName = companies.find((c) => c.id === entry.companyId)?.name ?? '—';
    return `${jobTitle} · ${companyName}`;
  };

  const you = sorted.find((entry) => entry.id === user.id);
  const youAreHighlighted = you && you.position <= HIGHLIGHT_THRESHOLD;

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:max-w-2xl">
      <h1 className="mb-1 text-xl font-extrabold text-slate-800">Ranking</h1>
      <p className="mb-4 text-sm text-slate-400">
        {period === 'weekly' ? 'XP acumulado nos últimos 7 dias. ' : 'Soma histórica de todo o XP já ganho. '}
        {effectiveTab === 'company'
          ? `Veja como você está em relação aos colegas de ${currentCompany?.name ?? 'sua empresa'}.`
          : 'Veja como você está em relação a todas as empresas do TaxLingo.'}
      </p>

      <div className="mb-2 flex gap-2 rounded-2xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setPeriod('weekly')}
          className={`flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-extrabold uppercase tracking-wide transition-colors sm:text-xs ${
            period === 'weekly' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'
          }`}
        >
          <CalendarClock className="h-4 w-4 shrink-0" />
          Ranking Semanal
        </button>
        <button
          type="button"
          onClick={() => setPeriod('alltime')}
          className={`flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-extrabold uppercase tracking-wide transition-colors sm:text-xs ${
            period === 'alltime' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'
          }`}
        >
          <Trophy className="h-4 w-4 shrink-0" />
          Ranking Geral
        </button>
      </div>

      {/* Plano Corporativo: sem opção de Ranking Geral entre empresas (privacidade
          B2B — ver isCorporatePlan acima) — só mostra o toggle pra quem tem
          escolha de verdade (Individual/Teste Grátis). */}
      {!isCorporatePlan && (
        <div className="mb-6 flex gap-2 rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setTab('company')}
            className={`flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-extrabold uppercase tracking-wide transition-colors sm:text-xs ${
              effectiveTab === 'company' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'
            }`}
          >
            <Building2 className="h-4 w-4 shrink-0" />
            Minha Empresa
          </button>
          <button
            type="button"
            onClick={() => setTab('global')}
            className={`flex min-h-[2.75rem] flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-extrabold uppercase tracking-wide transition-colors sm:text-xs ${
              effectiveTab === 'global' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'
            }`}
          >
            <Globe2 className="h-4 w-4" />
            Todas as Empresas
          </button>
        </div>
      )}

      {effectiveTab === 'company' && youAreHighlighted && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <Megaphone className="h-6 w-6 shrink-0 text-amber-500" />
          <p className="text-sm font-bold text-amber-700">
            Parabéns! Você está entre os {HIGHLIGHT_THRESHOLD} primeiros e vai ganhar{' '}
            <span className="underline">Destaque no Mural da Empresa</span> 🎉
          </p>
        </div>
      )}

      <div className="mb-8 flex items-end gap-2 rounded-2xl bg-slate-50 p-3 sm:gap-3 sm:p-4">
        {podium.map((entry) => (
          <PodiumSpot
            key={entry.id}
            entry={entry}
            isYou={entry.id === user.id}
            subtitle={getSubtitle(entry)}
            xpValue={entry[xpKey] ?? 0}
          />
        ))}
      </div>

      <div className="space-y-2">
        {rest.map((entry) => (
          <LeaderboardRow
            key={entry.id}
            entry={entry}
            isYou={entry.id === user.id}
            subtitle={getSubtitle(entry)}
            xpValue={entry[xpKey] ?? 0}
          />
        ))}
      </div>
    </div>
  );
}
