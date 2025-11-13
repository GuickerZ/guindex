/**
 * Real-Debrid Service
 */

import { request } from 'undici';
import { ConfigService } from './config-service.js';
import type { TorrentInfo, MagnetResponse, UnrestrictResponse } from '../models/realdebrid-model.js';
import type { StreamContext } from '../models/source-model.js';

type InstantAvailabilityRecord = Record<string, unknown>;

export class RealDebridService {
  constructor(private token: string) {}

  async addMagnet(magnet: string): Promise<MagnetResponse> {
    const response = await request('https://api.real-debrid.com/rest/1.0/torrents/addMagnet', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ magnet }).toString()
    });

    if (response.statusCode >= 400) {
      throw new Error(`Failed to add magnet: ${response.statusCode}`);
    }

    return await response.body.json() as MagnetResponse;
  }

  static async fetchCachedInfoHashes(
    hashes: string[],
    token?: string
  ): Promise<Set<string>> {
    const cached = new Set<string>();
    if (!hashes || hashes.length === 0 || !token) {
      return cached;
    }

    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const chunkSize = 50;
    for (let i = 0; i < hashes.length; i += chunkSize) {
      const chunk = hashes.slice(i, i + chunkSize);
      const upperChunk = chunk.map((hash) => hash.toUpperCase());

      let payload = await this.fetchInstantAvailabilityPayload(
        `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${upperChunk.join('/')}`,
        headers
      );

      if (!payload || this.isPayloadEmpty(payload)) {
        payload = await this.fetchInstantAvailabilityPayload(
          `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${upperChunk.join(',')}`,
          headers
        );
      }

      if (payload && !this.isPayloadEmpty(payload)) {
        this.collectCachedHashesFromPayload(payload, cached);
        continue;
      }

      await this.fetchPerHash(chunk, headers, cached);
    }

    return cached;
  }

  private static async fetchPerHash(
    hashes: string[],
    headers: Record<string, string>,
    cached: Set<string>
  ): Promise<void> {
    for (const hash of hashes) {
      const payload = await this.fetchInstantAvailabilityPayload(
        `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${hash.toUpperCase()}`,
        headers
      );

      if (payload && !this.isPayloadEmpty(payload)) {
        this.collectCachedHashesFromPayload(payload, cached);
      }
    }
  }

  private static async fetchInstantAvailabilityPayload(
    endpoint: string,
    headers: Record<string, string>
  ): Promise<InstantAvailabilityRecord | undefined> {
    try {
      const response = await request(endpoint, { headers });
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

  async selectFiles(torrentId: string, fileIds: string): Promise<void> {
    const response = await request(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ files: fileIds }).toString()
    });

    if (response.statusCode >= 400) {
      throw new Error(`Failed to select files: ${response.statusCode}`);
    }
  }

  async getTorrentInfo(torrentId: string): Promise<TorrentInfo> {
    const response = await request(`https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });

    if (response.statusCode >= 400) {
      throw new Error(`Failed to get torrent info: ${response.statusCode}`);
    }

    return await response.body.json() as TorrentInfo;
  }

  async unrestrictLink(link: string): Promise<UnrestrictResponse> {
    const response = await request('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ link }).toString()
    });

    if (response.statusCode >= 400) {
      throw new Error(`Failed to unrestrict link: ${response.statusCode}`);
    }

    return await response.body.json() as UnrestrictResponse;
  }

  async processMagnetToDirectUrl(magnet: string, context?: StreamContext): Promise<string> {
    // Add magnet
    const { id: torrentId } = await this.addMagnet(magnet);
    
    // Get torrent info
    const torrentInfo = await this.getTorrentInfo(torrentId);
    
    if (!torrentInfo.files || torrentInfo.files.length === 0) {
      throw new Error(`No files found in torrent: ${torrentId}`);
    }
    
     const selectedFile = this.selectBestFile(torrentInfo.files, context);
    if (!selectedFile) {
      throw new Error('No playable files found in torrent');
    }
    
    // Select file
    await this.selectFiles(torrentId, String(selectedFile.id));
    
    // Check if already downloaded
    const currentInfo = await this.getTorrentInfo(torrentId);
    if (currentInfo.status === 'downloaded') {
      return await this.getDirectDownloadUrl(torrentId);
    }
    
    // Not downloaded yet, wait a bit and check again
    // This gives Real-Debrid a chance to process the torrent
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    
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

  private selectBestFile(
    files: NonNullable<TorrentInfo['files']>,
    context?: StreamContext
  ): NonNullable<TorrentInfo['files']>[number] | undefined {
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

}
