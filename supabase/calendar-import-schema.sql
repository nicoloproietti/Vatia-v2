-- Collegamento stabile tra appuntamenti Vatia ed eventi Google Calendar importati.
alter table public.appointments
  add column if not exists google_event_id text;

create index if not exists appointments_user_google_event_idx
  on public.appointments(user_id, google_event_id)
  where google_event_id is not null;
