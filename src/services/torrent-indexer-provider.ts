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

const MAX_STREAMS = 60;
const EPISODIC_HINT_REGEX =
  /(S[0-9]{1,3}(E[0-9]{1,3})?|S[0-9]{1,3}[._ -]?(19|20)[0-9]{2}|[0-9]+x[0-9]+|temporadas?|season|epis[oó]dios?|epis[oó]dio|episode|serie|série|minissérie|mini[\s-]?serie|ep[0-9]+|cap[ií]tulo|capitulo|completa|complete|collection|box\s*set|pack)/i;

const LANGUAGE_FLAG_MAP: Record<string, string> = {
  portugues: '🇧🇷',
  portuguese: '🇧🇷',
  'brazilian portuguese': '🇧🇷',
  ingles: '🇺🇸',
  english: '🇺🇸',
  espanhol: '🇪🇸',
  spanish: '🇪🇸',
  frances: '🇫🇷',
  french: '🇫🇷',
  italiano: '🇮🇹',
  italian: '🇮🇹',
  alemao: '🇩🇪',
  german: '🇩🇪',
  japones: '🇯🇵',
  japanese: '🇯🇵',
  coreano: '🇰🇷',
  korean: '🇰🇷',
  chines: '🇨🇳',
  chinese: '🇨🇳',
  mandarim: '🇨🇳',
  mandarin: '🇨🇳',
  cantones: '🇭🇰',
  cantonese: '🇭🇰',
  russo: '🇷🇺',
  russian: '🇷🇺',
  hindi: '🇮🇳',
  arabe: '🇸🇦',
  arabic: '🇸🇦',
  turco: '🇹🇷',
  turkish: '🇹🇷',
  polones: '🇵🇱',
  polish: '🇵🇱',
  sueco: '🇸🇪',
  swedish: '🇸🇪',
  noruegues: '🇳🇴',
  norwegian: '🇳🇴',
  dinamarques: '🇩🇰',
  danish: '🇩🇰',
  finlandes: '🇫🇮',
  finnish: '🇫🇮',
  tcheco: '🇨🇿',
  czech: '🇨🇿',
  hungaro: '🇭🇺',
  hungarian: '🇭🇺',
  ucraniano: '🇺🇦',
  ukrainian: '🇺🇦',
  tailandes: '🇹🇭',
  thai: '🇹🇭',
  vietnamita: '🇻🇳',
  vietnamese: '🇻🇳',
  holandes: '🇳🇱',
  dutch: '🇳🇱',
  grego: '🇬🇷',
  greek: '🇬🇷',
  hebraico: '🇮🇱',
  hebrew: '🇮🇱',
  romeno: '🇷🇴',
  romanian: '🇷🇴',
  bulgaro: '🇧🇬',
  bulgarian: '🇧🇬',
  croata: '🇭🇷',
  croatian: '🇭🇷',
  islandes: '🇮🇸',
  icelandic: '🇮🇸',
  persa: '🇮🇷',
  persian: '🇮🇷',
  farsi: '🇮🇷',
  latin: '🇻🇦',
  latim: '🇻🇦',
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
    const meta = await this.fetchCinemetaMeta(type, id);
    const displayTitles = this.collectMetaTitles(meta);

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

    const queries: string[] = [];
    if (imdbQuery) {
      queries.push(imdbQuery);
    }
    if (textQuery && textQuery !== imdbQuery) {
      queries.push(textQuery);
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

    for (const query of queries) {
      const torrents = await this.fetchSearchResults(query);
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

        streams.push(stream);
        if (dedupeKey) {
          seen.add(dedupeKey);
        }

        if (streams.length >= MAX_STREAMS) {
          return streams;
        }
      }
    }

    if (streams.length === 0) {
      return streams;
    }

    await this.decorateWithDebrid(streams, options);

    return streams;
  }

  private getDedupeKey(stream: SourceStream): string | undefined {
    if (stream.infoHash) {
      return stream.infoHash.toLowerCase();
    }
    if (stream.magnet) {
      const infoHash = this.extractInfoHash(stream.magnet);
      if (infoHash) {
        return infoHash.toLowerCase();
      }
      return stream.magnet;
    }
    return undefined;
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
  
    // name: adiciona "⚡ RD+" na primeira linha (substitui/remenda RD existente)
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
  
      // prefixa com ⚡ RD+/TB+
      nameLines[0] = `⚡ ${providerLabel}+ ${cleaned}`.trim();
  
      stream.name = nameLines.join('\n');
    }
  
    // title: adiciona [RD+]/[TB+] e linha "Disponível no ..." se necessário
    if (typeof stream.title === 'string' && stream.title.length > 0) {
      const titleLines = stream.title.split('\n');
      const firstLine = titleLines[0] ?? '';
  
      const badgeRegex = /\[(RD|TB)\+\]/i;
      if (!badgeRegex.test(firstLine)) {
        titleLines[0] = `${firstLine} [${providerLabel}+]`.trim();
      }
  
      if (!titleLines.some((line) => new RegExp(`Dispon[ií]vel no ${providerName}`, 'i').test(line))) {
        titleLines.push(`Disponível no ${providerName}`);
      }
  
      stream.title = titleLines.join('\n');
    }
  }
  

  private async fetchSearchResults(query: string): Promise<TorrentLike[]> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);

    try {
      const response = await request(url.toString());
      if (response.statusCode >= 400) {
        return [];
      }

      const payload = await response.body.json();
      return this.normalizeTorrentPayload(payload);
    } catch {
      return [];
    }
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
    const url = `https://v3-cinemeta.strem.io/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;

    try {
      const response = await request(url);
      if (response.statusCode >= 400) {
        return undefined;
      }

      const payload = (await response.body.json()) as Record<string, unknown>;
      const meta = payload?.meta ?? payload;
      if (meta && typeof meta === 'object') {
        return meta as CinemetaMeta;
      }
    } catch {
      // Ignore Cinemeta errors
    }

    return undefined;
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

  private isRelevantTorrent(torrent: TorrentLike, context: MatchContext): boolean {
    const { parsed, type, targetTitles, releaseYear } = context;
    const normalizedType = type.toLowerCase();
    const imdb = this.extractImdb(torrent);

    // Title-based check: only for non-IMDB searches
    if (!parsed.imdbId || !imdb) {
      const torrentTitles = this.collectTorrentTitles(torrent);
      if (targetTitles.length > 0 && torrentTitles.length > 0) {
        const normalizedTargets = targetTitles.map((title) => this.normalizeForComparison(title));
        const normalizedTorrentTitles = torrentTitles.map((title) => this.normalizeForComparison(title));

        const matchesTitle = normalizedTorrentTitles.some((torrentTitle) =>
          normalizedTargets.some((targetTitle) => torrentTitle.includes(targetTitle) || targetTitle.includes(torrentTitle)),
        );

        if (!matchesTitle) {
          return false;
        }
      }
    } else if (imdb.toLowerCase() !== parsed.imdbId.toLowerCase()) {
      // IMDB mismatch
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

    // Season/episode filtering — applies to ALL series results (including IMDB matches)
    if (normalizedType !== 'movie' && parsed.season !== undefined) {
      const torrentSeason = this.extractSeasonFromTorrent(torrent);
      if (torrentSeason !== undefined && torrentSeason !== parsed.season) {
        return false;
      }

      if (parsed.episode !== undefined) {
        const torrentEpisode = this.extractEpisodeFromTorrent(torrent);
        // If torrent has a specific episode and it doesn't match, reject.
        // But if torrentEpisode is undefined, it might be a season pack — allow it.
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
    const imdb =
      this.toString(record.imdb) ||
      this.toString(record.imdbId) ||
      this.toString(record.imdb_id) ||
      this.toString(record['Imdb']) ||
      this.toString(record['IMDB']);

    if (imdb && /^tt\d+$/.test(imdb)) {
      return imdb;
    }

    if (typeof imdb === 'string') {
      const match = imdb.match(/tt\d+/);
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
   * Extract season number from torrent: first from structured fields, then from title text.
   * This is critical because the torrent-indexer does NOT return structured season/episode fields.
   */
  private extractSeasonFromTorrent(torrent: TorrentLike): number | undefined {
    // Try structured fields first
    const structured = this.extractSeason(torrent);
    if (structured !== undefined) return structured;

    // Parse from title text using S01E03 patterns
    const title = this.extractTitle(torrent) || '';
    const match = title.match(/S(\d{1,3})(?:E\d{1,3})?/i);
    if (match?.[1]) {
      const season = parseInt(match[1], 10);
      if (!isNaN(season)) return season;
    }

    // Try "1x03" pattern
    const altMatch = title.match(/(\d{1,2})x(\d{1,3})/i);
    if (altMatch?.[1]) {
      const season = parseInt(altMatch[1], 10);
      if (!isNaN(season)) return season;
    }

    // Try "Temporada X" / "Season X"
    const wordMatch = title.match(/(?:temporada|season)\s*(\d{1,3})/i);
    if (wordMatch?.[1]) {
      const season = parseInt(wordMatch[1], 10);
      if (!isNaN(season)) return season;
    }

    return undefined;
  }

  /**
   * Extract episode number from torrent: first from structured fields, then from title text.
   */
  private extractEpisodeFromTorrent(torrent: TorrentLike): number | undefined {
    // Try structured fields first
    const structured = this.extractEpisode(torrent);
    if (structured !== undefined) return structured;

    // Parse from title text using S01E03 pattern
    const title = this.extractTitle(torrent) || '';
    const match = title.match(/S\d{1,3}E(\d{1,3})/i);
    if (match?.[1]) {
      const episode = parseInt(match[1], 10);
      if (!isNaN(episode)) return episode;
    }

    // Try "1x03" pattern
    const altMatch = title.match(/\d{1,2}x(\d{1,3})/i);
    if (altMatch?.[1]) {
      const episode = parseInt(altMatch[1], 10);
      if (!isNaN(episode)) return episode;
    }

    // Try EP03 / E03 standalone
    const epMatch = title.match(/\bE(?:P)?(\d{1,3})\b/i);
    if (epMatch?.[1]) {
      const episode = parseInt(epMatch[1], 10);
      if (!isNaN(episode)) return episode;
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

  // Parse size — the indexer may return a string like "4.06 GB"
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

  const infoSegments: string[] = [`👤 ${seedCount}`];
  if (size !== undefined && size > 0) {
    infoSegments.push(`💾 ${this.formatSize(size)}`);
  }
  infoSegments.push(`⚙️ [${sourceLabel}]`);

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
    titleLines.push(`📡 ${detailUrl}`);
  }

  const qualityLabel = quality ?? 'RD';
  const nameLines = [`[${sourceLabel}]`];
  if (qualityLabel) {
    nameLines.push(qualityLabel);
  }

  const stream: SourceStream = {
    name: nameLines.join('\n'),
    title: titleLines.join('\n'),
    fileName: selectedFileName || displayTitle || this.extractFileName(torrent),
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

  // fileIdx is essential for season packs so AIOStreams knows which file to play
  if (fileIdx !== undefined && fileIdx >= 0) {
    stream.fileIdx = fileIdx;
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

    if (/^4k$/i.test(trimmed)) {
      return '4K';
    }

    const match = trimmed.match(/(\d{3,4}p)/i);
    if (match?.[1]) {
      const value = match[1].toLowerCase();
      return value === '4k' ? '4K' : value;
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

    return scored[0]?.file;
  }

  private scoreTorrentFile(file: IndexedTorrentFile, context: MatchContext): number {
    const normalizedPath = this.normalizeForComparison(file.path);
    const normalizedType = context.type.toLowerCase();
    let score = 0;

    // Prefer real video files and penalize common junk files.
    if (this.isVideoPath(file.path)) score += 30;
    if (/\b(sample|trailer|extras?|bonus|featurette|behindthescenes|creditos|poster|rarbg|nfo|subs?)\b/i.test(file.path)) {
      score -= 25;
    }
    if (/\.(txt|url|nfo|jpg|jpeg|png|gif|bmp|ico|md)$/i.test(file.path)) {
      score -= 40;
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

    // Remove known site prefixes that get concatenated into titles
    cleaned = cleaned.replace(/^(SITEDETORRENTS\.COM\.?|WWW\.BLUDV\.(COM|TV|IN)\.?|BLUDV\.(COM|TV|IN)\.?|WWW\.THEPIRATEFILMES\.COM\.?|THEPIRATEFILMES\.COM\.?|YTSBR\.COM\.?)/gi, '');

    // Remove leading dots/dashes/underscores/spaces
    cleaned = cleaned.replace(/^[.\-_\s]+/, '');

    // Brazilian indexer slug pattern: metadata-prefix separated by ".." from the actual title
    // e.g. "BLURAY-1080P-5.1-VERSAO-ESTENDIDA-MP4.MP4.-LEGENDADO-..The.Lord.of.the.Rings..."
    const doubleDotIdx = cleaned.indexOf('..');
    if (doubleDotIdx > 0) {
      const afterDoubleDot = cleaned.slice(doubleDotIdx).replace(/^\.+/, '');
      // Only use the part after ".." if it looks like a real title (starts with a letter)
      if (afterDoubleDot && /^[A-Za-z]/.test(afterDoubleDot)) {
        cleaned = afterDoubleDot;
      }
    }

    // Remove duplicate extensions like .MKV.MKV., .MP4.MP4.
    cleaned = cleaned.replace(/\.(MKV|MP4|AVI|M4V|TS)\.\1\./gi, '.$1.');

    // Remove trailing file extension for display
    cleaned = cleaned.replace(/\.(mkv|mp4|avi|m4v|ts|m2ts|iso)$/i, '');

    // Remove orphaned parenthetical language tags from the indexer e.g. "(eng)", "(brazilian, eng)"
    cleaned = cleaned.replace(/\s*\((brazilian|eng|portuguese|portugues|english|spanish|espanhol|dublado|legendado)(?:\s*,\s*(brazilian|eng|portuguese|portugues|english|spanish|espanhol|dublado|legendado))*\)\s*$/i, '');

    // Clean up ugly slug patterns: .-LEGENDADO-., .-DUBLADO-.
    cleaned = cleaned.replace(/\.-([A-Z]+)-\./g, ' $1 ');

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

    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      const numeric = Number(trimmed.replace(/[^0-9.]/g, ''));
      if (Number.isNaN(numeric)) {
        return undefined;
      }

      if (/\b(tb|terabyte)/i.test(trimmed)) {
        return Math.round(numeric * 1024 * 1024 * 1024 * 1024);
      }
      if (/\b(gb|gigabyte)/i.test(trimmed)) {
        return Math.round(numeric * 1024 * 1024 * 1024);
      }
      if (/\b(mb|megabyte)/i.test(trimmed)) {
        return Math.round(numeric * 1024 * 1024);
      }
      if (/\b(kb|kilobyte)/i.test(trimmed)) {
        return Math.round(numeric * 1024);
      }
      if (/\b(bytes?|b)\b/i.test(trimmed)) {
        return Math.round(numeric);
      }
    }

    return undefined;
  }

  private inferQualityFromTitle(title: string): string | undefined {
    const match = title.match(/(4k|2160p|1440p|1080p|720p|480p)/i);
    if (!match) {
      return undefined;
    }

    const captured = match[1];
    if (!captured) {
      return undefined;
    }

    const quality = captured.toLowerCase();
    if (quality === '4k') {
      return '4K';
    }

    return quality;
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
