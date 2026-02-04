/**
 * Stream Service
 */

import type { DebridProvider } from '../models/debrid-model.js';
import type { SourceStream, StreamContext } from '../models/source-model.js';
import type { StremioStream, StremioStreamBehaviorHints } from '../models/stream-model.js';

interface StreamMetadataOptions {
  fallbackMagnet?: string;
  forceNotWebReady?: boolean;
  realDebridReady?: boolean;
  torboxReady?: boolean;
  debridProvider?: DebridProvider;
}

export class StreamService {
  static createStreamMetadata(
    sourceStream: SourceStream,
    url: string,
    options?: StreamMetadataOptions
  ): StremioStream {
    const fallbackTitle = sourceStream.title || 'Unknown file';
    const debridProvider = options?.debridProvider ?? 'realdebrid';
    const rdReady = options?.realDebridReady ?? sourceStream.cached ?? false;
    const tbReady = options?.torboxReady ?? sourceStream.cached ?? false;
    const isReady = debridProvider === 'torbox' ? tbReady : rdReady;
    const providerLabel = debridProvider === 'torbox' ? 'TB' : 'RD';
    const readyLabel =
      debridProvider === 'torbox' ? (isReady ? `${providerLabel}⚡` : providerLabel) : isReady ? `${providerLabel}+` : providerLabel;
    const baseName = sourceStream.name || `[Brazuca Debrid] ${fallbackTitle}`;

    const metadata: StremioStream = {
      name: `[${readyLabel}] ${baseName}`,
      title: fallbackTitle,
      url
    };

    const behaviorHints: StremioStreamBehaviorHints = {};
    const shouldForceNotWebReady = options?.forceNotWebReady ?? true;
    if (shouldForceNotWebReady) {
      behaviorHints.notWebReady = true;
    }
    if (debridProvider === 'torbox') {
      behaviorHints.torboxReady = isReady;
      const bingeGroup = StreamService.buildBingeGroup(sourceStream, debridProvider);
      if (bingeGroup) {
        behaviorHints.bingeGroup = bingeGroup;
      }
      if (sourceStream.fileName) {
        behaviorHints.filename = sourceStream.fileName;
      }
      if (sourceStream.size !== undefined) {
        behaviorHints.videoSize = sourceStream.size;
      }
    } else {
      behaviorHints.realDebridReady = isReady;
    }
    if (options?.fallbackMagnet) {
      behaviorHints.fallbackMagnet = options.fallbackMagnet;
    }
    if (Object.keys(behaviorHints).length > 0) {
      metadata.behaviorHints = behaviorHints;
    }

    if (debridProvider === 'torbox') {
      const description = StreamService.buildTorboxDescription(sourceStream);
      if (description) {
        metadata.description = description;
      }
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

  private static buildBingeGroup(stream: SourceStream, provider: DebridProvider): string | undefined {
    const hash = stream.infoHash?.trim();
    const source = stream.source?.trim();
    if (!hash || !source) {
      return undefined;
    }

    return `${source.toLowerCase()}|${provider}|${hash.toLowerCase()}`;
  }

  private static buildTorboxDescription(stream: SourceStream): string | undefined {
    const fileName = stream.fileName || stream.title;
    if (!fileName) {
      return undefined;
    }

    const lines: string[] = [];
    lines.push(`📄 ${fileName}`);

    const infoParts: string[] = [];
    if (stream.quality) {
      infoParts.push(stream.quality);
    }
    if (stream.releaseGroup) {
      infoParts.push(stream.releaseGroup);
    }
    if (infoParts.length > 0) {
      lines.push(`⭐ ${infoParts.join(' • ')}`);
    }

    if (stream.size !== undefined) {
      lines.push(`💾 ${StreamService.formatBytes(stream.size)}`);
    }

    if (stream.source) {
      lines.push(`🔎 ${stream.source}`);
    }

    return lines.join('\n');
  }

  private static formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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

  static extractTorboxToken(
    query: any,
    headers: any,
    extra?: { torboxToken?: string }
  ): string | undefined {
    const token =
      query.torboxToken ||
      query.tbToken ||
      headers['x-tb-token'] ||
      headers['x-torbox-token'] ||
      extra?.torboxToken;

    if (token && token.length > 10) {
      return token;
    }
    return undefined;
  }

  static extractDebridProvider(query: any, headers: any, extra?: { debridProvider?: string }): DebridProvider | undefined {
    const provider =
      query.debridProvider ||
      query.provider ||
      query.debrid ||
      headers['x-debrid-provider'] ||
      extra?.debridProvider;

    if (!provider || typeof provider !== 'string') {
      return undefined;
    }

    const normalized = provider.toLowerCase();
    if (normalized === 'torbox') {
      return 'torbox';
    }
    if (normalized === 'realdebrid' || normalized === 'real-debrid' || normalized === 'rd') {
      return 'realdebrid';
    }
    return undefined;
  }

  static resolveDebridSelection(params: {
    query: any;
    headers: any;
    extra?: { debridProvider?: string; realdebridToken?: string; torboxToken?: string; token?: string };
    routeParams?: { token?: string };
    env?: { realdebridToken?: string; torboxToken?: string };
  }): { provider?: DebridProvider; token?: string; realdebridToken?: string; torboxToken?: string } {
    const { query, headers, extra, routeParams, env } = params;
    const provider = this.extractDebridProvider(query, headers, extra);
    const realdebridToken =
      this.extractRealDebridToken(query, headers, extra, routeParams) || env?.realdebridToken;
    const torboxToken =
      this.extractTorboxToken(query, headers, extra) || env?.torboxToken;

    if (provider === 'torbox') {
      return { provider, token: torboxToken, realdebridToken, torboxToken };
    }

    if (provider === 'realdebrid') {
      return { provider, token: realdebridToken, realdebridToken, torboxToken };
    }

    if (realdebridToken) {
      return { provider: 'realdebrid', token: realdebridToken, realdebridToken, torboxToken };
    }

    if (torboxToken) {
      return { provider: 'torbox', token: torboxToken, realdebridToken, torboxToken };
    }

    return { provider: provider, realdebridToken, torboxToken };
  }
}
