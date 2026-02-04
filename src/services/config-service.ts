/**
 * Configuration Service
 */

import type { AppConfig } from '../models/config-model.js';

export class ConfigService {
  static loadConfig(): AppConfig {
    const port = Number(process.env.PORT || 7000);
    const logLevel = (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info';

    const normalizedBaseUrl =
      ConfigService.normalizeBaseUrl(process.env.BASE_URL) ||
      ConfigService.normalizeBaseUrl('https://brazuca-rd.vercel.app')!;
    const waitVideoUrl =
      ConfigService.normalizeBaseUrl(process.env.TORBOX_WAIT_VIDEO_URL) ||
      ConfigService.normalizeBaseUrl('https://aiostreams.elfhosted.com/static/downloading.mp4');
    const torboxStreamLimit =
      Number(process.env.TORBOX_STREAM_LIMIT) && Number(process.env.TORBOX_STREAM_LIMIT) > 0
        ? Number(process.env.TORBOX_STREAM_LIMIT)
        : 12;

    // Debug logging for environment variables
    console.log('Environment variables:');
    console.log('PORT:', process.env.PORT);
    console.log('LOG_LEVEL:', process.env.LOG_LEVEL);
    console.log('BASE_URL:', process.env.BASE_URL);
    console.log('VERCEL_URL:', process.env.VERCEL_URL);
    console.log('NODE_ENV:', process.env.NODE_ENV);

    const config: AppConfig = {
      port,
      logLevel,
      baseUrl: normalizedBaseUrl,
      waitVideoUrl,
      torboxStreamLimit
    };

    console.log('Final config:', config);
    return config;
  }

  private static normalizeBaseUrl(value?: string | null): string | undefined {
    if (!value) {
      return undefined;
    }

    let candidate = value.trim();
    if (!candidate) {
      return undefined;
    }

    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }

    try {
      const parsed = new URL(candidate);
      parsed.protocol = 'https:';
      const trimmedPath = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = trimmedPath || '/';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/, '');
    } catch (error) {
      console.warn(`Invalid base URL provided (${value}):`, error);
      return undefined;
    }
  }
}
