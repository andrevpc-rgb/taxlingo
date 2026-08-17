// src/App.jsx
import React, { useState } from 'react';
import {
  Landmark,
  Calculator,
  FileSpreadsheet,
  Briefcase,
  Headset,
  Scale,
  Stamp,
  Lock,
  CheckCircle2,
  Play,
  BookOpen,
  Trophy,
  ArrowLeft,
  Crown,
  Sparkles,
  ClipboardCheck,
  LayoutDashboard,
} from 'lucide-react';
import { GameProvider, useGame } from './context/GameContext.jsx';
import Header from './components/Header';
import PacciMascot from './components/PacciMascot';
import QuizEngine from './components/QuizEngine';
import Leaderboard from './components/Leaderboard';
import AuthModal from './components/AuthModal';
import AdminDashboard from './components/AdminDashboard';

const MODULE_ICONS = {
  Landmark,
  Calculator,
  FileSpreadsheet,
  Briefcase,
  Headset,
  Scale,
  Stamp,
};

const MODULE_COLOR_CLASSES = {
  emerald: 'bg-emerald-100 text-emerald-600',
  blue: 'bg-blue-100 text-blue-600',
  amber: 'bg-amber-100 text-amber-600',
  purple: 'bg-purple-100 text-purple-600',
  sky: 'bg-sky-100 text-sky-600',
  rose: 'bg-rose-100 text-rose-600',
  indigo: 'bg-indigo-100 text-indigo-600',
};

function LessonRow({ lesson, onStart }) {
  const isExam = lesson.type === 'exam';
  const Icon = lesson.locked ? Lock : lesson.completed ? CheckCircle2 : isExam ? ClipboardCheck : Play;
  const iconColor = lesson.locked
    ? 'text-slate-300'
    : lesson.completed
    ? 'text-emerald-500'
    : isExam
    ? 'text-indigo-500'
    : 'text-sky-500';

  return (
    <button
      type="button"
      disabled={lesson.locked}
      onClick={() => onStart(lesson.id)}
      className={`flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors active:scale-[0.99] disabled:cursor-not-allowed disabled:active:scale-100 ${
        lesson.locked
          ? 'border-slate-100 bg-slate-50'
          : isExam
          ? 'border-indigo-200 bg-indigo-50 hover:border-indigo-300'
          : 'border-slate-200 bg-white hover:border-emerald-300'
      }`}
    >
      <Icon className={`h-6 w-6 shrink-0 ${iconColor}`} />
      <div className="flex-1">
        <p className={`text-sm font-extrabold ${lesson.locked ? 'text-slate-300' : 'text-slate-700'}`}>
          {lesson.title}
        </p>
        <p className={`text-xs font-bold ${lesson.locked ? 'text-slate-300' : 'text-slate-400'}`}>
          +{lesson.xpReward} XP
        </p>
      </div>
    </button>
  );
}

function ModuleCard({ module, onStartLesson }) {
  const Icon = MODULE_ICONS[module.icon] ?? BookOpen;
  const colorClasses = MODULE_COLOR_CLASSES[module.color] ?? 'bg-slate-100 text-slate-600';

  return (
    <div
      className={`rounded-3xl border-2 p-5 ${
        module.locked ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${colorClasses}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-extrabold text-slate-800">
            {module.title}
            {module.locked && <Lock className="ml-2 inline h-4 w-4 text-slate-300" />}
          </h3>
          <p className="text-xs font-medium text-slate-400">{module.description}</p>
        </div>
      </div>

      {!module.locked && (
        <>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${module.progress}%` }} />
          </div>
          <div className="space-y-2">
            {module.lessons.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} onStart={(lessonId) => onStartLesson(module.id, lessonId)} />
            ))}
          </div>
        </>
      )}

      {module.locked && <p className="text-xs font-bold text-slate-300">Disponível em breve</p>}
    </div>
  );
}

