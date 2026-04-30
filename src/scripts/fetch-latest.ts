import 'dotenv/config';

const INDEXER_URL = process.env.TORRENT_INDEXER_URL || 'http://127.0.0.1:8090';
const PAGES_TO_FETCH = 5;

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchLatestReleases() {
  console.log(`[FetchLatest] 🚀 Iniciando indexação de lançamentos recentes...`);

  try {
    const rootRes = await fetch(`${INDEXER_URL}/`);
    const rootData = await rootRes.json();
    const indexers: string[] = rootData.indexer_names || [];

    if (indexers.length === 0) {
      console.log(`[FetchLatest] ⚠️ Nenhum indexer encontrado na API.`);
      return;
    }

    console.log(`[FetchLatest] 📋 Encontrados ${indexers.length} indexers: ${indexers.join(', ')}`);

    for (const indexer of indexers) {
      console.log(`\n[FetchLatest] 🔍 Processando indexer: ${indexer}`);

      for (let page = 1; page <= PAGES_TO_FETCH; page++) {
        try {
          const start = Date.now();
          const response = await fetch(`${INDEXER_URL}/indexers/${indexer}?page=${page}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
          });

          if (!response.ok) {
            console.log(`  └─ ⚠️ Erro HTTP na página ${page}: ${response.status}`);
            continue;
          }

          const data = await response.json();
          // The Go backend might return an error object {"error": "..."} instead of an array on failure
          if (data && data.error) {
            console.log(`  └─ ⚠️ Erro da API na página ${page}: ${data.error}`);
            // If there's a cloudflare challenge or no more pages, we can just stop paginating this indexer
            break;
          }

          const count = Array.isArray(data) ? data.length : (data.results?.length || 0);
          console.log(`  └─ ✅ Página ${page}: ${count} resultados cacheados (${Date.now() - start}ms)`);

          if (count === 0) {
            // No more results for this indexer
            break;
          }

          // Delay to prevent rate limiting
          await delay(2000);
        } catch (err) {
          console.error(`  └─ ❌ Erro ao buscar página ${page}:`, err instanceof Error ? err.message : String(err));
        }
      }
    }

    console.log(`\n[FetchLatest] 🎉 Indexação de lançamentos finalizada com sucesso!`);
  } catch (error) {
    console.error(`[FetchLatest] ❌ Falha geral:`, error instanceof Error ? error.message : String(error));
  }
}

fetchLatestReleases();
