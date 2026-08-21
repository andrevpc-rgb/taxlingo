// supabase/functions/admin-provision/index.ts
//
// Backend do "Painel de Contingência" — só acessível a quem está logado
// com role='master' (o fundador). Existe pra cobrir o caso do link de
// pagamento do Asaas falhar: em vez de depender só do webhook, o master
// consegue liberar Plano Individual ou Plano Corporativo na mão, direto
// pela interface.
//
// IMPORTANTE: a checagem de "é master mesmo?" acontece AQUI, no servidor,
// usando o JWT de quem chamou (supabase-js manda automaticamente no header
// Authorization) — nunca confia só no fato do botão estar visível no
// front-end. Ver verifyMaster() abaixo.
//
// Ações (`action` no corpo da requisição):
//   - "list_leads": lista os leads de Plano Corporativo (pending_signups
//     com status='pending' e plan != 'individual') ainda não ativados.
//   - "create_individual": cria uma conta do Plano Individual na hora —
//     mesmo formato do fluxo automático (nitrus-webhook/asaas-webhook):
//     empresa invisível de 1 vaga + conta de usuário + 30 dias de acesso.
//   - "create_corporate": cria (ou ativa, se pendingSignupId for passado)
//     uma empresa Corporativa com código, limite de vagas e vencimento.
//
// Deploy:
//   supabase functions deploy admin-provision
//   (usa as mesmas RESEND_API_KEY/RESEND_FROM_EMAIL/APP_URL já configuradas
//   pelas outras functions de e-mail — não precisa de secret novo.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INDIVIDUAL_ACCESS_DAYS = 30;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function generateCompanyCode(supabase, label) {
  const slug =
    label
      .normalize('NFD')
      .replace(COMBINING_MARKS_RE, '')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 6) || 'EMPRESA';

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const candidate = `${slug}${suffix}`;
    const { data: existing } = await supabase.from('companies').select('id').eq('company_code', candidate).maybeSingle();
    if (!existing) return candidate;
  }
  return `${slug}${Date.now().toString().slice(-6)}`;
}

async function sendEmail({ to, subject, html }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <contato@taxlingo.com.br>';
  if (!RESEND_API_KEY || !to) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], subject, html }),
  }).catch((err) => console.error('sendEmail failed (non-fatal):', err));
}

// Confere quem está chamando: pega o JWT do header Authorization (mandado
// automaticamente pelo supabase-js quando o usuário está logado), identifica
// o usuário, e olha o role dele em public.users. Devolve null se não for master.
async function verifyMaster(req, supabaseAnon) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const { data: userData, error: userError } = await supabaseAnon.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userError || !userData?.user) return null;

  const { data: profile, error: profileError } = await supabaseAnon
    .from('users')
    .select('id, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.role !== 'master') return null;

  return profile;
}

