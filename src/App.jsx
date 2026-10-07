// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
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
import ResetPasswordForm from './components/ResetPasswordForm';
import WhatsAppSupportButton from './components/WhatsAppSupportButton';
import NotificationModal from './components/NotificationModal';
import ChangelogModal from './components/ChangelogModal';
import { CURRENT_CHANGELOG_VERSION } from './data/changelog';

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

function LessonRow({ lesson, onStart, isHighlighted, highlightRef }) {
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
      ref={isHighlighted ? highlightRef : undefined}
      type="button"
      disabled={lesson.locked}
      onClick={() => onStart(lesson.id)}
      className={`flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors active:scale-[0.99] disabled:cursor-not-allowed disabled:active:scale-100 ${
        isHighlighted
          ? 'border-emerald-400 bg-emerald-50 ring-4 ring-emerald-200'
          : lesson.locked
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
      {isHighlighted && (
        <span className="shrink-0 rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">
          Continuar
        </span>
      )}
    </button>
  );
}

// Card recolhido de curso, usado só na lista de seleção (HomeScreen) — não
// mostra lições, só identifica o curso. Ver CourseScreen para a trilha aberta.
function CourseCard({ module, onSelect, isContinue }) {
  const Icon = MODULE_ICONS[module.icon] ?? BookOpen;
  const colorClasses = MODULE_COLOR_CLASSES[module.color] ?? 'bg-slate-100 text-slate-600';

  return (
    <button
      type="button"
      disabled={module.locked}
      onClick={onSelect}
      className={`w-full rounded-3xl border-2 p-5 text-left transition-colors active:scale-[0.99] disabled:cursor-not-allowed disabled:active:scale-100 ${
        module.locked
          ? 'border-slate-100 bg-slate-50 opacity-70'
          : isContinue
          ? 'border-emerald-400 bg-emerald-50 ring-4 ring-emerald-200'
          : 'border-slate-200 bg-white hover:border-emerald-300'
      }`}
    >
      <div className="flex items-start gap-3">
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
        {isContinue && (
          <span className="shrink-0 rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">
            Continuar
          </span>
        )}
      </div>

      {!module.locked ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${module.progress}%` }} />
        </div>
      ) : (
        <p className="mt-3 text-xs font-bold text-slate-300">Disponível em breve</p>
      )}
    </button>
  );
}

