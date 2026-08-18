// src/data/mockData.js
// Dados mockados do TaxLingo. Em produção isso viria de uma API,
// mas o formato dos objetos (module, lesson, question) é o "contrato"
// que QuizEngine, Header e Leaderboard esperam.

import questionsEstagiario from './questions/reforma_tributaria_estagiario.json';
import questionsAuxiliar from './questions/reforma_tributaria_auxiliar.json';
import questionsAssistente from './questions/reforma_tributaria_assistente.json';
import questionsAnalistaJunior from './questions/reforma_tributaria_analista_junior.json';
import questionsAnalistaPleno from './questions/reforma_tributaria_analista_pleno.json';
import questionsAnalistaSenior from './questions/reforma_tributaria_analista_senior.json';
import questionsEspecialista from './questions/reforma_tributaria_especialista.json';

// ---------------------------------------------------------------------------
// IDs de módulos — usados como chave estável em `questionBank` e para
// referenciar o módulo ativo no GameContext. Módulos futuros só precisam
// de uma entrada aqui + em `modules` + em `questionBank`.
// ---------------------------------------------------------------------------
export const MODULE_IDS = {
  REFORMA_TRIBUTARIA: 'reforma-tributaria',
  CONTABILIDADE: 'contabilidade',
  FISCAL: 'fiscal',
  TRABALHISTA: 'trabalhista',
  ATENDIMENTO_CLIENTE: 'atendimento-cliente',
  ETICA_PROFISSIONAL: 'etica-profissional',
  LEGALIZACAO: 'legalizacao',
};

// Tipos de questão suportados pelo QuizEngine.
export const QUESTION_TYPES = {
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  ORDERING: 'ordering',
  FILL_BLANK: 'fill_blank',
  TEXT_INPUT: 'text_input',
};

// Tipos de lição suportados pelo QuizEngine/GameContext.
export const LESSON_TYPES = {
  REGULAR: 'regular',
  EXAM: 'exam',
};

// ---------------------------------------------------------------------------
// Parâmetros de gamificação (ajustáveis num único lugar).
// ---------------------------------------------------------------------------
export const EXAM_PASS_THRESHOLD = 0.8; // 80% de aproveitamento mínimo no Exame de Transição
export const EXAM_QUESTION_MIN = 15;
export const EXAM_QUESTION_MAX = 20;
export const MIN_QUESTIONS_PER_LESSON = 3;
export const MAX_QUESTIONS_PER_LESSON = 5;
export const PERFECT_LESSONS_FOR_ACCELERATION = 3; // 3 lições seguidas 100% liberam o teste
export const ACCELERATION_SKIP_COUNT = 2; // quantas lições o Teste de Aceleração pula
export const STREAK_FREEZE_COST = 20; // custo em gemas do Congelamento de Ofensiva
export const MAX_STREAK_FREEZES = 2; // limite de congelamentos acumuláveis
export const DAILY_REVIEW_QUESTION_COUNT = 5;
export const DAILY_REVIEW_XP = 15;
export const HEART_REGEN_HOURS = 4; // horas para recarregar 1 coração perdido
export const HEART_REFILL_ONE_COST = 100; // gemas para recarregar 1 coração na hora
export const HEART_REFILL_FULL_COST = 350; // gemas para recarregar todos os corações na hora
export const INITIAL_GEMS = 1000; // saldo inicial de todo usuário novo — dá pra recarregar vidas de cara

// Planos comerciais — usados tanto pela tela de vendas (SubscriptionModal,
// AuthModal) quanto espelhados (com os mesmos ids/preços) nas Edge
// Functions de checkout (create-asaas-checkout, create-nitrus-checkout).
export const PLANS = {
  individual: {
    label: 'Individual',
    kind: 'individual',
    price: 'R$ 39,90/mês',
    seatsLimit: 1,
    description: 'Pra quem estuda ou trabalha por conta própria — sem precisar cadastrar uma empresa.',
    features: ['1 conta pessoal', 'Todos os 7 níveis de carreira', 'Sem painel de gestor'],
  },
  starter: {
    label: 'Starter',
    kind: 'corporate',
    price: 'R$ 297/mês',
    seatsLimit: 10,
    description: 'Pra escritórios pequenos organizarem o treinamento do time.',
    features: ['Até 10 colaboradores', 'Todos os 7 níveis de carreira', 'Painel do Gestor', 'Suporte por e-mail'],
  },
  pro: {
    label: 'Pro',
    kind: 'corporate',
    price: 'R$ 897/mês',
    seatsLimit: 50,
    description: 'Pra empresas maiores com times inteiros pra treinar.',
    features: ['Até 50 colaboradores', 'Todos os 7 níveis de carreira', 'Painel do Gestor', 'Suporte prioritário'],
  },
};

