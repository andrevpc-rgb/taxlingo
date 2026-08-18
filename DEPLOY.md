# Roteiro de Deploy — TaxLingo

Checklist do zero até em produção. Cada seção tem os comandos/passos; onde
alguma parte exige uma decisão sua (preço, domínio, nome do projeto), está
sinalizado.

> **Importante:** as seções 2, 4 e 5 (Supabase, e-mail, pagamento) dependem
> de contas e credenciais reais que só você pode criar — não tenho como
> provisionar isso por você. O código já está pronto pra conectar assim que
> você colar as chaves.

---

## 1. GitHub — criar o repositório

```bash
cd taxlingo
git init
git add .
git commit -m "TaxLingo: versão inicial"
```

No GitHub, crie um repositório vazio (sem README/gitignore, pra não
conflitar) e depois:

```bash
git remote add origin https://github.com/SEU-USUARIO/taxlingo.git
git branch -M main
git push -u origin main
```

O `.gitignore` já está configurado pra nunca subir `node_modules/`, `.env`
e `.env.local` (chaves nunca vão pro repositório).

---

## 2. Supabase — banco de dados

1. Crie um projeto em [supabase.com](https://supabase.com) (região São
   Paulo, se disponível).
2. Painel do Supabase → **SQL Editor** → cole o conteúdo de
   [`supabase/schema.sql`](supabase/schema.sql) inteiro → **Run**.
3. Copie **Project Settings → API**: `Project URL` e a chave `anon public`.
4. Copie também a chave `service_role` (fica em **Project Settings → API**,
   mais abaixo — trate como senha, nunca exponha no cliente).
5. Localmente, na raiz de `taxlingo/`:

   ```bash
   cp .env.example .env
   # edite .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MASTER_EMAIL, MASTER_PASSWORD

   cp .env.local.example .env.local
   # edite .env.local: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
   ```

6. Instale as dependências e rode o seed (popula módulos, as ~1000
   questões, 3 empresas de demonstração, 12 usuários de teste e a conta
   master):

   ```bash
   npm install
   npm run seed
   ```

   Para resetar os dados de teste numa nova rodada (só apaga o que é das
   empresas de demonstração ALFA2026/BETA2026/GAMMA2026 — nunca toca em
   empresas/clientes reais que você cadastrar depois):

   ```bash
   npm run seed:reset
   ```

7. Rode localmente pra conferir:

   ```bash
   npm run dev
   ```

   Login com qualquer conta de teste (`andreia@alfa.com` / `demo123`, por
   exemplo) ou com a conta master (`MASTER_EMAIL`/`MASTER_PASSWORD` que
   você definiu no `.env`).

---

## 3. Responsividade mobile

Já implementada e testada (Header, QuizEngine, trilha de lições, Ranking e
Painel do Gestor) — nada a configurar aqui, é só código.

---

## 4. Teste Grátis por 24h (Resend)

