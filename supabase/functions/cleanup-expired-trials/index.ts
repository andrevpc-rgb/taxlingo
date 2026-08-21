// supabase/functions/cleanup-expired-trials/index.ts
//
// Roda uma vez por dia (ver bloco de SQL no fim deste comentário) e remove
// as contas do "Testar Grátis por 24 Horas" (empresa TRIAL compartilhada,
// ver send-trial-email/index.ts) cujo prazo já venceu e que nunca converteram
// em compra. Nunca mexe em quem converteu: o fluxo de pagamento
// (asaas-webhook/index.ts, activateIndividualPayment) migra o usuário pra
// uma empresa dedicada assim que o pagamento é confirmado, então quem
// comprou já não está mais na empresa TRIAL quando esta function roda.
//
// Deletar via auth.admin.deleteUser() já é suficiente: public.users.id tem
// "references auth.users(id) on delete cascade" (ver schema.sql), então a
// linha de perfil (e o progresso de lições, também em cascade) some junto.
// Isso também libera o e-mail pra um cadastro novo de verdade depois.
//
// Deploy:
//   supabase functions deploy cleanup-expired-trials
//   (SEM --no-verify-jwt de propósito — só quem manda um JWT válido do
//   projeto, ex. a service_role key usada pelo agendamento abaixo, consegue
//   chamar. Não precisa de nenhum secret novo: usa SUPABASE_URL e
//   SUPABASE_SERVICE_ROLE_KEY, que toda Edge Function já tem no runtime.)
//
// Agendamento diário via pg_cron + pg_net — rode isto no SQL Editor do
// Supabase UMA VEZ (troque SUA_SERVICE_ROLE_KEY_AQUI pela chave em Project
// Settings > API > service_role, e o project_ref na URL pelo seu):
//
//   create extension if not exists pg_cron with schema extensions;
//   create extension if not exists pg_net with schema extensions;
//
//   select vault.create_secret('SUA_SERVICE_ROLE_KEY_AQUI', 'cleanup_expired_trials_service_key');
//
//   select cron.schedule(
//     'cleanup-expired-trials-daily',
//     '0 3 * * *', -- 03:00 UTC todo dia
//     $$
//     select net.http_post(
//       url := 'https://SEU-PROJETO.supabase.co/functions/v1/cleanup-expired-trials',
//       headers := jsonb_build_object(
//         'Content-Type', 'application/json',
//         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_expired_trials_service_key')
//       ),
//       body := '{}'::jsonb
//     );
//     $$
//   );

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TRIAL_COMPANY_CODE = 'TRIAL';
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const nowIso = new Date().toISOString();

    const { data: trialCompany, error: trialCompanyError } = await supabase
      .from('companies')
      .select('id')
      .eq('company_code', TRIAL_COMPANY_CODE)
      .maybeSingle();
    if (trialCompanyError) throw trialCompanyError;

    let removedUsers = 0;
    if (trialCompany) {
      const { data: expiredUsers, error: expiredUsersError } = await supabase
        .from('users')
        .select('id, email')
        .eq('company_id', trialCompany.id)
        .lt('trial_expires_at', nowIso);
      if (expiredUsersError) throw expiredUsersError;

      for (const user of expiredUsers ?? []) {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
        if (deleteError) {
          console.error('cleanup-expired-trials: falha ao remover', user.email, deleteError);
          continue;
        }
        removedUsers += 1;
        console.log('Trial removido:', user.email);
      }
    }

    // temp_access_tokens não tem FK pra auth.users (é só o histórico de
    // envio do e-mail do trial), então não some sozinho no cascade acima —
    // limpa separado pra tabela não crescer pra sempre.
    const { error: tokensError, count: removedTokens } = await supabase
      .from('temp_access_tokens')
      .delete({ count: 'exact' })
      .lt('expires_at', nowIso);
    if (tokensError) throw tokensError;

    const summary = { removedUsers, removedTokens: removedTokens ?? 0 };
    console.log('cleanup-expired-trials concluído:', JSON.stringify(summary));
    return jsonResponse({ ok: true, ...summary });
  } catch (err) {
    console.error('cleanup-expired-trials failed:', err);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
});
