-- AL-SAREE security and query-performance hardening.
-- Apply only after reviewing against the target Supabase project.

-- Bound each edit permission by the matching view permission at the data layer.
alter table public.user_profiles
  add constraint user_profiles_purchase_edit_requires_view
    check (not can_edit_purchase_price or can_view_purchase_price),
  add constraint user_profiles_wholesale_edit_requires_view
    check (not can_edit_wholesale_price or can_view_wholesale_price),
  add constraint user_profiles_retail_edit_requires_view
    check (not can_edit_retail_price or can_view_retail_price);

create or replace function public.upsert_branch_product(
  p_branch_id uuid,
  p_product_id uuid,
  p_is_available boolean default true,
  p_branch_code text default null,
  p_purchase_price numeric default null,
  p_wholesale_price numeric default null,
  p_retail_price numeric default null,
  p_track_stock boolean default false,
  p_stock_quantity integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  u public.user_profiles;
  old public.branch_products;
  m boolean;
  v_pp numeric;
  v_wp numeric;
  v_rp numeric;
  v_ts boolean;
  v_sq integer;
  v_av boolean;
  v_bc text;
  v_id uuid;
begin
  select * into u
    from public.user_profiles
    where id = auth.uid() and is_active;
  if not found then raise exception 'Unauthorized user'; end if;
  if not public.has_branch_access(p_branch_id) then
    raise exception 'Branch access denied';
  end if;
  m := (u.role = 'master');

  select * into old from public.branch_products
    where branch_id = p_branch_id and product_id = p_product_id;

  v_pp := case when m or (u.can_edit_purchase_price and u.can_view_purchase_price)
    then p_purchase_price else old.purchase_price end;
  v_wp := case when m or (u.can_edit_wholesale_price and u.can_view_wholesale_price)
    then p_wholesale_price else old.wholesale_price end;
  v_rp := case when m or (u.can_edit_retail_price and u.can_view_retail_price)
    then p_retail_price else old.retail_price end;
  v_ts := case when m or u.can_manage_stock
    then p_track_stock else coalesce(old.track_stock, false) end;
  v_sq := case when m or u.can_manage_stock
    then p_stock_quantity else old.stock_quantity end;
  v_av := case when m or u.can_edit_products
    then p_is_available else coalesce(old.is_available, true) end;
  v_bc := case when m or u.can_edit_products
    then p_branch_code else old.branch_code end;

  if old.id is null and not (m or u.can_edit_products) then
    raise exception 'Not allowed to create branch product';
  end if;

  insert into public.branch_products(
    branch_id, product_id, branch_code, is_available, purchase_price,
    wholesale_price, retail_price, track_stock, stock_quantity, updated_at
  ) values (
    p_branch_id, p_product_id, v_bc, v_av, v_pp, v_wp, v_rp,
    v_ts, v_sq, now()
  )
  on conflict (branch_id, product_id) do update set
    branch_code = excluded.branch_code,
    is_available = excluded.is_available,
    purchase_price = excluded.purchase_price,
    wholesale_price = excluded.wholesale_price,
    retail_price = excluded.retail_price,
    track_stock = excluded.track_stock,
    stock_quantity = excluded.stock_quantity,
    updated_at = now()
  returning id into v_id;
  return v_id;
end
$function$;

-- The catalog RPC and write RPC intentionally bypass branch_products RLS,
-- and enforce active-user, branch, and field-level authorization internally.
alter function public.get_branch_catalog_secure(uuid)
  set search_path = public, pg_temp;
alter function public.has_branch_access(uuid)
  set search_path = public, pg_temp;
alter function public.is_active_user()
  set search_path = public, pg_temp;
alter function public.is_master()
  set search_path = public, pg_temp;
alter function public.can_edit_products()
  set search_path = public, pg_temp;
alter function public.log_branch_product_change()
  set search_path = public, pg_temp;
alter function public.log_product_change()
  set search_path = public, pg_temp;

revoke all on function public.log_branch_product_change() from public, anon, authenticated;
revoke all on function public.log_product_change() from public, anon, authenticated;

-- Cache caller identity once per statement in policies that use auth.uid().
drop policy if exists up_read on public.user_profiles;
create policy up_read on public.user_profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_master()));

drop policy if exists uba_read on public.user_branch_access;
create policy uba_read on public.user_branch_access
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_master()));

-- Passkey records are only read/written by the server-side Edge Function.
alter table public.user_passkeys
  add column if not exists transports text[] not null default '{}';
alter table public.user_passkeys enable row level security;
drop policy if exists "Users can manage their own passkeys" on public.user_passkeys;
revoke all on table public.user_passkeys from public, anon, authenticated;
grant select, insert, update, delete on table public.user_passkeys to service_role;

create table public.passkey_challenges (
  challenge text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('register', 'login')),
  expires_at timestamptz not null
);
alter table public.passkey_challenges enable row level security;
revoke all on table public.passkey_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.passkey_challenges to service_role;

-- These indexes cover previously unindexed foreign keys and app hot paths.
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_branch_created_at_idx
  on public.audit_logs (branch_id, created_at desc);
create index if not exists audit_logs_user_created_at_idx
  on public.audit_logs (user_id, created_at desc);
create index if not exists branch_products_product_id_idx
  on public.branch_products (product_id);
create index if not exists product_barcodes_product_created_at_idx
  on public.product_barcodes (product_id, created_at);
create index if not exists product_images_product_primary_sort_idx
  on public.product_images (product_id, is_primary desc, sort_order);
create index if not exists product_images_uploaded_by_idx
  on public.product_images (uploaded_by);
create index if not exists products_category_id_idx
  on public.products (category_id);
create index if not exists user_branch_access_branch_id_idx
  on public.user_branch_access (branch_id);
create index if not exists user_passkeys_user_id_idx
  on public.user_passkeys (user_id);
create index if not exists passkey_challenges_expires_at_idx
  on public.passkey_challenges (expires_at);

-- Anonymous users only need read access to public branding/legal text.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon;
-- The branch inventory table is intentionally RPC-only.
revoke all on table public.branch_products from anon, authenticated;
-- Audit records are written by protected triggers, never by client requests.
revoke insert, update, delete, truncate on table public.audit_logs from anon, authenticated;