1. Crie uma conta em [resend.com](https://resend.com) (free tier).
2. Verifique um domínio de envio (ou use o domínio de teste deles pra
   começar) e gere uma API Key.
3. Instale a Supabase CLI se ainda não tiver:

   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref SEU-PROJECT-REF
   ```

4. Configure os secrets e publique a function:

   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx RESEND_FROM_EMAIL="TaxLingo <onboarding@seudominio.com>" APP_URL=https://taxlingo.vercel.app
   supabase functions deploy send-trial-email
   ```

5. Teste o botão "Testar Grátis por 24 Horas" no app — se o e-mail não
   chegar, confira **Supabase Dashboard → Edge Functions → Logs**.

---

## 5. Checkout Asaas (PIX + cartão recorrente)

1. Crie uma conta em [asaas.com](https://asaas.com) (comece no ambiente
   **sandbox** pra testar sem dinheiro real).
2. Gere uma API Key em **Integrações → API**.
3. Configure os secrets e publique as duas functions:

   ```bash
   supabase secrets set ASAAS_API_KEY=xxx ASAAS_ENV=sandbox
   supabase functions deploy create-asaas-checkout

   supabase secrets set ASAAS_WEBHOOK_TOKEN=escolha-um-token-secreto
   supabase functions deploy asaas-webhook --no-verify-jwt
   ```

4. No painel do Asaas, cadastre o webhook apontando para:

   ```
   https://SEU-PROJETO.supabase.co/functions/v1/asaas-webhook
   ```

   com o mesmo `ASAAS_WEBHOOK_TOKEN` no campo de autenticação, e habilite
   pelo menos os eventos `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` e
   `PAYMENT_OVERDUE`.
5. Teste um checkout completo no sandbox antes de trocar `ASAAS_ENV` para
   `production`. **Os preços dos planos (R$ 297/R$ 897) em
   `SubscriptionModal.jsx` e `create-asaas-checkout/index.ts` são
   ilustrativos — ajuste antes de ir ao ar.**

---

## 5b. Checkout Nitrus (alternativa ao Asaas)

> ⚠️ **Integração não verificada.** Não há documentação pública da Nitrus
> disponível pra confirmar nomes de endpoint, campos do payload e do
> webhook — `create-nitrus-checkout` e `nitrus-webhook` seguem o formato
> mais comum entre gateways de pagamento (Asaas, Stripe), claramente
> sinalizado nos comentários de cada arquivo. **Confira contra a
> documentação real da Nitrus (ou um payload de teste) antes de ir pra
> produção** — em especial o path do endpoint de checkout, os nomes dos
> campos do body/resposta, o header de autenticação do webhook e o nome
> exato dos eventos de pagamento confirmado.

Diferença importante em relação ao Asaas: o checkout da Nitrus também
suporta **empresa nova** (`companyName`/`adminEmail` sem `companyId`) — o
pagamento pode vir de alguém que ainda nem tem conta no TaxLingo. Nesse
caso os dados ficam em `pending_signups` até o `nitrus-webhook` confirmar
o pagamento, criar a empresa em `companies` (com um `company_code` novo,
gerado automaticamente) e liberar a licença.

1. Rode o SQL atualizado de [`supabase/schema.sql`](supabase/schema.sql)
   de novo no **SQL Editor** (adiciona a tabela `pending_signups` e as
   colunas `nitrus_customer_id`/`nitrus_subscription_id` em
   `subscriptions` — é seguro rodar de novo, usa `create table if not
   exists`).
2. Configure os secrets e publique as duas functions:

   ```bash
   supabase secrets set NITRUS_API_URL=https://api.nitrus.example/v1 NITRUS_API_KEY=xxx
   supabase functions deploy create-nitrus-checkout

   supabase secrets set NITRUS_WEBHOOK_TOKEN=escolha-um-token-secreto
   supabase functions deploy nitrus-webhook --no-verify-jwt
   ```

3. No painel da Nitrus, cadastre o webhook apontando para:

   ```
   https://SEU-PROJETO.supabase.co/functions/v1/nitrus-webhook
   ```

   com o mesmo `NITRUS_WEBHOOK_TOKEN` no header de autenticação do
   webhook (o nome exato do header depende da Nitrus — ajuste
   `nitrus-webhook/index.ts` se não for `Nitrus-Webhook-Token` ou
   `X-Nitrus-Token`), e habilite os eventos de pagamento confirmado.
4. Teste um checkout completo (idealmente um de empresa nova e um de
   empresa já existente) antes de divulgar. **Os preços dos planos em
   `create-nitrus-checkout/index.ts` são ilustrativos — ajuste antes de ir
   ao ar.**

---

## 6. Vercel — publicar o front-end

1. No [vercel.com](https://vercel.com), **Add New → Project** → importe o
   repositório do GitHub.
2. Framework preset: **Vite** (detecta sozinho pelo `vite.config.js`).
3. Em **Environment Variables**, adicione (mesmos valores do `.env.local`):

   | Nome | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | seu Project URL do Supabase |
   | `VITE_SUPABASE_ANON_KEY` | sua chave anon |

   Nunca adicione `SUPABASE_SERVICE_ROLE_KEY`, `ASAAS_API_KEY`,
   `RESEND_API_KEY` ou similares aqui — essas só existem nos secrets das
   Edge Functions (seção 4/5), nunca no bundle do front-end.

4. **Deploy**. A cada `git push` na branch `main`, a Vercel republica
   automaticamente.

### Domínio customizado

1. Na Vercel: **Project → Settings → Domains → Add**, digite seu domínio
   (ex: `app.suaempresa.com.br`).
2. A Vercel mostra o registro DNS a criar (`CNAME` apontando pra
   `cname.vercel-dns.com`, ou `A` se for domínio raiz). Adicione isso no
   painel do seu provedor de DNS.
3. Aguarde a propagação (a Vercel emite o certificado HTTPS
   automaticamente assim que o DNS resolver).

---

## Checklist final antes de divulgar

- [ ] `supabase/schema.sql` rodado no projeto real
- [ ] `npm run seed` rodado com sucesso
- [ ] Conta master testada (login + todas as lições desbloqueadas)
- [ ] `.env.local` configurado na Vercel (não local, o de produção)
- [ ] `send-trial-email` publicada e testada (e-mail chegando de verdade)
- [ ] `create-asaas-checkout` + `asaas-webhook` publicadas e testadas em
      sandbox (ou `create-nitrus-checkout` + `nitrus-webhook`, se optar
      pela Nitrus — confira a integração contra a documentação real antes,
      ver seção 5b)
- [ ] Preços dos planos revisados
- [ ] `ASAAS_ENV` trocado para `production` só depois de validar tudo em
      sandbox
- [ ] Domínio customizado apontado (opcional)
