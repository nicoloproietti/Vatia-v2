import { useRef, useState } from 'react'
import { Apple, Download, Plus, Search, Star, Upload } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import type { Food } from '../types'
import { FOOD_CATEGORIES } from '../data/foods'
import { csvDownload } from '../lib/clinical'
import { EmptyState, Field, Modal } from './UI'

export default function DatabaseView({ workspace, notify }: { workspace: Workspace; notify: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('vatia-v2-favorites') ?? '[]') } catch { return [] } })
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [limit, setLimit] = useState(80)
  const [modalOpen, setModalOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const filtered = workspace.foods.filter(food => `${food.name} ${food.brand ?? ''} ${food.note ?? ''}`.toLowerCase().includes(query.toLowerCase()) && (category === 'all' || food.category === category) && (!onlyFavorites || favorites.includes(food.id)))
  function toggleFavorite(id: string) { const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]; setFavorites(next); localStorage.setItem('vatia-v2-favorites', JSON.stringify(next)) }
  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    try { const parsed = JSON.parse(await file.text()) as Food[]; if (!Array.isArray(parsed)) throw new Error('Formato non valido'); const saved = await workspace.importFoods(parsed); notify(`${saved.length} ${saved.length === 1 ? 'alimento importato' : 'alimenti importati'} nel tuo database personale.`) } catch (error) { notify(error instanceof Error ? error.message : 'Importazione non riuscita.') } finally { event.target.value = '' }
  }
  function exportFoods() { csvDownload('vatia-database-alimenti.csv', [['Nome', 'Marca', 'Categoria', 'Nota', 'Kcal / 100 g', 'Proteine', 'Carboidrati', 'Grassi', 'Fonte'], ...filtered.map(food => [food.name, food.brand ?? '', food.category, food.note ?? '', food.per100g.kcal, food.per100g.protein, food.per100g.carbs, food.per100g.fat, food.source ?? 'Vatia'])]) }
  return <>
    <section className="page-heading"><div><span className="eyebrow">FONTI NUTRIZIONALI</span><h1>Database alimenti</h1><p>{workspace.foods.length} alimenti disponibili · valori nutrizionali per 100 g</p></div><div className="heading-actions"><input ref={fileInput} type="file" accept=".json" hidden onChange={event => void importFile(event)} /><button className="button secondary" onClick={exportFoods}><Download size={16} />Esporta</button><button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={16} />Importa JSON</button><button className="button primary" onClick={() => setModalOpen(true)}><Plus size={16} />Nuovo alimento</button></div></section>
    <section className="database-toolbar"><div className="search-field"><Search size={18} /><input value={query} onChange={event => { setQuery(event.target.value); setLimit(80) }} placeholder="Cerca per nome, marca o nota…" /></div><button className={`button ${onlyFavorites ? 'primary' : 'secondary'}`} onClick={() => setOnlyFavorites(!onlyFavorites)}><Star size={16} fill={onlyFavorites ? 'currentColor' : 'none'} />Preferiti</button></section>
    <div className="category-scroll"><button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>Tutti</button>{Object.values(FOOD_CATEGORIES).map(item => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
    <section className="panel database-panel"><div className="database-head"><span>Alimento</span><span>Valori per 100 g</span><span>Azioni</span></div>{filtered.slice(0, limit).map(food => <div className="database-row" key={food.id}><div className="food-title"><div className="food-icon"><Apple size={17} /></div><div><strong>{food.name}</strong><span>{food.brand || food.note || food.category}{food.isPublic === false ? ' · Personale' : ''}</span></div></div><div className="nutrition-values"><b>{food.per100g.kcal} kcal</b><span>P {food.per100g.protein} g</span><span>C {food.per100g.carbs} g</span><span>G {food.per100g.fat} g</span></div><div className="food-actions"><button className={`icon-button ${favorites.includes(food.id) ? 'favorite' : ''}`} onClick={() => toggleFavorite(food.id)} aria-label={`${favorites.includes(food.id) ? 'Rimuovi dai' : 'Aggiungi ai'} preferiti`}><Star size={17} fill={favorites.includes(food.id) ? 'currentColor' : 'none'} /></button></div></div>)}{!filtered.length && <EmptyState icon={<Search size={27} />} title="Nessun alimento trovato" text="Prova a cambiare ricerca, categoria o filtro preferiti." />}</section>
    {filtered.length > limit && <button className="button secondary load-more" onClick={() => setLimit(current => current + 80)}>Mostra altri {Math.min(80, filtered.length - limit)} alimenti</button>}
    {modalOpen && <FoodModal workspace={workspace} onClose={() => setModalOpen(false)} notify={notify} />}
  </>
}

function FoodModal({ workspace, onClose, notify }: { workspace: Workspace; onClose: () => void; notify: (message: string) => void }) {
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    try { await workspace.addFood({ name: String(data.get('name')), brand: String(data.get('brand')), barcode: String(data.get('barcode')), category: String(data.get('category')), note: String(data.get('note')), meals: String(data.get('meals')) as Food['meals'], source: 'Alimento personale', per100g: { kcal: Number(data.get('kcal')), protein: Number(data.get('protein')), carbs: Number(data.get('carbs')), fat: Number(data.get('fat')), fiber: Number(data.get('fiber')) || 0 } }); notify('Alimento aggiunto al database e disponibile nel builder.'); onClose() } catch { /* errore globale */ }
  }
  return <Modal title="Nuovo alimento" description="Inserisci i valori nutrizionali per 100 g: sarà subito disponibile in diario e diete." onClose={onClose}><form className="form-grid" onSubmit={submit}><Field label="Nome alimento" full><input name="name" required autoFocus /></Field><Field label="Marca"><input name="brand" /></Field><Field label="Codice a barre"><input name="barcode" /></Field><Field label="Categoria"><select name="category">{Object.values(FOOD_CATEGORIES).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="altro">Altro</option></select></Field><Field label="Pasti compatibili"><select name="meals" defaultValue="all"><option value="all">Tutti</option><option value="main">Pranzo e cena</option><option value="light">Colazione e spuntini</option></select></Field><Field label="Kcal"><input name="kcal" type="number" min="0" step="0.1" required /></Field><Field label="Proteine (g)"><input name="protein" type="number" min="0" step="0.1" required /></Field><Field label="Carboidrati (g)"><input name="carbs" type="number" min="0" step="0.1" required /></Field><Field label="Grassi (g)"><input name="fat" type="number" min="0" step="0.1" required /></Field><Field label="Fibre (g)"><input name="fiber" type="number" min="0" step="0.1" defaultValue="0" /></Field><Field label="Nota" full><input name="note" placeholder="Crudo, cotto, confezione…" /></Field><button className="button primary full" type="submit">Salva alimento</button></form></Modal>
}