// ---------------------------------------------------------------------------
// Empresas (multi-tenancy local, mockada) — cada usuário pertence a uma
// delas via `companyId`. `code` é o código que o colaborador informa no
// cadastro para se vincular automaticamente à empresa certa.
// ---------------------------------------------------------------------------
export const companies = [
  { id: 'emp-01', name: 'Contabilidade Alfa', code: 'ALFA2026' },
  { id: 'emp-02', name: 'Beta Consultoria Fiscal', code: 'BETA2026' },
  { id: 'emp-03', name: 'Grupo Gamma Contábil', code: 'GAMMA2026' },
];

export function getCompanyById(companyId) {
  return companies.find((c) => c.id === companyId) ?? null;
}

export function getCompanyByCode(code) {
  const normalized = String(code ?? '').trim().toUpperCase();
  return companies.find((c) => c.code === normalized) ?? null;
}

// Avatares disponíveis para escolha no cadastro/perfil, organizados em
// categorias (usadas como abas no seletor). Como este mock não tem upload
// de imagem, "avatarUrl" guarda um emoji em vez de uma URL real.
export const AVATAR_CATEGORIES = {
  professional: {
    label: 'Corporativos',
    emojis: ['👔', '👩‍💼', '👨‍💼', '🧑‍💻', '👩‍💻', '🎓', '💼', '🧑‍🎓'],
  },
  mascots: {
    label: 'Mascotes',
    emojis: ['🦉', '🦊', '🦁', '🐯', '🐼', '🐸', '🤖', '🧙‍♂️'],
  },
  expressions: {
    label: 'Expressões',
    emojis: ['😎', '🧐', '🤓', '🥳', '🤠', '🚀', '💡', '⭐️'],
  },
};

// Lista plana de todos os avatares (usada, por exemplo, para sortear um
// avatar padrão no cadastro).
export const AVATAR_CHOICES = Object.values(AVATAR_CATEGORIES).flatMap((category) => category.emojis);

