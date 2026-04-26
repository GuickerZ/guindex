/**
 * TorBox Service built on top of TorboxClient.
 * Handles both torrents (magnet) and WebDL (HTTP) flows.
 *
 * Includes comprehensive file selection with BR-optimised episode matching:
 *   - Standard SxxExx notation
 *   - NxNN / N×NN (multiplication sign U+00D7)
 *   - Bare-number filenames ("2 - Sick.mp4")
 *   - Portuguese keywords (episódio, capítulo, temporada)
 *   - Junk / ad / sample file rejection
 */

import { ConfigService } from './config-service.js';
import type { StreamContext } from '../models/source-model.js';
import { TorboxClient, type TorboxFile, type TorboxTorrent, type TorboxWebDl } from './torbox-client.js';

type AvailabilityCacheEntry = { cached: boolean; expires: number };

// ── Constants ────────────────────────────────────────────────────────────────
const MIN_VIDEO_BYTES = 5 * 1024 * 1024; // 5 MB – anything smaller is junk

const VIDEO_EXTENSIONS =
  /\.(mp4|mkv|mov|avi|ts|m4v|m2ts|wmv|flv|webm|divx|xvid|vob|iso|3gp|ogv|rmvb)$/i;

const JUNK_EXTENSIONS =
  /\.(txt|url|nfo|jpg|jpeg|png|gif|bmp|ico|md|html?|exe|bat|lnk|srt|sub|ass|ssa|idx|sup|mka|rar|zip|7z|pdf|doc|docx|db|torrent)$/i;

