-- Vatia: sedi e collegamento agenda. Da applicare solo al progetto Supabase dedicato.
create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  address text not null default '',
  city text not null default '',
  postal_code text not null default '',
  province text not null default '',
  email text,
  phone text,
  color text not null default '#0f8f80',
  open_time time not null default '08:00',
  close_time time not null default '19:00',
  work_days integer[] not null default array[1, 2, 3, 4, 5],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offices_work_days_valid check (work_days <@ array[1, 2, 3, 4, 5, 6, 7]),
  constraint offices_hours_valid check (not active or close_time > open_time)
);

alter table public.appointments
  add column if not exists office_id uuid references public.offices(id) on delete set null;

alter table public.offices enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'offices' and policyname = 'own offices') then
    create policy "own offices" on public.offices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists offices_user_active_idx on public.offices(user_id, active);
create index if not exists appointments_office_date_idx on public.appointments(office_id, starts_at);
