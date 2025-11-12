/**
 * Stream Service
 */

import type { SourceStream, StreamContext } from '../models/source-model.js';
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

  static encodeStreamContext(context?: StreamContext): string | undefined {
    if (!context) {
      return undefined;
    }

    try {
      const json = JSON.stringify(context);
      if (!json) {
        return undefined;
      }

      const buffer = Buffer.from(json, 'utf-8');
      const base64 = buffer.toString('base64');
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    } catch {
      return undefined;
    }
  }

  static decodeStreamContext(encoded?: string): StreamContext | undefined {
    if (!encoded) {
      return undefined;
    }

    try {
      let normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
      while (normalized.length % 4 !== 0) {
        normalized += '=';
      }

      const buffer = Buffer.from(normalized, 'base64');
      const json = buffer.toString('utf-8');
      if (!json) {
        return undefined;
      }

      const context = JSON.parse(json) as StreamContext;
      return context;
    } catch {
      return undefined;
    }
  }

  static extractRealDebridToken(
  query: any,
  headers: any,
  extra?: { realdebridToken?: string; token?: string },
  params?: { token?: string }
): string | undefined {
  const token =
    query.realdebridToken ||
    query.rdToken ||
    query.token ||
    headers['x-rd-token'] ||
    extra?.realdebridToken ||
    extra?.token ||
    params?.token;

  // Valida token com tamanho típico do Real-Debrid
  if (token && token.length > 20) return token;
  return undefined;
}

}