// Data relativa a "hoje" (execução real), usada nos dados de seed abaixo —
// assim o mock sempre parece atual, não importa quando o projeto for rodado.
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function timestampDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Usuários (mock). Cada um pertence a uma empresa (`companyId`) e tem um
// `role` de acesso ("employee" | "admin" | "master") além dos dados de
// progresso do jogo (xp, streak, vidas, gemas, tempo de treinamento,
// histórico de Exames de Transição etc.) usados pelo Painel do Gestor.
//
// ATENÇÃO: senha em texto puro só é aceitável aqui porque isto é um mock
// 100% client-side, sem backend — nunca faça isso em um sistema real.
// ---------------------------------------------------------------------------
export const seedUsers = [
  {
    id: 'u-001', name: 'Andréia Silva', email: 'andreia@alfa.com', password: 'demo123', companyId: 'emp-01',
    role: 'employee', jobTitle: 'Analista Fiscal', avatarUrl: '👩‍💼', xp: 1240, level: 6, lives: 4, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 7, lastStudyDate: daysAgo(1), streakFreezes: 1, gems: 50,
    currentLevelId: 'assistente', currentLevelSince: daysAgo(12), timeSpentMinutes: 340,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.85, passed: true, timestamp: timestampDaysAgo(40) },
      { levelId: 'auxiliar', lessonId: 'auxiliar-exam', scorePct: 0.78, passed: true, timestamp: timestampDaysAgo(20) },
    ],
  },
  {
    id: 'u-002', name: 'Marcos Vinícius', email: 'marcos@alfa.com', password: 'demo123', companyId: 'emp-01',
    role: 'admin', jobTitle: 'Gerente Fiscal', avatarUrl: '🧑‍💼', xp: 2180, level: 10, lives: 5, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 21, lastStudyDate: daysAgo(0), streakFreezes: 2, gems: 120,
    currentLevelId: 'analista_senior', currentLevelSince: daysAgo(3), timeSpentMinutes: 610,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.95, passed: true, timestamp: timestampDaysAgo(60) },
      { levelId: 'auxiliar', lessonId: 'auxiliar-exam', scorePct: 0.9, passed: true, timestamp: timestampDaysAgo(45) },
      { levelId: 'assistente', lessonId: 'assistente-exam', scorePct: 0.88, passed: true, timestamp: timestampDaysAgo(30) },
      { levelId: 'analista_junior', lessonId: 'analista_junior-exam', scorePct: 0.92, passed: true, timestamp: timestampDaysAgo(15) },
      { levelId: 'analista_pleno', lessonId: 'analista_pleno-exam', scorePct: 0.86, passed: true, timestamp: timestampDaysAgo(4) },
    ],
  },
  {
    id: 'u-003', name: 'Camila Nogueira', email: 'camila@alfa.com', password: 'demo123', companyId: 'emp-01',
    role: 'employee', jobTitle: 'Analista Contábil', avatarUrl: '👩‍💻', xp: 1950, level: 9, lives: 5, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 15, lastStudyDate: daysAgo(0), streakFreezes: 0, gems: 30,
    currentLevelId: 'analista_pleno', currentLevelSince: daysAgo(5), timeSpentMinutes: 480,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.9, passed: true, timestamp: timestampDaysAgo(50) },
      { levelId: 'auxiliar', lessonId: 'auxiliar-exam', scorePct: 0.84, passed: true, timestamp: timestampDaysAgo(35) },
      { levelId: 'assistente', lessonId: 'assistente-exam', scorePct: 0.81, passed: true, timestamp: timestampDaysAgo(20) },
      { levelId: 'analista_junior', lessonId: 'analista_junior-exam', scorePct: 0.79, passed: true, timestamp: timestampDaysAgo(6) },
    ],
  },
  {
    id: 'u-004', name: 'Rafael Souza', email: 'rafael@alfa.com', password: 'demo123', companyId: 'emp-01',
    role: 'employee', jobTitle: 'Analista Trabalhista', avatarUrl: '🧑', xp: 1190, level: 6, lives: 3, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 4, lastStudyDate: daysAgo(2), streakFreezes: 0, gems: 10,
    currentLevelId: 'assistente', currentLevelSince: daysAgo(14), timeSpentMinutes: 210,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.82, passed: true, timestamp: timestampDaysAgo(35) },
      { levelId: 'auxiliar', lessonId: 'auxiliar-exam', scorePct: 0.7, passed: true, timestamp: timestampDaysAgo(20) },
      { levelId: 'assistente', lessonId: 'assistente-exam', scorePct: 0.62, passed: false, timestamp: timestampDaysAgo(9) },
      { levelId: 'assistente', lessonId: 'assistente-exam', scorePct: 0.58, passed: false, timestamp: timestampDaysAgo(3) },
    ],
  },

  {
    id: 'u-005', name: 'Juliana Prado', email: 'juliana@beta.com', password: 'demo123', companyId: 'emp-02',
    role: 'admin', jobTitle: 'Coordenadora de Legalização', avatarUrl: '👩', xp: 1050, level: 5, lives: 5, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 9, lastStudyDate: daysAgo(0), streakFreezes: 1, gems: 40,
    currentLevelId: 'auxiliar', currentLevelSince: daysAgo(6), timeSpentMinutes: 260,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.88, passed: true, timestamp: timestampDaysAgo(25) },
    ],
  },
  {
    id: 'u-006', name: 'Bruno Costa', email: 'bruno@beta.com', password: 'demo123', companyId: 'emp-02',
    role: 'employee', jobTitle: 'Atendimento ao Cliente', avatarUrl: '🧑‍💼', xp: 980, level: 5, lives: 4, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 3, lastStudyDate: daysAgo(1), streakFreezes: 0, gems: 15,
    currentLevelId: 'auxiliar', currentLevelSince: daysAgo(8), timeSpentMinutes: 190,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.76, passed: true, timestamp: timestampDaysAgo(18) },
      { levelId: 'auxiliar', lessonId: 'auxiliar-exam', scorePct: 0.55, passed: false, timestamp: timestampDaysAgo(2) },
    ],
  },
  {
    id: 'u-007', name: 'Fernanda Lima', email: 'fernanda@beta.com', password: 'demo123', companyId: 'emp-02',
    role: 'employee', jobTitle: 'Compliance', avatarUrl: '👩‍🏫', xp: 870, level: 4, lives: 5, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 6, lastStudyDate: daysAgo(0), streakFreezes: 0, gems: 5,
    currentLevelId: 'estagiario', currentLevelSince: daysAgo(16), timeSpentMinutes: 150,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.6, passed: false, timestamp: timestampDaysAgo(10) },
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.68, passed: false, timestamp: timestampDaysAgo(2) },
    ],
  },
  {
    id: 'u-008', name: 'Diego Martins', email: 'diego@beta.com', password: 'demo123', companyId: 'emp-02',
    role: 'employee', jobTitle: 'Analista Fiscal', avatarUrl: '🧑‍💻', xp: 740, level: 4, lives: 5, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 1, lastStudyDate: daysAgo(6), streakFreezes: 0, gems: 0,
    currentLevelId: 'estagiario', currentLevelSince: daysAgo(20), timeSpentMinutes: 95,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.55, passed: false, timestamp: timestampDaysAgo(21) },
    ],
  },

  {
    id: 'u-009', name: 'Patrícia Alves', email: 'patricia@gamma.com', password: 'demo123', companyId: 'emp-03',
    role: 'admin', jobTitle: 'Sócia Contábil', avatarUrl: '👩‍💼', xp: 1600, level: 7, lives: 5, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 18, lastStudyDate: daysAgo(0), streakFreezes: 1, gems: 60,
    currentLevelId: 'analista_junior', currentLevelSince: daysAgo(4), timeSpentMinutes: 400,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.92, passed: true, timestamp: timestampDaysAgo(45) },
      { levelId: 'auxiliar', lessonId: 'auxiliar-exam', scorePct: 0.89, passed: true, timestamp: timestampDaysAgo(30) },
      { levelId: 'assistente', lessonId: 'assistente-exam', scorePct: 0.85, passed: true, timestamp: timestampDaysAgo(15) },
    ],
  },
  {
    id: 'u-010', name: 'Lucas Ferreira', email: 'lucas@gamma.com', password: 'demo123', companyId: 'emp-03',
    role: 'employee', jobTitle: 'Analista Fiscal', avatarUrl: '🧑', xp: 1420, level: 7, lives: 4, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 10, lastStudyDate: daysAgo(1), streakFreezes: 0, gems: 25,
    currentLevelId: 'analista_pleno', currentLevelSince: daysAgo(7), timeSpentMinutes: 350,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.8, passed: true, timestamp: timestampDaysAgo(40) },
      { levelId: 'auxiliar', lessonId: 'auxiliar-exam', scorePct: 0.77, passed: true, timestamp: timestampDaysAgo(25) },
      { levelId: 'assistente', lessonId: 'assistente-exam', scorePct: 0.83, passed: true, timestamp: timestampDaysAgo(12) },
    ],
  },
  {
    id: 'u-011', name: 'Renata Souza', email: 'renata@gamma.com', password: 'demo123', companyId: 'emp-03',
    role: 'employee', jobTitle: 'Analista Trabalhista', avatarUrl: '👩', xp: 1100, level: 6, lives: 5, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 5, lastStudyDate: daysAgo(2), streakFreezes: 0, gems: 8,
    currentLevelId: 'assistente', currentLevelSince: daysAgo(9), timeSpentMinutes: 230,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.74, passed: true, timestamp: timestampDaysAgo(30) },
      { levelId: 'auxiliar', lessonId: 'auxiliar-exam', scorePct: 0.71, passed: true, timestamp: timestampDaysAgo(15) },
    ],
  },
  {
    id: 'u-012', name: 'Thiago Barros', email: 'thiago@gamma.com', password: 'demo123', companyId: 'emp-03',
    role: 'employee', jobTitle: 'Legalização', avatarUrl: '🧑‍💻', xp: 690, level: 3, lives: 5, maxLives: 5, lastHeartLostAt: null, weeklyXp: 0, weekStart: null,
    streak: 0, lastStudyDate: daysAgo(9), streakFreezes: 0, gems: 0,
    currentLevelId: 'estagiario', currentLevelSince: daysAgo(25), timeSpentMinutes: 60,
    examAttempts: [
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.5, passed: false, timestamp: timestampDaysAgo(26) },
      { levelId: 'estagiario', lessonId: 'estagiario-exam', scorePct: 0.59, passed: false, timestamp: timestampDaysAgo(10) },
    ],
  },
];

