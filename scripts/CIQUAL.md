# Pipeline dati ANSES-CIQUAL 2025

Questa pipeline è isolata dall'app: legge soltanto l'XLSX ufficiale e genera catalogo, metadati, licenza e SQL. Non importa moduli dell'app, non legge configurazioni Supabase e non esegue SQL o server.

## Fonte e requisiti

- Dataset: **Table de composition nutritionnelle des aliments Ciqual 2025**, release `2025-11-03`, pubblicato il `2025-11-19`.
- DOI: <https://doi.org/10.57745/RDMHWY>.
- Licenza: **Etalab 2.0**; attribuzione e avviso sono in `public/licenses/CIQUAL-2025.txt`.
- Python 3 con `openpyxl >= 3.1`; non sono richieste dipendenze JavaScript.

Ogni acquisizione verifica dimensione, MD5 pubblicato e SHA-256 fissato per questa release. Un file diverso viene rifiutato: non aggirare il controllo e non sostituire silenziosamente la fonte.

## Generazione

Dalla radice del repository, per scaricare l'originale nella cache locale esclusa da Git e generare gli artefatti:

```bash
python scripts/import_ciqual.py --download
```

Per usare una copia ufficiale già scaricata:

```bash
python scripts/import_ciqual.py --input "/percorso/Table Ciqual 2025_FR_2025_11_03.xlsx"
```

Gli output sono:

- `src/data/ciqual-foods.json`
- `src/data/ciqual-metadata.json`
- `supabase/ciqual-food-schema.sql`
- `supabase/ciqual-foods.sql`
- `public/licenses/CIQUAL-2025.txt`

Il catalogo è ordinato in modo deterministico. Ripetere l'import con lo stesso XLSX deve produrre file byte per byte identici.

## Selezione e valori

Sono ammessi soltanto codici presenti nell'allowlist manuale `scripts/ciqual_curated.py`: alimenti singoli e generici, con nome italiano curato esplicitamente. Piatti composti, prodotti con marchio e codici non traducibili con sicurezza restano esclusi; non viene usata traduzione automatica.

I cinque nutrienti sono copiati per 100 g di porzione edibile, senza ricalcoli: energia UE 1169/2011 in kcal, proteine `N x 6.25`, carboidrati, lipidi e fibre. Gli zero pubblicati restano `0`; `-`, `traces` e valori limitati da `<` o `>` diventano `null`. I qualificatori non numerici restano in `source_qualifiers`.

Lo stato di lavorazione deriva dal sottogruppo o da indicatori espliciti del nome francese. I valori possibili sono `raw`, `cooked`, `canned`, `smoked`, `dried`, `cured` e `unspecified`; in assenza di evidenza si usa `unspecified`. Gli override manuali impediscono, per esempio, di classificare il prosciutto crudo come carne cruda.

## Test

```bash
python scripts/test_import_ciqual.py
```

I test usano anche fixture sintetiche e validano gli artefatti già generati. Non richiedono rete o Supabase.

## SQL manuale e facoltativo

I file SQL non vengono applicati dalla pipeline. Se si decide consapevolmente di importarli, eseguirli in questo ordine:

1. `supabase/ciqual-food-schema.sql`: aggiunge in modo idempotente le colonne di provenance e un indice.
2. `supabase/ciqual-foods.sql`: inserisce gli alimenti; in conflitto su `id` aggiorna soltanto righe il cui `source` è già `ANSES-CIQUAL 2025`.

Non contengono `delete`, `truncate` o `drop`. L'eventuale applicazione va verificata separatamente sull'ambiente di destinazione.
