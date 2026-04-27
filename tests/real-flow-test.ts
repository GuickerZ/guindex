/**
 * Real Stremio Flow Simulation Test
 * 
 * Este script simula EXATAMENTE o que o Stremio faz:
 * 1. Recebe um imdbId (ex: tt13159924)
 * 2. Busca metadata no Cinemeta (titulo em ingles)
 * 3. Busca titulo em PT-BR no TMDB
 * 4. Pesquisa no torrent-indexer com as queries geradas
 * 5. Filtra e retorna os streams relevantes
 * 
 * Uso: npx tsx tests/real-flow-test.ts
 */

const TORRENT_INDEXER_URL = process.env.TORRENT_INDEXER_URL || 'http://guindex.duckdns.org:8090';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '36630395ce8061b8a063643f3ddeabab';
const TMDB_READ_TOKEN = process.env.TMDB_API_READ_ACCESS_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzNjYzMDM5NWNlODA2MWI4YTA2MzY0M2YzZGRlYWJhYiIsIm5iZiI6MTYzNTkwNTAzMS45NzksInN1YiI6IjYxODFlZTA3ZmIzZjYxMDA2NWFhZDk5ZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.JBIB9Drq78FOfjfeeZeNICFM3ZYGsDdKBulzQDJNedY';

interface TestCase {
  name: string;
  type: 'movie' | 'series';
  id: string;       // stremio format: tt1234567 or tt1234567:1:5
  description: string;
}

const TEST_CASES: TestCase[] = [
  // Filme brasileiro - titulo original em PT-BR
  {
    name: 'Ainda Estou Aqui (2024)',
    type: 'movie',
    id: 'tt14816952',
    description: 'Filme brasileiro - titulo em PT-BR no Cinemeta pode ser "I Am Still Here"'
  },
  // Filme americano popular com torrents BR
  {
    name: 'Oppenheimer (2023)',
    type: 'movie',
    id: 'tt15398776',
    description: 'Filme americano popular - deve ter torrents dublados'
  },
  // Serie popular - episodio especifico
  {
    name: 'Gen V S02E05',
    type: 'series',
    id: 'tt13159924:2:5',
    description: 'Serie - busca por episodio especifico'
  },
  // Serie brasileira
  {
    name: 'Sintonia S01E01',
    type: 'series',
    id: 'tt9362930:1:1',
    description: 'Serie brasileira Netflix'
  },
  // Filme popular recente
  {
    name: 'Dune Part Two (2024)',
    type: 'movie',
    id: 'tt15239678',
    description: 'Filme com titulo diferente em PT-BR (Duna: Parte Dois)'
  },
];

