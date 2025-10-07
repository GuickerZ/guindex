/**
 * Stream Service
 */

import type { SourceStream } from '../models/source-model.js';
import type { StremioStream, StreamResponse } from '../models/stream-model.js';

export class StreamService {
  static createStreamMetadata(sourceStream: SourceStream, url: string): StremioStream {
    const metadata: StremioStream = {
      name: sourceStream.name || `[Brazuca RD] ${sourceStream.title || 'Unknown'}`,
      title: sourceStream.title || 'Unknown file',
      url: url, // This will be either a magnet link or direct URL
      behaviorHints: { notWebReady: false }
    };

    // Add optional properties only if they exist
    if (sourceStream.infoHash) metadata.infoHash = sourceStream.infoHash;
    if (sourceStream.url) metadata.externalUrl = sourceStream.url;
    if (sourceStream.size !== undefined) metadata.size = sourceStream.size;
    if (sourceStream.seeders !== undefined) metadata.seeders = sourceStream.seeders;
    if (sourceStream.quality) metadata.quality = sourceStream.quality;
    if (sourceStream.releaseGroup) metadata.releaseGroup = sourceStream.releaseGroup;

    return metadata;
  }

  static extractRealDebridToken(query: any, headers: any, extra?: { realdebridToken?: string; token?: string }): string | undefined {
    return query.realdebridToken || 
           query.rdToken || 
           query.token || 
           headers['x-rd-token'] || 
           extra?.realdebridToken || 
           extra?.token;
  }
}
