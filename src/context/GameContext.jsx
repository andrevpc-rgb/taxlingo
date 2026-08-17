// src/context/GameContext.jsx
import React, { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  companies,
  seedUsers,
  getCompanyById,
  getCompanyByCode,
  computeLeaderboard,
  AVATAR_CHOICES,
  modules,
  questionBank,
  QUESTION_TYPES,
  LESSON_TYPES,
  CAREER_LEVELS,
  MODULE_IDS,
  EXAM_PASS_THRESHOLD,
  PERFECT_LESSONS_FOR_ACCELERATION,
  ACCELERATION_SKIP_COUNT,
  STREAK_FREEZE_COST,
  MAX_STREAK_FREEZES,
  DAILY_REVIEW_XP,
  getDailyReviewQuestions,
} from '../data/mockData';
import { isSupabaseConfigured } from '../lib/supabase';
import * as api from '../lib/api';

// ---------------------------------------------------------------------------
// Modo de dados: se VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY estiverem
// configurados (ver src/lib/supabase.js), autenticação, perfil e rankings
// passam a vir do Supabase de verdade. O motor de perguntas/progresso de
// lição continua rodando sobre o banco local (src/data/mockData.js) nos
// dois modos — persistindo os RESULTADOS (xp, exames, tempo de uso) de
// volta pro Supabase em segundo plano quando configurado. Migrar o
// carregamento das perguntas em si para streaming do Supabase é a extensão
// natural disso, mas exige testar contra um projeto real antes de trocar —
// não dá pra validar essa troca às cegas.
// ---------------------------------------------------------------------------

const XP_PER_CORRECT_ANSWER = 10;
const DAILY_REVIEW_LESSON_ID = 'daily-review';
const USERS_STORAGE_KEY = 'taxlingo_users';
const SESSION_STORAGE_KEY = 'taxlingo_session';

