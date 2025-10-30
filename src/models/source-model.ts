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
  name?: string;
  title?: string;
  url?: string;
  magnet?: string;
  infoHash?: string;
  size?: number;
  seeders?: number;
  quality?: string;
  releaseGroup?: string;
  context?: StreamContext;
}
