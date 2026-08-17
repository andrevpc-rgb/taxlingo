// scripts/seed.mjs
//
// Popula um projeto Supabase novo (ou reseta os dados de TESTE) para o
// TaxLingo: 3 empresas, 12 usuários de demonstração, a conta master do
// fundador, e o banco de módulos/lições/questões migrado de src/data/.
//
// ATENÇÃO: usa a SERVICE ROLE KEY, que ignora RLS — nunca rode isso a
// partir do navegador, nem exponha essa chave com prefixo VITE_. Este
// script só deve rodar localmente ou em CI, nunca no bundle do cliente.
//
// Uso:
//   1. Copie .env.example para .env e preencha SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY e MASTER_PASSWORD.
//   2. node scripts/seed.mjs
//
// É seguro rodar mais de uma vez: empresas/usuários de teste são upsert por
// email/código; o conteúdo (módulos/lições/questões) é upsert por id.
// O reset só apaga dados ligados às 3 empresas de demonstração (ALFA2026,
// BETA2026, GAMMA2026) — nunca toca em empresas reais/clientes.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_DIR = join(__dirname, '..', 'src', 'data', 'questions');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MASTER_EMAIL = process.env.MASTER_EMAIL || 'andrevpc@gmail.com';
const MASTER_PASSWORD = process.env.MASTER_PASSWORD;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env. Veja .env.example.');
  process.exit(1);
}
if (!MASTER_PASSWORD) {
  console.error('Defina MASTER_PASSWORD no .env (senha da conta master, escolha uma senha forte).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Config de conteúdo — precisa ficar em sincronia com CAREER_LEVELS e as
// constantes de src/data/mockData.js (duplicado aqui de propósito: este
// script roda em Node puro, sem o bundler do Vite, então lê os JSON via fs
// em vez do `import` nativo que o app usa no navegador).
// ---------------------------------------------------------------------------
const EXAM_PASS_THRESHOLD = 0.8;
const EXAM_QUESTION_MIN = 15;
const EXAM_QUESTION_MAX = 20;
const MIN_QUESTIONS_PER_LESSON = 3;

const CAREER_LEVELS = [
  { id: 'estagiario', title: 'Estagiário', xpReward: 20, lessonCount: 39, file: 'reforma_tributaria_estagiario.json' },
  { id: 'auxiliar', title: 'Auxiliar', xpReward: 25, lessonCount: 39, file: 'reforma_tributaria_auxiliar.json' },
  { id: 'assistente', title: 'Assistente', xpReward: 30, lessonCount: 39, file: 'reforma_tributaria_assistente.json' },
  { id: 'analista_junior', title: 'Analista Júnior', xpReward: 35, lessonCount: 39, file: 'reforma_tributaria_analista_junior.json' },
  { id: 'analista_pleno', title: 'Analista Pleno', xpReward: 40, lessonCount: 38, file: 'reforma_tributaria_analista_pleno.json' },
  { id: 'analista_senior', title: 'Analista Sênior', xpReward: 45, lessonCount: 38, file: 'reforma_tributaria_analista_senior.json' },
  { id: 'especialista', title: 'Especialista', xpReward: 50, lessonCount: 38, file: 'reforma_tributaria_especialista.json' },
];

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

function buildLevelLessons(level, allQuestions) {
  const total = allQuestions.length;
  if (total === 0) return { lessons: [], questions: [] };

  const rawExamSize = Math.round(total * 0.13) || EXAM_QUESTION_MIN;
  const examSize = Math.min(EXAM_QUESTION_MAX, Math.max(Math.min(EXAM_QUESTION_MIN, total), rawExamSize));
  const regularPool = allQuestions.slice(0, total - examSize);
  const examQuestions = allQuestions.slice(total - examSize);

  const maxRegularLessonsBySupply = Math.max(1, Math.floor(regularPool.length / MIN_QUESTIONS_PER_LESSON));
  const regularLessonCount = Math.max(1, Math.min(level.lessonCount - 1, maxRegularLessonsBySupply));
  const regularChunks = chunkEvenly(regularPool, regularLessonCount);

  const lessons = [];
  const questionRows = [];
  let orderIndex = 0;

  regularChunks.forEach((qs, i) => {
    const lessonId = `${level.id}-${i + 1}`;
    lessons.push({
      id: lessonId,
      module_id: 'reforma-tributaria',
      career_level_id: level.id,
      type: 'regular',
      title: `${level.title} · Lição ${i + 1}/${regularChunks.length}`,
      xp_reward: level.xpReward,
      question_count: qs.length,
      pass_threshold: null,
      order_index: orderIndex++,
    });
    qs.forEach((q, qi) => questionRows.push(toQuestionRow(q, lessonId, qi)));
  });

  if (examQuestions.length > 0) {
    const examLessonId = `${level.id}-exam`;
    lessons.push({
      id: examLessonId,
      module_id: 'reforma-tributaria',
      career_level_id: level.id,
      type: 'exam',
      title: `${level.title} · Exame de Transição`,
      xp_reward: level.xpReward * 3,
      question_count: examQuestions.length,
      pass_threshold: EXAM_PASS_THRESHOLD,
      order_index: orderIndex++,
    });
    examQuestions.forEach((q, qi) => questionRows.push(toQuestionRow(q, examLessonId, qi)));
  }

  return { lessons, questions: questionRows };
}

function toQuestionRow(q, lessonId, orderIndex) {
  return {
    id: q.id,
    lesson_id: lessonId,
    level: q.level,
    type: q.type,
    scenario: q.scenario ?? null,
    question: q.question,
    options: q.options ?? null,
    correct_answer: q.correctAnswer,
    explanation: q.explanation ?? null,
    pacci_tip: q.pacciTip ?? null,
    order_index: orderIndex,
  };
}

async function upsertInBatches(table, rows, batchSize = 500) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`Falha ao gravar em ${table}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Módulos (7 no total — só "reforma-tributaria" com conteúdo por enquanto)
// ---------------------------------------------------------------------------
async function seedModules() {
  console.log('→ Módulos...');
  const modules = [
    { id: 'reforma-tributaria', title: 'Reforma Tributária', description: 'Do Estagiário ao Especialista: IBS, CBS, Imposto Seletivo e a transição da EC 132/2023.', icon: 'Landmark', color: 'emerald', is_available: true, order_index: 0 },
    { id: 'contabilidade', title: 'Contabilidade', description: 'Fundamentos de escrituração, balanços e demonstrações contábeis.', icon: 'Calculator', color: 'blue', is_available: false, order_index: 1 },
    { id: 'fiscal', title: 'Fiscal', description: 'Obrigações acessórias, apuração de tributos e SPED.', icon: 'FileSpreadsheet', color: 'amber', is_available: false, order_index: 2 },
    { id: 'trabalhista', title: 'Trabalhista', description: 'Folha de pagamento, eSocial e legislação trabalhista.', icon: 'Briefcase', color: 'purple', is_available: false, order_index: 3 },
    { id: 'atendimento-cliente', title: 'Atendimento ao Cliente', description: 'Excelência e comunicação no relacionamento com o cliente.', icon: 'Headset', color: 'sky', is_available: false, order_index: 4 },
    { id: 'etica-profissional', title: 'Ética Profissional', description: 'Código de ética contábil e conduta profissional.', icon: 'Scale', color: 'rose', is_available: false, order_index: 5 },
    { id: 'legalizacao', title: 'Legalização', description: 'Abertura, alteração e encerramento de empresas.', icon: 'Stamp', color: 'indigo', is_available: false, order_index: 6 },
  ];
  await upsertInBatches('modules', modules);
  console.log(`  ${modules.length} módulos ok.`);
}

// ---------------------------------------------------------------------------
// 2. Lições + questões (lidas de src/data/questions/*.json)
// ---------------------------------------------------------------------------
async function seedContent() {
  console.log('→ Lições e questões (isso demora um pouco, são ~1000 questões)...');
  let totalLessons = 0;
  let totalQuestions = 0;

  for (const level of CAREER_LEVELS) {
    const raw = readFileSync(join(QUESTIONS_DIR, level.file), 'utf-8');
    const questions = JSON.parse(raw);
    const { lessons, questions: questionRows } = buildLevelLessons(level, questions);

    await upsertInBatches('lessons', lessons);
    await upsertInBatches('questions', questionRows);

    totalLessons += lessons.length;
    totalQuestions += questionRows.length;
    console.log(`  ${level.title}: ${lessons.length} lições, ${questionRows.length} questões.`);
  }

  console.log(`  Total: ${totalLessons} lições, ${totalQuestions} questões.`);
}

// ---------------------------------------------------------------------------
// 3. Empresas de demonstração
// ---------------------------------------------------------------------------
const DEMO_COMPANIES = [
  { name: 'Contabilidade Alfa', company_code: 'ALFA2026' },
  { name: 'Beta Consultoria Fiscal', company_code: 'BETA2026' },
  { name: 'Grupo Gamma Contábil', company_code: 'GAMMA2026' },
];

async function resetDemoData() {
  console.log('→ Limpando dados de teste antigos (só das 3 empresas de demonstração)...');
  const { data: companies } = await supabase
    .from('companies')
    .select('id')
    .in('company_code', DEMO_COMPANIES.map((c) => c.company_code));

  const companyIds = (companies ?? []).map((c) => c.id);
  if (companyIds.length === 0) {
    console.log('  Nada para limpar (primeira execução).');
    return;
  }

  const { data: users } = await supabase.from('users').select('id').in('company_id', companyIds);
  const userIds = (users ?? []).map((u) => u.id);

  if (userIds.length > 0) {
    await supabase.from('user_progress').delete().in('user_id', userIds);
    // Apaga o auth.users de cada um — isso remove a linha em public.users em cascata.
    for (const id of userIds) {
      await supabase.auth.admin.deleteUser(id).catch(() => {});
    }
  }
  await supabase.from('subscriptions').delete().in('company_id', companyIds);
  console.log(`  ${userIds.length} usuários de teste removidos.`);
}

async function seedCompanies() {
  console.log('→ Empresas de demonstração...');
  const { data, error } = await supabase
    .from('companies')
    .upsert(DEMO_COMPANIES, { onConflict: 'company_code' })
    .select('id, company_code');
  if (error) throw new Error(`Falha ao gravar companies: ${error.message}`);
  console.log(`  ${data.length} empresas ok.`);
  return Object.fromEntries(data.map((c) => [c.company_code, c.id]));
}

// ---------------------------------------------------------------------------
// 4. Usuários de demonstração (auth.users + public.users)
// ---------------------------------------------------------------------------
const DEMO_USERS = [
  { email: 'andreia@alfa.com', full_name: 'Andréia Silva', job_title: 'Analista Fiscal', role: 'employee', companyCode: 'ALFA2026', avatar_url: '👩‍💼', xp: 1240, streak: 7, gems: 50 },
  { email: 'marcos@alfa.com', full_name: 'Marcos Vinícius', job_title: 'Gerente Fiscal', role: 'admin', companyCode: 'ALFA2026', avatar_url: '🧑‍💼', xp: 2180, streak: 21, gems: 120 },
  { email: 'camila@alfa.com', full_name: 'Camila Nogueira', job_title: 'Analista Contábil', role: 'employee', companyCode: 'ALFA2026', avatar_url: '👩‍💻', xp: 1950, streak: 15, gems: 30 },
  { email: 'rafael@alfa.com', full_name: 'Rafael Souza', job_title: 'Analista Trabalhista', role: 'employee', companyCode: 'ALFA2026', avatar_url: '🧑', xp: 1190, streak: 4, gems: 10 },
  { email: 'juliana@beta.com', full_name: 'Juliana Prado', job_title: 'Coordenadora de Legalização', role: 'admin', companyCode: 'BETA2026', avatar_url: '👩', xp: 1050, streak: 9, gems: 40 },
  { email: 'bruno@beta.com', full_name: 'Bruno Costa', job_title: 'Atendimento ao Cliente', role: 'employee', companyCode: 'BETA2026', avatar_url: '🧑‍💼', xp: 980, streak: 3, gems: 15 },
  { email: 'fernanda@beta.com', full_name: 'Fernanda Lima', job_title: 'Compliance', role: 'employee', companyCode: 'BETA2026', avatar_url: '👩‍🏫', xp: 870, streak: 6, gems: 5 },
  { email: 'diego@beta.com', full_name: 'Diego Martins', job_title: 'Analista Fiscal', role: 'employee', companyCode: 'BETA2026', avatar_url: '🧑‍💻', xp: 740, streak: 1, gems: 0 },
  { email: 'patricia@gamma.com', full_name: 'Patrícia Alves', job_title: 'Sócia Contábil', role: 'admin', companyCode: 'GAMMA2026', avatar_url: '👩‍💼', xp: 1600, streak: 18, gems: 60 },
  { email: 'lucas@gamma.com', full_name: 'Lucas Ferreira', job_title: 'Analista Fiscal', role: 'employee', companyCode: 'GAMMA2026', avatar_url: '🧑', xp: 1420, streak: 10, gems: 25 },
  { email: 'renata@gamma.com', full_name: 'Renata Souza', job_title: 'Analista Trabalhista', role: 'employee', companyCode: 'GAMMA2026', avatar_url: '👩', xp: 1100, streak: 5, gems: 8 },
  { email: 'thiago@gamma.com', full_name: 'Thiago Barros', job_title: 'Legalização', role: 'employee', companyCode: 'GAMMA2026', avatar_url: '🧑‍💻', xp: 690, streak: 0, gems: 0 },
];
const DEMO_PASSWORD = 'demo123';

async function seedDemoUsers(companyIdByCode) {
  console.log('→ Usuários de demonstração (senha padrão: demo123)...');
  for (const demo of DEMO_USERS) {
    const companyId = companyIdByCode[demo.companyCode];
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: demo.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: demo.full_name,
        job_title: demo.job_title,
        company_id: companyId,
        avatar_url: demo.avatar_url,
      },
    });
    if (createError && !createError.message.includes('already been registered')) {
      throw new Error(`Falha ao criar ${demo.email}: ${createError.message}`);
    }

    const userId = created?.user?.id;
    if (userId) {
      // O trigger já criou a linha em public.users com os campos básicos;
      // aqui completamos com o restante do perfil de demonstração (xp, role, etc).
      const { error: updateError } = await supabase
        .from('users')
        .update({ role: demo.role, xp: demo.xp, streak: demo.streak, gems: demo.gems, current_level_id: 'estagiario' })
        .eq('id', userId);
      if (updateError) throw new Error(`Falha ao atualizar perfil de ${demo.email}: ${updateError.message}`);
    }
  }
  console.log(`  ${DEMO_USERS.length} usuários de demonstração ok.`);
}

// ---------------------------------------------------------------------------
// 5. Conta Master (fundador) — acesso total, todas as lições desbloqueadas
// ---------------------------------------------------------------------------
async function seedMasterAccount(companyIdByCode) {
  console.log(`→ Conta master (${MASTER_EMAIL})...`);
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: MASTER_EMAIL,
    password: MASTER_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: 'Fundador TaxLingo',
      job_title: 'Founder',
      company_id: companyIdByCode.ALFA2026, // vínculo só pra ter um "lar"; master enxerga tudo
      avatar_url: '👑',
    },
  });

  let userId = created?.user?.id;
  if (createError) {
    if (!createError.message.includes('already been registered')) {
      throw new Error(`Falha ao criar conta master: ${createError.message}`);
    }
    // Já existe — busca o id pra promover a master mesmo assim.
    const { data: list } = await supabase.auth.admin.listUsers();
    userId = list?.users?.find((u) => u.email === MASTER_EMAIL)?.id;
  }

  if (userId) {
    const { error: updateError } = await supabase
      .from('users')
      .update({ role: 'master', xp: 999999 })
      .eq('id', userId);
    if (updateError) throw new Error(`Falha ao promover conta master: ${updateError.message}`);
    console.log('  Conta master pronta (role = master).');
    console.log(
      '  Nota: "todas as 270 lições desbloqueadas" é tratado no client (src/lib/api.js) — quando role === "master", a UI ignora o trancamento normal de lições, em vez de fabricar 270 linhas falsas de progresso.'
    );
  }
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
async function main() {
  const shouldReset = process.argv.includes('--reset');

  await seedModules();
  await seedContent();

  if (shouldReset) {
    await resetDemoData();
  }

  const companyIdByCode = await seedCompanies();
  await seedDemoUsers(companyIdByCode);
  await seedMasterAccount(companyIdByCode);

  console.log('\n✅ Seed concluído.');
}

main().catch((err) => {
  console.error('\n❌ Seed falhou:', err.message);
  process.exit(1);
});
