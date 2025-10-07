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

  // Routes
  fastify.all('/manifest.json', async (req, reply) => {
    const query = req.query as any;
    const token = StreamService.extractRealDebridToken(query, req.headers);
    
    const manifest = configController.createAddonManifest(!!token);
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

  // Resolve endpoint - processes magnet links through Real-Debrid when user plays the stream
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
      
      // Redirect to the direct download URL
      reply.redirect(directUrl);
    } catch (error) {
      logger.error(`Magnet processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      reply.status(500).send({ error: 'Failed to process magnet link' });
    }
  });

  // Placeholder video endpoint - serves downloading status video
  // The static file plugin will automatically serve files from public/ directory
  // This route is optional but can be used for custom headers or logging
  fastify.get('/placeholder/downloading.mp4', async (req, reply) => {
    reply.type('video/mp4');
    reply.sendFile('downloading.mp4');
  });

  // Debug endpoint to check environment variables
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
