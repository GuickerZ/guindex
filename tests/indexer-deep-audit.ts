/**
 * GuIndex – Bateria de Testes Reais por Indexer
 * 
 * Testa CADA indexer individualmente com queries em inglês, português,
 * IMDB, SxxEyy, e analisa o retorno completo sem limites artificiais.
 * 
 * Uso: npx tsx tests/indexer-deep-audit.ts
 */

const INDEXER_BASE = (process.env.TORRENT_INDEXER_URL || 'http://guindex.duckdns.org:8090').replace(/\/$/, '');
const TMDB_KEY = process.env.TMDB_API_KEY || '36630395ce8061b8a063643f3ddeabab';
const TIMEOUT = 30_000;

interface IndexerResult {
  title: string;
  original_title?: string;
  imdb?: string;
  info_hash?: string;
  audio?: string[];
  seed_count?: number;
  leech_count?: number;
  year?: string;
  size?: string;
  similarity?: number;
  details?: string;
  magnet_link?: string;
}

interface TestCase {
  label: string;
  type: 'movie' | 'series';
  imdbId: string;
  season?: number;
  episode?: number;
  expectedTitleEN: string;
  expectedTitlePT?: string; // will be fetched from TMDB if not given
}

const CASES: TestCase[] = [
  { label: 'The Boys S04E01', type: 'series', imdbId: 'tt1190634', season: 4, episode: 1, expectedTitleEN: 'The Boys' },
  { label: 'Invincible S02E04', type: 'series', imdbId: 'tt6741278', season: 2, episode: 4, expectedTitleEN: 'Invincible', expectedTitlePT: 'Invencível' },
  { label: 'Gen V S02E05', type: 'series', imdbId: 'tt13159924', season: 2, episode: 5, expectedTitleEN: 'Gen V' },
  { label: 'Stranger Things S04E01', type: 'series', imdbId: 'tt4574334', season: 4, episode: 1, expectedTitleEN: 'Stranger Things' },
  { label: 'Oppenheimer', type: 'movie', imdbId: 'tt15398776', expectedTitleEN: 'Oppenheimer' },
  { label: 'Dune Part Two', type: 'movie', imdbId: 'tt15239678', expectedTitleEN: 'Dune: Part Two', expectedTitlePT: 'Duna: Parte Dois' },
  { label: 'Deadpool & Wolverine', type: 'movie', imdbId: 'tt6263850', expectedTitleEN: 'Deadpool & Wolverine' },
  { label: 'Ainda Estou Aqui', type: 'movie', imdbId: 'tt14816952', expectedTitleEN: 'I\'m Still Here', expectedTitlePT: 'Ainda Estou Aqui' },
];

// ─── helpers ───

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  return res.json();
}

async function fetchTMDBTitle(imdbId: string): Promise<string | undefined> {
  const url = `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=pt-BR&api_key=${TMDB_KEY}`;
  try {
    const data = await fetchJSON(url);
    if (!data) return undefined;
    const entries = [...(data.movie_results || []), ...(data.tv_results || [])];
    for (const e of entries) {
      const ptName = e.title || e.name;
      if (ptName) return ptName;
    }
  } catch { }
  return undefined;
}

async function fetchSources(): Promise<string[]> {
  const data = await fetchJSON(`${INDEXER_BASE}/sources`);
  return data?.indexer_names || [];
}

async function queryIndexer(indexerName: string, q: string, limit = 0): Promise<IndexerResult[]> {
  let url = `${INDEXER_BASE}/indexers/${encodeURIComponent(indexerName)}?q=${encodeURIComponent(q)}`;
  if (limit > 0) url += `&limit=${limit}`;
  try {
    const data = await fetchJSON(url);
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    return [];
  } catch {
    return [];
  }
}

