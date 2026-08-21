// supabase/functions/send-trial-email/index.ts
//
// Edge Function do botão "Testar Grátis por 24 Horas" do AuthModal.jsx.
// Recebe { email }, cria uma conta de teste com senha temporária (válida
// por 24h), registra em temp_access_tokens e envia as credenciais por
// e-mail via Resend.
//
// Deploy:
//   supabase functions deploy send-trial-email
//   supabase secrets set RESEND_API_KEY=re_xxx RESEND_FROM_EMAIL="TaxLingo <contato@taxlingo.com.br>"
//   (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente no
//   runtime de toda Edge Function — não precisa configurar manualmente.)
//
// Chamada pelo cliente: supabase.functions.invoke('send-trial-email', { body: { email } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TRIAL_HOURS = 24;
const TRIAL_COMPANY_CODE = 'TRIAL';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function generateTempPassword() {
  // Fácil de digitar/copiar do e-mail, mas com entropia suficiente pra 24h de vida.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function ensureTrialCompany(supabase) {
  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .eq('company_code', TRIAL_COMPANY_CODE)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('companies')
    .insert({ name: 'TaxLingo — Teste Grátis', company_code: TRIAL_COMPANY_CODE })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}

async function sendTrialEmail({ to, tempPassword, expiresAt }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <contato@taxlingo.com.br>';
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY não configurada nos secrets da função.');
  }

  const expiresLabel = new Date(expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  console.log('Enviando e-mail para:', to);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [to],
        subject: 'Seu acesso de teste ao TaxLingo (válido por 24h)',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color:#059669;">Ciao! Bem-vindo(a) ao TaxLingo 🧾</h2>
            <p>Sua conta de teste grátis está pronta. Acesso válido por <strong>${TRIAL_HOURS} horas</strong>, até <strong>${expiresLabel}</strong>.</p>
            <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding:8px; background:#f0fdf4; border-radius:8px 8px 0 0;"><strong>E-mail:</strong></td><td style="padding:8px; background:#f0fdf4;">${to}</td></tr>
              <tr><td style="padding:8px; background:#f0fdf4; border-radius:0 0 8px 8px;"><strong>Senha temporária:</strong></td><td style="padding:8px; background:#f0fdf4;"><code>${tempPassword}</code></td></tr>
            </table>
            <p><a href="https://taxlingo.com.br" style="background:#10b981; color:white; padding:10px 20px; border-radius:12px; text-decoration:none; font-weight:bold;">Entrar no TaxLingo</a></p>
            <p style="color:#94a3b8; font-size:12px;">Depois de ${TRIAL_HOURS}h esse acesso expira automaticamente. Gostou? Peça ao seu RH o código da empresa pra criar uma conta definitiva.</p>
          </div>
        `,
      }),
    });

    const resendData = await res.json().catch(() => ({}));
    console.log('Resposta Resend:', JSON.stringify(resendData));

    if (!res.ok) {
      throw new Error(`Falha ao enviar e-mail via Resend: ${res.status} ${JSON.stringify(resendData)}`);
    }
  } catch (resendError) {
    console.error('Erro Resend:', resendError);
    throw resendError;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);

  let email;
  try {
    ({ email } = await req.json());
  } catch {
    return jsonResponse({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return jsonResponse({ error: 'Informe um e-mail válido.' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // Evita reenvio em loop: se já existe um token válido (não expirado)
    // pra esse e-mail, não cria outro.
    const { data: activeToken } = await supabase
      .from('temp_access_tokens')
      .select('id, expires_at')
      .eq('email', normalizedEmail)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (activeToken) {
      return jsonResponse(
        { error: 'Você já tem um acesso de teste ativo. Confira seu e-mail ou aguarde ele expirar.' },
        409
      );
    }

    const tempPassword = generateTempPassword();
    const expiresAt = new Date(Date.now() + TRIAL_HOURS * 60 * 60 * 1000).toISOString();
    const companyId = await ensureTrialCompany(supabase);

    // Cria (ou, se o e-mail já existir como usuário normal, rejeita — teste
    // grátis é só pra quem ainda não tem conta) a conta de autenticação.
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: normalizedEmail.split('@')[0],
        company_id: companyId,
        avatar_url: '🎟️',
        trial_expires_at: expiresAt,
      },
    });

    if (createError) {
      if (createError.message?.includes('already been registered')) {
        return jsonResponse(
          { error: 'Já existe uma conta com esse e-mail. Faça login normalmente ou peça o código da sua empresa.' },
          409
        );
      }
      throw createError;
    }

    await supabase.from('temp_access_tokens').insert({
      email: normalizedEmail,
      temp_password: tempPassword,
      expires_at: expiresAt,
    });

    await sendTrialEmail({ to: normalizedEmail, tempPassword, expiresAt });

    return jsonResponse({ ok: true, expiresAt });
  } catch (err) {
    console.error('send-trial-email failed:', err);
    return jsonResponse({ error: err.message || 'Falha ao criar acesso de teste.' }, 500);
  }
});
