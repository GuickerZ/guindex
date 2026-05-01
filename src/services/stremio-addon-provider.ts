/**
 * Stremio Addon Source Provider
 */

import { request } from 'undici';
import { BaseSourceProvider, type SourceFetchOptions } from './base-source-provider.js';
import type { SourceStream } from '../models/source-model.js';

const FILE_EXT_REGEX = /\.(mkv|mp4|avi|m4v|ts|m2ts|iso|mpg|mpeg|wmv|mov|rar|zip)\b/i;
const RESOLUTION_REGEX = /\b(2160p|1440p|1080p|720p|576p|480p|360p|240p)\b/i;
const URL_REGEX = /https?:\/\/[^\s]+/gi;

const FLAG_LANGUAGE_MAP: Record<string, string> = {
  '\uD83C\uDDE7\uD83C\uDDF7': 'Portuguese', // BR
  '\uD83C\uDDF5\uD83C\uDDF9': 'Portuguese', // PT
  '\uD83C\uDDFA\uD83C\uDDF8': 'English', // US
  '\uD83C\uDDEC\uD83C\uDDE7': 'English', // GB
  '\uD83C\uDDEA\uD83C\uDDF8': 'Spanish', // ES
  '\uD83C\uDDEB\uD83C\uDDF7': 'French', // FR
  '\uD83C\uDDEE\uD83C\uDDF9': 'Italian', // IT
  '\uD83C\uDDE9\uD83C\uDDEA': 'German', // DE
  '\uD83C\uDDF7\uD83C\uDDFA': 'Russian', // RU
  '\uD83C\uDDEE\uD83C\uDDF3': 'Hindi', // IN
  '\uD83C\uDDF2\uD83C\uDDFD': 'Spanish', // MX
  '\uD83C\uDDE8\uD83C\uDDF4': 'Spanish', // CO
  '\uD83C\uDDE6\uD83C\uDDF7': 'Spanish', // AR
};

const LANGUAGE_ALIASES: Record<string, string> = {
  portuguese: 'Portuguese',
  portugues: 'Portuguese',
  'pt-br': 'Portuguese',
  'pt br': 'Portuguese',
  ptbr: 'Portuguese',
  brazilian: 'Portuguese',
  dublado: 'Portuguese',
  dublada: 'Portuguese',
  nacional: 'Portuguese',
  'audio nacional': 'Portuguese',
  english: 'English',
  ingles: 'English',
  eng: 'English',
  espanhol: 'Spanish',
  espanol: 'Spanish',
  spanish: 'Spanish',
  castellano: 'Spanish',
  latino: 'Spanish',
  french: 'French',
  frances: 'French',
  italian: 'Italian',
  italiano: 'Italian',
  german: 'German',
  alemao: 'German',
  russian: 'Russian',
  russo: 'Russian',
  hindi: 'Hindi',
};

export class StremioAddonProvider extends BaseSourceProvider {
  constructor(name: string, private baseUrl: string) {
    super(name);
  }

  async getStreams(
    type: string,
    id: string,
    _options?: SourceFetchOptions
  ): Promise<SourceStream[]> {
    const url = `${this.baseUrl}/stream/${type}/${id}.json`;
    const response = await request(url);
    
    if (response.statusCode >= 400) {
      throw new Error(`Failed to fetch streams from ${this.name}: ${response.statusCode}`);
    }
    
    const data = await response.body.json() as {streams: SourceStream[]};
    const streams = data.streams || [];
    
    // Attach source name to each stream
    return streams.map((stream) => normalizeStream(stream, this.name));
  }
}

function normalizeStream(stream: SourceStream, providerLabel: string): SourceStream {
  const result: SourceStream = { ...stream };
  const hints = (stream as any)?.behaviorHints as
    | { filename?: string; videoSize?: number; bingeGroup?: string }
    | undefined;

  // collect lines early for filename detection
  let lines = collectLines(stream.title, stream.description, stream.name);

  const fileName = pickFileName(result.fileName, hints?.filename, lines);
  if (fileName) {
    result.fileName = fileName;
  }

  // refresh lines to include resolved filename for language/source parsing
  lines = collectLines(
    stream.title,
    stream.description,
    stream.name,
    result.fileName,
    hints?.filename
  );

  const detailUrl = pickDetailUrl((stream as any)?.externalUrl, result.detailUrl, result.url, lines);
  if (detailUrl) {
    result.detailUrl = detailUrl;
  }

  const source = pickSource(result.source, stream.name, lines, detailUrl);
  if (source) {
    result.source = source;
  }

  const quality = pickQuality(result.quality, lines);
  if (quality) {
    result.quality = quality;
  }

  const size = pickSize(result.size, hints?.videoSize, lines);
  if (size !== undefined) {
    result.size = size;
  }

  const seeders = pickSeeders(result.seeders, lines);
  if (seeders !== undefined) {
    result.seeders = seeders;
  }

  const infoHash = pickInfoHash(result.infoHash, result.magnet, result.url, hints?.bingeGroup);
  if (infoHash) {
    result.infoHash = infoHash;
  }

  const languages = pickLanguages(result.languages, lines);
  if (languages.length > 0) {
    result.languages = languages;
  }

  if (!result.releaseGroup) {
    const group = extractReleaseGroup(result.fileName);
    if (group) {
      result.releaseGroup = group;
    }
  }

  if (result.name) {
    result.name = prefixName(result.name);
  } else if (providerLabel) {
    result.name = `[GuIndex] ${providerLabel}`;
  }

  return result;
}

