/**
 * Torbox Service
 */

import { request } from 'undici';
import { ConfigService } from './config-service.js';
import type { StreamContext } from '../models/source-model.js';

type TorboxPayload = Record<string, unknown>;

interface TorboxInstantCacheEntry {
  cached: boolean;
  expires: number;
}

export class TorboxService {
  private static readonly API_BASE_URL = 'https://api.torbox.app/v1';
  private static readonly INSTANT_AVAILABILITY_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static instantAvailabilityCache = new Map<string, TorboxInstantCacheEntry>();

  constructor(private token: string) {}

  private static buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'X-API-Key': token
    };
  }

  static async fetchCachedInfoHashes(hashes: string[], token?: string): Promise<Set<string>> {
    const result = new Set<string>();
    if (!hashes || hashes.length === 0) {
      return result;
    }

    const normalizedHashes = hashes
      .map((hash) => hash?.toLowerCase())
      .filter((hash): hash is string => Boolean(hash));

    const now = Date.now();
    const hashesToFetch: string[] = [];

    for (const hash of normalizedHashes) {
      const cacheEntry = this.instantAvailabilityCache.get(hash);
      if (cacheEntry && cacheEntry.expires > now) {
        if (cacheEntry.cached) {
          result.add(hash);
        }
      } else if (token) {
        hashesToFetch.push(hash);
      }
    }

    if (!token || hashesToFetch.length === 0) {
      return result;
    }

    const headers = this.buildHeaders(token);
    const chunkSize = 50;

    for (let i = 0; i < hashesToFetch.length; i += chunkSize) {
      const chunk = hashesToFetch.slice(i, i + chunkSize);
      const cachedHashes = await this.fetchInstantAvailabilityForChunk(chunk, headers);
      for (const hash of cachedHashes) {
        result.add(hash);
      }
      this.updateAvailabilityCache(chunk, cachedHashes, now);
    }

    return result;
  }

  private static async fetchInstantAvailabilityForChunk(
    hashes: string[],
    headers: Record<string, string>
  ): Promise<Set<string>> {
    const cached = new Set<string>();
    const hashList = hashes.map((hash) => hash.toLowerCase());
    const endpoints = [
      `${this.API_BASE_URL}/torrents/instantAvailability?hashes=${hashList.join(',')}`,
      `${this.API_BASE_URL}/torrents/instantAvailability/${hashList.join(',')}`,
      `${this.API_BASE_URL}/torrents/instantavailability?hashes=${hashList.join(',')}`,
      `${this.API_BASE_URL}/instantAvailability?hashes=${hashList.join(',')}`
    ];

    for (const endpoint of endpoints) {
      const payload = await this.fetchPayload(endpoint, headers);
      if (!payload) {
        continue;
      }
      const collected = this.collectCachedHashesFromPayload(payload);
      if (collected.size > 0) {
        for (const hash of collected) {
          cached.add(hash.toLowerCase());
        }
      }
      if (Object.keys(payload).length > 0) {
        break;
      }
    }

    return cached;
  }

  private static async fetchPayload(
    endpoint: string,
    headers: Record<string, string>
  ): Promise<TorboxPayload | undefined> {
    try {
      const response = await request(endpoint, { headers });
      if (response.statusCode >= 400) {
        await response.body.dump();
        return undefined;
      }
      return (await response.body.json()) as TorboxPayload;
    } catch {
      return undefined;
    }
  }

  private static collectCachedHashesFromPayload(payload: TorboxPayload): Set<string> {
    const cached = new Set<string>();
    const data = (payload as Record<string, unknown>).data ?? payload;

    if (Array.isArray(data)) {
      for (const entry of data) {
        const hash = this.extractHash(entry);
        if (hash && this.isCachedEntry(entry)) {
          cached.add(hash.toLowerCase());
        }
      }
      return cached;
    }

    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (this.looksLikeHash(key)) {
          if (this.isCachedEntry(value)) {
            cached.add(key.toLowerCase());
          }
          continue;
        }

        if (this.isCachedEntry(value)) {
          const extracted = this.extractHash(value);
          if (extracted) {
            cached.add(extracted.toLowerCase());
          }
        }
      }
    }

    return cached;
  }

  private static extractHash(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const possible =
      (record.hash as string) ||
      (record.infoHash as string) ||
      (record.info_hash as string) ||
      (record.infohash as string);
    if (possible && typeof possible === 'string') {
      return possible;
    }
    return undefined;
  }

  private static looksLikeHash(value: string): boolean {
    return /^[a-f0-9]{40}$/i.test(value);
  }

  private static isCachedEntry(value: unknown): boolean {
    if (!value) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value !== 'object') {
      return Boolean(value);
    }

    const record = value as Record<string, unknown>;
    const flags = ['cached', 'instant', 'available', 'ready', 'downloaded'];
    for (const flag of flags) {
      if (record[flag] === true) {
        return true;
      }
    }

    if (Array.isArray(record.files) && record.files.length > 0) {
      return true;
    }

    if (Array.isArray(record.links) && record.links.length > 0) {
      return true;
    }

    return Object.values(record).some((entry) => this.isCachedEntry(entry));
  }

  private static updateAvailabilityCache(
    hashes: string[],
    cachedHashes: Set<string>,
    now: number
  ): void {
    const expires = now + this.INSTANT_AVAILABILITY_TTL_MS;
    for (const hash of hashes) {
      const normalized = hash.toLowerCase();
      this.instantAvailabilityCache.set(normalized, {
        cached: cachedHashes.has(normalized),
        expires
      });
    }
  }

  async processMagnetToDirectUrl(magnet: string, context?: StreamContext): Promise<string> {
    try {
      const { id: torrentId } = await this.addMagnet(magnet);
      const torrentInfo = await this.getTorrentInfo(torrentId);
      const files = this.extractFiles(torrentInfo);
      if (files.length === 0) {
        return this.createPlaceholderUrl();
      }

      const selectedFile = this.selectBestFile(files, context);
      if (selectedFile?.id !== undefined) {
        await this.selectFiles(torrentId, String(selectedFile.id));
      }

      const refreshedInfo = await this.getTorrentInfo(torrentId);
      const directUrl = this.extractDirectUrl(refreshedInfo);
      if (directUrl) {
        return directUrl;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
      const retryInfo = await this.getTorrentInfo(torrentId);
      const retryUrl = this.extractDirectUrl(retryInfo);
      if (retryUrl) {
        return retryUrl;
      }
    } catch {
      // fall through to placeholder
    }

    return this.createPlaceholderUrl();
  }

  private async addMagnet(magnet: string): Promise<{ id: string }> {
    const endpoints = [
      `${TorboxService.API_BASE_URL}/torrents/add`,
      `${TorboxService.API_BASE_URL}/torrents/addMagnet`,
      `${TorboxService.API_BASE_URL}/torrents/add-magnet`,
      `${TorboxService.API_BASE_URL}/torrents`
    ];

    const headers = TorboxService.buildHeaders(this.token);

    for (const endpoint of endpoints) {
      const response = await this.postPayload(endpoint, headers, { magnet });
      if (!response) {
        continue;
      }
      const id = this.extractTorrentId(response);
      if (id) {
        return { id };
      }
    }

    throw new Error('Failed to add magnet to Torbox');
  }

  private async postPayload(
    endpoint: string,
    headers: Record<string, string>,
    body: Record<string, string>
  ): Promise<TorboxPayload | undefined> {
    const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
    try {
      const response = await request(endpoint, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(body)
      });
      if (response.statusCode < 400) {
        return (await response.body.json()) as TorboxPayload;
      }
    } catch {
      // ignore
    }

    const formHeaders = { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const response = await request(endpoint, {
        method: 'POST',
        headers: formHeaders,
        body: new URLSearchParams(body).toString()
      });
      if (response.statusCode < 400) {
        return (await response.body.json()) as TorboxPayload;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private extractTorrentId(payload: TorboxPayload): string | undefined {
    const data = (payload as Record<string, unknown>).data ?? payload;
    if (!data || typeof data !== 'object') {
      return undefined;
    }
    const record = data as Record<string, unknown>;
    const id =
      (record.id as string) ||
      (record.torrent_id as string) ||
      (record.torrentId as string) ||
      (record.item_id as string);
    return typeof id === 'string' ? id : undefined;
  }

  private async getTorrentInfo(torrentId: string): Promise<TorboxPayload> {
    const endpoints = [
      `${TorboxService.API_BASE_URL}/torrents/info/${torrentId}`,
      `${TorboxService.API_BASE_URL}/torrents/${torrentId}`,
      `${TorboxService.API_BASE_URL}/torrents/info?id=${torrentId}`
    ];

    const headers = TorboxService.buildHeaders(this.token);
    for (const endpoint of endpoints) {
      const payload = await TorboxService.fetchPayload(endpoint, headers);
      if (payload) {
        return payload;
      }
    }

    throw new Error(`Failed to fetch Torbox torrent info: ${torrentId}`);
  }

  private extractFiles(payload: TorboxPayload): Array<{ id?: string | number; path: string; bytes: number }> {
    const data = (payload as Record<string, unknown>).data ?? payload;
    if (!data || typeof data !== 'object') {
      return [];
    }

    const record = data as Record<string, unknown>;
    const files = (record.files as unknown) ?? (record.content as unknown);
    if (!Array.isArray(files)) {
      return [];
    }

    return files
      .map((file) => {
        if (!file || typeof file !== 'object') {
          return undefined;
        }
        const entry = file as Record<string, unknown>;
        const path = (entry.path as string) || (entry.filename as string) || (entry.name as string);
        const bytes =
          (entry.bytes as number) ||
          (entry.size as number) ||
          (entry.filesize as number) ||
          0;
        const id = entry.id ?? entry.file_id ?? entry.fileId;
        if (!path) {
          return undefined;
        }
        return { id, path, bytes: Number(bytes) };
      })
      .filter((file): file is { id?: string | number; path: string; bytes: number } => Boolean(file));
  }

  private async selectFiles(torrentId: string, fileIds: string): Promise<void> {
    const endpoints = [
      `${TorboxService.API_BASE_URL}/torrents/selectFiles/${torrentId}`,
      `${TorboxService.API_BASE_URL}/torrents/select/${torrentId}`,
      `${TorboxService.API_BASE_URL}/torrents/${torrentId}/select`
    ];

    const headers = TorboxService.buildHeaders(this.token);

    for (const endpoint of endpoints) {
      const payload = await this.postPayload(endpoint, headers, { files: fileIds });
      if (payload) {
        return;
      }
    }
  }

  private extractDirectUrl(payload: TorboxPayload): string | undefined {
    const data = (payload as Record<string, unknown>).data ?? payload;
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const record = data as Record<string, unknown>;
    const candidates = [
      record.download,
      record.download_link,
      record.downloadLink,
      record.link,
      record.stream_url,
      record.streamUrl,
      record.url
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.startsWith('http')) {
        return candidate;
      }
    }

    const links = record.links ?? record.downloads ?? record.files;
    if (Array.isArray(links)) {
      for (const entry of links) {
        if (typeof entry === 'string' && entry.startsWith('http')) {
          return entry;
        }
        if (entry && typeof entry === 'object') {
          const link =
            (entry as Record<string, unknown>).link ||
            (entry as Record<string, unknown>).download ||
            (entry as Record<string, unknown>).url;
          if (typeof link === 'string' && link.startsWith('http')) {
            return link;
          }
        }
      }
    }

    return undefined;
  }

  private selectBestFile(
    files: Array<{ id?: string | number; path: string; bytes: number }>,
    context?: StreamContext
  ): { id?: string | number; path: string; bytes: number } | undefined {
    const videoFiles = files.filter((file) => this.isVideoFile(file.path));
    if (videoFiles.length === 0) {
      return files[0];
    }

    const contextualMatch = this.findContextualMatch(videoFiles, context);
    if (contextualMatch) {
      return contextualMatch;
    }

    return videoFiles.reduce((max, file) => (file.bytes > max.bytes ? file : max));
  }

  private findContextualMatch(
    files: Array<{ id?: string | number; path: string; bytes: number }>,
    context?: StreamContext
  ): { id?: string | number; path: string; bytes: number } | undefined {
    if (!context) {
      return undefined;
    }

    const scored = files
      .map((file) => ({ file, score: this.scoreFileAgainstContext(file, context) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.file.bytes - a.file.bytes;
      });

    return scored[0]?.file;
  }

  private scoreFileAgainstContext(
    file: { path: string; bytes: number },
    context: StreamContext
  ): number {
    const normalizedPath = this.normalize(file.path);
    if (!normalizedPath) {
      return 0;
    }

    let score = 0;

    if (context.year && normalizedPath.includes(String(context.year))) {
      score += 4;
    }

    if (context.title) {
      const normalizedTitle = this.normalize(context.title);
      if (normalizedTitle && normalizedPath.includes(normalizedTitle)) {
        score += 6;
      }
    }

    if (context.episodeTitle) {
      const normalizedEpisodeTitle = this.normalize(context.episodeTitle);
      if (normalizedEpisodeTitle && normalizedPath.includes(normalizedEpisodeTitle)) {
        score += 8;
      }
    }

    if (context.episode !== undefined) {
      score += this.scoreEpisodeMatch(normalizedPath, context);
    }

    if (score > 0) {
      score += Math.log10(file.bytes + 1);
    }

    return score;
  }

  private scoreEpisodeMatch(path: string, context: StreamContext): number {
    if (context.episode === undefined) {
      return 0;
    }

    const episode = context.episode;
    const episodePadded = String(episode).padStart(2, '0');
    const season = context.season;

    const tokens: string[] = [];
    tokens.push(`e${episode}`);
    tokens.push(`ep${episode}`);
    tokens.push(`episode${episode}`);
    tokens.push(`episodio${episode}`);
    tokens.push(`capitulo${episode}`);
    tokens.push(`part${episode}`);

    tokens.push(`e${episodePadded}`);
    tokens.push(`ep${episodePadded}`);
    tokens.push(`episode${episodePadded}`);
    tokens.push(`episodio${episodePadded}`);

    if (season !== undefined) {
      const seasonPadded = String(season).padStart(2, '0');
      tokens.push(`s${season}e${episode}`);
      tokens.push(`s${season}e${episodePadded}`);
      tokens.push(`s${seasonPadded}e${episodePadded}`);
      tokens.push(`s${seasonPadded}e${episode}`);
      tokens.push(`season${season}episode${episode}`);
      tokens.push(`season${seasonPadded}episode${episodePadded}`);
      tokens.push(`${season}x${episode}`);
      tokens.push(`${season}x${episodePadded}`);
      tokens.push(`${seasonPadded}x${episodePadded}`);
    }

    const normalizedTokens = tokens.map((token) => this.normalize(token)).filter(Boolean) as string[];

    let matchScore = 0;
    for (const token of normalizedTokens) {
      if (path.includes(token)) {
        matchScore += token.length >= 4 ? 10 : 6;
      }
    }

    if (context.episodeList && context.episodeList.includes(context.episode)) {
      matchScore += 2;
    }

    return matchScore;
  }

  private isVideoFile(path: string): boolean {
    return /\.(mp4|mkv|mov|avi|ts|m4v|wmv|flv|webm)$/i.test(path);
  }

  private normalize(value: string | undefined): string {
    if (!value) {
      return '';
    }

    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '')
      .toLowerCase();
  }

  private createPlaceholderUrl(): string {
    const config = ConfigService.loadConfig();
    return `${config.baseUrl}/placeholder/downloading.mp4`;
  }
}
