/**
 * Torrent Indexer Source Provider
 */

import { request } from 'undici';
import { BaseSourceProvider, type SourceFetchOptions } from './base-source-provider.js';
import { RealDebridService } from './realdebrid-service.js';
import { TorboxService } from './torbox-service.js';
import type { SourceStream, StreamContext } from '../models/source-model.js';

interface ParsedIdInfo {
  imdbId?: string;
  query?: string;
  season?: number;
  episode?: number;
}

interface CinemetaVideo {
  season?: number | string;
  episode?: number | string;
  title?: string;
  name?: string;
}

interface CinemetaMeta {
  id?: string;
  name?: string;
  title?: string;
  originalTitle?: string;
  year?: number;
  releaseInfo?: string;
  aliases?: string[];
  alternativeTitles?: string[];
  alternative_titles?: string[];
  aka?: string[];
  videos?: CinemetaVideo[];
  translations?: Record<string, unknown>;
  infos?: Record<string, unknown>;
  [key: string]: unknown;
}

type TorrentLike = Record<string, unknown>;

interface IndexedTorrentFile {
  path: string;
  size?: number;
  originalIndex: number;
}

type IndexerQueryProfile = {
  supportsImdbQuery: boolean;
};

interface SearchCacheEntry {
  ts: number;
  data: TorrentLike[];
}

interface LocalizedTitleCacheEntry {
  ts: number;
  titles: string[];
}

interface IndexerFailureState {
  consecutiveFailures: number;
  cooldownUntil: number;
}

interface IndexerPerformanceEntry {
  avgMs: number;
  samples: number;
  hits: number;
  emptyHits: number;
  lastDurationMs: number;
  lastSeenAt: number;
}

interface FallbackSearchOptions {
  excludeIndexers?: Set<string>;
  maxIndexers?: number;
  perIndexerLimit?: number;
  targetResults?: number;
}

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const parseNonNegativeInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

const normalizeIndexerValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]+/g, '');

