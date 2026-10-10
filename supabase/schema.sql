-- =============================================================================
-- TaxLingo — Schema do Supabase (PostgreSQL)
-- =============================================================================
-- Como rodar: cole este arquivo inteiro no SQL Editor do painel do Supabase
-- (https://supabase.com/dashboard/project/_/sql/new) e execute. É seguro
-- rodar mais de uma vez (usa IF NOT EXISTS / CREATE OR REPLACE em tudo).
--
-- Autenticação: usamos o Supabase Auth nativo (schema `auth.users`) para
-- email/senha — por isso `public.users` NÃO tem coluna de senha. Cada linha
-- de `public.users` é um "perfil" vinculado 1:1 a um `auth.users` pelo `id`.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. companies
-- -----------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_code text not null unique,
  logo_url text,
  max_users integer, -- limite de vagas contratadas; null = sem limite (empresas seed/demo antigas)
  expires_at timestamptz, -- vencimento do plano corporativo; null = sem vencimento
  cnpj text, -- CNPJ usado na cobrança Asaas — pré-preenche o modal de Renovação/Upgrade (SubscriptionModal.jsx) e correlaciona pagamentos avulsos no webhook quando não há assinatura correspondente por id
  created_at timestamptz not null default now()
);

comment on table public.companies is 'Empresas clientes (multi-tenancy). company_code é usado no cadastro do colaborador para vínculo automático. max_users/expires_at controlam capacidade e vencimento do plano — ver check_company_capacity() e handle_new_auth_user().';

alter table public.companies add column if not exists max_users integer;
alter table public.companies add column if not exists expires_at timestamptz;
alter table public.companies add column if not exists cnpj text;

-- -----------------------------------------------------------------------------
-- 2. users (perfil — vinculado 1:1 a auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  job_title text,
  role text not null default 'employee' check (role in ('employee', 'admin', 'master')),
  company_id uuid references public.companies (id) on delete set null,
  avatar_url text default '🙂',
  xp integer not null default 0,
  level integer not null default 1,
  lives integer not null default 5,
  max_lives integer not null default 5,
  last_heart_lost_at timestamptz, -- início da contagem de recarga (10min) do próximo coração; null = vidas cheias
  streak integer not null default 0,
  streak_freezes integer not null default 0,
  gems integer not null default 1000, -- todo usuário novo já começa com saldo pra recarregar vidas na loja
  weekly_xp integer not null default 0, -- XP da semana corrente (ver week_start) — Ranking Semanal
  week_start date, -- segunda-feira da semana em que weekly_xp está sendo contado
  last_study_date date,
  current_level_id text default 'estagiario', -- nunca fica null: todo mundo começa no primeiro nível da trilha
  current_level_since date,
  time_spent_minutes integer not null default 0,
  trial_expires_at timestamptz, -- só preenchido pra contas do "Testar Grátis por 24 Horas"
  last_seen_changelog_version text, -- versão do popup "O que há de novo" que o usuário já fechou (ver src/data/changelog.js)
  created_at timestamptz not null default now()
);

comment on table public.users is 'Perfil do colaborador. id = auth.users.id. Sem coluna de senha: isso fica em auth.users, gerenciado pelo Supabase Auth.';
comment on column public.users.role is 'employee = colaborador comum; admin = gestor da própria empresa (Painel do Gestor); master = acesso total (conta do fundador/QA).';

-- "create table if not exists" não adiciona colunas novas a uma tabela que
-- já existe — estes ALTERs garantem que rodar este arquivo de novo num
-- projeto que já tinha uma versão anterior do schema também funciona
-- (idempotente: "add column if not exists" não falha se a coluna já existir).
alter table public.users add column if not exists last_heart_lost_at timestamptz;
alter table public.users add column if not exists weekly_xp integer not null default 0;
alter table public.users add column if not exists week_start date;
alter table public.users alter column gems set default 1000;
-- current_level_id só era preenchido ao PASSAR num Exame de Transição (ver
-- GameContext.jsx) — quem ainda está no primeiro nível (Estagiário) nunca
-- tinha essa coluna setada, o que fazia "Nível atual" e "Distribuição por
-- Nível" no Painel do Gestor aparecerem vazios pra maioria da equipe. Backfill
-- pontual pra quem já existia antes do default acima existir.
alter table public.users alter column current_level_id set default 'estagiario';
update public.users set current_level_id = 'estagiario' where current_level_id is null;

create index if not exists users_company_id_idx on public.users (company_id);

-- -----------------------------------------------------------------------------
-- 3. courses / lessons / questions
--
-- `courses` já foi `modules` (um curso só — Reforma Tributária — mais 6
-- placeholders "Disponível em breve"). Virou multi-curso de verdade nesta
-- leva: os blocos "do $$ ... end $$" abaixo fazem o rename com segurança
-- num banco que ainda tem os nomes antigos (ALTER TABLE/COLUMN RENAME é
-- metadado só, não reescreve linha — seguro mesmo com o app antigo no ar,
-- confirmado que nenhum código em produção referenciava `modules`/
-- `module_id` por nome antes desta migração). Num banco novo (instalação do
-- zero), os `do $$` simplesmente não encontram `modules` e não fazem nada —
-- o `create table if not exists public.courses` abaixo já cria do jeito certo.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'modules') then
    alter table public.modules rename to courses;
  end if;
