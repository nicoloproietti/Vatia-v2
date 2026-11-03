import { useMemo, useRef, useState } from 'react'
import { Apple, Download, Pencil, Plus, ScanLine, Search, Star, Trash2, Upload } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import type { Food } from '../types'
import { FOOD_CATEGORIES } from '../data/foods'
import { CIQUAL_INCOMPLETE_COUNT, CIQUAL_METADATA, PROCESSING_LABELS } from '../data/catalog'
import { csvDownload } from '../lib/clinical'
import FoodScanner from './FoodScanner'
import { EmptyState, Field, Modal } from './UI'

export default function DatabaseView({ workspace, notify }: { workspace: Workspace; notify: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [scope, setScope] = useState<'all' | 'catalog' | 'personal'>('all')
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('vatia-v2-favorites') ?? '[]') } catch { return [] } })
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [limit, setLimit] = useState(80)
  const [modalOpen, setModalOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [editing, setEditing] = useState<Food | null>(null)
  const [draft, setDraft] = useState<Partial<Food> | undefined>()
  const fileInput = useRef<HTMLInputElement>(null)
  const available = useMemo(() => workspace.foods.filter(food => !food.isLegacy), [workspace.foods])
  const filtered = available.filter(food =>
    `${food.name} ${food.brand ?? ''} ${food.note ?? ''} ${food.originalName ?? ''}`.toLowerCase().includes(query.toLowerCase()) &&
    (category === 'all' || food.category === category) && (!onlyFavorites || favorites.includes(food.id)) &&
    (scope === 'all' || (scope === 'personal' ? food.isPublic === false : food.isPublic !== false)),
  )

  function toggleFavorite(id: string) { const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]; setFavorites(next); localStorage.setItem('vatia-v2-favorites', JSON.stringify(next)) }
  function openNew() { setEditing(null); setDraft(undefined); setModalOpen(true) }
  function openEdit(food: Food) { setEditing(food); setDraft(undefined); setModalOpen(true) }
  function labelDraft(value: Partial<Food>) { setScannerOpen(false); setEditing(null); setDraft(value); setModalOpen(true) }
  function identified(food: Food) { setScannerOpen(false); setScope('all'); setCategory('all'); setOnlyFavorites(false); setQuery(food.name); notify(`${food.name} confermato: nessuna stima di peso o porzione è stata creata.`) }
  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    try { const parsed = JSON.parse(await file.text()) as Food[]; if (!Array.isArray(parsed)) throw new Error('Formato non valido'); const saved = await workspace.importFoods(parsed); notify(`${saved.length} ${saved.length === 1 ? 'alimento importato' : 'alimenti importati'} nel tuo database personale.`) } catch (error) { notify(error instanceof Error ? error.message : 'Importazione non riuscita.') } finally { event.target.value = '' }
  }
  async function remove(food: Food) {
    const used = workspace.diary.some(entry => entry.foodId === food.id) || workspace.plans.some(plan => Object.values(plan.plan.days).some(meals => meals.some(meal => meal.items.some(item => item.foodId === food.id))))
    if (used) { notify('Questo alimento è usato in una dieta o nel diario: non può essere eliminato senza alterare i dati storici.'); return }
    if (!window.confirm(`Eliminare “${food.name}” dai tuoi alimenti personali?`)) return
    try { await workspace.deleteFood(food.id); notify('Alimento personale eliminato.') } catch { /* errore globale */ }
  }
  function exportFoods() { csvDownload('vatia-database-alimenti.csv', [['Nome', 'Marca', 'Categoria', 'Stato', 'Kcal / 100 g', 'Proteine', 'Carboidrati', 'Grassi', 'Fonte', 'Release'], ...filtered.map(food => [food.name, food.brand ?? '', food.category, food.note ?? '', food.per100g.kcal, food.per100g.protein, food.per100g.carbs, food.per100g.fat, food.source ?? 'Vatia', food.sourceRelease ?? ''])]) }

  return <>
    <section className="page-heading"><div><span className="eyebrow">FONTI NUTRIZIONALI</span><h1>Database alimenti</h1><p>{available.length} alimenti selezionabili · valori per 100 g di parte edibile</p></div><div className="heading-actions"><input ref={fileInput} type="file" accept=".json" hidden onChange={event => void importFile(event)} /><button className="button secondary" onClick={exportFoods}><Download size={16} />Esporta</button><button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={16} />Importa JSON</button><button className="button secondary" onClick={() => setScannerOpen(true)}><ScanLine size={16} />Scansiona</button><button className="button primary" onClick={openNew}><Plus size={16} />Nuovo alimento</button></div></section>
    <section className="catalog-source-card"><div><strong>Catalogo ANSES-CIQUAL 2025</strong><p>{CIQUAL_METADATA.counts.accepted_count} voci curate · {CIQUAL_INCOMPLETE_COUNT} escluse dal motore perché prive dei nutrienti necessari · Licenza Etalab 2.0</p></div><a href={`${import.meta.env.BASE_URL}licenses/CIQUAL-2025.txt`} target="_blank" rel="noreferrer">Fonte e licenza</a></section>
    <section className="database-toolbar"><div className="search-field"><Search size={18} /><input value={query} onChange={event => { setQuery(event.target.value); setLimit(80) }} placeholder="Cerca per nome, stato o nome originale…" /></div><select aria-label="Filtra provenienza" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="all">Catalogo + personali</option><option value="catalog">Solo catalogo</option><option value="personal">I miei alimenti</option></select><button className={`button ${onlyFavorites ? 'primary' : 'secondary'}`} onClick={() => setOnlyFavorites(!onlyFavorites)}><Star size={16} fill={onlyFavorites ? 'currentColor' : 'none'} />Preferiti</button></section>
    <div className="category-scroll"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Tutti</button>{Object.values(FOOD_CATEGORIES).map(item => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
    <section className="panel database-panel"><div className="database-head"><span>Alimento</span><span>Valori per 100 g</span><span>Azioni</span></div>{filtered.slice(0, limit).map(food => <div className="database-row" key={food.id}><div className="food-title"><div className="food-icon"><Apple size={17} /></div><div><strong>{food.name}</strong><span>{food.brand || food.note || food.category}{food.isPublic === false ? ' · Personale' : ` · ${food.source ?? 'Vatia'}`}</span></div></div><div className="nutrition-values"><b>{food.per100g.kcal} kcal</b><span>P {food.per100g.protein} g</span><span>C {food.per100g.carbs} g</span><span>G {food.per100g.fat} g</span></div><div className="food-actions"><button className={`icon-button ${favorites.includes(food.id) ? 'favorite' : ''}`} onClick={() => toggleFavorite(food.id)} aria-label={`${favorites.includes(food.id) ? 'Rimuovi dai' : 'Aggiungi ai'} preferiti`}><Star size={17} fill={favorites.includes(food.id) ? 'currentColor' : 'none'} /></button>{food.isPublic === false && <><button className="icon-button" onClick={() => openEdit(food)} aria-label={`Modifica ${food.name}`}><Pencil size={15} /></button><button className="icon-button danger" onClick={() => void remove(food)} aria-label={`Elimina ${food.name}`}><Trash2 size={15} /></button></>}</div></div>)}{!filtered.length && <EmptyState icon={<Search size={27} />} title="Nessun alimento trovato" text="Prova a cambiare ricerca, categoria o provenienza." />}</section>
    {filtered.length > limit && <button className="button secondary load-more" onClick={() => setLimit(current => current + 80)}>Mostra altri {Math.min(80, filtered.length - limit)} alimenti</button>}
    {scannerOpen && <FoodScanner foods={available} onClose={() => setScannerOpen(false)} onLabelDraft={labelDraft} onPhotoDraft={labelDraft} onIdentified={identified} />}
    {modalOpen && <FoodModal workspace={workspace} initial={editing ?? draft} onClose={() => setModalOpen(false)} notify={notify} />}
  </>
}

function FoodModal({ workspace, initial, onClose, notify }: { workspace: Workspace; initial?: Partial<Food>; onClose: () => void; notify: (message: string) => void }) {
  const editing = Boolean(initial?.id)
  const nutrients = initial?.per100g
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const input = {
      name: String(data.get('name')).trim(), brand: String(data.get('brand')), barcode: String(data.get('barcode')), category: String(data.get('category')),
      note: String(data.get('note')), meals: String(data.get('meals')) as Food['meals'], source: initial?.source ?? 'Alimento personale',
      processingState: String(data.get('processingState')),
      per100g: { kcal: Number(data.get('kcal')), protein: Number(data.get('protein')), carbs: Number(data.get('carbs')), fat: Number(data.get('fat')), fiber: Number(data.get('fiber')) || 0 },
    }
    try {
      if (editing && initial?.id) await workspace.updateFood({ ...initial, ...input, id: initial.id, isPublic: false } as Food)
      else await workspace.addFood(input)
      notify(editing ? 'Alimento personale aggiornato.' : 'Alimento aggiunto al tuo spazio privato e disponibile nel builder.'); onClose()
    } catch { /* errore globale */ }
  }
  return <Modal title={editing ? 'Modifica alimento personale' : 'Nuovo alimento personale'} description="Controlla i valori per 100 g: restano privati nel tuo account o in questo browser guest." onClose={onClose}><form className="form-grid" onSubmit={event => void submit(event)}><Field label="Nome alimento" full><input name="name" required autoFocus defaultValue={initial?.name ?? ''} /></Field><Field label="Marca"><input name="brand" defaultValue={initial?.brand ?? ''} /></Field><Field label="Codice a barre"><input name="barcode" defaultValue={initial?.barcode ?? ''} /></Field><Field label="Categoria"><select name="category" defaultValue={initial?.category ?? 'altro'}>{Object.values(FOOD_CATEGORIES).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="altro">Altro</option></select></Field><Field label="Stato"><select name="processingState" defaultValue={initial?.processingState ?? 'unspecified'}>{Object.entries(PROCESSING_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field><Field label="Pasti compatibili"><select name="meals" defaultValue={initial?.meals ?? 'all'}><option value="all">Tutti</option><option value="main">Pranzo e cena</option><option value="light">Colazione e spuntini</option></select></Field><Field label="Kcal"><input name="kcal" type="number" min="0" step="0.1" required defaultValue={nutrients?.kcal ?? ''} /></Field><Field label="Proteine (g)"><input name="protein" type="number" min="0" step="0.1" required defaultValue={nutrients?.protein ?? ''} /></Field><Field label="Carboidrati (g)"><input name="carbs" type="number" min="0" step="0.1" required defaultValue={nutrients?.carbs ?? ''} /></Field><Field label="Grassi (g)"><input name="fat" type="number" min="0" step="0.1" required defaultValue={nutrients?.fat ?? ''} /></Field><Field label="Fibre (g)"><input name="fiber" type="number" min="0" step="0.1" defaultValue={nutrients?.fiber ?? 0} /></Field><Field label="Nota" full><input name="note" defaultValue={initial?.note ?? ''} placeholder="Base nutrizionale, cottura o provenienza…" /></Field><button className="button primary full" type="submit">{editing ? 'Salva modifiche' : 'Salva nel mio database privato'}</button></form></Modal>
}