const JUNK_CONTENT_REGEX =
  /\b(sample|trailer|extras?|bonus|featurette|behind.?the.?scenes|credits?|creditos|poster|rarbg|nfo|subs?|propaganda|anuncio|promo|preview|teaser|1xbet|banner|ad[s_]|screener|watermark)\b/i;

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
        const hasFiles = !!item.files && item.files.length > 0;
        const flaggedCached = (item as any).cached === true;
        if (h && (hasFiles || flaggedCached)) {
          cachedSet.add(h);
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
        console.debug('[TorBox] torrent state', {
          id: torrent_id,
          state: info.download_state,
          present: info.download_present,
          finished: info.download_finished,
          files: info.files?.length,
          progress: (info as any).progress,
          availability: (info as any).availability
        });
        const ready = this.isReady(info);
        const file = this.selectBestFile(info.files || [], context);
        const fileId = file?.id ?? file?.id === 0 ? file.id : undefined;

        console.debug('[TorBox] selected file', {
          fileId,
          name: file?.name || file?.short_name,
          size: file?.size
        });

        const tryLinks = async (): Promise<string | undefined> => {
          // 1) with fileId (if available)
          if (fileId !== undefined) {
            const link = await this.safeCall(() =>
              this.client.requestDownloadLink({ torrentId: torrent_id, fileId })
            );
            if (link) return link;
          }
          // 2) without fileId
          const linkNoId = await this.safeCall(() =>
            this.client.requestDownloadLink({ torrentId: torrent_id })
          );
          if (linkNoId) return linkNoId;
          // 3) iterate other files by size desc
          const filesBySize = [...(info.files || [])]
            .filter((f) => f && f.id !== undefined)
            .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
          for (const f of filesBySize) {
            const link = await this.safeCall(() =>
              this.client.requestDownloadLink({ torrentId: torrent_id, fileId: f.id })
            );
            if (link) return link;
          }
          return undefined;
        };

        const link = await tryLinks();
        if (link) {
          const chosen = file ?? info.files?.[0];
          const effectiveReady = ready && !this.isWaitingLikeLink(link);
          console.debug('[TorBox] link acquired', {
            torrentId: torrent_id,
            fileId: chosen?.id,
            name: chosen?.name || chosen?.short_name,
            size: chosen?.size,
            ready,
            effectiveReady,
            waitingLike: !effectiveReady
          });
          return { url: link, ready: effectiveReady, fileName: chosen?.name, size: chosen?.size };
        }

        if (ready) {
          console.debug('[TorBox] ready but no link from requestdl or wait link');
        }
        return undefined;
      };

      const attemptDelays = [0, 1000, 2500]; // faster second click (~2-3s total)
      for (const delay of attemptDelays) {
        if (delay > 0) await this.sleep(delay);
        const res = await attempt();
        if (res) return res;
      }

      console.debug('[TorBox] no link after attempts, returning configured wait video fallback');
      return this.placeholderResult();
    } catch (err) {
      console.debug('[TorBox] error in processMagnetToDirectUrl', err);
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
        if (file?.id !== undefined) {
          const link = await this.safeCall(() =>
            this.client.requestWebDlLink({ webId: webdownload_id, fileId: file.id })
          );
          if (link) {
            const effectiveReady = ready && !this.isWaitingLikeLink(link);
            return { url: link, ready: effectiveReady, fileName: file.name, size: file.size };
          }
        }

        if (file?.id === undefined) {
          const linkNoFile = await this.safeCall(() =>
            this.client.requestWebDlLink({ webId: webdownload_id })
          );
          if (linkNoFile) {
            const effectiveReady = ready && !this.isWaitingLikeLink(linkNoFile);
            return { url: linkNoFile, ready: effectiveReady };
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
      state === 'completed' ||
      (info.files && info.files.length > 0) ||
      (info as any).availability > 0 ||
      (info as any).progress >= 100
    );
  }

  private isWaitingLikeLink(url: string): boolean {
    const normalized = url.toLowerCase();
    return /downloading\.mp4|wait|waiting|processing|placeholder/.test(normalized);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── File Selection Engine ───────────────────────────────────────────────

  private selectBestFile(files: TorboxFile[], context?: StreamContext): TorboxFile | undefined {
    const videoFiles = files.filter((f) => this.isVideoFile(f.name ?? f.short_name ?? ''));
    const candidates = videoFiles.length > 0 ? videoFiles : files;
    if (candidates.length === 0) return undefined;

    // Filter out junk files
    const cleanCandidates = candidates.filter((f) => {
      const path = f.name || f.short_name || '';
      return !this.isJunkFile(path, f.size ?? 0);
    });

    const pool = cleanCandidates.length > 0 ? cleanCandidates : candidates;

    const withScore = pool
      .map((f) => ({ file: f, score: this.scoreFileAgainstContext(f, context) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.file.size ?? 0) - (a.file.size ?? 0);
      });

    return withScore[0]?.file;
  }

  // ── Scoring ─────────────────────────────────────────────────────────────

  private scoreFileAgainstContext(file: TorboxFile, context?: StreamContext): number {
    const rawPath = file.name || file.short_name || file.path || '';
    if (!context) {
      let score = Math.log10((file.size ?? 0) + 1);
      if (this.isJunkFile(rawPath, file.size ?? 0)) {
        score -= 50;
      }
      return score;
    }

    const normalizedPath = this.normalize(rawPath);
    const rawLower = rawPath.toLowerCase();
    let score = 0;

    // ── Junk penalty ──────────────────────────────────────────────────
    if (this.isJunkFile(rawPath, file.size ?? 0)) {
      score -= 50;
    }

    // ── Year match ────────────────────────────────────────────────────
    if (context.year && normalizedPath.includes(String(context.year))) {
      score += 4;
    }

    // ── Title match ───────────────────────────────────────────────────
    if (context.title) {
      const t = this.normalize(context.title);
      if (t && normalizedPath.includes(t)) score += 6;
    }

    // ── Episode title match (strongest signal) ────────────────────────
    if (context.episodeTitle) {
      const t = this.normalize(context.episodeTitle);
      if (t && normalizedPath.includes(t)) score += 14;
    }

    // ── Movie penalty for episodic files ──────────────────────────────
    if (context.type === 'movie' && /\bs\d{1,2}e\d{1,3}\b|\b\d{1,2}[x\u00d7]\d{1,3}\b/i.test(rawLower)) {
      score -= 20;
    }

    // ── Episode list bonus ────────────────────────────────────────────
    if (Array.isArray(context.episodeList) && context.episodeList.length > 0 && context.episode !== undefined) {
      const hasRequestedEpisode = context.episodeList.some((ep) => {
        const epPadded = String(ep).padStart(2, '0');
        return new RegExp(`\\be${ep}\\b|\\be${epPadded}\\b|\\bep${ep}\\b|\\bep${epPadded}\\b|\\b${ep}[x\u00d7]\\d{1,2}\\b|\\b\\d{1,2}[x\u00d7]${epPadded}\\b`, 'i').test(rawLower);
      });
      if (hasRequestedEpisode) {
        score += 12;
      }
    }

    // ── Episode matching (comprehensive) ──────────────────────────────
    if (context.episode !== undefined) {
      score += this.scoreEpisodeMatch(rawPath, normalizedPath, context);
    }

    return score + Math.log10((file.size ?? 0) + 1);
  }

  /**
   * Comprehensive episode matching across all known filename patterns.
   * Receives BOTH the raw path (for ×, accents) and the normalized path.
   */
  private scoreEpisodeMatch(rawPath: string, normalizedPath: string, context: StreamContext): number {
    const episode = context.episode;
    if (episode === undefined) return 0;

    const ep = String(episode);
    const ep2 = ep.padStart(2, '0');
    const season = context.season;

    let matchScore = 0;

    // ────────────────────────────────────────────────────────────────────
    // 1) Normalized-path token matching
    // ────────────────────────────────────────────────────────────────────
    const normalizedTokens: string[] = [
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
        `s${s}e${ep}`, `s${s}e${ep2}`,
        `s${s2}e${ep}`, `s${s2}e${ep2}`,
        `season${s}episode${ep}`, `season${s2}episode${ep2}`,
        `temporada${s}episodio${ep}`, `temporada${s2}episodio${ep2}`,
        `${s}x${ep}`, `${s}x${ep2}`,
        `${s2}x${ep}`, `${s2}x${ep2}`,
        // Concatenated: normalize() strips × so 3×02 → "302"
        `${s}${ep2}`, `${s2}${ep2}`,
      );
    }

    const processedTokens = normalizedTokens.map((t) => this.normalize(t)).filter(Boolean);
    for (const token of processedTokens) {
      if (normalizedPath.includes(token)) {
        matchScore += token.length >= 5 ? 12 : token.length >= 3 ? 8 : 5;
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 2) Raw-path matching (for × and special chars)
    // ────────────────────────────────────────────────────────────────────
    const rawLower = rawPath.toLowerCase();

    // 2a) N×NN pattern (× = U+00D7)
    if (season !== undefined) {
      const s = String(season);
      const s2 = s.padStart(2, '0');
      const crossPatterns = [
        `${s}\u00d7${ep}`, `${s}\u00d7${ep2}`,
        `${s2}\u00d7${ep}`, `${s2}\u00d7${ep2}`,
      ];
      for (const cp of crossPatterns) {
        if (rawLower.includes(cp)) {
          matchScore += 14;
        }
      }
    }

    // 2b) Bare number at start of filename
    const bareEpRegex = new RegExp(`(?:^|[/\\\\])0*${episode}\\s*[-._\\s]+[a-z]`, 'i');
    if (bareEpRegex.test(rawPath)) {
      matchScore += 12;
    }

    // 2c) Bare number + extension: "02.mp4"
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
    // 3) Wrong-episode penalty
    // ────────────────────────────────────────────────────────────────────
    if (season !== undefined && matchScore > 0) {
      const otherEpMatch = rawLower.match(/s\d{1,3}e(\d{1,3})/i) ||
        rawLower.match(/\d{1,2}[x\u00d7](\d{1,3})/i);
      if (otherEpMatch) {
        const detectedEp = parseInt(otherEpMatch[1] ?? '', 10);
        if (!isNaN(detectedEp) && detectedEp !== episode) {
          matchScore -= 20;
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
    console.debug('[TorBox] returning wait video', waitUrl);
    return { url: waitUrl, ready: false };
  }
}
