
/**
 * Routes
 */

import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';
import path from 'path';
import stremioAddonSdk from 'stremio-addon-sdk';
import { ConfigController } from '../controllers/config-controller.js';
import { StreamController } from '../controllers/stream-controller.js';
import { ConfigService } from '../services/config-service.js';
import { StreamService } from '../services/stream-service.js';
import type { StreamRequest } from '../models/stream-model.js';

const { addonBuilder } = stremioAddonSdk;

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
    const debridSelection = StreamService.resolveDebridSelection({
      query,
      headers: req.headers
    });

    const manifest = configController.createAddonManifest(!!debridSelection.token);
    reply.send(manifest);
  });

  // Caso com token no caminho
  fastify.all('/:token/manifest.json', async (req, reply) => {
    const { token } = req.params as { token: string };
    const query = req.query as any;

    const provider = StreamService.extractDebridProvider(query, req.headers);
    const debridSelection = StreamService.resolveDebridSelection({
      query,
      headers: req.headers,
      routeParams: { token },
      extra: {
        token,
        torboxToken: provider === 'torbox' ? token : undefined,
        debridProvider: provider
      }
    });
    const manifest = configController.createAddonManifest(!!debridSelection.token);
    reply.send(manifest);
  });

  fastify.get('/configure', async (req, reply) => {
    const query = req.query as any;
    const selection = StreamService.resolveDebridSelection({
      query,
      headers: req.headers
    });
    
    reply
      .type('text/html')
      .send(
        configController.generateConfigHTML(
          {
            debridProvider: selection.provider,
            realdebridToken: selection.realdebridToken,
            torboxToken: selection.torboxToken
          },
          true
        )
      );
  });

  fastify.get('/', async (_req, reply) => {
    reply.type('text/html').send(configController.generateConfigHTML());
  });

  // ✅ Caso sem token
  fastify.all('/stream/:type/:id.json', async (req, reply) => {
    const { type, id } = req.params as any;
    const query = req.query as any;
    const debridSelection = StreamService.resolveDebridSelection({
      query,
      headers: req.headers
    });

    try {
      const extra: { realdebridToken?: string; torboxToken?: string; debridProvider?: string } = {
        debridProvider: debridSelection.provider
      };
      if (debridSelection.realdebridToken) {
        extra.realdebridToken = debridSelection.realdebridToken;
      }
      if (debridSelection.torboxToken) {
        extra.torboxToken = debridSelection.torboxToken;
      }

      const result = await streamController.handleStreamRequest({ type, id, extra });
      reply.send(result);
    } catch (error) {
      logger.error(`Stream endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      reply.send({ streams: [] });
      return fastify;
    }
  });

  // ✅ Caso com token no caminho
  fastify.all('/:token/stream/:type/:id.json', async (req, reply) => {
    const { token, type, id } = req.params as any;
    const query = req.query as any;
    const provider = StreamService.extractDebridProvider(query, req.headers);
    const debridSelection = StreamService.resolveDebridSelection({
      query,
      headers: req.headers,
      routeParams: { token },
      extra: {
        token,
        torboxToken: provider === 'torbox' ? token : undefined,
        debridProvider: provider
      }
    });

    try {
      const extra: {
        realdebridToken?: string;
        torboxToken?: string;
        debridProvider?: string;
        token?: string;
      } = {
        debridProvider: debridSelection.provider,
        token,
        torboxToken: provider === 'torbox' ? token : debridSelection.torboxToken
      };
      if (debridSelection.realdebridToken) {
        extra.realdebridToken = debridSelection.realdebridToken;
      }
      if (debridSelection.torboxToken) {
        extra.torboxToken = debridSelection.torboxToken;
      }

      const result = await streamController.handleStreamRequest({ type, id, extra });
      reply.send(result);
    } catch (error) {
      logger.error(`Stream endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      reply.send({ streams: [] });
    }
  });

  const respondProbeSuccess = (reply: FastifyReply) => {
    reply
      .status(204)
      .header('cache-control', 'no-store, max-age=0')
      .header('x-brazuca-rd-probe', 'ok')
      .send();
  };

  const handleResolveRequest = async (
    reply: FastifyReply,
    token: string,
    magnet?: string,
    originalUrl?: string,
    provider?: string,
    linkType?: string,
    ctx?: string
  ) => {
    try {
      const context = StreamService.decodeStreamContext(ctx);
      const debridProvider = StreamService.extractDebridProvider(
        { debridProvider: provider },
        {}
      );
      const resolvedProvider = debridProvider ?? 'realdebrid';

      if (resolvedProvider === 'torbox' && linkType === 'webdl' && originalUrl) {
        const directUrl = await streamController.processLinkForPlayback({
          url: originalUrl,
          token,
          provider: resolvedProvider,
          context
        });
        reply.redirect(directUrl);
        return;
      }

      if (!magnet) {
        reply.status(400).send({ error: 'Magnet link is required for this provider' });
        return;
      }

      const directUrl = await streamController.processLinkForPlayback({
        magnet,
        token,
        provider: resolvedProvider,
        context
      });
      reply.redirect(directUrl);
    } catch (error) {
      logger.error(`Magnet processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      reply.status(500).send({ error: 'Failed to process magnet link' });
    }
  };

  type ResolveRouteValues = {
    token?: string | undefined;
    magnet?: string | undefined;
    provider?: string | undefined;
    ctx?: string | undefined;
    url?: string | undefined;
    linkType?: string | undefined;
  };

  const registerResolveRoute = (
    url: string,
    extractor: (req: FastifyRequest) => ResolveRouteValues
  ) => {
    fastify.route({
      method: ['GET', 'HEAD'],
      url,
      handler: async (req, reply) => {
        const started = Date.now();
        if (req.method === 'HEAD') {
          respondProbeSuccess(reply);
          return;
        }

        const { token, magnet, provider, ctx } = extractor(req);
        const linkType = (req.query as any)?.linkType as string | undefined;
        const originalUrl = (req.query as any)?.url as string | undefined;

        if (!token) {
          reply.status(400).send({ error: 'Debrid token is required' });
          return;
        }

        if (linkType === 'webdl') {
          if (!originalUrl) {
            reply.status(400).send({ error: 'URL is required for TorBox WebDL' });
            return;
          }
          await handleResolveRequest(reply, token, undefined, originalUrl, provider, linkType, ctx);
          logger.info({ route: 'resolve', provider, linkType, durMs: Date.now() - started }, 'resolve handled');
          return;
        }

        if (!magnet) {
          reply.status(400).send({ error: 'Magnet link is required' });
          return;
        }

        await handleResolveRequest(reply, token, magnet, undefined, provider, linkType, ctx);
        logger.info({ route: 'resolve', provider, linkType, durMs: Date.now() - started }, 'resolve handled');
      }
    });
  };

  registerResolveRoute('/resolve', (req) => {
    const query = req.query as {
      token?: string;
      magnet?: string;
      ctx?: string;
      debridProvider?: string;
      provider?: string;
      url?: string;
      linkType?: string;
    };
    return {
      token: query.token,
      magnet: query.magnet,
      provider: query.debridProvider ?? query.provider,
      ctx: query.ctx,
      url: query.url,
      linkType: query.linkType
    };
  });

  registerResolveRoute('/resolve/:token/:magnet', (req) => {
    const params = req.params as { token?: string; magnet?: string };
    const query = req.query as { ctx?: string; debridProvider?: string; provider?: string; url?: string; linkType?: string };
    return {
      token: params.token,
      magnet: params.magnet,
      provider: query.debridProvider ?? query.provider,
      ctx: query.ctx,
      url: query.url,
      linkType: query.linkType
    };
  });

  fastify.get('/placeholder/downloading.mp4', async (_req, reply) => {
    reply.type('video/mp4');
    reply.sendFile('downloading.mp4');
  });

  fastify.get('/debug', async (_req, reply) => {
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
