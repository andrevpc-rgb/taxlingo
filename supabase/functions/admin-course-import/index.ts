// supabase/functions/admin-course-import/index.ts
//
// Backend do painel "Importar Curso" (Painel de Contingência, só master,
// ver ImportCoursePanel.jsx) — recebe um JSON preparado (mesmo formato de
// src/data/questions/*.json, com um wrapper de curso em volta) e substitui
// TODO o conteúdo (lições+questões) daquele curso de uma vez, de forma
// atômica, via a RPC admin_replace_course_content (ver supabase/schema.sql).
// É o que permite publicar/atualizar um curso sem precisar de deploy de
// frontend nem rodar scripts/seed.mjs manualmente — só o master usa isto.
//
// O curso em si (metadados: id/título/ícone/cor) precisa já existir — essa
// função cuida só do conteúdo. Cadastre primeiro no painel "Metadados do
// Curso" (escrita direta, ver CourseMetadataPanel.jsx).
//
// Dois formatos de payload aceitos, conforme o curso tem ou não trilha de
// carreira:
//   { course: { id }, levels: [ { id, title, xpReward, lessonCount, questions: [...] } ] }
//     — trilha de carreira: cada nível vira N lições regulares + 1 exame de
//     transição, com o mesmo chunker de scripts/seed.mjs (buildLevelLessons).
//   { course: { id }, lessons: [ { id, title, type, xpReward, passThreshold?, questions: [...] } ] }
//     — lista direta de lições (sem chunker), pra curso sem trilha de carreira.
//
// Validação roda ANTES de qualquer escrita — se algo no payload for
// inválido (id duplicado, tipo de questão desconhecido, gabarito no
// formato errado pro tipo), devolve 400 com a lista de problemas, sem
// tocar em nada no banco.
//
// Deploy:
//   supabase functions deploy admin-course-import

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mesmas constantes de scripts/seed.mjs — mantém a densidade de lições
// (exame de 15-20 questões, lições regulares de 3+ questões) idêntica entre
// o caminho "rodar o script localmente" e o caminho "importar pelo painel".
const EXAM_PASS_THRESHOLD = 0.8;
const EXAM_QUESTION_MIN = 15;
const EXAM_QUESTION_MAX = 20;
const MIN_QUESTIONS_PER_LESSON = 3;
const VALID_QUESTION_TYPES = ['multiple_choice', 'true_false', 'ordering', 'fill_blank', 'text_input'];
const VALID_LESSON_TYPES = ['regular', 'exam'];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Idêntico ao verifyMaster() de admin-provision/index.ts — ver o comentário
// lá pra entender por que precisa de um client à parte carregando o JWT do
// chamador (sem isso, auth.uid() vem null e a policy de RLS nunca bate).
async function verifyMaster(req, supabaseAnon) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await supabaseAnon.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const supabaseAsCaller = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: profile, error: profileError } = await supabaseAsCaller
    .from('users')
    .select('id, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.role !== 'master') return null;

  return profile;
}

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

