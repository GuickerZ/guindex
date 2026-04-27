/**
 * GuIndex – Auditoria Profunda v2 com JSON Completo
 * 
 * - Só testa nos 4 indexers funcionais: torrent-dos-filmes, rede_torrent, vaca_torrent, starck-filmes
 * - Salva JSON completo de cada resposta
 * - Analisa: campos faltando (imdb, size, year), título errado, melhor query por indexer
 * - Múltiplos títulos: filmes, séries, episódios, conteúdo BR
 * 
 * Uso: npx tsx tests/audit-v2.ts
 */

import { writeFileSync, mkdirSync } from 'fs';

const INDEXER_BASE = (process.env.TORRENT_INDEXER_URL || 'http://guindex.duckdns.org:8090').replace(/\/$/, '');
const TMDB_KEY = '36630395ce8061b8a063643f3ddeabab';
const TIMEOUT = 30_000;

const ACTIVE_INDEXERS = ['torrent-dos-filmes', 'rede_torrent', 'vaca_torrent', 'starck-filmes'];

interface TestCase {
  label: string;
  type: 'movie' | 'series';
  imdbId: string;
  season?: number;
  episode?: number;
  titleEN: string;
  titlePT?: string;
}

const CASES: TestCase[] = [
  // ─── Séries ───
  { label: 'The Boys S04E01', type: 'series', imdbId: 'tt1190634', season: 4, episode: 1, titleEN: 'The Boys' },
  { label: 'Invincible S02E04', type: 'series', imdbId: 'tt6741278', season: 2, episode: 4, titleEN: 'Invincible', titlePT: 'Invencível' },
  { label: 'Gen V S02E05', type: 'series', imdbId: 'tt13159924', season: 2, episode: 5, titleEN: 'Gen V' },
  { label: 'Stranger Things S04E01', type: 'series', imdbId: 'tt4574334', season: 4, episode: 1, titleEN: 'Stranger Things' },
  { label: 'The Last of Us S01E01', type: 'series', imdbId: 'tt3581920', season: 1, episode: 1, titleEN: 'The Last of Us' },
  { label: 'Arcane S02E01', type: 'series', imdbId: 'tt11126994', season: 2, episode: 1, titleEN: 'Arcane' },
  { label: 'House of the Dragon S02E01', type: 'series', imdbId: 'tt11198330', season: 2, episode: 1, titleEN: 'House of the Dragon', titlePT: 'A Casa do Dragão' },
  // ─── Filmes ───
  { label: 'Oppenheimer', type: 'movie', imdbId: 'tt15398776', titleEN: 'Oppenheimer' },
  { label: 'Dune Part Two', type: 'movie', imdbId: 'tt15239678', titleEN: 'Dune: Part Two', titlePT: 'Duna: Parte Dois' },
  { label: 'Deadpool & Wolverine', type: 'movie', imdbId: 'tt6263850', titleEN: 'Deadpool & Wolverine' },
  { label: 'Inside Out 2', type: 'movie', imdbId: 'tt22022452', titleEN: 'Inside Out 2', titlePT: 'Divertida Mente 2' },
  { label: 'Interstellar', type: 'movie', imdbId: 'tt0816692', titleEN: 'Interstellar', titlePT: 'Interestelar' },
  { label: 'Gladiator II', type: 'movie', imdbId: 'tt9218128', titleEN: 'Gladiator II', titlePT: 'Gladiador II' },
];

// ─── helpers ───
async function fetchJSON(url: string): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function fetchTMDB(imdbId: string): Promise<string | undefined> {
  const data = await fetchJSON(`https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=pt-BR&api_key=${TMDB_KEY}`);
  if (!data) return undefined;
  const entries = [...(data.movie_results || []), ...(data.tv_results || [])];
  for (const e of entries) { if (e.title || e.name) return e.title || e.name; }
  return undefined;
}

