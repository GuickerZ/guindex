/**
 * GuIndex - Servidor Principal
 */

import { setupRoutes } from './routes/routes.js';
import { ConfigService } from './services/config-service.js';

async function startServer() {
  const config = ConfigService.loadConfig();
  const fastify = setupRoutes();

  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[GuIndex] Rodando na porta ${config.port}`);
    console.log(`[GuIndex] Base URL: ${config.baseUrl}`);
  } catch (error) {
    console.error('[GuIndex] Falha ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();
