// supabase/functions/create-nitrus-checkout/index.ts
//
// Edge Function que cria um checkout na Nitrus. Cobre dois casos:
//   1. Empresa JÁ cadastrada (tem `companyId`) contratando/trocando de
//      plano — mesmo fluxo do create-asaas-checkout.
//   2. Empresa NOVA (sem `companyId`, só `companyName`/`adminEmail`) —
//      típico de uma compra feita direto num site de vendas, antes de
//      qualquer cadastro no TaxLingo. Os dados ficam guardados em
//      `pending_signups` até o nitrus-webhook confirmar o pagamento e
//      criar a empresa de verdade.
//
// Deploy:
//   supabase functions deploy create-nitrus-checkout
//   supabase secrets set NITRUS_API_URL=https://api.nitrus.example/v1 NITRUS_API_KEY=xxx
//
// ##############################################################################
// ATENÇÃO — INTEGRAÇÃO NÃO VERIFICADA: não encontrei documentação pública da
// API da Nitrus (nem em busca na web) pra confirmar nomes de endpoint, campos
// do corpo da requisição ou formato da resposta. O código abaixo segue o
// formato mais comum entre gateways de pagamento (Asaas, Stripe, PagSeguro):
// POST num endpoint de checkout/cobrança, `Authorization: Bearer <API key>`,
// e uma referência externa ecoada de volta no webhook pra casar o pagamento
// com o pedido. ANTES de ir pra produção, confira contra a documentação real
// da Nitrus e ajuste `NITRUS_API_URL`, o path do fetch, os nomes dos campos
// do body e os campos lidos da resposta (`checkout.id` / `checkout.url`).
// ##############################################################################

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLANS = {
  starter: { label: 'Starter', seatsLimit: 10, value: 297.0, description: 'TaxLingo — Plano Starter (até 10 colaboradores)' },
  pro: { label: 'Pro', seatsLimit: 50, value: 897.0, description: 'TaxLingo — Plano Pro (até 50 colaboradores)' },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function nitrusFetch(path, options = {}) {
  const baseUrl = Deno.env.get('NITRUS_API_URL');
  const apiKey = Deno.env.get('NITRUS_API_KEY');
  if (!baseUrl) throw new Error('NITRUS_API_URL não configurada nos secrets da função.');
  if (!apiKey) throw new Error('NITRUS_API_KEY não configurada nos secrets da função.');

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Nitrus ${path} falhou (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
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

  const { companyId, companyName, adminName, adminEmail, plan, cpfCnpj } = payload;
  const planConfig = PLANS[plan];
  if (!planConfig) {
    return jsonResponse({ error: 'Informe um plano válido ("starter" ou "pro").' }, 400);
  }
  if (!companyId && !companyName) {
    return jsonResponse({ error: 'Informe companyId (empresa existente) ou companyName (empresa nova).' }, 400);
  }
  if (!adminEmail) {
    return jsonResponse({ error: 'Informe o e-mail do responsável pela cobrança.' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    let externalReference;
    let customerName = companyName;

    if (companyId) {
      // Empresa já existe: referência externa é o próprio company_id, o
      // nitrus-webhook reconhece esse formato e ativa direto a assinatura.
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id, name')
        .eq('id', companyId)
        .single();
      if (companyError || !company) throw new Error('Empresa não encontrada.');
      customerName = company.name;
      externalReference = `company:${company.id}`;
    } else {
      // Empresa nova: guarda os dados em pending_signups até o webhook
      // confirmar o pagamento — é só nesse momento que a empresa passa a
      // existir de fato em `companies`.
      externalReference = `pending:${crypto.randomUUID()}`;
      const { error: pendingError } = await supabase.from('pending_signups').insert({
        external_reference: externalReference,
        company_name: companyName,
        admin_name: adminName ?? null,
        admin_email: adminEmail,
        plan,
        cpf_cnpj: cpfCnpj ?? null,
      });
      if (pendingError) throw pendingError;
    }

    // Forma do body/resposta assumida a partir de convenções comuns de
    // gateway — CONFIRA contra a documentação real da Nitrus (ver aviso no
    // topo do arquivo) antes de usar em produção.
    const checkout = await nitrusFetch('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        customer: { name: customerName, email: adminEmail, cpfCnpj: cpfCnpj ?? undefined },
        amount: planConfig.value,
        currency: 'BRL',
        cycle: 'MONTHLY',
        description: planConfig.description,
        externalReference,
      }),
    });

    const checkoutUrl = checkout?.checkoutUrl ?? checkout?.url ?? checkout?.paymentUrl;
    if (!checkoutUrl) throw new Error('Checkout criado na Nitrus, mas a resposta não trouxe uma URL de pagamento.');

    return jsonResponse({ checkoutUrl });
  } catch (err) {
    console.error('create-nitrus-checkout failed:', err);
    return jsonResponse({ error: err.message || 'Falha ao iniciar o checkout.' }, 500);
  }
});
