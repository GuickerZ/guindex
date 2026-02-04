/**
 * Lightweight TorBox API client (torrents + WebDL).
 * Implements only what we need for the addon.
 */

import { request } from 'undici';

export type TorboxDownloadState =
  | 'downloading'
  | 'uploading'
  | 'stalled'
  | 'paused'
  | 'completed'
  | 'cached'
  | 'metaDL'
  | 'checkingResumeData'
  | string;

export interface TorboxFile {
  id?: number;
  name?: string;
  short_name?: string;
  path?: string;
  size?: number;
  opensubtitles_hash?: string;
}

export interface TorboxTorrent {
  id: number;
  hash: string;
  name?: string;
  size?: number;
  download_finished?: boolean;
  download_present?: boolean;
  progress?: number;
  download_state?: TorboxDownloadState;
  files?: TorboxFile[];
}

export interface TorboxWebDl extends TorboxTorrent {
  web_id?: number;
  original_url?: string;
}

export interface CheckCachedItem {
  name?: string;
  size?: number;
  hash?: string;
  files?: Array<{ name: string; size: number }>;
}

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  detail?: string;
  error?: string;
}

export interface TorboxClientOptions {
  token: string;
  baseUrl?: string;
  userAgent?: string;
}

export class TorboxClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userAgent: string;

  constructor(options: TorboxClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl || 'https://api.torbox.app').replace(/\/$/, '');
    this.userAgent = options.userAgent || 'brazuca-rd';
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'X-API-Key': this.token,
      'User-Agent': this.userAgent
    };
  }

  private async get<T>(path: string, search?: Record<string, string | number | boolean | string[]>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (search) {
      for (const [key, value] of Object.entries(search)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, String(v)));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const res = await request(url.toString(), { headers: this.headers() });
    const bodyText = await res.body.text();

    if (res.statusCode >= 400) {
      throw new Error(`TorBox GET ${path} failed: ${res.statusCode} ${bodyText}`);
    }

    const parsed = (bodyText ? JSON.parse(bodyText) : {}) as ApiResponse<T>;
    if (parsed.success === false || parsed.error) {
      throw new Error(`TorBox error: ${parsed.error ?? parsed.detail ?? 'unknown'}`);
    }
    return (parsed.data ?? (parsed as unknown as T)) as T;
  }

  private async post<T>(path: string, form: Record<string, string | number | boolean>): Promise<T> {
    const url = this.baseUrl + path;
    const formData = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      formData.append(k, String(v));
    }

    const res = await request(url, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    const bodyText = await res.body.text();
    if (res.statusCode >= 400) {
      throw new Error(`TorBox POST ${path} failed: ${res.statusCode} ${bodyText}`);
    }

    const parsed = (bodyText ? JSON.parse(bodyText) : {}) as ApiResponse<T>;
    if (parsed.success === false || parsed.error) {
      throw new Error(`TorBox error: ${parsed.error ?? parsed.detail ?? 'unknown'}`);
    }
    return (parsed.data ?? (parsed as unknown as T)) as T;
  }

  async checkTorrentsCached(hashes: string[], listFiles = true): Promise<CheckCachedItem[]> {
    if (!hashes.length) return [];
    return this.get<CheckCachedItem[]>('/v1/api/torrents/checkcached', {
      hash: hashes,
      format: 'list',
      list_files: listFiles
    });
  }

  async createTorrent(magnet: string): Promise<{ torrent_id: number; hash: string }> {
    return this.post<{ torrent_id: number; hash: string }>('/v1/api/torrents/createtorrent', {
      magnet,
      allow_zip: false
    });
  }

  async getTorrent(id: number): Promise<TorboxTorrent> {
    return this.get<TorboxTorrent>('/v1/api/torrents/mylist', { id, bypass_cache: true });
  }

  async requestDownloadLink(params: { torrentId: number; fileId?: number; userIp?: string }): Promise<string> {
    const url = new URL(this.baseUrl + '/v1/api/torrents/requestdl');
    url.searchParams.set('token', this.token);
    url.searchParams.set('torrent_id', String(params.torrentId));
    if (params.fileId !== undefined) url.searchParams.set('file_id', String(params.fileId));
    if (params.userIp) url.searchParams.set('user_ip', params.userIp);
    url.searchParams.set('zip_link', 'false');

    const res = await request(url.toString(), { headers: this.headers() });
    const text = await res.body.text();
    if (res.statusCode >= 400 || !text) {
      throw new Error(`TorBox requestDownloadLink failed: ${res.statusCode} ${text}`);
    }
    return text.trim();
  }

  async checkWebDlCached(hashes: string[]): Promise<CheckCachedItem[]> {
    if (!hashes.length) return [];
    return this.get<CheckCachedItem[]>('/v1/api/webdl/checkcached', { hash: hashes, format: 'list' });
  }

  async createWebDl(link: string, name?: string): Promise<{ webdownload_id: number; hash: string }> {
    return this.post<{ webdownload_id: number; hash: string }>('/v1/api/webdl/createwebdownload', {
      link,
      name: name ?? '',
      as_queued: false
    });
  }

  async getWebDl(id: number): Promise<TorboxWebDl> {
    return this.get<TorboxWebDl>('/v1/api/webdl/mylist', { id, bypass_cache: true });
  }

  async requestWebDlLink(params: { webId: number; fileId?: number; userIp?: string }): Promise<string> {
    const url = new URL(this.baseUrl + '/v1/api/webdl/requestdl');
    url.searchParams.set('token', this.token);
    url.searchParams.set('web_id', String(params.webId));
    if (params.fileId !== undefined) url.searchParams.set('file_id', String(params.fileId));
    if (params.userIp) url.searchParams.set('user_ip', params.userIp);
    url.searchParams.set('zip_link', 'false');

    const res = await request(url.toString(), { headers: this.headers() });
    const text = await res.body.text();
    if (res.statusCode >= 400 || !text) {
      throw new Error(`TorBox requestWebDlLink failed: ${res.statusCode} ${text}`);
    }
    return text.trim();
  }
}
