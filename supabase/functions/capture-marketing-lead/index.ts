// supabase/functions/capture-marketing-lead/index.ts
//
// Recebe o formulário de topo de funil (public/comece.html — landing page
// de captação para contadores/donos de escritório vindos do Instagram).
// Diferente de create-corporate-lead (que já cobra um Plano Corporativo
// via CNPJ + Link de Pagamento Asaas), este é só um lead "morno": nome,
// e-mail, WhatsApp e opcionalmente o nome do escritório — sem CNPJ, sem
// cobrança automática. Só guarda em marketing_leads e avisa o time
// comercial pra fazer o follow-up manual via WhatsApp.
//
// Deploy:
//   supabase functions deploy capture-marketing-lead
//   (reaproveita os secrets RESEND_API_KEY / RESEND_FROM_EMAIL /
//   SALES_NOTIFICATION_EMAIL já configurados por create-corporate-lead —
//   nenhum secret novo é necessário.)

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

// Aviso interno pro time comercial — best-effort, não derruba o cadastro
// do lead se o e-mail falhar ou se SALES_NOTIFICATION_EMAIL não estiver
// configurada (mesmo padrão de create-corporate-lead).
async function notifySalesTeam({ fullName, email, phone, companyName, source }) {
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
      subject: `Novo lead (${source || 'site'}) — ${fullName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin:0 auto;">
          <h2 style="color:#059669;">Novo lead recebido</h2>
          <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>Nome:</strong></td><td style="padding:8px; background:#f0fdf4;">${fullName}</td></tr>
            <tr><td style="padding:8px;"><strong>E-mail:</strong></td><td style="padding:8px;">${email}</td></tr>
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>WhatsApp:</strong></td><td style="padding:8px; background:#f0fdf4;">${phone}</td></tr>
            <tr><td style="padding:8px;"><strong>Escritório:</strong></td><td style="padding:8px;">${companyName || '—'}</td></tr>
            <tr><td style="padding:8px; background:#f0fdf4;"><strong>Origem:</strong></td><td style="padding:8px; background:#f0fdf4;">${source || '—'}</td></tr>
          </table>
          <p style="color:#94a3b8; font-size:12px;">Combine o follow-up direto pelo WhatsApp informado acima.</p>
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

  const fullName = String(payload?.fullName ?? payload?.full_name ?? '').trim();
  const email = String(payload?.email ?? '').trim().toLowerCase();
  const phone = String(payload?.phone ?? '').trim();
  const companyName = String(payload?.companyName ?? payload?.company_name ?? '').trim() || null;
  const source = String(payload?.source ?? '').trim() || null;

  if (!fullName) return jsonResponse({ error: 'Informe seu nome completo.' }, 400);
  if (!email || !email.includes('@')) return jsonResponse({ error: 'Informe um e-mail válido.' }, 400);
  if (phone.replace(/\D/g, '').length < 10) return jsonResponse({ error: 'Informe um WhatsApp válido com DDD.' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const { error } = await supabase.from('marketing_leads').insert({
      full_name: fullName,
      email,
      phone,
      company_name: companyName,
      source,
    });
    if (error) throw error;

    await notifySalesTeam({ fullName, email, phone, companyName, source });

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('capture-marketing-lead failed:', err);
    return jsonResponse({ error: err.message || 'Não foi possível registrar seu contato.' }, 500);
  }
});