const parseCsvSet = (value: string | undefined, defaults: string[] = []): Set<string> => {
  const raw = value ?? defaults.join(',');
  const out = new Set<string>();
  for (const item of raw.split(',')) {
    const normalized = normalizeIndexerValue(item);
    if (normalized) {
      out.add(normalized);
    }
  }
  return out;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const readEnv = (primary: string, legacy?: string): string | undefined => {
  const primaryValue = process.env[primary];
  if (primaryValue !== undefined) {
    return primaryValue;
  }

  if (legacy) {
    return process.env[legacy];
  }

  return undefined;
};

const MAX_STREAMS = 120;
const TARGET_STREAMS_PER_REQUEST = parsePositiveInt(
  process.env.TORRENT_INDEXER_TARGET_STREAMS,
  12,
);
const MAX_DYNAMIC_QUERIES = parsePositiveInt(
  process.env.TORRENT_INDEXER_MAX_DYNAMIC_QUERIES,
  10,
);
const MAX_SEARCH_TIME_MS = parsePositiveInt(
  process.env.TORRENT_INDEXER_MAX_QUERY_TIME_MS,
  25_000,
);
const MAX_STREAMS_PER_SOURCE = parsePositiveInt(
  process.env.TORRENT_INDEXER_MAX_STREAMS_PER_SOURCE,
  50,
);
const MAX_TEXT_QUERIES = 6;
const INDEXER_QUERY_PROFILES: Record<string, IndexerQueryProfile> = {
  'comando_torrents': { supportsImdbQuery: false },
  bludv: { supportsImdbQuery: false },
  filme_torrent: { supportsImdbQuery: false },
  'starck-filmes': { supportsImdbQuery: false },
  vaca_torrent: { supportsImdbQuery: false },
  rede_torrent: { supportsImdbQuery: false },
};
const EPISODIC_HINT_REGEX =
  /(S[0-9]{1,3}(E[0-9]{1,3})?|S[0-9]{1,3}[._ -]?(19|20)[0-9]{2}|[0-9]+[xÃ—][0-9]+|temporadas?|season|seasons|temp\.?\s*\d|epis[oÃ³]dios?|epis[oÃ³]dio|episode|episodes|serie|sÃ©rie|sÃ©ries|series|minissÃ©rie|mini[\s-]?s[eÃ©]rie|ep\.?\s*[0-9]+|cap[iÃ­]tulo|capitulo|cap\.?\s*[0-9]+|completa|completo|complete|collection|cole[Ã§c][aÃ£]o|box\s*set|pack|integral|[0-9]+[ÂªÂºa]\s*temp)/i;

const LANGUAGE_FLAG_MAP: Record<string, string> = {
  portugues: 'ðŸ‡§ðŸ‡·',
  portuguese: 'ðŸ‡§ðŸ‡·',
  'brazilian portuguese': 'ðŸ‡§ðŸ‡·',
  ingles: 'ðŸ‡ºðŸ‡¸',
  english: 'ðŸ‡ºðŸ‡¸',
  espanhol: 'ðŸ‡ªðŸ‡¸',
  spanish: 'ðŸ‡ªðŸ‡¸',
  frances: 'ðŸ‡«ðŸ‡·',
  french: 'ðŸ‡«ðŸ‡·',
  italiano: 'ðŸ‡®ðŸ‡¹',
  italian: 'ðŸ‡®ðŸ‡¹',
  alemao: 'ðŸ‡©ðŸ‡ª',
  german: 'ðŸ‡©ðŸ‡ª',
  japones: 'ðŸ‡¯ðŸ‡µ',
  japanese: 'ðŸ‡¯ðŸ‡µ',
  coreano: 'ðŸ‡°ðŸ‡·',
  korean: 'ðŸ‡°ðŸ‡·',
  chines: 'ðŸ‡¨ðŸ‡³',
  chinese: 'ðŸ‡¨ðŸ‡³',
  mandarim: 'ðŸ‡¨ðŸ‡³',
  mandarin: 'ðŸ‡¨ðŸ‡³',
  cantones: 'ðŸ‡­ðŸ‡°',
  cantonese: 'ðŸ‡­ðŸ‡°',
  russo: 'ðŸ‡·ðŸ‡º',
  russian: 'ðŸ‡·ðŸ‡º',
  hindi: 'ðŸ‡®ðŸ‡³',
  arabe: 'ðŸ‡¸ðŸ‡¦',
  arabic: 'ðŸ‡¸ðŸ‡¦',
  turco: 'ðŸ‡¹ðŸ‡·',
  turkish: 'ðŸ‡¹ðŸ‡·',
  polones: 'ðŸ‡µðŸ‡±',
  polish: 'ðŸ‡µðŸ‡±',
  sueco: 'ðŸ‡¸ðŸ‡ª',
  swedish: 'ðŸ‡¸ðŸ‡ª',
  noruegues: 'ðŸ‡³ðŸ‡´',
  norwegian: 'ðŸ‡³ðŸ‡´',
  dinamarques: 'ðŸ‡©ðŸ‡°',
  danish: 'ðŸ‡©ðŸ‡°',
  finlandes: 'ðŸ‡«ðŸ‡®',
  finnish: 'ðŸ‡«ðŸ‡®',
  tcheco: 'ðŸ‡¨ðŸ‡¿',
  czech: 'ðŸ‡¨ðŸ‡¿',
  hungaro: 'ðŸ‡­ðŸ‡º',
  hungarian: 'ðŸ‡­ðŸ‡º',
  ucraniano: 'ðŸ‡ºðŸ‡¦',
  ukrainian: 'ðŸ‡ºðŸ‡¦',
  tailandes: 'ðŸ‡¹ðŸ‡­',
  thai: 'ðŸ‡¹ðŸ‡­',
  vietnamita: 'ðŸ‡»ðŸ‡³',
  vietnamese: 'ðŸ‡»ðŸ‡³',
  holandes: 'ðŸ‡³ðŸ‡±',
  dutch: 'ðŸ‡³ðŸ‡±',
  grego: 'ðŸ‡¬ðŸ‡·',
  greek: 'ðŸ‡¬ðŸ‡·',
  hebraico: 'ðŸ‡®ðŸ‡±',
  hebrew: 'ðŸ‡®ðŸ‡±',
  romeno: 'ðŸ‡·ðŸ‡´',
  romanian: 'ðŸ‡·ðŸ‡´',
  bulgaro: 'ðŸ‡§ðŸ‡¬',
  bulgarian: 'ðŸ‡§ðŸ‡¬',
  croata: 'ðŸ‡­ðŸ‡·',
  croatian: 'ðŸ‡­ðŸ‡·',
  islandes: 'ðŸ‡®ðŸ‡¸',
  icelandic: 'ðŸ‡®ðŸ‡¸',
  persa: 'ðŸ‡®ðŸ‡·',
  persian: 'ðŸ‡®ðŸ‡·',
  farsi: 'ðŸ‡®ðŸ‡·',
  latin: 'ðŸ‡»ðŸ‡¦',
  latim: 'ðŸ‡»ðŸ‡¦',
};

const LANGUAGE_ALIASES: Record<string, string> = {
  portuguese: 'Portuguese',
  portugues: 'Portuguese',
  'pt-br': 'Portuguese',
  'pt br': 'Portuguese',
  ptbr: 'Portuguese',
  brazilian: 'Portuguese',
  'brazilian portuguese': 'Portuguese',
  dublado: 'Portuguese',
  dublada: 'Portuguese',
  english: 'English',
  ingles: 'English',
  eng: 'English',
  en: 'English',
  spanish: 'Spanish',
  espanhol: 'Spanish',
  espanol: 'Spanish',
  spa: 'Spanish',
  es: 'Spanish',
  castellano: 'Spanish',
  latino: 'Spanish',
  french: 'French',
  frances: 'French',
  fre: 'French',
  fra: 'French',
  fr: 'French',
  italian: 'Italian',
  italiano: 'Italian',
  ita: 'Italian',
  it: 'Italian',
  german: 'German',
  alemao: 'German',
  ger: 'German',
  deu: 'German',
  de: 'German',
  japanese: 'Japanese',
  japones: 'Japanese',
  jpn: 'Japanese',
  ja: 'Japanese',
  korean: 'Korean',
  coreano: 'Korean',
  kor: 'Korean',
  ko: 'Korean',
  chinese: 'Chinese',
  chines: 'Chinese',
  mandarim: 'Chinese',
  mandarin: 'Chinese',
  chi: 'Chinese',
  zho: 'Chinese',
  zh: 'Chinese',
  cantonese: 'Cantonese',
  cantones: 'Cantonese',
  russian: 'Russian',
  russo: 'Russian',
  rus: 'Russian',
  ru: 'Russian',
  hindi: 'Hindi',
  hin: 'Hindi',
  hi: 'Hindi',
  arabic: 'Arabic',
  arabe: 'Arabic',
  turkish: 'Turkish',
  turco: 'Turkish',
  polish: 'Polish',
  polones: 'Polish',
  swedish: 'Swedish',
  sueco: 'Swedish',
  norwegian: 'Norwegian',
  noruegues: 'Norwegian',
  danish: 'Danish',
  dinamarques: 'Danish',
  finnish: 'Finnish',
  finlandes: 'Finnish',
  czech: 'Czech',
  tcheco: 'Czech',
  hungarian: 'Hungarian',
  hungaro: 'Hungarian',
  ukrainian: 'Ukrainian',
  ucraniano: 'Ukrainian',
  thai: 'Thai',
  tailandes: 'Thai',
  vietnamese: 'Vietnamese',
  vietnamita: 'Vietnamese',
  dutch: 'Dutch',
  holandes: 'Dutch',
  greek: 'Greek',
  grego: 'Greek',
  hebrew: 'Hebrew',
  hebraico: 'Hebrew',
  romanian: 'Romanian',
  romeno: 'Romanian',
  bulgarian: 'Bulgarian',
  bulgaro: 'Bulgarian',
  croatian: 'Croatian',
  croata: 'Croatian',
  icelandic: 'Icelandic',
  islandes: 'Icelandic',
  persian: 'Persian',
  persa: 'Persian',
  farsi: 'Persian',
  latin: 'Latin',
  latim: 'Latin',
  nacional: 'Portuguese',
  'audio nacional': 'Portuguese',
  dub: 'Portuguese',
  'audio original': 'English',
};

interface MatchContext {
  parsed: ParsedIdInfo;
  type: string;
  targetTitles: string[];
  releaseYear?: number;
  episodeTitle?: string;
}

export class TorrentIndexerProvider extends BaseSourceProvider {
  private readonly baseUrl: string;

  /** In-memory Cinemeta cache (shared across instances) */
  private static cinemetaCache = new Map<string, { data: CinemetaMeta; ts: number }>();
  private static readonly CINEMETA_TTL = 5 * 60 * 1000; // 5 min
  private static searchCache = new Map<string, SearchCacheEntry>();
  private static localizedTitleCache = new Map<string, LocalizedTitleCacheEntry>();
  private static indexerNamesCache:
    | { ts: number; names: string[] }
    | undefined;
  private static readonly SEARCH_CACHE_TTL_MS = parsePositiveInt(
    process.env.TORRENT_INDEXER_SEARCH_CACHE_TTL_MS,
    120_000,
  );
  private static readonly INDEXER_NAMES_CACHE_TTL_MS = parsePositiveInt(
    process.env.TORRENT_INDEXER_INDEXERS_CACHE_TTL_MS,
    600_000,
  );
  private static readonly LOCALIZED_TITLE_CACHE_TTL_MS = parsePositiveInt(
    process.env.TORRENT_INDEXER_LOCALIZED_TITLE_CACHE_TTL_MS,
    7 * 24 * 60 * 60 * 1000,
  );
  private static readonly TMDB_TIMEOUT_MS = parsePositiveInt(
    process.env.TORRENT_INDEXER_TMDB_TIMEOUT_MS,
    5000,
  );
  private static readonly TMDB_API_READ_ACCESS_TOKEN = readEnv(
    'TMDB_API_READ_ACCESS_TOKEN',
    'TMDB_READ_ACCESS_TOKEN',
  );
  private static readonly TMDB_API_KEY = readEnv('TMDB_API_KEY');
  private static readonly ENABLE_FALLBACK_INDEXER_SEARCH = parseBoolean(
    process.env.TORRENT_INDEXER_ENABLE_FALLBACK,
    true,
  );
  private static readonly FALLBACK_MAX_INDEXERS = parseNonNegativeInt(
    process.env.TORRENT_INDEXER_FALLBACK_MAX_INDEXERS,
    0,
  );
  private static readonly FALLBACK_PER_INDEXER_LIMIT = parsePositiveInt(
    process.env.TORRENT_INDEXER_FALLBACK_PER_INDEXER_LIMIT,
    0,
  );
  private static readonly FALLBACK_INDEXER_CONCURRENCY = parsePositiveInt(
    process.env.TORRENT_INDEXER_FALLBACK_CONCURRENCY,
    5,
  );
  private static readonly FALLBACK_REQUEST_TIMEOUT_MS = parsePositiveInt(
    process.env.TORRENT_INDEXER_FALLBACK_TIMEOUT_MS,
    12000,
  );
  private static readonly HYBRID_MIN_RESULTS = parsePositiveInt(
    process.env.TORRENT_INDEXER_HYBRID_MIN_RESULTS,
    10,
  );
  private static readonly HYBRID_MIN_INDEXERS = parsePositiveInt(
    process.env.TORRENT_INDEXER_HYBRID_MIN_INDEXERS,
    2,
  );
  private static readonly HYBRID_TARGET_RESULTS = parsePositiveInt(
    process.env.TORRENT_INDEXER_HYBRID_TARGET_RESULTS,
    24,
  );
  private static readonly DISABLED_INDEXERS = parseCsvSet(
    readEnv('TORRENT_INDEXER_DISABLED_INDEXERS'),
    ['comando_torrents'],
  );
  private static readonly INDEXER_FAILURE_THRESHOLD = parsePositiveInt(
    readEnv('TORRENT_INDEXER_FAILURE_THRESHOLD', 'TORRENT_INDEXER_INDEXER_FAILURE_THRESHOLD'),
    2,
  );
  private static readonly INDEXER_FAILURE_COOLDOWN_MS = parsePositiveInt(
    readEnv('TORRENT_INDEXER_FAILURE_COOLDOWN_MS', 'TORRENT_INDEXER_INDEXER_FAILURE_COOLDOWN_MS'),
    900_000,
  );
  private static readonly indexerPerformance = new Map<string, IndexerPerformanceEntry>();
  private static readonly indexerFailureState = new Map<string, IndexerFailureState>();

  constructor(name: string, baseUrl: string) {
    super(name);
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getStreams(
    type: string,
    id: string,
    options?: SourceFetchOptions
  ): Promise<SourceStream[]> {
    const parsed = this.parseId(id);
    const metaLookupId = parsed.imdbId ?? parsed.query ?? (id || '').split(':')[0] ?? id;
    const meta = await this.fetchCinemetaMeta(type, metaLookupId);
    const displayTitles = this.collectMetaTitles(meta);
    if (parsed.imdbId) {
      const localizedTitles = await this.fetchLocalizedTitleCandidates(parsed.imdbId);
      for (const title of localizedTitles) {
        if (!displayTitles.includes(title)) {
          displayTitles.push(title);
        }
      }
    }

    if (parsed.query && !displayTitles.includes(parsed.query)) {
      displayTitles.push(parsed.query);
    }

    const targetTitle = displayTitles[0];
    const releaseYear = this.extractReleaseYear(meta);
    const episodeTitle =
      parsed.season !== undefined && parsed.episode !== undefined
        ? this.findEpisodeTitle(meta, parsed.season, parsed.episode)
        : undefined;

    const imdbQuery = parsed.imdbId;
    const textQuery = this.buildTextQuery(type, parsed, targetTitle, releaseYear, episodeTitle);
    const textQueries = this.buildTextQueryCandidates(type, parsed, displayTitles, releaseYear, episodeTitle);

    const queries: string[] = [];
    if (imdbQuery) {
      queries.push(imdbQuery);
    }
    // For series, add an S-code query (e.g. "Better Call Saul S02E01") which
    // tends to return better results from Brazilian indexers than the textual form.
    if (type.toLowerCase() !== 'movie' && parsed.season !== undefined && targetTitle) {
      const sPad = String(parsed.season).padStart(2, '0');
      const eCode = parsed.episode !== undefined
        ? `E${String(parsed.episode).padStart(2, '0')}` : '';
      const sCodeQuery = `${targetTitle} S${sPad}${eCode}`;
      if (!queries.includes(sCodeQuery)) {
        queries.push(sCodeQuery);
      }
    }
    if (textQuery && !queries.includes(textQuery)) {
      queries.push(textQuery);
    }
    for (const q of textQueries) {
      if (!queries.includes(q)) {
        queries.push(q);
      }
    }

    if (queries.length === 0) {
      return [];
    }

    const context: MatchContext = {
      parsed,
      type,
      targetTitles: displayTitles,
    };
    if (releaseYear !== undefined) {
      context.releaseYear = releaseYear;
    }
    if (episodeTitle !== undefined) {
      context.episodeTitle = episodeTitle;
    }

    const seen = new Set<string>();
    const streams: SourceStream[] = [];
    const sourceCounts = new Map<string, number>();
    const searchStartedAt = Date.now();
    let attemptedQueries = 0;
    let remainingDynamicQueries = MAX_DYNAMIC_QUERIES;

    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      const query = queries[queryIndex] ?? '';
      if (!query) {
        continue;
      }

      attemptedQueries += 1;
      if (
        Date.now() - searchStartedAt >= MAX_SEARCH_TIME_MS &&
        (streams.length > 0 || attemptedQueries > 2)
      ) {
        break;
      }

      const torrents = this.rankTorrentsByQuery(await this.fetchSearchResults(query), query);

      if (remainingDynamicQueries > 0 && streams.length < TARGET_STREAMS_PER_REQUEST) {
        const dynamicQueries = this.collectDynamicQueryCandidates(
          type,
          parsed,
          torrents,
          releaseYear,
          episodeTitle,
        );

        for (const dynamicQuery of dynamicQueries) {
          if (remainingDynamicQueries <= 0) {
            break;
          }
          if (!queries.includes(dynamicQuery)) {
            queries.push(dynamicQuery);
            remainingDynamicQueries -= 1;
          }
        }
      }

      for (const torrent of torrents) {
        if (!this.isRelevantTorrent(torrent, context)) {
          continue;
        }

        const stream = this.mapTorrentToStream(torrent, targetTitle ?? query, context);
        if (!stream) {
          continue;
        }

        const dedupeKey = this.getDedupeKey(stream);
        if (dedupeKey && seen.has(dedupeKey)) {
          continue;
        }

        const sourceKey = (stream.source ?? 'unknown').toLowerCase();
        const sourceCount = sourceCounts.get(sourceKey) ?? 0;
        if (sourceCount >= MAX_STREAMS_PER_SOURCE) {
          continue;
        }

        streams.push(stream);
        sourceCounts.set(sourceKey, sourceCount + 1);
        if (dedupeKey) {
          seen.add(dedupeKey);
        }

        if (streams.length >= MAX_STREAMS) {
          return streams;
        }
      }

      if (streams.length >= TARGET_STREAMS_PER_REQUEST && sourceCounts.size >= 2) {
        break;
      }
    }

    if (streams.length === 0) {
      return streams;
    }

    await this.decorateWithDebrid(streams, options);

    return streams;
  }

  private getDedupeKey(stream: SourceStream): string | undefined {
    let base: string | undefined;
    if (stream.infoHash) {
      base = stream.infoHash.toLowerCase();
    } else if (stream.magnet) {
      const infoHash = this.extractInfoHash(stream.magnet);
      base = infoHash ? infoHash.toLowerCase() : stream.magnet;
    }
    if (!base) return undefined;
    // Include fileIdx so different episodes from the same torrent pack aren't deduplicated
    return stream.fileIdx !== undefined && stream.fileIdx >= 0
      ? `${base}:${stream.fileIdx}`
      : base;
  }

  private async decorateWithDebrid(
    streams: SourceStream[],
    options?: SourceFetchOptions
  ): Promise<void> {
    const hashToStreams = new Map<string, SourceStream[]>();

    for (const stream of streams) {
      const hash = this.getStreamInfoHash(stream);
      if (!hash) {
        stream.cached = false;
        continue;
      }

      const normalized = hash.toLowerCase();
      if (!hashToStreams.has(normalized)) {
        hashToStreams.set(normalized, []);
      }
      hashToStreams.get(normalized)!.push(stream);
    }

    if (hashToStreams.size === 0) {
      return;
    }

    let cachedHashes = new Set<string>();
    try {
      cachedHashes = await this.fetchDebridCachedHashes([...hashToStreams.keys()], options);
    } catch {
      cachedHashes = new Set<string>();
    }

    const badgeProvider =
      options?.debridProvider ?? (options?.torboxToken && !options?.realdebridToken ? 'torbox' : 'realdebrid');

    for (const [hash, relatedStreams] of hashToStreams.entries()) {
      const isCached = cachedHashes.has(hash);
      for (const s of relatedStreams) {
        s.cached = isCached;
        if (isCached) {
          this.applyDebridBadge(s, badgeProvider);
        }
      }
    }
  }

  private async fetchDebridCachedHashes(
    hashes: string[],
    options?: SourceFetchOptions
  ): Promise<Set<string>> {
    const provider = options?.debridProvider;
    const rdToken = options?.realdebridToken;
    const tbToken = options?.torboxToken;

    if (provider === 'torbox') {
      return TorboxService.fetchCachedInfoHashes(hashes, tbToken);
    }

    if (provider === 'realdebrid') {
      return RealDebridService.fetchCachedInfoHashes(hashes, rdToken);
    }

    if (tbToken) {
      return TorboxService.fetchCachedInfoHashes(hashes, tbToken);
    }

    if (rdToken) {
      return RealDebridService.fetchCachedInfoHashes(hashes, rdToken);
    }

    return new Set<string>();
  }
  private getStreamInfoHash(stream: SourceStream): string | undefined {
    if (typeof stream.infoHash === 'string' && stream.infoHash.trim()) {
      return stream.infoHash.trim().toLowerCase();
    }

    if (typeof stream.magnet === 'string' && stream.magnet.startsWith('magnet:')) {
      const extracted = this.extractInfoHash(stream.magnet);
      if (extracted) {
        return extracted.toLowerCase();
      }
    }

    return undefined;
  }

  private applyDebridBadge(stream: SourceStream, provider: 'realdebrid' | 'torbox'): void {
    if (!stream) return;

    const providerLabel = provider === 'torbox' ? 'TB' : 'RD';
    const providerName = provider === 'torbox' ? 'Torbox' : 'Real-Debrid';
  
    // name: adiciona "âš¡ RD+" na primeira linha (substitui/remenda RD existente)
    if (typeof stream.name === 'string' && stream.name.length > 0) {
      const nameLines = stream.name.split('\n');
      const firstLine = nameLines[0] ?? '';
  
      // remove marcas antigas
      let cleaned = firstLine
        .replace(/\[RD\]/gi, '')
        .replace(/RD\+/gi, '')
        .replace(/\bRD\b/gi, '')
        .replace(/\[TB\]/gi, '')
        .replace(/TB\+/gi, '')
        .replace(/\bTB\b/gi, '')
        .trim();
  
      // prefixa com âš¡ RD+/TB+
      nameLines[0] = `âš¡ ${providerLabel}+ ${cleaned}`.trim();
  
      stream.name = nameLines.join('\n');
    }
  
    // title: adiciona [RD+]/[TB+] e linha "DisponÃ­vel no ..." se necessÃ¡rio
    if (typeof stream.title === 'string' && stream.title.length > 0) {
      const titleLines = stream.title.split('\n');
      const firstLine = titleLines[0] ?? '';
  
      const badgeRegex = /\[(RD|TB)\+\]/i;
      if (!badgeRegex.test(firstLine)) {
        titleLines[0] = `${firstLine} [${providerLabel}+]`.trim();
      }
  
      if (!titleLines.some((line) => new RegExp(`Dispon[iÃ­]vel no ${providerName}`, 'i').test(line))) {
        titleLines.push(`DisponÃ­vel no ${providerName}`);
      }
  
      stream.title = titleLines.join('\n');
    }
  }
  

  private async fetchSearchResults(query: string): Promise<TorrentLike[]> {
    const cacheKey = this.getSearchCacheKey(query);
    const cached = TorrentIndexerProvider.searchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TorrentIndexerProvider.SEARCH_CACHE_TTL_MS) {
      return cached.data;
    }

    // Always run /search AND /indexers in parallel for maximum coverage.
    // /search (Meilisearch) only returns cached results from previous queries.
    // /indexers/{name} scrapes each source live and finds content not yet cached.
    const searchPromise = (async (): Promise<TorrentLike[]> => {
      const url = new URL(`${this.baseUrl}/search`);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '200');
      try {
        const response = await request(url.toString(), {
          signal: AbortSignal.timeout(TorrentIndexerProvider.FALLBACK_REQUEST_TIMEOUT_MS),
          headers: { Accept: 'application/json' },
        });
        if (response.statusCode >= 400) return [];
        const payload = await response.body.json();
        return this.normalizeTorrentPayload(payload);
      } catch {
        return [];
      }
    })();

    const indexersPromise = this.fetchSearchResultsFromIndexers(query);

    const [searchResults, indexerResults] = await Promise.all([searchPromise, indexersPromise]);
    const merged = this.rankTorrentsByQuery(
      this.mergeTorrentResults(searchResults, indexerResults),
      query,
    );

    TorrentIndexerProvider.searchCache.set(cacheKey, { ts: Date.now(), data: merged });
    return merged;
  }

  private async fetchSearchResultsWithRetry(
    query: string,
    options?: FallbackSearchOptions,
  ): Promise<TorrentLike[]> {
    const variants = this.buildSearchRetryQueries(query);
    let merged: TorrentLike[] = [];

    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i];
      if (!variant) {
        continue;
      }
      const results = await this.fetchSearchResultsFromIndexers(variant, {
        ...options,
      });
      merged = this.mergeTorrentResults(merged, results);

      const reachedTarget =
        options?.targetResults !== undefined && merged.length >= options.targetResults;
      const foundStrongMatch = this.hasStrongQueryMatch(merged, query);
      if (reachedTarget || foundStrongMatch) {
        break;
      }
    }

    return this.rankTorrentsByQuery(merged, query);
  }

  private async fetchSearchResultsFromIndexers(
    query: string,
    options?: FallbackSearchOptions,
  ): Promise<TorrentLike[]> {
    if (!TorrentIndexerProvider.ENABLE_FALLBACK_INDEXER_SEARCH) {
      return [];
    }

    const indexers = await this.fetchIndexerNames();
    if (indexers.length === 0) {
      return [];
    }

    const configuredMax = TorrentIndexerProvider.FALLBACK_MAX_INDEXERS;
    const defaultMaxIndexers = configuredMax > 0
      ? Math.min(configuredMax, indexers.length)
      : indexers.length;
    const maxIndexers = options?.maxIndexers ?? defaultMaxIndexers;
    const perIndexerLimit =
      options?.perIndexerLimit ?? TorrentIndexerProvider.FALLBACK_PER_INDEXER_LIMIT;
    const excluded = options?.excludeIndexers;

    const selected = indexers
      .filter((name) => {
        if (this.shouldSkipIndexer(name)) {
          return false;
        }
        if (!excluded || excluded.size === 0) {
          return true;
        }
        const normalized = this.normalizeIndexerSlug(name);
        return !excluded.has(normalized);
      })
      .sort((a, b) => this.compareIndexerPriority(a, b))
      .slice(0, maxIndexers);

    if (selected.length === 0) {
      return [];
    }

    const settled: PromiseSettledResult<TorrentLike[]>[] = [];
    for (let i = 0; i < selected.length; i += TorrentIndexerProvider.FALLBACK_INDEXER_CONCURRENCY) {
      const batch = selected.slice(i, i + TorrentIndexerProvider.FALLBACK_INDEXER_CONCURRENCY);
      const batchSettled = await Promise.allSettled(
        batch.map((name) =>
          this.fetchSingleIndexerSearch(
            name,
            query,
            perIndexerLimit,
          ),
        ),
      );
      settled.push(...batchSettled);
    }

    const merged: TorrentLike[] = [];
    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value.length > 0) {
        merged.push(...item.value);
      }
    }

    return this.rankTorrentsByQuery(merged, query);
  }

  private async fetchIndexerNames(): Promise<string[]> {
    const cached = TorrentIndexerProvider.indexerNamesCache;
    if (
      cached &&
      Date.now() - cached.ts < TorrentIndexerProvider.INDEXER_NAMES_CACHE_TTL_MS &&
      cached.names.length > 0
    ) {
      return cached.names;
    }

    const url = `${this.baseUrl}/sources`;
    try {
      const response = await request(url, {
        signal: AbortSignal.timeout(7000),
        headers: { Accept: 'application/json' },
      });
      if (response.statusCode >= 400) {
        return [];
      }

      const payload = (await response.body.json()) as Record<string, unknown>;
      const names = payload?.indexer_names;
      if (!Array.isArray(names)) {
        return [];
      }

      const parsedNames = names
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
        .filter((name) => !this.shouldSkipIndexer(name));
      const sorted = [...parsedNames].sort((a, b) => this.compareIndexerPriority(a, b));
      TorrentIndexerProvider.indexerNamesCache = {
        ts: Date.now(),
        names: sorted,
      };
      return sorted;
    } catch {
      return [];
    }
  }

  private getSearchCacheKey(query: string): string {
    return `${this.baseUrl}|${query.trim().toLowerCase()}`;
  }

  private async fetchSingleIndexerSearch(
    indexerName: string,
    query: string,
    limit: number,
  ): Promise<TorrentLike[]> {
    const normalizedIndexer = indexerName.trim().toLowerCase();
    if (this.shouldSkipIndexer(normalizedIndexer)) {
      return [];
    }

    const profile = INDEXER_QUERY_PROFILES[normalizedIndexer];
    const isImdbQuery = /^tt\d+$/i.test(query.trim());
    if (isImdbQuery && profile && !profile.supportsImdbQuery) {
      return [];
    }

    const startedAt = Date.now();
    const url = new URL(`${this.baseUrl}/indexers/${encodeURIComponent(indexerName)}`);
    url.searchParams.set('q', query);
    if (limit > 0) {
      url.searchParams.set('limit', String(limit));
    }

    try {
      const response = await request(url.toString(), {
        signal: AbortSignal.timeout(TorrentIndexerProvider.FALLBACK_REQUEST_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (response.statusCode >= 500) {
        this.recordIndexerFailure(normalizedIndexer);
        this.recordIndexerPerformance(normalizedIndexer, Date.now() - startedAt, 0);
        return [];
      }
      if (response.statusCode >= 400) {
        this.recordIndexerPerformance(normalizedIndexer, Date.now() - startedAt, 0);
        return [];
      }

      const payload = await response.body.json();
      const results = this.normalizeTorrentPayload(payload);
      this.clearIndexerFailure(normalizedIndexer);
      this.recordIndexerPerformance(normalizedIndexer, Date.now() - startedAt, results.length);
      return results;
    } catch {
      this.recordIndexerFailure(normalizedIndexer);
      this.recordIndexerPerformance(normalizedIndexer, Date.now() - startedAt, 0);
      return [];
    }
  }

  private buildSearchRetryQueries(query: string): string[] {
    const base = this.sanitizeQuery(query);
    if (!base) {
      return [query];
    }

    const variants: string[] = [];
    const add = (value?: string) => {
      if (!value) {
        return;
      }
      const cleaned = this.sanitizeQuery(value);
      if (!cleaned) {
        return;
      }
      if (!variants.includes(cleaned)) {
        variants.push(cleaned);
      }
    };

    add(base);

    if (!/^tt\d+$/i.test(base)) {
      const withoutEpisode = base
        .replace(/\bS\d{1,3}E\d{1,3}\b/gi, ' ')
        .replace(/\b\d{1,3}x\d{1,3}\b/gi, ' ')
        .replace(/\b(?:epis[oó]dio|episodio|episode|ep|cap[ií]tulo|capitulo|cap)\.?\s*\d{1,3}\b/gi, ' ')
        .replace(/\b(?:temporada|season|temp\.?|t)\s*\d{1,3}\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      add(withoutEpisode);

      const withoutYear = base.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
      add(withoutYear);
    }

    return variants.slice(0, 4);
  }

  private shouldBoostWithFallback(results: TorrentLike[]): boolean {
    if (results.length === 0) {
      return true;
    }

    if (results.length < TorrentIndexerProvider.HYBRID_MIN_RESULTS) {
      return true;
    }

    const uniqueIndexers = this.collectIndexerSlugs(results);
    return uniqueIndexers.size < TorrentIndexerProvider.HYBRID_MIN_INDEXERS;
  }

  private compareIndexerPriority(a: string, b: string): number {
    const slugA = this.normalizeIndexerSlug(a);
    const slugB = this.normalizeIndexerSlug(b);
    const statsA = TorrentIndexerProvider.indexerPerformance.get(slugA);
    const statsB = TorrentIndexerProvider.indexerPerformance.get(slugB);

    if (statsA && statsB) {
      const rateA = (statsA.hits + 1) / (statsA.samples + 2);
      const rateB = (statsB.hits + 1) / (statsB.samples + 2);
      const emptyRateA = statsA.samples > 0 ? statsA.emptyHits / statsA.samples : 0;
      const emptyRateB = statsB.samples > 0 ? statsB.emptyHits / statsB.samples : 0;
      const scoreA = rateA * 1000 - statsA.avgMs - emptyRateA * 120;
      const scoreB = rateB * 1000 - statsB.avgMs - emptyRateB * 120;

      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      if (statsA.lastDurationMs !== statsB.lastDurationMs) {
        return statsA.lastDurationMs - statsB.lastDurationMs;
      }
    } else if (statsA) {
      return -1;
    } else if (statsB) {
      return 1;
    }

    return a.localeCompare(b);
  }

  private collectIndexerSlugs(results: TorrentLike[]): Set<string> {
    const names = new Set<string>();
    for (const torrent of results) {
      const raw = this.extractIndexerRawName(torrent);
      if (!raw) {
        continue;
      }
      const normalized = this.normalizeIndexerSlug(raw);
      if (normalized) {
        names.add(normalized);
      }
    }
    return names;
  }

  private extractIndexerRawName(torrent: TorrentLike): string | undefined {
    const record = torrent as Record<string, unknown>;
    const candidate =
      record.indexer ||
      record.indexerName ||
      record.indexer_name ||
      record.source ||
      record.provider ||
      record.origin ||
      record.site;

    if (typeof candidate !== 'string') {
      return undefined;
    }

    return candidate.trim() || undefined;
  }

  private normalizeIndexerSlug(value: string): string {
    const cleaned = this.sanitizeQuery(value)?.toLowerCase() ?? value.toLowerCase();
    return cleaned
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]+/g, '')
      .trim();
  }

  private shouldSkipIndexer(indexerName: string): boolean {
    const slug = this.normalizeIndexerSlug(indexerName);
    if (!slug) {
      return true;
    }

    if (TorrentIndexerProvider.DISABLED_INDEXERS.has(slug)) {
      return true;
    }

    const state = TorrentIndexerProvider.indexerFailureState.get(slug);
    if (!state) {
      return false;
    }

    if (state.cooldownUntil > Date.now()) {
      return true;
    }

    return false;
  }

  private recordIndexerFailure(indexerSlug: string): void {
    const current = TorrentIndexerProvider.indexerFailureState.get(indexerSlug);
    const nextFailures = (current?.consecutiveFailures ?? 0) + 1;
    const shouldCooldown = nextFailures >= TorrentIndexerProvider.INDEXER_FAILURE_THRESHOLD;

    TorrentIndexerProvider.indexerFailureState.set(indexerSlug, {
      consecutiveFailures: nextFailures,
      cooldownUntil: shouldCooldown
        ? Date.now() + TorrentIndexerProvider.INDEXER_FAILURE_COOLDOWN_MS
        : 0,
    });
  }

  private clearIndexerFailure(indexerSlug: string): void {
    const current = TorrentIndexerProvider.indexerFailureState.get(indexerSlug);
    if (!current) {
      return;
    }

    if (current.consecutiveFailures === 0 && current.cooldownUntil === 0) {
      return;
    }

    TorrentIndexerProvider.indexerFailureState.set(indexerSlug, {
      consecutiveFailures: 0,
      cooldownUntil: 0,
    });
  }

  private rankTorrentsByQuery(results: TorrentLike[], query: string): TorrentLike[] {
    if (results.length <= 1) {
      return results;
    }

    return [...results].sort((a, b) => this.scoreTorrentForQuery(b, query) - this.scoreTorrentForQuery(a, query));
  }

  private hasStrongQueryMatch(results: TorrentLike[], query: string): boolean {
    if (results.length === 0) {
      return false;
    }

    const imdbQuery = /^tt\d+$/i.test(query.trim());
    const threshold = imdbQuery ? 85 : 52;
    const candidates = results.slice(0, 40);
    return candidates.some((torrent) => this.scoreTorrentForQuery(torrent, query) >= threshold);
  }

  private scoreTorrentForQuery(torrent: TorrentLike, query: string): number {
    const record = torrent as Record<string, unknown>;
    let score = 0;
    const rawQuery = query.trim();
    const rawTitle = this.extractTitle(torrent) ?? '';
    const rawOriginalTitle = this.toString(record.original_title) ?? '';
    const normalizedTitle = this.normalizeLooseText(`${rawTitle} ${rawOriginalTitle}`);

    const similarity = this.toNumber(record.similarity);
    if (similarity !== undefined) {
      score += Math.max(0, similarity) * 25;
    }

    const seeds = this.toNumber(record.seed_count ?? record.seeders ?? record.seeds);
    if (seeds !== undefined && seeds > 0) {
      score += Math.min(seeds, 200) / 20;
    }

    if (/^tt\d+$/i.test(rawQuery)) {
      const imdb = this.extractImdb(torrent);
      if (imdb && imdb.toLowerCase() === rawQuery.toLowerCase()) {
        score += 120;
      } else {
        score -= 20;
      }
      return score;
    }

    const normalizedQuery = this.normalizeLooseText(rawQuery);
    if (normalizedQuery.length >= 4 && normalizedTitle.includes(normalizedQuery)) {
      score += 55;
    }

    const queryTokens = this.tokenizeQuery(rawQuery);
    if (queryTokens.length > 0) {
      let matchedTokens = 0;
      for (const token of queryTokens) {
        if (normalizedTitle.includes(token)) {
          matchedTokens += 1;
        }
      }

      score += matchedTokens * 10;
      score += (matchedTokens / queryTokens.length) * 45;

      if (matchedTokens === 0) {
        score -= 15;
      }
    }

    const yearMatch = rawQuery.match(/\b((?:19|20)\d{2})\b/);
    if (yearMatch?.[1]) {
      if (new RegExp(`\\b${yearMatch[1]}\\b`).test(rawTitle) || new RegExp(`\\b${yearMatch[1]}\\b`).test(rawOriginalTitle)) {
        score += 8;
      } else {
        score -= 2;
      }
    }

    const querySeasonEpisode = this.extractSeasonEpisodeFromText(rawQuery);
    if (querySeasonEpisode.season !== undefined) {
      const titleSeasonEpisode = this.extractSeasonEpisodeFromText(rawTitle);
      if (titleSeasonEpisode.season !== undefined) {
        if (titleSeasonEpisode.season === querySeasonEpisode.season) {
          score += 14;
        } else {
          score -= 12;
        }
      }

      if (querySeasonEpisode.episode !== undefined && titleSeasonEpisode.episode !== undefined) {
        if (titleSeasonEpisode.episode === querySeasonEpisode.episode) {
          score += 18;
        } else {
          score -= 15;
        }
      }
    }

    if (/\[unsafe\]/i.test(rawTitle)) {
      score -= 6;
    }

    return score;
  }

  private normalizeLooseText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenizeQuery(value: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'da', 'de', 'do', 'dos', 'das', 'e',
      'temporada', 'season', 'episodio', 'episodio', 'episode', 'parte', 'part',
    ]);

    return this.normalizeLooseText(value)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !stopWords.has(token));
  }

  private extractSeasonEpisodeFromText(value: string): { season?: number; episode?: number } {
    const text = value.toLowerCase();
    const sxe = text.match(/s(\d{1,3})e(\d{1,3})/i);
    if (sxe?.[1] && sxe?.[2]) {
      return { season: Number(sxe[1]), episode: Number(sxe[2]) };
    }

    const xFormat = text.match(/(\d{1,3})x(\d{1,3})/i);
    if (xFormat?.[1] && xFormat?.[2]) {
      return { season: Number(xFormat[1]), episode: Number(xFormat[2]) };
    }

    const season = text.match(/(?:temporada|season|temp\.?|t)\s*(\d{1,3})/i);
    const episode = text.match(/(?:epis[oó]dio|episodio|episode|ep|cap[ií]tulo|capitulo|cap\.?)[\s._-]*(\d{1,3})/i);

    return {
      season: season?.[1] ? Number(season[1]) : undefined,
      episode: episode?.[1] ? Number(episode[1]) : undefined,
    };
  }

  private recordIndexerPerformance(indexerSlug: string, durationMs: number, resultCount: number): void {
    const current = TorrentIndexerProvider.indexerPerformance.get(indexerSlug);
    const next: IndexerPerformanceEntry = current
      ? {
          avgMs: current.avgMs * 0.7 + durationMs * 0.3,
          samples: current.samples + 1,
          hits: current.hits + (resultCount > 0 ? 1 : 0),
          emptyHits: current.emptyHits + (resultCount === 0 ? 1 : 0),
          lastDurationMs: durationMs,
          lastSeenAt: Date.now(),
        }
      : {
          avgMs: durationMs,
          samples: 1,
          hits: resultCount > 0 ? 1 : 0,
          emptyHits: resultCount === 0 ? 1 : 0,
          lastDurationMs: durationMs,
          lastSeenAt: Date.now(),
        };

    TorrentIndexerProvider.indexerPerformance.set(indexerSlug, next);
  }

  private mergeTorrentResults(primary: TorrentLike[], secondary: TorrentLike[]): TorrentLike[] {
    if (secondary.length === 0) {
      return [...primary];
    }

    const merged = [...primary];
    const seen = new Set<string>();

    for (const torrent of primary) {
      seen.add(this.buildTorrentMergeKey(torrent));
    }

    for (const torrent of secondary) {
      const key = this.buildTorrentMergeKey(torrent);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(torrent);
    }

    return merged;
  }

  private buildTorrentMergeKey(torrent: TorrentLike): string {
    const record = torrent as Record<string, unknown>;
    const magnet = this.toString(record.magnet_link) || this.toString(record.magnet);
    if (magnet) {
      return `magnet:${magnet}`;
    }

    const hash =
      this.toString(record.info_hash) ||
      this.toString(record.infoHash) ||
      this.toString(record.hash) ||
      this.toString(record.btih);
    if (hash) {
      return `hash:${hash.toLowerCase()}`;
    }

    const details = this.toString(record.details) || this.toString(record.url) || this.toString(record.link);
    if (details) {
      return `details:${details}`;
    }

    const title = this.toString(record.title) || this.toString(record.original_title) || this.toString(record.name) || '';
    const size = this.toString(record.size) || this.toString(record.size_bytes) || '';
    return `title:${title.toLowerCase()}|size:${size}`;
  }

  private parseId(id: string): ParsedIdInfo {
    const parts = (id || '').split(':');
    const rawId = parts[0] ?? '';
    const season = parts[1];
    const episode = parts[2];

    const info: ParsedIdInfo = {};

    if (/^tt\d+$/.test(rawId)) {
      info.imdbId = rawId;
    } else {
      const sanitizedQuery = this.sanitizeQuery(rawId);
      if (sanitizedQuery) {
        info.query = sanitizedQuery;
      }
    }

    if (season !== undefined) {
      const parsedSeason = Number(season);
      if (!Number.isNaN(parsedSeason)) {
        info.season = parsedSeason;
      }
    }

    if (episode !== undefined) {
      const parsedEpisode = Number(episode);
      if (!Number.isNaN(parsedEpisode)) {
        info.episode = parsedEpisode;
      }
    }

    return info;
  }

  private async fetchCinemetaMeta(type: string, id: string): Promise<CinemetaMeta | undefined> {
    const cacheKey = `${type}:${id}`;
    const cached = TorrentIndexerProvider.cinemetaCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TorrentIndexerProvider.CINEMETA_TTL) {
      return cached.data;
    }

    const url = `https://v3-cinemeta.strem.io/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;

    try {
      const response = await request(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.statusCode >= 400) {
        return undefined;
      }

      const payload = (await response.body.json()) as Record<string, unknown>;
      const meta = payload?.meta ?? payload;
      if (meta && typeof meta === 'object') {
        const result = meta as CinemetaMeta;
        TorrentIndexerProvider.cinemetaCache.set(cacheKey, { data: result, ts: Date.now() });
        return result;
      }
    } catch {
      // Ignore Cinemeta errors
    }

    return undefined;
  }

  private async fetchLocalizedTitleCandidates(imdbId: string): Promise<string[]> {
    const normalizedImdb = imdbId.trim().toLowerCase();
    if (!/^tt\d+$/.test(normalizedImdb)) {
      return [];
    }

    const cached = TorrentIndexerProvider.localizedTitleCache.get(normalizedImdb);
    if (cached && Date.now() - cached.ts < TorrentIndexerProvider.LOCALIZED_TITLE_CACHE_TTL_MS) {
      return cached.titles;
    }

    const readToken = TorrentIndexerProvider.TMDB_API_READ_ACCESS_TOKEN;
    const apiKey = TorrentIndexerProvider.TMDB_API_KEY;
    if (!readToken && !apiKey) {
      TorrentIndexerProvider.localizedTitleCache.set(normalizedImdb, { ts: Date.now(), titles: [] });
      return [];
    }

    const url = new URL(`https://api.themoviedb.org/3/find/${encodeURIComponent(normalizedImdb)}`);
    url.searchParams.set('external_source', 'imdb_id');
    url.searchParams.set('language', 'pt-BR');
    if (apiKey) {
      url.searchParams.set('api_key', apiKey);
    }

    const titles = new Set<string>();

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (readToken) {
        headers.Authorization = `Bearer ${readToken}`;
      }

      const response = await request(url.toString(), {
        signal: AbortSignal.timeout(TorrentIndexerProvider.TMDB_TIMEOUT_MS),
        headers,
      });

      if (response.statusCode >= 400) {
        TorrentIndexerProvider.localizedTitleCache.set(normalizedImdb, { ts: Date.now(), titles: [] });
        return [];
      }

      const payload = (await response.body.json()) as {
        movie_results?: Array<Record<string, unknown>>;
        tv_results?: Array<Record<string, unknown>>;
      };

      const resultEntries = [...(payload.movie_results ?? []), ...(payload.tv_results ?? [])];
      for (const entry of resultEntries) {
        const candidates = [
          this.toString(entry.title),
          this.toString(entry.name),
          this.toString(entry.original_title),
          this.toString(entry.original_name),
        ];

        for (const candidate of candidates) {
          const label = this.sanitizeQuery(candidate ?? '');
          if (label) {
            titles.add(label);
          }
        }
      }
    } catch {
      // Ignore TMDB failures and continue with Cinemeta-only titles.
    }

    const result = Array.from(titles);
    TorrentIndexerProvider.localizedTitleCache.set(normalizedImdb, { ts: Date.now(), titles: result });
    return result;
  }

  private buildTextQuery(
    type: string,
    parsed: ParsedIdInfo,
    targetTitle?: string,
    releaseYear?: number,
    episodeTitle?: string,
  ): string | undefined {
    if (!targetTitle && parsed.query) {
      return parsed.query;
    }

    if (!targetTitle) {
      return undefined;
    }

    if (type.toLowerCase() === 'movie') {
      if (releaseYear) {
        return `${targetTitle} ${releaseYear}`;
      }
      return targetTitle;
    }

    if (parsed.season !== undefined) {
      const seasonPart = `temporada ${parsed.season}`;
      if (parsed.episode !== undefined) {
        const episodePart = `episodio ${parsed.episode}`;
        return `${targetTitle} ${seasonPart} ${episodePart}`;
      }
      if (releaseYear) {
        return `${targetTitle} ${seasonPart} ${releaseYear}`;
      }
      return `${targetTitle} ${seasonPart}`;
    }

    if (episodeTitle) {
      return `${targetTitle} ${episodeTitle}`;
    }

    return targetTitle;
  }

  private buildTextQueryCandidates(
    type: string,
    parsed: ParsedIdInfo,
    targetTitles: string[],
    releaseYear?: number,
    episodeTitle?: string,
  ): string[] {
    const out: string[] = [];
    const add = (value?: string) => {
      if (!value) {
        return;
      }
      const cleaned = this.sanitizeQuery(value);
      if (!cleaned) {
        return;
      }
      if (!out.includes(cleaned)) {
        out.push(cleaned);
      }
    };

    if (parsed.query) {
      add(parsed.query);
    }

    const seenTitles = Array.from(new Set(targetTitles.map((t) => this.sanitizeQuery(t)).filter(Boolean) as string[]));
    const limitedTitles = seenTitles.slice(0, 6);

    for (const baseTitle of limitedTitles) {
      const titleVariants = this.buildLocaleTitleVariants(baseTitle).slice(0, 5);
      for (const title of titleVariants) {
        if (type.toLowerCase() === 'movie') {
          add(title);
          if (releaseYear) {
            add(`${title} ${releaseYear}`);
          }
          continue;
        }

        // Series: mix PT-BR wording and SxxEyy notation for better source coverage.
        if (parsed.season !== undefined) {
          const s = parsed.season;
          const sPad = String(s).padStart(2, '0');
          add(`${title} temporada ${s}`);
          add(`${title} season ${s}`);
          add(`${title} S${sPad}`);

          if (parsed.episode !== undefined) {
            const e = parsed.episode;
            const ePad = String(e).padStart(2, '0');
            add(`${title} temporada ${s} episodio ${e}`);
            add(`${title} season ${s} episode ${e}`);
            add(`${title} S${sPad}E${ePad}`);
            add(`${title} ${s}x${ePad}`);
          }
        }

        if (episodeTitle) {
          add(`${title} ${episodeTitle}`);
        }
        if (releaseYear) {
          add(`${title} ${releaseYear}`);
        }
        add(title);
      }
    }

    return out.slice(0, MAX_TEXT_QUERIES);
  }

  private buildLocaleTitleVariants(title: string): string[] {
    const out: string[] = [];
    const add = (value?: string) => {
      if (!value) {
        return;
      }
      const cleaned = this.sanitizeQuery(value);
      if (!cleaned) {
        return;
      }
      if (!out.includes(cleaned)) {
        out.push(cleaned);
      }
    };

    const base = this.sanitizeQuery(title);
    if (!base) {
      return out;
    }

    add(base);
    add(base.replace(/[:|]/g, ' '));

    const enToPt: Array<[RegExp, string]> = [
      [/\bpart\s+two\b/gi, 'parte dois'],
      [/\bpart\s+three\b/gi, 'parte tres'],
      [/\bpart\s+one\b/gi, 'parte um'],
      [/\bpart\s+([0-9]+)\b/gi, 'parte $1'],
      [/\bchapter\b/gi, 'capitulo'],
      [/\bthe\b/gi, ''],
    ];

    const ptToEn: Array<[RegExp, string]> = [
      [/\bparte\s+dois\b/gi, 'part two'],
      [/\bparte\s+tres\b/gi, 'part three'],
      [/\bparte\s+um\b/gi, 'part one'],
      [/\bparte\s+([0-9]+)\b/gi, 'part $1'],
      [/\bcapitulo\b/gi, 'chapter'],
    ];

    let ptVariant = base;
    for (const [regex, replacement] of enToPt) {
      ptVariant = ptVariant.replace(regex, replacement);
    }
    add(ptVariant);

    let enVariant = base;
    for (const [regex, replacement] of ptToEn) {
      enVariant = enVariant.replace(regex, replacement);
    }
    add(enVariant);

    return out;
  }

  private collectDynamicQueryCandidates(
    type: string,
    parsed: ParsedIdInfo,
    torrents: TorrentLike[],
    releaseYear?: number,
    episodeTitle?: string,
  ): string[] {
    const out: string[] = [];
    const add = (value?: string) => {
      if (!value) {
        return;
      }
      const cleaned = this.sanitizeQuery(value);
      if (!cleaned || cleaned.length < 3 || cleaned.length > 140) {
        return;
      }
      if (!out.includes(cleaned)) {
        out.push(cleaned);
      }
    };

    const topTorrents = torrents.slice(0, 40);
    const titles: string[] = [];

    for (const torrent of topTorrents) {
      const collected = this.collectTorrentTitles(torrent);
      for (const title of collected) {
        if (!titles.includes(title)) {
          titles.push(title);
        }
      }
      if (titles.length >= 18) {
        break;
      }
    }

    for (const rawTitle of titles.slice(0, 12)) {
      const localized = this.buildLocaleTitleVariants(rawTitle).slice(0, 4);
      for (const title of localized) {
        add(title);
        if (type.toLowerCase() === 'movie') {
          if (releaseYear) {
            add(`${title} ${releaseYear}`);
          }
          continue;
        }

        if (parsed.season !== undefined) {
          const season = parsed.season;
          const seasonPadded = String(season).padStart(2, '0');
          add(`${title} temporada ${season}`);
          add(`${title} season ${season}`);
          add(`${title} S${seasonPadded}`);

          if (parsed.episode !== undefined) {
            const episode = parsed.episode;
            const episodePadded = String(episode).padStart(2, '0');
            add(`${title} temporada ${season} episodio ${episode}`);
            add(`${title} season ${season} episode ${episode}`);
            add(`${title} S${seasonPadded}E${episodePadded}`);
            add(`${title} ${season}x${episodePadded}`);
          }
        }

        if (episodeTitle) {
          add(`${title} ${episodeTitle}`);
        }
      }
    }

    return out.slice(0, MAX_DYNAMIC_QUERIES);
  }

  private isRelevantTorrent(torrent: TorrentLike, context: MatchContext): boolean {
    const { parsed, type, targetTitles, releaseYear } = context;
    const normalizedType = type.toLowerCase();
    const imdb = this.extractImdb(torrent);

    // If we only have an IMDb id and no title context, require IMDb metadata in the item.
    if (parsed.imdbId && !imdb && targetTitles.length === 0) {
      return false;
    }

    // Title-based check: only for non-IMDB searches
    if (!parsed.imdbId || !imdb) {
      const torrentTitles = this.collectTorrentTitles(torrent);
      if (targetTitles.length > 0 && torrentTitles.length > 0) {
        const normalizedTargets = targetTitles
          .map((title) => this.normalizeForComparison(title))
          .filter((title) => title.length >= 3);
        const normalizedAlphabeticTargets = normalizedTargets.filter((title) => /[a-z]/.test(title));
        const effectiveTargets =
          normalizedAlphabeticTargets.length > 0 ? normalizedAlphabeticTargets : normalizedTargets;

        // Avoid broad false positives for very short/ambiguous titles (e.g. "3%")
        // when source items do not carry an IMDb id to confirm identity.
        if (effectiveTargets.length === 0) {
          return false;
        }

        const normalizedTorrentTitles = torrentTitles.map((title) => this.normalizeForComparison(title));

        const matchesTitle = normalizedTorrentTitles.some((torrentTitle) =>
          effectiveTargets.some((targetTitle) =>
            torrentTitle.includes(targetTitle) || targetTitle.includes(torrentTitle),
          ),
        );

        if (!matchesTitle) {
          return false;
        }
      }
    } else if (imdb.toLowerCase() !== parsed.imdbId.toLowerCase()) {
      return false;
    }

    if (normalizedType === 'movie') {
      if (this.hasEpisodePattern(torrent)) {
        return false;
      }
      if (releaseYear !== undefined) {
        const torrentYear = this.extractYear(torrent);
        if (torrentYear !== undefined && Math.abs(torrentYear - releaseYear) > 1) {
          return false;
        }
      }
    }

    // Season/episode filtering â€” applies to ALL series results (including IMDB matches)
    if (normalizedType !== 'movie' && parsed.season !== undefined) {
      const texts = this.collectSearchableTexts(torrent);

      // Allow complete-series packs for any season
      if (this.isCompleteSeriesPack(texts)) {
        // falls through â€” don't filter by season
      } else {
        // Check for season ranges first (e.g. "1Âª a 5Âª Temporada")
        const range = this.extractSeasonRangeFromTexts(texts);
        if (range) {
          if (parsed.season < range.start || parsed.season > range.end) {
            return false;
          }
        } else {
          // Single season check
          const torrentSeason = this.extractSeasonFromTorrent(torrent);
          if (torrentSeason !== undefined && torrentSeason !== parsed.season) {
            return false;
          }

          // When torrentSeason is undefined, inspect internal files
          if (torrentSeason === undefined) {
            const files = this.extractFilesFromTorrent(torrent);
            if (files.length > 0) {
              const fileSeasonsSet = new Set<number>();
              for (const file of files) {
                const fs = this.extractSeasonFromTorrent({ title: file.path });
                if (fs !== undefined) fileSeasonsSet.add(fs);
              }
              if (fileSeasonsSet.size > 0 && !fileSeasonsSet.has(parsed.season)) {
                return false;
              }
            }
          }
        }
      }

      if (parsed.episode !== undefined) {
        const torrentEpisode = this.extractEpisodeFromTorrent(torrent);
        if (torrentEpisode !== undefined && torrentEpisode !== parsed.episode) {
          return false;
        }
        const episodeList = this.extractEpisodeList(torrent);
        if (episodeList && episodeList.length > 0 && !episodeList.includes(parsed.episode)) {
          return false;
        }
      }
    }

    return true;
  }

  private hasEpisodePattern(torrent: TorrentLike): boolean {
    if (
      this.extractSeasonFromTorrent(torrent) !== undefined ||
      this.extractEpisodeFromTorrent(torrent) !== undefined ||
      (this.extractEpisodeList(torrent)?.length ?? 0) > 0
    ) {
      return true;
    }

    const metadataStrings = this.collectEpisodeMetadataStrings(torrent);
    return metadataStrings.some((value) => EPISODIC_HINT_REGEX.test(value));
  }

  private collectEpisodeMetadataStrings(torrent: TorrentLike): string[] {
    const record = torrent as Record<string, unknown>;
    const strings: string[] = [];

    const pushValue = (value: unknown) => {
      if (typeof value !== 'string') {
        return;
      }

      const normalized = this.normalizeEpisodeMetadata(value);
      if (normalized) {
        strings.push(normalized);
      }
    };

    pushValue(record.title);
    pushValue(record.original_title);
    pushValue(record.description);
    pushValue(record.summary);
    pushValue(record.plot);
    pushValue(record.synopsis);
    pushValue(record.details);
    pushValue(record.slug);
    pushValue(record.category);
    pushValue(record.subcategory);

    const tags = (record.tags as unknown) || (record.categories as unknown);
    if (Array.isArray(tags)) {
      tags.forEach(pushValue);
    }

    return strings;
  }

  private normalizeEpisodeMetadata(value: string): string | undefined {
    let normalized = value;
    try {
      normalized = decodeURIComponent(value);
    } catch {
      normalized = value;
    }

    normalized = normalized.replace(/https?:\/\/[^/]+/gi, ' ');
    normalized = normalized.replace(/[/_.\-+]/g, ' ');
    normalized = normalized.replace(/\s+/g, ' ').trim();

    if (!normalized) {
      return undefined;
    }

    return normalized.toLowerCase();
  }

  private extractImdb(torrent: TorrentLike): string | undefined {
    const record = torrent as Record<string, unknown>;
    const candidates = [
      this.toString(record.imdb),
      this.toString(record.imdbId),
      this.toString(record.imdb_id),
      this.toString(record['Imdb']),
      this.toString(record['IMDB']),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      // Bare IMDB ID
      if (/^tt\d+$/.test(candidate)) {
        return candidate;
      }
      // IMDB URL or string containing an ID
      const match = candidate.match(/tt\d+/);
      if (match) {
        return match[0];
      }
    }

    return undefined;
  }

  private collectTorrentTitles(torrent: TorrentLike): string[] {
    const record = torrent as Record<string, unknown>;
    const titles = new Set<string>();

    const add = (value: unknown) => {
      if (typeof value === 'string') {
        const sanitized = this.sanitizeQuery(value);
        if (sanitized) {
          titles.add(sanitized);
        }
      }
    };

    add(record.title);
    add(record.original_title);
    add(record.name);
    add(record.filename);
    add(record.release);
    add(record.file);
    add(record.slug);
    add(record.displayName);

    const extra = record.titles;
    if (Array.isArray(extra)) {
      extra.forEach(add);
    }

    return Array.from(titles);
  }

  private extractYear(torrent: TorrentLike): number | undefined {
    const record = torrent as Record<string, unknown>;
    const candidate = record.year ?? record.releaseYear ?? record.release_year ?? record.date;

    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }

    if (typeof candidate === 'string') {
      const match = candidate.match(/\d{4}/);
      if (match) {
        return Number(match[0]);
      }
    }

    // Fallback: extract year from title/original_title when structured field is empty
    const texts = this.collectSearchableTexts(torrent);
    for (const text of texts) {
      if (!text) continue;
      // Match (2017) or [2017] or .2017. patterns â€” only years 1950-2099
      const yearMatch = text.match(/[\(\[.\s]((?:19[5-9]\d|20[0-9]\d))[\)\].\s]/)
        ?? text.match(/\b((?:19[5-9]\d|20[0-9]\d))\b/);
      if (yearMatch?.[1]) {
        const y = Number(yearMatch[1]);
        if (y >= 1950 && y <= 2099) return y;
      }
    }

    return undefined;
  }

  private extractSeason(torrent: TorrentLike): number | undefined {
    const record = torrent as Record<string, unknown>;
    const candidate =
      record.season ??
      record.seasonNumber ??
      record.season_number ??
      record.seriesSeason ??
      record['Season'];

    return this.toNumber(candidate);
  }

  private extractEpisode(torrent: TorrentLike): number | undefined {
    const record = torrent as Record<string, unknown>;
    const candidate =
      record.episode ??
      record.episodeNumber ??
      record.episode_number ??
      record.seriesEpisode ??
      record['Episode'];

    return this.toNumber(candidate);
  }

  /**
   * Collect ALL text fields from a torrent that might contain season/episode/title info.
   * Used as the basis for all extraction to ensure nothing is missed.
   */
  private collectSearchableTexts(torrent: TorrentLike): string[] {
    const record = torrent as Record<string, unknown>;
    const texts: string[] = [];
    const add = (v: unknown) => { if (typeof v === 'string' && v.trim()) texts.push(v.trim()); };
    add(record.title);
    add(record.original_title);
    add(record.name);
    add(record.filename);
    add(record.release);
    add(record.file);
    add(record.slug);
    add(record.displayName);
    add(record.description);
    add(record.summary);
    add(record.details);
    add(record.category);
    add(record.subcategory);
    const tags = record.tags ?? record.categories;
    if (Array.isArray(tags)) tags.forEach(add);
    return texts;
  }

  // â”€â”€ Season extraction patterns (ordered by specificity) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private static readonly SEASON_PATTERNS: { regex: RegExp; group: number }[] = [
    // S01E03, S01, S1
    { regex: /\bS(\d{1,3})(?:E\d{1,3})?\b/i, group: 1 },
    // 1x03, 01x03, 1Ã—03 (multiplication sign)
    { regex: /\b(\d{1,2})[xÃ—]\d{1,3}\b/i, group: 1 },
    // Portuguese ordinals: 2Âª Temporada, 3a Temporada, 4Âº Temporada, 1áµƒ Temporada
    { regex: /(\d{1,3})[ÂªÂºáµƒáµ’aAoO]\s*temporada/i, group: 1 },
    // Temporada 2, Season 3
    { regex: /\b(?:temporada|season)\s*(\d{1,3})\b/i, group: 1 },
    // Temp 1, Temp. 2, Temp.3
    { regex: /\btemp\.?\s*(\d{1,3})\b/i, group: 1 },
    // Portuguese ordinals with temp: 2Âª Temp, 3a temp
    { regex: /(\d{1,3})[ÂªÂºáµƒáµ’aAoO]\s*temp\b/i, group: 1 },
    // T01 or T1 (only when preceded by non-alpha to avoid matching words)
    { regex: /(?:^|[\s._\-\[\(])T(\d{1,2})(?:[\s._\-\]\)]|$)/i, group: 1 },
    // Pack Temporada 1, Pack Season 1
    { regex: /\bpack\s+(?:temporada|season|temp\.?)\s*(\d{1,3})\b/i, group: 1 },
    // "da 3 temporada" (informal Portuguese)
    { regex: /\bda\s+(\d{1,3})\s*temporada\b/i, group: 1 },
  ];

  // â”€â”€ Season RANGE patterns (multi-season packs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private static readonly SEASON_RANGE_PATTERNS: { regex: RegExp; startGroup: number; endGroup: number }[] = [
    // 1Âª a 3Âª Temporada, 1a a 6a temporada, 1Âª Ã  5Âª temporada
    { regex: /(\d{1,3})[ÂªÂºáµƒáµ’aAoO]?\s*(?:a|Ã |atÃ©|ao|~|-)\s*(\d{1,3})[ÂªÂºáµƒáµ’aAoO]?\s*temporada/i, startGroup: 1, endGroup: 2 },
    // Temporadas 1-3, Temporadas 1 a 5, Temporadas 1 ao 6, Temporada 1~5
    { regex: /temporadas?\s*(\d{1,3})\s*(?:a|Ã |atÃ©|ao|~|-|e)\s*(\d{1,3})/i, startGroup: 1, endGroup: 2 },
    // Season 1-3, Seasons 1 to 5
    { regex: /seasons?\s*(\d{1,3})\s*(?:to|through|thru|~|-)\s*(\d{1,3})/i, startGroup: 1, endGroup: 2 },
    // S01-S03, S01~S06, S01.S06
    { regex: /\bS(\d{1,3})\s*[-~.]\s*S(\d{1,3})\b/i, startGroup: 1, endGroup: 2 },
    // T01-T03
    { regex: /\bT(\d{1,2})\s*[-~.]\s*T(\d{1,2})\b/i, startGroup: 1, endGroup: 2 },
    // Temp 1-3, Temp.1 a 5
    { regex: /\btemp\.?\s*(\d{1,3})\s*(?:a|Ã |atÃ©|ao|~|-)\s*(\d{1,3})/i, startGroup: 1, endGroup: 2 },
  ];

  // â”€â”€ Complete series detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private static readonly COMPLETE_SERIES_PATTERNS: RegExp[] = [
    /\b(?:s[eÃ©]rie|series)\s+completa\b/i,
    /\bcomplete\s+(?:s[eÃ©]rie|series)\b/i,
    /\btodas?\s+(?:as\s+)?temporadas?\b/i,
    /\ball\s+seasons?\b/i,
    /\bcomplete\s+(?:collection|box\s*set|pack)\b/i,
    /\bcole[Ã§c][Ã£a]o\s+completa\b/i,
    /\bpack\s+completo\b/i,
    /\bintegral\b/i,
    /\bthe\s+complete\s+series\b/i,
    /\bdiscografia\s+completa\b/i,
  ];

  // â”€â”€ Episode extraction patterns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private static readonly EPISODE_PATTERNS: { regex: RegExp; group: number }[] = [
    // S01E03, S1E3
    { regex: /\bS\d{1,3}E(\d{1,3})\b/i, group: 1 },
    // 1x03, 01x03, 1Ã—03 (multiplication sign)
    { regex: /\b\d{1,2}[xÃ—](\d{1,3})\b/i, group: 1 },
    // EP03, Ep.03, Ep 03, EP.03, ep03
    { regex: /\bep\.?\s*(\d{1,3})\b/i, group: 1 },
    // E03 standalone (not part of SxxExx â€” that's caught above)
    { regex: /(?<!S\d{0,3})\bE(\d{1,3})\b/i, group: 1 },
    // EpisÃ³dio 03, Episodio 03, Episode 03
    { regex: /\b(?:epis[oÃ³]dio|episodio|episode)\s*(\d{1,3})\b/i, group: 1 },
    // CapÃ­tulo 03, Capitulo 03, Cap 03, Cap.03
    { regex: /\b(?:cap[iÃ­]tulo|capitulo|cap)\.?\s*(\d{1,3})\b/i, group: 1 },
    // Folge 03 (German, sometimes seen in multi-lang releases)
    { regex: /\bfolge\s*(\d{1,3})\b/i, group: 1 },
    // #03 (hash notation)
    { regex: /#(\d{1,3})\b/, group: 1 },
    // Bare number at start of filename: "2 - Sick.mp4", "02.Title.mp4", "02 Title.mkv"
    // Only matches when the number is at the beginning of a path segment (after / \ or start)
    { regex: /(?:^|[\/\\])0*(\d{1,3})\s*[-._\s]+[A-Za-z]/, group: 1 },
    // Bare number followed by dot-extension: "02.mp4", "2.mkv" (last resort)
    { regex: /(?:^|[\/\\])0*(\d{1,3})\.(mkv|mp4|avi|m4v|ts)$/i, group: 1 },
    // Three-digit compact: 302 = S03E02 (when context season is known, extract last 2 digits)
    { regex: /(?:^|[\/\\])\d(\d{2})\s*[-._\s]+[A-Za-z]/, group: 1 },
  ];

  /**
   * Extract season number from torrent using structured fields + comprehensive text parsing.
   * Searches title, original_title, filename, and other text fields.
   */
  private extractSeasonFromTorrent(torrent: TorrentLike): number | undefined {
    const structured = this.extractSeason(torrent);
    if (structured !== undefined) return structured;

    const texts = this.collectSearchableTexts(torrent);
    for (const text of texts) {
      if (!text) continue;
      for (const { regex, group } of TorrentIndexerProvider.SEASON_PATTERNS) {
        const m = text.match(regex);
        if (m?.[group]) {
          const season = parseInt(m[group], 10);
          if (!isNaN(season) && season > 0 && season < 200) return season;
        }
      }
    }
    return undefined;
  }

  /**
   * Detect multi-season packs like "1Âª a 5Âª Temporada", "Temporadas 1-6".
   * Returns { start, end } or undefined.
   */
  private extractSeasonRangeFromTexts(texts: string[]): { start: number; end: number } | undefined {
    for (const text of texts) {
      if (!text) continue;
      for (const { regex, startGroup, endGroup } of TorrentIndexerProvider.SEASON_RANGE_PATTERNS) {
        const m = text.match(regex);
        if (m?.[startGroup] && m?.[endGroup]) {
          const start = parseInt(m[startGroup], 10);
          const end = parseInt(m[endGroup], 10);
          if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
            return { start, end };
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Detect complete-series packs ("SÃ©rie Completa", "Todas as Temporadas", etc.).
   */
  private isCompleteSeriesPack(texts: string[]): boolean {
    for (const text of texts) {
      if (!text) continue;
      for (const pattern of TorrentIndexerProvider.COMPLETE_SERIES_PATTERNS) {
        if (pattern.test(text)) return true;
      }
    }
    return false;
  }

  /**
   * Extract episode number from torrent using structured fields + comprehensive text parsing.
   */
  private extractEpisodeFromTorrent(torrent: TorrentLike): number | undefined {
    const structured = this.extractEpisode(torrent);
    if (structured !== undefined) return structured;

    const texts = this.collectSearchableTexts(torrent);
    for (const text of texts) {
      if (!text) continue;
      for (const { regex, group } of TorrentIndexerProvider.EPISODE_PATTERNS) {
        const m = text.match(regex);
        if (m?.[group]) {
          const episode = parseInt(m[group], 10);
          if (!isNaN(episode) && episode > 0 && episode < 2000) return episode;
        }
      }
    }
    return undefined;
  }

  private extractEpisodeList(torrent: TorrentLike): number[] | undefined {
    const record = torrent as Record<string, unknown>;
    const candidates = [
      record.episodes,
      record.episodeList,
      record.episode_list,
      record.episodeNumbers,
      record.episode_numbers,
      record.filesEpisodes,
      record.parts,
    ];

    const numbers = new Set<number>();

    const addValue = (value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        numbers.add(Math.floor(value));
        return;
      }

      if (typeof value === 'string') {
        const matches = value.match(/\d+/g);
        if (matches) {
          matches.forEach((match) => {
            const parsed = Number(match);
            if (!Number.isNaN(parsed)) {
              numbers.add(parsed);
            }
          });
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(addValue);
        return;
      }

      if (value && typeof value === 'object') {
        for (const item of Object.values(value as Record<string, unknown>)) {
          addValue(item);
        }
      }
    };

    candidates.forEach(addValue);

    // Auto-detect episode ranges from title like "E01-E10", "EP01-EP10", "Episodio 1 ao 10"
    if (numbers.size === 0) {
      const texts = this.collectSearchableTexts(torrent);
      for (const text of texts) {
        if (!text) continue;
        // E01-E10, EP01-EP10, E01~E10
        const rangeMatch = text.match(/\bE(?:P)?\.?\s*(\d{1,3})\s*[-~]\s*E(?:P)?\.?\s*(\d{1,3})\b/i);
        if (rangeMatch?.[1] && rangeMatch?.[2]) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start && end - start < 100) {
            for (let i = start; i <= end; i++) numbers.add(i);
            break;
          }
        }
        // "Episodio 1 ao 10", "EpisÃ³dio 1 a 10"
        const ptRangeMatch = text.match(/\b(?:epis[oÃ³]dio|episodio|cap[iÃ­]tulo|capitulo)\s*(\d{1,3})\s*(?:a|ao|atÃ©|~|-)\s*(\d{1,3})\b/i);
        if (ptRangeMatch?.[1] && ptRangeMatch?.[2]) {
          const start = parseInt(ptRangeMatch[1], 10);
          const end = parseInt(ptRangeMatch[2], 10);
          if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start && end - start < 100) {
            for (let i = start; i <= end; i++) numbers.add(i);
            break;
          }
        }
      }
    }

    if (numbers.size === 0) {
      return undefined;
    }

    return Array.from(numbers).sort((a, b) => a - b);
  }

  private normalizeForComparison(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '')
      .toLowerCase();
  }

  private collectMetaTitles(meta?: CinemetaMeta): string[] {
    if (!meta) {
      return [];
    }

    const titles = new Set<string>();
    const addIfString = (value?: unknown) => {
      if (typeof value === 'string') {
        const sanitized = this.sanitizeQuery(value);
        if (sanitized) {
          titles.add(sanitized);
        }
      }
    };

    const explore = (value: unknown, depth = 0) => {
      if (depth > 3 || !value) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => explore(item, depth + 1));
        return;
      }

      if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        for (const [key, val] of Object.entries(record)) {
          if (/title|name/i.test(key)) {
            if (typeof val === 'string') {
              addIfString(val);
            } else {
              explore(val, depth + 1);
            }
          }
        }
      }
    };

    addIfString(meta.name);
    addIfString(meta.title);
    addIfString(meta.originalTitle);

    const alternativeKeys = ['aliases', 'alternativeTitles', 'alternative_titles', 'aka'];
    for (const key of alternativeKeys) {
      const value = (meta as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        value.forEach(addIfString);
      }
    }

    explore(meta.translations);
    explore(meta.infos);

    return Array.from(titles);
  }

  private extractReleaseYear(meta?: CinemetaMeta): number | undefined {
    if (!meta) {
      return undefined;
    }

    const directYear = (meta.year ?? (meta as Record<string, unknown>).releaseYear ?? (meta as Record<string, unknown>).released) as unknown;
    if (typeof directYear === 'number' && Number.isFinite(directYear)) {
      return directYear;
    }

    if (typeof directYear === 'string') {
      const match = directYear.match(/\d{4}/);
      if (match) {
        return Number(match[0]);
      }
    }

    if (typeof meta.releaseInfo === 'string') {
      const match = meta.releaseInfo.match(/\d{4}/);
      if (match) {
        return Number(match[0]);
      }
    }

    return undefined;
  }

  private findEpisodeTitle(meta: CinemetaMeta | undefined, season: number, episode: number): string | undefined {
    if (!meta || !Array.isArray(meta.videos)) {
      return undefined;
    }

    const match = meta.videos.find((video) => {
      const videoSeason = typeof video.season === 'number' ? video.season : Number(video.season);
      const videoEpisode = typeof video.episode === 'number' ? video.episode : Number(video.episode);
      return videoSeason === season && videoEpisode === episode;
    });

    if (!match) {
      return undefined;
    }

    const candidates = [match.title, match.name];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const sanitized = this.sanitizeQuery(candidate);
      if (sanitized) {
        return sanitized;
      }
    }

    return undefined;
  }