// Ordena por XP e devolve cada usuário com sua `position` (1º, 2º, ...).
// Usado tanto para o ranking geral quanto para o ranking de uma empresa
// específica (basta filtrar `usersList` antes de chamar).
export function computeLeaderboard(usersList, sortKey = 'xp') {
  return [...usersList]
    .sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0))
    .map((user, index) => ({ ...user, position: index + 1 }));
}

// ---------------------------------------------------------------------------
// "Gargalos" de aprendizado — conceitos onde a equipe mais erra, exibidos no
// Painel do Gestor. ILUSTRATIVO/MOCKADO: as perguntas do banco não têm um
// campo de "tópico/conceito" próprio (só `level`), então não dá pra calcular
// isso de verdade a partir do gameplay ainda. Para tornar isso real, seria
// preciso adicionar uma tag de tópico a cada questão em src/data/questions/
// e agregar erros por tag conforme os usuários respondem.
// ---------------------------------------------------------------------------
export const mockTopicGaps = [
  { topic: 'Aproveitamento de Crédito IBS', missRate: 0.62, levelId: 'analista_pleno' },
  { topic: 'Split Payment', missRate: 0.58, levelId: 'analista_junior' },
  { topic: 'Regimes Específicos (Combustíveis/Saúde)', missRate: 0.54, levelId: 'analista_junior' },
  { topic: 'Cronograma de Transição 2026-2033', missRate: 0.47, levelId: 'analista_senior' },
  { topic: 'cClassTrib e Classificação Tributária', missRate: 0.44, levelId: 'auxiliar' },
  { topic: 'Créditos Remanescentes de PIS/Cofins', missRate: 0.41, levelId: 'especialista' },
];

