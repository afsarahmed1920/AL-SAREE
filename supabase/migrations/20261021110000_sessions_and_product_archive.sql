create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.session_revocation_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  session_id uuid not null,
  action text not null check (action in ('revoke_one', 'revoke_others', 'revoke_all')),
  created_at timestamptz not null default now()
);
alter table private.session_revocation_audit enable row level security;
revoke all on private.session_revocation_audit from public, anon, authenticated, service_role;

create or replace function public.list_auth_sessions(p_user_id uuid)
returns table (
  session_id uuid,
  user_agent text,
  ip text,
  created_at timestamptz,
  last_activity timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select s.id,
         s.user_agent,
         s.ip::text,
         s.created_at,
         greatest(s.updated_at, coalesce(s.refreshed_at::timestamptz, s.created_at))
  from auth.sessions as s
  where s.user_id = p_user_id
    and (s.not_after is null or s.not_after > now())
  order by greatest(s.updated_at, coalesce(s.refreshed_at::timestamptz, s.created_at)) desc;
$$;

create or replace function public.revoke_auth_sessions(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid default null,
  p_except_session_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_count integer;
begin
  if p_session_id is not null and p_except_session_id is not null then
    raise exception 'Invalid session revoke request';
  end if;

  v_action := case
    when p_session_id is not null then 'revoke_one'
    when p_except_session_id is not null then 'revoke_others'
    else 'revoke_all'
  end;

  insert into private.session_revocation_audit(actor_user_id, target_user_id, session_id, action)
  select p_actor_user_id, s.user_id, s.id, v_action
  from auth.sessions as s
  where s.user_id = p_target_user_id
    and (p_session_id is null or s.id = p_session_id)
    and (p_except_session_id is null or s.id <> p_except_session_id);

  delete from auth.sessions as s
  where s.user_id = p_target_user_id
    and (p_session_id is null or s.id = p_session_id)
    and (p_except_session_id is null or s.id <> p_except_session_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.is_master_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'master'
  );
$$;

revoke all on function public.list_auth_sessions(uuid) from public, anon, authenticated;
revoke all on function public.revoke_auth_sessions(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_auth_sessions(uuid) to service_role;
grant execute on function public.revoke_auth_sessions(uuid, uuid, uuid, uuid) to service_role;
revoke all on function public.is_master_user() from public, anon;
grant execute on function public.is_master_user() to authenticated, service_role;

update public.products set status = 'active' where status is null;
alter table public.products alter column status set default 'active';
alter table public.products alter column status set not null;
alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status in ('active', 'archived'));

drop policy if exists prod_read on public.products;
create policy prod_read on public.products
  for select to authenticated
  using (public.is_active_user() and (status = 'active' or public.is_master_user()));

comment on function public.list_auth_sessions(uuid) is 'Service-role-only session metadata listing; never returns refresh tokens.';
comment on function public.revoke_auth_sessions(uuid, uuid, uuid, uuid) is 'Service-role-only session revocation with audit trail.';
