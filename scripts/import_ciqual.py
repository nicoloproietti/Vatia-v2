#!/usr/bin/env python3
"""Build a curated, deterministic food catalogue from the official CIQUAL 2025 XLSX.

No application module is imported or changed. The source workbook is never embedded
in the generated catalogue. Missing, trace and bounded nutrient values stay null;
their original non-numeric representation is retained in ``source_qualifiers``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from ciqual_curated import CURATED, STATE_OVERRIDES

SOURCE = "ANSES-CIQUAL 2025"
SOURCE_RELEASE = "2025-11-03"
SOURCE_PUBLICATION_DATE = "2025-11-19"
LICENCE = "Etalab 2.0"
LICENCE_URL = "https://spdx.org/licenses/etalab-2.0.html"
DATASET_DOI = "https://doi.org/10.57745/RDMHWY"
FILE_DOI = "https://doi.org/10.57745/RPWYZD"
SOURCE_FILENAME = "Table Ciqual 2025_FR_2025_11_03.xlsx"
SOURCE_URL = "https://entrepot.recherche.data.gouv.fr/api/access/datafile/666260?format=original"
SOURCE_MD5 = "0d9758ce23f3f13dd63a005bc1bb4f2c"
SOURCE_SHA256 = "5555c572fa3735991298d832d0427788fa69a11b4fd20a5d580d58942369fbb0"
SOURCE_BYTES = 1_541_998
EXPECTED_SOURCE_FOODS = 3_484
ATTRIBUTION = "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual 2025. https://doi.org/10.57745/RDMHWY"
CATEGORIES = {
    "cereali", "legumi", "carne", "pesce", "formaggi", "uova",
    "affettati", "grassi", "verdure", "frutta", "latticini", "snack", "altro",
}
NUTRIENT_HEADERS = {
    "kcal": "Energie, Règlement UE N° 1169 2011 (kcal 100 g)",
    "protein": "Protéines, N x 6.25 (g 100 g)",
    "carbs": "Glucides (g 100 g)",
    "fat": "Lipides (g 100 g)",
    "fiber": "Fibres alimentaires (g 100 g)",
}
NUTRIENT_UNITS = {
    "kcal": "kcal/100 g",
    "protein": "g/100 g",
    "carbs": "g/100 g",
    "fat": "g/100 g",
    "fiber": "g/100 g",
}
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_DIR = REPO_ROOT / "scripts" / ".cache" / "ciqual"
NUMERIC_RE = re.compile(r"^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$")
COMPOSITE_RE = re.compile(
    r"\b(?:pizza|sandwich|omelette|gnocchi|lasagne|couscous complet|"
    r"salade compos[ée]e|salade de|plat cuisin[ée]|pot-au-feu|tartiflette|"
    r"tiramisu|paella|chili con carne)\b",
    re.IGNORECASE,
)
BRAND_RE = re.compile(r"\b(?:philadelphia|santa lucia|pink lady|nestl[ée]|knorr)\b", re.IGNORECASE)

LICENSE_TEXT = f"""CIQUAL 2025 — DATASET NOTICE

Dataset: Table de composition nutritionnelle des aliments Ciqual 2025
Producer: Agence nationale de sécurité sanitaire de l'alimentation, de l'environnement et du travail (Anses)
Release: {SOURCE_RELEASE}; published {SOURCE_PUBLICATION_DATE}
Dataset DOI: {DATASET_DOI}
Official XLSX: {SOURCE_URL}
XLSX MD5 (published by the repository): {SOURCE_MD5}
XLSX SHA-256 (computed for this pipeline): {SOURCE_SHA256}

Licence: Licence Ouverte / Open Licence, version 2.0 (Etalab 2.0)
Licence URL: {LICENCE_URL}

Required attribution:
{ATTRIBUTION}

The source permits reproduction provided that the source and version are stated,
that the information is not altered in meaning and that reuse does not mislead
third parties about its content, source or update date.

This repository contains a curated derivative selection: only generic single
foods/ingredients explicitly listed by CIQUAL code, with manually curated Italian
names. Nutrient values are copied per 100 g without recalculation. Composite dishes,
branded products and unreviewed automatic translations are excluded. Null values,
traces and bounded values are not converted to zero.