// ---------------------------------------------------------------------------
// Trilha de carreira da Reforma Tributária: 7 níveis de senioridade.
// Meta de dimensionamento (3 meses, 3 lições/dia): 270 lições no módulo,
// ~38-39 por nível. `lessonCount` inclui a última lição, que é sempre o
// Exame de Transição daquele nível.
// ---------------------------------------------------------------------------
export const CAREER_LEVELS = [
  { id: 'estagiario', title: 'Estagiário', xpReward: 20, lessonCount: 39, questions: questionsEstagiario },
  { id: 'auxiliar', title: 'Auxiliar', xpReward: 25, lessonCount: 39, questions: questionsAuxiliar },
  { id: 'assistente', title: 'Assistente', xpReward: 30, lessonCount: 39, questions: questionsAssistente },
  { id: 'analista_junior', title: 'Analista Júnior', xpReward: 35, lessonCount: 39, questions: questionsAnalistaJunior },
  { id: 'analista_pleno', title: 'Analista Pleno', xpReward: 40, lessonCount: 38, questions: questionsAnalistaPleno },
  { id: 'analista_senior', title: 'Analista Sênior', xpReward: 45, lessonCount: 38, questions: questionsAnalistaSenior },
  { id: 'especialista', title: 'Especialista', xpReward: 50, lessonCount: 38, questions: questionsEspecialista },
];
// Soma dos lessonCount acima = 4×39 + 3×38 = 270 lições, batendo a meta de 3 meses.

