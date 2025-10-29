/**
 * Torrent Indexer Source Provider
 */

import { request } from 'undici';
import { BaseSourceProvider } from './base-source-provider.js';
import type { SourceStream } from '../models/source-model.js';

interface ParsedIdInfo {
  imdbId?: string;
  tmdbId?: string;
  anilistId?: string;
  kitsuId?: string;
  malId?: string;
  query?: string;
  season?: number;
  episode?: number;
}

export class TorrentIndexerProvider extends BaseSourceProvider {
  constructor(name: string, private baseUrl: string) {
    super(name);
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getStreams(type: string, id: string): Promise<SourceStream[]> {
    const params = this.buildSearchParams(type, id);
    const url = `${this.baseUrl}/api/v1/torrents/search?${params.toString()}`;
    const response = await request(url);

    if (response.statusCode >= 400) {
      throw new Error(`Failed to fetch torrents from ${this.name}: ${response.statusCode}`);
    }

    const payload = await response.body.json() as any;
    const torrents: any[] = Array.isArray(payload)
      ? payload
      : payload?.data || payload?.results || payload?.torrents || [];

    if (!Array.isArray(torrents)) {
      return [];
    }

    return torrents
      .map((torrent) => this.mapTorrentToStream(torrent))
      .filter((stream): stream is SourceStream => !!stream);
  }

  private buildSearchParams(type: string, id: string): URLSearchParams {
    const params = new URLSearchParams();
    const parsed = this.parseId(id);

    const normalizedType = this.normalizeType(type);
    if (normalizedType) {
      params.set('type', normalizedType);
    }

    if (parsed.imdbId) {
      params.set('imdbId', parsed.imdbId);
      params.append('imdb_id', parsed.imdbId);
    }

    if (parsed.tmdbId) {
      params.set('tmdbId', parsed.tmdbId);
      params.append('tmdb_id', parsed.tmdbId);
    }

    if (parsed.anilistId) {
      params.set('anilistId', parsed.anilistId);
      params.append('anilist_id', parsed.anilistId);
    }

    if (parsed.kitsuId) {
      params.set('kitsuId', parsed.kitsuId);
      params.append('kitsu_id', parsed.kitsuId);
    }

    if (parsed.malId) {
      params.set('malId', parsed.malId);
      params.append('mal_id', parsed.malId);
    }

    if (parsed.query) {
      params.set('query', parsed.query);
      params.append('q', parsed.query);
      params.append('title', parsed.query);
    }

    if (parsed.season !== undefined) {
      params.set('season', parsed.season.toString());
    }

    if (parsed.episode !== undefined) {
      params.set('episode', parsed.episode.toString());
    }

    params.set('limit', '50');

    return params;
  }

  private parseId(id: string): ParsedIdInfo {
    const parts = (id || '').split(':');
    const rawId = parts[0] ?? '';
    const season = parts[1];
    const episode = parts[2];
    const info: ParsedIdInfo = {};

    if (/^tt\d+$/.test(rawId)) {
      info.imdbId = rawId;
    } else if (/^tmdb:\d+$/i.test(rawId)) {
      const tmdbId = rawId.split(':')[1];
      if (tmdbId) info.tmdbId = tmdbId;
    } else if (/^anilist:\d+$/i.test(rawId)) {
      const anilistId = rawId.split(':')[1];
      if (anilistId) info.anilistId = anilistId;
    } else if (/^kitsu:\d+$/i.test(rawId)) {
      const kitsuId = rawId.split(':')[1];
      if (kitsuId) info.kitsuId = kitsuId;
    } else if (/^mal:\d+$/i.test(rawId)) {
      const malId = rawId.split(':')[1];
      if (malId) info.malId = malId;
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

  private normalizeType(type: string): string {
    const lower = type.toLowerCase();
    if (lower === 'movie' || lower === 'movies') return 'movie';
    if (lower === 'series' || lower === 'tv' || lower === 'show' || lower === 'shows') return 'series';
    if (lower === 'anime') return 'anime';
    return lower;
  }

  private mapTorrentToStream(torrent: any): SourceStream | undefined {
    if (!torrent || typeof torrent !== 'object') {
      return undefined;
    }

    const magnet = this.extractMagnet(torrent);
    if (!magnet) {
      return undefined;
    }

    const title = this.extractTitle(torrent);
    const stream: SourceStream = {
      name: title,
      title,
      magnet,
    };

    const infoHash = torrent.infoHash || torrent.hash || torrent.btih || this.extractInfoHash(magnet);
    if (infoHash) stream.infoHash = infoHash;

    const size = this.extractSize(torrent);
    if (size !== undefined) stream.size = size;

    const seeders = this.extractSeeders(torrent);
    if (seeders !== undefined) stream.seeders = seeders;

    const quality = torrent.quality || torrent.resolution || this.inferQualityFromTitle(title);
    if (quality) stream.quality = quality;

    const releaseGroup = torrent.releaseGroup || torrent.group || torrent.uploader || torrent.source;
    if (releaseGroup) stream.releaseGroup = releaseGroup;

    return stream;
  }

  private sanitizeQuery(raw: string): string | undefined {
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
    return cleaned || undefined;
  }

  private extractMagnet(torrent: any): string | undefined {
    const magnet =
      torrent.magnet ||
      torrent.magnetURI ||
      torrent.magnetUri ||
      torrent.magnet_link ||
      torrent.magnetLink ||
      torrent.link;

    if (magnet && typeof magnet === 'string' && magnet.startsWith('magnet:')) {
      return magnet;
    }

    const hash = torrent.infoHash || torrent.hash || torrent.btih;
    if (hash && typeof hash === 'string') {
      return `magnet:?xt=urn:btih:${hash}`;
    }

    return undefined;
  }

  private extractTitle(torrent: any): string {
    const title =
      torrent.title ||
      torrent.name ||
      torrent.filename ||
      torrent.release ||
      torrent.file ||
      torrent.slug ||
      torrent.displayName;

    if (typeof title === 'string' && title.trim()) {
      return title;
    }

    return `${this.name} Torrent`;
  }

  private extractInfoHash(magnet: string): string | undefined {
    const match = magnet.match(/btih:([^&]+)/i);
    return match?.[1];
  }

  private extractSeeders(torrent: any): number | undefined {
    const candidate =
      torrent.seeders ??
      torrent.seed ??
      torrent.seeds ??
      torrent.seedCount ??
      torrent.seed_count ??
      torrent.peers ??
      torrent.peer ??
      torrent.peerCount;

    return this.toNumber(candidate);
  }

  private extractSize(torrent: any): number | undefined {
    const candidate =
      torrent.size ??
      torrent.sizeBytes ??
      torrent.size_bytes ??
      torrent.bytes ??
      torrent.filesize ??
      torrent.length ??
      torrent.totalSize;

    if (typeof candidate === 'number') {
      return candidate;
    }

    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      const numeric = Number(trimmed.replace(/[^0-9.]/g, ''));
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

  private toNumber(value: any): number | undefined {
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
}
