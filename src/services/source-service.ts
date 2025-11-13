/**
 * Source Service - Orchestrates multiple source providers
 */

import type { SourceStream } from '../models/source-model.js';
import { SOURCES } from '../config/sources.js';
import type { SourceFetchOptions } from './base-source-provider.js';

export class SourceService {
  static async fetchStreamsFromAllSources(
    type: string,
    id: string,
    options?: SourceFetchOptions
  ): Promise<SourceStream[]> {
    console.log(`Fetching streams from ${SOURCES.length} sources in parallel...`);
    
    
    const results = await Promise.all(
      SOURCES.map(async (source) => {
        console.log(`🔍 Fetching streams from ${source.name}...`);
        try {
          const streams = await source.getStreams(type, id, options);
          console.log(`✅ Found ${streams.length} streams from ${source.name}`);
          return { source: source.name, streams };
        } catch (error) {
          console.warn(`❌ Failed to fetch from ${source.name}:`, error);
          return { source: source.name, streams: [] };
        }
      })
    );
    
        
    console.log(`🎬 Total streams found: ${results.length}`);
    return results.flatMap(result => result.streams);
  }
}
