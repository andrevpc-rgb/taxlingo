// supabase/functions/asaas-webhook/index.ts
//
// Endpoint de webhook do Asaas. Configure esta URL (depois do deploy) em
// Asaas > Configurações > Integrações > Webhooks:
//   https://SEU-PROJETO.supabase.co/functions/v1/asaas-webhook
//
// Trata três casos bem diferentes:
//   1. Plano Corporativo (Starter/Pro), caminho normal: o pagamento vem de
//      uma assinatura criada pela nossa própria create-asaas-checkout
//      (SubscriptionModal.jsx, modo Renovação/Upgrade), então já existe uma
//      linha em `subscriptions` com o `asaas_subscription_id` — soma 30
//      dias em companies.expires_at e ajusta companies.max_users conforme
//      o plano (ver applyCorporateRenewal).
//   2. Plano Corporativo, fallback por CNPJ: pagamento sem essa assinatura
//      correlacionada (ex.: cobrança avulsa feita direto no painel do
//      Asaas) mas cujo CNPJ do cliente bate com `companies.cnpj` — mesma
//      renovação do caso 1, e a assinatura é correlacionada aqui pra a
//      PRÓXIMA renovação já cair no caminho normal.
//   3. Plano Individual: o pagamento vem do link de pagamento FIXO do
//      Asaas (configurado direto no painel deles, sem passar pela nossa
//      create-asaas-checkout) e sem CNPJ correspondente — buscamos os
//      dados do cliente na API do Asaas (nome/e-mail) e criamos a conta na
//      hora, com acesso válido por 30 dias (renovado a cada pagamento
//      mensal reconhecido).
//
// Deploy:
//   supabase functions deploy asaas-webhook --no-verify-jwt
//   supabase secrets set ASAAS_WEBHOOK_TOKEN=escolha-um-token-secreto
//   supabase secrets set ASAAS_API_KEY=xxx
//   (ASAAS_ENV é opcional e o padrão já é 'production' — só defina como
//   ASAAS_ENV=sandbox se ASAAS_API_KEY for uma chave de sandbox ($aact_hmlg_...).
//   ASAAS_API_KEY agora também é usada aqui — não só na create-asaas-checkout
//   — pra buscar nome/e-mail do cliente que pagou pelo link do Plano
//   Individual. ASAAS_WEBHOOK_TOKEN precisa ser cadastrado no painel do
//   Asaas, no campo "Token de autenticação" da configuração do webhook —
//   é assim que confirmamos que a chamada realmente veio do Asaas.
//   --no-verify-jwt é necessário porque o Asaas não manda um JWT do
//   Supabase — a autenticação aqui é o ASAAS_WEBHOOK_TOKEN, verificado
//   manualmente abaixo.)
//
// ATENÇÃO: não testado contra webhooks reais do Asaas nesta sessão — a
// forma exata do payload (nomes dos eventos, campos de `payment`/`customer`)
// segue a documentação pública no momento em que isto foi escrito. Confira
// contra um evento real (o Asaas deixa reenviar webhooks de teste no
// painel) antes de confiar nisso em produção.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