end $$;

create table if not exists public.courses (
  id text primary key, -- ex: 'reforma-tributaria'
  title text not null,
  description text,
  icon text,
  color text,
  banner_url text,
  is_active boolean not null default false,
  content_version integer not null default 1, -- sobe a cada importação (ver admin_replace_course_content) — carimbo que o cache local (IndexedDB) usa pra saber se precisa rebaixar o curso
  order_index integer not null default 0
);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'courses' and column_name = 'is_available') then
    alter table public.courses rename column is_available to is_active;
  end if;
end $$;

alter table public.courses add column if not exists banner_url text;
alter table public.courses add column if not exists content_version integer not null default 1;

comment on column public.courses.content_version is 'Incrementado pela Edge Function de importação (admin-course-import) a cada upsert bem-sucedido — carimbo que o cliente usa pra saber se o cache local (IndexedDB) está desatualizado. Nunca decrementa.';

create table if not exists public.lessons (
  id text primary key, -- ex: 'estagiario-1', 'estagiario-exam'
  course_id text not null references public.courses (id) on delete cascade,
  career_level_id text, -- ex: 'estagiario' (null para cursos sem trilha de carreira)
  type text not null default 'regular' check (type in ('regular', 'exam')),
  title text not null,
  xp_reward integer not null default 0,
  question_count integer not null default 0,
  pass_threshold numeric(3, 2), -- só preenchido para type = 'exam' (ex: 0.80)
  order_index integer not null default 0
);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lessons' and column_name = 'module_id') then
    alter table public.lessons rename column module_id to course_id;
  end if;
end $$;

drop index if exists lessons_module_id_idx;
create index if not exists lessons_course_id_idx on public.lessons (course_id);

create table if not exists public.questions (
  id text primary key, -- ex: 'REF-EST-001'
  lesson_id text not null references public.lessons (id) on delete cascade,
  course_id text references public.courses (id) on delete cascade, -- denormalizado (pedido explícito) — evita join com lessons só pra filtrar questão por curso (ver api.fetchCourseContentBundle)
  level text not null, -- career_level_id da questão (redundante com a lição, útil pra filtro rápido)
  type text not null check (type in ('multiple_choice', 'true_false', 'ordering', 'fill_blank', 'text_input')),
  scenario text,
  question text not null,
  options jsonb, -- array de strings; null para true_false e text_input
  correct_answer jsonb not null, -- string | boolean | array de strings, conforme `type`
  explanation text,
  pacci_tip text,
  topic text not null default 'outros', -- pro gráfico Desempenho por Tema (ver get_company_topic_stats) — existia só no JSON bundlado antes desta migração, nunca tinha chegado até aqui
  order_index integer not null default 0
);

alter table public.questions add column if not exists topic text not null default 'outros';
alter table public.questions add column if not exists course_id text references public.courses (id) on delete cascade;

-- Backfill do course_id denormalizado a partir da lição, pra linhas já
-- existentes antes desta coluna existir.
update public.questions q
set course_id = l.course_id
from public.lessons l
where q.lesson_id = l.id and q.course_id is null;

alter table public.questions alter column course_id set not null;

create index if not exists questions_lesson_id_idx on public.questions (lesson_id);
create index if not exists questions_course_id_idx on public.questions (course_id);

