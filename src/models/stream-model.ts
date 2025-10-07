/**
 * Stream Models
 */

export interface StremioStream {
  name?: string;
  title?: string;
  url: string;
  behaviorHints?: { notWebReady?: boolean };
  infoHash?: string;
  externalUrl?: string;
  size?: number;
  seeders?: number;
  quality?: string;
  releaseGroup?: string;
}

export interface StreamResponse {
  streams: StremioStream[];
}

export interface StreamRequest {
  type: string;
  id: string;
  extra?: {
    realdebridToken?: string;
    token?: string;
  };
}
