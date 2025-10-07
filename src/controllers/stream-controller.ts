/**
 * Stream Controller
 */

import type { StreamRequest, StreamResponse } from '../models/stream-model.js';
import { RealDebridService } from '../services/realdebrid-service.js';
import { SourceService } from '../services/source-service.js';
import { StreamService } from '../services/stream-service.js';
import { ConfigService } from '../services/config-service.js';

export class StreamController {
  private config = ConfigService.loadConfig();

  async handleStreamRequest(args: StreamRequest): Promise<StreamResponse> {
    const { type, id, extra } = args;

    try {
      console.debug(`Processing stream request: ${type}/${id}`);
      
      // Fetch streams from all configured sources
      const sourceStreams = await SourceService.fetchStreamsFromAllSources(type, id);
      
      // Filter streams that have magnet links or infoHash
      const processableStreams = sourceStreams.filter(stream => 
        stream.magnet || 
        stream.infoHash || 
        (stream.url && stream.url.startsWith('magnet:'))
      );
      
      if (processableStreams.length === 0) {
        console.debug('No processable streams found');
        return { streams: [] };
      }

      console.debug(`Found ${processableStreams.length} streams with magnet links`);

      // Return streams with our own API URLs - Real-Debrid processing will happen on play
      const streamMetadata: StreamResponse['streams'] = processableStreams.map(stream => {
        // Extract magnet link
        const magnet = stream.magnet || 
                       stream.url || 
                       (stream.infoHash ? `magnet:?xt=urn:btih:${stream.infoHash}` : undefined);
        
        if (!magnet) {
          return StreamService.createStreamMetadata(stream, '');
        }
        
        // Create our own API URL that will process the magnet through Real-Debrid
        const encodedMagnet = encodeURIComponent(magnet);
        const token = StreamService.extractRealDebridToken({}, {}, extra);
        
        if (!token) {
          console.debug('No Real-Debrid token provided, skipping stream');
          return StreamService.createStreamMetadata(stream, '');
        }
        
        // Use configured base URL
        const apiUrl = `${this.config.baseUrl}/resolve/${token}/${encodedMagnet}`;
        
        return StreamService.createStreamMetadata(stream, apiUrl);
      });

      console.debug(`Returning ${streamMetadata.length} streams with magnet links`);
      return { streams: streamMetadata };
      
    } catch (error) {
      console.error(`Stream processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { streams: [] };
    }
  }

  /**
   * Processes a magnet link through Real-Debrid when user actually plays the stream
   */
  async processMagnetForPlayback(magnet: string, token: string): Promise<string> {
    if (!token) {
      throw new Error('Real-Debrid token is required for playback');
    }

    try {
      console.debug(`Processing magnet for playback: ${magnet.substring(0, 50)}...`);
      
      const rdService = new RealDebridService(token);
      const directUrl = await rdService.processMagnetToDirectUrl(magnet);
      
      console.debug(`Successfully processed magnet for playback: ${directUrl}`);
      return directUrl;
      
    } catch (error) {
      console.error(`Failed to process magnet for playback: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
}