// Trilha aberta de um curso (lista de lições) — tela própria, acessada ao
// tocar num CourseCard na Home. Mesmo padrão visual de LeaderboardScreen/
// AdminDashboardScreen: botão "Voltar" + conteúdo.
function CourseScreen({ module, onBack, onStartLesson, highlightLessonId, highlightRef }) {
  const Icon = MODULE_ICONS[module.icon] ?? BookOpen;
  const colorClasses = MODULE_COLOR_CLASSES[module.color] ?? 'bg-slate-100 text-slate-600';

  return (
    <div className="pb-24">
      <div className="mx-auto max-w-md px-4 pt-4 pb-6 sm:max-w-2xl">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[2.75rem] items-center gap-1 text-sm font-bold text-slate-400 hover:text-slate-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>

        <div className="mb-4 mt-4 flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${colorClasses}`}>
            <Icon className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-extrabold text-slate-800">{module.title}</h2>
            <p className="text-xs font-medium text-slate-400">{module.description}</p>
          </div>
        </div>

        <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${module.progress}%` }} />
        </div>

        <div className="space-y-2">
          {module.lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              onStart={(lessonId) => onStartLesson(module.id, lessonId)}
              isHighlighted={lesson.id === highlightLessonId}
              highlightRef={highlightRef}
            />
          ))}
        </div>
      </div>
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

function HomeScreen({ onSelectCourse, onStartDailyReview, continueCourseId }) {
  const { modules, isModuleMastered } = useGame();

  return (
    <div className="mx-auto max-w-md px-4 py-6 pb-24 sm:max-w-2xl">
      <PacciMascot mood="happy" size="md" message="Ciao! Escolha uma trilha para continuar treinando comigo!" />
      <h1 className="mb-1 mt-6 text-xl font-extrabold text-slate-800">Trilhas de treinamento</h1>
      <p className="mb-6 text-sm text-slate-400">Escolha um curso para ver as lições.</p>

      {isModuleMastered && <LegendModeBanner onStartDailyReview={onStartDailyReview} />}

      <div className="space-y-4">
        {modules.map((module) => (
          <CourseCard
            key={module.id}
            module={module}
            onSelect={() => onSelectCourse(module.id)}
            isContinue={module.id === continueCourseId}
          />
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
          // 'course' (trilha aberta) conta como "Início" pro destaque do nav —
          // é uma sub-tela da lista de cursos, não uma aba própria.
          const isActive = view === item.id || (item.id === 'home' && view === 'course');
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex min-h-[3rem] min-w-[3.5rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] uppercase leading-tight tracking-wide transition-colors sm:px-6 sm:text-[11px] ${
                isActive ? 'font-black text-emerald-600' : 'font-bold text-slate-700 hover:text-slate-900'
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

// Acha a próxima lição não concluída e destravada DENTRO de um curso só —
// usada tanto por findContinueLesson (abaixo) quanto pra recalcular o
// destaque dentro da CourseScreen depois de concluir/sair de uma lição.
function findContinueLessonInModule(module) {
  if (!module || module.locked) return null;
  for (const lesson of module.lessons) {
    if (!lesson.locked && !lesson.completed) return lesson.id;
  }
  return null;
}

// Acha "onde o usuário parou" entre TODOS os cursos — qual curso e qual
// lição. Usada só pra decidir qual CourseCard ganha o selo "Continuar" na
// Home; abrir a lição em si continua exigindo que o usuário toque no curso
// (ver handleSelectCourse em AppShell — ninguém pula a tela de escolha).
function findContinueLesson(modules) {
  for (const module of modules) {
    const lessonId = findContinueLessonInModule(module);
    if (lessonId) return { moduleId: module.id, lessonId };
  }
  return null;
}

function AppShell() {
  // 'home' (lista de cursos) | 'course' (trilha de um curso) | 'quiz' | 'leaderboard' | 'admin'
  const [view, setView] = useState('home');
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const {
    isAuthenticated,
    isManager,
    passwordRecoveryMode,
    startLesson,
    startDailyReview,
    exitLesson,
    modules,
    moduleId: activeLessonCourseId, // curso da lição em andamento (state.moduleId) — só não-nulo durante o quiz
    refreshNotifications,
    user,
    updateProfile,
    pendingNotifications,
  } = useGame();

  // Popup "O que há de novo" — mostra quando a versão salva no perfil do
  // usuário (Supabase ou localStorage, conforme o modo) está desatualizada
  // em relação a CURRENT_CHANGELOG_VERSION. "Entendi" grava a versão atual
  // no perfil pra não incomodar de novo nos próximos logins. Só depois que a
  // fila de notificações de agradecimento esvaziar — os dois são modais de
  // tela cheia, mostrar os dois ao mesmo tempo empilharia um por cima do outro.
  const showChangelog =
    isAuthenticated &&
    Boolean(user) &&
    user.lastSeenChangelogVersion !== CURRENT_CHANGELOG_VERSION &&
    (pendingNotifications?.length ?? 0) === 0;
  const handleDismissChangelog = () => {
    updateProfile({ lastSeenChangelogVersion: CURRENT_CHANGELOG_VERSION });
  };

  // Toda vez que volta pra lista de cursos OU pra trilha de um curso (não só
  // no login), checa de novo se surgiu notificação nova ("Sua sugestão foi
  // aplicada!") — a sessão do Supabase Auth persiste por dias, então quem
  // fica logado sem nunca deslogar só veria o aviso ao sair da lição, não só
  // ao entrar no app. Sair de uma lição agora pode cair direto em 'course'
  // (ver handleExitQuiz), não só em 'home', então os dois contam.
  useEffect(() => {
    if (isAuthenticated && (view === 'home' || view === 'course')) {
      refreshNotifications();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, view]);

  // Ao entrar no app (login, cadastro ou sessão restaurada), descobre onde o
  // usuário parou — qual curso e qual lição — pra marcar o selo "Continuar"
  // no CourseCard certo na Home. Não pula direto pro curso/lição: o usuário
  // sempre escolhe o curso primeiro (ver handleSelectCourse). Dispara só uma
  // vez por sessão autenticada — o ref garante isso mesmo que `modules` mude
  // depois (ex.: ao concluir uma lição), e é resetado quando desloga, pra
  // disparar de novo no próximo login.
  const [continueTarget, setContinueTarget] = useState(null);
  const [highlightLessonId, setHighlightLessonId] = useState(null);
  const hasAutoContinuedRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) {
      hasAutoContinuedRef.current = false;
      setContinueTarget(null);
      return;
    }
    if (hasAutoContinuedRef.current) return;
    hasAutoContinuedRef.current = true;
    setContinueTarget(findContinueLesson(modules));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Ref-callback: assim que o card destacado é montado na tela, rola até ele
  // suavemente. Só é atribuído à lição que bate com highlightLessonId.
  const highlightRef = (node) => {
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Clicou no link do e-mail de "esqueci minha senha": mostra a tela de
  // definir senha nova antes de qualquer outra coisa, mesmo já "autenticado"
  // (a sessão de recuperação do Supabase Auth conta como logado).
  if (passwordRecoveryMode) {
    return <ResetPasswordForm />;
  }

  if (!isAuthenticated) {
    return <AuthModal />;
  }

  // Usuário tocou num CourseCard na Home: abre a trilha daquele curso. Se for
  // justamente o curso com "onde eu parei", já chega com a lição certa
  // destacada/rolada; senão abre sem nenhum destaque.
  const handleSelectCourse = (courseId) => {
    setSelectedCourseId(courseId);
    setHighlightLessonId(continueTarget?.moduleId === courseId ? continueTarget.lessonId : null);
    setView('course');
  };

  const handleStartLesson = (moduleId, lessonId) => {
    setHighlightLessonId(null);
    startLesson(moduleId, lessonId);
    setView('quiz');
  };

  const handleStartDailyReview = () => {
    startDailyReview();
    setView('quiz');
  };

  const handleExitQuiz = () => {
    const exitedCourseId = activeLessonCourseId; // precisa ser lido ANTES de exitLesson() zerar state.moduleId
    exitLesson();

    // `modules` já reflete o estado pós-conclusão nesse ponto (a lição
    // terminou/desbloqueou a próxima ANTES do usuário clicar em
    // "Continuar"/"Sair"), então recalcular aqui pega o destaque certo tanto
    // pro selo da Home quanto pra trilha que vamos reabrir a seguir.
    setContinueTarget(findContinueLesson(modules));

    if (!exitedCourseId) {
      setView('home');
      setHighlightLessonId(null);
      return;
    }
    // Volta direto pra trilha do curso que a lição pertencia, não pra lista
    // de cursos — sair de uma lição não deveria forçar escolher o curso de novo.
    setSelectedCourseId(exitedCourseId);
    setView('course');
    const course = modules.find((m) => m.id === exitedCourseId);
    setHighlightLessonId(findContinueLessonInModule(course));
  };

  const selectedCourse = modules.find((m) => m.id === selectedCourseId) ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <NotificationModal />
      {showChangelog && <ChangelogModal onDismiss={handleDismissChangelog} />}

      {view === 'home' && (
        <HomeScreen
          onSelectCourse={handleSelectCourse}
          onStartDailyReview={handleStartDailyReview}
          continueCourseId={continueTarget?.moduleId ?? null}
        />
      )}
      {view === 'course' && selectedCourse && (
        <CourseScreen
          module={selectedCourse}
          onBack={() => setView('home')}
          onStartLesson={handleStartLesson}
          highlightLessonId={highlightLessonId}
          highlightRef={highlightRef}
        />
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
      <WhatsAppSupportButton />
    </GameProvider>
  );
}
