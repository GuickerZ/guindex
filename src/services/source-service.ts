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
    console.info(`[GuIndex] 🚀 Iniciando busca paralela em ${SOURCES.length} provedores (incluindo Torrent Indexer)...`);
    
    
    const results = await Promise.all(
      SOURCES.map(async (source) => {
        console.info(`[GuIndex] 📡 Acionando provedor: ${source.name}...`);
        try {
          const streams = await source.getStreams(type, id, options);
          console.info(`[GuIndex] ✅ Sucesso: ${source.name} retornou ${streams.length} streams.`);
          return { source: source.name, streams };
        } catch (error) {
          console.warn(`[GuIndex] ❌ Falha crítica no provedor ${source.name}:`, error);
          return { source: source.name, streams: [] };
        }
      })
    );
    
        
    console.info(`[GuIndex] 🏁 Busca nos provedores concluída. Total de pacotes de provedores: ${results.length}`);
    return results.flatMap(result => result.streams);
  }
}
