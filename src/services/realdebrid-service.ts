/**
 * Real-Debrid Service
 *
 * Handles magnet → direct-link resolution via the Real-Debrid API.
 * Includes comprehensive file selection with language-aware, BR-optimised
 * episode matching that supports:
 *   - Standard SxxExx notation
 *   - NxNN / N×NN (multiplication sign U+00D7)
 *   - Bare-number filenames ("2 - Sick.mp4")
 *   - Portuguese keywords (episódio, capítulo, temporada)
 *   - Concatenated season+episode (302 = S03E02)
 *   - Junk / ad file rejection (samples, promos, .nfo, .url, tiny files)
 */

import { request } from 'undici';
import { ConfigService } from './config-service.js';
import type { TorrentInfo, MagnetResponse, UnrestrictResponse } from '../models/realdebrid-model.js';
import type { StreamContext } from '../models/source-model.js';

type InstantAvailabilityRecord = Record<string, unknown>;

interface InstantAvailabilityCacheEntry {
  cached: boolean;
  expires: number;
}

// ── Constants ────────────────────────────────────────────────────────────────
const API_BASE = 'https://api.real-debrid.com/rest/1.0';
const REQUEST_TIMEOUT_MS = 15_000;
const MIN_VIDEO_BYTES = 5 * 1024 * 1024; // 5 MB – anything smaller is junk

// Video extensions accepted as playable media
const VIDEO_EXTENSIONS =
  /\.(mp4|mkv|mov|avi|ts|m4v|m2ts|wmv|flv|webm|divx|xvid|vob|iso|3gp|ogv|rmvb)$/i;

// Junk / non-playable extensions
const JUNK_EXTENSIONS =
  /\.(txt|url|nfo|jpg|jpeg|png|gif|bmp|ico|md|html?|exe|bat|lnk|srt|sub|ass|ssa|idx|sup|mka|rar|zip|7z|pdf|doc|docx|db|torrent)$/i;

// Patterns that flag a file as sample / promo / ad
const JUNK_CONTENT_REGEX =
  /\b(sample|trailer|extras?|bonus|featurette|behind.?the.?scenes|credits?|creditos|poster|rarbg|nfo|subs?|propaganda|anuncio|promo|preview|teaser|1xbet|banner|ad[s_]|screener|watermark)\b/i;

export class RealDebridService {
  private static readonly INSTANT_AVAILABILITY_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static instantAvailabilityCache = new Map<string, InstantAvailabilityCacheEntry>();

