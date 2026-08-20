// supabase/functions/nitrus-webhook/index.ts
//
// Endpoint de webhook da Nitrus. Configure esta URL (depois do deploy) no
// painel da Nitrus:
//   https://SEU-PROJETO.supabase.co/functions/v1/nitrus-webhook
//
// (A tarefa original pedia o endpoint em "/api/nitrus-webhook" — este
// projeto não tem um backend próprio além das Edge Functions do Supabase,
// então o endpoint segue o mesmo padrão já usado pro Asaas:
// /functions/v1/<nome-da-function>. Se a Nitrus for chamada a partir de um
// backend separado no futuro, é só expor essa mesma lógica lá em
// /api/nitrus-webhook.)
//
// Ao confirmar um pagamento:
//   - Se a referência é de uma empresa NOVA (pending_signups), cria a
//     empresa em `companies` (com um company_code novo), ativa a
//     assinatura e manda o e-mail de boas-vindas com o código.
//   - Se a referência é de uma empresa JÁ existente (`company:<id>`, ver
//     create-nitrus-checkout), só ativa a assinatura dela — igual ao
//     asaas-webhook.
//
// Deploy:
//   supabase functions deploy nitrus-webhook --no-verify-jwt
//   supabase secrets set NITRUS_WEBHOOK_TOKEN=escolha-um-token-secreto
//   (o mesmo token precisa ser cadastrado no painel da Nitrus, no campo de
//   autenticação do webhook — é assim que confirmamos que a chamada
//   realmente veio de lá. --no-verify-jwt é necessário porque a Nitrus não
//   manda um JWT do Supabase.)
//
// ##############################################################################
// ATENÇÃO — INTEGRAÇÃO NÃO VERIFICADA: assim como em create-nitrus-checkout,
// não há documentação pública da Nitrus disponível pra confirmar o nome do
// header de autenticação, o formato exato do payload (nome do evento,
// onde fica a referência externa) ou a lista de eventos possíveis. O código
// abaixo assume um payload no formato `{ event, data: { externalReference,
// ... } }` e aceita algumas variações comuns de nome de evento
// ("payment.confirmed", "PAYMENT_CONFIRMED" etc.) — ajuste
// `CONFIRMED_EVENTS`/`FAILED_EVENTS` e a leitura do payload assim que tiver
// a documentação real ou um payload de teste da Nitrus em mãos.
// ##############################################################################

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

const CONFIRMED_EVENTS = new Set([
  'payment.confirmed',
  'payment.received',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'charge.paid',
]);
const FAILED_EVENTS = new Set([
  'payment.failed',
  'payment.overdue',
  'payment.canceled',
  'PAYMENT_FAILED',
  'PAYMENT_OVERDUE',
  'PAYMENT_CANCELED',
]);

const PLAN_SEATS = { individual: 1, starter: 10, pro: 50 };

function generateTempPassword() {
  // Fácil de digitar/copiar do e-mail, mas com entropia suficiente.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Faixa Unicode das marcas de acento combinantes (usada por generateCompanyCode
// depois de normalize('NFD')) — escrita como \u para não depender de como o
// editor grava caracteres combinantes literais no arquivo.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function sendActivationEmail({ to, companyName, companyCode, plan }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <contato@taxlingo.com.br>';
  if (!RESEND_API_KEY || !to) return; // e-mail é um "nice to have" — não derruba a ativação se faltar

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject: `Assinatura TaxLingo ativada — plano ${plan}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin:0 auto;">
          <h2 style="color:#059669;">Pagamento confirmado! 🎉</h2>
          <p>A assinatura do plano <strong>${plan}</strong> de <strong>${companyName}</strong> está ativa.</p>
          <p>Compartilhe este código com os colaboradores pra eles se cadastrarem no TaxLingo:</p>
          <p style="font-size:24px; font-weight:bold; background:#f0fdf4; padding:12px 20px; border-radius:12px; text-align:center;">${companyCode}</p>
        </div>
      `,
    }),
  }).catch((err) => console.error('sendActivationEmail failed (non-fatal):', err));
}