private mapTorrentToStream(
  torrent: TorrentLike,
  fallbackTitle: string,
  context: MatchContext
): SourceStream | undefined {
  if (!torrent || typeof torrent !== 'object') {
    return undefined;
  }

  const magnet = this.extractMagnet(torrent);
  if (!magnet) {
    return undefined;
  }

  // Reject torrents where the total size is suspiciously small (likely fake/ad)
  const totalSize = this.extractSize(torrent);
  if (typeof totalSize === 'number' && totalSize > 0 && totalSize < TorrentIndexerProvider.MIN_VIDEO_SIZE) {
    return undefined;
  }

  const rawTitle = this.extractTitle(torrent) || fallbackTitle || `${this.name} Torrent`;
  const detailUrl = this.extractDetailUrl(torrent);

  const sourceLabel =
    this.extractSourceDomain(torrent) ||
    this.extractIndexerName(torrent) ||
    this.titleize(this.name);

  const selectedFile = this.selectBestTorrentFile(torrent, context);
  const selectedFileName = selectedFile?.path;
  const fileIdx = selectedFile?.originalIndex;

  // Use the selected video file's basename as the display title when available.
  // This avoids showing slug/site junk from the indexer.
  let displayTitle: string;
  if (selectedFileName) {
    const basename = selectedFileName.replace(/^.*[\\/]/, '');
    displayTitle = this.cleanIndexerTitle(basename);
  } else {
    displayTitle = this.cleanIndexerTitle(this.buildDisplayTitle(torrent, rawTitle));
  }

  // Parse size â€” the indexer may return a string like "4.06 GB"
  const rawSize = selectedFile?.size ?? this.extractSize(torrent);
  const size = typeof rawSize === 'number' ? rawSize : this.parseSizeString(rawSize);

  const releaseYear = this.extractYear(torrent);
  const rawQuality =
    (torrent as Record<string, unknown>).quality ||
    (torrent as Record<string, unknown>).resolution ||
    this.inferQualityFromTitle(displayTitle) ||
    this.inferQualityFromTitle(rawTitle);
  const quality = this.normalizeQuality(rawQuality);
  const releaseGroup =
    (torrent as Record<string, unknown>).releaseGroup ||
    (torrent as Record<string, unknown>).group ||
    (torrent as Record<string, unknown>).uploader ||
    (torrent as Record<string, unknown>).source;

  const seeds = this.extractSeeders(torrent);
  const seedCount = seeds !== undefined ? Math.max(0, Math.floor(seeds)) : 0;

  const infoSegments: string[] = [`ðŸ‘¤ ${seedCount}`];
  if (size !== undefined && size > 0) {
    infoSegments.push(`ðŸ’¾ ${this.formatSize(size)}`);
  }
  infoSegments.push(`âš™ï¸ [${sourceLabel}]`);

  const audioLine = this.formatAudioLine(torrent);
  const languages = this.extractAudioLanguages(torrent);

  const headline = quality ? `${displayTitle} [${quality}]` : displayTitle;
  const titleLines = [headline];
  if (infoSegments.some((segment) => segment.trim().length > 0)) {
    titleLines.push(infoSegments.join(' '));
  }
  if (audioLine) {
    titleLines.push(audioLine);
  }

  if (detailUrl) {
    titleLines.push(`ðŸ“¡ ${detailUrl}`);
  }

  const qualityLabel = quality ?? 'RD';
  const nameLines = [`[${sourceLabel}]`];
  if (qualityLabel) {
    nameLines.push(qualityLabel);
  }

  const stream: SourceStream = {
    name: nameLines.join('\n'),
    title: titleLines.join('\n'),
    fileName: this.buildStreamFileName(selectedFileName, rawTitle, displayTitle, torrent),
    source: sourceLabel,
    magnet,
    cached: false
  };

  if (detailUrl) {
    stream.detailUrl = detailUrl;
  }

  if (languages.length > 0) {
    stream.languages = languages;
  }

  const infoHash =
    (torrent as Record<string, unknown>).infoHash ||
    (torrent as Record<string, unknown>).info_hash ||
    (torrent as Record<string, unknown>).hash ||
    (torrent as Record<string, unknown>).btih ||
    this.extractInfoHash(magnet);

  if (typeof infoHash === 'string' && infoHash) {
    stream.infoHash = infoHash.trim().toLowerCase();
  }

  // fileIdx is essential for season packs so AIOStreams/debrid knows which file to play.
  // When the API provides files[], selectBestTorrentFile gives us the exact index.
  // When files[] is absent (common for older BR packs), we estimate fileIdx from
  // the episode number â€” BR packs almost universally sort files by episode order.
  if (fileIdx !== undefined && fileIdx >= 0) {
    stream.fileIdx = fileIdx;
  } else if (
    context.parsed.season !== undefined &&
    context.parsed.episode !== undefined &&
    context.parsed.episode > 0 &&
    this.looksLikeSeasonPack(torrent, context)
  ) {
    // Estimate: episode N is usually at file index N-1 (0-indexed)
    const estimatedIdx = context.parsed.episode - 1;
    stream.fileIdx = estimatedIdx;

    // Build a synthetic fileName so AIOStreams can display episode info
    if (!selectedFileName) {
      const sPad = String(context.parsed.season).padStart(2, '0');
      const ePad = String(context.parsed.episode).padStart(2, '0');
      const cleanTitle = this.cleanIndexerTitle(rawTitle);
      stream.fileName = `${cleanTitle}/S${sPad}E${ePad}.mkv`;
    }
  }

  if (size !== undefined) {
    stream.size = size;
  }

  if (seeds !== undefined) {
    stream.seeders = seeds;
  }

  if (quality) {
    stream.quality = quality;
  }

  if (typeof releaseGroup === 'string' && releaseGroup.trim()) {
    stream.releaseGroup = releaseGroup.trim();
  }

  const episodeList = this.extractEpisodeList(torrent);
  const streamContext: StreamContext = {};

  if (context.type) {
    streamContext.type = context.type;
  }

  if (context.parsed.season !== undefined) {
    streamContext.season = context.parsed.season;
  }

  if (context.parsed.episode !== undefined) {
    streamContext.episode = context.parsed.episode;
  }

  if (context.episodeTitle) {
    streamContext.episodeTitle = context.episodeTitle;
  }

  if (displayTitle) {
    streamContext.title = displayTitle;
  }

  const combinedYear = releaseYear ?? context.releaseYear;
  if (combinedYear !== undefined) {
    streamContext.year = combinedYear;
  }

  if (episodeList && episodeList.length > 0) {
    streamContext.episodeList = episodeList;
  }

  if (Object.keys(streamContext).length > 0) {
    stream.context = streamContext;
  }

  return stream;
}

  /**
   * Build a proper folder/file path for AIOStreams display.
   * When a file was selected from a pack, ensures the path includes a folder prefix
   * so AIOStreams can show: ðŸ“ Folder Name / ðŸ“„ filename.mkv
   */
  private buildStreamFileName(
    selectedFilePath: string | undefined,
    rawTorrentTitle: string,
    displayTitle: string,
    torrent: TorrentLike
  ): string {
    const fallback = displayTitle || this.extractFileName(torrent) || rawTorrentTitle;

    if (!selectedFilePath) {
      // No file selected from a pack â€” return clean title (likely a single-file torrent)
      return fallback;
    }

    // If the path already has a folder prefix (contains / or \), use it as-is
    if (/[/\\]/.test(selectedFilePath)) {
      return selectedFilePath;
    }

    // The file path is just a bare filename (e.g. "2 - Sick.mp4").
    // Prepend the torrent title as a folder name so AIOStreams shows:
    //   ðŸ“ The Walking Dead 3Âª Temporada (2012)
    //   ðŸ“„ 2 - Sick.mp4
    const folderName = this.cleanIndexerTitle(rawTorrentTitle)
      .replace(/\.(mkv|mp4|avi|m4v|ts|m2ts|iso)$/i, '') // remove extension if present
      .replace(/[<>:"|?*]/g, '') // remove invalid path chars
      .trim();

    if (folderName) {
      return `${folderName}/${selectedFilePath}`;
    }

    return selectedFilePath;
  }

  /**
   * Detect whether a torrent looks like a full-season pack without individual file listings.
   * This is used to decide whether to estimate fileIdx from the episode number.
   */
  private looksLikeSeasonPack(torrent: TorrentLike, context: MatchContext): boolean {
    // If the API already gave us files, selectBestTorrentFile handled it
    const filesRaw = (torrent as Record<string, unknown>).files;
    if (Array.isArray(filesRaw) && filesRaw.length > 0) {
      return false;
    }

    const texts = this.collectSearchableTexts(torrent);
    const combined = texts.join(' ');

    // Check if this looks like a complete series or multi-season pack
    if (this.isCompleteSeriesPack(texts)) {
      return true;
    }

    // Check for season ranges
    const range = this.extractSeasonRangeFromTexts(texts);
    if (range && context.parsed.season !== undefined) {
      return context.parsed.season >= range.start && context.parsed.season <= range.end;
    }

    // Check if title mentions a season but NOT a specific single episode
    const hasSeason = /\b(temporada|season|S\d{1,2}(?!E\d)|T\d{1,2}|\d{1,2}[ªºa]\s*temp)/i.test(combined);
    const hasSingleEp = /\bS\d{1,3}E\d{1,3}\b/i.test(combined) ||
      /\b\d{1,2}[x×]\d{1,3}\b/i.test(combined) ||
      /\bE(?:P)?\.?\s*\d{1,3}\b/i.test(combined);

    // It's a pack if it mentions a season but not a specific episode
    return hasSeason && !hasSingleEp;
  }

  private buildDisplayTitle(torrent: TorrentLike, fallbackTitle: string): string {
    let title = fallbackTitle;

    const extracted = this.extractTitle(torrent);
    if (extracted && extracted.trim()) {
      title = extracted.trim();
    }

    const year = this.extractYear(torrent);
    if (year !== undefined && !new RegExp(`\\b${year}\\b`).test(title)) {
      title = `${title} (${year})`;
    }

    const season = this.extractSeasonFromTorrent(torrent);
    if (season !== undefined) {
      const seasonToken = `S${String(season).padStart(2, '0')}`;
      const episode = this.extractEpisodeFromTorrent(torrent);
      const episodeToken = episode !== undefined ? `E${String(episode).padStart(2, '0')}` : undefined;
      const code = episodeToken ? `${seasonToken}${episodeToken}` : seasonToken;

      if (!new RegExp(seasonToken, 'i').test(title) && (!episodeToken || !new RegExp(episodeToken, 'i').test(title))) {
        title = `${title} ${code}`;
      }
    }

    return title;
  }

  private normalizeQuality(quality: unknown): string | undefined {
    if (typeof quality !== 'string') {
      return undefined;
    }

    const trimmed = quality.trim();
    if (!trimmed) {
      return undefined;
    }

    if (/\b(4k|UHD|2160p)\b/i.test(trimmed)) return '4K';
    if (/\b(FHD|FULLHD)\b/i.test(trimmed)) return '1080p';
    if (/\bSD\b/i.test(trimmed)) return '480p';

    const match = trimmed.match(/(\d{3,4}p)/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }

    return trimmed.replace(/\s+/g, ' ');
  }

  private formatAudioLine(torrent: TorrentLike): string | undefined {
    const languages = this.extractAudioLanguages(torrent);
    if (languages.length === 0) {
      return undefined;
    }

    const decorated = languages.map((language) => this.mapLanguageToDisplay(language));


    return `${decorated.join(' / ')}`;
  }

  private extractAudioLanguages(torrent: TorrentLike): string[] {
    const record = torrent as Record<string, unknown>;
    const languages = new Set<string>();
    let sawDualAudio = false;

    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const addFromText = (text: string) => {
      const normalized = this.normalizeLanguageKey(text);
      const tokenized = normalized.replace(/[^a-z0-9]+/g, ' ').trim();

      if (/\bdual\s*audio\b|\bmulti\s*audio\b/.test(tokenized)) {
        sawDualAudio = true;
      }

      for (const [alias, canonical] of Object.entries(LANGUAGE_ALIASES)) {
        const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
        if (pattern.test(normalized) || pattern.test(tokenized)) {
          languages.add(canonical);
        }
      }
    };

    const addLanguage = (value: unknown) => {
      if (!value) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(addLanguage);
        return;
      }

      if (typeof value === 'string') {
        addFromText(value);
      }
    };

    addLanguage(record.audio);
    addLanguage(record.audios);
    addLanguage(record.audio_tracks);
    addLanguage(record.audioTracks);
    addLanguage(record.audio_languages);
    addLanguage(record.audioLanguages);
    addLanguage(record.languages);
    addLanguage(record.language);
    addLanguage(record.lang);
    addLanguage(record.title);
    addLanguage(record.original_title);
    addLanguage(record.name);
    addLanguage(record.filename);
    addLanguage(record.release);
    addLanguage(record.file);
    addLanguage(record.displayName);
    addLanguage(record.description);
    addLanguage(record.summary);
    addLanguage(record.plot);
    addLanguage(record.synopsis);
    addLanguage(record.details);
    addLanguage(record.slug);
    addLanguage(record.category);
    addLanguage(record.subcategory);

    const tags = record.tags ?? record.categories;
    if (Array.isArray(tags)) {
      tags.forEach(addLanguage);
    }

    if (sawDualAudio && languages.has('Portuguese') && !languages.has('English')) {
      languages.add('English');
    }

    return Array.from(languages);
  }

  private static readonly MIN_VIDEO_SIZE = 5 * 1024 * 1024; // 5 MB â€” anything smaller is junk/ads

  private selectBestTorrentFile(torrent: TorrentLike, context: MatchContext): IndexedTorrentFile | undefined {
    const files = this.extractFilesFromTorrent(torrent);
    if (files.length === 0) {
      return undefined;
    }

    const scored = files
      .map((file) => ({ file, score: this.scoreTorrentFile(file, context) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.file.size ?? 0) - (a.file.size ?? 0);
      });

    const best = scored[0]?.file;

    // Reject if the best file is too small â€” likely an ad MP4 or NFO
    if (best && best.size !== undefined && best.size < TorrentIndexerProvider.MIN_VIDEO_SIZE) {
      return undefined;
    }

    return best;
  }

  private scoreTorrentFile(file: IndexedTorrentFile, context: MatchContext): number {
    const normalizedPath = this.normalizeForComparison(file.path);
    const normalizedType = context.type.toLowerCase();
    let score = 0;

    // Prefer real video files and penalize common junk files.
    if (this.isVideoPath(file.path)) score += 30;
    if (/\b(sample|trailer|extras?|bonus|featurette|behindthescenes|creditos|poster|rarbg|nfo|subs?|propaganda|anuncio|promo|preview|teaser)\b/i.test(file.path)) {
      score -= 25;
    }
    if (/\.(txt|url|nfo|jpg|jpeg|png|gif|bmp|ico|md|html|htm|exe|bat|lnk|srt|sub|ass|ssa|idx)$/i.test(file.path)) {
      score -= 40;
    }

    // Penalize tiny files â€” almost certainly ads, readme, or fake content
    if (file.size !== undefined && file.size < TorrentIndexerProvider.MIN_VIDEO_SIZE) {
      score -= 50;
    }

    for (const title of context.targetTitles) {
      const normalizedTitle = this.normalizeForComparison(title);
      if (!normalizedTitle) continue;
      if (normalizedPath.includes(normalizedTitle)) {
        score += 10;
        break;
      }
    }

    if (context.releaseYear && normalizedPath.includes(String(context.releaseYear))) {
      score += 6;
    }

    const fileSeason = this.extractSeasonFromTorrent({ title: file.path });
    const fileEpisode = this.extractEpisodeFromTorrent({ title: file.path });
    const episodeList = this.extractEpisodeList({ title: file.path, filesEpisodes: file.path });

    if (normalizedType === 'movie') {
      if (fileSeason !== undefined || fileEpisode !== undefined) {
        score -= 20;
      }
      if (EPISODIC_HINT_REGEX.test(file.path)) {
        score -= 12;
      }
    } else if (context.parsed.season !== undefined) {
      if (fileSeason !== undefined) {
        score += fileSeason === context.parsed.season ? 12 : -18;
      }
      if (context.parsed.episode !== undefined) {
        if (fileEpisode !== undefined) {
          score += fileEpisode === context.parsed.episode ? 18 : -24;
        }
        if (episodeList && episodeList.length > 0) {
          score += episodeList.includes(context.parsed.episode) ? 14 : -24;
        }
      }
    }

    score += Math.log10((file.size ?? 0) + 1);

    // Prefer Portuguese-language files (Dublado > Legendado > unmarked)
    const lowerPath = file.path.toLowerCase();
    if (/\b(dublado|dublada|dual|ptbr|pt[\s._-]?br|nacional)\b/i.test(lowerPath)) {
      score += 8;
    } else if (/\b(legendado|leg)\b/i.test(lowerPath)) {
      score += 3;
    }

    return score;
  }

  private extractFilesFromTorrent(torrent: TorrentLike): IndexedTorrentFile[] {
    const filesRaw = (torrent as Record<string, unknown>).files;
    if (!Array.isArray(filesRaw)) {
      return [];
    }

    const files: IndexedTorrentFile[] = [];
    for (let i = 0; i < filesRaw.length; i++) {
      const entry = filesRaw[i];
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const pathCandidate = this.toString(record.path) || this.toString(record.name) || this.toString(record.file);
      if (!pathCandidate || !pathCandidate.trim()) continue;

      const sizeRaw = record.size ?? record.sizeBytes ?? record.size_bytes ?? record.bytes;
      const size = this.toBytes(sizeRaw);
      files.push({ path: pathCandidate.trim(), size, originalIndex: i });
    }

    return files;
  }

  private toBytes(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const numeric = Number(trimmed.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(numeric)) {
      return undefined;
    }

    if (/\b(tb|terabyte)/i.test(trimmed)) return Math.round(numeric * 1024 * 1024 * 1024 * 1024);
    if (/\b(gb|gigabyte)/i.test(trimmed)) return Math.round(numeric * 1024 * 1024 * 1024);
    if (/\b(mb|megabyte)/i.test(trimmed)) return Math.round(numeric * 1024 * 1024);
    if (/\b(kb|kilobyte)/i.test(trimmed)) return Math.round(numeric * 1024);
    return Math.round(numeric);
  }

  private isVideoPath(path: string): boolean {
    return /\.(mkv|mp4|avi|m4v|ts|m2ts|mov|wmv|flv|webm|mpg|mpeg|iso)$/i.test(path);
  }

  private mapLanguageToDisplay(language: string): string {
    const key = this.normalizeLanguageKey(language);
    return LANGUAGE_FLAG_MAP[key] ?? language;
  }

  private normalizeLanguageKey(language: string): string {
    return language
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private extractDetailUrl(torrent: TorrentLike): string | undefined {
    const record = torrent as Record<string, unknown>;
    const candidates = [
      this.toString(record.details),
      this.toString(record.detail_url),
      this.toString(record.detailUrl),
      this.toString(record.page),
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const normalized = this.normalizeToUrl(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  private extractFileName(torrent: TorrentLike): string | undefined {
    const record = torrent as Record<string, unknown>;
    const candidates = [
      this.toString(record.filename),
      this.toString(record.file),
      this.toString(record.path),
      this.toString(record.name),
      this.toString(record.title)
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const trimmed = candidate.trim();
      if (!trimmed) {
        continue;
      }

      return trimmed;
    }

    return undefined;
  }

  private static readonly SITE_LABEL_MAP: Record<string, string> = {
    'comando.la': 'Comando',
    'comando.to': 'Comando',
    'comandofilmes.net': 'Comando',
    'comandotorrents.com': 'Comando',
    'bludv.xyz': 'BluDV',
    'bludv1.xyz': 'BluDV',
    'bludv.org': 'BluDV',
    'bludv.net': 'BluDV',
    'bludv-v1.xyz': 'BluDV',
    'bludv.tv': 'BluDV',
    'bludv.in': 'BluDV',
    'redetorrent.com': 'RedeTorrent',
    'vacatorrent.com': 'VacaTorrent',
    'vacatorrentmov.com': 'VacaTorrent',
    'lapumia.org': 'LAPUMiA',
    'ondebaixa.com': 'OndeBaixa',
    'torrentdosfilmes.se': 'TorrentDosFilmes',
    'thepiratefilmes.com': 'ThePirateFilmes',
    'starckfilmes.com': 'StarckFilmes',
    'torrentmovies.co': 'TorrentMovies',
    'sitedetorrents.com': 'SiteDeTorrents',
    'ytsbr.com': 'YTSBR',
    'limaotorrent.org': 'LimÃ£oTorrent',
    'baixarfilmetorrent.net': 'BaixarFilme',
    'thepiratebay.org': 'TPB',
    'rarbg.to': 'RARBG',
    '1337x.to': '1337x',
    'nyaa.si': 'Nyaa',
    'yts.mx': 'YTS',
  };

  private extractSourceDomain(torrent: TorrentLike): string | undefined {
    const record = torrent as Record<string, unknown>;
    const candidates = [
      this.toString(record.details),
      this.toString(record.detail_url),
      this.toString(record.detailUrl),
      this.toString(record.page),
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const hostname = this.parseHostname(candidate);
      if (hostname) {
        // Normalize known site hostnames with versioned subdomains
        const baseHost = hostname.replace(/^(www\.)?/, '').replace(/-v\d+/, '').replace(/\d+\./, '.');
        return TorrentIndexerProvider.SITE_LABEL_MAP[hostname]
          ?? TorrentIndexerProvider.SITE_LABEL_MAP[baseHost]
          ?? hostname;
      }
    }

    return undefined;
  }

  private normalizeToUrl(raw: string): string | undefined {
    let candidate = raw.trim();
    if (!candidate) {
      return undefined;
    }

    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }

    try {
      const url = new URL(candidate);
      return url.toString();
    } catch {
      return undefined;
    }
  }

  private parseHostname(raw: string): string | undefined {
    let candidate = raw.trim();
    if (!candidate) {
      return undefined;
    }

    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }

    try {
      const url = new URL(candidate);
      const hostname = url.hostname.replace(/^www\./i, '');
      if (hostname) {
        return hostname.toLowerCase();
      }
    } catch {
      // Ignore invalid URLs
    }

    return undefined;
  }

  private extractIndexerName(torrent: TorrentLike): string | undefined {
    const record = torrent as Record<string, unknown>;
    const candidate =
      record.indexer ||
      record.indexerName ||
      record.indexer_name ||
      record.source ||
      record.provider ||
      record.origin ||
      record.site;

    if (typeof candidate === 'string' && candidate.trim()) {
      const sanitized = this.sanitizeQuery(candidate) ?? candidate.trim();
      return this.titleize(sanitized);
    }

    return undefined;
  }

  private formatSize(size: number): string {
    if (!Number.isFinite(size) || size <= 0) {
      return 'Unknown size';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = size;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    if (unitIndex === 0) {
      return `${Math.round(value)} ${units[unitIndex]}`;
    }

    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
  }

  private extractMagnet(torrent: TorrentLike): string | undefined {
    const record = torrent as Record<string, unknown>;
    const magnet =
      this.toString(record.magnet_link) ||
      this.toString(record.magnet) ||
      this.toString(record.url) ||
      this.toString(record.link);

    if (magnet && magnet.startsWith('magnet:')) {
      return magnet;
    }

    return undefined;
  }

  private extractTitle(torrent: TorrentLike): string | undefined {
    const record = torrent as Record<string, unknown>;
    const title =
      this.toString(record.title) ||
      this.toString(record.original_title) ||
      this.toString(record.name) ||
      this.toString(record.filename) ||
      this.toString(record.release) ||
      this.toString(record.file) ||
      this.toString(record.slug) ||
      this.toString(record.displayName);

    if (title && title.trim()) {
      return title.trim();
    }

    return undefined;
  }

  private extractInfoHash(magnet: string): string | undefined {
    const match = magnet.match(/btih:([^&]+)/i);
    return match?.[1];
  }

  /**
   * Clean dirty titles from Brazilian indexer sites.
   * Removes site slug prefixes, double dots, duplicate extensions, etc.
   */
  private cleanIndexerTitle(title: string): string {
    let cleaned = title;

    // Remove [EVITE.COPIAS...] and similar bracketed spam prefixes
    cleaned = cleaned.replace(/^\[(?:EVITE|BAIXE|DOWNLOAD|WWW)[^\]]*\]\s*/gi, '');

    // Remove "EVITE.COPIAS.BAIXE.NO." prefix without brackets
    cleaned = cleaned.replace(/^EVITE\.COPIAS\.[^.]*\./i, '');

    // Remove known site prefixes that get concatenated into titles
    cleaned = cleaned.replace(/^(SITEDETORRENTS\.COM\.?|WWW\.BLUDV\.(COM|TV|IN)\.?|BLUDV\.(COM|TV|IN)\.?|WWW\.THEPIRATEFILMES\.COM\.?|THEPIRATEFILMES\.COM\.?|YTSBR\.COM\.?|WWW\.COMANDOTORRENTS\.COM\.?|COMANDOTORRENTS\.COM\.?)/gi, '');

    // Remove leading dots/dashes/underscores/spaces
    cleaned = cleaned.replace(/^[.\-_\s]+/, '');

    // Brazilian indexer slug pattern: metadata-prefix separated by ".." from the actual title
    const doubleDotIdx = cleaned.indexOf('..');
    if (doubleDotIdx > 0) {
      const afterDoubleDot = cleaned.slice(doubleDotIdx).replace(/^\.+/, '');
      if (afterDoubleDot && /^[A-Za-z]/.test(afterDoubleDot)) {
        cleaned = afterDoubleDot;
      }
    }

    // Remove duplicate extensions like .MKV.MKV., .MP4.MP4.
    cleaned = cleaned.replace(/\.(MKV|MP4|AVI|M4V|TS)\.\1\./gi, '.$1.');

    // Remove trailing file extension for display
    cleaned = cleaned.replace(/\.(mkv|mp4|avi|m4v|ts|m2ts|iso)$/i, '');

    // Remove orphaned parenthetical language tags from the indexer
    cleaned = cleaned.replace(/\s*\((brazilian|eng|portuguese|portugues|english|spanish|espanhol|dublado|legendado|nacional)(?:\s*,\s*(brazilian|eng|portuguese|portugues|english|spanish|espanhol|dublado|legendado|nacional))*\)\s*$/i, '');

    // Clean up ugly slug patterns: .-LEGENDADO-., .-DUBLADO-.
    cleaned = cleaned.replace(/\.-([A-Z]+)-\./g, ' $1 ');

    // Remove trailing site domain junk like "-comando.la" or "-WWW.COMANDOTORRENTS.COM"
    cleaned = cleaned.replace(/[-.](?:www\.)?(?:comando(?:torrents|filmes)?\.(?:la|com|net)|bludv\.[a-z]+|thepiratefilmes\.com|sitedetorrents\.com)$/i, '');

    // Collapse multiple dots/spaces
    cleaned = cleaned.replace(/\.{2,}/g, '.').replace(/\s{2,}/g, ' ').trim();

    // Remove leading dots/dashes/underscores after all cleaning
    cleaned = cleaned.replace(/^[.\-_\s]+/, '');

    return cleaned || title;
  }

  /**
   * Parse size strings like "4.06 GB", "19.72 GB", "711 MB" into bytes.
   */
  private parseSizeString(value: unknown): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const match = trimmed.match(/([\d.]+)\s*(TB|GB|MB|KB|B)/i);
    if (!match || !match[1] || !match[2]) return undefined;

    const num = parseFloat(match[1]);
    if (isNaN(num)) return undefined;

    const unit = match[2].toUpperCase();
    switch (unit) {
      case 'TB': return Math.round(num * 1024 * 1024 * 1024 * 1024);
      case 'GB': return Math.round(num * 1024 * 1024 * 1024);
      case 'MB': return Math.round(num * 1024 * 1024);
      case 'KB': return Math.round(num * 1024);
      default: return Math.round(num);
    }
  }

  private extractSeeders(torrent: TorrentLike): number | undefined {
    const record = torrent as Record<string, unknown>;
    const candidate =
      record.seeders ??
      record.seed ??
      record.seeds ??
      record.seedCount ??
      record.seed_count ??
      record.peers ??
      record.peer ??
      record.peerCount;

    return this.toNumber(candidate);
  }

  private extractSize(torrent: TorrentLike): number | undefined {
    const record = torrent as Record<string, unknown>;
    const candidate =
      record.size ??
      record.sizeBytes ??
      record.size_bytes ??
      record.bytes ??
      record.filesize ??
      record.length ??
      record.totalSize;

    if (typeof candidate === 'number') {
      return candidate;
    }

    return this.parseSizeString(candidate);
  }

  private inferQualityFromTitle(title: string): string | undefined {
    const match = title.match(/(4k|UHD|2160p|1440p|FHD|FULLHD|1080p|HD|720p|480p|360p)/i);
    if (match?.[1]) {
      const q = match[1].toLowerCase();
      if (q === '4k' || q === 'uhd') return '4K';
      if (q === 'fhd' || q === 'fullhd') return '1080p';
      if (q === 'hd') return '720p';
      return q;
    }

    // Fallback: infer from source tag when no explicit resolution
    if (/\b(blu[\s.-]?ray|bdrip|bdremux|remux)\b/i.test(title)) return '1080p';
    if (/\b(web[\s.-]?dl|webrip)\b/i.test(title)) return '720p';
    if (/\b(hdtv|hdrip)\b/i.test(title)) return '720p';
    if (/\b(dvdrip|dvdscr)\b/i.test(title)) return '480p';
    if (/\b(cam|hdcam|telesync|telecine)\b/i.test(title)) return 'CAM';

    return undefined;
  }

  private normalizeTorrentPayload(payload: unknown): TorrentLike[] {
    if (!payload) {
      return [];
    }

    if (Array.isArray(payload)) {
      return payload as TorrentLike[];
    }

    if (typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const possibleKeys = ['results', 'data', 'items', 'torrents', 'entries'];
      for (const key of possibleKeys) {
        const value = record[key];
        if (Array.isArray(value)) {
          return value as TorrentLike[];
        }
      }

      if (record.torrent) {
        return [record.torrent as TorrentLike];
      }
    }

    return [];
  }

  private sanitizeQuery(raw: string | undefined): string | undefined {
    if (!raw) {
      return undefined;
    }

    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }

    const cleaned = decoded.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return undefined;
    }

    return cleaned;
  }

  private titleize(value: string): string {
    return value
      .split(' ')
      .filter((part) => part.trim().length > 0)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' ');
  }

  private toNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/[^0-9.-]/g, ''));
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return undefined;
  }

  private toString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return undefined;
  }
}
