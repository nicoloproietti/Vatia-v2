-- Vatia: tariffario e amministrazione. Da applicare solo al progetto Supabase dedicato.
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  category text not null default 'Visite',
  duration integer not null default 45 check (duration between 5 and 480),
  price numeric not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  number text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  issue_date date not null default current_date,
  due_date date not null default current_date,
  service_id uuid references public.services(id) on delete set null,
  description text not null,
  amount numeric not null check (amount >= 0),
  enpab boolean not null default false,
  stamp boolean not null default false,
  status text not null default 'Bozza' check (status in ('Bozza', 'Emessa', 'Pagata')),
  payment_method text,
  payment_date date,
  recipient_tax_code text,
  recipient_address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, number)
);

create table if not exists public.billing_settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  studio_name text not null default '',
  professional_name text not null default '',
  vat_number text not null default '',
  tax_code text not null default '',
  address text not null default '',
  city text not null default '',
  postal_code text not null default '',
  province text not null default '',
  enpab_number text not null default '',
  email text not null default '',
  phone text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.services enable row level security;
alter table public.invoices enable row level security;
alter table public.billing_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'services' and policyname = 'own services') then
    create policy "own services" on public.services for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'own invoices') then
    create policy "own invoices" on public.invoices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'billing_settings' and policyname = 'own billing settings') then
    create policy "own billing settings" on public.billing_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

create index if not exists services_user_idx on public.services(user_id, active);
create index if not exists invoices_user_date_idx on public.invoices(user_id, issue_date desc);
create index if not exists invoices_patient_idx on public.invoices(patient_id);