This notice is not a substitute for the full Etalab 2.0 licence text available at
the official licence URL above.
"""


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def normalise_language(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.lower())
    return "".join(char for char in value if not unicodedata.combining(char))


def file_hashes(path: Path) -> dict[str, Any]:
    md5 = hashlib.md5()  # noqa: S324 - integrity check against the publisher, not security.
    sha256 = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            md5.update(chunk)
            sha256.update(chunk)
            size += len(chunk)
    return {"bytes": size, "md5": md5.hexdigest(), "sha256": sha256.hexdigest()}


def verify_source(path: Path) -> dict[str, Any]:
    hashes = file_hashes(path)
    if hashes["md5"] != SOURCE_MD5 or hashes["sha256"] != SOURCE_SHA256:
        raise ValueError(
            f"Checksum CIQUAL non valido per {path}: attesi MD5 {SOURCE_MD5} "
            f"e SHA-256 {SOURCE_SHA256}, ottenuti {hashes['md5']} e {hashes['sha256']}."
        )
    if hashes["bytes"] != SOURCE_BYTES:
        raise ValueError(f"Dimensione CIQUAL inattesa: {hashes['bytes']} byte.")
    return hashes


def acquire_source(input_path: Path | None, cache_dir: Path, download: bool) -> Path:
    if input_path is not None:
        path = input_path.expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Archivio CIQUAL non trovato: {path}")
        verify_source(path)
        return path

    path = cache_dir.expanduser().resolve() / SOURCE_FILENAME
    if not path.exists():
        if not download:
            raise FileNotFoundError(
                f"Archivio assente: {path}. Usare --download oppure --input con il file ufficiale."
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".xlsx.part")
        request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "vatia-ciqual-pipeline/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=180) as response, temporary.open("wb") as output:
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    output.write(chunk)
            verify_source(temporary)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    verify_source(path)
    return path


def read_xlsx(path: Path) -> list[dict[str, Any]]:
    try:
        from openpyxl import load_workbook
    except ImportError as error:  # pragma: no cover - depends on the local environment.
        raise RuntimeError("Dipendenza richiesta: openpyxl >= 3.1 (nessuna modifica a package.json).") from error

    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        if "composition nutritionnelle" not in workbook.sheetnames:
            raise ValueError("Foglio 'composition nutritionnelle' assente: il file non è CIQUAL 2025 FR.")
        sheet = workbook["composition nutritionnelle"]
        raw_headers = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True))
        headers = [clean_text(value) for value in raw_headers]
        missing = set(NUTRIENT_HEADERS.values()) - set(headers)
        if missing:
            raise ValueError(f"Colonne nutrizionali CIQUAL assenti: {sorted(missing)}")
        rows = [dict(zip(headers, values)) for values in sheet.iter_rows(min_row=2, values_only=True)]
    finally:
        workbook.close()

    if len(rows) != EXPECTED_SOURCE_FOODS:
        raise ValueError(f"Attesi {EXPECTED_SOURCE_FOODS} alimenti CIQUAL, trovati {len(rows)}.")
    codes = [clean_text(row.get("alim_code")) for row in rows]
    if len(codes) != len(set(codes)):
        raise ValueError("Il file sorgente contiene codici alimento duplicati.")
    return rows


def parse_nutrient(value: Any) -> int | float | None:
    """Return an exact published scalar, or null for missing/trace/bounded values.

    Zero is a real published value and is therefore preserved as zero. No bounded
    value is rounded or converted into its upper bound.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"Valore booleano non valido per un nutriente: {value!r}")
    if isinstance(value, (int, float)):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError(f"Valore non finito per un nutriente: {value!r}")
        return int(number) if number.is_integer() else number
    text = clean_text(value)
    if not text or text == "-" or normalise_language(text) in {"trace", "traces"}:
        return None
    if text.startswith("<") or text.startswith(">"):
        return None
    if not NUMERIC_RE.fullmatch(text):
        raise ValueError(f"Valore CIQUAL non riconosciuto: {value!r}; nessuna imputazione applicata.")
    number = float(text.replace(",", "."))
    return int(number) if number.is_integer() else number


def derive_processing_state(original_name: str, subgroup_code: str, code: str) -> str:
    if code in STATE_OVERRIDES:
        return STATE_OVERRIDES[code]
    name = normalise_language(original_name)
    if subgroup_code in {"0402", "0406", "0408"}:
        return "raw"
    if subgroup_code in {"0401", "0405", "0407"}:
        return "cooked"
    if re.search(r"\bappertis(?:e|ee|es|ees)\b", name):
        return "canned"
    if re.search(r"\bfum(?:e|ee|es|ees)\b", name):
        return "smoked"
    if re.search(r"\b(?:sec|secs|seche|sechee|sechees|deshydrate|deshydratee|en poudre)\b", name):
        return "dried"
    if re.search(r"\b(?:cru|crue|crus|crues)\b", name):
        return "raw"
    if re.search(
        r"\b(?:cuit|cuite|cuits|cuites|bouilli|bouillie|roti|rotie|grille|grillee|"
        r"saute|sautee|poche|dure?)\b",
        name,
    ) or "a la coque" in name:
        return "cooked"
    return "unspecified"


