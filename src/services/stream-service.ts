/**
 * Stream Service
 */

import type { SourceStream, StreamContext } from '../models/source-model.js';
import type { StremioStream, StremioStreamBehaviorHints } from '../models/stream-model.js';

interface StreamMetadataOptions {
  fallbackMagnet?: string;
  forceNotWebReady?: boolean;
  realDebridReady?: boolean;
}

export class StreamService {
  static createStreamMetadata(
    sourceStream: SourceStream,
    url: string,
    options?: StreamMetadataOptions
  ): StremioStream {
    const fallbackTitle = sourceStream.title || 'Unknown file';
    const rdReady = options?.realDebridReady ?? sourceStream.cached ?? false;
    const rdLabel = rdReady ? 'RD+' : 'RD';
    const baseName = sourceStream.name || `[Brazuca RD] ${fallbackTitle}`;

    const metadata: StremioStream = {
      name: `[${rdLabel}] ${baseName}`,
      title: fallbackTitle,
      url
    };

    const behaviorHints: StremioStreamBehaviorHints = {};
    const shouldForceNotWebReady = options?.forceNotWebReady ?? true;
    if (shouldForceNotWebReady) {
      behaviorHints.notWebReady = true;
    }
    behaviorHints.realDebridReady = rdReady;
    if (options?.fallbackMagnet) {
      behaviorHints.fallbackMagnet = options.fallbackMagnet;
    }
    if (Object.keys(behaviorHints).length > 0) {
      metadata.behaviorHints = behaviorHints;
    }

    // Add optional properties only if they exist
    if (sourceStream.infoHash) metadata.infoHash = sourceStream.infoHash;
    const externalUrl = StreamService.sanitizeExternalUrl(sourceStream.url);
    if (externalUrl) metadata.externalUrl = externalUrl;
    if (sourceStream.size !== undefined) metadata.size = sourceStream.size;
    if (sourceStream.seeders !== undefined) metadata.seeders = sourceStream.seeders;
    if (sourceStream.quality) metadata.quality = sourceStream.quality;
    if (sourceStream.releaseGroup) metadata.releaseGroup = sourceStream.releaseGroup;

    return metadata;
  }

  private static sanitizeExternalUrl(url?: string): string | undefined {
    if (!url) {
      return undefined;
    }

    const trimmed = url.trim();
    if (!trimmed) {
      return undefined;
    }

    if (!/^https:\/\//i.test(trimmed)) {
      return undefined;
    }

    try {
      const parsed = new URL(trimmed);
      parsed.protocol = 'https:';
      return parsed.toString();
    } catch {
      return undefined;
    }
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

    // Validate token length using the typical Real-Debrid size to avoid accidental short inputs
    if (token && token.length > 20) {
      return token;
    }
    return undefined;
  }
}
