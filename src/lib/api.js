// src/lib/api.js
//
// Camada de acesso a dados do Supabase. Toda função aqui devolve objetos já
// no formato camelCase que o resto do app (Header, QuizEngine, Leaderboard,
// AdminDashboard, UserProfile...) já espera — assim GameContext.jsx é o
// único lugar que realmente precisa saber que os dados agora vêm de rede.
//
// Convenção: funções lançam (throw) o erro do Supabase quando falham;
// quem chama decide como tratar (GameContext costuma capturar e guardar em
// `authError`/estado de erro).

import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Mapeamento DB (snake_case) <-> app (camelCase)
// ---------------------------------------------------------------------------
export function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.full_name,
    jobTitle: row.job_title,
    role: row.role,
    companyId: row.company_id,
    avatarUrl: row.avatar_url,
    xp: row.xp,
    level: row.level,
    lives: row.lives,
    maxLives: row.max_lives,
    streak: row.streak,
    streakFreezes: row.streak_freezes,
    gems: row.gems,
    weeklyXp: row.weekly_xp,
    weekStart: row.week_start,
    lastHeartLostAt: row.last_heart_lost_at,
    lastStudyDate: row.last_study_date,
    currentLevelId: row.current_level_id,
    currentLevelSince: row.current_level_since,
    timeSpentMinutes: row.time_spent_minutes,
    trialExpiresAt: row.trial_expires_at,
    // Vem de um select aninhado (`companies(expires_at)`, ver fetchProfile)
    // quando o usuário tem company_id — vencimento herdado do plano
    // Corporativo da empresa, ver isAccessExpired() em GameContext.jsx.
    companyExpiresAt: row.companies?.expires_at ?? null,
  };
}

// Inverso de mapUserRow, só para as colunas que a UI tem permissão de
// alterar via updateProfile/updateGameStats (nunca id, email, role, company_id).
function toUserPatch(patch) {
  const map = {
    name: 'full_name',
    jobTitle: 'job_title',
    avatarUrl: 'avatar_url',
    xp: 'xp',
    level: 'level',
    lives: 'lives',
    maxLives: 'max_lives',
    streak: 'streak',
    streakFreezes: 'streak_freezes',
    gems: 'gems',
    weeklyXp: 'weekly_xp',
    weekStart: 'week_start',
    lastHeartLostAt: 'last_heart_lost_at',
    lastStudyDate: 'last_study_date',
    currentLevelId: 'current_level_id',
    currentLevelSince: 'current_level_since',
    timeSpentMinutes: 'time_spent_minutes',
  };
  const dbPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = map[key];
    if (column) dbPatch[column] = value;
  }
  return dbPatch;
}

export function mapLessonRow(row) {
  return {
    id: row.id,
    moduleId: row.module_id,
    careerLevelId: row.career_level_id,
    type: row.type,
    title: row.title,
    xpReward: row.xp_reward,
    questionCount: row.question_count,
    passThreshold: row.pass_threshold,
    orderIndex: row.order_index,
  };
}

export function mapQuestionRow(row) {
  return {
    id: row.id,
    level: row.level,
    type: row.type,
    scenario: row.scenario,
    question: row.question,
    options: row.options,
    correctAnswer: row.correct_answer,
    explanation: row.explanation,
    pacciTip: row.pacci_tip,
  };
}

function mapModuleRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    icon: row.icon,
    color: row.color,
    locked: !row.is_available,
    orderIndex: row.order_index,
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export async function getCompanyByCode(code) {
  const normalized = String(code ?? '').trim().toUpperCase();
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, company_code')
    .eq('company_code', normalized)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, name: data.name, code: data.company_code } : null;
}

// Checa código de empresa + plano ativo + vaga disponível ANTES de tentar
// criar a conta (RPC SECURITY DEFINER, ver check_company_capacity() no
// schema.sql — precisa rodar antes de existir sessão, por isso não é uma
// query direta em `companies`/`users`). Devolve mensagem amigável pronta
// pra mostrar; a garantia de verdade continua sendo o trigger
// handle_new_auth_user() no banco (roda de novo, dentro da transação).
export async function checkCompanyCapacity(companyCode) {
  const { data, error } = await supabase.rpc('check_company_capacity', { p_company_code: companyCode });
  if (error) throw error;
  return data?.[0] ?? { is_valid: false, reason: 'Código de empresa inválido.', company_id: null };
}

