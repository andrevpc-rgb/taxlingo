// supabase/functions/create-corporate-lead/index.ts
//
// Recebe o formulário público "Plano Corporativo" (AuthModal.jsx —
// CorporatePlanSection): nome da empresa, CNPJ, e-mail e telefone do
// responsável, e a quantidade de vagas desejadas (ou o plano já escolhido).
// Substitui o antigo submit-corporate-lead (só guardava o lead pro time
// comercial ativar na mão pelo Painel de Contingência) — agora o fluxo é
// automático:
//   1. Acha ou cria o cliente no Asaas pelo CNPJ.
//   2. Cria um Link de Pagamento (Payment Link) — diferente de uma
//      assinatura (create-asaas-checkout), um Payment Link é uma URL fixa
//      e reutilizável: o RH só abre e paga, sem precisar logar em lugar
//      nenhum antes.
//   3. Manda a proposta comercial por e-mail (Resend) com o botão
//      "Concluir Assinatura Corporativa" apontando pra esse link.
//   4. Guarda tudo em pending_signups, incluindo o payment_link_id — é
//      assim que o asaas-webhook casa o pagamento confirmado com esta
//      proposta e cria a empresa de verdade (ver activateCorporateLead lá).
//
// Deploy:
//   supabase functions deploy create-corporate-lead
//   supabase secrets set ASAAS_API_KEY=xxx
//   (RESEND_API_KEY/RESEND_FROM_EMAIL já devem estar configurados pelas
//   outras functions de e-mail — reaproveitados aqui. ASAAS_ENV é
//   opcional, padrão 'production', mesma convenção das outras functions
//   Asaas deste projeto. SALES_NOTIFICATION_EMAIL, se configurada, também
//   recebe um aviso interno — best-effort.)
//
// ATENÇÃO: não testado contra a API real do Asaas nesta sessão — a forma
// exata dos campos de /v3/customers e /v3/paymentLinks segue a
// documentação pública no momento em que isto foi escrito. Confira
// https://docs.asaas.com antes de confiar em produção, e reenvie um
// webhook de teste do painel do Asaas pra validar a ativação de ponta a
// ponta antes do primeiro cliente de verdade.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mesmos preços/vagas de create-asaas-checkout/index.ts e
// asaas-webhook/index.ts (CORPORATE_PLANS) — mantenha os três em sincronia
// se o preço mudar.
const PLANS = {
  starter: { label: 'Starter', seatsLimit: 30, value: 297.0 },
  pro: { label: 'Pro', seatsLimit: 50, value: 497.0 },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function asaasBaseUrl() {
  // Mesmo padrão do asaas-webhook/create-asaas-checkout: assume produção
  // por padrão, só cai pro sandbox se ASAAS_ENV=sandbox for definida.
  const env = Deno.env.get('ASAAS_ENV') || 'production';
  return env === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
}

async function asaasFetch(path, options = {}) {
  const apiKey = Deno.env.get('ASAAS_API_KEY');
  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada nos secrets da função.');
  const res = await fetch(`${asaasBaseUrl()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', access_token: apiKey, ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Asaas ${path} falhou (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

// Prioriza o plano explícito (planType/plan_type), se vier; senão estima
// pelo número de vagas pedidas — mesma régua de create-asaas-checkout.
function resolvePlan(seatsRequested, explicitPlan) {
  if (explicitPlan && PLANS[explicitPlan]) return explicitPlan;
  if (seatsRequested && seatsRequested > PLANS.starter.seatsLimit) return 'pro';
  return 'starter';
}

// Evita criar um cliente Asaas duplicado a cada lead novo da mesma
// empresa — busca pelo CNPJ antes de criar um novo.
async function findOrCreateAsaasCustomer({ name, email, phone, cnpj }) {
  const existing = await asaasFetch(`/customers?cpfCnpj=${cnpj}`);
  if (existing?.data?.length) return existing.data[0].id;

  const created = await asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify({ name, email, phone: phone || undefined, cpfCnpj: cnpj }),
  });
  return created.id;
}

async function createPaymentLink({ plan, companyName, externalReference }) {
  const planConfig = PLANS[plan];
  return await asaasFetch('/paymentLinks', {
    method: 'POST',
    body: JSON.stringify({
      name: `TaxLingo — Plano ${planConfig.label} (${companyName})`,
      description: `Assinatura mensal do TaxLingo, plano ${planConfig.label} (até ${planConfig.seatsLimit} colaboradores).`,
      billingType: 'UNDEFINED', // deixa o pagador escolher PIX, boleto ou cartão
      chargeType: 'RECURRENT',
      subscriptionCycle: 'MONTHLY',
      value: planConfig.value,
      dueDateLimitDays: 5,
      externalReference,
    }),
  });
}

async function sendProposalEmail({ to, companyName, plan, paymentUrl }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <contato@taxlingo.com.br>';
  if (!RESEND_API_KEY || !to) {
    console.error('sendProposalEmail: RESEND_API_KEY ou destinatário ausente — e-mail não enviado.', { to: Boolean(to), hasKey: Boolean(RESEND_API_KEY) });
    return;
  }
  const planConfig = PLANS[plan];

  console.log('Enviando e-mail para:', to);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [to],
        subject: `Proposta TaxLingo para ${companyName} — Plano ${planConfig.label}`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin:0 auto;">
            <h2 style="color:#059669;">TaxLingo — treinamento gamificado da Reforma Tributária</h2>
            <p>Olá! Recebemos o interesse de <strong>${companyName}</strong> no TaxLingo, a plataforma que prepara sua equipe fiscal/contábil para a Reforma Tributária de forma prática e gamificada (estilo Duolingo).</p>
            <p>Preparamos uma proposta no <strong>Plano ${planConfig.label}</strong> — até ${planConfig.seatsLimit} colaboradores, R$ ${planConfig.value.toFixed(2).replace('.', ',')}/mês.</p>
            <p style="text-align:center; margin: 28px 0;">
              <a href="${paymentUrl}" style="background:#10b981; color:white; padding:14px 28px; border-radius:12px; text-decoration:none; font-weight:bold; font-size:16px;">Concluir Assinatura Corporativa</a>
            </p>
            <p style="color:#94a3b8; font-size:12px;">Assim que o pagamento for confirmado, o código da empresa é gerado e o acesso da equipe é liberado automaticamente — sem burocracia.</p>
          </div>
        `,
      }),
    });
    const resendData = await res.json().catch(() => ({}));
    console.log('Resposta Resend:', JSON.stringify(resendData));
    if (!res.ok) console.error('Erro Resend:', resendData);
  } catch (resendError) {
    console.error('Erro Resend:', resendError);
  }
}

