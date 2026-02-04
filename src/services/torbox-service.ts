/**
 * TorBox Service built on top of TorboxClient.
 * Handles both torrents (magnet) and WebDL (HTTP) flows.
 */

import { ConfigService } from './config-service.js';
import type { StreamContext } from '../models/source-model.js';
import { TorboxClient, type TorboxFile, type TorboxTorrent, type TorboxWebDl } from './torbox-client.js';

type AvailabilityCacheEntry = { cached: boolean; expires: number };

export interface TorboxDirectResult {
  url: string;
  ready: boolean;
  fileName?: string;
  size?: number;
}

export class TorboxService {
  private static readonly INSTANT_AVAILABILITY_TTL_MS = 5 * 60 * 1000; // 5 min
  private static availabilityCache = new Map<string, AvailabilityCacheEntry>();

  private client: TorboxClient;
  private waitVideoUrl?: string;

  constructor(private token: string) {
    this.client = new TorboxClient({ token });
    const config = ConfigService.loadConfig();
    this.waitVideoUrl = config.waitVideoUrl;
  }

  // ---------- Instant availability ----------
  static async fetchCachedInfoHashes(hashes: string[], token?: string): Promise<Set<string>> {
    const result = new Set<string>();
    if (!token || hashes.length === 0) {
      return result;
    }

    const normalized = hashes
      .map((h) => h?.toLowerCase())
      .filter((h): h is string => Boolean(h));

    const now = Date.now();
    const toFetch: string[] = [];
    for (const h of normalized) {
      const cache = this.availabilityCache.get(h);
      if (cache && cache.expires > now) {
        if (cache.cached) result.add(h);
        continue;
      }
      toFetch.push(h);
    }

    if (toFetch.length === 0) return result;

    const client = new TorboxClient({ token });
    try {
      const payload = await client.checkTorrentsCached(toFetch, true);
      const cachedSet = new Set<string>();
      for (const item of payload) {
        const h = (item.hash ?? '').toLowerCase();
        if (h && item.files && item.files.length > 0) {
          cachedSet.add(h);
          continue;
        }
        if (h) {
          cachedSet.add(h); // treat as cached if returned
        }
      }
      this.updateAvailabilityCache(toFetch, cachedSet, now);
      cachedSet.forEach((h) => result.add(h));
    } catch {
      // ignore failures, return what we have
    }

    return result;
  }

  private static updateAvailabilityCache(hashes: string[], cached: Set<string>, now: number): void {
    const expires = now + this.INSTANT_AVAILABILITY_TTL_MS;
    for (const h of hashes) {
      this.availabilityCache.set(h, { cached: cached.has(h.toLowerCase()), expires });
    }
  }

  // ---------- Magnet flow ----------
  async processMagnetToDirectUrl(magnet: string, context?: StreamContext): Promise<TorboxDirectResult> {
    try {
      const { torrent_id } = await this.client.createTorrent(magnet);

      const attempt = async () => {
        const info = await this.client.getTorrent(torrent_id);
        const ready = this.isReady(info);
        const file = this.selectBestFile(info.files || [], context);
        if (ready && file?.id !== undefined) {
          const link = await this.safeCall(() =>
            this.client.requestDownloadLink({ torrentId: torrent_id, fileId: file.id })
          );
          if (link) {
            return { url: link, ready: true, fileName: file.name, size: file.size };
          }
        }
        return undefined;
      };

      const immediate = await attempt();
      if (immediate) return immediate;

      await this.sleep(2000);
      const retry = await attempt();
      if (retry) return retry;

      await this.sleep(3000);
      const retry2 = await attempt();
      if (retry2) return retry2;

      return this.placeholderResult();
    } catch {
      return this.placeholderResult();
    }
  }