def exclusion_reason(row: Mapping[str, Any]) -> str | None:
    code = clean_text(row.get("alim_code"))
    name = clean_text(row.get("alim_nom_fr"))
    group = clean_text(row.get("alim_grp_code"))
    if not code or not name:
        return "invalid_source_record"
    if group in {"01", "08", "11"} or COMPOSITE_RE.search(name):
        return "composite_or_prepared_dish"
    if BRAND_RE.search(name):
        return "branded_product"
    if code not in CURATED:
        return "not_in_curated_ingredient_allowlist"
    return None


def transform_food(row: Mapping[str, Any]) -> dict[str, Any]:
    code = clean_text(row.get("alim_code"))
    if code not in CURATED:
        raise KeyError(f"Codice non presente nella selezione curata: {code}")
    reason = exclusion_reason(row)
    if reason:
        raise ValueError(f"Alimento {code} escluso: {reason}")
    name, category = CURATED[code]
    if category not in CATEGORIES:
        raise ValueError(f"Categoria non compatibile per {code}: {category}")
    original_name = clean_text(row.get("alim_nom_fr"))
    per100g: dict[str, int | float | None] = {}
    qualifiers: dict[str, str] = {}
    for nutrient, header in NUTRIENT_HEADERS.items():
        raw_value = row.get(header)
        value = parse_nutrient(raw_value)
        if value is not None and value < 0:
            raise ValueError(f"Valore negativo per {code}/{nutrient}: {value}")
        per100g[nutrient] = value
        raw_text = clean_text(raw_value)
        if value is None and raw_text not in {"", "-"}:
            qualifiers[nutrient] = raw_text

    food: dict[str, Any] = {
        "id": f"ciqual-{code}",
        "name": name,
        "category": category,
        "source": SOURCE,
        "source_food_id": code,
        "source_release": SOURCE_RELEASE,
        "licence": LICENCE,
        "edible_basis": "edible_portion",
        "processing_state": derive_processing_state(original_name, clean_text(row.get("alim_ssgrp_code")), code),
        "original_name": original_name,
        "raw_name": original_name,
        "translation_status": "manual_curated",
        "translation_review_required": False,
        "source_group": clean_text(row.get("alim_grp_code")),
        "source_subgroup": clean_text(row.get("alim_ssgrp_code")),
        "per100g": per100g,
        "is_public": True,
    }
    if qualifiers:
        food["source_qualifiers"] = qualifiers
    return food