  constructor(private token: string) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async addMagnet(magnet: string): Promise<MagnetResponse> {
    const response = await request(`${API_BASE}/torrents/addMagnet`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ magnet }).toString(),
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS
    });

    if (response.statusCode >= 400) {
      const body = await response.body.text().catch(() => '');
      throw new Error(`Failed to add magnet: ${response.statusCode} ${body}`);
    }

    return await response.body.json() as MagnetResponse;
  }

  async selectFiles(torrentId: string, fileIds: string): Promise<void> {
    const response = await request(`${API_BASE}/torrents/selectFiles/${torrentId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ files: fileIds }).toString(),
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS
    });

    if (response.statusCode >= 400) {
      const body = await response.body.text().catch(() => '');
      throw new Error(`Failed to select files: ${response.statusCode} ${body}`);
    }
  }

  async getTorrentInfo(torrentId: string): Promise<TorrentInfo> {
    const response = await request(`${API_BASE}/torrents/info/${torrentId}`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS
    });

    if (response.statusCode >= 400) {
      const body = await response.body.text().catch(() => '');
      throw new Error(`Failed to get torrent info: ${response.statusCode} ${body}`);
    }

    return await response.body.json() as TorrentInfo;
  }

  async unrestrictLink(link: string): Promise<UnrestrictResponse> {
    const response = await request(`${API_BASE}/unrestrict/link`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ link }).toString(),
      headersTimeout: REQUEST_TIMEOUT_MS,
      bodyTimeout: REQUEST_TIMEOUT_MS
    });

    if (response.statusCode >= 400) {
      const body = await response.body.text().catch(() => '');
      throw new Error(`Failed to unrestrict link: ${response.statusCode} ${body}`);
    }

    return await response.body.json() as UnrestrictResponse;
  }

  // ── Instant Availability (cache check) ──────────────────────────────────

  static async fetchCachedInfoHashes(
    hashes: string[],
    token?: string
  ): Promise<Set<string>> {
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

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const chunkSize = 50;

    for (let i = 0; i < hashesToFetch.length; i += chunkSize) {
      const chunk = hashesToFetch.slice(i, i + chunkSize);
      const upperChunk = chunk.map((hash) => hash.toUpperCase());
      let chunkPayload = await this.fetchInstantAvailabilityPayload(
        `${API_BASE}/torrents/instantAvailability/${upperChunk.join('/')}`,
        headers
      );

      if (!chunkPayload || this.isPayloadEmpty(chunkPayload)) {
        chunkPayload = await this.fetchInstantAvailabilityPayload(
          `${API_BASE}/torrents/instantAvailability/${upperChunk.join(',')}`,
          headers
        );
      }

      if (chunkPayload && !this.isPayloadEmpty(chunkPayload)) {
        const chunkCached = new Set<string>();
        this.collectCachedHashesFromPayload(chunkPayload, chunkCached);
        for (const hash of chunkCached) {
          result.add(hash);
        }
        this.updateAvailabilityCache(chunk, chunkCached, now);
        continue;
      }

      await this.fetchPerHash(chunk, headers, result, now);
    }

    return result;
  }

  private static async fetchPerHash(
    hashes: string[],
    headers: Record<string, string>,
    cached: Set<string>,
    now: number
  ): Promise<void> {
    for (const hash of hashes) {
      const payload = await this.fetchInstantAvailabilityPayload(
        `${API_BASE}/torrents/instantAvailability/${hash.toUpperCase()}`,
        headers
      );

      const perHashCached = new Set<string>();
      if (payload && !this.isPayloadEmpty(payload)) {
        this.collectCachedHashesFromPayload(payload, perHashCached);
        for (const cachedHash of perHashCached) {
          cached.add(cachedHash);
        }
      }

      this.updateAvailabilityCache([hash], perHashCached, now);
    }
  }

  private static async fetchInstantAvailabilityPayload(
    endpoint: string,
    headers: Record<string, string>
  ): Promise<InstantAvailabilityRecord | undefined> {
    try {
      const response = await request(endpoint, {
        headers,
        headersTimeout: REQUEST_TIMEOUT_MS,
        bodyTimeout: REQUEST_TIMEOUT_MS
      });
      if (response.statusCode >= 400) {
        await response.body.dump();
        return undefined;
      }
      const json = (await response.body.json()) as InstantAvailabilityRecord;
      return json;
    } catch {
      return undefined;
    }
  }

  private static collectCachedHashesFromPayload(
    payload: InstantAvailabilityRecord,
    cached: Set<string>
  ): void {
    for (const [key, value] of Object.entries(payload)) {
      try {
        if (this.isInstantAvailabilityCached(value)) {
          cached.add(key.toLowerCase());
        }
      } catch {
        // ignore malformed entries
      }
    }
  }

  private static isPayloadEmpty(payload: InstantAvailabilityRecord): boolean {
    return !payload || Object.keys(payload).length === 0;
  }

  private static isInstantAvailabilityCached(value: unknown): boolean {
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

  private static hasCachedNested(value: unknown): boolean {
    if (!value) {
      return false;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).some((entry) =>
        this.hasCachedNested(entry)
      );
    }

    return false;
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

  // ── Magnet → Direct URL ─────────────────────────────────────────────────

  async processMagnetToDirectUrl(magnet: string, context?: StreamContext): Promise<string> {
    const { id: torrentId } = await this.addMagnet(magnet);

    const torrentInfo = await this.getTorrentInfo(torrentId);

    if (!torrentInfo.files || torrentInfo.files.length === 0) {
      throw new Error(`No files found in torrent: ${torrentId}`);
    }

    const selectedFile = this.selectBestFile(torrentInfo.files, context);
    if (!selectedFile) {
      throw new Error('No playable files found in torrent');
    }

    console.debug(`[RD] selected file id=${selectedFile.id} path=${selectedFile.path} bytes=${selectedFile.bytes}`);

    // Select file in RD
    await this.selectFiles(torrentId, String(selectedFile.id));

    // Check if already downloaded
    const currentInfo = await this.getTorrentInfo(torrentId);
    if (currentInfo.status === 'downloaded') {
      return await this.getDirectDownloadUrl(torrentId);
    }

    // Not downloaded yet, wait and retry
    await new Promise(resolve => setTimeout(resolve, 5000));

    const retryInfo = await this.getTorrentInfo(torrentId);
    if (retryInfo.status === 'downloaded') {
      return await this.getDirectDownloadUrl(torrentId);
    }

    // Still not ready, return placeholder video URL
    return this.createPlaceholderUrl(torrentId);
  }

  private async getDirectDownloadUrl(torrentId: string): Promise<string> {
    const finalInfo = await this.getTorrentInfo(torrentId);

    if (!finalInfo.links || finalInfo.links.length === 0) {
      throw new Error(`No download links available for torrent: ${torrentId}`);
    }

    const downloadLink = finalInfo.links[0];
    if (!downloadLink) {
      throw new Error(`Download link is undefined for torrent: ${torrentId}`);
    }

    const { download } = await this.unrestrictLink(downloadLink);
    return download;
  }

  private createPlaceholderUrl(torrentId: string): string {
    const config = ConfigService.loadConfig();
    return `${config.baseUrl}/placeholder/downloading.mp4`;
  }

  // ── File Selection Engine ───────────────────────────────────────────────

  private selectBestFile(
    files: NonNullable<TorrentInfo['files']>,
    context?: StreamContext
  ): NonNullable<TorrentInfo['files']>[number] | undefined {
    const videoFiles = files.filter((file) => this.isVideoFile(file.path));
    if (videoFiles.length === 0) {
      // Fallback: try all files
      return files[0];
    }

    // Try contextual match first
    const contextualMatch = this.findContextualMatch(videoFiles, context);
    if (contextualMatch) {
      return contextualMatch;
    }

    // Fallback: largest video file (excluding junk)
    const cleanFiles = videoFiles.filter((f) => !this.isJunkFile(f.path, f.bytes));
    const pool = cleanFiles.length > 0 ? cleanFiles : videoFiles;
    return pool.reduce((max, file) => (file.bytes > max.bytes ? file : max));
  }

  private findContextualMatch(
    files: NonNullable<TorrentInfo['files']>,
    context?: StreamContext
  ): NonNullable<TorrentInfo['files']>[number] | undefined {
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

  // ── Scoring ─────────────────────────────────────────────────────────────

  private scoreFileAgainstContext(
    file: { path: string; bytes: number },
    context: StreamContext
  ): number {
    const rawPath = file.path;
    const normalizedPath = this.normalize(rawPath);
    if (!normalizedPath) {
      return 0;
    }

    let score = 0;

    // ── Junk penalty ──────────────────────────────────────────────────
    if (this.isJunkFile(rawPath, file.bytes)) {
      score -= 50;
    }

    // ── Year match ────────────────────────────────────────────────────
    if (context.year && normalizedPath.includes(String(context.year))) {
      score += 4;
    }

    // ── Title match ───────────────────────────────────────────────────
    if (context.title) {
      const normalizedTitle = this.normalize(context.title);
      if (normalizedTitle && normalizedPath.includes(normalizedTitle)) {
        score += 6;
      }
    }

    // ── Episode title match (strongest signal) ────────────────────────
    if (context.episodeTitle) {
      const normalizedEpisodeTitle = this.normalize(context.episodeTitle);
      if (normalizedEpisodeTitle && normalizedPath.includes(normalizedEpisodeTitle)) {
        score += 14;
      }
    }

    // ── Episode matching (using both raw and normalized paths) ─────────
    if (context.episode !== undefined) {
      score += this.scoreEpisodeMatch(rawPath, normalizedPath, context);
    }

    // ── Movie penalty for episodic files ──────────────────────────────
    if (context.type === 'movie') {
      if (/\bS\d{1,3}E\d{1,3}\b|\b\d{1,2}[x\u00d7]\d{1,3}\b/i.test(rawPath)) {
        score -= 20;
      }
    }

    // Size tiebreaker (logarithmic so it doesn't overpower content matches)
    if (score > 0) {
      score += Math.log10(file.bytes + 1);
    }

    return score;
  }

  /**
   * Comprehensive episode matching across all known filename patterns.
   * Receives BOTH the raw path (for × and special chars) and the normalized
   * path (for alphanumeric token matching).
   */
  private scoreEpisodeMatch(rawPath: string, normalizedPath: string, context: StreamContext): number {
    if (context.episode === undefined) {
      return 0;
    }

    const episode = context.episode;
    const ep = String(episode);
    const ep2 = ep.padStart(2, '0');
    const ep3 = ep.padStart(3, '0');
    const season = context.season;

    let matchScore = 0;

    // ────────────────────────────────────────────────────────────────────
    // 1) Normalized-path token matching (handles most standard patterns)
    // ────────────────────────────────────────────────────────────────────
    const normalizedTokens: string[] = [
      // E02, EP02, Episode02, Episodio02, Capitulo02
      `e${ep}`, `e${ep2}`,
      `ep${ep}`, `ep${ep2}`,
      `episode${ep}`, `episode${ep2}`,
      `episodio${ep}`, `episodio${ep2}`,
      `capitulo${ep}`, `capitulo${ep2}`,
      `folge${ep}`, `folge${ep2}`,
      `part${ep}`, `part${ep2}`,
      `parte${ep}`, `parte${ep2}`,
      `cap${ep}`, `cap${ep2}`,
    ];

    if (season !== undefined) {
      const s = String(season);
      const s2 = s.padStart(2, '0');
      normalizedTokens.push(
        // S03E02, S3E2
        `s${s}e${ep}`, `s${s}e${ep2}`,
        `s${s2}e${ep}`, `s${s2}e${ep2}`,
        // Season3Episode2
        `season${s}episode${ep}`, `season${s2}episode${ep2}`,
        `temporada${s}episodio${ep}`, `temporada${s2}episodio${ep2}`,
        // NxNN: 3x02 (normalized, x is kept as alphanumeric)
        `${s}x${ep}`, `${s}x${ep2}`,
        `${s2}x${ep}`, `${s2}x${ep2}`,
        // Concatenated: normalize() strips × so 3×02 → "302"
        `${s}${ep2}`, `${s2}${ep2}`,
      );
    }

    // Normalize all tokens the same way as the path
    const processedTokens = normalizedTokens.map((t) => this.normalize(t)).filter(Boolean);
    for (const token of processedTokens) {
      if (normalizedPath.includes(token)) {
        matchScore += token.length >= 5 ? 12 : token.length >= 3 ? 8 : 5;
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 2) Raw-path regex matching (for ×, accented chars, special notation)
    // ────────────────────────────────────────────────────────────────────
    const rawLower = rawPath.toLowerCase();

    // 2a) N×NN pattern: 3×02, 03×02 (× = U+00D7 multiplication sign)
    if (season !== undefined) {
      const s = String(season);
      const s2 = s.padStart(2, '0');
      const crossPatterns = [
        `${s}\u00d7${ep}`, `${s}\u00d7${ep2}`,
        `${s2}\u00d7${ep}`, `${s2}\u00d7${ep2}`,
      ];
      for (const cp of crossPatterns) {
        if (rawLower.includes(cp)) {
          matchScore += 14; // High confidence — very specific match
        }
      }
    }

    // 2b) Bare number at start of filename: "2 - Sick.mp4", "02.Title.mkv"
    //     Match number at start of string or after path separator
    const bareEpRegex = new RegExp(`(?:^|[/\\\\])0*${episode}\\s*[-._\\s]+[a-z]`, 'i');
    if (bareEpRegex.test(rawPath)) {
      matchScore += 12;
    }

    // 2c) Bare number followed directly by extension: "02.mp4"
    const bareExtRegex = new RegExp(`(?:^|[/\\\\])0*${episode}\\.(mkv|mp4|avi|m4v|ts)$`, 'i');
    if (bareExtRegex.test(rawPath)) {
      matchScore += 10;
    }

    // 2d) Portuguese ordinal: "Episódio 2", "Capítulo 02"
    const ptRegex = new RegExp(`(?:epis[oó]dio|cap[ií]tulo|cap\\.?)\\s*0*${episode}\\b`, 'i');
    if (ptRegex.test(rawPath)) {
      matchScore += 12;
    }

    // 2e) Hash notation: #02
    if (rawLower.includes(`#${ep2}`) || rawLower.includes(`#${ep}`)) {
      matchScore += 8;
    }

    // ────────────────────────────────────────────────────────────────────
    // 3) Wrong-episode penalty: if another episode is strongly matched,
    //    penalize to avoid false positives from concatenated tokens
    // ────────────────────────────────────────────────────────────────────
    if (season !== undefined && matchScore > 0) {
      const s2 = String(season).padStart(2, '0');
      // Check if a DIFFERENT episode marker is present (SxxEYY where YY ≠ target)
      const otherEpMatch = rawLower.match(/s\d{1,3}e(\d{1,3})/i) ||
        rawLower.match(/\d{1,2}[x\u00d7](\d{1,3})/i);
      if (otherEpMatch) {
        const detectedEp = parseInt(otherEpMatch[1] ?? '', 10);
        if (!isNaN(detectedEp) && detectedEp !== episode) {
          matchScore -= 20; // Strong penalty for wrong episode
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 4) Episode list bonus
    // ────────────────────────────────────────────────────────────────────
    if (context.episodeList && context.episodeList.includes(episode)) {
      matchScore += 2;
    }

    return matchScore;
  }

  // ── Utility Methods ─────────────────────────────────────────────────────

  private isVideoFile(path: string): boolean {
    return VIDEO_EXTENSIONS.test(path);
  }

  private isJunkFile(path: string, bytes: number): boolean {
    if (JUNK_EXTENSIONS.test(path)) return true;
    if (JUNK_CONTENT_REGEX.test(path)) return true;
    if (bytes > 0 && bytes < MIN_VIDEO_BYTES) return true;
    return false;
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
}
