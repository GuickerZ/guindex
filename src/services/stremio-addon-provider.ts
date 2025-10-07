/**
 * Stremio Addon Source Provider
 */

import { request } from 'undici';
import { BaseSourceProvider } from './base-source-provider.js';
import type { SourceStream } from '../models/source-model.js';

export class StremioAddonProvider extends BaseSourceProvider {
  constructor(name: string, private baseUrl: string) {
    super(name);
  }

  async getStreams(type: string, id: string): Promise<SourceStream[]> {
    const url = `${this.baseUrl}/stream/${type}/${id}.json`;
    const response = await request(url);
    
    if (response.statusCode >= 400) {
      throw new Error(`Failed to fetch streams from ${this.name}: ${response.statusCode}`);
    }
    
    const data = await response.body.json() as {streams: SourceStream[]};
    const streams = data.streams || [];
    
    // Attach source name to each stream
    return streams.map((stream) => {
      const result: SourceStream = { ...stream };
      if (stream.name) {
        result.name = `[Brazuca RD] ${stream.name}`;
      }
      return result;
    });
  }
}