// ============== STEP 1: Cinemeta ==============
async function fetchCinemeta(type: string, imdbId: string) {
  const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
  console.log(`  [Cinemeta] GET ${url}`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  [Cinemeta] ❌ HTTP ${res.status}`);
      return null;
    }
    const json = await res.json() as any;
    return json.meta || null;
  } catch (e: any) {
    console.log(`  [Cinemeta] ❌ Error: ${e.message}`);
    return null;
  }
}

// ============== STEP 2: TMDB ==============
async function fetchTMDB(imdbId: string) {
  const url = `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=pt-BR&api_key=${TMDB_API_KEY}`;
  console.log(`  [TMDB] GET find/${imdbId}?language=pt-BR`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  [TMDB] ❌ HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as any;
    const entries = [...(json.movie_results || []), ...(json.tv_results || [])];
    const titles: string[] = [];
    for (const entry of entries) {
      for (const key of ['title', 'name', 'original_title', 'original_name']) {
        if (entry[key] && !titles.includes(entry[key])) {
          titles.push(entry[key]);
        }
      }
    }
    return titles;
  } catch (e: any) {
    console.log(`  [TMDB] ❌ Error: ${e.message}`);
    return [];
  }
}

// ============== STEP 3: Torrent Indexer ==============
async function searchIndexer(query: string) {
  const url = `${TORRENT_INDEXER_URL}/search?q=${encodeURIComponent(query)}`;
  console.log(`  [Indexer] GET /search?q=${query}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log(`  [Indexer] ❌ HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as any;
    const results = json.results || json || [];
    console.log(`  [Indexer] ✅ ${results.length} resultados para "${query}"`);
    return results;
  } catch (e: any) {
    console.log(`  [Indexer] ❌ Error: ${e.message}`);
    return [];
  }
}

// ============== STEP 4: Simulate query building ==============
function parseStremioId(id: string) {
  const parts = id.split(':');
  return {
    imdbId: parts[0],
    season: parts[1] ? parseInt(parts[1]) : undefined,
    episode: parts[2] ? parseInt(parts[2]) : undefined,
  };
}

function buildQueries(
  type: string,
  parsed: { imdbId: string; season?: number; episode?: number },
  cinemetaTitle: string | undefined,
  tmdbTitles: string[],
  year?: number
): string[] {
  const queries: string[] = [];
  const add = (q: string) => { if (q && !queries.includes(q)) queries.push(q); };

  // 1. IMDB query (funciona nos indexers que suportam)
  add(parsed.imdbId);

  const allTitles = [cinemetaTitle, ...tmdbTitles].filter(Boolean) as string[];
  const uniqueTitles = [...new Set(allTitles)];

  for (const title of uniqueTitles) {
    if (type === 'series' && parsed.season !== undefined) {
      const sPad = String(parsed.season).padStart(2, '0');
      const eCode = parsed.episode !== undefined
        ? `E${String(parsed.episode).padStart(2, '0')}` : '';
      add(`${title} S${sPad}${eCode}`);
      add(`${title} temporada ${parsed.season}`);
      if (parsed.episode !== undefined) {
        add(`${title} temporada ${parsed.season} episodio ${parsed.episode}`);
      }
    } else {
      // Movie
      add(title);
      if (year) add(`${title} ${year}`);
    }
  }

  return queries;
}

// ============== STEP 5: Analyze results ==============
function analyzeResults(
  allResults: any[],
  parsed: { imdbId: string; season?: number; episode?: number },
  type: string
) {
  const analysis = {
    total: allResults.length,
    withImdb: 0,
    matchingImdb: 0,
    withDualAudio: 0,
    withPtBrOnly: 0,
    withEngOnly: 0,
    matchingSeason: 0,
    matchingEpisode: 0,
    uniqueHashes: new Set<string>(),
    sources: new Map<string, number>(),
    qualities: new Map<string, number>(),
  };

  for (const r of allResults) {
    const title = (r.title || '') as string;
    const originalTitle = (r.original_title || '') as string;
    const imdbUrl = (r.imdb || '') as string;
    const audio = (r.audio || []) as string[];
    const hash = r.info_hash as string;

    // IMDB match
    if (imdbUrl) analysis.withImdb++;
    if (imdbUrl && imdbUrl.includes(parsed.imdbId.replace('tt', ''))) {
      analysis.matchingImdb++;
    }

    // Audio
    const hasPortugues = audio.some((a: string) => /portugu[eê]s|brazilian/i.test(a));
    const hasIngles = audio.some((a: string) => /ingl[eê]s|english/i.test(a));
    if (hasPortugues && hasIngles) analysis.withDualAudio++;
    else if (hasPortugues) analysis.withPtBrOnly++;
    else if (hasIngles) analysis.withEngOnly++;

    // Season/Episode match for series
    if (type === 'series' && parsed.season !== undefined) {
      const sPad = String(parsed.season).padStart(2, '0');
      if (new RegExp(`S${sPad}`, 'i').test(title)) {
        analysis.matchingSeason++;
        if (parsed.episode !== undefined) {
          const ePad = String(parsed.episode).padStart(2, '0');
          if (new RegExp(`S${sPad}E${ePad}`, 'i').test(title)) {
            analysis.matchingEpisode++;
          }
        }
      }
    }

    // Hash
    if (hash) analysis.uniqueHashes.add(hash.toLowerCase());

    // Quality
    for (const q of ['2160p', '4K', '1080p', '720p', '480p']) {
      if (title.includes(q) || originalTitle.includes(q)) {
        analysis.qualities.set(q, (analysis.qualities.get(q) || 0) + 1);
        break;
      }
    }

    // Source/details domain
    try {
      const detailUrl = r.details as string;
      if (detailUrl) {
        const domain = new URL(detailUrl).hostname;
        analysis.sources.set(domain, (analysis.sources.get(domain) || 0) + 1);
      }
    } catch {}
  }

  return analysis;
}

// ============== MAIN ==============
async function runTest(testCase: TestCase) {
  console.log('\n' + '='.repeat(80));
  console.log(`🎬 TEST: ${testCase.name}`);
  console.log(`   Type: ${testCase.type} | ID: ${testCase.id}`);
  console.log(`   ${testCase.description}`);
  console.log('='.repeat(80));

  const parsed = parseStremioId(testCase.id);

  // Step 1: Cinemeta
  console.log('\n📡 STEP 1: Cinemeta Metadata');
  const meta = await fetchCinemeta(testCase.type, parsed.imdbId);
  const cinemetaTitle = meta?.name || meta?.title;
  const year = meta?.year || meta?.releaseInfo?.match(/\d{4}/)?.[0];
  console.log(`  Title (EN): "${cinemetaTitle}"`);
  console.log(`  Year: ${year || 'N/A'}`);
  if (meta?.aliases) console.log(`  Aliases: ${JSON.stringify(meta.aliases)}`);

  // Step 2: TMDB
  console.log('\n🌐 STEP 2: TMDB pt-BR Title Lookup');
  const tmdbTitles = await fetchTMDB(parsed.imdbId);
  console.log(`  Titulos encontrados: ${JSON.stringify(tmdbTitles)}`);

  // Step 3: Build queries (simulating the addon code)
  console.log('\n🔍 STEP 3: Queries que o addon geraria');
  const queries = buildQueries(testCase.type, parsed, cinemetaTitle, tmdbTitles, year ? parseInt(year) : undefined);
  for (let i = 0; i < queries.length; i++) {
    console.log(`  Query ${i + 1}: "${queries[i]}"`);
  }

  // Step 4: Execute searches
  console.log('\n🔎 STEP 4: Resultados do torrent-indexer');
  const allResults: any[] = [];
  const resultsByQuery = new Map<string, any[]>();

  for (const query of queries) {
    const results = await searchIndexer(query);
    resultsByQuery.set(query, results);
    for (const r of results) {
      const hash = (r.info_hash || '') as string;
      if (!allResults.some((existing) => existing.info_hash === hash)) {
        allResults.push(r);
      }
    }
  }

  // Step 5: Analysis
  console.log('\n📊 STEP 5: Analise dos Resultados');
  const analysis = analyzeResults(allResults, parsed, testCase.type);

  console.log(`  Total resultados unicos: ${allResults.length}`);
  console.log(`  Hashes unicos: ${analysis.uniqueHashes.size}`);
  console.log(`  Com link IMDB: ${analysis.withImdb}`);
  console.log(`  IMDB matching (${parsed.imdbId}): ${analysis.matchingImdb}`);
  console.log(`  Dual Audio (PT+EN): ${analysis.withDualAudio}`);
  console.log(`  Somente PT-BR: ${analysis.withPtBrOnly}`);
  console.log(`  Somente EN: ${analysis.withEngOnly}`);

  if (testCase.type === 'series') {
    console.log(`  Matching Season: ${analysis.matchingSeason}`);
    console.log(`  Matching Episode: ${analysis.matchingEpisode}`);
  }

  console.log(`\n  Qualidades:`);
  for (const [q, count] of analysis.qualities) {
    console.log(`    ${q}: ${count}`);
  }

  console.log(`\n  Fontes (indexers):`);
  for (const [source, count] of analysis.sources) {
    console.log(`    ${source}: ${count}`);
  }

  // Step 6: Diagnose problems
  console.log('\n🩺 STEP 6: Diagnostico');
  const problems: string[] = [];
  const suggestions: string[] = [];

  if (allResults.length === 0) {
    problems.push('❌ CRITICO: Nenhum resultado encontrado para nenhuma query!');
    suggestions.push('Verificar se torrent-indexer esta rodando e se os indexers estao acessiveis');
  }

  if (analysis.matchingImdb === 0 && analysis.withImdb > 0) {
    problems.push('⚠️ Resultados tem IMDB mas nenhum bate com o ID buscado');
  }

  if (analysis.withDualAudio === 0 && analysis.withPtBrOnly === 0) {
    problems.push('⚠️ Nenhum resultado com audio em Portugues');
    if (tmdbTitles.length === 0) {
      suggestions.push('💡 TMDB nao retornou titulo PT-BR - verificar chave API ou se filme tem traducao');
    }
  }

  if (testCase.type === 'series' && analysis.matchingEpisode === 0 && allResults.length > 0) {
    problems.push('⚠️ Resultados encontrados mas nenhum bate com o episodio especifico');
    suggestions.push('💡 Verificar se os torrents sao packs de temporada completa sem SxxEyy no titulo');
  }

  if (tmdbTitles.length === 0) {
    problems.push('⚠️ TMDB nao retornou titulos em PT-BR');
    suggestions.push('💡 Configurar TMDB_API_KEY no Vercel para ativar busca por titulo brasileiro');
  }

  if (cinemetaTitle && tmdbTitles.length > 0) {
    const ptTitle = tmdbTitles.find(t => t !== cinemetaTitle);
    if (ptTitle) {
      console.log(`  ✅ Titulo PT-BR diferente do EN: "${ptTitle}" vs "${cinemetaTitle}"`);
      console.log(`     -> Pesquisa com titulo PT-BR AMPLIA resultados`);
    } else {
      console.log(`  ℹ️ Titulo igual em PT-BR e EN: "${cinemetaTitle}"`);
    }
  }

  if (problems.length === 0) {
    console.log('  ✅ Nenhum problema detectado! Resultados parecem bons.');
  } else {
    for (const p of problems) console.log(`  ${p}`);
    for (const s of suggestions) console.log(`  ${s}`);
  }

  // Show sample results
  if (allResults.length > 0) {
    console.log('\n  📋 Amostra dos primeiros 5 resultados:');
    for (const r of allResults.slice(0, 5)) {
      const audio = (r.audio || []).join(', ');
      console.log(`    [${r.seed_count || 0}S/${r.leech_count || 0}L] ${r.title}`);
      console.log(`      Audio: ${audio || 'N/A'} | Hash: ${(r.info_hash || 'N/A').substring(0, 12)}...`);
    }
  }

  return { testCase, allResults, analysis, problems, suggestions };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  GuIndex - Real Stremio Flow Simulation Test                    ║');
  console.log('║  Simula exatamente o fluxo: Stremio → Cinemeta → TMDB →        ║');
  console.log('║  torrent-indexer → streams                                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log(`\n  Torrent Indexer: ${TORRENT_INDEXER_URL}`);
  console.log(`  TMDB API Key: ${TMDB_API_KEY ? '✅ Configurada' : '❌ NAO configurada'}`);
  console.log(`  TMDB Read Token: ${TMDB_READ_TOKEN ? '✅ Configurada' : '❌ NAO configurada'}`);

  const results = [];
  for (const tc of TEST_CASES) {
    results.push(await runTest(tc));
  }

  // Final Summary
  console.log('\n\n' + '═'.repeat(80));
  console.log('📊 RESUMO FINAL');
  console.log('═'.repeat(80));

  for (const r of results) {
    const emoji = r.problems.length === 0 ? '✅' : (r.allResults.length > 0 ? '⚠️' : '❌');
    const ptBr = r.analysis.withDualAudio + r.analysis.withPtBrOnly;
    console.log(`  ${emoji} ${r.testCase.name}: ${r.allResults.length} results (${ptBr} PT-BR, ${r.analysis.withEngOnly} EN) ${r.problems.length > 0 ? `[${r.problems.length} problemas]` : ''}`);
  }

  const totalProblems = results.reduce((sum, r) => sum + r.problems.length, 0);
  const allSuggestions = new Set(results.flatMap(r => r.suggestions));

  if (totalProblems > 0) {
    console.log(`\n🔧 RECOMENDACOES GLOBAIS:`);
    for (const s of allSuggestions) {
      console.log(`  ${s}`);
    }
  }

  console.log('\n✅ Teste finalizado.\n');
}

main().catch(console.error);