// Distribui `array` em `partCount` grupos o mais equilibrados possível
// (usado para fatiar o banco de questões de um nível em lições curtas).
function chunkEvenly(array, partCount) {
  if (partCount <= 0 || array.length === 0) return [];
  const parts = [];
  const base = Math.floor(array.length / partCount);
  let remainder = array.length % partCount;
  let index = 0;
  for (let i = 0; i < partCount; i++) {
    const size = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    if (size === 0) break;
    parts.push(array.slice(index, index + size));
    index += size;
  }
  return parts;
}

// Monta as lições de um nível de carreira: N lições regulares de
// MIN_QUESTIONS_PER_LESSON~MAX_QUESTIONS_PER_LESSON questões cada, seguidas
// de 1 Exame de Transição (15-20 questões) ao final.
//
// Alguns níveis ainda têm menos questões geradas do que o alvo final de
// ~140-160 (ver src/data/questions/INDEX.md) — nesse caso o nível
// simplesmente aparece com menos lições por enquanto, e cresce sozinho
// conforme o banco de questões é expandido (nenhuma lição fica vazia).
function buildLevelLessons(level) {
  const allQuestions = level.questions;
  const total = allQuestions.length;
  if (total === 0) return { lessons: [], questionBank: {} };

  const rawExamSize = Math.round(total * 0.13) || EXAM_QUESTION_MIN;
  const examSize = Math.min(EXAM_QUESTION_MAX, Math.max(Math.min(EXAM_QUESTION_MIN, total), rawExamSize));
  const regularPool = allQuestions.slice(0, total - examSize);
  const examQuestions = allQuestions.slice(total - examSize);

  const maxRegularLessonsBySupply = Math.max(1, Math.floor(regularPool.length / MIN_QUESTIONS_PER_LESSON));
  const regularLessonCount = Math.max(1, Math.min(level.lessonCount - 1, maxRegularLessonsBySupply));
  const regularChunks = chunkEvenly(regularPool, regularLessonCount);

  const lessons = [];
  const bank = {};

  regularChunks.forEach((questions, i) => {
    const lessonId = `${level.id}-${i + 1}`;
    bank[lessonId] = questions;
    lessons.push({
      id: lessonId,
      title: `${level.title} · Lição ${i + 1}/${regularChunks.length}`,
      type: LESSON_TYPES.REGULAR,
      xpReward: level.xpReward,
      questionCount: questions.length,
      completed: false,
      locked: true,
    });
  });

  if (examQuestions.length > 0) {
    const examLessonId = `${level.id}-exam`;
    bank[examLessonId] = examQuestions;
    lessons.push({
      id: examLessonId,
      title: `${level.title} · Exame de Transição`,
      type: LESSON_TYPES.EXAM,
      xpReward: level.xpReward * 3,
      questionCount: examQuestions.length,
      passThreshold: EXAM_PASS_THRESHOLD,
      completed: false,
      locked: true,
    });
  }

  return { lessons, questionBank: bank };
}

const reformaTributariaLessons = [];
const reformaTributariaQuestionBank = {};

CAREER_LEVELS.forEach((level) => {
  const { lessons, questionBank: levelBank } = buildLevelLessons(level);
  reformaTributariaLessons.push(...lessons);
  Object.assign(reformaTributariaQuestionBank, levelBank);
});

// Mock: destrava só a primeira lição do primeiro nível para começar o jogo.
if (reformaTributariaLessons[0]) {
  reformaTributariaLessons[0].locked = false;
}

