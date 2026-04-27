/**
 * GuIndex – Auditoria v3 – Cobertura Total
 * 
 * Testa cenários diversificados que podem causar falhas:
 * - Séries com nomes compostos/especiais (Better Call Saul, Daredevil: Born Again)
 * - Filmes antigos/clássicos
 * - Filmes nacionais brasileiros
 * - Títulos curtos que podem causar false positives
 * - Títulos com caracteres especiais (&, :, -)
 * - Anime
 * - Sequências numeradas (Rocky IV, John Wick 4)
 * - Títulos muito diferentes entre EN e PT-BR
 * - Documentários
 * 
 * Só testa nos 4 indexers funcionais
 * Uso: npx tsx tests/audit-v3.ts
 */

import { writeFileSync, mkdirSync } from 'fs';

const INDEXER_BASE = (process.env.TORRENT_INDEXER_URL || 'http://guindex.duckdns.org:8090').replace(/\/$/, '');
const TMDB_KEY = '36630395ce8061b8a063643f3ddeabab';
const TIMEOUT = 20_000;

const ACTIVE_INDEXERS = ['torrent-dos-filmes', 'rede_torrent', 'vaca_torrent', 'starck-filmes'];

interface TestCase {
  label: string;
  type: 'movie' | 'series';
  imdbId: string;
  season?: number;
  episode?: number;
  titleEN: string;
  titlePT?: string;
  edgeCaseType: string; // Tipo de edge case que esse teste cobre
}