// Valida uma questão isolada, devolvendo uma lista de mensagens de erro (uma
// questão pode ter mais de um problema — junta todos de uma vez, em vez de
// forçar o master a corrigir um erro por vez e reenviar repetidamente).
function validateQuestion(q, path) {
  const errors = [];
  const id = q?.id || '(sem id)';

  if (!q?.id || typeof q.id !== 'string') errors.push(`${path} (${id}): "id" ausente ou inválido.`);
  if (!VALID_QUESTION_TYPES.includes(q?.type)) {
    errors.push(`${path} (${id}): "type" inválido ("${q?.type}") — use um de: ${VALID_QUESTION_TYPES.join(', ')}.`);
  }
  if (!q?.question || typeof q.question !== 'string') errors.push(`${path} (${id}): "question" ausente.`);
  if (q?.correctAnswer === undefined || q?.correctAnswer === null) errors.push(`${path} (${id}): "correctAnswer" ausente.`);

  if (q?.type === 'multiple_choice' || q?.type === 'true_false') {
    if (!Array.isArray(q?.options) || q.options.length < 2) {
      errors.push(`${path} (${id}): "options" precisa ser um array com 2+ itens.`);
    } else if (typeof q.correctAnswer !== 'string' || !q.options.includes(q.correctAnswer)) {
      errors.push(`${path} (${id}): "correctAnswer" precisa ser uma string igual a um dos itens de "options".`);
    }
  }

  if (q?.type === 'ordering') {
    const optionsOk = Array.isArray(q?.options);
    const answerOk = Array.isArray(q?.correctAnswer);
    if (!optionsOk) errors.push(`${path} (${id}): "options" precisa ser um array (a lista embaralhada).`);
    if (!answerOk) errors.push(`${path} (${id}): "correctAnswer" precisa ser um array (a ordem correta).`);
    if (optionsOk && answerOk) {
      const sortedOpt = [...q.options].sort();
      const sortedAns = [...q.correctAnswer].sort();
      if (q.options.length !== q.correctAnswer.length || JSON.stringify(sortedOpt) !== JSON.stringify(sortedAns)) {
        errors.push(`${path} (${id}): "correctAnswer" precisa ser exatamente "options" reordenado (mesmos itens).`);
      }
    }
  }

  if (q?.type === 'text_input' || q?.type === 'fill_blank') {
    if (typeof q?.correctAnswer !== 'string') errors.push(`${path} (${id}): "correctAnswer" precisa ser uma string.`);
  }

  return errors;
}

function toQuestionRow(q, courseId, lessonId, orderIndex, levelFallback) {
  return {
    id: q.id,
    lesson_id: lessonId,
    course_id: courseId,
    // questions.level é NOT NULL no banco — cai pro nível/lição se a questão
    // não trouxer um "level" próprio (comum no formato "lessons", que não
    // tem trilha de carreira pra herdar esse valor).
    level: q.level ?? levelFallback ?? lessonId,
    type: q.type,
    scenario: q.scenario ?? null,
    question: q.question,
    options: q.options ?? null,
    correct_answer: q.correctAnswer,
    explanation: q.explanation ?? null,
    pacci_tip: q.pacciTip ?? null,
    topic: q.topic ?? 'outros',
    order_index: orderIndex,
  };
}

// Porta exata de buildLevelLessons em scripts/seed.mjs — mesma matemática de
// chunking (exame de 13% do total, entre 15-20 questões; lições regulares
// de 3+ questões cada), pra densidade de lições ficar idêntica não importa
// se o curso foi semeado via script ou importado pelo painel.
function buildLevelLessons(courseId, level, allQuestions, startOrderIndex) {
  const total = allQuestions.length;
  if (total === 0) return { lessons: [], questions: [], nextOrderIndex: startOrderIndex };

  const rawExamSize = Math.round(total * 0.13) || EXAM_QUESTION_MIN;
  const examSize = Math.min(EXAM_QUESTION_MAX, Math.max(Math.min(EXAM_QUESTION_MIN, total), rawExamSize));
  const regularPool = allQuestions.slice(0, total - examSize);
  const examQuestions = allQuestions.slice(total - examSize);

  const maxRegularLessonsBySupply = Math.max(1, Math.floor(regularPool.length / MIN_QUESTIONS_PER_LESSON));
  const regularLessonCount = Math.max(1, Math.min(level.lessonCount - 1, maxRegularLessonsBySupply));
  const regularChunks = chunkEvenly(regularPool, regularLessonCount);

  const lessons = [];
  const questionRows = [];
  let orderIndex = startOrderIndex;

  regularChunks.forEach((qs, i) => {
    const lessonId = `${level.id}-${i + 1}`;
    lessons.push({
      id: lessonId,
      career_level_id: level.id,
      type: 'regular',
      title: `${level.title} · Lição ${i + 1}/${regularChunks.length}`,
      xp_reward: level.xpReward,
      question_count: qs.length,
      pass_threshold: null,
      order_index: orderIndex++,
    });
    qs.forEach((q, qi) => questionRows.push(toQuestionRow(q, courseId, lessonId, qi, level.id)));
  });

  if (examQuestions.length > 0) {
    const examLessonId = `${level.id}-exam`;
    lessons.push({
      id: examLessonId,
      career_level_id: level.id,
      type: 'exam',
      title: `${level.title} · Exame de Transição`,
      xp_reward: level.xpReward * 3,
      question_count: examQuestions.length,
      pass_threshold: EXAM_PASS_THRESHOLD,
      order_index: orderIndex++,
    });
    examQuestions.forEach((q, qi) => questionRows.push(toQuestionRow(q, courseId, examLessonId, qi, level.id)));
  }

  return { lessons, questions: questionRows, nextOrderIndex: orderIndex };
}

