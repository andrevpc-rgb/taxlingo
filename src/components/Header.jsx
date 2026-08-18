// src/components/Header.jsx
import React, { useEffect, useState } from 'react';
import { Heart, Flame, Gem, Diamond, Snowflake, ShieldCheck, Clock, X, Volume2, VolumeX } from 'lucide-react';
import { useGame, getHeartRegenInfo } from '../context/GameContext.jsx';
import { STREAK_FREEZE_COST, MAX_STREAK_FREEZES, HEART_REFILL_ONE_COST, HEART_REFILL_FULL_COST } from '../data/mockData';
import { isSoundMuted, setSoundMuted } from '../utils/sound';
import UserProfile from './UserProfile';

function SoundToggle() {
  const [muted, setMuted] = useState(() => isSoundMuted());

  const toggle = () => {
    const next = !muted;
    setSoundMuted(next);
    setMuted(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 sm:h-9 sm:w-9"
      aria-label={muted ? 'Ativar efeitos sonoros' : 'Desativar efeitos sonoros'}
      title={muted ? 'Ativar efeitos sonoros' : 'Desativar efeitos sonoros'}
    >
      {muted ? <VolumeX className="h-4 w-4 sm:h-5 sm:w-5" /> : <Volume2 className="h-4 w-4 sm:h-5 sm:w-5" />}
    </button>
  );
}

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

function formatCountdown(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

function HeartsPill({ onOpen }) {
  const { user } = useGame();
  const [, setTick] = useState(0);

  // Só o suficiente pra manter o contador de "próxima vida em..." fresco
  // sem re-renderizar o app inteiro a cada segundo. Recarga total agora é
  // de só 10min, então um tick mais curto que antes (era 30s) evita o
  // contador da pill parecer "travado" por boa parte da espera.
  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  const { missing, msUntilNext } = getHeartRegenInfo(user);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[2.75rem] shrink-0 items-center gap-1 rounded-2xl border-2 border-rose-200 bg-rose-50 px-2 py-1.5 font-extrabold text-rose-600 transition-colors hover:border-rose-300 sm:gap-1.5 sm:px-3"
      aria-label="Vidas — toque para recarregar"
      title="Vidas — toque para recarregar"
    >
      <Heart className="h-4 w-4 shrink-0 fill-rose-500 text-rose-500 sm:h-5 sm:w-5" />
      <span className="text-xs tabular-nums sm:text-sm">
        {user.lives}/{user.maxLives}
      </span>
      {missing > 0 && msUntilNext !== null && (
        <span className="hidden items-center gap-0.5 text-[10px] font-bold text-rose-400 sm:inline-flex">
          <Clock className="h-3 w-3" />
          {formatCountdown(msUntilNext)}
        </span>
      )}
    </button>
  );
}

function HeartRefillModal({ onClose }) {
  const { user, buyHeartRefill } = useGame();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const { missing, msUntilNext } = getHeartRegenInfo(user);
  const canBuyOne = missing > 0 && user.gems >= HEART_REFILL_ONE_COST;
  const canBuyFull = missing > 0 && user.gems >= HEART_REFILL_FULL_COST;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="relative w-full max-w-sm rounded-3xl border-2 border-slate-200 bg-white p-6 text-center shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        <Heart className="mx-auto mb-2 h-10 w-10 fill-rose-500 text-rose-500" />
        <h2 className="text-lg font-extrabold text-slate-800">
          {user.lives}/{user.maxLives} vidas
        </h2>

        {missing > 0 && msUntilNext !== null ? (
          <p className="mt-1 flex items-center justify-center gap-1 text-sm font-bold text-slate-500">
            <Clock className="h-4 w-4" />
            Próxima vida em {formatCountdown(msUntilNext)}
          </p>
        ) : missing === 0 ? (
          <p className="mt-1 text-sm font-bold text-emerald-600">Vidas cheias! 🎉</p>
        ) : null}

        {missing > 0 && (
          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              disabled={!canBuyOne}
              onClick={() => buyHeartRefill('one')}
              className="w-full rounded-2xl bg-rose-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#be123c] transition-transform active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              Recarregar 1 vida — {HEART_REFILL_ONE_COST}💎
            </button>
            {missing > 1 && (
              <button
                type="button"
                disabled={!canBuyFull}
                onClick={() => buyHeartRefill('full')}
                className="w-full rounded-2xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-rose-600 transition-transform active:translate-y-0.5 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
              >
                Recarregar todas — {HEART_REFILL_FULL_COST}💎
              </button>
            )}
            <p className="text-xs font-medium text-slate-400">Você tem {user.gems}💎</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Header() {
  const { user, isManager } = useGame();
  const [showProfile, setShowProfile] = useState(false);
  const [showHeartRefill, setShowHeartRefill] = useState(false);

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
          <HeartsPill onOpen={() => setShowHeartRefill(true)} />
        </div>

        <SoundToggle />

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
      {showHeartRefill && <HeartRefillModal onClose={() => setShowHeartRefill(false)} />}
    </header>
  );
}
