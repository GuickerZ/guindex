/**
 * Stream Service
 */

import type { DebridProvider } from '../models/debrid-model.js';
import type { SourceStream, StreamContext } from '../models/source-model.js';
import type { StremioStream, StremioStreamBehaviorHints } from '../models/stream-model.js';

const LANGUAGE_DISPLAY_ALIASES: Record<string, string> = {
  portuguese: 'Portuguese',
  portugues: 'Portuguese',
  'pt-br': 'Portuguese',
  'pt br': 'Portuguese',
  ptbr: 'Portuguese',
  brazilian: 'Portuguese',
  'brazilian portuguese': 'Portuguese',
  dublado: 'Portuguese',
  dublada: 'Portuguese',
  english: 'English',
  ingles: 'English',
  eng: 'English',
  spanish: 'Spanish',
  espanhol: 'Spanish',
  espanol: 'Spanish',
  castellano: 'Spanish',
  latino: 'Spanish',
  french: 'French',
  frances: 'French',
  italian: 'Italian',
  italiano: 'Italian',
  german: 'German',
  alemao: 'German',
  japanese: 'Japanese',
  japones: 'Japanese',
  korean: 'Korean',
  coreano: 'Korean',
  chinese: 'Chinese',
  chines: 'Chinese',
  mandarin: 'Chinese',
  mandarim: 'Chinese',
  russian: 'Russian',
  russo: 'Russian',
  hindi: 'Hindi',
  arabic: 'Arabic',
  arabe: 'Arabic'
};

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
    const displayFileName = StreamService.pickDisplayFileName(sourceStream);
    const fallbackTitle = displayFileName || sourceStream.title || 'Unknown file';
    let displayTitle = displayFileName || sourceStream.title || fallbackTitle;
    const normalizedLanguages = StreamService.normalizeLanguages(sourceStream.languages);
    const languageTag = StreamService.buildLanguageTag(normalizedLanguages);
    if (languageTag) {
      displayTitle = StreamService.appendLanguageTag(displayTitle, languageTag);
    }
    const debridProvider = options?.debridProvider ?? 'realdebrid';
    const rdReady = options?.realDebridReady ?? sourceStream.cached ?? false;
    const tbReady = options?.torboxReady ?? sourceStream.cached ?? false;
    const isReady = debridProvider === 'torbox' ? tbReady : rdReady;
    const providerLabel = debridProvider === 'torbox' ? 'TB' : 'RD';
    const readyLabel =
      debridProvider === 'torbox'
        ? isReady
          ? `${providerLabel}+`
          : `${providerLabel}~`
        : isReady
          ? `${providerLabel}+`
          : providerLabel;
    const baseName = sourceStream.name || `[Brazuca Debrid] ${displayTitle}`;

    let displayName =
      debridProvider === 'torbox'
        ? `[${readyLabel}] ${StreamService.buildTorboxName(sourceStream, displayTitle)}`
        : `[${readyLabel}] ${baseName}`;
    if (languageTag) {
      displayName = StreamService.appendLanguageTag(displayName, languageTag);
    }
    const metadata: StremioStream = {
      name: displayName,
      title: displayTitle,
      url
    };
    if (normalizedLanguages.length > 0) {
      metadata.languages = normalizedLanguages;
    }

    const behaviorHints: StremioStreamBehaviorHints = {};
    const shouldForceNotWebReady = options?.forceNotWebReady ?? true;
    const hintFileName = displayFileName || sourceStream.fileName;
    if (hintFileName) {
      behaviorHints.filename = hintFileName;
    }
    if (sourceStream.size != undefined) {
      behaviorHints.videoSize = sourceStream.size;
    }

    if (debridProvider === 'torbox') {
      behaviorHints.torboxReady = isReady;
      const bingeGroup = StreamService.buildBingeGroup(sourceStream, debridProvider);
      if (bingeGroup) {
        behaviorHints.bingeGroup = bingeGroup;
      }
    } else {
      if (shouldForceNotWebReady) {
        behaviorHints.notWebReady = true;
      }
      behaviorHints.realDebridReady = isReady;
    }
    if (options?.fallbackMagnet && debridProvider !== 'torbox') {
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
      if (!isReady && !metadata.description) {
        metadata.description = 'Baixando no TorBox - aguarde alguns segundos e tente novamente.';
      }
    }

    // Add optional properties only if they exist
    if (sourceStream.infoHash) {
      const normalizedHash = sourceStream.infoHash.trim().toLowerCase();
      if (normalizedHash) {
        metadata.infoHash = normalizedHash;
      }
    }
    const externalUrl = StreamService.sanitizeExternalUrl(sourceStream.detailUrl ?? sourceStream.url);
    if (externalUrl) metadata.externalUrl = externalUrl;
    if (sourceStream.size != undefined) metadata.size = sourceStream.size;
    if (sourceStream.seeders != undefined) metadata.seeders = sourceStream.seeders;
    if (sourceStream.quality) metadata.quality = sourceStream.quality;
    if (sourceStream.releaseGroup) metadata.releaseGroup = sourceStream.releaseGroup;

    return metadata;
  }

  private static buildLanguageTag(languages?: string[]): string | undefined {
    const canonical = StreamService.normalizeLanguages(languages);
    if (canonical.length === 0) {
      return undefined;
    }
    return canonical.join('/');
  }

  private static appendLanguageTag(value: string, tag: string): string {
    if (!value) {
      return value;
    }
    const marker = `[${tag}]`;
    if (value.includes(marker)) {
      return value;
    }
    return `${value} ${marker}`.trim();
  }

  private static normalizeLanguageKey(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private static normalizeLanguages(languages?: string[]): string[] {
    if (!Array.isArray(languages)) {
      return [];
    }

    const tagMap = new Map<string, string>();
    for (const language of languages) {
      if (typeof language !== 'string') {
        continue;
      }
      const trimmed = language.trim();
      if (!trimmed) {
        continue;
      }
      const key = StreamService.normalizeLanguageKey(trimmed);
      const canonical = LANGUAGE_DISPLAY_ALIASES[key] ?? trimmed;
      const canonicalKey = StreamService.normalizeLanguageKey(canonical);
      if (canonicalKey) {
        tagMap.set(canonicalKey, canonical);
      }
    }

    const ordered = Array.from(tagMap.values()).sort((a, b) => {
      const pa = StreamService.languagePriority(a);
      const pb = StreamService.languagePriority(b);
      if (pa !== pb) return pb - pa; // higher priority first
      return a.localeCompare(b);
    });

    return ordered;
  }

  private static languagePriority(value: string): number {
    const key = StreamService.normalizeLanguageKey(value);
    if (['portuguese', 'brazilian', 'pt-br', 'ptbr', 'pt'].includes(key)) return 100;
    if (['english', 'eng', 'en'].includes(key)) return 90;
    return 0;
  }

  private static buildBingeGroup(stream: SourceStream, provider: DebridProvider): string | undefined {
    const hash = stream.infoHash?.trim();
    const source = stream.source?.trim();
    if (!hash || !source) {
      return undefined;
    }

    return `${source.toLowerCase()}|${provider}|${hash.toLowerCase()}`;
  }

  private static buildTorboxName(stream: SourceStream, fallbackTitle: string): string {
    const source = stream.source?.trim();
    const quality = stream.quality?.trim();
    if (source && quality) {
      return `${source} ${quality}`;
    }
    if (source) {
      return source;
    }
    if (quality) {
      return quality;
    }
    return fallbackTitle;
  }

  private static pickDisplayFileName(stream: SourceStream): string | undefined {
    const direct = stream.fileName?.trim();
    if (direct) {
      return direct;
    }
    return StreamService.pickFirstLine(stream.title);
  }

  private static pickFirstLine(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    const lines = value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines[0];
  }

  private static buildTorboxDescription(stream: SourceStream): string | undefined {
    const lines: string[] = [];
    const fileName = StreamService.pickDisplayFileName(stream);
    if (fileName) {
      lines.push(`File: ${fileName}`);
    }

    const titleLine = StreamService.pickFirstLine(stream.title);
    if (titleLine && titleLine != fileName) {
      lines.push(`Title: ${titleLine}`);
    }

    if (stream.quality) {
      lines.push(`Quality: ${stream.quality}`);
    }
    if (stream.releaseGroup) {
      lines.push(`Group: ${stream.releaseGroup}`);
    }
    if (stream.size != undefined) {
      lines.push(`Size: ${StreamService.formatBytes(stream.size)}`);
    }
    if (stream.seeders != undefined) {
      lines.push(`Seeders: ${Math.max(0, Math.floor(stream.seeders))}`);
    }
    if (Array.isArray(stream.languages) && stream.languages.length > 0) {
      lines.push(`Languages: ${stream.languages.join(', ')}`);
    }
    if (stream.source) {
      lines.push(`Source: ${stream.source}`);
    }

    const link = StreamService.sanitizeExternalUrl(stream.detailUrl ?? stream.url);
    if (link) {
      lines.push(`Link: ${link}`);
    }

    return lines.length > 0 ? lines.join('\n') : undefined;
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

    if (!/^https?:\/\//i.test(trimmed)) {
      return undefined;
    }

    try {
      const parsed = new URL(trimmed);
      const path = parsed.pathname.toLowerCase();
      if (path.includes('/resolve') || path.includes('/playback')) {
        return undefined;
      }
      if (parsed.searchParams.has('magnet') || parsed.searchParams.has('linkType')) {
        return undefined;
      }

      for (const key of [...parsed.searchParams.keys()]) {
        if (/token|apikey|api_key|rdtoken|tbtoken|torbox|realdebrid|debrid/i.test(key)) {
          parsed.searchParams.delete(key);
        }
      }

      parsed.username = '';
      parsed.password = '';
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
    const torboxToken = this.extractTorboxToken(query, headers, extra) || env?.torboxToken;

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
