/**
 * GuIndex - Servidor Principal
 */

import 'dotenv/config';
import { setupRoutes } from './routes/routes.js';
import { ConfigService } from './services/config-service.js';

async function startServer() {
  const config = ConfigService.loadConfig();
  const fastify = setupRoutes();

  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.info(`[GuIndex] 🟢 Servidor principal iniciado!`);
    console.info(`[GuIndex] 🔌 Rodando na porta: ${config.port}`);
    console.info(`[GuIndex] 🌐 Base URL: ${config.baseUrl}`);
  } catch (error) {
    console.error('[GuIndex] ❌ Falha ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();