  // ---------- WebDL flow ----------
  async processWebDlToDirectUrl(url: string, context?: StreamContext): Promise<TorboxDirectResult> {
    try {
      const name = context?.title || context?.episodeTitle;
      const { webdownload_id } = await this.client.createWebDl(url, name);
      const attempt = async () => {
        const web = await this.client.getWebDl(webdownload_id);
        const file = this.selectBestFile(web.files || [], context);
        const ready = this.isReady(web);
        if (ready && file?.id !== undefined) {
          const link = await this.safeCall(() =>
            this.client.requestWebDlLink({ webId: webdownload_id, fileId: file.id })
          );
          if (link) return { url: link, ready: true, fileName: file.name, size: file.size };
        }
        return undefined;
      };

      const immediate = await attempt();
      if (immediate) return immediate;

      await this.sleep(2000);
      const retry = await attempt();
      if (retry) return retry;

      await this.sleep(3000);
      const retry2 = await attempt();
      if (retry2) return retry2;

      return this.placeholderResult();
    } catch {
      return this.placeholderResult();
    }
  }

  // ---------- Helpers ----------
  private async safeCall(fn: () => Promise<string>): Promise<string | undefined> {
    try {
      const link = await fn();
      if (typeof link === 'string' && link.startsWith('http')) {
        return link;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  private isReady(info: TorboxTorrent | TorboxWebDl): boolean {
    const state = (info.download_state || '').toLowerCase();
    return (
      info.download_present === true ||
      info.download_finished === true ||
      state === 'cached' ||
      state === 'completed'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private selectBestFile(files: TorboxFile[], context?: StreamContext): TorboxFile | undefined {
    const videoFiles = files.filter((f) => this.isVideoFile(f.name ?? f.short_name ?? ''));
    const candidates = videoFiles.length > 0 ? videoFiles : files;
    if (candidates.length === 0) return undefined;

    const withScore = candidates
      .map((f) => ({ file: f, score: this.scoreFileAgainstContext(f, context) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.file.size ?? 0) - (a.file.size ?? 0);
      });

    return withScore[0]?.file;
  }

  private scoreFileAgainstContext(file: TorboxFile, context?: StreamContext): number {
    if (!context) return Math.log10((file.size ?? 0) + 1);
    const path = this.normalize(file.name || file.short_name || file.path || '');
    let score = 0;

    if (context.year && path.includes(String(context.year))) score += 4;
    if (context.title) {
      const t = this.normalize(context.title);
      if (t && path.includes(t)) score += 6;
    }
    if (context.episodeTitle) {
      const t = this.normalize(context.episodeTitle);
      if (t && path.includes(t)) score += 8;
    }
    if (context.episode !== undefined) {
      score += this.scoreEpisodeMatch(path, context);
    }
    return score + Math.log10((file.size ?? 0) + 1);
  }

  private scoreEpisodeMatch(path: string, context: StreamContext): number {
    const episode = context.episode;
    if (episode === undefined) return 0;
    const epPadded = String(episode).padStart(2, '0');
    const season = context.season;

    const tokens: string[] = [
      `e${episode}`,
      `ep${episode}`,
      `episode${episode}`,
      `e${epPadded}`,
      `ep${epPadded}`,
      `episode${epPadded}`
    ];

    if (season !== undefined) {
      const s = String(season).padStart(2, '0');
      tokens.push(`s${season}e${episode}`, `s${s}e${epPadded}`, `${season}x${episode}`, `${s}x${epPadded}`);
    }

    return tokens.reduce((acc, token) => (path.includes(token) ? acc + 6 : acc), 0);
  }

  private isVideoFile(path: string): boolean {
    return /\.(mp4|mkv|mov|avi|ts|m4v|wmv|flv|webm)$/i.test(path);
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '')
      .toLowerCase();
  }

  private placeholderResult(): TorboxDirectResult {
    const config = ConfigService.loadConfig();
    const waitUrl = config.waitVideoUrl;
    if (!waitUrl) {
      throw new Error('TORBOX_WAIT_VIDEO_URL is required for TorBox placeholder');
    }
    return { url: waitUrl, ready: false };
  }
}