def transform_rows(rows: Iterable[Mapping[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    foods: list[dict[str, Any]] = []
    excluded: Counter[str] = Counter()
    source_count = 0
    for row in rows:
        source_count += 1
        reason = exclusion_reason(row)
        if reason:
            excluded[reason] += 1
            continue
        foods.append(transform_food(row))

    ids = [food["id"] for food in foods]
    if len(ids) != len(set(ids)):
        duplicates = sorted(key for key, count in Counter(ids).items() if count > 1)
        raise ValueError(f"ID duplicati nel catalogo: {duplicates}")
    foods.sort(key=lambda food: (food["category"], food["name"], food["source_food_id"]))
    stats = {
        "source_food_count": source_count,
        "selected_candidate_count": len(CURATED),
        "accepted_count": len(foods),
        "excluded_count": source_count - len(foods),
        "excluded_by_reason": dict(sorted(excluded.items())),
    }
    return foods, stats


def build_metadata(foods: Sequence[Mapping[str, Any]], stats: Mapping[str, Any]) -> dict[str, Any]:
    category_counts = Counter(str(food["category"]) for food in foods)
    state_counts = Counter(str(food["processing_state"]) for food in foods)
    missing_counts = {
        nutrient: sum(food["per100g"][nutrient] is None for food in foods)
        for nutrient in NUTRIENT_HEADERS
    }
    return {
        "schema_version": 1,
        "source": SOURCE,
        "source_release": SOURCE_RELEASE,
        "source_publication_date": SOURCE_PUBLICATION_DATE,
        "dataset_doi": DATASET_DOI,
        "source_file": {
            "filename": SOURCE_FILENAME,
            "url": SOURCE_URL,
            "file_doi": FILE_DOI,
            "bytes": SOURCE_BYTES,
            "md5": SOURCE_MD5,
            "sha256": SOURCE_SHA256,
            "checksum_verification": "required_on_every_run",
        },
        "licence": LICENCE,
        "licence_url": LICENCE_URL,
        "attribution": ATTRIBUTION,
        "licence_notice": "public/licenses/CIQUAL-2025.txt",
        "nutrient_basis": "per_100g_edible_portion",
        "nutrient_columns": NUTRIENT_HEADERS,
        "nutrient_units": NUTRIENT_UNITS,
        "energy_convention": "EU_1169_2011_kcal_published_not_recalculated",
        "protein_convention": "N_x_6.25_published",
        "selection_policy": "explicit_ciqual_code_allowlist_generic_single_foods_only",
        "translation_policy": "manual_curated_no_automatic_translation",
        "counts": dict(stats),
        "category_counts": dict(sorted(category_counts.items())),
        "processing_state_counts": dict(sorted(state_counts.items())),
        "nutrient_missing_counts": missing_counts,
        "translations": {
            "manual_curated": len(foods),
            "review_required": sum(bool(food["translation_review_required"]) for food in foods),
        },
        "null_policy": "missing_trace_and_bounded_values_are_null_never_zero; original_qualifiers_retained",
    }


def render_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def sql_text(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return "'" + str(value).replace("'", "''") + "'"


def render_seed_sql(foods: Sequence[Mapping[str, Any]]) -> str:
    lines = [
        "-- Generato da scripts/import_ciqual.py; non modificare manualmente.",
        "-- Richiede prima supabase/ciqual-food-schema.sql. Nessuna riga viene eliminata.",
        "begin;",
        "",
        "insert into public.foods (",
        "  id, name, category, note, per100g, source, is_public,",
        "  source_food_id, source_release, licence, edible_basis, processing_state,",
        "  original_name, raw_name, translation_status, translation_review_required",
        ") values",
    ]
    values = []
    for food in foods:
        per100g = json.dumps(food["per100g"], ensure_ascii=False, separators=(",", ":"))
        values.append(
            "  ("
            + ", ".join(
                [
                    sql_text(food["id"]), sql_text(food["name"]), sql_text(food["category"]),
                    "null", f"{sql_text(per100g)}::jsonb", sql_text(food["source"]), "true",
                    sql_text(food["source_food_id"]), sql_text(food["source_release"]),
                    sql_text(food["licence"]), sql_text(food["edible_basis"]),
                    sql_text(food["processing_state"]), sql_text(food["original_name"]),
                    sql_text(food["raw_name"]), sql_text(food["translation_status"]),
                    sql_text(food["translation_review_required"]),
                ]
            )
            + ")"
        )
    lines.append(",\n".join(values))
    lines.extend(
        [
            "on conflict (id) do update set",
            "  name = excluded.name,",
            "  category = excluded.category,",
            "  note = excluded.note,",
            "  per100g = excluded.per100g,",
            "  source = excluded.source,",
            "  is_public = excluded.is_public,",
            "  source_food_id = excluded.source_food_id,",
            "  source_release = excluded.source_release,",
            "  licence = excluded.licence,",
            "  edible_basis = excluded.edible_basis,",
            "  processing_state = excluded.processing_state,",
            "  original_name = excluded.original_name,",
            "  raw_name = excluded.raw_name,",
            "  translation_status = excluded.translation_status,",
            "  translation_review_required = excluded.translation_review_required",
            "where public.foods.source = 'ANSES-CIQUAL 2025';",
            "",
            "commit;",
            "",
        ]
    )
    return "\n".join(lines)


def render_schema_sql() -> str:
    return """-- Estensione idempotente e non distruttiva per la provenance ANSES-CIQUAL 2025.
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
"""


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def generate(source_path: Path, repo_root: Path = REPO_ROOT) -> dict[str, Any]:
    verify_source(source_path)
    rows = read_xlsx(source_path)
    foods, stats = transform_rows(rows)
    metadata = build_metadata(foods, stats)
    write_text(repo_root / "src" / "data" / "ciqual-foods.json", render_json(foods))
    write_text(repo_root / "src" / "data" / "ciqual-metadata.json", render_json(metadata))
    write_text(repo_root / "supabase" / "ciqual-foods.sql", render_seed_sql(foods))
    write_text(repo_root / "supabase" / "ciqual-food-schema.sql", render_schema_sql())
    write_text(repo_root / "public" / "licenses" / "CIQUAL-2025.txt", LICENSE_TEXT)
    return metadata


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="File XLSX ufficiale già scaricato; il checksum è obbligatorio.")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR, help="Cache locale dell'originale, esclusa da Git.")
    parser.add_argument("--download", action="store_true", help="Scarica l'XLSX dal repository ufficiale del DOI ANSES-CIQUAL.")
    args = parser.parse_args(argv)
    try:
        source_path = acquire_source(args.input, args.cache_dir, args.download)
        metadata = generate(source_path)
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(f"Errore CIQUAL: {error}", file=sys.stderr)
        return 1
    counts = metadata["counts"]
    print(
        f"CIQUAL 2025: {counts['accepted_count']} accettati, {counts['excluded_count']} esclusi "
        f"su {counts['source_food_count']}; categorie: {len(metadata['category_counts'])}."
    )
    print(f"SHA-256 sorgente verificato: {SOURCE_SHA256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
