-- Vatia: modello clinico completo. Idempotente sul progetto Vatia-v2 separato.
alter table public.patients add column if not exists email text;
alter table public.patients add column if not exists phone text;
alter table public.patients add column if not exists sex text not null default 'male';
alter table public.patients add column if not exists height numeric default 0;
alter table public.patients add column if not exists weight numeric default 0;
alter table public.patients add column if not exists activity_level text not null default 'moderate';
alter table public.patients add column if not exists anamnesis jsonb not null default '{}'::jsonb;
alter table public.patients add column if not exists notes text not null default '';

alter table public.foods add column if not exists meals text not null default 'all';
alter table public.diary_entries add column if not exists source text not null default 'professional';
alter table public.diary_entries add column if not exists note text not null default '';
alter table public.diary_entries drop constraint if exists diary_entries_meal_check;

create table if not exists public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  measured_on date not null default current_date,
  weight numeric not null check (weight > 0),
  waist numeric,
  hip numeric,
  arm numeric,
  thigh numeric,
  body_fat numeric,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.patient_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  text text not null,
  kind text not null default 'Nota' check (kind in ('Nota', 'Attività')),
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.measurements enable row level security;
alter table public.patient_notes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'measurements' and policyname = 'own measurements') then
    create policy "own measurements" on public.measurements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'patient_notes' and policyname = 'own patient notes') then
    create policy "own patient notes" on public.patient_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists measurements_patient_date_idx on public.measurements(patient_id, measured_on);
create index if not exists patient_notes_patient_idx on public.patient_notes(patient_id, done, due_date);
