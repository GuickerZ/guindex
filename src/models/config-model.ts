/**
 * Configuration Models
 */

export interface AppConfig {
  port: number;
  logLevel: 'info' | 'debug' | 'error' | 'warn';
  baseUrl: string; // Base URL for the addon (e.g., https://your-domain.com)
}

export interface AddonManifest {
  id: string;
  version: string;
  name: string;
  description: string;
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
  }>;
}
