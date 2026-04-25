/**
 * Stream Models
 */

export interface StremioStreamBehaviorHints {
  notWebReady?: boolean;
  realDebridReady?: boolean;
  torboxReady?: boolean;
  fallbackMagnet?: string;
  bingeGroup?: string;
  filename?: string;
  videoSize?: number;
}

export interface StremioStream {
  name?: string;
  title?: string;
  description?: string;
  url: string;
  behaviorHints?: StremioStreamBehaviorHints;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  size?: number;
  seeders?: number;
  quality?: string;
  releaseGroup?: string;
  languages?: string[];
  filename?: string;
  folderName?: string;
  indexer?: string;
}

export interface StreamResponse {
  streams: StremioStream[];
}

export interface StreamRequest {
  type: string;
  id: string;
  extra?: {
    debridProvider?: string;
    realdebridToken?: string;
    torboxToken?: string;
    token?: string;
  };
}
