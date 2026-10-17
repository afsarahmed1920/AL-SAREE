alter table public.user_profiles
  add column if not exists session_duration_minutes integer not null default 1440
  check (session_duration_minutes between 5 and 1440);
