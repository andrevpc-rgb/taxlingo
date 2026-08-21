// supabase/functions/submit-corporate-lead/index.ts
//
// Recebe o formulário público "Plano Corporativo" (AuthModal.jsx): nome da
// empresa, CNPJ, e-mail do responsável e quantidade de vagas desejadas.
// NÃO é um checkout — é captura de lead. Guarda em pending_signups (com
// status 'pending') pra alguém do time comercial (ou o master, via o
// Painel de Contingência) revisar e ativar manualmente depois, através de
// admin-provision.
//
// Deploy:
//   supabase functions deploy submit-corporate-lead
//   (opcional) supabase secrets set SALES_NOTIFICATION_EMAIL=vendas@taxlingo.com.br
//   (RESEND_API_KEY/RESEND_FROM_EMAIL já devem estar configurados pelas
//   outras functions de e-mail — reaproveitados aqui.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// Aviso interno pro time comercial — best-effort, não derruba o envio do
// lead se o e-mail falhar ou se SALES_NOTIFICATION_EMAIL não estiver configurado.
async function notifySalesTeam({ companyName, cnpj, contactEmail, seatsRequested }) {
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
      subject: `Novo lead Plano Corporativo: ${companyName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin:0 auto;">
          <h2 style="color:#059669;">Novo lead — Plano Corporativo</h2>
          <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>Empresa:</strong></td><td style="padding:8px; background:#f0fdf4;">${companyName}</td></tr>
            <tr><td style="padding:8px;"><strong>CNPJ:</strong></td><td style="padding:8px;">${cnpj || '(não informado)'}</td></tr>
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>Responsável:</strong></td><td style="padding:8px; background:#f0fdf4;">${contactEmail}</td></tr>
            <tr><td style="padding:8px;"><strong>Vagas desejadas:</strong></td><td style="padding:8px;">${seatsRequested ?? '(não informado)'}</td></tr>
          </table>
          <p style="color:#94a3b8; font-size:12px;">Ative pelo Painel de Contingência (conta master) quando fechar.</p>
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

  const companyName = String(payload?.companyName ?? '').trim();
  const cnpj = String(payload?.cnpj ?? '').trim();
  const contactEmail = String(payload?.contactEmail ?? '').trim().toLowerCase();
  const seatsRequested = Number.isFinite(Number(payload?.seatsRequested)) ? Math.trunc(Number(payload.seatsRequested)) : null;

  if (!companyName) return jsonResponse({ error: 'Informe o nome da empresa.' }, 400);
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
    const externalReference = `lead:${crypto.randomUUID()}`;
    const { error } = await supabase.from('pending_signups').insert({
      external_reference: externalReference,
      company_name: companyName,
      admin_email: contactEmail,
      cpf_cnpj: cnpj || null,
      seats_requested: seatsRequested,
      plan: 'starter', // rótulo provisório — o master define o tamanho real ao ativar
      status: 'pending',
    });
    if (error) throw error;

    await notifySalesTeam({ companyName, cnpj, contactEmail, seatsRequested });

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('submit-corporate-lead failed:', err);
    return jsonResponse({ error: err.message || 'Não foi possível enviar sua solicitação.' }, 500);
  }
});
