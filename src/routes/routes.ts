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

  fastify.all('/stream/:type/:id.json', async (req, reply) => {
    const { type, id } = req.params as any;
    const query = req.query as any;
    const token = StreamService.extractRealDebridToken(query, req.headers);
    
    try {
      const extra: { realdebridToken?: string } = {};
      if (token) extra.realdebridToken = token;
      
      const result = await streamController.handleStreamRequest({ 
        type, 
        id, 
        extra 
      });
      reply.send(result);
    } catch (error) {
      logger.error(`Stream endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      reply.send({ streams: [] });
    }
  });

  fastify.get('/resolve/:token/:magnet', async (req, reply) => {
    const { token, magnet } = req.params as { token: string; magnet: string };
    
    if (!magnet) {
      reply.status(400).send({ error: 'Magnet link is required' });
      return;
    }
    
    if (!token) {
      reply.status(400).send({ error: 'Real-Debrid token is required' });
      return;
    }
    
    try {
      const decodedMagnet = decodeURIComponent(magnet);
      const directUrl = await streamController.processMagnetForPlayback(decodedMagnet, token);
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

  return fastify;
}