// ---------------------------------------------------------------------------
// checkAnswer: função pura que sabe validar cada um dos 5 tipos de questão.
// Fica fora do reducer para poder ser testada isoladamente.
// ---------------------------------------------------------------------------
function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function checkAnswer(question, userAnswer) {
  if (userAnswer === null || userAnswer === undefined) return false;

  switch (question.type) {
    case QUESTION_TYPES.MULTIPLE_CHOICE:
    case QUESTION_TYPES.FILL_BLANK:
      return normalize(userAnswer) === normalize(question.correctAnswer);

    case QUESTION_TYPES.TRUE_FALSE:
      return Boolean(userAnswer) === Boolean(question.correctAnswer);

    case QUESTION_TYPES.ORDERING: {
      const correctOrder = question.correctAnswer;
      if (!Array.isArray(userAnswer) || !Array.isArray(correctOrder)) return false;
      if (userAnswer.length !== correctOrder.length) return false;
      return userAnswer.every((item, i) => normalize(item) === normalize(correctOrder[i]));
    }

    // "Digitar Palavra" — resposta exata de texto, tratada como case-insensitive.
    case QUESTION_TYPES.TEXT_INPUT: {
      const accepted = question.acceptableAnswers?.length
        ? question.acceptableAnswers
        : [question.correctAnswer];
      return accepted.some((candidate) => normalize(candidate) === normalize(userAnswer));
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers de data — usados pela mecânica de Ofensiva (Streak).
// Datas são comparadas como strings 'YYYY-MM-DD' (sem fuso), o suficiente
// para um mock client-side.
// ---------------------------------------------------------------------------
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(`${dateStrA}T00:00:00`);
  const b = new Date(`${dateStrB}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

// Atualiza a ofensiva do usuário ao concluir qualquer lição hoje.
// - Mesmo dia já contabilizado: não mexe no contador.
// - 1 dia de intervalo (estudou ontem): ofensiva +1.
// - Mais de 1 dia de intervalo: consome 1 Congelamento de Ofensiva por dia
//   perdido, se houver suficientes; senão, a ofensiva reseta para 1.
// - `lastStudyDate` nulo (usuário novo, nunca estudou): começa a ofensiva em 1.
function applyDailyStreak(user) {
  const today = todayISO();
  if (!user.lastStudyDate) {
    return { ...user, streak: 1, lastStudyDate: today };
  }
  if (user.lastStudyDate === today) return user;

  const gap = daysBetween(user.lastStudyDate, today);

  if (gap === 1) {
    return { ...user, streak: user.streak + 1, lastStudyDate: today };
  }

  if (gap > 1) {
    const freezesNeeded = gap - 1;
    if (user.streakFreezes >= freezesNeeded) {
      return {
        ...user,
        streak: user.streak + 1,
        lastStudyDate: today,
        streakFreezes: user.streakFreezes - freezesNeeded,
      };
    }
    return { ...user, streak: 1, lastStudyDate: today };
  }

  return { ...user, lastStudyDate: today };
}

// ---------------------------------------------------------------------------
// Persistência local (mock de backend). Guarda a lista de usuários
// (seed + cadastrados) e o id do usuário com sessão ativa.
// ---------------------------------------------------------------------------
function loadUsersFromStorage() {
  try {
    const raw = window.localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // localStorage indisponível (modo privado, SSR etc.) — segue com o seed.
  }
  return seedUsers;
}

function saveUsersToStorage(users) {
  try {
    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch {
    // Sem persistência disponível — a sessão atual continua funcionando em memória.
  }
}

function loadSessionUserId() {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveSessionUserId(userId) {
  try {
    if (userId) window.localStorage.setItem(SESSION_STORAGE_KEY, userId);
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Sem persistência disponível — ignora silenciosamente.
  }
}

// ---------------------------------------------------------------------------
// Helpers de módulos/lições — todas retornam novas estruturas (imutável).
// ---------------------------------------------------------------------------
function cloneModules() {
  return JSON.parse(JSON.stringify(modules));
}

function findModule(modulesState, moduleId) {
  return modulesState.find((m) => m.id === moduleId) ?? null;
}

function findLessonIndex(module, lessonId) {
  return module ? module.lessons.findIndex((l) => l.id === lessonId) : -1;
}

function findLesson(modulesState, moduleId, lessonId) {
  const module = findModule(modulesState, moduleId);
  if (!module) return null;
  return module.lessons.find((l) => l.id === lessonId) ?? null;
}

function getNextLesson(modulesState, moduleId, lessonId) {
  const module = findModule(modulesState, moduleId);
  const idx = findLessonIndex(module, lessonId);
  if (idx === -1) return null;
  return module.lessons[idx + 1] ?? null;
}

function updateLessonInModules(modulesState, moduleId, lessonId, patch) {
  return modulesState.map((module) => {
    if (module.id !== moduleId) return module;
    const lessons = module.lessons.map((lesson) =>
      lesson.id === lessonId ? { ...lesson, ...patch } : lesson
    );
    const completedLessons = lessons.filter((l) => l.completed).length;
    return {
      ...module,
      lessons,
      completedLessons,
      progress: lessons.length > 0 ? Math.round((completedLessons / lessons.length) * 100) : 0,
    };
  });
}

function unlockNextLesson(modulesState, moduleId, lessonId) {
  const next = getNextLesson(modulesState, moduleId, lessonId);
  if (!next) return modulesState;
  return updateLessonInModules(modulesState, moduleId, next.id, { locked: false });
}

// Marca até `skipCount` lições seguintes como concluídas (sem passar pelo
// exame de transição — esse nunca é pulado) e destrava a lição após elas.
function skipAheadLessons(modulesState, moduleId, lessonId, skipCount) {
  const module = findModule(modulesState, moduleId);
  const idx = findLessonIndex(module, lessonId);
  if (idx === -1) return { modules: modulesState, skippedCount: 0 };

  let next = modulesState;
  let skipped = 0;
  for (let i = 1; i <= skipCount; i++) {
    const target = module.lessons[idx + i];
    if (!target || target.type === LESSON_TYPES.EXAM) break;
    next = updateLessonInModules(next, moduleId, target.id, { completed: true });
    skipped++;
  }

  const afterTarget = module.lessons[idx + skipped + 1];
  if (afterTarget) {
    next = updateLessonInModules(next, moduleId, afterTarget.id, { locked: false });
  }

  return { modules: next, skippedCount: skipped };
}

// Ao passar no Exame de Transição, destrava a primeira lição do próximo
// nível de carreira dentro do mesmo módulo (Reforma Tributária).
function getLevelIdFromLessonId(lessonId) {
  return CAREER_LEVELS.find((level) => lessonId.startsWith(`${level.id}-`))?.id ?? null;
}

function getNextLevelFirstLesson(moduleId, lessonId) {
  if (moduleId !== MODULE_IDS.REFORMA_TRIBUTARIA) return null;
  const levelIndex = CAREER_LEVELS.findIndex((level) => level.id === getLevelIdFromLessonId(lessonId));
  const nextLevel = CAREER_LEVELS[levelIndex + 1];
  if (!nextLevel) return null;
  return { moduleId, lessonId: `${nextLevel.id}-1` };
}

// Modo Supabase: contas do "Testar Grátis por 24 Horas" têm `trialExpiresAt`
// preenchido. Depois desse prazo, o acesso é derrubado automaticamente no
// próximo login/restauração de sessão (não precisa de um job em background
// pra "banir" a conta — é barato e suficiente checar na entrada).
function isTrialExpired(profile) {
  return Boolean(profile?.trialExpiresAt) && new Date(profile.trialExpiresAt) < new Date();
}

// Estimativa de tempo de estudo (mock: ~0.8min por questão, arredondado
// para cima, com um mínimo de 1 minuto) — usada para popular o "Tempo de
// Uso" do Painel do Gestor sem precisar cronometrar de verdade a sessão.
function estimateMinutesSpent(questionCount) {
  return Math.max(1, Math.round(questionCount * 0.8));
}

// Campos de estado do "motor de jogo" (lição/quiz em andamento) — os mesmos
// nos dois modos de dados, independente de onde usuário/rankings vêm.
function buildSharedGameState() {
  return {
    modules: cloneModules(),
    moduleId: null,
    lessonId: null,
    currentLessonType: null, // 'regular' | 'exam' | 'review'
    questions: [],
    questionIndex: 0,
    draftAnswer: null,
    isAnswered: false,
    isCorrect: null,
    sessionXp: 0,
    correctCount: 0,
    wrongCount: 0,
    combo: 0,
    lessonComplete: false,
    gameOver: false,
    pacciMood: 'neutral', // 'happy' | 'neutral' | 'hint' | 'sad'
    perfectLessonStreak: 0,
    accelerationAvailable: false,
    pendingAccelerationTest: false,
    accelerationResult: null, // { passed, skippedCount } | null
    examResult: null, // { passed, scorePct, requiredPct } | null
    isDailyReview: false,
  };
}

// ---------------------------------------------------------------------------
// Estado inicial.
// - Modo Supabase: começa deslogado + authLoading true; quem resolve a
//   sessão é o efeito que chama api.getCurrentSession() (assíncrono) — não
//   dá pra saber isso de forma síncrona, então evitamos "piscar" a tela de
//   login mostrando um loading até essa checagem responder.
// - Modo mock: sessão é lida de forma síncrona do localStorage, igual antes.
// ---------------------------------------------------------------------------
function buildInitialState() {
  const shared = {
    supabaseCompanyLeaderboard: null,
    supabaseGlobalLeaderboard: null,
    supabaseCompanies: [],
    ...buildSharedGameState(),
  };

  if (isSupabaseConfigured) {
    return {
      users: [],
      user: null,
      isAuthenticated: false,
      authLoading: true,
      authError: null,
      ...shared,
    };
  }

  const users = loadUsersFromStorage();
  const sessionUserId = loadSessionUserId();
  const sessionUser = sessionUserId ? users.find((u) => u.id === sessionUserId) ?? null : null;

  return {
    users,
    user: sessionUser,
    isAuthenticated: Boolean(sessionUser),
    authLoading: false,
    authError: null,
    ...shared,
  };
}

function startLessonState(state, moduleId, lessonId) {
  const lesson = findLesson(state.modules, moduleId, lessonId);
  const questions = questionBank[moduleId]?.[lessonId] ?? [];
  return {
    ...state,
    moduleId,
    lessonId,
    currentLessonType: lesson?.type ?? LESSON_TYPES.REGULAR,
    questions,
    questionIndex: 0,
    draftAnswer: null,
    isAnswered: false,
    isCorrect: null,
    sessionXp: 0,
    correctCount: 0,
    wrongCount: 0,
    combo: 0,
    lessonComplete: false,
    gameOver: state.user.lives <= 0,
    pacciMood: lesson?.type === LESSON_TYPES.EXAM ? 'hint' : 'neutral',
    accelerationResult: null,
    examResult: null,
    isDailyReview: false,
  };
}

// Núcleo do reducer. O wrapper `gameReducer` (mais abaixo) garante que
// qualquer alteração em `state.user` seja refletida também em `state.users`
// (a lista completa, persistida e usada pelos rankings).
function gameReducerCore(state, action) {
  switch (action.type) {
    case 'LOGIN': {
      const { email, password } = action.payload;
      const normalizedEmail = String(email ?? '').trim().toLowerCase();
      const found = state.users.find((u) => u.email.toLowerCase() === normalizedEmail);
      if (!found || found.password !== password) {
        return { ...state, authError: 'E-mail ou senha inválidos.' };
      }
      return {
        ...state,
        user: found,
        isAuthenticated: true,
        authError: null,
        modules: cloneModules(),
      };
    }

    case 'REGISTER': {
      const { name, email, password, companyCode, jobTitle } = action.payload;
      const normalizedEmail = String(email ?? '').trim().toLowerCase();

      if (!name?.trim() || !normalizedEmail || !password) {
        return { ...state, authError: 'Preencha nome, e-mail e senha.' };
      }
      if (state.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
        return { ...state, authError: 'Já existe uma conta com esse e-mail.' };
      }
      const company = getCompanyByCode(companyCode);
      if (!company) {
        return { ...state, authError: 'Código de empresa inválido. Confira com o seu RH.' };
      }

      const newUser = {
        id: `u-${Date.now()}`,
        name: name.trim(),
        email: normalizedEmail,
        password,
        companyId: company.id,
        role: 'employee',
        jobTitle: jobTitle?.trim() || null,
        avatarUrl: AVATAR_CHOICES[Math.floor(Math.random() * AVATAR_CHOICES.length)],
        xp: 0,
        level: 1,
        lives: 5,
        maxLives: 5,
        streak: 0,
        lastStudyDate: null,
        streakFreezes: 0,
        gems: 0,
        currentLevelId: CAREER_LEVELS[0]?.id ?? null,
        currentLevelSince: null,
        timeSpentMinutes: 0,
        examAttempts: [],
      };

      return {
        ...state,
        users: [...state.users, newUser],
        user: newUser,
        isAuthenticated: true,
        authError: null,
        modules: cloneModules(),
      };
    }

    case 'LOGOUT': {
      // Não reaproveita buildInitialState() aqui: ele releria a sessão do
      // localStorage, que neste ponto ainda não foi limpa pelo efeito de
      // persistência (que só roda depois do render) — reencontraria o
      // próprio usuário que está saindo. Monta o estado deslogado na mão.
      return {
        ...state,
        ...buildSharedGameState(),
        user: null,
        isAuthenticated: false,
        authError: null,
      };
    }

    case 'CLEAR_AUTH_ERROR': {
      return { ...state, authError: null, authLoading: false };
    }

    case 'UPDATE_PROFILE': {
      if (!state.user) return state;
      const { name, avatarUrl, newPassword, jobTitle } = action.payload;
      const patch = {};
      if (name?.trim()) patch.name = name.trim();
      if (avatarUrl) patch.avatarUrl = avatarUrl;
      if (newPassword) patch.password = newPassword;
      if (jobTitle !== undefined) patch.jobTitle = jobTitle?.trim() || null;
      return { ...state, user: { ...state.user, ...patch } };
    }

    // --- Ações do modo Supabase -------------------------------------------
    // (login/registro/logout locais continuam existindo acima para o modo
    // mock; estas são só usadas quando isSupabaseConfigured é true — ver os
    // callbacks do Provider mais abaixo.)
    case 'AUTH_LOADING': {
      return { ...state, authLoading: true, authError: null };
    }

    case 'AUTH_SUCCESS': {
      return {
        ...state,
        ...buildSharedGameState(),
        user: action.payload.user,
        isAuthenticated: true,
        authLoading: false,
        authError: null,
      };
    }

    case 'AUTH_ERROR': {
      return { ...state, authLoading: false, authError: action.payload };
    }

    case 'AUTH_SIGNED_OUT': {
      return {
        ...state,
        ...buildSharedGameState(),
        user: null,
        isAuthenticated: false,
        authLoading: false,
        authError: null,
      };
    }

    // Perfil atualizado com sucesso no Supabase — ao contrário de
    // AUTH_SUCCESS, NÃO reseta o motor de jogo (o usuário pode estar no
    // meio de uma lição quando edita nome/avatar/senha no perfil).
    case 'UPDATE_PROFILE_SUCCESS': {
      return { ...state, user: action.payload.user };
    }

    case 'SET_SUPABASE_LEADERBOARDS': {
      return {
        ...state,
        supabaseCompanyLeaderboard: action.payload.company,
        supabaseGlobalLeaderboard: action.payload.global,
      };
    }

    case 'SET_SUPABASE_COMPANIES': {
      return { ...state, supabaseCompanies: action.payload };
    }

    case 'START_LESSON': {
      if (!state.user) return state;
      const { moduleId, lessonId } = action.payload;
      return { ...startLessonState(state, moduleId, lessonId), pendingAccelerationTest: false };
    }

    case 'START_ACCELERATION_TEST': {
      if (!state.user) return state;
      const nextLesson = getNextLesson(state.modules, state.moduleId, state.lessonId);
      if (!nextLesson || nextLesson.type === LESSON_TYPES.EXAM) return state;
      return {
        ...startLessonState(state, state.moduleId, nextLesson.id),
        pendingAccelerationTest: true,
        accelerationAvailable: false,
      };
    }

    case 'DECLINE_ACCELERATION': {
      return { ...state, accelerationAvailable: false };
    }

    case 'START_DAILY_REVIEW': {
      if (!state.user) return state;
      return {
        ...state,
        moduleId: MODULE_IDS.REFORMA_TRIBUTARIA,
        lessonId: DAILY_REVIEW_LESSON_ID,
        currentLessonType: 'review',
        questions: getDailyReviewQuestions(),
        questionIndex: 0,
        draftAnswer: null,
        isAnswered: false,
        isCorrect: null,
        sessionXp: 0,
        correctCount: 0,
        wrongCount: 0,
        combo: 0,
        lessonComplete: false,
        gameOver: state.user.lives <= 0,
        pacciMood: 'neutral',
        isDailyReview: true,
        pendingAccelerationTest: false,
        accelerationResult: null,
        examResult: null,
      };
    }

    case 'SET_DRAFT_ANSWER': {
      if (state.isAnswered || state.gameOver) return state;
      return { ...state, draftAnswer: action.payload };
    }

    case 'REQUEST_HINT': {
      if (state.isAnswered) return state;
      return { ...state, pacciMood: 'hint' };
    }

    case 'CHECK_ANSWER': {
      if (!state.user || state.isAnswered || state.gameOver) return state;
      const question = state.questions[state.questionIndex];
      if (!question) return state;

      const isCorrect = checkAnswer(question, state.draftAnswer);
      const xpGain = isCorrect ? XP_PER_CORRECT_ANSWER : 0;
      // Exames de Transição avaliam por aproveitamento (%), não por vidas.
      const livesAreAtStake = state.currentLessonType !== LESSON_TYPES.EXAM;
      const nextLives =
        isCorrect || !livesAreAtStake ? state.user.lives : Math.max(0, state.user.lives - 1);

      return {
        ...state,
        isAnswered: true,
        isCorrect,
        sessionXp: state.sessionXp + xpGain,
        correctCount: state.correctCount + (isCorrect ? 1 : 0),
        wrongCount: state.wrongCount + (isCorrect ? 0 : 1),
        combo: isCorrect ? state.combo + 1 : 0,
        pacciMood: isCorrect ? 'happy' : 'sad',
        gameOver: livesAreAtStake && nextLives === 0,
        user: { ...state.user, xp: state.user.xp + xpGain, lives: nextLives },
      };
    }

    case 'NEXT_QUESTION': {
      if (!state.user || state.gameOver) return state;
      const isLastQuestion = state.questionIndex >= state.questions.length - 1;

      if (!isLastQuestion) {
        return {
          ...state,
          questionIndex: state.questionIndex + 1,
          draftAnswer: null,
          isAnswered: false,
          isCorrect: null,
          pacciMood: state.currentLessonType === LESSON_TYPES.EXAM ? 'hint' : 'neutral',
        };
      }

      const scorePct = state.questions.length > 0 ? state.correctCount / state.questions.length : 0;
      const wasPerfect = state.wrongCount === 0;

      // --- Lição de Manutenção/Revisão (modo Lenda) ---------------------
      if (state.isDailyReview) {
        const reviewMinutes = estimateMinutesSpent(state.questions.length);
        return {
          ...state,
          lessonComplete: true,
          isAnswered: false,
          isCorrect: null,
          draftAnswer: null,
          pacciMood: 'happy',
          sessionXp: state.sessionXp + DAILY_REVIEW_XP,
          user: applyDailyStreak({
            ...state.user,
            xp: state.user.xp + DAILY_REVIEW_XP,
            timeSpentMinutes: (state.user.timeSpentMinutes ?? 0) + reviewMinutes,
          }),
        };
      }

      // --- Exame de Transição de Nível -----------------------------------
      if (state.currentLessonType === LESSON_TYPES.EXAM) {
        const passed = scorePct >= EXAM_PASS_THRESHOLD;
        let nextModules = updateLessonInModules(state.modules, state.moduleId, state.lessonId, {
          completed: passed,
        });

        let nextLevelId = null;
        if (passed) {
          const nextLessonRef = getNextLevelFirstLesson(state.moduleId, state.lessonId);
          if (nextLessonRef) {
            nextModules = updateLessonInModules(nextModules, nextLessonRef.moduleId, nextLessonRef.lessonId, {
              locked: false,
            });
            nextLevelId = getLevelIdFromLessonId(nextLessonRef.lessonId);
          }
        }

        const examLesson = findLesson(state.modules, state.moduleId, state.lessonId);
        const bonusXp = passed ? examLesson?.xpReward ?? 0 : 0;
        const examMinutes = estimateMinutesSpent(state.questions.length);

        // Toda tentativa (aprovada ou não) fica registrada no histórico do
        // colaborador — é o que alimenta o Painel do Gestor.
        const attempt = {
          levelId: getLevelIdFromLessonId(state.lessonId),
          lessonId: state.lessonId,
          scorePct,
          passed,
          timestamp: new Date().toISOString(),
        };

        const userWithAttempt = {
          ...state.user,
          timeSpentMinutes: (state.user.timeSpentMinutes ?? 0) + examMinutes,
          examAttempts: [...(state.user.examAttempts ?? []), attempt],
          ...(nextLevelId
            ? { currentLevelId: nextLevelId, currentLevelSince: new Date().toISOString().slice(0, 10) }
            : {}),
        };

        return {
          ...state,
          modules: nextModules,
          lessonComplete: true,
          isAnswered: false,
          isCorrect: null,
          draftAnswer: null,
          pacciMood: passed ? 'happy' : 'sad',
          sessionXp: state.sessionXp + bonusXp,
          user: passed
            ? applyDailyStreak({ ...userWithAttempt, xp: userWithAttempt.xp + bonusXp })
            : userWithAttempt,
          examResult: { passed, scorePct, requiredPct: EXAM_PASS_THRESHOLD },
          perfectLessonStreak: 0,
          accelerationAvailable: false,
        };
      }

      // --- Lição regular (ou lição usada como Teste de Aceleração) -------
      const lesson = findLesson(state.modules, state.moduleId, state.lessonId);
      const bonusXp = lesson?.xpReward ?? 0;
      let nextModules = updateLessonInModules(state.modules, state.moduleId, state.lessonId, {
        completed: true,
      });
      let accelerationResult = null;

      if (state.pendingAccelerationTest) {
        const passed = scorePct >= EXAM_PASS_THRESHOLD;
        if (passed) {
          const skipped = skipAheadLessons(nextModules, state.moduleId, state.lessonId, ACCELERATION_SKIP_COUNT);
          nextModules = skipped.modules;
          accelerationResult = { passed: true, skippedCount: skipped.skippedCount };
        } else {
          nextModules = unlockNextLesson(nextModules, state.moduleId, state.lessonId);
          accelerationResult = { passed: false, skippedCount: 0 };
        }
      } else {
        nextModules = unlockNextLesson(nextModules, state.moduleId, state.lessonId);
      }

      const newPerfectStreak = wasPerfect ? state.perfectLessonStreak + 1 : 0;
      const nextLessonAvailable = Boolean(getNextLesson(nextModules, state.moduleId, state.lessonId));
      const accelerationAvailable =
        !state.pendingAccelerationTest &&
        newPerfectStreak >= PERFECT_LESSONS_FOR_ACCELERATION &&
        nextLessonAvailable;
      const lessonMinutes = estimateMinutesSpent(state.questions.length);

      return {
        ...state,
        modules: nextModules,
        lessonComplete: true,
        draftAnswer: null,
        isAnswered: false,
        isCorrect: null,
        pacciMood: 'happy',
        sessionXp: state.sessionXp + bonusXp,
        user: applyDailyStreak({
          ...state.user,
          xp: state.user.xp + bonusXp,
          timeSpentMinutes: (state.user.timeSpentMinutes ?? 0) + lessonMinutes,
        }),
        perfectLessonStreak: newPerfectStreak,
        accelerationAvailable,
        pendingAccelerationTest: false,
        accelerationResult,
      };
    }

    case 'RESTART_LESSON': {
      if (!state.user) return state;
      return { ...startLessonState(state, state.moduleId, state.lessonId), pendingAccelerationTest: false };
    }

    case 'REFILL_LIVES': {
      if (!state.user) return state;
      return {
        ...state,
        gameOver: false,
        user: { ...state.user, lives: state.user.maxLives },
      };
    }

    case 'BUY_STREAK_FREEZE': {
      if (!state.user) return state;
      if (state.user.gems < STREAK_FREEZE_COST) return state;
      if (state.user.streakFreezes >= MAX_STREAK_FREEZES) return state;
      return {
        ...state,
        user: {
          ...state.user,
          gems: state.user.gems - STREAK_FREEZE_COST,
          streakFreezes: state.user.streakFreezes + 1,
        },
      };
    }

    case 'EXIT_LESSON': {
      return {
        ...state,
        moduleId: null,
        lessonId: null,
        currentLessonType: null,
        questions: [],
        questionIndex: 0,
        draftAnswer: null,
        isAnswered: false,
        isCorrect: null,
        lessonComplete: false,
        pacciMood: 'neutral',
        pendingAccelerationTest: false,
        accelerationResult: null,
        examResult: null,
        isDailyReview: false,
      };
    }

    default:
      return state;
  }
}

// Envolve o reducer principal: sempre que `state.user` for alterado (login,
// XP ganho, troca de avatar, etc.), reflete a mesma alteração no registro
// correspondente dentro de `state.users` — é essa lista que é persistida no
// localStorage e usada para montar os rankings.
function gameReducer(state, action) {
  const nextState = gameReducerCore(state, action);
  if (nextState !== state && nextState.user && nextState.user !== state.user) {
    const users = nextState.users.map((u) => (u.id === nextState.user.id ? nextState.user : u));
    return { ...nextState, users };
  }
  return nextState;
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------
const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(gameReducer, undefined, buildInitialState);

  // Persiste a lista de usuários (seed + cadastrados + progresso) sempre
  // que ela mudar — só no modo mock (no modo Supabase, `state.users` fica
  // vazio; a persistência real é o próprio banco).
  useEffect(() => {
    if (isSupabaseConfigured) return;
    saveUsersToStorage(state.users);
  }, [state.users]);

  // Persiste apenas o id da sessão ativa (ou remove, se deslogado).
  useEffect(() => {
    if (isSupabaseConfigured) return;
    saveSessionUserId(state.isAuthenticated ? state.user?.id ?? null : null);
  }, [state.isAuthenticated, state.user?.id]);

  // Modo Supabase: ao montar, checa se já existe uma sessão válida (o
  // Supabase Auth já persiste isso sozinho em localStorage) e mantém em
  // sincronia com login/logout feitos em outra aba.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;

    (async () => {
      try {
        const session = await api.getCurrentSession();
        if (!active) return;
        if (session?.user) {
          const profile = await api.fetchProfile(session.user.id);
          if (isTrialExpired(profile)) {
            await api.signOut();
            dispatch({ type: 'AUTH_ERROR', payload: 'Seu teste grátis de 24h expirou. Peça o código da sua empresa pra continuar.' });
            return;
          }
          dispatch({ type: 'AUTH_SUCCESS', payload: { user: profile } });
        } else {
          dispatch({ type: 'AUTH_SIGNED_OUT' });
        }
      } catch (err) {
        if (active) dispatch({ type: 'AUTH_ERROR', payload: err.message });
      }
    })();

    const unsubscribe = api.onAuthStateChange((session) => {
      // login/registro já disparam AUTH_SUCCESS explicitamente com o perfil
      // buscado; este listener só cobre logout/expiração de token vindos de
      // fora (outra aba, sessão expirada).
      if (!session?.user) dispatch({ type: 'AUTH_SIGNED_OUT' });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Modo Supabase: busca os rankings (empresa + geral) sempre que o usuário
  // muda de sessão ou termina uma lição (o XP pode ter mudado).
  useEffect(() => {
    if (!isSupabaseConfigured || !state.user) return undefined;
    let active = true;

    (async () => {
      try {
        const [company, global, companiesList] = await Promise.all([
          api.fetchCompanyLeaderboard(state.user.companyId),
          api.fetchGlobalLeaderboard(),
          api.fetchCompanies(),
        ]);
        if (!active) return;
        dispatch({ type: 'SET_SUPABASE_LEADERBOARDS', payload: { company, global } });
        dispatch({ type: 'SET_SUPABASE_COMPANIES', payload: companiesList });
      } catch {
        // Ranking é informativo — uma falha aqui não deve travar o app.
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.user?.id, state.user?.companyId, state.lessonComplete]);

  // Modo Supabase: quando uma lição termina, persiste o resultado (xp,
  // streak, tempo de uso, tentativa de exame) de volta pro banco, em
  // segundo plano. O gameplay em si continua rodando no motor local — só o
  // RESULTADO é sincronizado aqui.
  const lastPersistedCompletionRef = useRef(null);
  useEffect(() => {
    if (!isSupabaseConfigured || !state.user || !state.lessonComplete) return;
    const completionKey = `${state.user.id}:${state.lessonId}:${state.sessionXp}`;
    if (lastPersistedCompletionRef.current === completionKey) return;
    lastPersistedCompletionRef.current = completionKey;

    (async () => {
      try {
        await api.updateProfile(state.user.id, {
          xp: state.user.xp,
          streak: state.user.streak,
          streakFreezes: state.user.streakFreezes,
          gems: state.user.gems,
          lastStudyDate: state.user.lastStudyDate,
          currentLevelId: state.user.currentLevelId,
          currentLevelSince: state.user.currentLevelSince,
          timeSpentMinutes: state.user.timeSpentMinutes,
        });
        if (!state.isDailyReview && state.lessonId) {
          await api.recordLessonProgress({
            userId: state.user.id,
            lessonId: state.lessonId,
            score: state.examResult?.scorePct ?? null,
            passed: state.examResult?.passed ?? null,
          });
        }
      } catch {
        // Best-effort: se a rede falhar aqui, o progresso local do usuário
        // não é perdido, só não fica sincronizado com o banco até a
        // próxima lição concluída com sucesso.
      }
    })();
  }, [state.lessonComplete, state.user, state.lessonId, state.sessionXp, state.isDailyReview, state.examResult]);

  const login = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) {
      dispatch({ type: 'LOGIN', payload: { email, password } });
      return;
    }
    dispatch({ type: 'AUTH_LOADING' });
    try {
      const { user: authUser } = await api.signIn(email, password);
      const profile = await api.fetchProfile(authUser.id);
      if (isTrialExpired(profile)) {
        await api.signOut();
        dispatch({ type: 'AUTH_ERROR', payload: 'Seu teste grátis de 24h expirou. Peça o código da sua empresa pra continuar.' });
        return;
      }
      dispatch({ type: 'AUTH_SUCCESS', payload: { user: profile } });
    } catch (err) {
      dispatch({ type: 'AUTH_ERROR', payload: err.message || 'Não foi possível entrar.' });
    }
  }, []);

  // Não usa AUTH_ERROR/state.authError aqui de propósito: esse campo é
  // exibido pelo LoginForm/RegisterForm, e um erro do teste grátis não tem
  // nada a ver com uma tentativa de login — apareceria duplicado nos dois
  // lugares. O componente lê o erro do valor de retorno em vez do contexto.
  const startFreeTrial = useCallback(async (email) => {
    if (!isSupabaseConfigured) {
      return { ok: false, error: 'O teste grátis por e-mail precisa do Supabase configurado (ver .env.local).' };
    }
    dispatch({ type: 'AUTH_LOADING' });
    try {
      await api.requestTrialAccess(email);
      dispatch({ type: 'CLEAR_AUTH_ERROR' });
      return { ok: true };
    } catch (err) {
      dispatch({ type: 'CLEAR_AUTH_ERROR' });
      return { ok: false, error: err.message || 'Não foi possível criar o acesso de teste.' };
    }
  }, []);

  const register = useCallback(async (payload) => {
    if (!isSupabaseConfigured) {
      dispatch({ type: 'REGISTER', payload });
      return;
    }
    dispatch({ type: 'AUTH_LOADING' });
    try {
      const { user: authUser } = await api.signUp({
        email: payload.email,
        password: payload.password,
        fullName: payload.name,
        jobTitle: payload.jobTitle,
        companyCode: payload.companyCode,
      });
      if (!authUser) {
        // Projeto com confirmação de e-mail ativada: não há sessão imediata.
        dispatch({ type: 'AUTH_ERROR', payload: 'Cadastro criado! Confirme seu e-mail para poder entrar.' });
        return;
      }
      const profile = await api.fetchProfile(authUser.id);
      dispatch({ type: 'AUTH_SUCCESS', payload: { user: profile } });
    } catch (err) {
      dispatch({ type: 'AUTH_ERROR', payload: err.message || 'Não foi possível cadastrar.' });
    }
  }, []);

  const logout = useCallback(async () => {
    if (!isSupabaseConfigured) {
      dispatch({ type: 'LOGOUT' });
      return;
    }
    try {
      await api.signOut();
    } finally {
      dispatch({ type: 'AUTH_SIGNED_OUT' });
    }
  }, []);

  const clearAuthError = useCallback(() => dispatch({ type: 'CLEAR_AUTH_ERROR' }), []);

  const updateProfile = useCallback(
    async (payload) => {
      if (!isSupabaseConfigured) {
        dispatch({ type: 'UPDATE_PROFILE', payload });
        return;
      }
      if (!state.user) return;
      try {
        if (payload.newPassword) {
          await api.updatePassword(payload.newPassword);
        }
        const { newPassword, ...profileFields } = payload;
        const updated = await api.updateProfile(state.user.id, profileFields);
        dispatch({ type: 'UPDATE_PROFILE_SUCCESS', payload: { user: updated } });
      } catch (err) {
        dispatch({ type: 'AUTH_ERROR', payload: err.message || 'Não foi possível atualizar o perfil.' });
      }
    },
    [state.user]
  );

  const startLesson = useCallback(
    (moduleId, lessonId) => dispatch({ type: 'START_LESSON', payload: { moduleId, lessonId } }),
    []
  );
  const startAccelerationTest = useCallback(() => dispatch({ type: 'START_ACCELERATION_TEST' }), []);
  const declineAcceleration = useCallback(() => dispatch({ type: 'DECLINE_ACCELERATION' }), []);
  const startDailyReview = useCallback(() => dispatch({ type: 'START_DAILY_REVIEW' }), []);
  const setDraftAnswer = useCallback((answer) => dispatch({ type: 'SET_DRAFT_ANSWER', payload: answer }), []);
  const requestHint = useCallback(() => dispatch({ type: 'REQUEST_HINT' }), []);
  const submitAnswer = useCallback(() => dispatch({ type: 'CHECK_ANSWER' }), []);
  const nextQuestion = useCallback(() => dispatch({ type: 'NEXT_QUESTION' }), []);
  const restartLesson = useCallback(() => dispatch({ type: 'RESTART_LESSON' }), []);
  const refillLives = useCallback(() => dispatch({ type: 'REFILL_LIVES' }), []);
  const buyStreakFreeze = useCallback(() => dispatch({ type: 'BUY_STREAK_FREEZE' }), []);
  const exitLesson = useCallback(() => dispatch({ type: 'EXIT_LESSON' }), []);

  const currentQuestion = state.questions[state.questionIndex] ?? null;
  const totalQuestions = state.questions.length;

  const currentCompany = useMemo(() => {
    if (!state.user) return null;
    if (isSupabaseConfigured) {
      return state.supabaseCompanies.find((c) => c.id === state.user.companyId) ?? null;
    }
    return getCompanyById(state.user.companyId);
  }, [state.user, state.supabaseCompanies]);

  const companyLeaderboard = useMemo(() => {
    if (isSupabaseConfigured) return computeLeaderboard(state.supabaseCompanyLeaderboard ?? []);
    if (!state.user) return [];
    return computeLeaderboard(state.users.filter((u) => u.companyId === state.user.companyId));
  }, [state.users, state.user?.companyId, state.supabaseCompanyLeaderboard]);

  const globalLeaderboard = useMemo(() => {
    if (isSupabaseConfigured) return computeLeaderboard(state.supabaseGlobalLeaderboard ?? []);
    return computeLeaderboard(state.users);
  }, [state.users, state.supabaseGlobalLeaderboard]);

  const activeCompanies = isSupabaseConfigured ? state.supabaseCompanies : companies;

  // Acesso ao Painel do Gestor é exclusivo de "admin" e "master".
  const isManager = state.user ? ['admin', 'master'].includes(state.user.role) : false;

  // Conta master (fundador/QA): todas as lições ficam permanentemente
  // desbloqueadas, sem depender de progresso real — não fabricamos 270
  // linhas falsas de "concluído", só ignoramos o trancamento na UI.
  const effectiveModules = useMemo(() => {
    if (state.user?.role !== 'master') return state.modules;
    return state.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({ ...lesson, locked: false })),
    }));
  }, [state.modules, state.user?.role]);

  // "Modo Lenda/Domínio": todas as lições (incl. exames) da Reforma
  // Tributária concluídas — libera a Lição de Manutenção/Revisão diária.
  const isModuleMastered = useMemo(() => {
    if (state.user?.role === 'master') return true;
    const module = state.modules.find((m) => m.id === MODULE_IDS.REFORMA_TRIBUTARIA);
    if (!module || module.lessons.length === 0) return false;
    return module.lessons.every((lesson) => lesson.completed);
  }, [state.modules, state.user?.role]);

  const value = useMemo(
    () => ({
      ...state,
      modules: effectiveModules,
      currentQuestion,
      totalQuestions,
      isModuleMastered,
      isManager,
      companies: activeCompanies,
      currentCompany,
      companyLeaderboard,
      globalLeaderboard,
      login,
      register,
      logout,
      startFreeTrial,
      clearAuthError,
      updateProfile,
      startLesson,
      startAccelerationTest,
      declineAcceleration,
      startDailyReview,
      setDraftAnswer,
      requestHint,
      submitAnswer,
      nextQuestion,
      restartLesson,
      refillLives,
      buyStreakFreeze,
      exitLesson,
    }),
    [
      state,
      effectiveModules,
      activeCompanies,
      currentQuestion,
      totalQuestions,
      isModuleMastered,
      isManager,
      currentCompany,
      companyLeaderboard,
      globalLeaderboard,
      login,
      register,
      logout,
      startFreeTrial,
      clearAuthError,
      updateProfile,
      startLesson,
      startAccelerationTest,
      declineAcceleration,
      startDailyReview,
      setDraftAnswer,
      requestHint,
      submitAnswer,
      nextQuestion,
      restartLesson,
      refillLives,
      buyStreakFreeze,
      exitLesson,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame deve ser usado dentro de um GameProvider');
  }
  return context;
}