function LegendModeBanner({ onStartDailyReview }) {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
      <Crown className="h-8 w-8 shrink-0 fill-amber-400 text-amber-500" />
      <div className="flex-1">
        <p className="text-sm font-extrabold text-amber-700">Modo Lenda desbloqueado!</p>
        <p className="text-xs font-medium text-amber-600">
          Você concluiu as 270 lições. Faça a revisão diária para manter sua maestria em dia.
        </p>
      </div>
      <button
        type="button"
        onClick={onStartDailyReview}
        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white"
      >
        <Sparkles className="h-4 w-4" />
        Revisar
      </button>
    </div>
  );
}

function HomeScreen({ onStartLesson, onStartDailyReview }) {
  const { modules, isModuleMastered } = useGame();

  return (
    <div className="mx-auto max-w-md px-4 py-6 pb-24 sm:max-w-2xl">
      <PacciMascot
        mood="happy"
        size="md"
        message="Ciao! Pronto para dominar a Reforma Tributária comigo? Bora treinar!"
      />
      <h1 className="mb-1 mt-6 text-xl font-extrabold text-slate-800">Trilhas de treinamento</h1>
      <p className="mb-6 text-sm text-slate-400">Escolha uma lição para continuar sua jornada.</p>

      {isModuleMastered && <LegendModeBanner onStartDailyReview={onStartDailyReview} />}

      <div className="space-y-4">
        {modules.map((module) => (
          <ModuleCard key={module.id} module={module} onStartLesson={onStartLesson} />
        ))}
      </div>
    </div>
  );
}

function LeaderboardScreen({ onBack }) {
  return (
    <div className="pb-24">
      <div className="mx-auto max-w-md px-4 pt-4 sm:max-w-2xl">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[2.75rem] items-center gap-1 text-sm font-bold text-slate-400 hover:text-slate-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
      </div>
      <Leaderboard />
    </div>
  );
}

function AdminDashboardScreen({ onBack }) {
  return (
    <div className="pb-24">
      <div className="mx-auto max-w-md px-4 pt-4 md:max-w-4xl">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[2.75rem] items-center gap-1 text-sm font-bold text-slate-400 hover:text-slate-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
      </div>
      <AdminDashboard />
    </div>
  );
}

function BottomNav({ view, onNavigate, isManager }) {
  const items = [
    { id: 'home', label: 'Início', icon: BookOpen },
    { id: 'leaderboard', label: 'Ranking', icon: Trophy },
    ...(isManager ? [{ id: 'admin', label: 'Painel do Gestor', icon: LayoutDashboard }] : []),
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
      style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-md justify-around py-1 sm:max-w-2xl">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex min-h-[3rem] min-w-[3.5rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-extrabold uppercase leading-tight tracking-wide sm:px-6 sm:text-[11px] ${
                isActive ? 'text-emerald-500' : 'text-slate-300'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="text-center">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function AppShell() {
  // 'home' | 'quiz' | 'leaderboard' | 'admin'
  const [view, setView] = useState('home');
  const { isAuthenticated, isManager, startLesson, startDailyReview, exitLesson } = useGame();

  if (!isAuthenticated) {
    return <AuthModal />;
  }

  const handleStartLesson = (moduleId, lessonId) => {
    startLesson(moduleId, lessonId);
    setView('quiz');
  };

  const handleStartDailyReview = () => {
    startDailyReview();
    setView('quiz');
  };

  const handleExitQuiz = () => {
    exitLesson();
    setView('home');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      {view === 'home' && (
        <HomeScreen onStartLesson={handleStartLesson} onStartDailyReview={handleStartDailyReview} />
      )}
      {view === 'quiz' && <QuizEngine onExit={handleExitQuiz} />}
      {view === 'leaderboard' && <LeaderboardScreen onBack={() => setView('home')} />}
      {view === 'admin' && isManager && <AdminDashboardScreen onBack={() => setView('home')} />}

      {view !== 'quiz' && <BottomNav view={view} onNavigate={setView} isManager={isManager} />}
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <AppShell />
    </GameProvider>
  );
}
