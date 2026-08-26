// supabase/functions/public-register/index.ts
//
// Cadastro público (RegisterForm no AuthModal.jsx): Nome, E-mail, Senha,
// Cargo e Código da Empresa. Antes disso rodava direto no cliente via
// supabase.auth.signUp() — o que deixa a conta "sem sessão" até confirmar
// o e-mail sempre que o projeto tiver "Confirm email" ligado no painel do
// Supabase (Authentication > Providers > Email). Esta function cria a
// conta já confirmada (email_confirm: true, igual ao "Testar Grátis" e ao
// Painel de Contingência) — o cliente só precisa fazer signInWithPassword
// logo em seguida pra já cair autenticado, sem depender de e-mail nenhum.
//
// A validação de capacidade/vencimento da empresa roda 2x, igual ao fluxo
// antigo: aqui (pré-checagem via check_company_capacity, mensagem amigável)
// e de novo dentro do trigger handle_new_auth_user() no banco (garantia de
// verdade, fecha a janela de corrida).
//
// Deploy:
//   supabase functions deploy public-register
//   (não precisa de secret novo — só SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY,
//   que já existem automaticamente no runtime de toda Edge Function.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AVATAR_POOL = ['👩‍💼', '🧑‍💼', '👩‍💻', '🧑‍💻', '👩', '🧑'];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const fullName = String(payload?.fullName ?? '').trim();
  const email = String(payload?.email ?? '').trim().toLowerCase();
  const password = String(payload?.password ?? '');
  const jobTitle = String(payload?.jobTitle ?? '').trim() || null;
  const companyCode = String(payload?.companyCode ?? '').trim();

  if (!fullName || !email || !password) return jsonResponse({ error: 'Preencha nome, e-mail e senha.' }, 400);
  if (!email.includes('@')) return jsonResponse({ error: 'Informe um e-mail válido.' }, 400);
  if (!companyCode) return jsonResponse({ error: 'Informe o código da empresa.' }, 400);

  const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const { data: capacityRows, error: capacityError } = await supabaseService.rpc('check_company_capacity', {
      p_company_code: companyCode,
    });
    if (capacityError) throw capacityError;
    const capacity = capacityRows?.[0];
    if (!capacity?.is_valid) {
      return jsonResponse({ error: capacity?.reason || 'Código de empresa inválido. Confira com o seu RH.' }, 400);
    }

    const { data: created, error: createError } = await supabaseService.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        job_title: jobTitle,
        company_id: capacity.company_id,
        avatar_url: AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)],
      },
    });

    if (createError) {
      if (createError.message?.includes('already been registered')) {
        return jsonResponse({ error: 'Já existe uma conta com esse e-mail.' }, 409);
      }
      // Erro do trigger handle_new_auth_user() (empresa vencida/lotada) chega
      // aqui embrulhado — a mensagem já é a amigável definida lá no banco.
      throw createError;
    }

    return jsonResponse({ ok: true, userId: created.user?.id });
  } catch (err) {
    console.error('public-register failed:', err);
    return jsonResponse({ error: err.message || 'Não foi possível cadastrar.' }, 500);
  }
});