function prefixName(name: string): string {
  if (!name) {
    return '[GuIndex]';
  }
  if (/\bGuIndex\b/i.test(name)) {
    return name;
  }
  return `[GuIndex] ${name}`;
}

function collectLines(...values: Array<string | undefined>): string[] {
  const lines: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const parts = String(value)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    lines.push(...parts);
  }
  return lines;
}

function pickFileName(
  existing?: string,
  hinted?: string,
  lines: string[] = []
): string | undefined {
  const candidates = [existing, hinted, ...lines];
  for (const candidate of candidates) {
    const normalized = pickFileNameFromLine(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function pickFileNameFromLine(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const fileIconRegex = new RegExp(`^\\uD83D\\uDCC4\\s*`, 'u');
  const cleaned = trimmed.replace(fileIconRegex, '').trim();
  if (FILE_EXT_REGEX.test(cleaned)) {
    return cleaned;
  }

  if (FILE_EXT_REGEX.test(trimmed)) {
    return trimmed;
  }

  const firstLine = trimmed.split('\n')[0]?.trim();
  if (firstLine && FILE_EXT_REGEX.test(firstLine)) {
    return firstLine;
  }

  return undefined;
}

function pickDetailUrl(
  externalUrl: string | undefined,
  detailUrl: string | undefined,
  streamUrl: string | undefined,
  lines: string[] = []
): string | undefined {
  const urls = extractUrls(lines);
  const candidates = [...urls, detailUrl, externalUrl, streamUrl].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeUrl(candidate);
    if (!normalized) continue;
    if (isPlaybackUrl(normalized)) continue;
    return normalized;
  }
  return undefined;
}

function extractUrls(lines: string[]): string[] {
  const urls: string[] = [];
  for (const line of lines) {
    const matches = line.match(URL_REGEX);
    if (!matches) continue;
    for (const match of matches) {
      const cleaned = match.replace(/[)\].,]+$/g, '').trim();
      if (cleaned) urls.push(cleaned);
    }
  }
  return urls;
}

function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function isPlaybackUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.toLowerCase();
    if (path.includes('/resolve') || path.includes('/playback')) {
      return true;
    }
    if (parsed.searchParams.has('magnet') || parsed.searchParams.has('linkType')) {
      return true;
    }
    for (const key of parsed.searchParams.keys()) {
      if (/token|apikey|api_key|rdtoken|tbtoken|torbox|realdebrid|debrid/i.test(key)) {
        return true;
      }
    }
  } catch {
    return true;
  }
  return false;
}

function pickSource(
  existing: string | undefined,
  name: string | undefined,
  lines: string[],
  detailUrl?: string
): string | undefined {
  if (existing && existing.trim()) {
    return existing.trim();
  }

  for (const line of lines) {
    const source = extractSourceFromLine(line);
    if (source) {
      return source;
    }
  }

  const nameSource = extractSourceFromLine(name ?? '');
  if (nameSource) {
    return nameSource;
  }

  if (detailUrl) {
    const hostname = extractHostname(detailUrl);
    if (hostname) return hostname;
  }

  return undefined;
}

function extractSourceFromLine(line: string): string | undefined {
  if (!line) return undefined;
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  const gearRegex = new RegExp(`\\u2699(?:\\uFE0F)?\\s*\\[?([^\\]\\s]+)`, 'u');
  const searchRegex = new RegExp(`\\uD83D\\uDD0E\\s*\\[?([^\\]\\s]+)`, 'u');

  const matchGear = trimmed.match(gearRegex);
  if (matchGear?.[1]) {
    return sanitizeSource(matchGear[1]);
  }

  const matchSearch = trimmed.match(searchRegex);
  if (matchSearch?.[1]) {
    return sanitizeSource(matchSearch[1]);
  }

  if (trimmed.includes('[') && trimmed.includes(']')) {
    const bracket = trimmed.match(/\[([^\]]+)\]/);
    if (bracket?.[1]) {
      const candidate = sanitizeSource(bracket[1]);
      if (candidate) return candidate;
    }
  }

  const domainMatch = trimmed.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/i);
  if (domainMatch?.[0]) {
    return sanitizeSource(domainMatch[0]);
  }

  return undefined;
}