// E-mail do Plano Individual: credenciais de login prontas (a conta já é
// criada aqui, ao contrário do Starter/Pro, onde só o company_code é
// mandado e a pessoa se cadastra normalmente depois).
async function sendIndividualWelcomeEmail({ to, tempPassword }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <contato@taxlingo.com.br>';
  if (!RESEND_API_KEY || !to) return;

  const appUrl = Deno.env.get('APP_URL') || 'https://taxlingo.vercel.app';

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject: 'Sua conta TaxLingo está pronta! 🎉',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin:0 auto;">
          <h2 style="color:#059669;">Pagamento confirmado — bem-vindo(a) ao TaxLingo!</h2>
          <p>Sua conta individual já está ativa. Seus dados de acesso:</p>
          <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding:8px; background:#f0fdf4; border-radius:8px 8px 0 0;"><strong>E-mail:</strong></td><td style="padding:8px; background:#f0fdf4;">${to}</td></tr>
            <tr><td style="padding:8px; background:#f0fdf4; border-radius:0 0 8px 8px;"><strong>Senha temporária:</strong></td><td style="padding:8px; background:#f0fdf4;"><code>${tempPassword}</code></td></tr>
          </table>
          <p><a href="${appUrl}" style="background:#10b981; color:white; padding:10px 20px; border-radius:12px; text-decoration:none; font-weight:bold;">Entrar no TaxLingo</a></p>
          <p style="color:#94a3b8; font-size:12px;">Recomendamos trocar essa senha assim que entrar (Meu Perfil → Alterar senha).</p>
        </div>
      `,
    }),
  }).catch((err) => console.error('sendIndividualWelcomeEmail failed (non-fatal):', err));
}

// Gera um código curto e legível a partir do nome da empresa (ex.: "Grupo
// Fenix Contábil" -> "FENIX4821") e tenta até achar um que não colida com
// `companies.company_code` (unique).
async function generateCompanyCode(supabase, companyName) {
  const slug =
    companyName
      .normalize('NFD')
      .replace(COMBINING_MARKS_RE, '')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 6) || 'EMPRESA';

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const candidate = `${slug}${suffix}`;
    const { data: existing } = await supabase
      .from('companies')
      .select('id')
      .eq('company_code', candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  // Fallback extremamente improvável de precisar, mas garante que a função
  // nunca trave numa colisão de sorte grande.
  return `${slug}${Date.now().toString().slice(-6)}`;
}

async function activateExistingCompany(supabase, companyId, { subscriptionId, plan, periodEnd }) {
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase.from('subscriptions').upsert(
    {
      id: existingSub?.id,
      company_id: companyId,
      plan,
      status: 'active',
      seats_limit: PLAN_SEATS[plan] ?? 10,
      nitrus_subscription_id: subscriptionId ?? null,
      current_period_end: periodEnd,
    },
    { onConflict: 'id' }
  );

  const { data: company } = await supabase
    .from('companies')
    .select('name, company_code')
    .eq('id', companyId)
    .single();

  const { data: admin } = await supabase
    .from('users')
    .select('email')
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();

  if (company) {
    await sendActivationEmail({ to: admin?.email, companyName: company.name, companyCode: company.company_code, plan });
  }
}

async function activatePendingSignup(supabase, pending, { subscriptionId, periodEnd }) {
  // Toda ativação (Individual ou Corporativa) começa criando uma empresa —
  // é o que satisfaz a FK obrigatória de `users.company_id`/`subscriptions.company_id`.
  // A diferença é o que acontece DEPOIS: Corporativo manda o company_code
  // pra alguém se cadastrar; Individual já cria a própria conta de usuário
  // (a empresa fica invisível, é só um detalhe de implementação).
  const companyCode = await generateCompanyCode(supabase, pending.company_name);

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert({ name: pending.company_name, company_code: companyCode })
    .select('id, name, company_code')
    .single();
  if (companyError) throw companyError;

  await supabase.from('subscriptions').insert({
    company_id: company.id,
    plan: pending.plan,
    status: 'active',
    seats_limit: PLAN_SEATS[pending.plan] ?? 10,
    nitrus_subscription_id: subscriptionId ?? null,
    current_period_end: periodEnd,
  });

  await supabase
    .from('pending_signups')
    .update({ status: 'completed', company_id: company.id })
    .eq('id', pending.id);

  if (pending.plan === 'individual') {
    const tempPassword = generateTempPassword();
    const { error: createUserError } = await supabase.auth.admin.createUser({
      email: pending.admin_email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: pending.admin_name || pending.admin_email.split('@')[0],
        company_id: company.id,
        avatar_url: '🙂',
      },
    });
    // Se o e-mail já tiver conta (ex.: reenvio de webhook depois de já ter
    // criado da primeira vez), não é um erro fatal — só não manda senha
    // nova (a pessoa já tem acesso).
    if (createUserError && !createUserError.message?.includes('already been registered')) {
      throw createUserError;
    }
    if (!createUserError) {
      await sendIndividualWelcomeEmail({ to: pending.admin_email, tempPassword });
    }
    return;
  }

  await sendActivationEmail({
    to: pending.admin_email,
    companyName: company.name,
    companyCode: company.company_code,
    plan: pending.plan,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);

  const expectedToken = Deno.env.get('NITRUS_WEBHOOK_TOKEN');
  const receivedToken = req.headers.get('nitrus-webhook-token') || req.headers.get('x-nitrus-token');
  if (expectedToken && receivedToken !== expectedToken) {
    return jsonResponse({ error: 'Token de webhook inválido.' }, 401);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo inválido.' }, 400);
  }

  const event = payload?.event ?? payload?.type;
  const data = payload?.data ?? payload;
  const externalReference = data?.externalReference ?? data?.external_reference ?? data?.reference;
  const subscriptionId = data?.subscriptionId ?? data?.subscription?.id ?? data?.id ?? null;
  const periodEnd = data?.nextDueDate ? new Date(data.nextDueDate).toISOString() : null;

  if (!event || !externalReference) {
    // Evento sem referência reconhecível — confirma recebimento sem agir,
    // pra Nitrus não ficar retentando um evento que nunca vamos processar.
    return jsonResponse({ ok: true, ignored: true });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const isConfirmed = CONFIRMED_EVENTS.has(event);
    const isFailed = FAILED_EVENTS.has(event);
    if (!isConfirmed && !isFailed) {
      return jsonResponse({ ok: true, ignored: true });
    }

    if (externalReference.startsWith('company:')) {
      const companyId = externalReference.slice('company:'.length);
      if (isConfirmed) {
        await activateExistingCompany(supabase, companyId, {
          subscriptionId,
          plan: data?.plan ?? 'starter',
          periodEnd,
        });
      } else {
        await supabase
          .from('subscriptions')
          .update({ status: event.toLowerCase().includes('overdue') ? 'past_due' : 'canceled' })
          .eq('company_id', companyId);
      }
      return jsonResponse({ ok: true });
    }

    if (externalReference.startsWith('pending:')) {
      const { data: pending } = await supabase
        .from('pending_signups')
        .select('*')
        .eq('external_reference', externalReference)
        .eq('status', 'pending')
        .maybeSingle();

      if (!pending) {
        // Já processado antes (reenvio de webhook) ou referência desconhecida.
        return jsonResponse({ ok: true, ignored: true });
      }

      if (isConfirmed) {
        await activatePendingSignup(supabase, pending, { subscriptionId, periodEnd });
      } else {
        await supabase.from('pending_signups').update({ status: 'expired' }).eq('id', pending.id);
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: true, ignored: true });
  } catch (err) {
    console.error('nitrus-webhook failed:', err);
    // 200 mesmo em erro interno (depois de validar o token) evita que a
    // Nitrus fique retentando indefinidamente um evento que sempre vai
    // falhar por um bug nosso; o erro fica logado pra investigar manualmente.
    return jsonResponse({ ok: false, error: err.message }, 200);
  }
});
