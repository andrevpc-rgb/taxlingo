// supabase/functions/create-asaas-checkout/index.ts
//
// Edge Function chamada pelo SubscriptionModal.jsx (agora só no modo
// Renovação/Upgrade da empresa já logada) quando o gestor escolhe um plano.
// Cria (ou reaproveita) o cliente no Asaas, cria a assinatura recorrente e
// devolve o QR Code + copia-e-cola do PIX (quando disponíveis) e o link da
// fatura — o modal mostra isso direto na tela, sem redirecionar pra fora
// do app. A ativação de fato (somar os 30 dias em companies.expires_at,
// atualizar max_users) acontece depois, via webhook
// (supabase/functions/asaas-webhook), quando o pagamento é confirmado.
//
// Deploy:
//   supabase functions deploy create-asaas-checkout
//   supabase secrets set ASAAS_API_KEY=xxx
//   (ASAAS_ENV é opcional, padrão 'production' — mesma convenção do
//   asaas-webhook. Só defina ASAAS_ENV=sandbox se ASAAS_API_KEY for uma
//   chave de sandbox.)
//
// ATENÇÃO: não testado contra a API real do Asaas nesta sessão (não há
// como criar/validar uma conta Asaas por aqui). A forma dos campos segue a
// documentação pública da API v3 no momento em que isto foi escrito —
// confira https://docs.asaas.com antes de ir pra produção, principalmente
// os nomes exatos dos campos de /subscriptions, /payments e
// /payments/{id}/pixQrCode.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Preços/vagas do Plano Corporativo — espelhados em
// supabase/functions/asaas-webhook/index.ts (CORPORATE_PLANS), que é quem
// realmente credita max_users/expires_at quando o pagamento é confirmado.
const PLANS = {
  starter: { label: 'Starter', seatsLimit: 30, value: 297.0, description: 'TaxLingo — Plano Starter (até 30 colaboradores)' },
  pro: { label: 'Pro', seatsLimit: 50, value: 497.0, description: 'TaxLingo — Plano Pro (até 50 colaboradores)' },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function asaasBaseUrl() {
  // Mesmo padrão do asaas-webhook: assume produção por padrão (a chave
  // configurada normalmente é $aact_prod_...), só cai pro sandbox se
  // ASAAS_ENV=sandbox for definida explicitamente.
  const env = Deno.env.get('ASAAS_ENV') || 'production';
  return env === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
}

async function asaasFetch(path, options = {}) {
  const apiKey = Deno.env.get('ASAAS_API_KEY');
  if (!apiKey) throw new Error('ASAAS_API_KEY não configurada nos secrets da função.');

  const res = await fetch(`${asaasBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Asaas ${path} falhou (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function findOrCreateAsaasCustomer({ existingCustomerId, name, email, cpfCnpj }) {
  if (existingCustomerId) return existingCustomerId;
  const customer = await asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify({ name, email, cpfCnpj }),
  });
  return customer.id;
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

  const { companyId, plan, cpfCnpj } = payload;
  const planConfig = PLANS[plan];
  if (!companyId || !planConfig) {
    return jsonResponse({ error: 'Informe companyId e um plano válido ("starter" ou "pro").' }, 400);
  }
  if (!cpfCnpj) {
    // Asaas exige CPF/CNPJ pra criar o cliente de cobrança — pedimos no
    // SubscriptionModal.jsx antes de chamar esta function.
    return jsonResponse({ error: 'Informe o CPF/CNPJ da empresa para o checkout.' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id, name')
      .eq('id', companyId)
      .single();
    if (companyError || !company) throw new Error('Empresa não encontrada.');

    const { data: adminUser } = await supabase
      .from('users')
      .select('email')
      .eq('company_id', companyId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('id, asaas_customer_id')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const asaasCustomerId = await findOrCreateAsaasCustomer({
      existingCustomerId: existingSub?.asaas_customer_id,
      name: company.name,
      email: adminUser?.email,
      cpfCnpj,
    });

    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + 1); // vencimento amanhã, dá tempo do checkout ser pago

    const subscription = await asaasFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType: 'UNDEFINED', // deixa o pagador escolher PIX, boleto ou cartão na tela do Asaas
        cycle: 'MONTHLY',
        value: planConfig.value,
        nextDueDate: nextDueDate.toISOString().slice(0, 10),
        description: planConfig.description,
      }),
    });

    // A cobrança da primeira competência já é criada junto com a assinatura;
    // buscamos ela pra pegar o link de pagamento (checkout) do Asaas.
    const paymentsResponse = await asaasFetch(`/payments?subscription=${subscription.id}&limit=1`);
    const firstPayment = paymentsResponse.data?.[0];
    const checkoutUrl = firstPayment?.invoiceUrl;
    if (!checkoutUrl) throw new Error('Assinatura criada, mas não veio um link de pagamento do Asaas.');

    await supabase.from('subscriptions').upsert(
      {
        id: existingSub?.id,
        company_id: companyId,
        plan,
        status: 'trialing',
        seats_limit: planConfig.seatsLimit,
        asaas_customer_id: asaasCustomerId,
        asaas_subscription_id: subscription.id,
      },
      { onConflict: 'id' }
    );

    // QR Code + copia-e-cola do PIX pra mostrar direto no
    // SubscriptionModal.jsx (em vez de só redirecionar pro link de fatura).
    // Best-effort: o Asaas só gera isso quando PIX é uma opção de pagamento
    // válida pra essa cobrança — se falhar por qualquer motivo, o modal
    // ainda funciona com o checkoutUrl sozinho.
    let pixQrCode = null;
    let pixCopyPaste = null;
    try {
      const pix = await asaasFetch(`/payments/${firstPayment.id}/pixQrCode`);
      pixQrCode = pix?.encodedImage ? `data:image/png;base64,${pix.encodedImage}` : null;
      pixCopyPaste = pix?.payload ?? null;
    } catch (pixError) {
      console.error('create-asaas-checkout: PIX QR Code indisponível para esta cobrança (segue só com o link de fatura):', pixError);
    }

    return jsonResponse({ checkoutUrl, pixQrCode, pixCopyPaste });
  } catch (err) {
    console.error('create-asaas-checkout failed:', err);
    return jsonResponse({ error: err.message || 'Falha ao iniciar o checkout.' }, 500);
  }
});
