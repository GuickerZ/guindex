/**
 * Stream Models
 */

export interface StremioStreamBehaviorHints {
  notWebReady?: boolean;
  realDebridReady?: boolean;
  fallbackMagnet?: string;
}

export interface StremioStream {
  name?: string;
  title?: string;
  url: string;
  behaviorHints?: StremioStreamBehaviorHints;
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