// Monta lessons+questions a partir do formato "levels" (trilha de carreira).
function buildFromLevels(courseId, levels) {
  const errors = [];
  if (!Array.isArray(levels) || levels.length === 0) {
    return { lessons: [], questions: [], errors: ['"levels" precisa ser um array com pelo menos 1 item.'] };
  }

  const seenLevelIds = new Set();
  const seenLessonIds = new Set();
  const seenQuestionIds = new Set();
  let lessons = [];
  let questions = [];
  let orderIndex = 0;

  levels.forEach((level, i) => {
    const path = `Nível #${i + 1}`;
    if (!level?.id || typeof level.id !== 'string') {
      errors.push(`${path}: "id" ausente ou inválido.`);
      return;
    }
    if (seenLevelIds.has(level.id)) errors.push(`${path}: id de nível duplicado "${level.id}".`);
    seenLevelIds.add(level.id);

    if (!level.title) errors.push(`${path} (${level.id}): "title" ausente.`);
    if (!Array.isArray(level.questions) || level.questions.length === 0) {
      errors.push(`${path} (${level.id}): "questions" precisa ser um array não vazio.`);
      return;
    }

    for (const q of level.questions) {
      errors.push(...validateQuestion(q, `${path} (${level.id})`));
      if (q?.id) {
        if (seenQuestionIds.has(q.id)) errors.push(`Questão duplicada: "${q.id}".`);
        seenQuestionIds.add(q.id);
      }
    }
  });

  if (errors.length > 0) return { lessons: [], questions: [], errors };

  for (const level of levels) {
    const lessonCount = Number(level.lessonCount) > 0 ? Math.trunc(Number(level.lessonCount)) : Math.max(2, Math.ceil(level.questions.length / 4) + 1);
    const { lessons: levelLessons, questions: levelQuestions, nextOrderIndex } = buildLevelLessons(
      courseId,
      { id: level.id, title: level.title, xpReward: Number(level.xpReward) || 20, lessonCount },
      level.questions,
      orderIndex
    );
    orderIndex = nextOrderIndex;
    for (const l of levelLessons) {
      if (seenLessonIds.has(l.id)) errors.push(`Lição duplicada: "${l.id}" (nível "${level.id}" colide com outro nível já processado — ids de nível precisam ser globalmente únicos).`);
      seenLessonIds.add(l.id);
    }
    lessons = lessons.concat(levelLessons);
    questions = questions.concat(levelQuestions);
  }

  return { lessons, questions, errors };
}

