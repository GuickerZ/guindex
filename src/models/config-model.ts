/**
 * Configuration Models
 */

export interface AppConfig {
  port: number;
  logLevel: 'info' | 'debug' | 'error' | 'warn';
  baseUrl: string; // Base URL for the addon (e.g., https://your-domain.com)
  waitVideoUrl?: string; // Fallback MP4 when TorBox does not return a waiting/direct link
  torboxStreamLimit?: number; // Max TorBox streams to return
}

export interface AddonManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  logo?: string;
  background?: string;
  catalogs: any[];
  resources: string[];
  types: string[];
  idPrefixes: string[];
  behaviorHints: {
    adult: boolean;
    p2p: boolean;
    configurable: boolean;
    configurationRequired: boolean;
  };
  config: Array<{
    key: string;
    type: string;
    title: string;
    description: string;
    options?: string[];
    default?: string;
  }>;
}