-- -----------------------------------------------------------------------------
-- 3b. company_course_access — allow-list de curso por empresa. Uma empresa só
-- vê um curso se tiver uma linha aqui pra ele (master sempre vê/concede
-- tudo). "Reforma Tributária" recebe backfill logo abaixo pra toda empresa
-- já existente, senão o curso já homologado "desapareceria" de todo mundo
-- assim que a RLS (ver "Row Level Security" mais abaixo) entrar em vigor.
-- -----------------------------------------------------------------------------
create table if not exists public.company_course_access (
  company_id uuid not null references public.companies (id) on delete cascade,
  course_id text not null references public.courses (id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (company_id, course_id)
);

comment on table public.company_course_access is 'Allow-list de curso por empresa. Curso SEM linha aqui pra uma empresa = invisível pra ela (allow-list pura — só master vê tudo sempre).';

create index if not exists company_course_access_course_id_idx on public.company_course_access (course_id);

insert into public.company_course_access (company_id, course_id)
select c.id, 'reforma-tributaria'
from public.companies c
where exists (select 1 from public.courses where id = 'reforma-tributaria')
on conflict (company_id, course_id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. user_progress (substitui o estado local `state.modules` do GameContext)
-- -----------------------------------------------------------------------------
create table if not exists public.user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  lesson_id text not null references public.lessons (id) on delete cascade,
  completed_at timestamptz,
  score numeric(4, 3), -- % de acerto (0.000 a 1.000) — agora gravado pra toda lição, regular ou exame (ver GameContext.jsx)
  passed boolean, -- null para lições regulares (não têm conceito de reprovação)
  created_at timestamptz not null default now()
);

comment on table public.user_progress is 'Uma linha por tentativa de lição. Lições regulares: 1 linha ao concluir. Exames: 1 linha por tentativa (histórico completo de aprovações/reprovações).';

-- -----------------------------------------------------------------------------
-- 4b. question_attempts (1 linha por PERGUNTA respondida, não por lição) —
-- base do Painel do Gestor pra "Taxa Média de Acertos" e pro gráfico de
-- Desempenho por Tema. `topic` vem já resolvido do cliente (ver campo
-- `topic` em src/data/questions/*.json, classificado por palavra-chave do
-- próprio enunciado) — não tem FK pra `questions`/`lessons` de propósito:
-- cobre também sessões de Revisão Diária, que reusam perguntas de lições já
-- concluídas sob um lesson_id sintético ('daily-review') que não existe na
-- tabela `lessons`.
-- -----------------------------------------------------------------------------
create table if not exists public.question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  question_id text not null,
  lesson_id text not null,
  topic text not null,
  is_correct boolean not null,
  answered_at timestamptz not null default now()
);

comment on table public.question_attempts is 'Uma linha por pergunta respondida (não por lição) — granularidade fina o bastante pra calcular % de acerto por tópico no Painel do Gestor.';

create index if not exists question_attempts_user_id_idx on public.question_attempts (user_id);
create index if not exists question_attempts_topic_idx on public.question_attempts (topic);

-- -----------------------------------------------------------------------------
-- 4c. question_reports ("Reportar erro" no Quiz, motivo opcional) —
-- question_text vem denormalizado do cliente no momento do clique (mesmo
-- texto que o usuário estava vendo), pelo mesmo motivo de question_attempts:
-- não depender de join com a tabela `questions` pra exibir no Painel Master.
-- -----------------------------------------------------------------------------
create table if not exists public.question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id text not null,
  question_text text not null,
  user_id uuid not null references public.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  reason text, -- motivo opcional digitado por quem reportou (ver ReportQuestionModal em QuizEngine.jsx)
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'resolved'))
);

comment on table public.question_reports is 'Reportes de "essa questão está errada" (motivo opcional) — ver aba "Questões Reportadas" no Painel de Contingência (master).';

create index if not exists question_reports_question_id_idx on public.question_reports (question_id);
create index if not exists question_reports_status_idx on public.question_reports (status);
-- FK pra `users` sem índice próprio (Postgres não cria automático) — usada
-- no join embutido de fetchQuestionReports (ver api.js) pra trazer
-- full_name/email de quem reportou.
create index if not exists question_reports_user_id_idx on public.question_reports (user_id);

-- -----------------------------------------------------------------------------
-- 4d. user_notifications ("Sua sugestão foi aplicada!" e futuros avisos
-- pontuais pro colaborador) — master grava (ex: ao resolver um
-- question_report, ver api.resolveQuestionReports), o próprio dono só lê e
-- marca como lida a partir do app (ver GameContext.jsx / NotificationModal).
-- -----------------------------------------------------------------------------
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  message text not null,
  reward_gems integer not null default 0,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.user_notifications is 'Avisos pontuais pro colaborador (ex: report de questão corrigido) — lidos/marcados como lidos pelo próprio app ao logar/abrir a Home.';

create index if not exists user_notifications_user_id_idx on public.user_notifications (user_id);
create index if not exists user_notifications_unread_idx on public.user_notifications (user_id) where not read;

create index if not exists user_progress_user_id_idx on public.user_progress (user_id);
create index if not exists user_progress_lesson_id_idx on public.user_progress (lesson_id);
-- Acelera a checagem "colaborador já completou esta lição regular?"
create unique index if not exists user_progress_unique_regular_completion
  on public.user_progress (user_id, lesson_id)
  where passed is null; -- só uma linha "concluída" por lição regular; exames podem repetir

-- -----------------------------------------------------------------------------
-- 5. temp_access_tokens (Testar Grátis por 24 Horas)
-- -----------------------------------------------------------------------------
create table if not exists public.temp_access_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  temp_password text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.temp_access_tokens is 'Sem RLS liberada para anon/authenticated — só a Edge Function (service_role) acessa. Contém senha temporária em texto puro por curtíssimo prazo (24h) só para o e-mail de boas-vindas; o login real usa auth.users normalmente.';

create index if not exists temp_access_tokens_email_idx on public.temp_access_tokens (email);

-- -----------------------------------------------------------------------------
-- 6. subscriptions (plano da empresa — checkout Asaas e/ou Nitrus)
-- -----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  plan text not null check (plan in ('individual', 'starter', 'pro')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled')),
  seats_limit integer not null,
  asaas_customer_id text,
  asaas_subscription_id text,
  nitrus_customer_id text,
  nitrus_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_company_id_idx on public.subscriptions (company_id);

alter table public.subscriptions add column if not exists nitrus_customer_id text;
alter table public.subscriptions add column if not exists nitrus_subscription_id text;

-- Reaplica o check com 'individual' incluído mesmo em bancos que já tinham
-- rodado uma versão anterior deste schema.sql (create table if not exists
-- não altera constraints de uma tabela que já existe).
alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check check (plan in ('individual', 'starter', 'pro'));

-- -----------------------------------------------------------------------------
-- 6b. pending_signups (checkout Nitrus para empresa NOVA — ver
-- supabase/functions/create-nitrus-checkout e supabase/functions/nitrus-webhook)
--
-- A diferença pro fluxo Asaas: no Asaas a empresa já existe e só é
-- ativada; aqui o pagamento pode vir de alguém que ainda nem tem conta no
-- TaxLingo, então guardamos os dados da empresa/plano aqui até o webhook
-- confirmar o pagamento e criar de fato a linha em `companies`.
-- -----------------------------------------------------------------------------
create table if not exists public.pending_signups (
  id uuid primary key default gen_random_uuid(),
  external_reference text not null unique,
  company_name text not null,
  admin_name text,
  admin_email text not null,
  admin_phone text,
  plan text not null check (plan in ('individual', 'starter', 'pro')),
  cpf_cnpj text,
  seats_requested integer, -- só preenchido pra leads do formulário "Plano Corporativo" (AuthModal.jsx)
  payment_link_id text, -- id do Payment Link do Asaas (create-corporate-lead) — é assim que o asaas-webhook casa o pagamento confirmado com esta proposta e libera a empresa certa
  status text not null default 'pending' check (status in ('pending', 'completed', 'expired')),
  company_id uuid references public.companies (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.pending_signups add column if not exists seats_requested integer;
alter table public.pending_signups add column if not exists admin_phone text;
alter table public.pending_signups add column if not exists payment_link_id text;

create index if not exists pending_signups_payment_link_id_idx on public.pending_signups (payment_link_id);

alter table public.pending_signups drop constraint if exists pending_signups_plan_check;
alter table public.pending_signups add constraint pending_signups_plan_check check (plan in ('individual', 'starter', 'pro'));

comment on table public.pending_signups is 'Cadastro de empresa (ou conta individual) aguardando confirmação de pagamento via Nitrus/Asaas. external_reference é o id ecoado de volta no webhook.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Trigger: cria automaticamente o perfil em public.users quando alguém se
-- cadastra via supabase.auth.signUp(). Os campos extras (full_name, job_title,
-- company_id) vêm de `options.data` passado no signUp — ver src/lib/supabase.js.
-- =============================================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target_company_id uuid;
  target_max_users integer;
  target_expires_at timestamptz;
  current_count integer;
begin
  target_company_id := nullif(new.raw_user_meta_data ->> 'company_id', '')::uuid;

  -- Guarda de capacidade/vencimento: roda de novo aqui (além do pré-check em
  -- check_company_capacity(), chamado pelo cliente antes do signUp) porque
  -- o pré-check tem uma janela de corrida (duas pessoas podem passar nele
  -- ao mesmo tempo, com a última vaga). Isto aqui é a garantia de verdade —
  -- rodar dentro da mesma transação do insert em auth.users garante que,
  -- se estourar o limite, o cadastro inteiro é desfeito (não sobra usuário
  -- órfão sem perfil).
  if target_company_id is not null then
    select max_users, expires_at into target_max_users, target_expires_at
    from public.companies
    where id = target_company_id;

    if not found then
      raise exception 'Empresa não encontrada.';
    end if;

    if target_expires_at is not null and target_expires_at < now() then
      raise exception 'O plano desta empresa está vencido. Peça ao RH para renovar.';
    end if;

    if target_max_users is not null then
      select count(*) into current_count from public.users where company_id = target_company_id;
      if current_count >= target_max_users then
        raise exception 'Limite de vagas da empresa atingido. Peça ao RH para ampliar o plano.';
      end if;
    end if;
  end if;

  insert into public.users (id, email, full_name, job_title, company_id, avatar_url, trial_expires_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'job_title',
    target_company_id,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', '🙂'),
    nullif(new.raw_user_meta_data ->> 'trial_expires_at', '')::timestamptz
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Pré-checagem chamável pelo cliente ANTES de signUp() — dá uma mensagem de
-- erro amigável sem precisar tentar criar a conta pra descobrir que a
-- empresa está lotada/vencida. A garantia de verdade continua sendo o
-- trigger acima (roda dentro da mesma transação do cadastro).
create or replace function public.check_company_capacity(p_company_code text)
returns table (is_valid boolean, reason text, company_id uuid)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  target record;
  current_count integer;
begin
  select id, max_users, expires_at into target
  from public.companies
  where company_code = upper(trim(p_company_code));

  if target.id is null then
    return query select false, 'Código de empresa inválido. Confira com o seu RH.'::text, null::uuid;
    return;
  end if;

  if target.expires_at is not null and target.expires_at < now() then
    return query select false, 'O plano desta empresa está vencido. Peça ao RH para renovar.'::text, target.id;
    return;
  end if;

  if target.max_users is not null then
    -- "company_id" sem apelido aqui seria ambíguo: o RETURNS TABLE acima
    -- declara uma variável implícita chamada company_id, que colide com a
    -- coluna public.users.company_id — por isso o "u." explícito.
    select count(*) into current_count from public.users u where u.company_id = target.id;
    if current_count >= target.max_users then
      return query select false, 'Limite de vagas da empresa atingido. Peça ao RH para ampliar o plano.'::text, target.id;
      return;
    end if;
  end if;

  return query select true, null::text, target.id;
end;
$$;

grant execute on function public.check_company_capacity(text) to anon, authenticated;

comment on function public.check_company_capacity(text) is 'Checagem de código de empresa (existe? plano ativo? tem vaga?) chamada pelo cliente antes de signUp(). SECURITY DEFINER porque roda antes de existir sessão.';

-- Pré-checagem chamável pelo cliente ANTES de mandar o e-mail de "esqueci
-- minha senha" (sem sessão, só o e-mail digitado) — mesma regra de
-- isAccessExpired() em GameContext.jsx (checada de novo no login de
-- verdade), só que aqui sem precisar de senha. Devolve false se o e-mail
-- não existir (não revela se a conta existe) ou se for a conta master
-- (nunca é barrada por vencimento).
create or replace function public.check_access_expired_by_email(p_email text)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce(
    (
      select
        u.role != 'master'
        and (
          (u.trial_expires_at is not null and u.trial_expires_at < now())
          or (c.expires_at is not null and c.expires_at < now())
        )
      from public.users u
      left join public.companies c on c.id = u.company_id
      where lower(u.email) = lower(trim(p_email))
    ),
    false
  );
$$;

grant execute on function public.check_access_expired_by_email(text) to anon, authenticated;

comment on function public.check_access_expired_by_email(text) is 'Checagem de expiração de acesso (trial ou plano Corporativo da empresa) por e-mail, sem sessão — usada por "Esqueci minha senha" antes de mandar o link de redefinição. SECURITY DEFINER porque roda sem sessão.';

-- =============================================================================
-- Helpers de RLS (SECURITY DEFINER pra evitar recursão de policy em `users`)
-- =============================================================================
create or replace function public.current_user_company_id()
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select company_id from public.users where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns text
language sql
security definer set search_path = public
stable
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_manager()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce(public.current_user_role() in ('admin', 'master'), false);
$$;

create or replace function public.is_master()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce(public.current_user_role() = 'master', false);
$$;

-- Ranking Geral: qualquer colaborador logado pode comparar XP com o de
-- outras empresas, mas a tabela `users` completa (email etc.) fica
-- restrita a self/própria empresa/master (ver policy users_select_self_or_company
-- abaixo). Por isso o "Ranking Geral" não faz um SELECT direto em `users` —
-- usa esta função SECURITY DEFINER, que só devolve as colunas não sensíveis
-- necessárias pro pódio/lista (nome, avatar, cargo, empresa, xp).
-- drop antes do create or replace: mudar as colunas do "returns table" exige
-- isso (Postgres não deixa alterar o retorno de uma function existente só
-- com "or replace") — necessário pra quem já tinha rodado uma versão
-- anterior deste schema.sql, antes de weekly_xp existir.
drop function if exists public.get_global_leaderboard();

create or replace function public.get_global_leaderboard()
returns table (id uuid, full_name text, avatar_url text, job_title text, company_id uuid, xp integer, weekly_xp integer)
language sql
security definer set search_path = public
stable
as $$
  select
    u.id, u.full_name, u.avatar_url, u.job_title, u.company_id, u.xp,
    -- weekly_xp só é fiel à semana corrente se week_start bater com a
    -- segunda-feira desta semana (ver addXp em GameContext.jsx: o "reset"
    -- semanal só acontece no PRÓXIMO ganho de XP do usuário, então quem para
    -- de estudar no meio de uma semana fica com o número congelado —
    -- sem esse case, essa pessoa continuaria "no topo" do Ranking Semanal
    -- pra sempre, mesmo inativa). Fora da semana corrente, conta como 0.
    case when u.week_start = (date_trunc('week', now()))::date then u.weekly_xp else 0 end as weekly_xp
  from public.users u
  left join public.companies c on c.id = u.company_id
  where u.role != 'master'
    -- Privacidade B2B: colaborador de Plano Corporativo de verdade (Starter/
    -- Pro, com limite de vagas real em max_users) não aparece pra outras
    -- empresas no Ranking Geral. Individual/Teste Grátis são "empresas" de 1
    -- pessoa só (max_users null) e continuam aparecendo normalmente.
    and (c.max_users is null)
  order by u.xp desc;
$$;

comment on function public.get_global_leaderboard() is 'Exposto a qualquer usuário autenticado — só colunas seguras pro Ranking Geral entre empresas (não usa a policy de users, que é restrita à própria empresa). Exclui role=master (a conta do fundador não compete) e colaboradores de Plano Corporativo de verdade (privacidade B2B — ver max_users). weekly_xp é recalculado na leitura pra contar como 0 fora da semana corrente (ver week_start).';

-- Ranking da Empresa: a policy users_select_self_or_company só deixa
-- admin/master ler os colegas inteiros (comum lê só a própria linha) — um
-- SELECT direto em `users` filtrado por company_id devolvia, pra um
-- colaborador comum, só ele mesmo (sem erro nenhum, RLS filtra em
-- silêncio). Mesma solução do Ranking Geral acima: function SECURITY
-- DEFINER com as colunas seguras, mas agora com o guard de empresa embutido
-- na própria query (não dá pra um usuário pedir o ranking de UMA OUTRA
-- empresa só trocando o p_company_id — se não bater com a própria empresa
-- dele, ou ele não for master, a condição fica sempre falsa e a lista volta
-- vazia, igual RLS negando de verdade faria).
drop function if exists public.get_company_leaderboard(uuid);

create or replace function public.get_company_leaderboard(p_company_id uuid)
returns table (id uuid, full_name text, avatar_url text, job_title text, company_id uuid, xp integer, weekly_xp integer)
language sql
security definer set search_path = public
stable
as $$
  select
    id, full_name, avatar_url, job_title, company_id, xp,
    -- Mesma lógica do get_global_leaderboard: weekly_xp só conta se
    -- week_start for a segunda-feira desta semana, senão é 0 na leitura.
    case when week_start = (date_trunc('week', now()))::date then weekly_xp else 0 end as weekly_xp
  from public.users
  where company_id = p_company_id
    and role != 'master'
    and (public.is_master() or p_company_id = public.current_user_company_id())
  order by xp desc;
$$;

grant execute on function public.get_company_leaderboard(uuid) to authenticated;

comment on function public.get_company_leaderboard(uuid) is 'Ranking da Empresa: qualquer colaborador autenticado pode ver XP dos colegas da PRÓPRIA empresa (guard embutido na query — pedir o company_id de outra empresa sempre volta vazio). Exclui role=master: a conta do fundador não compete no ranking. weekly_xp é recalculado na leitura pra contar como 0 fora da semana corrente (ver week_start).';

-- Desempenho por Tema (Painel do Gestor) — agrega question_attempts por
-- tópico DIRETO no Postgres em vez de baixar toda tentativa bruta de cada
-- pergunta pro cliente só pra contar lá (ver auditoria de capacidade do
-- Free Tier: question_attempts é a tabela que mais cresce — uma linha por
-- pergunta respondida, pra sempre — e cada curso novo adiciona mais tópicos
-- e mais tentativas; sem agregação no banco, abrir o Painel do Gestor baixa
-- cada vez mais dado ao longo do tempo). Mesmo guard de empresa do
-- get_company_leaderboard.
drop function if exists public.get_company_topic_stats(uuid);

create or replace function public.get_company_topic_stats(p_company_id uuid)
returns table (topic text, total integer, correct integer)
language sql
security definer set search_path = public
stable
as $$
  select
    qa.topic,
    count(*)::integer as total,
    count(*) filter (where qa.is_correct)::integer as correct
  from public.question_attempts qa
  join public.users u on u.id = qa.user_id
  where u.company_id = p_company_id
    and (public.is_master() or p_company_id = public.current_user_company_id())
  group by qa.topic;
$$;

grant execute on function public.get_company_topic_stats(uuid) to authenticated;

comment on function public.get_company_topic_stats(uuid) is 'Substitui fetchCompanyTopicAttempts (que baixava 1 linha por tentativa) por totais já agregados por tópico — poucas dezenas de linhas, não milhares. Ver src/components/AdminDashboard.jsx (gráfico Desempenho por Tema).';

-- Progresso por curso (card "X% concluído" + selo de certificado disponível
-- na Home) — agregação no banco pra não exigir baixar o bundle pesado de
-- questões do curso só pra mostrar essa barra. "Concluiu o curso" = passou
-- no exame da ÚLTIMA lição (maior order_index entre as do tipo 'exam')
-- daquele curso — mesma regra usada no cliente por hasCompletedTrail (ver
-- src/utils/certificate.js), só que calculada aqui pros cursos ainda não
-- abertos pelo usuário nesta sessão.
drop function if exists public.get_user_course_progress(uuid);

create or replace function public.get_user_course_progress(p_user_id uuid)
returns table (course_id text, total_lessons integer, completed_lessons integer, final_exam_passed boolean)
language sql
security definer set search_path = public
stable
as $$
  select
    l.course_id,
    count(*)::integer as total_lessons,
    count(*) filter (
      where up.passed is true or (up.passed is null and up.completed_at is not null)
    )::integer as completed_lessons,
    coalesce(bool_or(up.passed) filter (
      where l.type = 'exam' and l.order_index = (
        select max(l2.order_index) from public.lessons l2 where l2.course_id = l.course_id and l2.type = 'exam'
      )
    ), false) as final_exam_passed
  from public.lessons l
  left join public.user_progress up on up.lesson_id = l.id and up.user_id = p_user_id
  where p_user_id = auth.uid() or public.is_master()
  group by l.course_id;
$$;

grant execute on function public.get_user_course_progress(uuid) to authenticated;

comment on function public.get_user_course_progress(uuid) is 'Alimenta % de progresso e selo de certificado disponível no card de cada curso na Home — agregação no banco pra não exigir o bundle pesado do curso só pra mostrar essa barra.';

-- Importação atômica de curso (metadado + conteúdo). SECURITY DEFINER mas
-- SEM grant execute pra authenticated/anon — só a Edge Function
-- admin-course-import chama isto, usando a service-role key, depois de já
-- validar o payload inteiro. Tudo roda dentro da transação implícita desta
-- função: ou o curso inteiro troca de conteúdo e a versão sobe, ou um erro
-- no meio desfaz tudo (nunca fica um curso "pela metade").
drop function if exists public.admin_replace_course_content(text, jsonb, jsonb);

create or replace function public.admin_replace_course_content(p_course_id text, p_lessons jsonb, p_questions jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.lessons where course_id = p_course_id;

  insert into public.lessons (id, course_id, career_level_id, type, title, xp_reward, question_count, pass_threshold, order_index)
  select
    x.id, p_course_id, x.career_level_id, x.type, x.title,
    x.xp_reward, x.question_count, x.pass_threshold, x.order_index
  from jsonb_to_recordset(p_lessons) as x(
    id text, career_level_id text, type text, title text,
    xp_reward integer, question_count integer, pass_threshold numeric, order_index integer
  );

  insert into public.questions (id, lesson_id, course_id, level, type, scenario, question, options, correct_answer, explanation, pacci_tip, topic, order_index)
  select
    x.id, x.lesson_id, p_course_id, x.level, x.type, x.scenario, x.question,
    x.options, x.correct_answer, x.explanation, x.pacci_tip, x.topic, x.order_index
  from jsonb_to_recordset(p_questions) as x(
    id text, lesson_id text, level text, type text, scenario text, question text,
    options jsonb, correct_answer jsonb, explanation text, pacci_tip text, topic text, order_index integer
  );

  update public.courses set content_version = content_version + 1 where id = p_course_id;
end;
$$;

comment on function public.admin_replace_course_content(text, jsonb, jsonb) is 'SECURITY DEFINER, NUNCA exposta a authenticated/anon (sem grant execute pra esses roles) — só a Edge Function admin-course-import chama isto, usando a service-role key. Tudo roda numa transação de função só: ou o curso inteiro troca de conteúdo e a versão sobe, ou nada muda.';

-- Lead "morno" capturado em public/comece.html (landing de topo de funil
-- para contadores/donos de escritório vindos do Instagram) — via a Edge
-- Function capture-marketing-lead. Diferente de pending_signups, não tem
-- CNPJ nem cobrança automática: é só um contato pro time comercial fazer
-- o follow-up manual via WhatsApp.
create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  company_name text,
  source text,
  created_at timestamptz not null default now()
);

comment on table public.marketing_leads is 'Leads de topo de funil (ex.: landing pages de tráfego pago/orgânico) aguardando contato comercial manual — sem CNPJ nem cobrança, diferente de pending_signups.';

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.companies enable row level security;
alter table public.users enable row level security;
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.questions enable row level security;
alter table public.company_course_access enable row level security;
alter table public.user_progress enable row level security;
alter table public.question_attempts enable row level security;
alter table public.question_reports enable row level security;
alter table public.user_notifications enable row level security;
alter table public.temp_access_tokens enable row level security;
alter table public.subscriptions enable row level security;
-- pending_signups não tem policy nenhuma de propósito: só as Edge Functions
-- (create-nitrus-checkout / nitrus-webhook), que usam a service_role key e
-- por isso ignoram RLS, têm qualquer motivo pra tocar nessa tabela — ela
-- carrega e-mail/CPF-CNPJ de gente que ainda nem tem conta, não deve ser
-- legível por nenhum papel autenticado comum.
alter table public.pending_signups enable row level security;
-- marketing_leads segue o mesmo raciocínio de pending_signups: só a Edge
-- Function capture-marketing-lead (service_role key, ignora RLS) tem
-- motivo pra gravar/ler aqui — carrega e-mail/WhatsApp de gente que nem
-- visitante autenticado é, não deve ser legível por nenhum papel comum.
alter table public.marketing_leads enable row level security;

-- companies: leitura pública (necessário pra validar company_code no cadastro,
-- antes mesmo de existir sessão). Nenhuma escrita pelo cliente.
drop policy if exists companies_select_all on public.companies;
create policy companies_select_all on public.companies for select using (true);

-- users: cada um vê/edita o próprio perfil; quem é admin/master vê a própria
-- empresa inteira (Painel do Gestor); master vê todo mundo.
drop policy if exists users_select_self_or_company on public.users;
create policy users_select_self_or_company on public.users for select
  using (
    id = auth.uid()
    or public.is_master()
    or (public.is_manager() and company_id = public.current_user_company_id())
  );

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users for update
  using (id = auth.uid() or public.is_master())
  with check (id = auth.uid() or public.is_master());

-- courses/lessons/questions: leitura só de curso com allow-list em
-- company_course_access pra própria empresa (master vê tudo sempre). Antes
-- da migração multi-curso, isto era liberado pra qualquer autenticado —
-- agora segue o mesmo padrão self-or-company do resto do arquivo, só que
-- via tabela de allow-list em vez de comparar company_id diretamente,
-- porque um curso pode ser liberado pra N empresas, não só uma.
--
-- Exceção só em `courses` (metadado): um curso ainda INATIVO (is_active =
-- false, ex: os placeholders "Disponível em breve") fica visível pra
-- qualquer autenticado mesmo sem allow-list — é só o card de "em breve",
-- sem lição/questão nenhuma por trás (preserva o comportamento de antes da
-- migração). `lessons`/`questions` NÃO têm essa exceção: mesmo um curso
-- inativo que já tenha conteúdo sendo preparado continua escondido de quem
-- não tem grant.
drop policy if exists modules_select_authenticated on public.courses;
drop policy if exists courses_select_authenticated on public.courses;
create policy courses_select_authenticated on public.courses for select
  using (
    auth.role() = 'authenticated'
    and (
      public.is_master()
      or not courses.is_active
      or exists (
        select 1 from public.company_course_access a
        where a.course_id = courses.id and a.company_id = public.current_user_company_id()
      )
    )
  );

-- Metadados do curso (título/descrição/ícone/cor/banner/ativo) são
-- cadastrados/editados direto pelo painel "Metadados do Curso" (só master,
-- ver CourseMetadataPanel.jsx) — escrita direta via supabase-js, sem Edge
-- Function, mesmo padrão de updateProfile. Conteúdo (lições/questões)
-- continua um caminho à parte, só pela RPC admin_replace_course_content.
drop policy if exists courses_write_master on public.courses;
create policy courses_write_master on public.courses for all
  using (public.is_master())
  with check (public.is_master());

drop policy if exists lessons_select_authenticated on public.lessons;
create policy lessons_select_authenticated on public.lessons for select
  using (
    auth.role() = 'authenticated'
    and (
      public.is_master()
      or exists (
        select 1 from public.company_course_access a
        where a.course_id = lessons.course_id and a.company_id = public.current_user_company_id()
      )
    )
  );

drop policy if exists questions_select_authenticated on public.questions;
create policy questions_select_authenticated on public.questions for select
  using (
    auth.role() = 'authenticated'
    and (
      public.is_master()
      or exists (
        select 1 from public.company_course_access a
        where a.course_id = questions.course_id and a.company_id = public.current_user_company_id()
      )
    )
  );

-- Só o master edita gabarito (modal "Revisar Questão" da aba Questões
-- Reportadas, ver QuestionReviewModal.jsx) — colaboradores e gestores só leem.
drop policy if exists questions_update_master on public.questions;
create policy questions_update_master on public.questions for update
  using (public.is_master())
  with check (public.is_master());

-- company_course_access: master gerencia tudo; gestor só vê os grants da
-- própria empresa (útil pra entender por que um curso não aparece pra ele).
drop policy if exists company_course_access_select on public.company_course_access;
create policy company_course_access_select on public.company_course_access for select
  using (public.is_master() or (public.is_manager() and company_id = public.current_user_company_id()));

drop policy if exists company_course_access_write_master on public.company_course_access;
create policy company_course_access_write_master on public.company_course_access for all
  using (public.is_master())
  with check (public.is_master());

-- user_progress: cada um grava/lê o próprio progresso; admin/master leem o
-- progresso de quem está na mesma empresa (pro Painel do Gestor).
drop policy if exists user_progress_select_self_or_company on public.user_progress;
create policy user_progress_select_self_or_company on public.user_progress for select
  using (
    user_id = auth.uid()
    or public.is_master()
    or (
      public.is_manager()
      and user_id in (select id from public.users where company_id = public.current_user_company_id())
    )
  );

drop policy if exists user_progress_insert_self on public.user_progress;
create policy user_progress_insert_self on public.user_progress for insert
  with check (user_id = auth.uid());

-- question_attempts: mesma regra do user_progress (self/própria empresa/master).
drop policy if exists question_attempts_select_self_or_company on public.question_attempts;
create policy question_attempts_select_self_or_company on public.question_attempts for select
  using (
    user_id = auth.uid()
    or public.is_master()
    or (
      public.is_manager()
      and user_id in (select id from public.users where company_id = public.current_user_company_id())
    )
  );

drop policy if exists question_attempts_insert_self on public.question_attempts;
create policy question_attempts_insert_self on public.question_attempts for insert
  with check (user_id = auth.uid());

-- question_reports: qualquer usuário autenticado pode reportar (1 clique,
-- sem exigir texto), mas só o master lê a lista e marca como corrigida — é
-- conteúdo/qualidade do banco de questões (cross-company), não dado do
-- próprio usuário nem da própria empresa, então não segue o padrão
-- self-or-company do resto do arquivo.
drop policy if exists question_reports_insert_self on public.question_reports;
create policy question_reports_insert_self on public.question_reports for insert
  with check (user_id = auth.uid());

drop policy if exists question_reports_select_master on public.question_reports;
create policy question_reports_select_master on public.question_reports for select
  using (public.is_master());

drop policy if exists question_reports_update_master on public.question_reports;
create policy question_reports_update_master on public.question_reports for update
  using (public.is_master())
  with check (public.is_master());

-- user_notifications: cada um só lê/marca como lida a própria notificação;
-- só o master cria (ver api.resolveQuestionReports) — mesmo padrão de
-- question_reports acima, não é dado de empresa.
drop policy if exists user_notifications_select_self_or_master on public.user_notifications;
create policy user_notifications_select_self_or_master on public.user_notifications for select
  using (user_id = auth.uid() or public.is_master());

drop policy if exists user_notifications_insert_master on public.user_notifications;
create policy user_notifications_insert_master on public.user_notifications for insert
  with check (public.is_master());

drop policy if exists user_notifications_update_self_or_master on public.user_notifications;
create policy user_notifications_update_self_or_master on public.user_notifications for update
  using (user_id = auth.uid() or public.is_master())
  with check (user_id = auth.uid() or public.is_master());

-- temp_access_tokens: SEM policy pra anon/authenticated -> RLS bloqueia tudo
-- por padrão. Só a Edge Function (com a service_role key) consegue ler/escrever.

-- subscriptions: admin/master da empresa conseguem ver o próprio plano.
drop policy if exists subscriptions_select_company on public.subscriptions;
create policy subscriptions_select_company on public.subscriptions for select
  using (public.is_master() or (public.is_manager() and company_id = public.current_user_company_id()));

-- =============================================================================
-- Fim do schema. Próximo passo: rode `node scripts/seed.mjs` (ver README) pra
-- popular companies, usuários de teste, a conta master e o banco de 1000
-- questões a partir de src/data/.
-- =============================================================================
