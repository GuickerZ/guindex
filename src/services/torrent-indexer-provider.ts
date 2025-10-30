/**
 * Torrent Indexer Source Provider
 */

import { request } from 'undici';
import { BaseSourceProvider } from './base-source-provider.js';
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

const MAX_STREAMS = 60;

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

  async getStreams(type: string, id: string): Promise<SourceStream[]> {
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

    await this.decorateWithRealDebrid(streams);

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

  private async decorateWithRealDebrid(streams: SourceStream[]): Promise<void> {
    const hashToStreams = new Map<string, SourceStream[]>();

    for (const stream of streams) {
      const hash = this.getStreamInfoHash(stream);
      if (!hash) {
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

    const cachedHashes = await this.fetchCachedHashes([...hashToStreams.keys()]);
    if (cachedHashes.size === 0) {
      return;
    }

    for (const hash of cachedHashes) {
      const related = hashToStreams.get(hash);
      if (!related) {
        continue;
      }

      for (const stream of related) {
        this.applyRealDebridBadge(stream);
      }
    }
  }

  private async fetchCachedHashes(hashes: string[]): Promise<Set<string>> {
    const cached = new Set<string>();
    const chunkSize = 50;

    for (let index = 0; index < hashes.length; index += chunkSize) {
      const chunk = hashes.slice(index, index + chunkSize);
      if (chunk.length === 0) {
        continue;
      }

      const requestHashes = chunk.map((hash) => hash.toUpperCase());
      const endpoint = `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${requestHashes.join('/')}`;

      try {
        const response = await request(endpoint);
        if (response.statusCode >= 400) {
          continue;
        }

        const payload = (await response.body.json()) as Record<string, unknown> | undefined;
        if (!payload || typeof payload !== 'object') {
          continue;
        }

        for (const [key, value] of Object.entries(payload)) {
          if (this.isInstantAvailabilityCached(value)) {
            cached.add(key.toLowerCase());
          }
        }
      } catch {
        // Ignore Real-Debrid availability errors
      }
    }

    return cached;
  }

  private isInstantAvailabilityCached(value: unknown): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Record<string, unknown>;
    const keys = ['rd', 'rdp'];

    for (const key of keys) {
      if (this.hasCachedNested(record[key])) {
        return true;
      }
    }

    return false;
  }

  private hasCachedNested(value: unknown): boolean {
    if (!value) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).some((entry) => this.hasCachedNested(entry));
    }

    return false;
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

  private applyRealDebridBadge(stream: SourceStream): void {
    if (typeof stream.name === 'string' && stream.name.length > 0) {
      const nameLines = stream.name.split('\n');
      const firstLine = nameLines[0] ?? '';
      if (!/RD\+/i.test(firstLine)) {
        const cleaned = firstLine.replace(/\s+RD\+?$/i, '').trim();
        const baseLine = cleaned || firstLine.trim();
        nameLines[0] = `${baseLine} RD+`.trim();
      }
      stream.name = nameLines.join('\n');
    }

    if (typeof stream.title === 'string' && stream.title.length > 0) {
      const titleLines = stream.title.split('\n');
      const firstLine = titleLines[0] ?? '';
      if (!/RD\+/i.test(firstLine)) {
        titleLines[0] = `${firstLine} [RD+]`.trim();
      }
      if (!titleLines.some((line) => /Real-?Debrid/i.test(line))) {
        titleLines.push('Disponível no Real-Debrid');
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

    console.log(targetTitle)
    return targetTitle;
  }

  private isRelevantTorrent(torrent: TorrentLike, context: MatchContext): boolean {
    const { parsed, type, targetTitles, releaseYear } = context;
    const imdb = this.extractImdb(torrent);

    if (parsed.imdbId && imdb) {
      return imdb.toLowerCase() === parsed.imdbId.toLowerCase();
    }

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

    if (type.toLowerCase() === 'movie' && releaseYear !== undefined) {
      const torrentYear = this.extractYear(torrent);
      if (torrentYear !== undefined && Math.abs(torrentYear - releaseYear) > 1) {
        return false;
      }
    }

    if (type.toLowerCase() !== 'movie' && parsed.season !== undefined) {
      const torrentSeason = this.extractSeason(torrent);
      if (torrentSeason !== undefined && torrentSeason !== parsed.season) {
        return false;
      }

      if (parsed.episode !== undefined) {
        const torrentEpisode = this.extractEpisode(torrent);
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

    const baseTitle = this.extractTitle(torrent) || fallbackTitle || `${this.name} Torrent`;
    const displayTitle = this.buildDisplayTitle(torrent, baseTitle);
    const detailUrl = this.extractDetailUrl(torrent);

    const sourceLabel =
      this.extractSourceDomain(torrent) ||
      this.extractIndexerName(torrent) ||
      this.titleize(this.name);

    const size = this.extractSize(torrent);
    const releaseYear = this.extractYear(torrent);
    const rawQuality =
      (torrent as Record<string, unknown>).quality ||
      (torrent as Record<string, unknown>).resolution ||
      this.inferQualityFromTitle(baseTitle);
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
    if (typeof releaseGroup === 'string' && releaseGroup.trim()) {
      infoSegments.push(`⚙️ ${releaseGroup.trim()}`);
    }

    const audioLine = this.formatAudioLine(torrent);

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

    const stream: SourceStream = {
      name: `[${sourceLabel}] Brazuca RD\n${qualityLabel}`,
      title: titleLines.join('\n'),
      magnet,
    };

    const infoHash =
      (torrent as Record<string, unknown>).infoHash ||
      (torrent as Record<string, unknown>).hash ||
      (torrent as Record<string, unknown>).btih ||
      this.extractInfoHash(magnet);

    if (typeof infoHash === 'string' && infoHash) {
      stream.infoHash = infoHash;
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

    const season = this.extractSeason(torrent);
    if (season !== undefined) {
      const seasonToken = `S${String(season).padStart(2, '0')}`;
      const episode = this.extractEpisode(torrent);
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
    const prefix =
      languages.length === 1
        ? 'Áudio'
        : languages.length === 2
          ? 'Dual Audio'
          : 'Multi Audio';

    return `${prefix} / ${decorated.join(' / ')}`;
  }

  private extractAudioLanguages(torrent: TorrentLike): string[] {
    const record = torrent as Record<string, unknown>;
    const languages = new Set<string>();

    const addLanguage = (value: unknown) => {
      if (!value) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(addLanguage);
        return;
      }

      if (typeof value === 'string') {
        const normalizedValue = value.replace(/\s*(?:e|and|\+|&)\s*/gi, ',');
        const segments = normalizedValue.split(/[,/;|]/);
        segments.forEach((segment) => {
          const trimmed = segment.trim();
          if (!trimmed) {
            return;
          }

          const normalized = trimmed.toLowerCase();
          if (/dual audio|multi audio|dublado/.test(normalized)) {
            return;
          }

          const titleized = this.titleize(trimmed);
          if (titleized) {
            languages.add(titleized);
          }
        });
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

    return Array.from(languages);
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
        return hostname;
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
