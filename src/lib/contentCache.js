// src/lib/contentCache.js
//
// Cache do bundle de questões de um curso (lições em si não entram aqui —
// são leves e sempre buscadas direto, ver api.fetchLessonsForCourse). Guarda
// em IndexedDB, não localStorage: o bundle de um curso só (Reforma
// Tributária) já é ~1,2MB de JSON; localStorage tem uma cota de origem de
// ~5-10MB que ficaria apertada com vários cursos cacheados ao mesmo tempo.
//
// Estratégia de invalidação: carimbo de versão (courses.content_version),
// não TTL. ensureCourseContent() é o único ponto de entrada: decide se o
// cache bate com a versão atual do servidor e só refaz o download pesado
// quando NÃO bate — abrir o mesmo curso de novo depois (mesma aba ou sessão
// nova) não baixa o bundle inteiro de novo enquanto o master não reimportar
// esse curso (ver admin_replace_course_content no schema.sql).

const DB_NAME = 'taxlingo_content_cache';
const DB_VERSION = 1;
const STORE_NAME = 'course_bundles';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'courseId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readFromDb(courseId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(courseId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function writeToDb(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Ponto de entrada único. `fetchVersion`/`fetchBundle` são injetados (ver
// api.fetchCourseContentVersion/fetchCourseContentBundle) pra este módulo
// não depender do cliente Supabase diretamente — facilita testar a lógica
// de cache isolada, com funções fake, sem precisar de rede nenhuma.
//
// Fluxo:
// 1. Pergunta ao servidor a versão atual (query leve, 1 linha).
// 2. Se bater com o que já está em cache, devolve o cache (sem rebaixar o
//    bundle pesado).
// 3. Se não bater (ou não tiver cache), baixa o bundle pesado e grava.
// 4. Se o passo 1 falhar (Supabase fora do ar) e EXISTIR cache (de qualquer
//    versão), devolve o cache mesmo assim (`stale: true`) — melhor deixar
//    continuar treinando com conteúdo levemente desatualizado do que travar.
// 5. Se falhar e NÃO existir cache, propaga o erro — quem chamou decide a
//    tela de erro (ver AppShell: "Não foi possível carregar este curso.").
export async function ensureCourseContent(courseId, { fetchVersion, fetchBundle }) {
  let cached = null;
  try {
    cached = await readFromDb(courseId);
  } catch {
    // IndexedDB indisponível (ex.: modo anônimo/privado de alguns
    // navegadores com cota zero) — segue sem cache, sempre busca da rede.
  }

  let serverVersion;
  try {
    serverVersion = await fetchVersion(courseId);
  } catch (err) {
    if (cached) return { questionBank: cached.questionBank, version: cached.version, stale: true };
    throw err;
  }

  if (cached && cached.version === serverVersion) {
    return { questionBank: cached.questionBank, version: cached.version, stale: false };
  }

  const questionBank = await fetchBundle(courseId);
  try {
    await writeToDb({ courseId, version: serverVersion, questionBank, fetchedAt: Date.now() });
  } catch {
    // Gravar o cache é best-effort — a sessão atual já tem o bundle em
    // memória de qualquer forma, só não fica persistido pro próximo login.
  }
  return { questionBank, version: serverVersion, stale: false };
}
