/**
 * Source Models
 */

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
}