const CASES: TestCase[] = [
  // ─── SÉRIES ───

  // Nome composto com subtítulo — Daredevil: Born Again é um reboot, não a série original
  { label: 'Daredevil Born Again S01E05', type: 'series', imdbId: 'tt15474100', season: 1, episode: 5,
    titleEN: 'Daredevil: Born Again', titlePT: 'Demolidor: Renascido', edgeCaseType: 'subtítulo-reboot' },

  // Série clássica com mesmo nome que o reboot — filtro precisa distinguir
  { label: 'Daredevil (original) S03E01', type: 'series', imdbId: 'tt3322312', season: 3, episode: 1,
    titleEN: 'Daredevil', titlePT: 'Demolidor', edgeCaseType: 'nome-genérico-reboot' },

  // Nome longo com ":" e sem tradução PT
  { label: 'Better Call Saul S06E13', type: 'series', imdbId: 'tt3032476', season: 6, episode: 13,
    titleEN: 'Better Call Saul', edgeCaseType: 'nome-longo-sem-pt' },

  // Anime — títulos podem estar em romaji, japonês, ou inglês
  { label: 'Attack on Titan S04E28', type: 'series', imdbId: 'tt2560140', season: 4, episode: 28,
    titleEN: 'Attack on Titan', titlePT: 'Shingeki no Kyojin', edgeCaseType: 'anime-romaji' },

  // Série brasileira — título só existe em PT
  { label: 'Sintonia S04E01', type: 'series', imdbId: 'tt9651652', season: 4, episode: 1,
    titleEN: 'Sintonia', edgeCaseType: 'série-brasileira' },

  // Série com número no nome — pode confundir com temporada
  { label: '3 Body Problem S01E05', type: 'series', imdbId: 'tt13016388', season: 1, episode: 5,
    titleEN: '3 Body Problem', titlePT: 'O Problema dos 3 Corpos', edgeCaseType: 'número-no-nome' },

  // Série com título idêntico a filme
  { label: 'Fallout S01E01', type: 'series', imdbId: 'tt12637874', season: 1, episode: 1,
    titleEN: 'Fallout', edgeCaseType: 'nome-série-igual-filme' },

  // K-drama com título em inglês
  { label: 'Squid Game S02E01', type: 'series', imdbId: 'tt10919420', season: 2, episode: 1,
    titleEN: 'Squid Game', titlePT: 'Round 6', edgeCaseType: 'k-drama-título-diferente' },

  // Série recente popular — teste de indexação
  { label: 'Wednesday S01E08', type: 'series', imdbId: 'tt13443470', season: 1, episode: 8,
    titleEN: 'Wednesday', titlePT: 'Wandinha', edgeCaseType: 'título-completamente-diferente' },

  // ─── FILMES ───

  // Filme antigo clássico — pode não estar nos indexers
  { label: 'Pulp Fiction (1994)', type: 'movie', imdbId: 'tt0110912',
    titleEN: 'Pulp Fiction', edgeCaseType: 'filme-clássico-anos-90' },

  // Filme muito antigo
  { label: 'The Godfather (1972)', type: 'movie', imdbId: 'tt0068646',
    titleEN: 'The Godfather', titlePT: 'O Poderoso Chefão', edgeCaseType: 'filme-clássico-70s' },

  // Filme brasileiro — só existe em PT
  { label: 'Cidade de Deus (2002)', type: 'movie', imdbId: 'tt0317248',
    titleEN: 'City of God', titlePT: 'Cidade de Deus', edgeCaseType: 'filme-brasileiro' },

  // Filme brasileiro recente
  { label: 'Nosso Lar 2 (2024)', type: 'movie', imdbId: 'tt14972898',
    titleEN: 'Nosso Lar 2: Os Mensageiros', titlePT: 'Nosso Lar 2: Os Mensageiros', edgeCaseType: 'filme-br-sequência' },

  // Filme com "&" no nome
  { label: 'Fast & Furious X', type: 'movie', imdbId: 'tt5433140',
    titleEN: 'Fast X', titlePT: 'Velozes e Furiosos 10', edgeCaseType: 'caractere-especial-&' },

  // Sequência numerada — pode confundir com ano
  { label: 'John Wick 4', type: 'movie', imdbId: 'tt10366206',
    titleEN: 'John Wick: Chapter 4', titlePT: 'John Wick 4: Baba Yaga', edgeCaseType: 'sequência-numerada' },

  // Filme com ":" — torrent pode ter "." ou "-" no lugar
  { label: 'Spider-Man: Across the Spider-Verse', type: 'movie', imdbId: 'tt9362722',
    titleEN: 'Spider-Man: Across the Spider-Verse', titlePT: 'Homem-Aranha: Através do Aranhaverso', edgeCaseType: 'hifens-e-dois-pontos' },

  // Título curto — risco de false positive
  { label: 'Nope', type: 'movie', imdbId: 'tt10954984',
    titleEN: 'Nope', titlePT: 'Não! Não Olhe!', edgeCaseType: 'título-curto' },

  // Título com número que parece ano
  { label: '1917', type: 'movie', imdbId: 'tt8579674',
    titleEN: '1917', edgeCaseType: 'título-é-número' },

  // Filme de animação — título muito diferente em PT
  { label: 'Coco (2017)', type: 'movie', imdbId: 'tt2380307',
    titleEN: 'Coco', titlePT: 'Viva: A Vida é uma Festa', edgeCaseType: 'animação-título-diferente' },

  // Documentário
  { label: 'Planet Earth III', type: 'movie', imdbId: 'tt26561774',
    titleEN: 'Planet Earth III', titlePT: 'Planeta Terra III', edgeCaseType: 'documentário' },

  // Filme com artigo "The" que indexers podem omitir
  { label: 'The Menu', type: 'movie', imdbId: 'tt9764362',
    titleEN: 'The Menu', titlePT: 'O Menu', edgeCaseType: 'artigo-the' },
];

// ─── helpers ───
async function fetchJSON(url: string): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function fetchTMDB(imdbId: string): Promise<{ title?: string; year?: number } | undefined> {
  const data = await fetchJSON(`https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=pt-BR&api_key=${TMDB_KEY}`);
  if (!data) return undefined;
  const entries = [...(data.movie_results || []), ...(data.tv_results || [])];
  for (const e of entries) {
    return {
      title: e.title || e.name,
      year: (e.release_date || e.first_air_date || '').split('-')[0] ? parseInt((e.release_date || e.first_air_date || '').split('-')[0]) : undefined,
    };
  }
  return undefined;
}

async function queryIndexer(name: string, q: string): Promise<{ results: any[]; elapsed: number }> {
  const url = `${INDEXER_BASE}/indexers/${encodeURIComponent(name)}?q=${encodeURIComponent(q)}&filter_results=true`;
  const start = Date.now();
  const data = await fetchJSON(url);
  const elapsed = Date.now() - start;
  if (!data) return { results: [], elapsed };
  const results = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : []);
  return { results, elapsed };
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function titleMatch(result: any, titles: string[]): boolean {
  const fields = [result.title, result.original_title].filter(Boolean).map((s: string) => norm(s));
  for (const t of titles) {
    const nt = norm(t);
    if (nt.length < 3) continue;
    for (const f of fields) {
      if (f.includes(nt) || nt.includes(f)) return true;
    }
  }
  return false;
}

