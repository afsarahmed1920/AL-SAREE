-- Reduce repeated policy work while preserving the existing role model.
-- Direct table access remains intentionally unavailable for branch_products,
-- passkey_challenges, and user_passkeys; their server-side service role bypasses RLS.

create index if not exists passkey_challenges_user_id_idx
  on public.passkey_challenges (user_id);

drop policy if exists branches_write on public.branches;
create policy branches_insert on public.branches
  for insert to authenticated with check ((select public.is_master()));
create policy branches_update on public.branches
  for update to authenticated
  using ((select public.is_master()))
  with check ((select public.is_master()));
create policy branches_delete on public.branches
  for delete to authenticated using ((select public.is_master()));

drop policy if exists cat_write on public.categories;
create policy cat_insert on public.categories
  for insert to authenticated with check ((select public.can_edit_products()));
create policy cat_update on public.categories
  for update to authenticated
  using ((select public.can_edit_products()))
  with check ((select public.can_edit_products()));
create policy cat_delete on public.categories
  for delete to authenticated using ((select public.can_edit_products()));

drop policy if exists bc_write on public.product_barcodes;
create policy bc_insert on public.product_barcodes
  for insert to authenticated with check ((select public.can_edit_products()));
create policy bc_update on public.product_barcodes
  for update to authenticated
  using ((select public.can_edit_products()))
  with check ((select public.can_edit_products()));
create policy bc_delete on public.product_barcodes
  for delete to authenticated using ((select public.can_edit_products()));

drop policy if exists img_write on public.product_images;
create policy img_insert on public.product_images
  for insert to authenticated with check ((select public.can_edit_products()));
create policy img_update on public.product_images
  for update to authenticated
  using ((select public.can_edit_products()))
  with check ((select public.can_edit_products()));
create policy img_delete on public.product_images
  for delete to authenticated using ((select public.can_edit_products()));

drop policy if exists prod_write on public.products;
create policy prod_insert on public.products
  for insert to authenticated with check ((select public.can_edit_products()));
create policy prod_update on public.products
  for update to authenticated
  using ((select public.can_edit_products()))
  with check ((select public.can_edit_products()));
create policy prod_delete on public.products
  for delete to authenticated using ((select public.can_edit_products()));

drop policy if exists uba_write on public.user_branch_access;
create policy uba_insert on public.user_branch_access
  for insert to authenticated with check ((select public.is_master()));
create policy uba_update on public.user_branch_access
  for update to authenticated
  using ((select public.is_master()))
  with check ((select public.is_master()));
create policy uba_delete on public.user_branch_access
  for delete to authenticated using ((select public.is_master()));

drop policy if exists up_write on public.user_profiles;
create policy up_insert on public.user_profiles
  for insert to authenticated with check ((select public.is_master()));
create policy up_update on public.user_profiles
  for update to authenticated
  using ((select public.is_master()))
  with check ((select public.is_master()));
create policy up_delete on public.user_profiles
  for delete to authenticated using ((select public.is_master()));