// Monta lessons+questions a partir do formato "lessons" (lista direta, sem
// chunker — pro curso sem trilha de carreira, ex: Ética Profissional).
// Duas passadas, igual buildFromLevels: valida tudo primeiro; só monta as
// linhas de lesson/question se não sobrou nenhum erro — o chamador descarta
// o resultado de qualquer forma quando `errors` não está vazio, mas manter
// as duas passadas separadas deixa o código claro em vez de misturar
// "ainda estou validando" com "já posso montar a linha".
function buildFromLessons(courseId, lessonsInput) {
  const errors = [];
  if (!Array.isArray(lessonsInput) || lessonsInput.length === 0) {
    return { lessons: [], questions: [], errors: ['"lessons" precisa ser um array com pelo menos 1 item.'] };
  }

  const seenLessonIds = new Set();
  const seenQuestionIds = new Set();

  lessonsInput.forEach((lesson, i) => {
    const path = `Lição #${i + 1}`;
    if (!lesson?.id || typeof lesson.id !== 'string') {
      errors.push(`${path}: "id" ausente ou inválido.`);
      return;
    }
    if (seenLessonIds.has(lesson.id)) errors.push(`${path}: id de lição duplicado "${lesson.id}".`);
    seenLessonIds.add(lesson.id);

    if (!lesson.title) errors.push(`${path} (${lesson.id}): "title" ausente.`);
    if (!VALID_LESSON_TYPES.includes(lesson.type)) {
      errors.push(`${path} (${lesson.id}): "type" precisa ser "regular" ou "exam" (veio "${lesson.type}").`);
    }
    if (!Array.isArray(lesson.questions) || lesson.questions.length === 0) {
      errors.push(`${path} (${lesson.id}): "questions" precisa ser um array não vazio.`);
      return;
    }

    for (const q of lesson.questions) {
      errors.push(...validateQuestion(q, `${path} (${lesson.id})`));
      if (q?.id) {
        if (seenQuestionIds.has(q.id)) errors.push(`Questão duplicada: "${q.id}".`);
        seenQuestionIds.add(q.id);
      }
    }
  });

  if (errors.length > 0) return { lessons: [], questions: [], errors };

  const lessons = [];
  const questions = [];
  lessonsInput.forEach((lesson, i) => {
    lessons.push({
      id: lesson.id,
      career_level_id: lesson.careerLevelId ?? null,
      type: lesson.type,
      title: lesson.title,
      xp_reward: Number(lesson.xpReward) || 20,
      question_count: lesson.questions.length,
      pass_threshold: lesson.type === 'exam' ? Number(lesson.passThreshold) || EXAM_PASS_THRESHOLD : null,
      order_index: i,
    });
    lesson.questions.forEach((q, qi) => questions.push(toQuestionRow(q, courseId, lesson.id, qi, lesson.id)));
  });

  return { lessons, questions, errors };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const supabaseAnon = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const caller = await verifyMaster(req, supabaseAnon);
  if (!caller) {
    return jsonResponse({ error: 'Acesso restrito à conta master.' }, 403);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo da requisição inválido (não é um JSON válido).' }, 400);
  }

  const courseId = payload?.course?.id;
  if (!courseId || typeof courseId !== 'string') {
    return jsonResponse({ error: '"course.id" ausente — informe o id do curso (ele precisa já existir).' }, 400);
  }

  const supabaseService = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existingCourse, error: courseError } = await supabaseService
    .from('courses')
    .select('id')
    .eq('id', courseId)
    .maybeSingle();
  if (courseError) return jsonResponse({ error: courseError.message }, 500);
  if (!existingCourse) {
    return jsonResponse(
      { error: `Curso "${courseId}" não encontrado. Cadastre o curso primeiro no painel "Metadados do Curso" antes de importar o conteúdo.` },
      400
    );
  }

  let built;
  if (Array.isArray(payload.levels)) {
    built = buildFromLevels(courseId, payload.levels);
  } else if (Array.isArray(payload.lessons)) {
    built = buildFromLessons(courseId, payload.lessons);
  } else {
    return jsonResponse({ error: 'O payload precisa ter "levels" ou "lessons" (array) — veja o exemplo no painel.' }, 400);
  }

  if (built.errors.length > 0) {
    return jsonResponse(
      { error: `Validação falhou (${built.errors.length} problema(s) encontrado(s)):\n${built.errors.slice(0, 25).join('\n')}` },
      400
    );
  }
  if (built.lessons.length === 0) {
    return jsonResponse({ error: 'Nenhuma lição válida encontrada no payload.' }, 400);
  }

  const { error: rpcError } = await supabaseService.rpc('admin_replace_course_content', {
    p_course_id: courseId,
    p_lessons: built.lessons,
    p_questions: built.questions,
  });
  if (rpcError) {
    console.error('admin_replace_course_content failed:', rpcError);
    return jsonResponse({ error: rpcError.message || 'Falha ao gravar o conteúdo do curso.' }, 500);
  }

  return jsonResponse({
    courseId,
    lessonsCount: built.lessons.length,
    questionsCount: built.questions.length,
  });
});
