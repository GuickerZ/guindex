/**
 * Stream Service
 */

import type { SourceStream, StreamContext } from '../models/source-model.js';
import type { StremioStream, StreamResponse } from '../models/stream-model.js';

interface StreamMetadataOptions {
  fallbackUrl?: string;
  forceNotWebReady?: boolean;
  realDebridReady?: boolean;
}

export class StreamService {
  static createStreamMetadata(
    sourceStream: SourceStream,
    url?: string,
    options?: StreamMetadataOptions
  ): StremioStream {
    const fallbackUrl = options?.fallbackUrl || sourceStream.magnet || sourceStream.url;
    const resolvedUrl = url && url.trim().length > 0 ? url : fallbackUrl || '';
    const behaviorHints: StremioStream['behaviorHints'] = {
      notWebReady: options?.forceNotWebReady ?? resolvedUrl.startsWith('magnet:')
    };

    if (options?.realDebridReady !== undefined) {
      behaviorHints.realDebridReady = options.realDebridReady;
    }

    if (fallbackUrl && fallbackUrl.startsWith('magnet:')) {
      behaviorHints.fallbackMagnet = fallbackUrl;
    }

    const metadata: StremioStream = {
      name: sourceStream.name || `[Brazuca RD] ${sourceStream.title || 'Unknown'}`,
      title: sourceStream.title || 'Unknown file',
      url: resolvedUrl,
      behaviorHints
    };

    // Add optional properties only if they exist
    if (sourceStream.infoHash) metadata.infoHash = sourceStream.infoHash;
    if (sourceStream.url) metadata.externalUrl = sourceStream.url;
    else if (!metadata.externalUrl && fallbackUrl && !fallbackUrl.startsWith('magnet:')) {
      metadata.externalUrl = fallbackUrl;
    }
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
