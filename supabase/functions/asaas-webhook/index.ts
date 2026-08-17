// supabase/functions/asaas-webhook/index.ts
//
// Endpoint de webhook do Asaas. Configure esta URL (depois do deploy) em
// Asaas > Configurações > Integrações > Webhooks:
//   https://SEU-PROJETO.supabase.co/functions/v1/asaas-webhook
//
// Ao confirmar um pagamento, ativa o plano da empresa e envia um e-mail
// pro gestor/RH com o company_code (é esse código que os colaboradores
// usam pra se cadastrar) e libera o acesso.
//
// Deploy:
//   supabase functions deploy asaas-webhook --no-verify-jwt
//   supabase secrets set ASAAS_WEBHOOK_TOKEN=escolha-um-token-secreto
//   (o mesmo token precisa ser cadastrado no painel do Asaas, no campo
//   "Token de autenticação" da configuração do webhook — é assim que a
//   gente confirma que a chamada realmente veio do Asaas.)
//   --no-verify-jwt é necessário porque o Asaas não manda um JWT do
//   Supabase — a autenticação aqui é o ASAAS_WEBHOOK_TOKEN, verificado
//   manualmente abaixo.
//
// ATENÇÃO: não testado contra webhooks reais do Asaas nesta sessão — a
// forma exata do payload (nomes dos eventos, campos de `payment`) segue a
// documentação pública no momento em que isto foi escrito. Confira contra
// um evento real (o Asaas deixa reenviar webhooks de teste no painel)
// antes de confiar nisso em produção.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

const ACTIVATING_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const DEACTIVATING_EVENTS = new Set(['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'SUBSCRIPTION_DELETED']);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function sendActivationEmail({ to, companyName, companyCode, plan }) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'TaxLingo <onboarding@resend.dev>';
  if (!RESEND_API_KEY || !to) return; // e-mail é um "nice to have" aqui — não derruba a ativação se faltar

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
  const asaasSubscriptionId = payment?.subscription;

  if (!event || !asaasSubscriptionId) {
    // Evento que não envolve assinatura (ex: cobrança avulsa) — confirma
    // recebimento sem fazer nada, pro Asaas não ficar reenviando.
    return jsonResponse({ ok: true, ignored: true });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('id, company_id, plan')
      .eq('asaas_subscription_id', asaasSubscriptionId)
      .maybeSingle();

    if (!subscription) {
      console.warn('Webhook recebido para assinatura desconhecida:', asaasSubscriptionId);
      return jsonResponse({ ok: true, ignored: true });
    }

    if (ACTIVATING_EVENTS.has(event)) {
      const periodEnd = payment?.nextDueDate
        ? new Date(payment.nextDueDate).toISOString()
        : null;

      await supabase
        .from('subscriptions')
        .update({ status: 'active', current_period_end: periodEnd })
        .eq('id', subscription.id);

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
  } catch (err) {
    console.error('asaas-webhook failed:', err);
    // 200 mesmo em erro interno (depois de validar o token) evita que o
    // Asaas fique retentando indefinidamente um evento que sempre vai falhar
    // por um bug nosso; o erro fica logado pra investigar manualmente.
    return jsonResponse({ ok: false, error: err.message }, 200);
  }
});