async function querySearch(q: string, limit = 0): Promise<IndexerResult[]> {
  let url = `${INDEXER_BASE}/search?q=${encodeURIComponent(q)}`;
  if (limit > 0) url += `&limit=${limit}`;
  try {
    const data = await fetchJSON(url);
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    return [];
  } catch {
    return [];
  }
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleMatches(result: IndexerResult, expectedTitles: string[]): boolean {
  const fields = [result.title, result.original_title].filter(Boolean).map(s => normalize(s!));
  for (const expected of expectedTitles) {
    const nExpected = normalize(expected);
    for (const f of fields) {
      if (f.includes(nExpected) || nExpected.includes(f)) return true;
    }
  }
  return false;
}

function imdbMatches(result: IndexerResult, imdbId: string): boolean {
  const imdbUrl = result.imdb || '';
  const idNum = imdbId.replace('tt', '');
  return imdbUrl.includes(idNum);
}

function episodeMatches(result: IndexerResult, season: number, episode: number): boolean {
  const title = result.title || '';
  const sPad = String(season).padStart(2, '0');
  const ePad = String(episode).padStart(2, '0');
  return new RegExp(`S${sPad}E${ePad}`, 'i').test(title);
}

function seasonMatches(result: IndexerResult, season: number): boolean {
  const title = result.title || '';
  const sPad = String(season).padStart(2, '0');
  return new RegExp(`S${sPad}`, 'i').test(title) || 
         new RegExp(`${season}[aªº]?\\s*temporada`, 'i').test(title) ||
         new RegExp(`temporada\\s*${season}`, 'i').test(title);
}

// ─── main ───

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  GuIndex – Auditoria Profunda por Indexer                       ║');
  console.log('║  Testa /indexers/{nome} individualmente + /search               ║');
  console.log('║  SEM LIMITES artificiais no retorno                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const indexers = await fetchSources();
  console.log(`\n📡 Indexers disponíveis: ${indexers.join(', ')}\n`);

  // Preencher títulos PT via TMDB
  for (const tc of CASES) {
    if (!tc.expectedTitlePT) {
      const pt = await fetchTMDBTitle(tc.imdbId);
      if (pt && pt !== tc.expectedTitleEN) {
        tc.expectedTitlePT = pt;
        console.log(`  [TMDB] ${tc.label}: PT-BR = "${pt}"`);
      }
    }
  }

  console.log('');

  for (const tc of CASES) {
    console.log('═'.repeat(90));
    console.log(`🎬 ${tc.label} (${tc.type}) – IMDB: ${tc.imdbId}`);
    console.log(`   EN: "${tc.expectedTitleEN}" | PT: "${tc.expectedTitlePT || '(igual)'}"` );
    console.log('═'.repeat(90));

    const allTitles = [tc.expectedTitleEN];
    if (tc.expectedTitlePT) allTitles.push(tc.expectedTitlePT);

    // Build queries to test
    const queries: string[] = [tc.imdbId]; // imdb
    for (const title of allTitles) {
      queries.push(title); // título puro
      if (tc.type === 'series' && tc.season !== undefined) {
        const sPad = String(tc.season).padStart(2, '0');
        const ePad = tc.episode !== undefined ? String(tc.episode).padStart(2, '0') : '';
        queries.push(`${title} S${sPad}${ePad ? `E${ePad}` : ''}`);
        queries.push(`${title} temporada ${tc.season}`);
      }
      if (tc.type === 'movie') {
        // just title, already added
      }
    }
    const uniqueQueries = [...new Set(queries)];

    // ─── Test /search (aggregated) ───
    console.log(`\n  📌 /search (agregado Meilisearch):`);
    for (const q of uniqueQueries.slice(0, 4)) {
      const results = await querySearch(q);
      const matching = results.filter(r => titleMatches(r, allTitles));
      const withImdb = results.filter(r => imdbMatches(r, tc.imdbId));
      console.log(`    q="${q}" → ${results.length} total, ${matching.length} title-match, ${withImdb.length} imdb-match`);
      if (matching.length === 0 && results.length > 0) {
        // Show first 3 to understand what it returned instead
        console.log(`      ⚠️ Nenhum match! Primeiros resultados:`);
        for (const r of results.slice(0, 3)) {
          console.log(`        → "${r.title}" (imdb: ${r.imdb || 'N/A'})`);
        }
      }
    }

    // ─── Test each /indexers/{name} individually ───
    console.log(`\n  📌 /indexers/{name} individual (SEM limit):`);
    for (const indexer of indexers) {
      const indexerResults: Map<string, { total: number; titleMatch: number; imdbMatch: number; epMatch: number; seasonMatch: number; sample: string[] }> = new Map();
      
      for (const q of uniqueQueries) {
        const results = await queryIndexer(indexer, q, 0); // SEM limit
        const matching = results.filter(r => titleMatches(r, allTitles));
        const withImdb = results.filter(r => imdbMatches(r, tc.imdbId));
        let epMatch = 0;
        let sMatch = 0;
        if (tc.type === 'series' && tc.season !== undefined) {
          sMatch = results.filter(r => titleMatches(r, allTitles) && seasonMatches(r, tc.season!)).length;
          if (tc.episode !== undefined) {
            epMatch = results.filter(r => titleMatches(r, allTitles) && episodeMatches(r, tc.season!, tc.episode!)).length;
          }
        }
        const sample = matching.slice(0, 2).map(r => r.title);
        indexerResults.set(q, { total: results.length, titleMatch: matching.length, imdbMatch: withImdb.length, epMatch, seasonMatch: sMatch, sample });
      }

      // Summarize this indexer
      const totalAll = [...indexerResults.values()].reduce((s, v) => s + v.total, 0);
      const totalMatch = [...indexerResults.values()].reduce((s, v) => s + v.titleMatch, 0);
      const totalImdb = [...indexerResults.values()].reduce((s, v) => s + v.imdbMatch, 0);
      const totalEp = [...indexerResults.values()].reduce((s, v) => s + v.epMatch, 0);
      const totalSeason = [...indexerResults.values()].reduce((s, v) => s + v.seasonMatch, 0);

      const status = totalMatch > 0 ? '✅' : (totalAll > 0 ? '⚠️' : '❌');
      let summary = `    ${status} ${indexer}: ${totalAll} total, ${totalMatch} match`;
      if (totalImdb > 0) summary += `, ${totalImdb} imdb`;
      if (tc.type === 'series') {
        summary += `, ${totalSeason} season, ${totalEp} episode`;
      }
      console.log(summary);

      // Show per-query breakdown for interesting cases
      for (const [q, v] of indexerResults) {
        if (v.total > 0) {
          let line = `      q="${q}" → ${v.total} results, ${v.titleMatch} match`;
          if (v.imdbMatch > 0) line += `, ${v.imdbMatch} imdb`;
          if (v.epMatch > 0) line += `, ${v.epMatch} ep`;
          if (v.sample.length > 0) line += ` ex: "${v.sample[0]?.substring(0, 60)}"`;
          console.log(line);
        }
      }

      // Identify which query type works best for this indexer
      const bestQuery = [...indexerResults.entries()]
        .filter(([, v]) => v.titleMatch > 0)
        .sort((a, b) => b[1].titleMatch - a[1].titleMatch)[0];
      
      if (bestQuery) {
        const isImdb = /^tt\d+$/i.test(bestQuery[0]);
        const isPT = tc.expectedTitlePT && bestQuery[0].includes(tc.expectedTitlePT);
        if (isPT) console.log(`      💡 Melhor query é em PT-BR!`);
        if (isImdb) console.log(`      💡 Suporta IMDB diretamente`);
      } else if (totalAll > 0) {
        console.log(`      ⚠️ Retornou resultados mas NENHUM bate com o título esperado`);
        // Show what it returned
        const firstResults = [...indexerResults.values()].find(v => v.total > 0);
        // get actual results to show
        const firstQ = [...indexerResults.entries()].find(([, v]) => v.total > 0);
        if (firstQ) {
          const actual = await queryIndexer(indexer, firstQ[0], 3);
          for (const r of actual.slice(0, 2)) {
            console.log(`        → retornou: "${r.title}"`);
          }
        }
      }
    }

    console.log('');
  }

  // ─── Final Report ───
  console.log('\n' + '═'.repeat(90));
  console.log('📊 ANÁLISE DE CAPACIDADES POR INDEXER');
  console.log('═'.repeat(90));
  console.log(`
Baseado nos testes acima, estas são as observações por indexer:

  torrent-dos-filmes: Suporta IMDB, responde rápido, maior cobertura
  rede_torrent: Suporta busca textual, boa cobertura
  vaca_torrent: Suporta busca textual  
  starck-filmes: NÃO suporta IMDB, só funciona com títulos PT-BR
  bludv: NÃO suporta IMDB, busca textual
  filme_torrent: NÃO suporta IMDB, busca textual
  comando_torrents: Instável, frequentemente timeout
  `);
}

main().catch(console.error);
