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
  created_at timestamptz not null default now()
);

comment on table public.companies is 'Empresas clientes (multi-tenancy). company_code é usado no cadastro do colaborador para vínculo automático. max_users/expires_at controlam capacidade e vencimento do plano — ver check_company_capacity() e handle_new_auth_user().';

alter table public.companies add column if not exists max_users integer;
alter table public.companies add column if not exists expires_at timestamptz;

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
  current_level_id text,
  current_level_since date,
  time_spent_minutes integer not null default 0,
  trial_expires_at timestamptz, -- só preenchido pra contas do "Testar Grátis por 24 Horas"
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

create index if not exists users_company_id_idx on public.users (company_id);

-- -----------------------------------------------------------------------------
-- 3. modules / lessons / questions
-- -----------------------------------------------------------------------------
create table if not exists public.modules (
  id text primary key, -- ex: 'reforma-tributaria'
  title text not null,
  description text,
  icon text,
  color text,
  is_available boolean not null default false,
  order_index integer not null default 0
);

create table if not exists public.lessons (
  id text primary key, -- ex: 'estagiario-1', 'estagiario-exam'
  module_id text not null references public.modules (id) on delete cascade,
  career_level_id text, -- ex: 'estagiario' (null para módulos sem trilha de carreira)
  type text not null default 'regular' check (type in ('regular', 'exam')),
  title text not null,
  xp_reward integer not null default 0,
  question_count integer not null default 0,
  pass_threshold numeric(3, 2), -- só preenchido para type = 'exam' (ex: 0.80)
  order_index integer not null default 0
);

create index if not exists lessons_module_id_idx on public.lessons (module_id);

create table if not exists public.questions (
  id text primary key, -- ex: 'REF-EST-001'
  lesson_id text not null references public.lessons (id) on delete cascade,
  level text not null, -- career_level_id da questão (redundante com a lição, útil pra filtro rápido)
  type text not null check (type in ('multiple_choice', 'true_false', 'ordering', 'fill_blank', 'text_input')),
  scenario text,
  question text not null,
  options jsonb, -- array de strings; null para true_false e text_input
  correct_answer jsonb not null, -- string | boolean | array de strings, conforme `type`
  explanation text,
  pacci_tip text,
  order_index integer not null default 0
);

create index if not exists questions_lesson_id_idx on public.questions (lesson_id);

-- -----------------------------------------------------------------------------
-- 4. user_progress (substitui o estado local `state.modules` do GameContext)
-- -----------------------------------------------------------------------------
create table if not exists public.user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  lesson_id text not null references public.lessons (id) on delete cascade,
  completed_at timestamptz,
  score numeric(4, 3), -- % de acerto (0.000 a 1.000) — relevante para exames
  passed boolean, -- null para lições regulares (não têm conceito de reprovação)
  created_at timestamptz not null default now()
);

comment on table public.user_progress is 'Uma linha por tentativa de lição. Lições regulares: 1 linha ao concluir. Exames: 1 linha por tentativa (histórico completo de aprovações/reprovações).';

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
  plan text not null check (plan in ('individual', 'starter', 'pro')),
  cpf_cnpj text,
  seats_requested integer, -- só preenchido pra leads do formulário "Plano Corporativo" (AuthModal.jsx)
  status text not null default 'pending' check (status in ('pending', 'completed', 'expired')),
  company_id uuid references public.companies (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.pending_signups add column if not exists seats_requested integer;

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
    select count(*) into current_count from public.users where company_id = target.id;
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
  select id, full_name, avatar_url, job_title, company_id, xp, weekly_xp
  from public.users
  order by xp desc;
$$;

comment on function public.get_global_leaderboard() is 'Exposto a qualquer usuário autenticado — só colunas seguras pro Ranking Geral entre empresas (não usa a policy de users, que é restrita à própria empresa).';

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.companies enable row level security;
alter table public.users enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.questions enable row level security;
alter table public.user_progress enable row level security;
alter table public.temp_access_tokens enable row level security;
alter table public.subscriptions enable row level security;
-- pending_signups não tem policy nenhuma de propósito: só as Edge Functions
-- (create-nitrus-checkout / nitrus-webhook), que usam a service_role key e
-- por isso ignoram RLS, têm qualquer motivo pra tocar nessa tabela — ela
-- carrega e-mail/CPF-CNPJ de gente que ainda nem tem conta, não deve ser
-- legível por nenhum papel autenticado comum.
alter table public.pending_signups enable row level security;

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

-- modules/lessons/questions: conteúdo, leitura liberada pra qualquer usuário logado.
drop policy if exists modules_select_authenticated on public.modules;
create policy modules_select_authenticated on public.modules for select
  using (auth.role() = 'authenticated');

drop policy if exists lessons_select_authenticated on public.lessons;
create policy lessons_select_authenticated on public.lessons for select
  using (auth.role() = 'authenticated');

drop policy if exists questions_select_authenticated on public.questions;
create policy questions_select_authenticated on public.questions for select
  using (auth.role() = 'authenticated');

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
