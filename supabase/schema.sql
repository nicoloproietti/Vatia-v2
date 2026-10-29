-- Vatia v2: schema iniziale per un progetto Supabase nuovo e separato.
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  age integer check (age > 0),
  goal text,
  status text not null default 'Attivo',
  adherence integer not null default 0 check (adherence between 0 and 100),
  calories integer check (calories > 0),
  protein_target numeric default 0,
  carbs_target numeric default 0,
  fat_target numeric default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.foods (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  brand text,
  barcode text,
  category text,
  note text,
  source text,
  per100g jsonb not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index foods_user_barcode_idx on public.foods(user_id, barcode) where barcode is not null;

create table public.diets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  status text not null default 'Bozza' check (status in ('Bozza', 'Pronta')),
  calories integer check (calories > 0),
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  food_id text not null references public.foods(id),
  entry_date date not null default current_date,
  meal text not null check (meal in ('Colazione', 'Pranzo', 'Cena', 'Spuntini')),
  grams numeric not null check (grams > 0),
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  patient_id uuid references public.patients(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  visit_type text not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.patients enable row level security;
alter table public.foods enable row level security;
alter table public.diets enable row level security;
alter table public.diary_entries enable row level security;
alter table public.appointments enable row level security;

create policy "own patients" on public.patients for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read public or own foods" on public.foods for select using (is_public or auth.uid() = user_id);
create policy "own foods insert" on public.foods for insert with check (auth.uid() = user_id and not is_public);
create policy "own foods update" on public.foods for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own foods delete" on public.foods for delete using (auth.uid() = user_id);
create policy "own diets" on public.diets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own diary entries" on public.diary_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own appointments" on public.appointments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index patients_user_idx on public.patients(user_id);
create index diets_patient_idx on public.diets(patient_id);
create index diary_patient_date_idx on public.diary_entries(patient_id, entry_date);
create index appointments_user_date_idx on public.appointments(user_id, starts_at);
