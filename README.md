# Vatia v2

Web app per nutrizionisti: gestione pazienti, piani alimentari, diario, database alimenti, calendario e insight. Il progetto nasce dal motore di Vatia e introduce flussi ispirati all'analisi di Foodnoms, mantenendo i colori teal/emerald di Vatia.

## Sviluppo locale

```bash
npm install
npm run dev
```

Build e lint:

```bash
npm run build
npm run lint
```

## Nuovo backend Supabase

Vatia v2 usa un progetto Supabase **nuovo e separato**, senza migrare dati da DietProject.

1. Crea il progetto Supabase dedicato.
2. Esegui `supabase/schema.sql` nell'SQL Editor.
3. Copia `.env.example` in `.env.local` e inserisci URL e anon key del nuovo progetto.
4. Per GitHub Pages, aggiungi gli stessi valori nei secret `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

Senza variabili d'ambiente l'interfaccia funziona in modalità demo locale e conserva le modifiche nel browser.

## Database alimenti

La base tecnica supporta alimenti personalizzati e importazione JSON. Ogni alimento deve avere `id`, `name` e `per100g` con valori per 100 g. L'importazione del database Foodnoms viene completata solo dopo che l'app nativa ha reso disponibili i dati locali.

## GitHub Pages

Il workflow `.github/workflows/deploy.yml` pubblica `dist/` a ogni push su `main`. La base Vite è `/Vatia-v2/`.

URL previsto: `https://nicoloproietti.github.io/Vatia-v2/`.

Nelle impostazioni del repository, seleziona **Pages → Build and deployment → GitHub Actions**.