async function listLeads(supabaseService) {
  const { data, error } = await supabaseService
    .from('pending_signups')
    .select('id, company_name, admin_email, cpf_cnpj, seats_requested, created_at')
    .eq('status', 'pending')
    .neq('plan', 'individual')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createIndividual(supabaseService, { email, name }) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Informe um e-mail válido.');
  }

  const companyLabel = `Conta Individual — ${name || normalizedEmail}`;
  const companyCode = await generateCompanyCode(supabaseService, companyLabel);
  const { data: company, error: companyError } = await supabaseService
    .from('companies')
    .insert({ name: companyLabel, company_code: companyCode })
    .select('id')
    .single();
  if (companyError) throw companyError;

  const expiresAt = new Date(Date.now() + INDIVIDUAL_ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await supabaseService.from('subscriptions').insert({
    company_id: company.id,
    plan: 'individual',
    status: 'active',
    seats_limit: 1,
    current_period_end: expiresAt,
  });

  const tempPassword = generateTempPassword();
  const { error: createUserError } = await supabaseService.auth.admin.createUser({
    email: normalizedEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name: name || normalizedEmail.split('@')[0],
      company_id: company.id,
      avatar_url: '🙂',
      trial_expires_at: expiresAt,
    },
  });
  if (createUserError && !createUserError.message?.includes('already been registered')) {
    throw createUserError;
  }

  if (!createUserError) {
    await sendEmail({
      to: normalizedEmail,
      subject: 'Sua conta TaxLingo está pronta! 🎉',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin:0 auto;">
          <h2 style="color:#059669;">Bem-vindo(a) ao TaxLingo!</h2>
          <p>Sua conta individual foi liberada manualmente pelo nosso time. Seus dados de acesso:</p>
          <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>E-mail:</strong></td><td style="padding:8px; background:#f0fdf4;">${normalizedEmail}</td></tr>
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>Senha temporária:</strong></td><td style="padding:8px; background:#f0fdf4;"><code>${tempPassword}</code></td></tr>
          </table>
          <p><a href="https://taxlingo.com.br" style="background:#10b981; color:white; padding:10px 20px; border-radius:12px; text-decoration:none; font-weight:bold;">Entrar no TaxLingo</a></p>
        </div>
      `,
    });
  }

  return { companyCode, tempPassword: createUserError ? null : tempPassword, alreadyExisted: Boolean(createUserError) };
}

async function createCorporate(supabaseService, { companyName, cnpj, maxUsers, expiresInDays, pendingSignupId }) {
  const name = String(companyName ?? '').trim();
  if (!name) throw new Error('Informe o nome da empresa.');

  const companyCode = await generateCompanyCode(supabaseService, name);
  const expiresAt = expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000).toISOString() : null;
  const seatsLimit = maxUsers != null && maxUsers !== '' ? Math.trunc(Number(maxUsers)) : null;

  const { data: company, error: companyError } = await supabaseService
    .from('companies')
    .insert({ name, company_code: companyCode, max_users: seatsLimit, expires_at: expiresAt })
    .select('id, name, company_code')
    .single();
  if (companyError) throw companyError;

  await supabaseService.from('subscriptions').insert({
    company_id: company.id,
    plan: seatsLimit && seatsLimit > 10 ? 'pro' : 'starter',
    status: 'active',
    seats_limit: seatsLimit ?? 999,
    current_period_end: expiresAt,
  });

  let leadEmail = null;
  if (pendingSignupId) {
    const { data: lead } = await supabaseService
      .from('pending_signups')
      .select('admin_email')
      .eq('id', pendingSignupId)
      .maybeSingle();
    leadEmail = lead?.admin_email ?? null;
    await supabaseService
      .from('pending_signups')
      .update({ status: 'completed', company_id: company.id })
      .eq('id', pendingSignupId);
  }

  if (leadEmail) {
    await sendEmail({
      to: leadEmail,
      subject: `Plano Corporativo ativado — ${company.name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin:0 auto;">
          <h2 style="color:#059669;">Plano Corporativo ativado! 🎉</h2>
          <p>O plano de <strong>${company.name}</strong> está ativo. Compartilhe este código com os colaboradores pra eles se cadastrarem no TaxLingo:</p>
          <p style="font-size:24px; font-weight:bold; background:#f0fdf4; padding:12px 20px; border-radius:12px; text-align:center;">${company.company_code}</p>
        </div>
      `,
    });
  }

  return { companyId: company.id, companyCode: company.company_code, notified: Boolean(leadEmail) };
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
    return jsonResponse({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const supabaseService = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    switch (payload?.action) {
      case 'list_leads':
        return jsonResponse({ leads: await listLeads(supabaseService) });
      case 'create_individual':
        return jsonResponse(await createIndividual(supabaseService, payload));
      case 'create_corporate':
        return jsonResponse(await createCorporate(supabaseService, payload));
      default:
        return jsonResponse({ error: 'Ação inválida.' }, 400);
    }
  } catch (err) {
    console.error('admin-provision failed:', err);
    return jsonResponse({ error: err.message || 'Falha na operação.' }, 500);
  }
});