// Aviso interno pro time comercial — best-effort, não derruba o envio da
// proposta se o e-mail falhar ou se SALES_NOTIFICATION_EMAIL não estiver
// configurada.
async function notifySalesTeam({ companyName, cnpj, contactEmail, plan, paymentUrl }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <contato@taxlingo.com.br>';
  const salesEmail = Deno.env.get('SALES_NOTIFICATION_EMAIL');
  if (!RESEND_API_KEY || !salesEmail) return;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [salesEmail],
      subject: `Proposta enviada — Plano Corporativo: ${companyName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin:0 auto;">
          <h2 style="color:#059669;">Proposta enviada automaticamente</h2>
          <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>Empresa:</strong></td><td style="padding:8px; background:#f0fdf4;">${companyName}</td></tr>
            <tr><td style="padding:8px;"><strong>CNPJ:</strong></td><td style="padding:8px;">${cnpj}</td></tr>
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>Plano:</strong></td><td style="padding:8px; background:#f0fdf4;">${plan}</td></tr>
            <tr><td style="padding:8px;"><strong>Responsável:</strong></td><td style="padding:8px;">${contactEmail}</td></tr>
          </table>
          <p><a href="${paymentUrl}">${paymentUrl}</a></p>
        </div>
      `,
    }),
  }).catch((err) => console.error('notifySalesTeam failed (non-fatal):', err));
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

  const companyName = String(payload?.companyName ?? payload?.company_name ?? '').trim();
  const cnpj = String(payload?.cnpj ?? '').replace(/\D/g, '');
  const contactEmail = String(payload?.contactEmail ?? payload?.email ?? '').trim().toLowerCase();
  const phone = String(payload?.phone ?? '').trim();
  const seatsRequested = Number.isFinite(Number(payload?.seatsRequested ?? payload?.seats_requested))
    ? Math.trunc(Number(payload.seatsRequested ?? payload.seats_requested))
    : null;
  const explicitPlan = payload?.planType ?? payload?.plan_type ?? null;

  if (!companyName) return jsonResponse({ error: 'Informe o nome da empresa.' }, 400);
  if (cnpj.length !== 14) return jsonResponse({ error: 'Informe um CNPJ válido (14 dígitos).' }, 400);
  if (!contactEmail || !contactEmail.includes('@')) return jsonResponse({ error: 'Informe um e-mail válido.' }, 400);
  if (seatsRequested !== null && seatsRequested <= 0) {
    return jsonResponse({ error: 'A quantidade de vagas precisa ser maior que zero.' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const plan = resolvePlan(seatsRequested, explicitPlan);
    const externalReference = `lead:${crypto.randomUUID()}`;

    await findOrCreateAsaasCustomer({ name: companyName, email: contactEmail, phone, cnpj });
    const paymentLink = await createPaymentLink({ plan, companyName, externalReference });
    const paymentUrl = paymentLink?.url;
    if (!paymentUrl) throw new Error('Link de pagamento criado, mas o Asaas não devolveu a URL.');

    const { error } = await supabase.from('pending_signups').insert({
      external_reference: externalReference,
      company_name: companyName,
      admin_email: contactEmail,
      admin_phone: phone || null,
      cpf_cnpj: cnpj,
      seats_requested: seatsRequested,
      plan,
      payment_link_id: paymentLink.id,
      status: 'pending',
    });
    if (error) throw error;

    await sendProposalEmail({ to: contactEmail, companyName, plan, paymentUrl });
    await notifySalesTeam({ companyName, cnpj, contactEmail, plan, paymentUrl });

    return jsonResponse({ ok: true, paymentUrl });
  } catch (err) {
    console.error('create-corporate-lead failed:', err);
    return jsonResponse({ error: err.message || 'Não foi possível gerar a proposta.' }, 500);
  }
});
