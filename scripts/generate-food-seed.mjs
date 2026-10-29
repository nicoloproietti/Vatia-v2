import { buildSync } from 'esbuild'
import { unlinkSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const temporaryModule = '.food-data.tmp.mjs'
buildSync({ entryPoints: ['src/data/foods.ts'], bundle: true, format: 'esm', platform: 'node', outfile: temporaryModule })
const { foods } = await import(`${pathToFileURL(`${process.cwd()}/${temporaryModule}`).href}?t=${Date.now()}`)
unlinkSync(temporaryModule)

const quote = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`
const rows = foods.map(food => `  (${quote(food.id)}, ${quote(food.name)}, ${quote(food.category)}, ${quote(food.note)}, ${quote(JSON.stringify(food.per100g))}::jsonb, 'CREA · Tabelle di composizione degli alimenti', true)`)
const sql = `-- Database tecnico Vatia: ${foods.length} alimenti, valori per 100 g.\n-- Generato da src/data/foods.ts; eseguibile più volte senza duplicati.\ninsert into public.foods (id, name, category, note, per100g, source, is_public) values\n${rows.join(',\n')}\non conflict (id) do update set\n  name = excluded.name,\n  category = excluded.category,\n  note = excluded.note,\n  per100g = excluded.per100g,\n  source = excluded.source,\n  is_public = excluded.is_public;\n`
writeFileSync('supabase/seed-foods.sql', sql)
console.log(`Generato supabase/seed-foods.sql con ${foods.length} alimenti.`)
