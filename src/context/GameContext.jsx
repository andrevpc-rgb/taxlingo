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
  HEART_REGEN_MINUTES,
  HEART_REFILL_ONE_COST,
  HEART_REFILL_FULL_COST,
  INITIAL_GEMS,
  PERFECT_LESSON_GEMS,
  LESSON_COMPLETE_GEMS,
  LEVEL_UP_CHEST_GEMS,
  STREAK_BONUS_GEMS,
  STREAK_BONUS_INTERVAL_DAYS,
  REPEAT_LESSON_XP,
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
const ACCESS_EXPIRED_MESSAGE =
  'Seu acesso expirou. Se você tem o Plano Individual, ele renova sozinho no próximo pagamento; se é colaborador de uma empresa, peça ao RH pra renovar o plano corporativo.';

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

    // Normalmente só existe UMA ordem certa (`correctAnswer`) — mas algumas
    // perguntas têm dois itens intercambiáveis entre si (ex.: IBS e CBS têm a
    // mesma abrangência, só o 3º item — Imposto Seletivo — é estritamente
    // depois). `acceptableOrders`, se vier preenchido, lista TODAS as ordens
    // válidas (correctAnswer entra nessa lista implicitamente, não precisa
    // repetir); sem esse campo, só `correctAnswer` é aceito, como antes.
    case QUESTION_TYPES.ORDERING: {
      if (!Array.isArray(userAnswer)) return false;
      const candidateOrders = [question.correctAnswer, ...(question.acceptableOrders ?? [])];
      return candidateOrders.some((order) => {
        if (!Array.isArray(order) || userAnswer.length !== order.length) return false;
        return userAnswer.every((item, i) => normalize(item) === normalize(order[i]));
      });
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
// Embaralha as alternativas de múltipla escolha antes de exibir — no banco
// de questões (src/data/questions/*.json), a opção certa é sempre a
// primeira do array. checkAnswer() compara por VALOR (normalize(userAnswer)
// === normalize(question.correctAnswer)), não por índice, então só
// reordenar `options` já basta: não precisa "ajustar" correctAnswer, ele
// continua sendo o mesmo texto, só que agora em outra posição no array.
// Chamado uma vez ao montar a fila da lição (startLessonState/START_DAILY_REVIEW)
// — não a cada render, senão as opções trocariam de lugar debaixo do dedo
// do usuário a cada re-render.
function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function withShuffledOptions(question) {
  if (question.type !== QUESTION_TYPES.MULTIPLE_CHOICE || !Array.isArray(question.options)) return question;
  return { ...question, options: shuffleArray(question.options) };
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
//
// Devolve `{ user, streakBonusGems }` em vez de só o usuário: a cada
// STREAK_BONUS_INTERVAL_DAYS dias seguidos (7, 14, 21...) a ofensiva rende
// STREAK_BONUS_GEMS de bônus — como isso só acontece quando a ofensiva
// efetivamente incrementa (nunca no reset pra 1, nem no "mesmo dia"), dá pra
// detectar o marco olhando só o streak NOVO sem precisar comparar com o
// antigo. `streakBonusGems` é devolvido à parte pra quem chamar poder
// mostrar esse bônus separado do resto na tela (ver QuizEngine.jsx).
function applyDailyStreak(user) {
  const today = todayISO();
  const withStreakBonus = (nextUser, newStreak) => {
    const bonus = newStreak > 0 && newStreak % STREAK_BONUS_INTERVAL_DAYS === 0 ? STREAK_BONUS_GEMS : 0;
    return { user: bonus ? { ...nextUser, gems: nextUser.gems + bonus } : nextUser, streakBonusGems: bonus };
  };

  if (!user.lastStudyDate) {
    return withStreakBonus({ ...user, streak: 1, lastStudyDate: today }, 1);
  }
  if (user.lastStudyDate === today) return { user, streakBonusGems: 0 };

  const gap = daysBetween(user.lastStudyDate, today);

  if (gap === 1) {
    const newStreak = user.streak + 1;
    return withStreakBonus({ ...user, streak: newStreak, lastStudyDate: today }, newStreak);
  }

  if (gap > 1) {
    const freezesNeeded = gap - 1;
    if (user.streakFreezes >= freezesNeeded) {
      const newStreak = user.streak + 1;
      return withStreakBonus(
        {
          ...user,
          streak: newStreak,
          lastStudyDate: today,
          streakFreezes: user.streakFreezes - freezesNeeded,
        },
        newStreak
      );
    }
    return { user: { ...user, streak: 1, lastStudyDate: today }, streakBonusGems: 0 };
  }

  return { user: { ...user, lastStudyDate: today }, streakBonusGems: 0 };
}

// ---------------------------------------------------------------------------
// Ranking Semanal — XP acumulado só na semana corrente (segunda a domingo),
// "resetando" virtualmente a cada nova semana: `weekStart` guarda a
// segunda-feira da semana em que `weeklyXp` está sendo contado; ao virar a
// semana, o próximo ganho de XP começa a contagem do zero de novo.
// ---------------------------------------------------------------------------
function getWeekStartISO(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = domingo .. 6 = sábado
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

// Devolve só o PATCH (não o usuário inteiro) pra poder ser espalhado junto
// com outras alterações no mesmo objeto de usuário: `{ ...user, ...addXp(user, 10), ... }`.
// Usado em todo lugar que soma (ou subtrai, no caso de reversão por Game
// Over) XP — é o único ponto que sabe manter `xp` e `weeklyXp` em sincronia.
function addXp(user, amount) {
  if (!amount) return {};
  const weekStart = getWeekStartISO();
  const sameWeek = user.weekStart === weekStart;
  return {
    xp: user.xp + amount,
    weeklyXp: Math.max(0, (sameWeek ? user.weeklyXp ?? 0 : 0) + amount),
    weekStart,
  };
}

// ---------------------------------------------------------------------------
// Recarga de vidas por tempo. Cada coração perdido leva HEART_REGEN_MINUTES
// para recarregar sozinho — `lastHeartLostAt` marca o início da contagem do
// PRÓXIMO coração a regenerar (não é resetado a cada nova vida perdida
// enquanto já houver uma contagem em andamento, senão o usuário nunca
// recuperaria vida tomando erros seguidos). Funciona com o navegador
// fechado porque o cálculo é sempre feito a partir do timestamp salvo, não
// de um timer rodando em memória.
// ---------------------------------------------------------------------------
const HEART_REGEN_MS = HEART_REGEN_MINUTES * 60 * 1000;

function applyHeartRegen(user) {
  if (!user || user.lives >= user.maxLives || !user.lastHeartLostAt) return user;

  const lostAt = new Date(user.lastHeartLostAt).getTime();
  const elapsed = Date.now() - lostAt;
  const regenerated = Math.floor(elapsed / HEART_REGEN_MS);
  if (regenerated <= 0) return user;

  const newLives = Math.min(user.maxLives, user.lives + regenerated);
  const isFull = newLives >= user.maxLives;
  return {
    ...user,
    lives: newLives,
    lastHeartLostAt: isFull ? null : new Date(lostAt + regenerated * HEART_REGEN_MS).toISOString(),
  };
}

// Pura e sem efeitos colaterais — usada pela UI (Header/QuizEngine) pra
// mostrar "faltam Xh Ymin pro próximo coração" sem precisar ficar
// dispatchando ações a cada tick; o componente que exibe o contador é quem
// decide de quanto em quanto tempo re-renderizar.
export function getHeartRegenInfo(user) {
  if (!user) return { missing: 0, msUntilNext: 0 };
  const missing = Math.max(0, user.maxLives - user.lives);
  // Sem `lastHeartLostAt` não há relógio rodando pra essa vida faltante
  // (ex.: dado de demonstração antigo) — não dá pra mostrar uma contagem
  // regressiva sem um ponto de partida real.
  if (missing <= 0 || !user.lastHeartLostAt) return { missing, msUntilNext: null };
  const elapsed = Date.now() - new Date(user.lastHeartLostAt).getTime();
  const msUntilNext = Math.max(0, HEART_REGEN_MS - elapsed);
  return { missing, msUntilNext };
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

// Reconstrói o lock/completed dos módulos a partir do progresso salvo no
// Supabase (public.user_progress) — sem isso, todo login recomeçava do
// zero (cloneModules() sempre volta ao estado seed, só a 1ª lição
// destravada), mesmo com lições já concluídas no banco. Espelha exatamente
// a mesma lógica de destravamento usada ao vivo em NEXT_QUESTION: lição
// regular destrava só a próxima dentro do módulo; exame aprovado destrava a
// 1ª lição do próximo nível de carreira (getNextLevelFirstLesson) quando
// existir, senão segue o próximo item do módulo como qualquer outra lição.
function applyProgressToModules(modulesState, progressRows) {
  if (!progressRows || progressRows.length === 0) return modulesState;

  const completedLessonIds = new Set();
  const passedExamIds = new Set();
  for (const row of progressRows) {
    if (row.passed === true) passedExamIds.add(row.lessonId);
    else if (row.passed === null) completedLessonIds.add(row.lessonId);
  }

  let next = modulesState;

  for (const lessonId of completedLessonIds) {
    const module = next.find((m) => m.lessons.some((l) => l.id === lessonId));
    if (!module) continue;
    next = updateLessonInModules(next, module.id, lessonId, { completed: true });
    next = unlockNextLesson(next, module.id, lessonId);
  }

  for (const lessonId of passedExamIds) {
    const module = next.find((m) => m.lessons.some((l) => l.id === lessonId));
    if (!module) continue;
    next = updateLessonInModules(next, module.id, lessonId, { completed: true });
    const nextLevelLesson = getNextLevelFirstLesson(module.id, lessonId);
    next = nextLevelLesson
      ? updateLessonInModules(next, nextLevelLesson.moduleId, nextLevelLesson.lessonId, { locked: false })
      : unlockNextLesson(next, module.id, lessonId);
  }

  return next;
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

// Checa se o acesso do usuário venceu — dois motivos possíveis, os dois
// derrubados automaticamente no próximo login/restauração de sessão (não
// precisa de um job em background pra "banir" a conta, é barato e
// suficiente checar na entrada):
// - `trialExpiresAt`: contas com acesso por prazo pessoal — "Testar Grátis
//   por 24 Horas" ou Plano Individual comprado pelo link do Asaas (nesse
//   caso renovado a cada pagamento mensal, ver asaas-webhook).
// - `companyExpiresAt`: colaborador de uma empresa Corporativa cujo plano
//   venceu (ver companies.expires_at / check_company_capacity() no schema).
// A conta master (fundador) nunca é derrubada por isso — é a conta de
// contingência, precisa sempre conseguir entrar.
function isAccessExpired(profile) {
  if (profile?.role === 'master') return false;
  const trialExpired = Boolean(profile?.trialExpiresAt) && new Date(profile.trialExpiresAt) < new Date();
  const companyExpired = Boolean(profile?.companyExpiresAt) && new Date(profile.companyExpiresAt) < new Date();
  return trialExpired || companyExpired;
}

// Estimativa de tempo de estudo (mock: ~0.8min por questão, arredondado
// para cima, com um mínimo de 1 minuto) — usada para popular o "Tempo de
// Uso" do Painel do Gestor sem precisar cronometrar de verdade a sessão.
function estimateMinutesSpent(questionCount) {
  return Math.max(1, Math.round(questionCount * 0.8));
}

// Busca o progresso salvo no Supabase pra reconstruir o lock/completed dos
// módulos (ver applyProgressToModules) — best-effort: se a rede falhar
// aqui, o login ainda funciona, só que sem lembrar de onde o usuário parou
// até o próximo login com sucesso (mesma filosofia do efeito que persiste
// resultado de lição, mais abaixo).
async function loadProgressSafely(userId) {
  try {
    return await api.fetchUserProgress(userId);
  } catch {
    return [];
  }
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
    queue: [], // fila da sessão atual — erros voltam pro final até acertar tudo
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
    lastLessonScorePct: null, // % de acerto (0-1) da última lição concluída, regular ou exame — ver GameContext.jsx CHECK_ANSWER/NEXT_QUESTION
    isDailyReview: false,
    justPromotedLevelId: null, // id do próximo nível de carreira, só quando o exame acabou de destravá-lo (som de promoção)
    lessonGemsEarned: 0, // gemas ganhas ao concluir a lição/exame que acabou de terminar (0 até terminar uma)
    streakBonusGems: 0, // bônus de gemas por marco de ofensiva (a cada 7 dias), só no momento em que é concedido
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
      passwordRecoveryMode: false,
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
    passwordRecoveryMode: false,
    ...shared,
  };
}

function startLessonState(state, moduleId, lessonId) {
  const user = applyHeartRegen(state.user);
  const lesson = findLesson(state.modules, moduleId, lessonId);
  const questions = (questionBank[moduleId]?.[lessonId] ?? []).map(withShuffledOptions);
  return {
    ...state,
    user,
    moduleId,
    lessonId,
    currentLessonType: lesson?.type ?? LESSON_TYPES.REGULAR,
    questions,
    queue: [...questions],
    draftAnswer: null,
    isAnswered: false,
    isCorrect: null,
    sessionXp: 0,
    correctCount: 0,
    wrongCount: 0,
    combo: 0,
    lessonComplete: false,
    gameOver: user.lives <= 0,
    pacciMood: lesson?.type === LESSON_TYPES.EXAM ? 'hint' : 'neutral',
    accelerationResult: null,
    examResult: null,
    lastLessonScorePct: null,
    isDailyReview: false,
    justPromotedLevelId: null,
    lessonGemsEarned: 0,
    streakBonusGems: 0,
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
      // Herda o vencimento da empresa (Plano Corporativo) — master nunca é
      // barrado por isso, é a conta de contingência.
      if (found.role !== 'master') {
        const foundCompany = getCompanyById(found.companyId);
        if (foundCompany?.expiresAt && new Date(foundCompany.expiresAt) < new Date()) {
          return { ...state, authError: ACCESS_EXPIRED_MESSAGE };
        }
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
      if (company.expiresAt && new Date(company.expiresAt) < new Date()) {
        return { ...state, authError: 'O plano desta empresa está vencido. Peça ao RH para renovar.' };
      }
      if (company.maxUsers != null) {
        const currentCount = state.users.filter((u) => u.companyId === company.id).length;
        if (currentCount >= company.maxUsers) {
          return { ...state, authError: 'Limite de vagas da empresa atingido. Peça ao RH para ampliar o plano.' };
        }
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
        lastHeartLostAt: null,
        streak: 0,
        lastStudyDate: null,
        streakFreezes: 0,
        gems: INITIAL_GEMS,
        weeklyXp: 0,
        weekStart: null,
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
      const shared = buildSharedGameState();
      return {
        ...state,
        ...shared,
        modules: applyProgressToModules(shared.modules, action.payload.progress),
        user: action.payload.user,
        isAuthenticated: true,
        authLoading: false,
        authError: null,
        passwordRecoveryMode: false,
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
        passwordRecoveryMode: false,
      };
    }

    // O clique no link do e-mail de redefinição de senha loga o usuário
    // numa sessão especial de "recuperação" (evento PASSWORD_RECOVERY do
    // Supabase Auth) — em vez de cair direto no app, ele precisa passar
    // pela tela de "defina uma senha nova" primeiro. Ver ResetPasswordForm.
    case 'PASSWORD_RECOVERY_MODE': {
      return { ...state, passwordRecoveryMode: true, authLoading: false, authError: null };
    }

    case 'PASSWORD_RESET_COMPLETE': {
      return { ...state, passwordRecoveryMode: false };
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
      const user = applyHeartRegen(state.user);
      const reviewQuestions = getDailyReviewQuestions().map(withShuffledOptions);
      return {
        ...state,
        user,
        moduleId: MODULE_IDS.REFORMA_TRIBUTARIA,
        lessonId: DAILY_REVIEW_LESSON_ID,
        currentLessonType: 'review',
        questions: reviewQuestions,
        queue: [...reviewQuestions],
        draftAnswer: null,
        isAnswered: false,
        isCorrect: null,
        sessionXp: 0,
        correctCount: 0,
        wrongCount: 0,
        combo: 0,
        lessonComplete: false,
        gameOver: user.lives <= 0,
        pacciMood: 'neutral',
        isDailyReview: true,
        pendingAccelerationTest: false,
        accelerationResult: null,
        examResult: null,
        lastLessonScorePct: null,
        justPromotedLevelId: null,
        lessonGemsEarned: 0,
        streakBonusGems: 0,
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
      const question = state.queue[0];
      if (!question) return state;

      const isCorrect = checkAnswer(question, state.draftAnswer);
      const xpGain = isCorrect ? XP_PER_CORRECT_ANSWER : 0;
      // Exames de Transição avaliam por aproveitamento (%), não por vidas.
      const livesAreAtStake = state.currentLessonType !== LESSON_TYPES.EXAM;
      const nextLives =
        isCorrect || !livesAreAtStake ? state.user.lives : Math.max(0, state.user.lives - 1);
      const lostAHeart = nextLives < state.user.lives;

      // Repare que `gameOver` NÃO é setado aqui mesmo que as vidas zerem: o
      // usuário ainda precisa ver o feedback (resposta certa, explicação,
      // dica do Pacci) da pergunta fatal antes de cair na tela de "sem
      // vidas" — isso só acontece quando ele toca em "Continuar" e o
      // NEXT_QUESTION detecta `lives <= 0`.
      return {
        ...state,
        isAnswered: true,
        isCorrect,
        sessionXp: state.sessionXp + xpGain,
        correctCount: state.correctCount + (isCorrect ? 1 : 0),
        wrongCount: state.wrongCount + (isCorrect ? 0 : 1),
        combo: isCorrect ? state.combo + 1 : 0,
        pacciMood: isCorrect ? 'happy' : 'sad',
        user: {
          ...state.user,
          ...addXp(state.user, xpGain),
          lives: nextLives,
          // Só marca o início da contagem se não houver uma já em andamento
          // (senão, tomar vários erros seguidos ficaria empurrando o
          // relógio pra sempre e o coração nunca recarregaria).
          lastHeartLostAt: lostAHeart && !state.user.lastHeartLostAt ? new Date().toISOString() : state.user.lastHeartLostAt,
        },
      };
    }

    case 'NEXT_QUESTION': {
      if (!state.user) return state;
      if (state.gameOver) return state;

      // Vidas zeradas: a lição termina imediatamente ao avançar — o
      // usuário já viu o feedback (resposta certa, explicação, dica) da
      // pergunta fatal na tela anterior; aqui só transiciona pra "sem
      // vidas". Nenhum progresso na trilha é concedido, e o XP ganho
      // nesta tentativa (creditado pergunta a pergunta em CHECK_ANSWER) é
      // devolvido, já que a lição não foi concluída.
      if (state.user.lives <= 0) {
        // Mesmo numa lição não concluída, o dia conta como "estudado" pra
        // ofensiva (e pode bater um marco de 7 dias) — só não há gema de
        // lição nenhuma, já que ela não foi finalizada.
        const { user: streakedUser, streakBonusGems } = applyDailyStreak({
          ...state.user,
          ...addXp(state.user, -state.sessionXp),
        });
        return {
          ...state,
          gameOver: true,
          sessionXp: 0,
          user: streakedUser,
          lessonGemsEarned: 0,
          streakBonusGems,
          perfectLessonStreak: 0,
          accelerationAvailable: false,
          pendingAccelerationTest: false,
          accelerationResult: null,
        };
      }

      const isExam = state.currentLessonType === LESSON_TYPES.EXAM;
      const justAnswered = state.queue[0];
      // Exame nunca reencaminha (cada questão vale só a resposta de
      // primeira tentativa, pro cálculo de aproveitamento continuar
      // fazendo sentido); lição regular e revisão diária reencaminham
      // toda resposta errada pro final da fila até acertar tudo.
      const newQueue =
        isExam || state.isCorrect ? state.queue.slice(1) : [...state.queue.slice(1), justAnswered];

      if (newQueue.length > 0) {
        return {
          ...state,
          queue: newQueue,
          draftAnswer: null,
          isAnswered: false,
          isCorrect: null,
          pacciMood: isExam ? 'hint' : 'neutral',
        };
      }

      // Fila vazia: terminou (exame respondido por completo, ou lição/
      // revisão com todas as pendências finalmente acertadas) e o usuário
      // ainda tem vidas — só falta decidir a tela de resultado.
      // `scorePct` usa respostas certas sobre o TOTAL de respostas dadas
      // (incluindo reenvios) — pra exame, sem reenvio, isso é idêntico ao
      // aproveitamento tradicional; pra Teste de Aceleração, mede o quão
      // "limpa" foi a tentativa mesmo com a fila de erros.
      const totalAnswers = state.correctCount + state.wrongCount;
      const scorePct = totalAnswers > 0 ? state.correctCount / totalAnswers : 0;
      const wasPerfect = state.wrongCount === 0;

      // --- Lição de Manutenção/Revisão (modo Lenda) ---------------------
      // Não rende gema de lição (não é uma lição "de verdade" da trilha),
      // mas ainda conta o dia pra ofensiva — pode bater o marco de 7 dias.
      if (state.isDailyReview) {
        const reviewMinutes = estimateMinutesSpent(state.questions.length);
        const { user: streakedReviewUser, streakBonusGems: reviewStreakBonus } = applyDailyStreak({
          ...state.user,
          ...addXp(state.user, DAILY_REVIEW_XP),
          timeSpentMinutes: (state.user.timeSpentMinutes ?? 0) + reviewMinutes,
        });
        return {
          ...state,
          lessonComplete: true,
          isAnswered: false,
          isCorrect: null,
          draftAnswer: null,
          pacciMood: 'happy',
          sessionXp: state.sessionXp + DAILY_REVIEW_XP,
          user: streakedReviewUser,
          lessonGemsEarned: 0,
          streakBonusGems: reviewStreakBonus,
          justPromotedLevelId: null,
        };
      }

      // --- Exame de Transição de Nível -----------------------------------
      if (isExam) {
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

        // findLesson lê de state.modules (o estado ANTES desta tentativa) —
        // se completed já era true, é uma repescagem de um exame já
        // aprovado antes, e rende só o XP de repescagem (senão dava pra
        // repetir o mesmo exame pra sempre e inflar o Ranking Geral).
        const examLesson = findLesson(state.modules, state.moduleId, state.lessonId);
        const wasAlreadyPassed = Boolean(examLesson?.completed);
        const bonusXp = passed ? (wasAlreadyPassed ? REPEAT_LESSON_XP : examLesson?.xpReward ?? 0) : 0;
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

        // Baú de Recompensa: passar no exame de transição rende gemas fixas
        // (não as gemas de "lição concluída" normais — o baú substitui,
        // não soma com elas), independente de destravar um próximo nível
        // ou ser o exame do último nível (Especialista).
        let examUser = userWithAttempt;
        let examStreakBonus = 0;
        if (passed) {
          const { user: streakedExamUser, streakBonusGems } = applyDailyStreak({
            ...userWithAttempt,
            ...addXp(userWithAttempt, bonusXp),
            gems: userWithAttempt.gems + LEVEL_UP_CHEST_GEMS,
          });
          examUser = streakedExamUser;
          examStreakBonus = streakBonusGems;
        }

        return {
          ...state,
          modules: nextModules,
          lessonComplete: true,
          isAnswered: false,
          isCorrect: null,
          draftAnswer: null,
          pacciMood: passed ? 'happy' : 'sad',
          sessionXp: state.sessionXp + bonusXp,
          user: examUser,
          lessonGemsEarned: passed ? LEVEL_UP_CHEST_GEMS : 0,
          streakBonusGems: examStreakBonus,
          examResult: { passed, scorePct, requiredPct: EXAM_PASS_THRESHOLD },
          lastLessonScorePct: scorePct,
          perfectLessonStreak: 0,
          accelerationAvailable: false,
          // Sinaliza pro QuizEngine tocar o som de promoção (em vez do
          // fanfarrão genérico de lição concluída) quando o exame aprovado
          // destrava o próximo nível de carreira.
          justPromotedLevelId: passed ? nextLevelId : null,
        };
      }

      // --- Lição regular (ou lição usada como Teste de Aceleração) -------
      // findLesson lê de state.modules (o estado ANTES desta tentativa) —
      // se completed já era true, é repescagem de uma lição já concluída
      // antes, e rende só o XP de repescagem (senão dava pra repetir a
      // mesma lição pra sempre e inflar o Ranking Geral).
      const lesson = findLesson(state.modules, state.moduleId, state.lessonId);
      const wasAlreadyCompleted = Boolean(lesson?.completed);
      const lessonMinutes = estimateMinutesSpent(state.questions.length);

      // Teste de Aceleração: mecânica opcional à parte, com sua própria
      // regra de aprovação por % de aproveitamento.
      if (state.pendingAccelerationTest) {
        const bonusXp = wasAlreadyCompleted ? REPEAT_LESSON_XP : lesson?.xpReward ?? 0;
        let nextModules = updateLessonInModules(state.modules, state.moduleId, state.lessonId, {
          completed: true,
        });
        let accelerationResult;
        const passed = scorePct >= EXAM_PASS_THRESHOLD;
        if (passed) {
          const skipped = skipAheadLessons(nextModules, state.moduleId, state.lessonId, ACCELERATION_SKIP_COUNT);
          nextModules = skipped.modules;
          accelerationResult = { passed: true, skippedCount: skipped.skippedCount };
        } else {
          nextModules = unlockNextLesson(nextModules, state.moduleId, state.lessonId);
          accelerationResult = { passed: false, skippedCount: 0 };
        }

        // Ainda é "concluir uma lição", só que na roupagem do Teste de
        // Aceleração — rende a mesma gema de lição perfeita/normal que a
        // progressão comum, por cima do resultado (passou ou não) do teste.
        const accelLessonGems = wasPerfect ? PERFECT_LESSON_GEMS : LESSON_COMPLETE_GEMS;
        const { user: streakedAccelUser, streakBonusGems: accelStreakBonus } = applyDailyStreak({
          ...state.user,
          ...addXp(state.user, bonusXp),
          gems: state.user.gems + accelLessonGems,
          timeSpentMinutes: (state.user.timeSpentMinutes ?? 0) + lessonMinutes,
        });

        return {
          ...state,
          modules: nextModules,
          lessonComplete: true,
          draftAnswer: null,
          isAnswered: false,
          isCorrect: null,
          pacciMood: 'happy',
          sessionXp: state.sessionXp + bonusXp,
          user: streakedAccelUser,
          lessonGemsEarned: accelLessonGems,
          streakBonusGems: accelStreakBonus,
          perfectLessonStreak: wasPerfect ? state.perfectLessonStreak + 1 : 0,
          accelerationAvailable: false,
          pendingAccelerationTest: false,
          accelerationResult,
          lastLessonScorePct: scorePct,
          justPromotedLevelId: null,
        };
      }

      // Chegar aqui com a fila vazia e vidas de sobra já significa
      // aprovado — não existe mais um estado intermediário de "reprovado
      // mas ainda vivo": ou o usuário ficou sem corações no meio do
      // caminho (Game Over, tratado no topo deste case) ou zerou a fila
      // de pendências e passa, exatamente como no Duolingo.
      const bonusXp = wasAlreadyCompleted ? REPEAT_LESSON_XP : lesson?.xpReward ?? 0;
      const nextModules = unlockNextLesson(
        updateLessonInModules(state.modules, state.moduleId, state.lessonId, { completed: true }),
        state.moduleId,
        state.lessonId
      );
      const newPerfectStreak = wasPerfect ? state.perfectLessonStreak + 1 : 0;
      const nextLessonAvailable = Boolean(getNextLesson(nextModules, state.moduleId, state.lessonId));
      const accelerationAvailable = newPerfectStreak >= PERFECT_LESSONS_FOR_ACCELERATION && nextLessonAvailable;

      // Recompensa de gemas (estilo Duolingo): lição sem nenhum erro rende
      // mais que uma lição concluída "no susto" via repescagem da fila.
      const lessonGems = wasPerfect ? PERFECT_LESSON_GEMS : LESSON_COMPLETE_GEMS;
      const { user: streakedLessonUser, streakBonusGems: lessonStreakBonus } = applyDailyStreak({
        ...state.user,
        ...addXp(state.user, bonusXp),
        gems: state.user.gems + lessonGems,
        timeSpentMinutes: (state.user.timeSpentMinutes ?? 0) + lessonMinutes,
      });

      return {
        ...state,
        modules: nextModules,
        lessonComplete: true,
        draftAnswer: null,
        isAnswered: false,
        isCorrect: null,
        pacciMood: 'happy',
        sessionXp: state.sessionXp + bonusXp,
        user: streakedLessonUser,
        lessonGemsEarned: lessonGems,
        streakBonusGems: lessonStreakBonus,
        perfectLessonStreak: newPerfectStreak,
        accelerationAvailable,
        pendingAccelerationTest: false,
        accelerationResult: null,
        lastLessonScorePct: scorePct,
        justPromotedLevelId: null,
      };
    }

    case 'RESTART_LESSON': {
      if (!state.user) return state;
      return { ...startLessonState(state, state.moduleId, state.lessonId), pendingAccelerationTest: false };
    }

    // Recarga instantânea e grátis foi removida de propósito — vidas agora só
    // voltam com o tempo (HEART_REGEN_MINUTES por coração) ou gastando gemas.
    case 'BUY_HEART_REFILL': {
      if (!state.user) return state;
      const missing = state.user.maxLives - state.user.lives;
      if (missing <= 0) return state;
      const amount = action.payload; // 'one' | 'full'
      const cost = amount === 'full' ? HEART_REFILL_FULL_COST : HEART_REFILL_ONE_COST;
      if (state.user.gems < cost) return state;
      const newLives = amount === 'full' ? state.user.maxLives : state.user.lives + 1;
      const isFull = newLives >= state.user.maxLives;
      return {
        ...state,
        gameOver: newLives > 0 ? false : state.gameOver,
        user: {
          ...state.user,
          gems: state.user.gems - cost,
          lives: newLives,
          lastHeartLostAt: isFull ? null : state.user.lastHeartLostAt,
        },
      };
    }

    // Recomputa vidas regeneradas pelo tempo — chamada tanto por um
    // intervalo periódico no Provider (mantém Header/tela de game over
    // atualizados mesmo sem o usuário interagir) quanto sob demanda.
    case 'APPLY_HEART_REGEN': {
      if (!state.user) return state;
      const regenUser = applyHeartRegen(state.user);
      if (regenUser === state.user) return state;
      return {
        ...state,
        gameOver: regenUser.lives > 0 ? false : state.gameOver,
        user: regenUser,
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
        queue: [],
        draftAnswer: null,
        isAnswered: false,
        isCorrect: null,
        lessonComplete: false,
        pacciMood: 'neutral',
        pendingAccelerationTest: false,
        accelerationResult: null,
        examResult: null,
        lastLessonScorePct: null,
        isDailyReview: false,
        justPromotedLevelId: null,
        lessonGemsEarned: 0,
        streakBonusGems: 0,
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

  // Recomputa a recarga de vidas por tempo periodicamente — cobre o caso do
  // usuário só de olho no contador na tela (Header/tela de game over) sem
  // interagir com nada, pra não parecer travado até a próxima ação.
  useEffect(() => {
    // 15s (não 60s): com a recarga em 10min, um tick de 1min deixaria o
    // contador "empacado" por até 1/10 do tempo total antes de atualizar.
    const interval = setInterval(() => dispatch({ type: 'APPLY_HEART_REGEN' }), 15000);
    return () => clearInterval(interval);
  }, []);

  // Modo Supabase: vidas/timestamp de recarga precisam ser persistidos
  // assim que mudam (não só ao concluir a lição) — senão fechar o navegador
  // no meio de uma lição, depois de perder um coração, perderia o
  // `last_heart_lost_at` e a contagem de recarga reiniciaria do zero errado.
  const lastPersistedHeartsRef = useRef(null);
  useEffect(() => {
    if (!isSupabaseConfigured || !state.user) return;
    const key = `${state.user.id}:${state.user.lives}:${state.user.lastHeartLostAt}`;
    if (lastPersistedHeartsRef.current === key) return;
    lastPersistedHeartsRef.current = key;
    api
      .updateProfile(state.user.id, { lives: state.user.lives, lastHeartLostAt: state.user.lastHeartLostAt })
      .catch(() => {
        // Best-effort — mesma lógica do efeito de conclusão de lição abaixo.
      });
  }, [state.user?.id, state.user?.lives, state.user?.lastHeartLostAt]);

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
          if (isAccessExpired(profile)) {
            await api.signOut();
            dispatch({ type: 'AUTH_ERROR', payload: ACCESS_EXPIRED_MESSAGE });
            return;
          }
          const progress = await loadProgressSafely(profile.id);
          if (!active) return;
          dispatch({ type: 'AUTH_SUCCESS', payload: { user: profile, progress } });
        } else {
          dispatch({ type: 'AUTH_SIGNED_OUT' });
        }
      } catch (err) {
        if (active) dispatch({ type: 'AUTH_ERROR', payload: err.message });
      }
    })();

    const unsubscribe = api.onAuthStateChange((session, event) => {
      // Clique no link do e-mail de "esqueci minha senha": o Supabase Auth
      // já autentica numa sessão especial e dispara este evento — desvia
      // pra tela de definir senha nova em vez de deixar cair no app normal.
      if (event === 'PASSWORD_RECOVERY') {
        dispatch({ type: 'PASSWORD_RECOVERY_MODE' });
        return;
      }
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

  // Exposto pro Leaderboard.jsx chamar ao montar (aba "Ranking" aberta) —
  // pega o XP mais recente dos colegas mesmo se ninguém aqui terminou uma
  // lição nesse meio tempo (o efeito acima só reage a login/lessonComplete
  // da PRÓPRIA sessão, não ao que outra pessoa da empresa fez).
  const refreshLeaderboards = useCallback(async () => {
    if (!isSupabaseConfigured || !state.user) return;
    try {
      const [company, global] = await Promise.all([
        api.fetchCompanyLeaderboard(state.user.companyId),
        api.fetchGlobalLeaderboard(),
      ]);
      dispatch({ type: 'SET_SUPABASE_LEADERBOARDS', payload: { company, global } });
    } catch {
      // Ranking é informativo — uma falha aqui não deve travar a tela.
    }
  }, [state.user]);

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
          weeklyXp: state.user.weeklyXp,
          weekStart: state.user.weekStart,
          streak: state.user.streak,
          streakFreezes: state.user.streakFreezes,
          gems: state.user.gems,
          lives: state.user.lives,
          lastHeartLostAt: state.user.lastHeartLostAt,
          lastStudyDate: state.user.lastStudyDate,
          currentLevelId: state.user.currentLevelId,
          currentLevelSince: state.user.currentLevelSince,
          timeSpentMinutes: state.user.timeSpentMinutes,
        });
        if (!state.isDailyReview && state.lessonId) {
          await api.recordLessonProgress({
            userId: state.user.id,
            lessonId: state.lessonId,
            score: state.lastLessonScorePct,
            passed: state.examResult?.passed ?? null,
          });
        }
      } catch {
        // Best-effort: se a rede falhar aqui, o progresso local do usuário
        // não é perdido, só não fica sincronizado com o banco até a
        // próxima lição concluída com sucesso.
      }
    })();
  }, [
    state.lessonComplete,
    state.user,
    state.lessonId,
    state.sessionXp,
    state.isDailyReview,
    state.examResult,
    state.lastLessonScorePct,
  ]);

  // Modo Supabase: registra cada PERGUNTA respondida (não só o resultado da
  // lição inteira) em question_attempts — é a granularidade que o Painel do
  // Gestor precisa pro gráfico de Desempenho por Tema. Dispara uma única vez
  // por resposta (o próprio CHECK_ANSWER do reducer já garante que isAnswered
  // só vira true numa resposta nova de verdade — nunca reprocessa a mesma).
  // Deps intencionalmente restritas a `state.isAnswered`: state.queue/
  // isCorrect sempre mudam JUNTO com isAnswered nessa transição, então lê-los
  // do closure é seguro e evita reagir a mudanças que não são "nova resposta".
  const loggedThisAnswerRef = useRef(false);
  useEffect(() => {
    if (!state.isAnswered) {
      loggedThisAnswerRef.current = false;
      return;
    }
    if (loggedThisAnswerRef.current) return;
    loggedThisAnswerRef.current = true;

    if (!isSupabaseConfigured || !state.user || !state.lessonId) return;
    const question = state.queue[0];
    if (!question) return;

    api
      .recordQuestionAttempt({
        userId: state.user.id,
        questionId: question.id,
        lessonId: state.lessonId,
        topic: question.topic ?? 'outros',
        isCorrect: Boolean(state.isCorrect),
      })
      .catch(() => {
        // Best-effort: só alimenta o gráfico de Desempenho por Tema do
        // Painel do Gestor — uma falha aqui não deve incomodar quem está jogando.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isAnswered]);

  const login = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) {
      dispatch({ type: 'LOGIN', payload: { email, password } });
      return;
    }
    dispatch({ type: 'AUTH_LOADING' });
    try {
      const { user: authUser } = await api.signIn(email, password);
      const profile = await api.fetchProfile(authUser.id);
      if (isAccessExpired(profile)) {
        await api.signOut();
        dispatch({ type: 'AUTH_ERROR', payload: ACCESS_EXPIRED_MESSAGE });
        return;
      }
      const progress = await loadProgressSafely(profile.id);
      dispatch({ type: 'AUTH_SUCCESS', payload: { user: profile, progress } });
    } catch (err) {
      dispatch({ type: 'AUTH_ERROR', payload: err.message || 'Não foi possível entrar.' });
    }
  }, []);

  // Não usa AUTH_ERROR/state.authError aqui de propósito: esse campo é
  // exibido pelo LoginForm/RegisterForm, e um erro do teste grátis não tem
  // nada a ver com uma tentativa de login — apareceria duplicado nos dois
  // lugares. O componente lê o erro do valor de retorno em vez do contexto.
  const startFreeTrial = useCallback(async ({ email, fullName, phone, companyName }) => {
    if (!isSupabaseConfigured) {
      return { ok: false, error: 'O teste grátis por e-mail precisa do Supabase configurado (ver .env.local).' };
    }
    dispatch({ type: 'AUTH_LOADING' });
    try {
      await api.requestTrialAccess(email, fullName);
      dispatch({ type: 'CLEAR_AUTH_ERROR' });
      // Best-effort e fire-and-forget: avisa o time comercial (mesmo padrão
      // de "Novo lead recebido" das landing pages) sem atrasar a resposta
      // pro usuário nem travar o teste grátis se isso falhar.
      api.captureMarketingLead({ fullName, email, phone, companyName, source: 'teste_gratuito' });
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
        // Não deveria acontecer: public-register já cria a conta confirmada
        // (email_confirm: true) e api.signUp() faz o signInWithPassword logo
        // em seguida — mas mantém o aviso por segurança, caso a sessão não
        // volte por algum motivo inesperado.
        dispatch({ type: 'AUTH_ERROR', payload: 'Cadastro criado, mas não foi possível entrar automaticamente. Tente fazer login.' });
        return;
      }
      const profile = await api.fetchProfile(authUser.id);
      const progress = await loadProgressSafely(profile.id);
      dispatch({ type: 'AUTH_SUCCESS', payload: { user: profile, progress } });
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

  // "Esqueci minha senha": manda o e-mail de redefinição. Não usa
  // AUTH_ERROR/state.authError de propósito, mesmo motivo do startFreeTrial
  // — esse erro não tem nada a ver com uma tentativa de login em andamento.
  const resetPasswordForEmail = useCallback(async (email) => {
    if (!isSupabaseConfigured) {
      return { ok: false, error: 'Redefinição de senha por e-mail precisa do Supabase configurado.' };
    }
    try {
      // Conta com acesso vencido: redefinir a senha não resolve nada — mostra
      // a mesma orientação de renovação do login em vez de mandar o e-mail.
      // Best-effort: se a checagem falhar (ex.: RPC ainda não existe no
      // banco), não trava quem só quer redefinir a senha normalmente.
      try {
        const expired = await api.checkAccessExpiredByEmail(email);
        if (expired) return { ok: false, error: ACCESS_EXPIRED_MESSAGE };
      } catch (checkErr) {
        console.error('checkAccessExpiredByEmail failed (non-fatal):', checkErr);
      }
      await api.resetPasswordForEmail(email);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'Não foi possível enviar o e-mail de redefinição.' };
    }
  }, []);

  // Chamado pela tela de "defina uma senha nova" depois de clicar no link
  // do e-mail — a sessão de recuperação já está ativa (evento
  // PASSWORD_RECOVERY, ver o listener acima), só falta trocar a senha e
  // seguir pro app normalmente.
  const completePasswordReset = useCallback(async (newPassword) => {
    try {
      await api.updatePassword(newPassword);
      const session = await api.getCurrentSession();
      if (session?.user) {
        const profile = await api.fetchProfile(session.user.id);
        const progress = await loadProgressSafely(profile.id);
        dispatch({ type: 'AUTH_SUCCESS', payload: { user: profile, progress } });
      } else {
        dispatch({ type: 'PASSWORD_RESET_COMPLETE' });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'Não foi possível trocar a senha.' };
    }
  }, []);

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
  const buyHeartRefill = useCallback((amount) => dispatch({ type: 'BUY_HEART_REFILL', payload: amount }), []);
  const buyStreakFreeze = useCallback(() => dispatch({ type: 'BUY_STREAK_FREEZE' }), []);
  const exitLesson = useCallback(() => dispatch({ type: 'EXIT_LESSON' }), []);

  // `currentQuestion` sempre vem da FILA (não do array original de
  // perguntas) — é ela que decide o que aparece na tela a cada passo,
  // incluindo repetições de perguntas erradas reencaminhadas pro final.
  const currentQuestion = state.queue[0] ?? null;
  const totalQuestions = state.questions.length;
  // Quantas perguntas ÚNICAS já foram respondidas corretamente pelo menos
  // uma vez nesta sessão — usado pra barra de progresso (uma pergunta só
  // "conta" quando sai da fila de vez, não na primeira tentativa errada).
  const masteredCount = totalQuestions - state.queue.length;

  const currentCompany = useMemo(() => {
    if (!state.user) return null;
    if (isSupabaseConfigured) {
      return state.supabaseCompanies.find((c) => c.id === state.user.companyId) ?? null;
    }
    return getCompanyById(state.user.companyId);
  }, [state.user, state.supabaseCompanies]);

  // A conta master (fundador) não entra em nenhum ranking — é a conta de
  // contingência/QA, não faz sentido ela "competir" com os colaboradores.
  // No modo Supabase esse filtro é feito no servidor (get_global_leaderboard/
  // get_company_leaderboard, ver schema.sql), já que as RPCs nem devolvem a
  // coluna role pro cliente filtrar de novo aqui.
  const nonMasterUsers = useMemo(() => state.users.filter((u) => u.role !== 'master'), [state.users]);

  // Privacidade B2B: colaborador de Plano Corporativo de verdade (maxUsers
  // preenchido — Individual/Teste Grátis são "empresas" de 1 pessoa só, com
  // maxUsers null) não aparece pro Ranking Geral entre empresas. No modo
  // Supabase esse filtro é feito no servidor (get_global_leaderboard, ver
  // schema.sql); dentro da PRÓPRIA empresa (companyLeaderboard) continua
  // aparecendo normalmente — a exclusão é só entre empresas diferentes.
  const nonCorporateUsers = useMemo(
    () => nonMasterUsers.filter((u) => getCompanyById(u.companyId)?.maxUsers == null),
    [nonMasterUsers]
  );

  const companyLeaderboard = useMemo(() => {
    if (isSupabaseConfigured) return computeLeaderboard(state.supabaseCompanyLeaderboard ?? []);
    if (!state.user) return [];
    return computeLeaderboard(nonMasterUsers.filter((u) => u.companyId === state.user.companyId));
  }, [nonMasterUsers, state.user?.companyId, state.supabaseCompanyLeaderboard]);

  const globalLeaderboard = useMemo(() => {
    if (isSupabaseConfigured) return computeLeaderboard(state.supabaseGlobalLeaderboard ?? []);
    return computeLeaderboard(nonCorporateUsers);
  }, [nonCorporateUsers, state.supabaseGlobalLeaderboard]);

  // Ranking Semanal — mesmas listas de base, só ordenadas por `weeklyXp` em
  // vez de `xp` total (ver addXp/getWeekStartISO). Não precisa "zerar" nada
  // de verdade: weeklyXp já vem 0 (ou baixo) pra quem não jogou nesta semana.
  const weeklyCompanyLeaderboard = useMemo(() => {
    if (isSupabaseConfigured) return computeLeaderboard(state.supabaseCompanyLeaderboard ?? [], 'weeklyXp');
    if (!state.user) return [];
    return computeLeaderboard(
      nonMasterUsers.filter((u) => u.companyId === state.user.companyId),
      'weeklyXp'
    );
  }, [nonMasterUsers, state.user?.companyId, state.supabaseCompanyLeaderboard]);

  const weeklyGlobalLeaderboard = useMemo(() => {
    if (isSupabaseConfigured) return computeLeaderboard(state.supabaseGlobalLeaderboard ?? [], 'weeklyXp');
    return computeLeaderboard(nonCorporateUsers, 'weeklyXp');
  }, [nonCorporateUsers, state.supabaseGlobalLeaderboard]);

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
      masteredCount,
      isModuleMastered,
      isManager,
      companies: activeCompanies,
      currentCompany,
      companyLeaderboard,
      globalLeaderboard,
      weeklyCompanyLeaderboard,
      weeklyGlobalLeaderboard,
      refreshLeaderboards,
      login,
      register,
      logout,
      startFreeTrial,
      clearAuthError,
      resetPasswordForEmail,
      completePasswordReset,
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
      buyHeartRefill,
      buyStreakFreeze,
      exitLesson,
    }),
    [
      state,
      effectiveModules,
      activeCompanies,
      currentQuestion,
      totalQuestions,
      masteredCount,
      isModuleMastered,
      isManager,
      currentCompany,
      companyLeaderboard,
      globalLeaderboard,
      weeklyCompanyLeaderboard,
      weeklyGlobalLeaderboard,
      refreshLeaderboards,
      login,
      register,
      logout,
      startFreeTrial,
      clearAuthError,
      resetPasswordForEmail,
      completePasswordReset,
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
      buyHeartRefill,
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
