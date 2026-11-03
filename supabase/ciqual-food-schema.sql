-- Estensione idempotente e non distruttiva per la provenance ANSES-CIQUAL 2025.
-- Non applica seed e non elimina colonne o alimenti esistenti.
alter table public.foods add column if not exists source_food_id text;
alter table public.foods add column if not exists source_release text;
alter table public.foods add column if not exists licence text;
alter table public.foods add column if not exists edible_basis text;
alter table public.foods add column if not exists processing_state text;
alter table public.foods add column if not exists original_name text;
alter table public.foods add column if not exists raw_name text;
alter table public.foods add column if not exists translation_status text;
alter table public.foods add column if not exists translation_review_required boolean;

create index if not exists foods_ciqual_source_food_id_idx
  on public.foods (source_food_id)
  where source_food_id is not null;
