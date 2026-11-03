#!/usr/bin/env python3
"""Unit and generated-artefact tests for the isolated CIQUAL import pipeline."""

from __future__ import annotations

import json
import re
import unittest
from collections import Counter
from pathlib import Path

import import_ciqual as pipeline
from ciqual_curated import CURATED

ROOT = Path(__file__).resolve().parents[1]
FOODS_PATH = ROOT / "src" / "data" / "ciqual-foods.json"
METADATA_PATH = ROOT / "src" / "data" / "ciqual-metadata.json"
SEED_PATH = ROOT / "supabase" / "ciqual-foods.sql"
SCHEMA_PATH = ROOT / "supabase" / "ciqual-food-schema.sql"
NUTRIENTS = set(pipeline.NUTRIENT_HEADERS)
REQUIRED_PROVENANCE = {
    "source": pipeline.SOURCE,
    "source_release": pipeline.SOURCE_RELEASE,
    "licence": pipeline.LICENCE,
    "edible_basis": "edible_portion",
    "translation_status": "manual_curated",
    "translation_review_required": False,
}


def source_row(code: str = "9100", name: str = "Riz blanc, cru", **nutrients):
    row = {
        "alim_code": code,
        "alim_nom_fr": name,
        "alim_grp_code": "02",
        "alim_ssgrp_code": "0201",
    }
    defaults = {"kcal": 360, "protein": 7, "carbs": 80, "fat": 0.6, "fiber": 1.2}
    defaults.update(nutrients)
    row.update({pipeline.NUTRIENT_HEADERS[key]: value for key, value in defaults.items()})
    return row


class NutrientParsingTests(unittest.TestCase):
    def test_published_zero_and_numbers_are_preserved(self):
        self.assertEqual(pipeline.parse_nutrient(0), 0)
        self.assertEqual(pipeline.parse_nutrient(0.0), 0)
        self.assertEqual(pipeline.parse_nutrient("0"), 0)
        self.assertEqual(pipeline.parse_nutrient("12,34"), 12.34)
        self.assertEqual(pipeline.parse_nutrient(7.5), 7.5)

    def test_missing_trace_and_bounds_become_null(self):
        for value in (None, "", "-", "traces", "Traces", "< 0,5", "> 2"):
            with self.subTest(value=value):
                self.assertIsNone(pipeline.parse_nutrient(value))

    def test_unknown_non_numeric_and_negative_values_fail_closed(self):
        for value in ("n.d.", "ND", float("nan"), float("inf")):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    pipeline.parse_nutrient(value)
        with self.assertRaises(ValueError):
            pipeline.transform_food(source_row(kcal=-1))

    def test_transform_preserves_zero_and_original_qualifiers(self):
        food = pipeline.transform_food(source_row(fat=0, fiber="traces", carbs="< 0,5"))
        self.assertEqual(food["per100g"]["fat"], 0)
        self.assertIsNone(food["per100g"]["fiber"])
        self.assertIsNone(food["per100g"]["carbs"])
        self.assertEqual(food["source_qualifiers"], {"carbs": "< 0,5", "fiber": "traces"})


class SelectionAndStateTests(unittest.TestCase):
    def test_composite_dishes_and_brands_are_rejected_even_with_curated_code(self):
        pizza = source_row(name="Pizza au fromage")
        brand = source_row(name="Riz Pink Lady")
        self.assertEqual(pipeline.exclusion_reason(pizza), "composite_or_prepared_dish")
        self.assertEqual(pipeline.exclusion_reason(brand), "branded_product")
        with self.assertRaises(ValueError):
            pipeline.transform_food(pizza)
        with self.assertRaises(ValueError):
            pipeline.transform_food(brand)

    def test_unlisted_codes_are_not_translated_or_included(self):
        self.assertEqual(
            pipeline.exclusion_reason(source_row(code="999999")),
            "not_in_curated_ingredient_allowlist",
        )

    def test_raw_cooked_and_special_states_are_derived_without_guessing(self):
        self.assertEqual(pipeline.derive_processing_state("Riz blanc, cru", "0201", "9100"), "raw")
        self.assertEqual(pipeline.derive_processing_state("Riz blanc, cuit", "0201", "9100"), "cooked")
        self.assertEqual(pipeline.derive_processing_state("Cœurs d'artichauts appertisés", "0203", "x"), "canned")
        self.assertEqual(pipeline.derive_processing_state("Abricots secs", "0904", "x"), "dried")
        self.assertEqual(pipeline.derive_processing_state("Tofu", "0205", "20904"), "unspecified")
        self.assertEqual(pipeline.derive_processing_state("Tofu fumé", "0205", "20912"), "smoked")

    def test_cured_meat_is_not_mislabelled_as_raw_or_dried(self):
        for code in ("28800", "28812", "28844", "28845", "30350"):
            with self.subTest(code=code):
                name = "Jambon cru" if code == "28800" else "Jambon sec"
                self.assertEqual(pipeline.derive_processing_state(name, "0403", code), "cured")
        self.assertEqual(pipeline.derive_processing_state("Mortadelle", "0403", "30789"), "cooked")


class GeneratedCatalogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.foods = json.loads(FOODS_PATH.read_text(encoding="utf-8"))
        cls.metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
        cls.by_code = {food["source_food_id"]: food for food in cls.foods}

    def test_every_allowlisted_code_is_present_and_ids_are_unique(self):
        self.assertEqual(len(self.by_code), len(self.foods))
        self.assertEqual(set(self.by_code), set(CURATED))
        ids = [food["id"] for food in self.foods]
        self.assertEqual(len(ids), len(set(ids)))
        for food in self.foods:
            self.assertEqual(food["id"], f"ciqual-{food['source_food_id']}")

    def test_no_composite_or_branded_source_names_passed_the_filter(self):
        for food in self.foods:
            with self.subTest(code=food["source_food_id"]):
                self.assertIsNone(pipeline.COMPOSITE_RE.search(food["original_name"]))
                self.assertIsNone(pipeline.BRAND_RE.search(food["original_name"]))

    def test_provenance_and_manual_translation_are_complete(self):
        for food in self.foods:
            with self.subTest(code=food["source_food_id"]):
                for key, expected in REQUIRED_PROVENANCE.items():
                    self.assertEqual(food.get(key), expected)
                self.assertEqual(food.get("original_name"), food.get("raw_name"))
                self.assertTrue(food.get("original_name"))
                self.assertTrue(food.get("name"))
                self.assertIn(food.get("category"), pipeline.CATEGORIES)
                self.assertIn(
                    food.get("processing_state"),
                    {"raw", "cooked", "canned", "smoked", "dried", "cured", "unspecified"},
                )
                self.assertTrue(food.get("is_public"))

    def test_nutrients_are_complete_non_negative_and_null_is_not_zero(self):
        for food in self.foods:
            with self.subTest(code=food["source_food_id"]):
                self.assertEqual(set(food["per100g"]), NUTRIENTS)
                for nutrient, value in food["per100g"].items():
                    self.assertFalse(isinstance(value, bool))
                    if value is not None:
                        self.assertIsInstance(value, (int, float))
                        self.assertGreaterEqual(value, 0)
                for nutrient, qualifier in food.get("source_qualifiers", {}).items():
                    self.assertIn(nutrient, NUTRIENTS)
                    self.assertIsNone(food["per100g"][nutrient])
                    self.assertNotEqual(qualifier, "-")
        self.assertEqual(self.by_code["28503"]["per100g"]["fiber"], 0)
        self.assertIsNone(self.by_code["28800"]["per100g"]["fiber"])

    def test_real_state_overrides_and_raw_cooked_examples(self):
        self.assertEqual(self.by_code["28800"]["processing_state"], "cured")
        self.assertEqual(self.by_code["30789"]["processing_state"], "cooked")
        self.assertEqual(self.by_code["20912"]["processing_state"], "smoked")
        self.assertEqual(self.by_code["9100"]["processing_state"], "raw")
        self.assertEqual(self.by_code["9104"]["processing_state"], "cooked")
        self.assertEqual(self.by_code["20904"]["processing_state"], "unspecified")

    def test_metadata_reconciles_with_the_catalogue(self):
        counts = self.metadata["counts"]
        self.assertEqual(counts["source_food_count"], pipeline.EXPECTED_SOURCE_FOODS)
        self.assertEqual(counts["accepted_count"], len(self.foods))
        self.assertEqual(counts["selected_candidate_count"], len(CURATED))
        self.assertEqual(
            counts["excluded_count"],
            pipeline.EXPECTED_SOURCE_FOODS - len(self.foods),
        )
        self.assertEqual(
            self.metadata["category_counts"],
            dict(sorted(Counter(food["category"] for food in self.foods).items())),
        )
        self.assertEqual(
            self.metadata["processing_state_counts"],
            dict(sorted(Counter(food["processing_state"] for food in self.foods).items())),
        )
        for nutrient in NUTRIENTS:
            self.assertEqual(
                self.metadata["nutrient_missing_counts"][nutrient],
                sum(food["per100g"][nutrient] is None for food in self.foods),
            )

    def test_renderers_are_byte_for_byte_deterministic(self):
        self.assertEqual(pipeline.render_json(self.foods), FOODS_PATH.read_text(encoding="utf-8"))
        self.assertEqual(pipeline.render_json(self.metadata), METADATA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(pipeline.render_seed_sql(self.foods), SEED_PATH.read_text(encoding="utf-8"))
        self.assertEqual(pipeline.render_schema_sql(), SCHEMA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(pipeline.render_seed_sql(self.foods), pipeline.render_seed_sql(self.foods))

    def test_sql_is_non_destructive_and_update_is_source_guarded(self):
        for path in (SEED_PATH, SCHEMA_PATH):
            sql = path.read_text(encoding="utf-8")
            with self.subTest(path=path.name):
                self.assertIsNone(re.search(r"\b(?:drop|delete|truncate)\b", sql, re.IGNORECASE))
        seed = SEED_PATH.read_text(encoding="utf-8")
        self.assertIn("on conflict (id) do update set", seed)
        self.assertIn("where public.foods.source = 'ANSES-CIQUAL 2025';", seed)
        self.assertEqual(seed.count("insert into public.foods"), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
