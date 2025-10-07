/**
 * Configuration Service
 */

import type { AppConfig } from '../models/config-model.js';

export class ConfigService {
  static loadConfig(): AppConfig {
    const port = Number(process.env.PORT || 7000);
    const logLevel = (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info';
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

    // Debug logging for environment variables
    console.log('Environment variables:');
    console.log('PORT:', process.env.PORT);
    console.log('LOG_LEVEL:', process.env.LOG_LEVEL);
    console.log('BASE_URL:', process.env.BASE_URL);
    console.log('NODE_ENV:', process.env.NODE_ENV);

    const config: AppConfig = { 
      port, 
      logLevel,
      baseUrl
    };

    console.log('Final config:', config);
    return config;
  }
}
