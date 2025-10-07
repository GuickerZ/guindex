/**
 * Main Server Entry Point
 */

import { setupRoutes } from './routes/routes.js';
import { ConfigService } from './services/config-service.js';

async function startServer() {
  const config = ConfigService.loadConfig();
  const fastify = setupRoutes();

  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Brazuca RD addon running on port ${config.port}`);
    console.log(`Base URL: ${config.baseUrl}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();