import { request } from 'undici';

export interface SourceOptions { baseUrl: string }

export interface SourceStream {
  name?: string;
  title?: string;
  url?: string; // some addons return url
  magnet?: string; // prefer magnet
  infoHash?: string; // sometimes present
  // Additional metadata from Brazuca
  size?: number; // file size in bytes
  seeders?: number; // number of seeders
  quality?: string; // video quality (1080p, 4K, etc.)
  releaseGroup?: string; // release group name
}

export class TorrentAddonSourceClient {
  private readonly baseUrl: string;
  constructor(opts: SourceOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  // Stremio streams endpoint shape: /stream/{type}/{id}.json
  async getStreams(type: string, id: string): Promise<SourceStream[]> {
    const url = `${this.baseUrl}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    const res = await request(url);
    if (res.statusCode >= 400) {
      throw new Error(`Source fetch failed: ${res.statusCode}`);
    }
    const data = await res.body.json() as { streams?: any[] } | any[];
    const streams = Array.isArray(data) ? data : data.streams || [];
    return streams.map((s: any) => {
      const out: SourceStream = {};
      const title = s.title || s.name;
      if (title) out.title = title;
      if (s.name) out.name = s.name; // Capture name from source
      if (s.url) out.url = s.url;
      const mag = s.magnet || (s.infoHash ? `magnet:?xt=urn:btih:${s.infoHash}` : undefined);
      if (mag) out.magnet = mag;
      if (s.infoHash) out.infoHash = s.infoHash;
      
      // Capture additional metadata from Brazuca
      if (s.size) out.size = s.size;
      if (s.seeders) out.seeders = s.seeders;
      if (s.quality) out.quality = s.quality;
      if (s.releaseGroup) out.releaseGroup = s.releaseGroup;
      
      return out;
    });
  }
}

export async function fetchFirstStreamsFromSources(type: string, id: string, bases: string[]): Promise<SourceStream[]>
{
  const errors: any[] = [];
  for (const base of bases) {
    try {
      const client = new TorrentAddonSourceClient({ baseUrl: base });
      const streams = await client.getStreams(type, id);
      if (streams && streams.length) return streams;
    } catch (e) {
      errors.push([base, (e as Error).message]);
    }
  }
  if (errors.length) {
    throw new Error(`All sources failed: ${errors.map(e => e[0]).join(', ')}`);
  }
  return [];
}


