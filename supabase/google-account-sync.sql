-- Vatia: collegamento Google account-su-account e sincronizzazione bidirezionale.
-- I token sono cifrati dall'Edge Function; queste tabelle non sono leggibili dal client.

alter table public.appointments
  add column if not exists google_event_id text,
  add column if not exists google_updated_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists google_include_notes boolean not null default false,
  add column if not exists google_include_location boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists appointments_user_google_event_unique_idx
  on public.appointments(user_id, google_event_id)
  where google_event_id is not null;

create table if not exists public.calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text not null,
  refresh_token_encrypted text not null,
  access_token_encrypted text,
  access_token_expires_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_tombstones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_event_id text not null,
  deleted_at timestamptz not null default now(),
  unique(user_id, google_event_id)
);

alter table public.calendar_connections enable row level security;
alter table public.calendar_tombstones enable row level security;
revoke all on table public.calendar_connections from anon, authenticated;
revoke all on table public.calendar_tombstones from anon, authenticated;

-- Solo l'eliminazione di un appuntamento realmente collegato crea una richiesta
-- di cancellazione. Il client non puo' inserire ID Google arbitrari.
create or replace function public.record_google_appointment_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.google_event_id is not null then
    insert into public.calendar_tombstones(user_id, google_event_id, deleted_at)
    values (old.user_id, old.google_event_id, now())
    on conflict (user_id, google_event_id)
    do update set deleted_at = excluded.deleted_at;
  end if;
  return old;
end;
$$;

drop trigger if exists appointment_google_tombstone on public.appointments;
create trigger appointment_google_tombstone
after delete on public.appointments
for each row execute function public.record_google_appointment_deletion();

create index if not exists appointments_user_sync_idx
  on public.appointments(user_id, updated_at);
create index if not exists calendar_tombstones_user_idx
  on public.calendar_tombstones(user_id, deleted_at);

-- Schedulazione server ogni 15 minuti. Il segreto casuale resta in Vault e viene
-- copiato nei segreti dell'Edge Function durante la configurazione, senza finire
-- nel repository o nel browser.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'vatia_google_cron_secret',
  'Segreto per la sincronizzazione periodica Google Calendar di Vatia'
)
where not exists (
  select 1 from vault.secrets where name = 'vatia_google_cron_secret'
);

select cron.unschedule('vatia-google-calendar-sync')
where exists (select 1 from cron.job where jobname = 'vatia-google-calendar-sync');

select cron.schedule(
  'vatia-google-calendar-sync',
  '*/15 * * * *',
  $vatia_job$
    select net.http_post(
      url := 'https://jwbvofxoqtlvspgnuuza.supabase.co/functions/v1/google-calendar',
      body := '{"action":"sync_all"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-vatia-cron-key', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'vatia_google_cron_secret'
        )
      ),
      timeout_milliseconds := 120000
    );
  $vatia_job$
);
