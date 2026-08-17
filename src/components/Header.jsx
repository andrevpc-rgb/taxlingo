// src/components/Header.jsx
import React, { useState } from 'react';
import { Heart, Flame, Gem, Diamond, Snowflake, ShieldCheck } from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';
import { STREAK_FREEZE_COST, MAX_STREAK_FREEZES } from '../data/mockData';
import UserProfile from './UserProfile';

function StatPill({ icon, value, colorClass, label }) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1 rounded-2xl border-2 px-2 py-1.5 font-extrabold sm:gap-1.5 sm:px-3 ${colorClass}`}
      aria-label={label}
      title={label}
    >
      {icon}
      <span className="text-xs tabular-nums sm:text-sm">{value}</span>
    </div>
  );
}

function StreakFreezePill() {
  const { user, buyStreakFreeze } = useGame();
  const atMax = user.streakFreezes >= MAX_STREAK_FREEZES;
  const canBuy = !atMax && user.gems >= STREAK_FREEZE_COST;

  return (
    <button
      type="button"
      onClick={buyStreakFreeze}
      disabled={!canBuy}
      title={
        atMax
          ? 'Você já tem o máximo de Congelamentos de Ofensiva'
          : `Comprar Congelamento de Ofensiva por ${STREAK_FREEZE_COST} gemas`
      }
      className={`flex min-h-[2.75rem] shrink-0 items-center gap-1 rounded-2xl border-2 px-2 py-1.5 font-extrabold transition-colors sm:gap-1.5 sm:px-3 ${
        canBuy
          ? 'border-sky-200 bg-sky-50 text-sky-600 hover:border-sky-300'
          : 'border-slate-200 bg-slate-50 text-slate-400'
      }`}
      aria-label="Congelamentos de Ofensiva disponíveis"
    >
      <Snowflake className="h-4 w-4 shrink-0 sm:h-5 sm:w-5" />
      <span className="text-xs tabular-nums sm:text-sm">{user.streakFreezes}</span>
      {!atMax && <span className="hidden text-[10px] font-bold uppercase tracking-wide sm:inline">+{STREAK_FREEZE_COST}💎</span>}
    </button>
  );
}

export default function Header() {
  const { user, isManager } = useGame();
  const [showProfile, setShowProfile] = useState(false);

  return (
    <header className="sticky top-0 z-20 overflow-hidden border-b-2 border-slate-200 bg-white">
      <div className="mx-auto flex max-w-md items-center gap-1.5 px-2 py-2.5 sm:max-w-2xl sm:gap-3 sm:px-4 sm:py-3 md:max-w-4xl">
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-lg font-black text-white sm:h-9 sm:w-9">
            T
          </div>
          <span className="hidden text-lg font-extrabold tracking-tight text-slate-700 sm:inline">
            TaxLingo
          </span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:gap-3">
          <StatPill
            icon={<Flame className="h-4 w-4 shrink-0 fill-orange-500 text-orange-500 sm:h-5 sm:w-5" />}
            value={user.streak}
            colorClass="border-orange-200 bg-orange-50 text-orange-600"
            label="Ofensiva (dias seguidos estudando)"
          />
          <StreakFreezePill />
          <StatPill
            icon={<Diamond className="h-4 w-4 shrink-0 fill-cyan-500 text-cyan-500 sm:h-5 sm:w-5" />}
            value={user.gems}
            colorClass="border-cyan-200 bg-cyan-50 text-cyan-600"
            label="Gemas"
          />
          <StatPill
            icon={<Gem className="h-4 w-4 shrink-0 fill-sky-500 text-sky-500 sm:h-5 sm:w-5" />}
            value={user.xp}
            colorClass="border-sky-200 bg-sky-50 text-sky-600"
            label="Pontos de XP"
          />
          <StatPill
            icon={<Heart className="h-4 w-4 shrink-0 fill-rose-500 text-rose-500 sm:h-5 sm:w-5" />}
            value={`${user.lives}/${user.maxLives}`}
            colorClass="border-rose-200 bg-rose-50 text-rose-600"
            label="Vidas restantes"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowProfile(true)}
          className="flex min-h-[2.75rem] shrink-0 items-center gap-2 rounded-full transition-opacity hover:opacity-80"
          aria-label="Abrir meu perfil"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base ring-2 ring-emerald-400 sm:h-9 sm:w-9 sm:text-lg">
            <span aria-hidden="true">{user.avatarUrl}</span>
          </div>
          <span className="hidden text-sm font-bold text-slate-600 md:inline">{user.name}</span>
          {isManager && (
            <span className="hidden items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-indigo-600 md:inline-flex">
              <ShieldCheck className="h-3 w-3" />
              {user.role === 'master' ? 'Master' : 'Gestor'}
            </span>
          )}
        </button>
      </div>

      {showProfile && <UserProfile onClose={() => setShowProfile(false)} />}
    </header>
  );
}