// ---------------------------------------------------------------------------
// Módulos disponíveis. A "Reforma Tributária" é o único destravado por
// enquanto; os demais já existem na estrutura para entrar em produção
// sem precisar mudar o shape de dados nem os componentes.
// ---------------------------------------------------------------------------
export const modules = [
  {
    id: MODULE_IDS.REFORMA_TRIBUTARIA,
    title: 'Reforma Tributária',
    description: 'Do Estagiário ao Especialista: IBS, CBS, Imposto Seletivo e a transição da EC 132/2023.',
    icon: 'Landmark',
    color: 'emerald',
    locked: false,
    totalLessons: reformaTributariaLessons.length,
    completedLessons: 0,
    progress: 0,
    lessons: reformaTributariaLessons,
  },
  {
    id: MODULE_IDS.CONTABILIDADE,
    title: 'Contabilidade',
    description: 'Fundamentos de escrituração, balanços e demonstrações contábeis.',
    icon: 'Calculator',
    color: 'blue',
    locked: true,
    totalLessons: 0,
    completedLessons: 0,
    progress: 0,
    lessons: [],
  },
  {
    id: MODULE_IDS.FISCAL,
    title: 'Fiscal',
    description: 'Obrigações acessórias, apuração de tributos e SPED.',
    icon: 'FileSpreadsheet',
    color: 'amber',
    locked: true,
    totalLessons: 0,
    completedLessons: 0,
    progress: 0,
    lessons: [],
  },
  {
    id: MODULE_IDS.TRABALHISTA,
    title: 'Trabalhista',
    description: 'Folha de pagamento, eSocial e legislação trabalhista.',
    icon: 'Briefcase',
    color: 'purple',
    locked: true,
    totalLessons: 0,
    completedLessons: 0,
    progress: 0,
    lessons: [],
  },
  {
    id: MODULE_IDS.ATENDIMENTO_CLIENTE,
    title: 'Atendimento ao Cliente',
    description: 'Excelência e comunicação no relacionamento com o cliente.',
    icon: 'Headset',
    color: 'sky',
    locked: true,
    totalLessons: 0,
    completedLessons: 0,
    progress: 0,
    lessons: [],
  },
  {
    id: MODULE_IDS.ETICA_PROFISSIONAL,
    title: 'Ética Profissional',
    description: 'Código de ética contábil e conduta profissional.',
    icon: 'Scale',
    color: 'rose',
    locked: true,
    totalLessons: 0,
    completedLessons: 0,
    progress: 0,
    lessons: [],
  },
  {
    id: MODULE_IDS.LEGALIZACAO,
    title: 'Legalização',
    description: 'Abertura, alteração e encerramento de empresas.',
    icon: 'Stamp',
    color: 'indigo',
    locked: true,
    totalLessons: 0,
    completedLessons: 0,
    progress: 0,
    lessons: [],
  },
];

// ---------------------------------------------------------------------------
// Banco de questões, organizado por módulo -> lição -> lista de questões.
// Cada questão segue o schema rico:
// { id, level, type, scenario, question, options?, correctAnswer, explanation, pacciTip }
// `checkAnswer` (em GameContext.jsx) sabe interpretar cada `type`.
// ---------------------------------------------------------------------------
export const questionBank = {
  [MODULE_IDS.REFORMA_TRIBUTARIA]: reformaTributariaQuestionBank,
  // Módulos futuros: chave presente, conteúdo vazio até a lição ser criada.
  [MODULE_IDS.CONTABILIDADE]: {},
  [MODULE_IDS.FISCAL]: {},
  [MODULE_IDS.TRABALHISTA]: {},
  [MODULE_IDS.ATENDIMENTO_CLIENTE]: {},
  [MODULE_IDS.ETICA_PROFISSIONAL]: {},
  [MODULE_IDS.LEGALIZACAO]: {},
};

// Sorteia questões de qualquer nível/lição da Reforma Tributária, usadas na
// "Lição de Manutenção/Revisão" do modo Lenda (após concluir as 270 lições).
export function getDailyReviewQuestions(count = DAILY_REVIEW_QUESTION_COUNT) {
  const pool = CAREER_LEVELS.flatMap((level) => level.questions);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ---------------------------------------------------------------------------
// `HIGHLIGHT_THRESHOLD` define a partir de que posição (dentro do ranking da
// própria empresa) o usuário ganha o selo de "Destaque no Mural da Empresa".
// Os rankings em si (por empresa e geral) são calculados dinamicamente pelo
// GameContext a partir de `seedUsers`/usuários cadastrados — ver
// `computeLeaderboard` acima.
// ---------------------------------------------------------------------------
export const HIGHLIGHT_THRESHOLD = 3;