interface QueryResult {
  query: string;
  queryType: string;
  indexer: string;
  total: number;
  matched: number;
  wrong: number;
  withImdb: number;
  withSize: number;
  noMagnet: number;
  elapsed: number;
  epMatch: number;
  samples: { title: string; imdb?: string; size?: string }[];
  wrongSamples: { title: string; imdb?: string }[];
}

// ─── MAIN ───
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  GuIndex – Auditoria v3 – Cobertura Total                           ║');
  console.log('║  22 títulos × 4 indexers × múltiplas queries                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  mkdirSync('test-artifacts/audit-v3', { recursive: true });

  // Resolve TMDB titles
  console.log('📡 Resolvendo títulos PT-BR via TMDB...');
  for (const tc of CASES) {
    if (!tc.titlePT) {
      const tmdb = await fetchTMDB(tc.imdbId);
      if (tmdb?.title && tmdb.title !== tc.titleEN) {
        tc.titlePT = tmdb.title;
      }
    }
    console.log(`  ${tc.label}: EN="${tc.titleEN}" PT="${tc.titlePT || '(igual)'}"`);
  }

  const allResults: QueryResult[] = [];
  const edgeCaseResults: Record<string, { found: boolean; details: string }> = {};
  const indexerStats: Record<string, {
    totalQueries: number; totalResults: number; totalMatch: number;
    totalWrong: number; totalImdb: number; totalNoMagnet: number;
    totalNoSize: number; times: number[];
    queryTypeHits: Record<string, number>;
  }> = {};

  for (const idx of ACTIVE_INDEXERS) {
    indexerStats[idx] = {
      totalQueries: 0, totalResults: 0, totalMatch: 0,
      totalWrong: 0, totalImdb: 0, totalNoMagnet: 0,
      totalNoSize: 0, times: [],
      queryTypeHits: {},
    };
  }

  for (const tc of CASES) {
    console.log(`\n${'═'.repeat(90)}`);
    console.log(`🎬 ${tc.label} [${tc.edgeCaseType}] | ${tc.type} | IMDB: ${tc.imdbId}`);
    console.log(`   EN: "${tc.titleEN}" | PT: "${tc.titlePT || '(igual)'}"`);
    console.log('─'.repeat(90));

    const allTitles = [tc.titleEN];
    if (tc.titlePT && tc.titlePT !== tc.titleEN) allTitles.push(tc.titlePT);

    // Build queries (same logic as the addon)
    type QueryDef = { q: string; type: string };
    const queries: QueryDef[] = [];
    const addQ = (q: string, type: string) => {
      if (!queries.some(x => x.q === q)) queries.push({ q, type });
    };

    // IMDB (only for torrent-dos-filmes)
    addQ(tc.imdbId, 'imdb');

    for (const title of allTitles) {
      const lang = title === tc.titlePT ? 'pt' : 'en';
      addQ(title, `${lang}-bare`);
      if (tc.type === 'series' && tc.season !== undefined) {
        const sp = String(tc.season).padStart(2, '0');
        const ep = tc.episode !== undefined ? `E${String(tc.episode).padStart(2, '0')}` : '';
        addQ(`${title} S${sp}${ep}`, `${lang}-sxxexx`);
        addQ(`${title} temporada ${tc.season}`, `${lang}-temporada`);
      }
    }

    let caseFoundAny = false;
    let caseDetails = '';

    for (const idxName of ACTIVE_INDEXERS) {
      const isImdbCapable = idxName === 'torrent-dos-filmes';

      for (const qdef of queries) {
        // Skip IMDB queries for non-capable indexers
        if (qdef.type === 'imdb' && !isImdbCapable) continue;

        const { results, elapsed } = await queryIndexer(idxName, qdef.q);

        const matched = results.filter((r: any) => titleMatch(r, allTitles));
        const wrong = results.filter((r: any) => !titleMatch(r, allTitles));
        const withImdb = results.filter((r: any) => r.imdb && r.imdb.includes('/title/'));
        const withSize = results.filter((r: any) => r.size && r.size !== '' && r.size !== '0');
        const noMagnet = results.filter((r: any) => !r.magnet_link && !r.info_hash);
        let epCount = 0;
        if (tc.type === 'series' && tc.season !== undefined && tc.episode !== undefined) {
          const epRe = new RegExp(`S${String(tc.season).padStart(2, '0')}E${String(tc.episode).padStart(2, '0')}`, 'i');
          epCount = matched.filter((r: any) => epRe.test(r.title || '')).length;
        }

        // Track stats
        const stats = indexerStats[idxName];
        stats.totalQueries++;
        stats.totalResults += results.length;
        stats.totalMatch += matched.length;
        stats.totalWrong += wrong.length;
        stats.totalImdb += withImdb.length;
        stats.totalNoMagnet += noMagnet.length;
        stats.totalNoSize += (results.length - withSize.length);
        stats.times.push(elapsed);
        stats.queryTypeHits[qdef.type] = (stats.queryTypeHits[qdef.type] || 0) + matched.length;

        if (matched.length > 0) caseFoundAny = true;

        const qr: QueryResult = {
          query: qdef.q, queryType: qdef.type, indexer: idxName,
          total: results.length, matched: matched.length, wrong: wrong.length,
          withImdb: withImdb.length, withSize: withSize.length,
          noMagnet: noMagnet.length, elapsed, epMatch: epCount,
          samples: matched.slice(0, 2).map((r: any) => ({ title: r.title, imdb: r.imdb, size: r.size })),
          wrongSamples: wrong.slice(0, 2).map((r: any) => ({ title: r.title, imdb: r.imdb })),
        };
        allResults.push(qr);

        // Console
        const icon = matched.length > 0 ? '✅' : (results.length > 0 ? '⚠️' : '❌');
        let line = `  ${icon} ${idxName} [${qdef.type}] q="${qdef.q}"`;
        line += ` → ${results.length}t ${matched.length}m`;
        if (wrong.length > 0) line += ` ${wrong.length}w`;
        if (noMagnet.length > 0) line += ` ⛔${noMagnet.length}no-mag`;
        if (results.length > 0 && withSize.length === 0) line += ` ⚠️NO-SIZE`;
        if (epCount > 0) line += ` 🎯${epCount}ep`;
        line += ` (${elapsed}ms)`;
        console.log(line);

        if (wrong.length > 0 && matched.length === 0 && results.length > 0) {
          console.log(`    ❌ ex: "${wrong[0]?.title}"`);
        }
      }
    }

    edgeCaseResults[tc.edgeCaseType] = {
      found: caseFoundAny,
      details: caseFoundAny ? `${tc.label}: Encontrado em algum indexer` : `${tc.label}: NÃO ENCONTRADO em nenhum indexer`,
    };
  }

  // ═══ RELATÓRIO FINAL ═══
  console.log('\n\n' + '═'.repeat(90));
  console.log('📊 ESTATÍSTICAS GLOBAIS POR INDEXER');
  console.log('═'.repeat(90));

  for (const [idx, s] of Object.entries(indexerStats)) {
    const avg = s.times.length ? Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length) : 0;
    const p50 = s.times.length ? s.times.sort((a, b) => a - b)[Math.floor(s.times.length / 2)] : 0;
    const pctMatch = s.totalResults > 0 ? Math.round((s.totalMatch / s.totalResults) * 100) : 0;
    const pctWrong = s.totalResults > 0 ? Math.round((s.totalWrong / s.totalResults) * 100) : 0;
    const pctImdb = s.totalResults > 0 ? Math.round((s.totalImdb / s.totalResults) * 100) : 0;

    console.log(`\n  📌 ${idx}`);
    console.log(`    Queries: ${s.totalQueries} | Results: ${s.totalResults} | Match: ${s.totalMatch} (${pctMatch}%) | Wrong: ${s.totalWrong} (${pctWrong}%)`);
    console.log(`    IMDB: ${s.totalImdb} (${pctImdb}%) | No-magnet: ${s.totalNoMagnet} | No-size: ${s.totalNoSize}`);
    console.log(`    Avg: ${avg}ms | P50: ${p50}ms | Min: ${Math.min(...s.times)}ms | Max: ${Math.max(...s.times)}ms`);
    console.log(`    Query type hits: ${JSON.stringify(s.queryTypeHits)}`);
  }

  // ═══ EDGE CASE COVERAGE ═══
  console.log('\n\n' + '═'.repeat(90));
  console.log('🧪 COBERTURA DE EDGE CASES');
  console.log('═'.repeat(90));

  const found = Object.entries(edgeCaseResults).filter(([, v]) => v.found);
  const notFound = Object.entries(edgeCaseResults).filter(([, v]) => !v.found);

  console.log(`\n  ✅ Encontrados (${found.length}/${Object.keys(edgeCaseResults).length}):`);
  for (const [type, info] of found) {
    console.log(`    ✅ [${type}] ${info.details}`);
  }

  if (notFound.length > 0) {
    console.log(`\n  ❌ NÃO encontrados (${notFound.length}):`);
    for (const [type, info] of notFound) {
      console.log(`    ❌ [${type}] ${info.details}`);
    }
  }

  // ═══ INCONSISTÊNCIAS ═══
  console.log('\n\n' + '═'.repeat(90));
  console.log('🩺 INCONSISTÊNCIAS E FALHAS DETECTADAS');
  console.log('═'.repeat(90));

  // Analyse: queries that return results but 0 match
  const zeroMatchButResults = allResults.filter(r => r.total > 0 && r.matched === 0);
  if (zeroMatchButResults.length > 0) {
    console.log(`\n  ⚠️ ${zeroMatchButResults.length} queries retornaram resultados mas ZERO match:`);
    for (const r of zeroMatchButResults.slice(0, 10)) {
      console.log(`    ${r.indexer} q="${r.query}" → ${r.total} results, ex: "${r.wrongSamples[0]?.title}"`);
    }
  }

  // Analyse: no-magnet results
  const noMagnetResults = allResults.filter(r => r.noMagnet > 0);
  if (noMagnetResults.length > 0) {
    console.log(`\n  ⛔ ${noMagnetResults.length} queries com resultados SEM magnet/hash:`);
    for (const r of noMagnetResults.slice(0, 5)) {
      console.log(`    ${r.indexer} q="${r.query}" → ${r.noMagnet}/${r.total} sem magnet`);
    }
  }

  // Analyse: very slow queries
  const slowQueries = allResults.filter(r => r.elapsed > 15000);
  if (slowQueries.length > 0) {
    console.log(`\n  🐌 ${slowQueries.length} queries com >15s:`);
    for (const r of slowQueries) {
      console.log(`    ${r.indexer} q="${r.query}" → ${r.elapsed}ms`);
    }
  }

  // Analyse: high wrong ratio
  const highWrongRatio = allResults.filter(r => r.wrong > r.matched * 3 && r.total > 10);
  if (highWrongRatio.length > 0) {
    console.log(`\n  🗑️ ${highWrongRatio.length} queries com >75% resultados errados:`);
    for (const r of highWrongRatio.slice(0, 10)) {
      console.log(`    ${r.indexer} q="${r.query}" → ${r.matched}m/${r.wrong}w (${Math.round(r.wrong / (r.wrong + r.matched) * 100)}% wrong)`);
    }
  }

  // ═══ BEST QUERY STRATEGY ═══
  console.log('\n\n' + '═'.repeat(90));
  console.log('🧠 MELHOR ESTRATÉGIA DE QUERY POR INDEXER');
  console.log('═'.repeat(90));

  for (const idx of ACTIVE_INDEXERS) {
    const idxResults = allResults.filter(r => r.indexer === idx && r.matched > 0);
    const byType: Record<string, { total: number; matched: number; avgTime: number }> = {};
    for (const r of idxResults) {
      if (!byType[r.queryType]) byType[r.queryType] = { total: 0, matched: 0, avgTime: 0 };
      byType[r.queryType].total++;
      byType[r.queryType].matched += r.matched;
      byType[r.queryType].avgTime += r.elapsed;
    }
    for (const bt of Object.values(byType)) {
      if (bt.total > 0) bt.avgTime = Math.round(bt.avgTime / bt.total);
    }

    console.log(`\n  📌 ${idx}:`);
    const sorted = Object.entries(byType).sort((a, b) => b[1].matched - a[1].matched);
    for (const [type, data] of sorted) {
      console.log(`    ${type}: ${data.matched} match em ${data.total} queries (avg ${data.avgTime}ms)`);
    }
  }

  // Save report
  const reportPath = 'test-artifacts/audit-v3/report.json';
  writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), cases: CASES, results: allResults, edgeCases: edgeCaseResults, indexerStats }, null, 2));
  console.log(`\n📁 Relatório salvo em: ${reportPath}`);
}

main().catch(console.error);
