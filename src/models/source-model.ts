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
  /** Indexer slug that produced this result (e.g. 'torrent-dos-filmes') */
  indexer?: string;
  url?: string;
  magnet?: string;
  infoHash?: string;
  fileIdx?: number;
  size?: number;
  seeders?: number;
  quality?: string;
  releaseGroup?: string;
  context?: StreamContext;
  similarity?: number;
  
  // Extended Metadata from Torrent Indexer API
  videoQuality?: string;
  audioQuality?: string;
  genres?: string[];
  subtitles?: string[];
  duration?: string;
  classification?: string;
  contextString?: string;
}