function sanitizeSource(value: string): string | undefined {
  const cleaned = value.trim().replace(/^[\[\(]+|[\]\)]+$/g, '');
  return cleaned || undefined;
}

function extractHostname(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return undefined;
  }
}

function pickQuality(existing: string | undefined, lines: string[]): string | undefined {
  const normalizedExisting = normalizeResolution(existing);
  if (normalizedExisting) {
    return normalizedExisting;
  }

  const combined = lines.join(' ');
  const match = combined.match(RESOLUTION_REGEX);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }

  if (/\b4k\b/i.test(combined)) {
    return '2160p';
  }

  return undefined;
}

function normalizeResolution(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(RESOLUTION_REGEX);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }
  if (/\b4k\b/i.test(value)) {
    return '2160p';
  }
  return undefined;
}

function pickSize(
  existing: number | undefined,
  hinted: number | undefined,
  lines: string[]
): number | undefined {
  if (Number.isFinite(existing ?? NaN)) {
    return existing;
  }
  if (Number.isFinite(hinted ?? NaN)) {
    return hinted;
  }
  const combined = lines.join(' ');
  const match = combined.match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|B)\b/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const value = Number(match[1]);
  if (Number.isNaN(value)) {
    return undefined;
  }
  const unit = match[2].toUpperCase();
  switch (unit) {
    case 'TB':
      return Math.round(value * 1024 * 1024 * 1024 * 1024);
    case 'GB':
      return Math.round(value * 1024 * 1024 * 1024);
    case 'MB':
      return Math.round(value * 1024 * 1024);
    case 'KB':
      return Math.round(value * 1024);
    default:
      return Math.round(value);
  }
}

function pickSeeders(existing: number | undefined, lines: string[]): number | undefined {
  if (Number.isFinite(existing ?? NaN)) {
    return existing;
  }

  const combined = lines.join(' ');
  const seedMatch = combined.match(/(?:seeders?|seeds?)\s*[:\-]?\s*(\d{1,7})/i);
  if (seedMatch?.[1]) {
    return Number(seedMatch[1]);
  }

  const iconMatch = combined.match(/(?:\uD83D\uDC64|\uD83C\uDF31)\s*(\d{1,7})/u);
  if (iconMatch?.[1]) {
    return Number(iconMatch[1]);
  }

  return undefined;
}

function pickInfoHash(
  existing: string | undefined,
  magnet: string | undefined,
  url: string | undefined,
  bingeGroup: string | undefined
): string | undefined {
  if (existing && existing.trim()) {
    return existing.trim().toLowerCase();
  }

  const magnetHash = extractInfoHashFromMagnet(magnet ?? url);
  if (magnetHash) {
    return magnetHash.toLowerCase();
  }

  if (bingeGroup) {
    const parts = bingeGroup.split('|').map((part) => part.trim());
    const last = parts[parts.length - 1];
    if (last && /^[a-f0-9]{40}$/i.test(last)) {
      return last.toLowerCase();
    }
  }

  return undefined;
}

function extractInfoHashFromMagnet(candidate?: string): string | undefined {
  if (!candidate) return undefined;
  if (!candidate.startsWith('magnet:')) return undefined;
  const match = candidate.match(/xt=urn:btih:([^&]+)/i);
  return match?.[1];
}

function pickLanguages(existing: string[] | undefined, lines: string[]): string[] {
  const languages = new Set<string>();
  if (Array.isArray(existing)) {
    existing.forEach((lang) => {
      if (lang && typeof lang === 'string') {
        languages.add(lang);
      }
    });
  }

  const combined = lines.join(' ');
  const normalized = combined
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const tokenized = normalized.replace(/[^a-z0-9]+/g, ' ').trim();
  const sawDualAudio = /\bdual\s*audio\b|\bmulti\s*audio\b/i.test(tokenized);

  for (const [alias, canonical] of Object.entries(LANGUAGE_ALIASES)) {
    const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
    if (pattern.test(normalized)) {
      languages.add(canonical);
    }
  }

  for (const [flag, language] of Object.entries(FLAG_LANGUAGE_MAP)) {
    if (combined.includes(flag)) {
      languages.add(language);
    }
  }

  if (sawDualAudio) {
    if (!languages.has('English')) {
      languages.add('English');
    }
    if (!languages.has('Portuguese')) {
      languages.add('Portuguese');
    }
  }

  return Array.from(languages);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractReleaseGroup(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  const name = fileName.replace(/\.[a-z0-9]{2,4}$/i, '');
  const match = name.match(/-([A-Za-z0-9]{2,})$/);
  if (match?.[1]) {
    return match[1];
  }
  return undefined;
}