export async function signUp({ email, password, fullName, jobTitle, companyCode }) {
  const capacity = await checkCompanyCapacity(companyCode);
  if (!capacity.is_valid) {
    throw new Error(capacity.reason || 'Código de empresa inválido. Confira com o seu RH.');
  }

  const avatarPool = ['👩‍💼', '🧑‍💼', '👩‍💻', '🧑‍💻', '👩', '🧑'];
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        job_title: jobTitle || null,
        company_id: capacity.company_id,
        avatar_url: avatarPool[Math.floor(Math.random() * avatarPool.length)],
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Chama a Edge Function que cria a conta de teste de 24h e dispara o
// e-mail com as credenciais (ver supabase/functions/send-trial-email).
export async function requestTrialAccess(email) {
  const { data, error } = await supabase.functions.invoke('send-trial-email', { body: { email } });
  if (error) {
    // supabase-js embrulha erros HTTP não-2xx em FunctionsHttpError; o corpo
    // com a mensagem amigável da function fica em error.context.
    const message = data?.error || error.message || 'Não foi possível criar o acesso de teste.';
    throw new Error(message);
  }
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Senha vive em auth.users (gerenciada pelo Supabase Auth), não em
// public.users — por isso é uma chamada separada de updateProfile().
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// "Esqueci minha senha": manda um e-mail com um link que loga o usuário numa
// sessão de recuperação (evento PASSWORD_RECOVERY, ver onAuthStateChange
// abaixo) — é essa sessão que permite trocar a senha em updatePassword(),
// sem precisar saber a senha antiga.
export async function resetPasswordForEmail(email) {
  const redirectTo = `${window.location.origin}/`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

// Repassa o tipo do evento (não só a sessão) — GameContext precisa
// distinguir PASSWORD_RECOVERY de um logout/expiração de token comuns.
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(session, event));
  return () => data.subscription.unsubscribe();
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------
export async function fetchProfile(userId) {
  // `companies(expires_at)` é um select aninhado via FK (users.company_id
  // -> companies.id) — traz o vencimento do plano Corporativo (se houver)
  // na mesma consulta, sem precisar de uma segunda ida ao banco.
  const { data, error } = await supabase
    .from('users')
    .select('*, companies(expires_at)')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return mapUserRow(data);
}

export async function updateProfile(userId, patch) {
  const { data, error } = await supabase
    .from('users')
    .update(toUserPatch(patch))
    .eq('id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return mapUserRow(data);
}

// Atualiza só as estatísticas de jogo (xp, vidas, streak, tempo...) — mesma
// tabela do perfil, mas separado por clareza semântica em quem chama.
export const updateGameStats = updateProfile;

// ---------------------------------------------------------------------------
// Conteúdo (módulos / lições / questões)
// ---------------------------------------------------------------------------
export async function fetchModules() {
  const { data, error } = await supabase.from('modules').select('*').order('order_index');
  if (error) throw error;
  return data.map(mapModuleRow);
}

export async function fetchLessonsForModule(moduleId) {
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .eq('module_id', moduleId)
    .order('order_index');
  if (error) throw error;
  return data.map(mapLessonRow);
}

// Carregada sob demanda (não no login) — 1000 questões de uma vez seria
// pesado; cada lição só busca suas próprias ~3-20 questões quando é aberta.
export async function fetchQuestionsForLesson(lessonId) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('lesson_id', lessonId)
    .order('order_index');
  if (error) throw error;
  return data.map(mapQuestionRow);
}

// Usada pela "Lição de Manutenção/Revisão" do modo Lenda — sorteia questões
// de qualquer nível. Com ~1000 linhas o custo de trazer tudo e embaralhar no
// cliente é irrelevante; se o banco de questões crescer muito, troque por
// uma function `ORDER BY random() LIMIT n` no Postgres.
export async function fetchRandomQuestions(count) {
  const { data, error } = await supabase.from('questions').select('*');
  if (error) throw error;
  const shuffled = [...data].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(mapQuestionRow);
}

// ---------------------------------------------------------------------------
// Progresso do usuário
// ---------------------------------------------------------------------------
export async function fetchUserProgress(userId) {
  const { data, error } = await supabase
    .from('user_progress')
    .select('*')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    lessonId: row.lesson_id,
    completedAt: row.completed_at,
    score: row.score,
    passed: row.passed,
  }));
}

export async function recordLessonProgress({ userId, lessonId, score = null, passed = null }) {
  const { data, error } = await supabase
    .from('user_progress')
    .insert({
      user_id: userId,
      lesson_id: lessonId,
      completed_at: new Date().toISOString(),
      score,
      passed,
    })
    .select('*')
    .single();
  if (error) throw error;
  return { id: data.id, lessonId: data.lesson_id, completedAt: data.completed_at, score: data.score, passed: data.passed };
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------
export async function fetchCompanyLeaderboard(companyId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, avatar_url, job_title, company_id, xp, weekly_xp')
    .eq('company_id', companyId)
    .order('xp', { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.full_name,
    avatarUrl: row.avatar_url,
    jobTitle: row.job_title,
    companyId: row.company_id,
    xp: row.xp,
    weeklyXp: row.weekly_xp,
  }));
}