const ACTIVATING_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const DEACTIVATING_EVENTS = new Set(['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'SUBSCRIPTION_DELETED']);

// Plano Corporativo (Starter/Pro): cada pagamento confirmado soma 30 dias
// em companies.expires_at — a partir do vencimento atual se ele ainda for
// válido, ou a partir de hoje se já tiver vencido (renovação atrasada não
// "perde" dias, mas também não empilha em cima de um vencimento passado) —
// e garante max_users de acordo com o plano pago. Espelha os preços/vagas
// de create-asaas-checkout/index.ts.
const CORPORATE_RENEWAL_DAYS = 30;
const CORPORATE_PLANS = {
  starter: { maxUsers: 30, value: 297.0 },
  pro: { maxUsers: 50, value: 497.0 },
};

// Plano Individual não tem "assinatura" gerenciada por nós (é um link de
// pagamento fixo do Asaas) — o acesso simplesmente vale por N dias a partir
// de cada pagamento reconhecido, e é renovado no próximo pagamento do mês
// seguinte. Reaproveita a mesma coluna `trial_expires_at` do fluxo de
// "Testar Grátis" — ver isTrialExpired() em GameContext.jsx.
const INDIVIDUAL_ACCESS_DAYS = 30;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function asaasBaseUrl() {
  // Padrão 'production': a chave configurada em ASAAS_API_KEY normalmente é
  // a de produção (prefixo $aact_prod_...) — se ASAAS_ENV não estiver
  // definida, é mais seguro assumir produção do que cair silenciosamente no
  // sandbox e gerar erro "invalid_environment" (chave de prod contra URL de
  // sandbox). Pra testar em sandbox, defina ASAAS_ENV=sandbox explicitamente.
  const env = Deno.env.get('ASAAS_ENV') || 'production';
  return env === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
}

async function asaasFetch(path) {
  const apiKey = Deno.env.get('ASAAS_API_KEY');
  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada nos secrets da função.');
  const res = await fetch(`${asaasBaseUrl()}${path}`, { headers: { access_token: apiKey } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Asaas ${path} falhou (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

function generateTempPassword() {
  // Fácil de digitar/copiar do e-mail, mas com entropia suficiente.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Faixa Unicode das marcas de acento combinantes (usada depois de
// normalize('NFD')) — escrita como \u pra não depender de como o editor
// grava caracteres combinantes literais no arquivo.
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

// Gera um código curto e legível (ex.: "Conta Individual — Ana" ->
// "CONTAI4821") e tenta até achar um que não colida com
// `companies.company_code` (unique). O código em si nunca é mostrado pro
// usuário do Plano Individual — é só o que satisfaz a FK obrigatória de
// `users.company_id`.
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
    const { data: existing } = await supabase
      .from('companies')
      .select('id')
      .eq('company_code', candidate)
      .maybeSingle();
    if (!existing) return candidate;
  }
  return `${slug}${Date.now().toString().slice(-6)}`;
}

async function sendActivationEmail({ to, companyName, companyCode, plan }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <contato@taxlingo.com.br>';
  if (!RESEND_API_KEY || !to) {
    // e-mail é um "nice to have" aqui — não derruba a ativação se faltar,
    // mas registra por quê pra não ficar em silêncio nos logs.
    console.error('sendActivationEmail: RESEND_API_KEY ou destinatário ausente — e-mail não enviado.', { to: Boolean(to), hasKey: Boolean(RESEND_API_KEY) });
    return;
  }

  console.log('Enviando e-mail para:', to);
  try {
    const res = await fetch('https://api.resend.com/emails', {
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
    });
    const resendData = await res.json().catch(() => ({}));
    console.log('Resposta Resend:', JSON.stringify(resendData));
    if (!res.ok) {
      console.error('Erro Resend:', resendData);
    }
  } catch (resendError) {
    console.error('Erro Resend:', resendError);
  }
}

// E-mail do Plano Individual: credenciais de login prontas (a conta já é
// criada aqui, ao contrário do Starter/Pro, onde só o company_code é
// mandado e a pessoa se cadastra normalmente depois).
async function sendIndividualWelcomeEmail({ to, tempPassword }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <contato@taxlingo.com.br>';
  if (!RESEND_API_KEY || !to) {
    console.error('sendIndividualWelcomeEmail: RESEND_API_KEY ou destinatário ausente — e-mail não enviado.', { to: Boolean(to), hasKey: Boolean(RESEND_API_KEY) });
    return;
  }

  console.log('Enviando e-mail para:', to);
  try {
    const res = await fetch('https://api.resend.com/emails', {
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
            <p><a href="https://taxlingo.com.br" style="background:#10b981; color:white; padding:10px 20px; border-radius:12px; text-decoration:none; font-weight:bold;">Entrar no TaxLingo</a></p>
            <p style="color:#94a3b8; font-size:12px;">Recomendamos trocar essa senha assim que entrar (Meu Perfil → Alterar senha). Seu acesso é renovado automaticamente a cada pagamento mensal.</p>
          </div>
        `,
      }),
    });
    const resendData = await res.json().catch(() => ({}));
    console.log('Resposta Resend:', JSON.stringify(resendData));
    if (!res.ok) {
      console.error('Erro Resend:', resendData);
    }
  } catch (resendError) {
    console.error('Erro Resend:', resendError);
  }
}

// Estende `trial_expires_at` (o campo que controla até quando o acesso do
// Plano Individual vale — ver isTrialExpired() em GameContext.jsx) na linha
// de public.users já existente. Não mexe em metadata de auth.users: quem
// decide se o acesso expirou é sempre a coluna, lida via fetchProfile().
async function extendUserAccess(supabase, { userId, companyId, expiresAt }) {
  const query = userId
    ? supabase.from('users').update({ trial_expires_at: expiresAt }).eq('id', userId)
    : supabase.from('users').update({ trial_expires_at: expiresAt }).eq('company_id', companyId);
  await query;
}

// Soma CORPORATE_RENEWAL_DAYS ao vencimento do plano Corporativo da empresa
// e ajusta max_users pro plano pago — chamada tanto no caminho normal
// (assinatura correlacionada por asaas_subscription_id) quanto no fallback
// por CNPJ (pagamento avulso sem essa correlação).
async function applyCorporateRenewal(supabase, { companyId, plan }) {
  const planConfig = CORPORATE_PLANS[plan] ?? CORPORATE_PLANS.starter;
  const { data: company } = await supabase.from('companies').select('expires_at').eq('id', companyId).maybeSingle();
  const currentExpiresAt = company?.expires_at ? new Date(company.expires_at) : null;
  const base = currentExpiresAt && currentExpiresAt > new Date() ? currentExpiresAt : new Date();
  const newExpiresAt = new Date(base.getTime() + CORPORATE_RENEWAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('companies').update({ expires_at: newExpiresAt, max_users: planConfig.maxUsers }).eq('id', companyId);
}

// Usada só no fallback por CNPJ (path sem assinatura correlacionada) pra
// adivinhar qual plano foi pago — o valor da cobrança é o único sinal
// disponível nesse caminho.
function planFromPaymentValue(value) {
  const rounded = Math.round(Number(value) || 0);
  return rounded === Math.round(CORPORATE_PLANS.pro.value) ? 'pro' : 'starter';
}

// Cria (primeira compra) ou renova (pagamento recorrente do mês seguinte) o
// acesso do Plano Individual comprado pelo link de pagamento fixo do Asaas.
async function activateIndividualPayment(supabase, { asaasCustomerId, asaasSubscriptionId, periodEnd, customerEmail, customerName }) {
  if (!customerEmail) {
    throw new Error('Pagamento sem e-mail de cliente associado (Asaas) — não dá pra criar/renovar a conta.');
  }
  const expiresAt = new Date(Date.now() + INDIVIDUAL_ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Já vimos esse cliente Asaas antes (renovação mensal)? Só estende o
  // prazo de acesso, sem recriar empresa/usuário.
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id, company_id')
    .eq('asaas_customer_id', asaasCustomerId)
    .maybeSingle();

  if (existingSub) {
    await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        asaas_subscription_id: asaasSubscriptionId ?? undefined,
        current_period_end: periodEnd,
      })
      .eq('id', existingSub.id);
    await extendUserAccess(supabase, { companyId: existingSub.company_id, expiresAt });
    return;
  }

  // Primeira compra desse cliente Asaas: cria uma empresa invisível (só
  // pra satisfazer a FK obrigatória de company_id — nunca é mostrada pro
  // usuário) e a conta de fato.
  const companyLabel = `Conta Individual — ${customerName || customerEmail}`;
  const companyCode = await generateCompanyCode(supabase, companyLabel);
  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert({ name: companyLabel, company_code: companyCode })
    .select('id')
    .single();
  if (companyError) throw companyError;

  await supabase.from('subscriptions').insert({
    company_id: company.id,
    plan: 'individual',
    status: 'active',
    seats_limit: 1,
    asaas_customer_id: asaasCustomerId,
    asaas_subscription_id: asaasSubscriptionId ?? null,
    current_period_end: periodEnd,
  });

  const tempPassword = generateTempPassword();
  const { error: createUserError } = await supabase.auth.admin.createUser({
    email: customerEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name: customerName || customerEmail.split('@')[0],
      company_id: company.id,
      avatar_url: '🙂',
      trial_expires_at: expiresAt,
    },
  });

  if (!createUserError) {
    await sendIndividualWelcomeEmail({ to: customerEmail, tempPassword });
    return;
  }
  if (!createUserError.message?.includes('already been registered')) {
    throw createUserError;
  }

  // E-mail já tinha conta — o caso real que motivou este bloco é alguém que
  // usou o "Testar Grátis por 24h" (empresa TRIAL compartilhada) e depois
  // comprou o Plano Individual: antes, esse caminho só estendia o prazo em
  // silêncio e NUNCA mandava o e-mail de boas-vindas (a pessoa pagava e não
  // recebia credencial nenhuma). Agora migra pra essa empresa dedicada que
  // acabamos de criar (junto com a assinatura logo acima), gera uma senha
  // nova — a antiga pode ter sido só de um teste esquecido — e manda o
  // e-mail normalmente.
  const { data: existingUser } = await supabase.from('users').select('id').eq('email', customerEmail).maybeSingle();
  if (!existingUser) {
    console.error('activateIndividualPayment: e-mail já registrado no Auth, mas sem linha correspondente em public.users — não foi possível ativar.', customerEmail);
    return;
  }

  await supabase
    .from('users')
    .update({ company_id: company.id, trial_expires_at: expiresAt })
    .eq('id', existingUser.id);
  await supabase.auth.admin.updateUserById(existingUser.id, { password: tempPassword });
  await sendIndividualWelcomeEmail({ to: customerEmail, tempPassword });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);

  const expectedToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN');
  const receivedToken = req.headers.get('asaas-access-token');
  if (expectedToken && receivedToken !== expectedToken) {
    return jsonResponse({ error: 'Token de webhook inválido.' }, 401);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Corpo inválido.' }, 400);
  }

  const event = payload?.event;
  const payment = payload?.payment;

  if (!event || !payment) {
    // Evento que não envolve uma cobrança (ex: eventos de conta) — confirma
    // recebimento sem fazer nada, pro Asaas não ficar reenviando.
    return jsonResponse({ ok: true, ignored: true });
  }

  const asaasSubscriptionId = payment.subscription ?? null;
  const periodEnd = payment.nextDueDate ? new Date(payment.nextDueDate).toISOString() : null;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // 1. Tenta casar com uma assinatura Corporativa criada pela nossa
    //    própria create-asaas-checkout.
    const { data: subscription } = asaasSubscriptionId
      ? await supabase
          .from('subscriptions')
          .select('id, company_id, plan')
          .eq('asaas_subscription_id', asaasSubscriptionId)
          .maybeSingle()
      : { data: null };

    if (subscription) {
      if (ACTIVATING_EVENTS.has(event)) {
        await supabase
          .from('subscriptions')
          .update({ status: 'active', current_period_end: periodEnd })
          .eq('id', subscription.id);

        await applyCorporateRenewal(supabase, { companyId: subscription.company_id, plan: subscription.plan });

        const { data: company } = await supabase
          .from('companies')
          .select('name, company_code')
          .eq('id', subscription.company_id)
          .single();

        const { data: admin } = await supabase
          .from('users')
          .select('email')
          .eq('company_id', subscription.company_id)
          .eq('role', 'admin')
          .limit(1)
          .maybeSingle();

        if (company) {
          await sendActivationEmail({
            to: admin?.email,
            companyName: company.name,
            companyCode: company.company_code,
            plan: subscription.plan,
          });
        }
      } else if (DEACTIVATING_EVENTS.has(event)) {
        const status = event === 'PAYMENT_OVERDUE' ? 'past_due' : 'canceled';
        await supabase.from('subscriptions').update({ status }).eq('id', subscription.id);
      }
      return jsonResponse({ ok: true });
    }

    // 2. Sem assinatura correspondente por asaas_subscription_id. Duas
    //    possibilidades:
    //    a) Plano Corporativo cobrado avulso — ex.: renovação feita direto
    //       no painel do Asaas, sem passar pela nossa create-asaas-checkout
    //       — o CNPJ do cliente bate com companies.cnpj: trata como
    //       renovação corporativa (soma os 30 dias, ajusta max_users) e
    //       correlaciona a assinatura pro próximo pagamento já cair no
    //       caminho 1 acima.
    //    b) Plano Individual, comprado pelo link de pagamento fixo do
    //       Asaas — sem CNPJ correspondente, cai no fluxo de sempre.
    if (!payment.customer) {
      return jsonResponse({ ok: true, ignored: true });
    }

    if (ACTIVATING_EVENTS.has(event)) {
      const customer = await asaasFetch(`/customers/${payment.customer}`);
      const normalizedCnpj = String(customer?.cpfCnpj ?? '').replace(/\D/g, '');

      const { data: matchedCompany } =
        normalizedCnpj.length === 14
          ? await supabase.from('companies').select('id').eq('cnpj', normalizedCnpj).maybeSingle()
          : { data: null };

      if (matchedCompany) {
        const plan = planFromPaymentValue(payment.value);
        await supabase.from('subscriptions').insert({
          company_id: matchedCompany.id,
          plan,
          status: 'active',
          seats_limit: CORPORATE_PLANS[plan].maxUsers,
          asaas_customer_id: payment.customer,
          asaas_subscription_id: asaasSubscriptionId,
          current_period_end: periodEnd,
        });
        await applyCorporateRenewal(supabase, { companyId: matchedCompany.id, plan });

        const { data: company } = await supabase
          .from('companies')
          .select('name, company_code')
          .eq('id', matchedCompany.id)
          .single();
        const { data: admin } = await supabase
          .from('users')
          .select('email')
          .eq('company_id', matchedCompany.id)
          .eq('role', 'admin')
          .limit(1)
          .maybeSingle();
        if (company) {
          await sendActivationEmail({ to: admin?.email, companyName: company.name, companyCode: company.company_code, plan });
        }
      } else {
        await activateIndividualPayment(supabase, {
          asaasCustomerId: payment.customer,
          asaasSubscriptionId,
          periodEnd,
          customerEmail: customer?.email,
          customerName: customer?.name,
        });
      }
    } else if (DEACTIVATING_EVENTS.has(event)) {
      const status = event === 'PAYMENT_OVERDUE' ? 'past_due' : 'canceled';
      await supabase.from('subscriptions').update({ status }).eq('asaas_customer_id', payment.customer);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('asaas-webhook failed:', err);
    // 200 mesmo em erro interno (depois de validar o token) evita que o
    // Asaas fique retentando indefinidamente um evento que sempre vai falhar
    // por um bug nosso; o erro fica logado pra investigar manualmente.
    return jsonResponse({ ok: false, error: err.message }, 200);
  }
});
