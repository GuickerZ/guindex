
/**
 * Routes
 */

import Fastify from 'fastify';
import pino from 'pino';
import path from 'path';
import stremioAddonSdk from 'stremio-addon-sdk';
import { ConfigController } from '../controllers/config-controller.js';
import { StreamController } from '../controllers/stream-controller.js';
import { ConfigService } from '../services/config-service.js';
import { StreamService } from '../services/stream-service.js';
import type { StreamRequest } from '../models/stream-model.js';

const { addonBuilder, getRouter } = stremioAddonSdk;

export function setupRoutes() {
  const config = ConfigService.loadConfig();
  const logger = pino({ level: config.logLevel });
  const fastify = Fastify({ logger });

  // Register CORS plugin

// Register CORS plugin
  fastify.register(import('@fastify/cors'), {
    origin: true,
    credentials: true
  });

  // Register static file plugin
  fastify.register(import('@fastify/static'), {
    root: path.resolve('public')
  });

  // Initialize controllers
  const configController = new ConfigController();
  const streamController = new StreamController();

  // Initialize addon builder
  const builder = new addonBuilder(configController.createAddonManifest() as any);
  builder.defineStreamHandler(async (args: StreamRequest) => {
    return streamController.handleStreamRequest(args);
  });

  /**
   * ✅ Suporte a tokens do Real-Debrid no caminho
   * Exemplo: /TOKEN/manifest.json
   */
  fastify.all('/manifest.json', async (req, reply) => {
    const query = req.query as any;
    const token = StreamService.extractRealDebridToken(query, req.headers);

    const manifest = configController.createAddonManifest(!!token);
    reply.send(manifest);
  });

  // Caso com token no caminho
  fastify.all('/:token/manifest.json', async (req, reply) => {
    const { token } = req.params as { token: string };
    const query = req.query as any;

    // Valida token (precisa ter um tamanho mínimo, igual aos tokens do Real-Debrid)
    const validToken = token && token.length > 20 ? token : undefined;
    const manifest = configController.createAddonManifest(!!validToken);
    reply.send(manifest);
  });

  fastify.get('/configure', async (req, reply) => {
    const query = req.query as any;
    const token = StreamService.extractRealDebridToken(query, req.headers);
    
    reply.type('text/html').send(configController.generateConfigHTML(token, true));
  });

  fastify.get('/', async (_req, reply) => {
    reply.type('text/html').send(configController.generateConfigHTML());
  });

  // ✅ Caso sem token
  fastify.all('/stream/:type/:id.json', async (req, reply) => {
    const { type, id } = req.params as any;
    const query = req.query as any;
    const token = StreamService.extractRealDebridToken(query, req.headers);

    try {
      const extra: { realdebridToken?: string } = {};
      if (token) extra.realdebridToken = token;

      const result = await streamController.handleStreamRequest({ type, id, extra });
      reply.send(result);
    } catch (error) {
      logger.error(`Stream endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      reply.send({ streams: [] });
    }
  });

  // ✅ Caso com token no caminho
  fastify.all('/:token/stream/:type/:id.json', async (req, reply) => {
    const { token, type, id } = req.params as any;
    const query = req.query as any;
    const realToken = StreamService.extractRealDebridToken(query, req.headers, {}, { token });

    try {
      const extra: { realdebridToken?: string } = {};
      if (realToken) extra.realdebridToken = realToken;

      const result = await streamController.handleStreamRequest({ type, id, extra });
      reply.send(result);
    } catch (error) {
      logger.error(`Stream endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      reply.send({ streams: [] });
    }
  });

  fastify.get('/resolve/:token/:magnet', async (req, reply) => {
    const params = req.params as { token: string; magnet: string };
    const token = params.token;
    const magnetParam = params.magnet;
    const { ctx } = req.query as { ctx?: string };

    if (!magnetParam) {
      reply.status(400).send({ error: 'Magnet link is required' });
      return;
    }

    if (!token) {
      reply.status(400).send({ error: 'Real-Debrid token is required' });
      return;
    }

    try {
      const decodedMagnet = decodeURIComponent(magnetParam);
      const context = StreamService.decodeStreamContext(ctx);
      const directUrl = await streamController.processMagnetForPlayback(decodedMagnet, token, context);
      reply.redirect(directUrl);
    } catch (error) {
      logger.error(`Magnet processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      reply.status(500).send({ error: 'Failed to process magnet link' });
    }
  });

  fastify.get('/placeholder/downloading.mp4', async (req, reply) => {
    reply.type('video/mp4');
    reply.sendFile('downloading.mp4');
  });

  fastify.get('/debug', async (req, reply) => {
    reply.send({
      environment: {
        PORT: process.env.PORT,
        LOG_LEVEL: process.env.LOG_LEVEL,
        BASE_URL: process.env.BASE_URL,
        NODE_ENV: process.env.NODE_ENV
      },
      config: ConfigService.loadConfig()
    });
  });
src/services/torrent-indexer-provider.ts
+14
-6

@@ -331,61 +331,65 @@ export class TorrentIndexerProvider extends BaseSourceProvider {
    }
    }


    return false;
    return false;
  }
  }


  private getStreamInfoHash(stream: SourceStream): string | undefined {
  private getStreamInfoHash(stream: SourceStream): string | undefined {
    if (typeof stream.infoHash === 'string' && stream.infoHash.trim()) {
    if (typeof stream.infoHash === 'string' && stream.infoHash.trim()) {
      return stream.infoHash.trim().toLowerCase();
      return stream.infoHash.trim().toLowerCase();
    }
    }


    if (typeof stream.magnet === 'string' && stream.magnet.startsWith('magnet:')) {
    if (typeof stream.magnet === 'string' && stream.magnet.startsWith('magnet:')) {
      const extracted = this.extractInfoHash(stream.magnet);
      const extracted = this.extractInfoHash(stream.magnet);
      if (extracted) {
      if (extracted) {
        return extracted.toLowerCase();
        return extracted.toLowerCase();
      }
      }
    }
    }


    return undefined;
    return undefined;
  }
  }


  private applyRealDebridBadge(stream: SourceStream): void {
  private applyRealDebridBadge(stream: SourceStream): void {
    if (typeof stream.name === 'string' && stream.name.length > 0) {
    if (typeof stream.name === 'string' && stream.name.length > 0) {
      const nameLines = stream.name.split('\n');
      const nameLines = stream.name.split('\n');
      const firstLine = nameLines[0] ?? '';
      const firstLine = nameLines[0] ?? '';
      if (!/RD\+/i.test(firstLine)) {
      if (!/RD\+/i.test(firstLine)) {
        const cleaned = firstLine.replace(/\s+RD\+?$/i, '').trim();
        if (/\bRD\b/i.test(firstLine)) {
        const baseLine = cleaned || firstLine.trim();
          nameLines[0] = firstLine.replace(/\bRD\b/gi, 'RD+');
        nameLines[0] = `${baseLine} RD+`.trim();
        } else {
          nameLines[0] = `${firstLine} RD+`.trim();
        }
      }
      }
      stream.name = nameLines.join('\n');
      stream.name = nameLines.join('\n');
    }
    }


    if (typeof stream.title === 'string' && stream.title.length > 0) {
    if (typeof stream.title === 'string' && stream.title.length > 0) {
      const titleLines = stream.title.split('\n');
      const titleLines = stream.title.split('\n');
      const firstLine = titleLines[0] ?? '';
      const firstLine = titleLines[0] ?? '';
      if (!/RD\+/i.test(firstLine)) {
      if (/\[RD\]/i.test(firstLine)) {
        titleLines[0] = firstLine.replace(/\[RD\]/gi, '[RD+]');
      } else if (!/RD\+/i.test(firstLine)) {
        titleLines[0] = `${firstLine} [RD+]`.trim();
        titleLines[0] = `${firstLine} [RD+]`.trim();
      }
      }
      if (!titleLines.some((line) => /Real-?Debrid/i.test(line))) {
      if (!titleLines.some((line) => /Real-?Debrid/i.test(line))) {
        titleLines.push('Disponível no Real-Debrid');
        titleLines.push('Disponível no Real-Debrid');
      }
      }
      stream.title = titleLines.join('\n');
      stream.title = titleLines.join('\n');
    }
    }
  }
  }


  private async fetchSearchResults(query: string): Promise<TorrentLike[]> {
  private async fetchSearchResults(query: string): Promise<TorrentLike[]> {
    const url = new URL(`${this.baseUrl}/search`);
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('q', query);


    try {
    try {
      const response = await request(url.toString());
      const response = await request(url.toString());
      if (response.statusCode >= 400) {
      if (response.statusCode >= 400) {
        return [];
        return [];
      }
      }


      const payload = await response.body.json();
      const payload = await response.body.json();
      return this.normalizeTorrentPayload(payload);
      return this.normalizeTorrentPayload(payload);
    } catch {
    } catch {
      return [];
      return [];
    }
    }
  }
  }
@@ -836,66 +840,70 @@ export class TorrentIndexerProvider extends BaseSourceProvider {
    const rawQuality =
    const rawQuality =
      (torrent as Record<string, unknown>).quality ||
      (torrent as Record<string, unknown>).quality ||
      (torrent as Record<string, unknown>).resolution ||
      (torrent as Record<string, unknown>).resolution ||
      this.inferQualityFromTitle(baseTitle);
      this.inferQualityFromTitle(baseTitle);
    const quality = this.normalizeQuality(rawQuality);
    const quality = this.normalizeQuality(rawQuality);
    const releaseGroup =
    const releaseGroup =
      (torrent as Record<string, unknown>).releaseGroup ||
      (torrent as Record<string, unknown>).releaseGroup ||
      (torrent as Record<string, unknown>).group ||
      (torrent as Record<string, unknown>).group ||
      (torrent as Record<string, unknown>).uploader ||
      (torrent as Record<string, unknown>).uploader ||
      (torrent as Record<string, unknown>).source;
      (torrent as Record<string, unknown>).source;


    const seeds = this.extractSeeders(torrent);
    const seeds = this.extractSeeders(torrent);
    const seedCount = seeds !== undefined ? Math.max(0, Math.floor(seeds)) : 0;
    const seedCount = seeds !== undefined ? Math.max(0, Math.floor(seeds)) : 0;


    const infoSegments: string[] = [`👤 ${seedCount}`];
    const infoSegments: string[] = [`👤 ${seedCount}`];
    if (size !== undefined && size > 0) {
    if (size !== undefined && size > 0) {
      infoSegments.push(`💾 ${this.formatSize(size)}`);
      infoSegments.push(`💾 ${this.formatSize(size)}`);
    }
    }
    if (typeof releaseGroup === 'string' && releaseGroup.trim()) {
    if (typeof releaseGroup === 'string' && releaseGroup.trim()) {
      infoSegments.push(`⚙️ ${releaseGroup.trim()}`);
      infoSegments.push(`⚙️ ${releaseGroup.trim()}`);
    }
    }


    const audioLine = this.formatAudioLine(torrent);
    const audioLine = this.formatAudioLine(torrent);


    const headline = quality ? `${displayTitle} [${quality}]` : displayTitle;
    const headline = quality ? `${displayTitle} [${quality}]` : displayTitle;
    const titleLines = [headline];
    const titleLines = [`${headline} [RD]`];
    if (infoSegments.some((segment) => segment.trim().length > 0)) {
    if (infoSegments.some((segment) => segment.trim().length > 0)) {
      titleLines.push(infoSegments.join(' '));
      titleLines.push(infoSegments.join(' '));
    }
    }
    if (audioLine) {
    if (audioLine) {
      titleLines.push(audioLine);
      titleLines.push(audioLine);
    }
    }


    if (detailUrl) {
    if (detailUrl) {
      titleLines.push(`📡 ${detailUrl}`);
      titleLines.push(`📡 ${detailUrl}`);
    }
    }


    const qualityLabel = quality ?? 'RD';
    const qualityLabel = quality ?? 'RD';
    const nameLines = [`[${sourceLabel}] RD Brazuca`];
    if (qualityLabel) {
      nameLines.push(qualityLabel);
    }


    const stream: SourceStream = {
    const stream: SourceStream = {
      name: `[${sourceLabel}] Brazuca RD\n${qualityLabel}`,
      name: nameLines.join('\n'),
      title: titleLines.join('\n'),
      title: titleLines.join('\n'),
      magnet,
      magnet,
    };
    };


    const infoHash =
    const infoHash =
      (torrent as Record<string, unknown>).infoHash ||
      (torrent as Record<string, unknown>).infoHash ||
      (torrent as Record<string, unknown>).hash ||
      (torrent as Record<string, unknown>).hash ||
      (torrent as Record<string, unknown>).btih ||
      (torrent as Record<string, unknown>).btih ||
      this.extractInfoHash(magnet);
      this.extractInfoHash(magnet);


    if (typeof infoHash === 'string' && infoHash) {
    if (typeof infoHash === 'string' && infoHash) {
      stream.infoHash = infoHash;
      stream.infoHash = infoHash;
    }
    }


    if (size !== undefined) {
    if (size !== undefined) {
      stream.size = size;
      stream.size = size;
    }
    }


    if (seeds !== undefined) {
    if (seeds !== undefined) {
      stream.seeders = seeds;
      stream.seeders = seeds;
    }
    }


    if (quality) {
    if (quality) {
      stream.quality = quality;
      stream.quality = quality;
    }
    }
