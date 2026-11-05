-- Vatia: inviti e area paziente. Applicare dopo schema.sql e clinical-schema.sql.
create table if not exists public.patient_access (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  professional_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  user_id uuid unique references auth.users(id) on delete cascade,
  invited_at timestamptz not null default now(),
  claimed_at timestamptz
);

alter table public.patient_access enable row level security;

drop policy if exists "professional reads patient access" on public.patient_access;
create policy "professional reads patient access" on public.patient_access
  for select using (auth.uid() = professional_id);
drop policy if exists "professional revokes patient access" on public.patient_access;
create policy "professional revokes patient access" on public.patient_access
  for delete using (auth.uid() = professional_id);
drop policy if exists "patient reads own access" on public.patient_access;
create policy "patient reads own access" on public.patient_access
  for select using (auth.uid() = user_id);

create or replace function public.invite_patient_access(target_patient uuid, target_email text)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  normalized_email text := lower(trim(target_email));
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if normalized_email = '' then raise exception 'Email paziente mancante'; end if;
  if normalized_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Usa un indirizzo email diverso da quello del professionista';
  end if;
  if not exists (select 1 from public.patients where id = target_patient and user_id = auth.uid()) then
    raise exception 'Paziente non disponibile';
  end if;

  insert into public.patient_access (patient_id, professional_id, email)
  values (target_patient, auth.uid(), normalized_email)
  on conflict (patient_id) do update set
    professional_id = excluded.professional_id,
    email = excluded.email,
    invited_at = now(),
    user_id = case when public.patient_access.email <> excluded.email then null else public.patient_access.user_id end,
    claimed_at = case when public.patient_access.email <> excluded.email then null else public.patient_access.claimed_at end;
end;
$$;

create or replace function public.claim_patient_access()
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  claimed_patient uuid;
begin
  if auth.uid() is null then return null; end if;
  -- Un account che possiede già uno studio non viene convertito in account paziente.
  if exists (select 1 from public.patients where user_id = auth.uid()) then return null; end if;
  if exists (select 1 from public.patient_access where user_id = auth.uid()) then
    select patient_id into claimed_patient from public.patient_access where user_id = auth.uid();
    return claimed_patient;
  end if;

  update public.patient_access
    set user_id = auth.uid(), claimed_at = now()
    where user_id is null
      and email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and not exists (select 1 from public.patient_access where user_id = auth.uid())
    returning patient_id into claimed_patient;
  return claimed_patient;
end;
$$;

create or replace function public.is_linked_patient(target_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.patient_access
    where patient_id = target_patient and user_id = auth.uid()
  );
$$;

create or replace function public.patient_can_read_food(target_food text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.patient_access pa
    where pa.user_id = auth.uid() and (
      exists (select 1 from public.diary_entries de where de.patient_id = pa.patient_id and de.food_id = target_food)
      or exists (
        select 1 from public.diets d
        where d.patient_id = pa.patient_id and d.status = 'Pronta'
          and jsonb_path_exists(
            d.plan,
            '$.days.*[*].items[*].foodId ? (@ == $food)',
            jsonb_build_object('food', target_food)
          )
      )
    )
  );
$$;

revoke all on function public.invite_patient_access(uuid, text) from public;
revoke all on function public.claim_patient_access() from public;
revoke all on function public.is_linked_patient(uuid) from public;
revoke all on function public.patient_can_read_food(text) from public;
grant execute on function public.invite_patient_access(uuid, text) to authenticated;
grant execute on function public.claim_patient_access() to authenticated;
grant execute on function public.is_linked_patient(uuid) to authenticated;
grant execute on function public.patient_can_read_food(text) to authenticated;

-- Il profilo visibile al paziente resta in sola lettura.
drop policy if exists "patient reads own profile" on public.patients;
create policy "patient reads own profile" on public.patients
  for select using (public.is_linked_patient(id));

drop policy if exists "patient reads ready diets" on public.diets;
create policy "patient reads ready diets" on public.diets
  for select using (status = 'Pronta' and public.is_linked_patient(patient_id));

drop policy if exists "patient reads own appointments" on public.appointments;
create policy "patient reads own appointments" on public.appointments
  for select using (public.is_linked_patient(patient_id));

drop policy if exists "patient reads plan and diary foods" on public.foods;
create policy "patient reads plan and diary foods" on public.foods
  for select using (public.patient_can_read_food(id));

-- La policy precedente distingueva solo user_id: va sostituita per consentire
-- al professionista di leggere anche le righe create dall'account paziente.
drop policy if exists "own diary entries" on public.diary_entries;
drop policy if exists "professional manages patient diary" on public.diary_entries;
create policy "professional manages patient diary" on public.diary_entries
  for all
  using (exists (select 1 from public.patients p where p.id = patient_id and p.user_id = auth.uid()))
  with check (
    auth.uid() = user_id and source = 'professional'
    and exists (select 1 from public.patients p where p.id = patient_id and p.user_id = auth.uid())
  );

-- Il paziente legge tutto il proprio diario, comprese le righe del professionista.
drop policy if exists "patient reads own diary" on public.diary_entries;
create policy "patient reads own diary" on public.diary_entries
  for select using (public.is_linked_patient(patient_id));

-- Può creare, modificare o eliminare soltanto le proprie registrazioni.
drop policy if exists "patient manages own diary" on public.diary_entries;
create policy "patient manages own diary" on public.diary_entries
  for all
  using (auth.uid() = user_id and source = 'patient' and public.is_linked_patient(patient_id))
  with check (auth.uid() = user_id and source = 'patient' and public.is_linked_patient(patient_id));

create index if not exists patient_access_user_idx on public.patient_access(user_id);
create index if not exists patient_access_email_idx on public.patient_access(email);
