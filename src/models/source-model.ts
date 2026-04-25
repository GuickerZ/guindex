/**
 * Source Models
 */
export interface StreamContext {
  type?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  title?: string;
  year?: number;
  episodeList?: number[];
}
export interface SourceStream {
  cached?: boolean;
  name?: string;
  title?: string;
  description?: string;
  fileName?: string;
  detailUrl?: string;
  languages?: string[];
  source?: string;
  url?: string;
  magnet?: string;
  infoHash?: string;
  fileIdx?: number;
  size?: number;
  seeders?: number;
  quality?: string;
  releaseGroup?: string;
  context?: StreamContext;
}
