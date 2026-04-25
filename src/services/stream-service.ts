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
  en: 'English',
  spanish: 'Spanish',
  espanhol: 'Spanish',
  espanol: 'Spanish',
  spa: 'Spanish',
  es: 'Spanish',
  castellano: 'Spanish',
  latino: 'Spanish',
  french: 'French',
  frances: 'French',
  fre: 'French',
  fra: 'French',
  fr: 'French',
  italian: 'Italian',
  italiano: 'Italian',
  ita: 'Italian',
  it: 'Italian',
  german: 'German',
  alemao: 'German',
  ger: 'German',
  deu: 'German',
  de: 'German',
  japanese: 'Japanese',
  japones: 'Japanese',
  jpn: 'Japanese',
  ja: 'Japanese',
  korean: 'Korean',
  coreano: 'Korean',
  kor: 'Korean',
  ko: 'Korean',
  chinese: 'Chinese',
  chines: 'Chinese',
  mandarin: 'Chinese',
  mandarim: 'Chinese',
  chi: 'Chinese',
  zho: 'Chinese',
  zh: 'Chinese',
  russian: 'Russian',
  russo: 'Russian',
  rus: 'Russian',
  ru: 'Russian',
  hindi: 'Hindi',
  hin: 'Hindi',
  hi: 'Hindi',
  arabic: 'Arabic',
  arabe: 'Arabic',
  turkish: 'Turkish',
  turco: 'Turkish',
  tur: 'Turkish',
  tr: 'Turkish',
  polish: 'Polish',
  polones: 'Polish',
  pol: 'Polish',
  pl: 'Polish',
  dutch: 'Dutch',
  holandes: 'Dutch',
  nld: 'Dutch',
  nl: 'Dutch',
  swedish: 'Swedish',
  sueco: 'Swedish',
  swe: 'Swedish',
  sv: 'Swedish',
  norwegian: 'Norwegian',
  noruegues: 'Norwegian',
  nor: 'Norwegian',
  no: 'Norwegian',
  danish: 'Danish',
  dinamarques: 'Danish',
  dan: 'Danish',
  da: 'Danish',
  finnish: 'Finnish',
  finlandes: 'Finnish',
  fin: 'Finnish',
  fi: 'Finnish',
  czech: 'Czech',
  tcheco: 'Czech',
  ces: 'Czech',
  cs: 'Czech',
  hungarian: 'Hungarian',
  hungaro: 'Hungarian',
  hun: 'Hungarian',
  hu: 'Hungarian',
  ukrainian: 'Ukrainian',
  ucraniano: 'Ukrainian',
  ukr: 'Ukrainian',
  uk: 'Ukrainian'
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
    const displayTitle = displayFileName || sourceStream.title || fallbackTitle;
    const normalizedLanguages = StreamService.detectLanguages(sourceStream);
    const debridProvider = options?.debridProvider ?? 'realdebrid';
    const rdReady = options?.realDebridReady ?? sourceStream.cached ?? false;
    const tbReady = options?.torboxReady ?? sourceStream.cached ?? false;
    const isReady = debridProvider === 'torbox' ? tbReady : rdReady;
    const providerLabel = debridProvider === 'torbox' ? 'TB' : 'RD';
    const readyLabel =
      debridProvider === 'torbox'
        ? isReady
          ? `${providerLabel}+`
          : `${providerLabel}⏳`
        : isReady
          ? `${providerLabel}+`
          : providerLabel;
    const baseName = sourceStream.name || `[GuIndex] ${displayTitle}`;

    const displayName =
      debridProvider === 'torbox'
        ? `[${readyLabel}] ${StreamService.buildTorboxName(sourceStream, displayTitle)}`
        : `[${readyLabel}] ${baseName}`;
    const metadata: StremioStream = {
      name: displayName,
      title: displayTitle,
      url
    };

    const infoHash = StreamService.extractInfoHash(sourceStream);
    if (infoHash) {
      metadata.infoHash = infoHash;
    }
    if (sourceStream.size != undefined) {
      metadata.size = sourceStream.size;
    }
    if (sourceStream.seeders != undefined) {
      metadata.seeders = sourceStream.seeders;
    }
    if (sourceStream.quality) {
      metadata.quality = sourceStream.quality;
    }
    if (normalizedLanguages.length > 0) {
      metadata.languages = normalizedLanguages;
    }

    const behaviorHints: StremioStreamBehaviorHints = {};
    const shouldForceNotWebReady = options?.forceNotWebReady ?? true;
    const hintFileName = displayFileName || sourceStream.fileName;
    if (sourceStream.size != undefined) {
      behaviorHints.videoSize = sourceStream.size;
    }

    if (debridProvider === 'torbox') {
      behaviorHints.torboxReady = isReady;
      if (!isReady) {
        behaviorHints.notWebReady = true;
      }
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

    const sourceLabelMeta = StreamService.pickIndexer(sourceStream, behaviorHints, url);
    if (sourceLabelMeta) metadata.indexer = sourceLabelMeta;

    let decoratedFilename = hintFileName
      ? StreamService.appendLanguageToFilename(hintFileName, normalizedLanguages)
      : undefined;
    if (decoratedFilename) {
      decoratedFilename = StreamService.appendGroupToFilename(decoratedFilename, sourceLabelMeta);
      behaviorHints.filename = decoratedFilename;
      metadata.filename = decoratedFilename;
      metadata.folderName = StreamService.pickFolderName(decoratedFilename);
    }
    if (sourceLabelMeta) {
      metadata.releaseGroup = StreamService.sanitizeGroup(sourceLabelMeta);
    }

    return metadata;
  }

  private static buildLanguageTag(languages?: string[]): string | undefined {
    return undefined; // we no longer append tags to name/title
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

  private static detectLanguages(stream: SourceStream): string[] {
    const fromSource = Array.isArray(stream.languages) ? stream.languages : [];
    const text = `${stream.fileName ?? ''} ${stream.title ?? ''}`.toLowerCase();
    const normalizedText = StreamService.normalizeLanguageKey(text);

    const detected: string[] = [];
    if (/\b(pt[\s\.\-_]?br|brazilian|dublado|dublada|portuguese|portugues|ptbr)\b/.test(normalizedText)) {
      detected.push('Portuguese');
    }
    if (/\b(english|eng|en)\b/.test(normalizedText)) {
      detected.push('English');
    }
    if (/\b(spanish|espanol|latino|castellano|spa|es)\b/.test(normalizedText)) {
      detected.push('Spanish');
    }
    if (/\b(french|frances|fre|fra|fr)\b/.test(normalizedText)) {
      detected.push('French');
    }
    if (/\b(italian|italiano|ita)\b/.test(normalizedText)) {
      detected.push('Italian');
    }
    if (/\b(german|alemao|ger|deu|de)\b/.test(normalizedText)) {
      detected.push('German');
    }
    if (/\b(japanese|japones|jpn|ja)\b/.test(normalizedText)) {
      detected.push('Japanese');
    }
    if (/\b(korean|coreano|kor|ko)\b/.test(normalizedText)) {
      detected.push('Korean');
    }
    if (/\b(chinese|chines|mandarin|mandarim|chi|zho|zh)\b/.test(normalizedText)) {
      detected.push('Chinese');
    }
    if (/\b(russian|russo|rus|ru)\b/.test(normalizedText)) {
      detected.push('Russian');
    }
    if (/\b(hindi|hin|hi)\b/.test(normalizedText)) {
      detected.push('Hindi');
    }
    if (/\b(turkish|turco|tur|tr)\b/.test(normalizedText)) {
      detected.push('Turkish');
    }
    if (/\b(polish|polones|pol|pl)\b/.test(normalizedText)) {
      detected.push('Polish');
    }
    if (/\b(dutch|holandes|nld|nl)\b/.test(normalizedText)) {
      detected.push('Dutch');
    }
    if (/\b(ukrainian|ucraniano|ukr|uk)\b/.test(normalizedText)) {
      detected.push('Ukrainian');
    }

    // Many releases tag "Dual Audio" without listing the second language explicitly.
    if (/\bdual\s*audio\b/.test(normalizedText) && detected.includes('Portuguese') && !detected.includes('English')) {
      detected.push('English');
    }

    return StreamService.normalizeLanguages([...fromSource, ...detected]);
  }

  private static buildLanguageCodes(languages: string[]): string[] {
    const hasPt = languages.some((l) => ['portuguese', 'brazilian', 'pt-br', 'ptbr', 'pt','dublado'].includes(StreamService.normalizeLanguageKey(l)));
    const hasEn = languages.some((l) => ['english', 'eng', 'en'].includes(StreamService.normalizeLanguageKey(l)));
    const hasEs = languages.some((l) => ['spanish', 'espanol', 'español', 'es'].includes(StreamService.normalizeLanguageKey(l)));
    const hasFr = languages.some((l) => ['french', 'frances', 'fr'].includes(StreamService.normalizeLanguageKey(l)));
    const hasIt = languages.some((l) => ['italian', 'italiano', 'it'].includes(StreamService.normalizeLanguageKey(l)));
    const hasDe = languages.some((l) => ['german', 'alemao', 'de'].includes(StreamService.normalizeLanguageKey(l)));
    const hasJa = languages.some((l) => ['japanese', 'japones', 'jp'].includes(StreamService.normalizeLanguageKey(l)));
    const hasKo = languages.some((l) => ['korean', 'coreano', 'kr', 'ko'].includes(StreamService.normalizeLanguageKey(l)));
    const hasZh = languages.some((l) => ['chinese', 'chines', 'zh', 'mandarin'].includes(StreamService.normalizeLanguageKey(l)));
    const hasRu = languages.some((l) => ['russian', 'russo', 'ru'].includes(StreamService.normalizeLanguageKey(l)));
    const hasHi = languages.some((l) => ['hindi', 'hi'].includes(StreamService.normalizeLanguageKey(l)));

    const codes: string[] = [];
    if (hasPt) codes.push('PT');
    if (hasEn) codes.push('EN');
    if (hasEs) codes.push('ES');
    if (hasFr) codes.push('FR');
    if (hasIt) codes.push('IT');
    if (hasDe) codes.push('DE');
    if (hasJa) codes.push('JA');
    if (hasKo) codes.push('KO');
    if (hasZh) codes.push('ZH');
    if (hasRu) codes.push('RU');
    if (hasHi) codes.push('HI');
    return codes;
  }

  private static appendLanguageToFilename(filename: string, languages: string[]): string {
    if (!filename || !Array.isArray(languages) || languages.length === 0) {
      return filename;
    }

    const codes = StreamService.languageCodeTokens(languages); // ex: PTBR, ENG
    if (codes.length === 0) {
      return filename;
    }

    if (codes.length > 1 && !codes.includes('DUAL')) {
      codes.push('DUAL');
    }

    const lastDot = filename.lastIndexOf('.');
    const extCandidate = lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : '';
    const isKnownExt = /(mkv|mp4|avi|m4v|ts|m2ts|iso|mpg|mpeg|wmv|mov|rar|zip)$/.test(extCandidate);
    const base = lastDot > 0 && isKnownExt ? filename.slice(0, lastDot) : filename;
    const ext = lastDot > 0 && isKnownExt ? filename.slice(lastDot) : '';

    const upperBase = base.toUpperCase();
    const missing = codes.filter((code) => !new RegExp(`\\b${code}\\b`, 'i').test(upperBase));
    if (missing.length === 0) {
      return filename;
    }

    const newBase = `${base} ${missing.join(' ')}`;
    return `${newBase}${ext}`;
  }

  private static extractInfoHash(stream: SourceStream): string | undefined {
    if (typeof stream.infoHash === 'string' && stream.infoHash.trim()) {
      return stream.infoHash.trim().toLowerCase();
    }

    const magnet = stream.magnet || (stream.url?.startsWith('magnet:') ? stream.url : undefined);
    if (!magnet) return undefined;

    const match = magnet.match(/xt=urn:btih:([^&]+)/i);
    if (!match?.[1]) return undefined;
    return match[1].trim().toLowerCase();
  }

  private static languageCodeTokens(languages: string[]): string[] {
    const norm = (v: string) => StreamService.normalizeLanguageKey(v);
    const codes: string[] = [];
    for (const lang of languages) {
      const k = norm(lang);
      if (['portuguese', 'brazilian', 'pt-br', 'ptbr', 'pt', 'dublado', 'dublada'].includes(k)) codes.push('PTBR');
      else if (['english', 'eng', 'en'].includes(k)) codes.push('ENG');
      else if (['spanish', 'espanol', 'español', 'es', 'latino', 'castellano'].includes(k)) codes.push('SPA');
      else if (['french', 'frances', 'fr'].includes(k)) codes.push('FRE');
      else if (['italian', 'italiano', 'it'].includes(k)) codes.push('ITA');
      else if (['german', 'alemao', 'de'].includes(k)) codes.push('GER');
      else if (['japanese', 'japones', 'jp'].includes(k)) codes.push('JPN');
      else if (['korean', 'coreano', 'kr', 'ko'].includes(k)) codes.push('KOR');
      else if (['chinese', 'chines', 'zh', 'mandarin'].includes(k)) codes.push('CHI');
      else if (['russian', 'russo', 'ru'].includes(k)) codes.push('RUS');
      else if (['hindi', 'hi'].includes(k)) codes.push('HIN');
    }
    return Array.from(new Set(codes));
  }

  private static sanitizeGroup(group?: string): string | undefined {
    if (!group) return undefined;
    const trimmed = group.trim().replace(/^www\./i, '');
    if (!trimmed) return undefined;
    const base = trimmed.split('.')[0] || trimmed;
    const cleaned = base.replace(/[^A-Za-z0-9_-]/g, '');
    return cleaned || undefined;
  }

  private static appendGroupToFilename(filename: string, group?: string): string {
    const cleanGroup = StreamService.sanitizeGroup(group);
    if (!filename || !cleanGroup) return filename;

    const lastDot = filename.lastIndexOf('.');
    const extCandidate = lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : '';
    const isKnownExt = /(mkv|mp4|avi|m4v|ts|m2ts|iso|mpg|mpeg|wmv|mov|rar|zip)$/.test(extCandidate);
    const base = lastDot > 0 && isKnownExt ? filename.slice(0, lastDot) : filename;
    const ext = lastDot > 0 && isKnownExt ? filename.slice(lastDot) : '';

    if (new RegExp(`-${cleanGroup}$`, 'i').test(base)) {
      return filename;
    }

    const withGroup = `${base}-${cleanGroup}`;
    return `${withGroup}${ext}`;
  }

  private static pickFolderName(filename: string): string | undefined {
    if (!filename) return undefined;
    const lastSlash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
    const name = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;
    const lastDot = name.lastIndexOf('.');
    if (lastDot > 0) {
      return name.slice(0, lastDot);
    }
    return name;
  }

  private static pickReleaseGroup(value?: string): string | undefined {
    if (!value) return undefined;
    const basename = value
      .replace(/[/\\]+/g, '/')
      .split('/')
      .pop() ?? value;
    const noExt = basename.replace(/\.[a-z0-9]{2,4}$/i, '');
    const parts = noExt.split('-');
    if (parts.length < 2) return undefined;
    const candidate = parts[parts.length - 1]?.trim();
    if (candidate && /^[A-Za-z0-9]{2,15}$/.test(candidate)) {
      return candidate;
    }
    return undefined;
  }

  private static pickIndexer(
    stream: SourceStream,
    behaviorHints: StremioStreamBehaviorHints | undefined,
    url: string
  ): string | undefined {
    if (stream.source && stream.source.trim()) {
      return stream.source.trim();
    }

    if (behaviorHints?.bingeGroup) {
      const parts = behaviorHints.bingeGroup.split('|');
      if (parts[0]) return parts[0];
    }

    const host =
      StreamService.extractHost(stream.detailUrl) ||
      StreamService.extractHost(stream.url) ||
      StreamService.extractHost(url);
    if (host) return host;

    return undefined;
  }

  private static extractHost(raw?: string): string | undefined {
    if (!raw) return undefined;
    try {
      const u = new URL(raw);
      return u.hostname.replace(/^www\./i, '');
    } catch {
      return undefined;
    }
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
