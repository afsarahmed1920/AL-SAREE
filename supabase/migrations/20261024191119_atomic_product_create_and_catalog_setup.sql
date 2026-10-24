-- Create a product and all database-backed setup in one transaction.
-- PostgreSQL rolls back the product, barcodes, branch rows, and their audit
-- trigger writes together if any statement in this function raises an error.
create or replace function public.create_product_atomic(
  p_product_id uuid,
  p_product_code text,
  p_name_en text,
  p_name_ar text,
  p_description_en text,
  p_description_ar text,
  p_category_id uuid,
  p_new_category_en text,
  p_new_category_ar text,
  p_barcodes jsonb,
  p_branch_products jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.user_profiles;
  v_category_id uuid := p_category_id;
  v_barcode text;
  v_branch jsonb;
  v_branch_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized user' using errcode = '42501';
  end if;

  select * into v_profile
  from public.user_profiles
  where id = auth.uid() and is_active;
  if not found then
    raise exception 'Unauthorized user' using errcode = '42501';
  end if;
  if v_profile.role <> 'master' and coalesce(v_profile.can_edit_products, false) is not true then
    raise exception 'Not allowed to create products' using errcode = '42501';
  end if;
  if p_product_id is null then
    raise exception 'Product ID is required';
  end if;
  if jsonb_typeof(coalesce(p_barcodes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_branch_products, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid product setup payload';
  end if;

  if v_category_id is null and nullif(btrim(p_new_category_en), '') is not null then
    insert into public.categories(name_en, name_ar)
    values (
      btrim(p_new_category_en),
      coalesce(nullif(btrim(p_new_category_ar), ''), btrim(p_new_category_en))
    )
    returning id into v_category_id;
  end if;

  insert into public.products(
    id, product_code, name_en, name_ar, description_en, description_ar, category_id
  ) values (
    p_product_id, p_product_code, p_name_en, p_name_ar,
    p_description_en, p_description_ar, v_category_id
  );

  for v_barcode in
    select distinct btrim(value)
    from jsonb_array_elements_text(coalesce(p_barcodes, '[]'::jsonb)) as barcode_values(value)
    where btrim(value) <> ''
  loop
    begin
      insert into public.product_barcodes(product_id, barcode, is_generated)
      values (p_product_id, v_barcode, v_barcode ~ '^20[0-9]{11}$');
    exception when unique_violation then
      raise exception 'DUPLICATE_BARCODE' using errcode = 'P0001';
    end;
  end loop;

  for v_branch in
    select value from jsonb_array_elements(coalesce(p_branch_products, '[]'::jsonb)) as branch_values(value)
  loop
    v_branch_id := nullif(v_branch ->> 'branch_id', '')::uuid;
    if v_branch_id is null then
      raise exception 'Branch ID is required for product setup';
    end if;

    perform public.upsert_branch_product(
      v_branch_id,
      p_product_id,
      coalesce((v_branch ->> 'is_available')::boolean, true),
      nullif(v_branch ->> 'branch_code', ''),
      nullif(v_branch ->> 'purchase_price', '')::numeric,
      nullif(v_branch ->> 'wholesale_price', '')::numeric,
      nullif(v_branch ->> 'retail_price', '')::numeric,
      coalesce((v_branch ->> 'track_stock')::boolean, false),
      nullif(v_branch ->> 'stock_quantity', '')::integer
    );
  end loop;

  return p_product_id;
end;
$function$;

revoke all on function public.create_product_atomic(
  uuid, text, text, text, text, text, uuid, text, text, jsonb, jsonb
) from public, anon;
grant execute on function public.create_product_atomic(
  uuid, text, text, text, text, text, uuid, text, text, jsonb, jsonb
) to authenticated, service_role;

comment on function public.create_product_atomic(
  uuid, text, text, text, text, text, uuid, text, text, jsonb, jsonb
) is 'Atomically creates a product, its barcodes, category, branch setup, and trigger-generated audit records.';

-- The catalog exposes products missing a branch row only to users who can
-- complete product setup. Existing explicit unavailable rows remain hidden.
create or replace function public.get_branch_catalog_secure(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.user_profiles;
  v_result jsonb;
begin
  select * into v_profile
  from public.user_profiles
  where id = auth.uid() and is_active = true;
  if not found then
    raise exception 'Unauthorized user' using errcode = '42501';
  end if;

  if v_profile.role <> 'master' and not public.has_branch_access(p_branch_id) then
    raise exception 'Branch access denied' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', p.id,
        'product_code', p.product_code,
        'name_en', p.name_en,
        'name_ar', p.name_ar,
        'description_en', p.description_en,
        'description_ar', p.description_ar,
        'category_id', p.category_id,
        'status', p.status,
        'branch_code', bp.branch_code,
        'track_stock', coalesce(bp.track_stock, false),
        'stock_quantity', case when bp.track_stock then bp.stock_quantity else null end,
        'purchase_price', case when v_profile.role = 'master' or v_profile.can_view_purchase_price then bp.purchase_price else null end,
        'wholesale_price', case when v_profile.role = 'master' or v_profile.can_view_wholesale_price then bp.wholesale_price else null end,
        'retail_price', case when v_profile.role = 'master' or v_profile.can_view_retail_price then bp.retail_price else null end,
        'setup_incomplete', bp.id is null,
        'barcodes', (
          select coalesce(jsonb_agg(b.barcode order by b.created_at), '[]'::jsonb)
          from public.product_barcodes b where b.product_id = p.id
        ),
        'images', (
          select coalesce(jsonb_agg(
            jsonb_build_object('id', i.id, 'storage_path', i.storage_path, 'url', i.image_url, 'is_primary', i.is_primary)
            order by i.is_primary desc, i.sort_order asc
          ), '[]'::jsonb)
          from public.product_images i where i.product_id = p.id
        )
      ) order by p.name_en, p.product_code
    ),
    '[]'::jsonb
  ) into v_result
  from public.products p
  left join public.branch_products bp
    on bp.product_id = p.id and bp.branch_id = p_branch_id
  where p.status = 'active'
    and (
      (bp.id is not null and bp.is_available = true)
      or (
        bp.id is null
        and (v_profile.role = 'master' or v_profile.can_edit_products)
      )
    );

  return v_result;
end;
$function$;

revoke all on function public.get_branch_catalog_secure(uuid) from public, anon;
grant execute on function public.get_branch_catalog_secure(uuid) to authenticated, service_role;

comment on function public.get_branch_catalog_secure(uuid) is 'Returns branch-visible catalog products and, for product editors, active products missing branch setup marked setup_incomplete.';