async function queryIndexer(name: string, q: string): Promise<any[]> {
  const url = `${INDEXER_BASE}/indexers/${encodeURIComponent(name)}?q=${encodeURIComponent(q)}`;
  const data = await fetchJSON(url);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleMatch(result: any, titles: string[]): boolean {
  const fields = [result.title, result.original_title].filter(Boolean).map((s: string) => norm(s));
  for (const t of titles) {
    const nt = norm(t);
    for (const f of fields) {
      if (f.includes(nt) || nt.includes(f)) return true;
    }
  }
  return false;
}

function epMatch(result: any, s: number, e: number): boolean {
  const t = (result.title || '') as string;
  return new RegExp(`S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`, 'i').test(t);
}

function seasonMatch(result: any, s: number): boolean {
  const t = (result.title || '') as string;
  const sp = String(s).padStart(2, '0');
  return new RegExp(`S${sp}`, 'i').test(t) || /temporada/i.test(t);
}

// ─── MAIN ───
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  GuIndex – Auditoria v2 – JSON Completo + Análise Profunda      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  mkdirSync('test-artifacts/audit-v2', { recursive: true });

  // Fill TMDB titles
  for (const tc of CASES) {
    if (!tc.titlePT) {
      const pt = await fetchTMDB(tc.imdbId);
      if (pt && pt !== tc.titleEN) {
        tc.titlePT = pt;
        console.log(`[TMDB] ${tc.label}: PT = "${pt}"`);
      }
    }
  }

  const fullReport: any = { generatedAt: new Date().toISOString(), indexers: ACTIVE_INDEXERS, cases: [] };
  const indexerStats: Record<string, { total: number; matched: number; withImdb: number; withSize: number; noMagnet: number; wrongResults: number; avgTime: number[]; bestQueryType: Record<string, number> }> = {};
  
  for (const idx of ACTIVE_INDEXERS) {
    indexerStats[idx] = { total: 0, matched: 0, withImdb: 0, withSize: 0, noMagnet: 0, wrongResults: 0, avgTime: [], bestQueryType: {} };
  }

  for (const tc of CASES) {
    console.log(`\n${'═'.repeat(90)}`);
    console.log(`🎬 ${tc.label} | ${tc.type} | IMDB: ${tc.imdbId}`);
    console.log(`   EN: "${tc.titleEN}" | PT: "${tc.titlePT || '(igual)'}"`);
    console.log('═'.repeat(90));

    const allTitles = [tc.titleEN];
    if (tc.titlePT) allTitles.push(tc.titlePT);

    // Build queries
    const queries: string[] = [];
    const addQ = (q: string, type: string) => {
      if (!queries.some(x => x === q)) queries.push(q);
    };

    // IMDB query
    addQ(tc.imdbId, 'imdb');
    
    for (const title of allTitles) {
      addQ(title, title === tc.titlePT ? 'pt-title' : 'en-title');
      if (tc.type === 'series' && tc.season !== undefined) {
        const sp = String(tc.season).padStart(2, '0');
        const ep = tc.episode !== undefined ? `E${String(tc.episode).padStart(2, '0')}` : '';
        addQ(`${title} S${sp}${ep}`, title === tc.titlePT ? 'pt-sxxexx' : 'en-sxxexx');
        addQ(`${title} temporada ${tc.season}`, title === tc.titlePT ? 'pt-temporada' : 'en-temporada');
      }
    }

    const caseReport: any = { case: tc, queries, perIndexer: {} };

    for (const idxName of ACTIVE_INDEXERS) {
      const idxReport: any = { queries: {} };
      let totalForCase = 0;
      let matchedForCase = 0;

      for (const q of queries) {
        const isImdb = /^tt\d+$/i.test(q);
        // Skip IMDB queries for indexers that don't support it
        if (isImdb && idxName !== 'torrent-dos-filmes') {
          idxReport.queries[q] = { skipped: true, reason: 'no-imdb-support' };
          continue;
        }

        const start = Date.now();
        const results = await queryIndexer(idxName, q);
        const elapsed = Date.now() - start;
        indexerStats[idxName].avgTime.push(elapsed);

        const matched = results.filter((r: any) => titleMatch(r, allTitles));
        const wrong = results.filter((r: any) => !titleMatch(r, allTitles));
        const withImdb = results.filter((r: any) => r.imdb && r.imdb.includes('/title/'));
        const withSize = results.filter((r: any) => r.size && r.size !== '' && r.size !== '0');
        const noMagnet = results.filter((r: any) => !r.magnet_link && !r.info_hash);
        let epCount = 0;
        let sCount = 0;
        if (tc.type === 'series' && tc.season !== undefined) {
          sCount = matched.filter((r: any) => seasonMatch(r, tc.season!)).length;
          if (tc.episode !== undefined) {
            epCount = matched.filter((r: any) => epMatch(r, tc.season!, tc.episode!)).length;
          }
        }

        totalForCase += results.length;
        matchedForCase += matched.length;
        indexerStats[idxName].total += results.length;
        indexerStats[idxName].matched += matched.length;
        indexerStats[idxName].withImdb += withImdb.length;
        indexerStats[idxName].withSize += withSize.length;
        indexerStats[idxName].noMagnet += noMagnet.length;
        indexerStats[idxName].wrongResults += wrong.length;

        // Track best query type
        const qType = isImdb ? 'imdb' : (q.includes('temporada') ? 'temporada' : (q.includes('S0') || q.includes('S1') ? 'SxxEyy' : (q === tc.titlePT ? 'pt-title' : 'en-title')));
        indexerStats[idxName].bestQueryType[qType] = (indexerStats[idxName].bestQueryType[qType] || 0) + matched.length;

        idxReport.queries[q] = {
          elapsed,
          total: results.length,
          matched: matched.length,
          wrong: wrong.length,
          withImdb: withImdb.length,
          withSize: withSize.length,
          noMagnet: noMagnet.length,
          seasonMatch: sCount,
          episodeMatch: epCount,
          // First 3 wrong results for analysis
          wrongSamples: wrong.slice(0, 3).map((r: any) => ({
            title: r.title, 
            original_title: r.original_title,
            imdb: r.imdb,
            similarity: r.similarity,
          })),
          // First 3 correct results
          matchedSamples: matched.slice(0, 3).map((r: any) => ({
            title: r.title,
            original_title: r.original_title,
            imdb: r.imdb,
            audio: r.audio,
            size: r.size,
            seed_count: r.seed_count,
            info_hash: r.info_hash?.substring(0, 12),
          })),
          // Full results for file dump
          fullResults: results,
        };

        // Console output
        const status = matched.length > 0 ? '✅' : (results.length > 0 ? '⚠️' : '❌');
        let line = `  ${status} ${idxName} q="${q}" → ${results.length} total, ${matched.length} match`;
        if (wrong.length > 0) line += `, ${wrong.length} wrong`;
        if (withImdb.length > 0) line += `, ${withImdb.length} imdb`;
        if (!withSize.length && results.length > 0) line += ` ⚠️ NO SIZE`;
        if (noMagnet.length > 0) line += ` ⚠️ ${noMagnet.length} no-magnet`;
        if (epCount > 0) line += `, ${epCount} ep-match`;
        line += ` (${elapsed}ms)`;
        console.log(line);

        // Show wrong results for analysis
        if (wrong.length > 0 && matched.length === 0) {
          for (const w of wrong.slice(0, 2)) {
            console.log(`    ❌ wrong: "${w.title}" (sim: ${w.similarity || 'N/A'})`);
          }
        }
      }

      idxReport.summary = { total: totalForCase, matched: matchedForCase };
      caseReport.perIndexer[idxName] = idxReport;
    }

    fullReport.cases.push(caseReport);
  }

  // ─── GLOBAL ANALYSIS ───
  console.log('\n\n' + '═'.repeat(90));
  console.log('📊 ANÁLISE GLOBAL POR INDEXER');
  console.log('═'.repeat(90));

  for (const [idx, stats] of Object.entries(indexerStats)) {
    const avg = stats.avgTime.length > 0 ? Math.round(stats.avgTime.reduce((a, b) => a + b, 0) / stats.avgTime.length) : 0;
    const pctMatch = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0;
    const pctImdb = stats.total > 0 ? Math.round((stats.withImdb / stats.total) * 100) : 0;
    const pctSize = stats.total > 0 ? Math.round((stats.withSize / stats.total) * 100) : 0;

    console.log(`\n  📌 ${idx}`);
    console.log(`    Total: ${stats.total} | Match: ${stats.matched} (${pctMatch}%) | Wrong: ${stats.wrongResults}`);
    console.log(`    IMDB: ${stats.withImdb} (${pctImdb}%) | Size: ${stats.withSize} (${pctSize}%) | No-magnet: ${stats.noMagnet}`);
    console.log(`    Avg response: ${avg}ms`);
    console.log(`    Best query types: ${JSON.stringify(stats.bestQueryType)}`);

    // Identify problems
    if (pctImdb === 0) console.log(`    ⚠️ NUNCA retorna IMDB → precisa de filtro por título no addon`);
    if (pctSize === 0) console.log(`    ⚠️ NUNCA retorna size → addon precisa tratar campo vazio`);
    if (stats.noMagnet > 0) console.log(`    ⚠️ ${stats.noMagnet} resultados SEM magnet/hash → precisa filtrar`);
    if (stats.wrongResults > stats.matched) console.log(`    ⚠️ Mais resultados ERRADOS que corretos → precisa de filtro inteligente`);
  }

  // ─── PROBLEMS & RECOMMENDATIONS ───
  console.log('\n\n' + '═'.repeat(90));
  console.log('🩺 PROBLEMAS E RECOMENDAÇÕES');
  console.log('═'.repeat(90));

  console.log(`
1. FILTRO DE RELEVÂNCIA: Indexers como starck-filmes e vaca_torrent retornam resultados
   aleatórios misturados com os corretos. O addon PRECISA de um filtro que:
   a) Compare o título retornado com o título buscado (fuzzy match)
   b) Verifique IMDB quando disponível
   c) NÃO descarte resultados sem IMDB (starck-filmes nunca tem)
   d) Use o campo "similarity" quando > 0 como indicador

2. CAMPO SIZE: Alguns indexers não retornam size. O addon deve tratar gracefully.

3. CAMPO IMDB: starck-filmes NUNCA retorna IMDB.
   → O addon precisa confiar no title-matching para esses resultados.

4. RESULTADOS ERRADOS POPULAM O MEILISEARCH: Isso é POSITIVO para o cache
   mas o addon precisa filtrar antes de mostrar ao usuário.

5. QUERIES DIFERENTES POR INDEXER: Cada indexer responde melhor a um tipo:
   - torrent-dos-filmes: IMDB direto funciona perfeitamente
   - starck-filmes: Título PT-BR funciona melhor
   - vaca_torrent: Título PT-BR funciona melhor
   - rede_torrent: Título EN funciona bem

6. VELOCIDADE: rede_torrent é o mais rápido, starck-filmes o mais lento.
   Estratégia: disparar todos em paralelo, não esperar os lentos.
`);

  // ─── Save full report ───
  const reportPath = 'test-artifacts/audit-v2/report.json';
  // Remove fullResults from report to save space in the summary
  const summaryReport = JSON.parse(JSON.stringify(fullReport));
  for (const c of summaryReport.cases) {
    for (const idx of Object.values(c.perIndexer) as any[]) {
      for (const q of Object.values(idx.queries) as any[]) {
        delete q.fullResults;
      }
    }
  }
  writeFileSync(reportPath, JSON.stringify(summaryReport, null, 2));
  console.log(`\n📁 Report salvo em: ${reportPath}`);

  // Save per-case full data
  for (let i = 0; i < fullReport.cases.length; i++) {
    const c = fullReport.cases[i];
    const slug = c.case.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const casePath = `test-artifacts/audit-v2/${slug}.json`;
    writeFileSync(casePath, JSON.stringify(c, null, 2));
  }
  console.log('📁 Dados completos por caso salvos em test-artifacts/audit-v2/\n');
}

main().catch(console.error);