export async function fetchGlobalLeaderboard() {
  const { data, error } = await supabase.rpc('get_global_leaderboard');
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    name: row.full_name,
    avatarUrl: row.avatar_url,
    jobTitle: row.job_title,
    companyId: row.company_id,
    xp: row.xp,
    weeklyXp: row.weekly_xp,
  }));
}

export async function fetchCompanyUsers(companyId) {
  const { data, error } = await supabase.from('users').select('*').eq('company_id', companyId);
  if (error) throw error;
  return data.map(mapUserRow);
}

// ---------------------------------------------------------------------------
// Assinatura (checkout Asaas)
// ---------------------------------------------------------------------------
export async function fetchSubscription(companyId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    plan: data.plan,
    status: data.status,
    seatsLimit: data.seats_limit,
    currentPeriodEnd: data.current_period_end,
  };
}

// Chama a Edge Function que cria a assinatura no Asaas e devolve a URL de
// checkout (PIX/cartão) pra redirecionar o navegador.
export async function createCheckoutSession({ companyId, plan, cpfCnpj }) {
  const { data, error } = await supabase.functions.invoke('create-asaas-checkout', {
    body: { companyId, plan, cpfCnpj },
  });
  if (error) {
    const message = data?.error || error.message || 'Não foi possível iniciar o checkout.';
    throw new Error(message);
  }
  return data; // { checkoutUrl }
}

// Mesma ideia, via Nitrus (ver supabase/functions/create-nitrus-checkout —
// integração não verificada contra a API real, ver aviso no topo daquele
// arquivo). Aceita tanto uma empresa já cadastrada (`companyId`) quanto uma
// empresa nova (`companyName`/`adminName`), caso em que a empresa só passa
// a existir de fato quando o nitrus-webhook confirmar o pagamento.
export async function createNitrusCheckoutSession({ companyId, companyName, adminName, adminEmail, plan, cpfCnpj }) {
  const { data, error } = await supabase.functions.invoke('create-nitrus-checkout', {
    body: { companyId, companyName, adminName, adminEmail, plan, cpfCnpj },
  });
  if (error) {
    const message = data?.error || error.message || 'Não foi possível iniciar o checkout.';
    throw new Error(message);
  }
  return data; // { checkoutUrl }
}

export async function fetchCompanies() {
  const { data, error } = await supabase.from('companies').select('id, name, company_code');
  if (error) throw error;
  return data.map((c) => ({ id: c.id, name: c.name, code: c.company_code }));
}

// ---------------------------------------------------------------------------
// Plano Corporativo — lead público + contingência do master
// ---------------------------------------------------------------------------

// Formulário público "Plano Corporativo" (AuthModal.jsx) — não é checkout,
// é captura de lead: alguém do time comercial (ou o master, ver
// adminProvisionCorporate) entra em contato depois pra fechar e ativar de
// verdade. Vai para a Edge Function em vez de INSERT direto porque
// `pending_signups` não tem policy nenhuma de RLS liberada pro cliente
// (ver schema.sql) — só service_role toca nessa tabela.
export async function submitCorporateLead({ companyName, cnpj, contactEmail, seatsRequested }) {
  const { data, error } = await supabase.functions.invoke('submit-corporate-lead', {
    body: { companyName, cnpj, contactEmail, seatsRequested },
  });
  if (error) {
    const message = data?.error || error.message || 'Não foi possível enviar sua solicitação.';
    throw new Error(message);
  }
  return data;
}

// Painel de Contingência (master): lista os leads de Plano Corporativo
// ainda não ativados, e libera Plano Individual/Corporativo manualmente —
// pro caso do link de pagamento do Asaas falhar. A Edge Function confere
// de novo, no servidor, que quem está chamando é role='master' (nunca
// confia só no fato de o botão estar visível no front).
export async function fetchPendingCorporateLeads() {
  const { data, error } = await supabase.functions.invoke('admin-provision', {
    body: { action: 'list_leads' },
  });
  if (error) {
    const message = data?.error || error.message || 'Não foi possível carregar os leads.';
    throw new Error(message);
  }
  return data.leads;
}

export async function adminProvisionIndividual({ email, name }) {
  const { data, error } = await supabase.functions.invoke('admin-provision', {
    body: { action: 'create_individual', email, name },
  });
  if (error) {
    const message = data?.error || error.message || 'Não foi possível criar o acesso individual.';
    throw new Error(message);
  }
  return data;
}

export async function adminProvisionCorporate({ companyName, cnpj, maxUsers, expiresInDays, pendingSignupId }) {
  const { data, error } = await supabase.functions.invoke('admin-provision', {
    body: { action: 'create_corporate', companyName, cnpj, maxUsers, expiresInDays, pendingSignupId },
  });
  if (error) {
    const message = data?.error || error.message || 'Não foi possível criar/ativar a empresa.';
    throw new Error(message);
  }
  return data;
}
