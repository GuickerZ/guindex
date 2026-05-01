import { request } from 'undici';
import child_process from 'child_process';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 7000}`;
const ARTIFACT_DIR = path.resolve('test-artifacts');
const MIDPATCH_IDS = (process.env.MIDPATCH_IDS || '').trim();
const MIDPATCH_MAX_MS = Number(process.env.MIDPATCH_MAX_MS || 15000);

const DEFAULT_IDS = [
  'tt0111161:movie', // The Shawshank Redemption
  'tt0137523:movie', // Fight Club
  'tt0816692:movie', // Interstellar
  'tt0944947:series', // Game of Thrones
  'tt0903747:series', // Breaking Bad
  'tt1475582:series'  // True Detective
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkHealth() {
  try {
    const url = `${BASE_URL.replace(/\/$/, '')}/health`;
    const res = await request(url, { signal: AbortSignal.timeout(3000) });
    return res.statusCode >= 200 && res.statusCode < 500;
  } catch (e) {
    return false;
  }
}

async function ensureServerRunning() {
  if (await checkHealth()) {
    return { started: false, pid: null };
  }

  console.log('[midpatch] Servidor nao detectado — iniciando dist/server.js em background...');
  const child = child_process.spawn(process.execPath, ['dist/server.js'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  const started = await waitForHealth(15000);
  if (!started) {
    throw new Error('Servidor nao respondeu em /health apos iniciar dist/server.js');
  }
  return { started: true, pid: child.pid };
}

async function waitForHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth()) return true;
    await sleep(500);
  }
  return false;
}

async function runTestForId(idWithType) {
  const [rawId, maybeType] = idWithType.split(':');
  const type = maybeType || (rawId.startsWith('tt') ? 'movie' : 'movie');
  const id = rawId;
  const url = `${BASE_URL.replace(/\/$/, '')}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json?fresh=1&_nocache=${Date.now()}`;

  const start = Date.now();
  let res;
  try {
    res = await request(url, { signal: AbortSignal.timeout(60_000), headers: { Accept: 'application/json' } });
  } catch (err) {
    return { id: idWithType, ok: false, error: String(err), durationMs: Date.now() - start };
  }
  const headersReceivedAt = Date.now();
  let payload;
  try {
    payload = await res.body.text();
  } catch (err) {
    return { id: idWithType, ok: false, error: 'Failed to read body: ' + String(err), durationMs: Date.now() - start, headersMs: headersReceivedAt - start };
  }

  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    parsed = { parseError: String(err) };
  }

  const duration = Date.now() - start;
  const size = Buffer.byteLength(payload, 'utf8');
  const streamsCount = Array.isArray(parsed?.streams) ? parsed.streams.length : 0;
  const firstStreams = Array.isArray(parsed?.streams) ? parsed.streams.slice(0, 4).map(s => s.name || s.title || s.url) : [];
  const withinBudget = duration <= MIDPATCH_MAX_MS;

  return {
    id: idWithType,
    ok: true,
    statusCode: res.statusCode,
    durationMs: duration,
    headersMs: headersReceivedAt - start,
    sizeBytes: size,
    streamsCount,
    firstStreams,
    withinBudget,
    budgetMs: MIDPATCH_MAX_MS
  };
}

async function main() {
  try {
    if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

    const { started } = await ensureServerRunning();
    if (started) {
      console.log('[midpatch] Servidor iniciado com sucesso.');
    } else {
      console.log('[midpatch] Servidor ja estava ativo.');
    }

    const rawList = MIDPATCH_IDS ? MIDPATCH_IDS.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_IDS;
    const results = [];

    for (const id of rawList) {
      console.log(`[midpatch] Testando ${id} ...`);
      const r = await runTestForId(id);
      console.log(`[midpatch] Resultado: ${r.ok ? 'OK' : 'FAIL'}; ${r.durationMs}ms; streams=${r.streamsCount || 0}; budget=${MIDPATCH_MAX_MS}ms; dentro=${r.withinBudget !== false}`);
      results.push(r);
      // pequeno delay entre requisições para nao sobrecarregar indexers
      await sleep(600);
    }

    const outPath = path.join(ARTIFACT_DIR, `midpatch-timings-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ baseUrl: BASE_URL, startedAt: new Date().toISOString(), results }, null, 2), 'utf8');
    console.log(`[midpatch] Resultados salvos em: ${outPath}`);

    const failures = results.filter((result) => !result.ok || result.withinBudget === false || result.streamsCount === 0);
    if (failures.length > 0) {
      console.error(`[midpatch] Falha de SLA em ${failures.length} item(ns). Ajuste o budget ou otimize o cold path.`);
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('[midpatch] Erro:', err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

main();
