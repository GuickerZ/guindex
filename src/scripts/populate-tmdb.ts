import 'dotenv/config';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const INDEXER_URL = process.env.TORRENT_INDEXER_URL || 'http://127.0.0.1:8090';
const PAGES_TO_FETCH = process.argv.includes('--all') ? 500 : (Number(process.env.TMDB_PAGES) || 5); // TMDB limita a max 500 páginas

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTmdbPopular(type: 'movie' | 'tv', page: number) {
  if (!TMDB_API_KEY) {
    throw new Error('A variável TMDB_API_KEY não está definida no arquivo .env');
  }

  const url = `https://api.themoviedb.org/3/trending/${type}/week?api_key=${TMDB_API_KEY}&language=pt-BR&page=${page}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao buscar TMDB: ${response.statusText}`);
  }
  return response.json();
}

async function populateIndex() {
  console.log(`[Populate] 🚀 Iniciando script de população do Meilisearch via TMDB...`);

  if (!TMDB_API_KEY) {
    console.error(`[Populate] ❌ TMDB_API_KEY ausente. Abortando.`);
    return;
  }

  let totalQueries = 0;
  let successQueries = 0;

  for (const type of ['movie', 'tv'] as const) {
    console.log(`\n[Populate] 🎬 Buscando tendências de ${type.toUpperCase()}...`);
    
    for (let page = 1; page <= PAGES_TO_FETCH; page++) {
      try {
        const data = await fetchTmdbPopular(type, page);
        const results = data.results || [];
        
        for (const item of results) {
          const titlePTBR = item.title || item.name || '';
          const originalTitle = item.original_title || item.original_name || '';
          const yearMatch = (item.release_date || item.first_air_date || '').match(/^(\d{4})/);
          const year = yearMatch ? yearMatch[1] : '';

          // Fetch external IDs e título em Inglês
          let imdbId = '';
          let titleEN = '';
          try {
            const extUrl = `https://api.themoviedb.org/3/${type}/${item.id}?api_key=${TMDB_API_KEY}&append_to_response=external_ids&language=en-US`;
            const extRes = await fetch(extUrl);
            if (extRes.ok) {
              const extData = await extRes.json();
              imdbId = extData?.external_ids?.imdb_id || extData?.imdb_id || '';
              titleEN = extData?.title || extData?.name || '';
            }
          } catch (e) {
            // Ignora erros ao tentar buscar detalhes
          }

          // Monta queries baseadas nos três títulos (PT-BR, EN, Original) e ano
          const queriesList: string[] = [];
          
          if (imdbId) queriesList.push(imdbId);

          const safeAddQuery = (t: string) => {
            if (t && t.trim().length > 0) {
              queriesList.push(t.trim());
              if (year) queriesList.push(`${t.trim()} ${year}`);
            }
          };

          safeAddQuery(titlePTBR);
          safeAddQuery(titleEN);

          // Só adiciona o original se for diferente do EN e PT-BR (ex: animes/filmes de outros países)
          if (originalTitle && originalTitle !== titleEN && originalTitle !== titlePTBR) {
            safeAddQuery(originalTitle);
          }

          const queries = Array.from(new Set<string>(queriesList)).filter(q => q && q.length > 0);

          if (queries.length === 0) continue;

          totalQueries++;
          console.log(`[Populate] 📡 Disparando busca para '${titlePTBR}'${imdbId ? ` (${imdbId})` : ''}: [${queries.join(', ')}]`);
          
          try {
            const searchUrl = new URL(`${INDEXER_URL}/indexers/all`);
            for (const q of queries) {
              searchUrl.searchParams.append('q', q);
            }

            const searchRes = await fetch(searchUrl.toString(), {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
              });

              if (searchRes.ok) {
                const data = await searchRes.json();
                const count = data.count !== undefined ? data.count : (Array.isArray(data) ? data.length : 0);
                console.log(`  └─ ✅ Sucesso! Encontrados e cacheados: ${count}`);
                successQueries++;
              } else {
                console.log(`  └─ ⚠️ Falha na busca (HTTP ${searchRes.status})`);
              }
          } catch (err) {
            console.log(`  └─ ❌ Erro de requisição: ${err instanceof Error ? err.message : String(err)}`);
          }

          // Pausa maior já que agrupamos as queries, para dar tempo aos indexers respirarem
          await delay(3000);
        }
      } catch (err) {
        console.error(`[Populate] ❌ Erro ao processar página ${page} de ${type}:`, err);
      }
    }
  }

  console.log(`\n[Populate] 🎉 Finalizado! ${successQueries} de ${totalQueries} buscas concluídas com sucesso.`);
}

populateIndex();
