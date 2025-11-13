/**
 * Stream Controller
 */

import type { StremioStream, StreamRequest, StreamResponse } from '../models/stream-model.js';
import type { SourceStream, StreamContext } from '../models/source-model.js';
import { RealDebridService } from '../services/realdebrid-service.js';
import { SourceService } from '../services/source-service.js';
import { StreamService } from '../services/stream-service.js';
import { ConfigService } from '../services/config-service.js';

export class StreamController {
  private config = ConfigService.loadConfig();
  private readonly resolveBaseUrl = this.config.baseUrl;

  async handleStreamRequest(args: StreamRequest): Promise<StreamResponse> {
    const { type, id, extra } = args;

    try {
      console.debug(`Processing stream request: ${type}/${id}`);
      
      // Fetch streams from all configured sources
      const sourceStreams = await SourceService.fetchStreamsFromAllSources(type, id);
      
      // Filter streams that have magnet links or infoHash
      const processableStreams = sourceStreams.filter((stream) =>
        stream.magnet || stream.infoHash || (stream.url && stream.url.startsWith('magnet:'))
      );

      if (processableStreams.length === 0) {
        console.debug('No processable magnet streams were found');
        return { streams: [] };
      }

      console.debug(`Found ${processableStreams.length} streams with magnet links`);

      // Return streams with our own API URLs - Real-Debrid processing will happen on play
      const envToken = process.env.REALDEBRID_TOKEN;
      const realDebridToken = StreamService.extractRealDebridToken(
        {},
        {},
        extra,
        envToken ? { token: envToken } : undefined
      );

      if (!realDebridToken) {
        console.debug('No Real-Debrid token provided, returning magnet fallback streams');
      }

      const streamMetadata: StremioStream[] = processableStreams
        .map((stream) => {
          const magnet = this.extractStreamMagnet(stream);
          if (!magnet) {
            console.debug(`Skipping stream without magnet/infoHash: ${stream.name ?? stream.title}`);
            return undefined;
          }

          const commonOptions = {
            fallbackMagnet: magnet,
            forceNotWebReady: true,
            realDebridReady: stream.cached ?? false
          };

          if (!realDebridToken) {
            return StreamService.createStreamMetadata(stream, magnet, commonOptions);
          }

          const apiUrl = this.buildResolveUrl(realDebridToken, magnet, stream.context);
          return StreamService.createStreamMetadata(stream, apiUrl, commonOptions);
        })
        .filter((stream): stream is StremioStream => Boolean(stream));

      streamMetadata.sort((a, b) => {
        const aReady = a.behaviorHints?.realDebridReady ? 1 : 0;
        const bReady = b.behaviorHints?.realDebridReady ? 1 : 0;
        return bReady - aReady;
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
  async processMagnetForPlayback(magnet: string, token: string, context?: StreamContext): Promise<string> {
    if (!token) {
      throw new Error('Real-Debrid token is required for playback');
    }

    try {
      console.debug(`Processing magnet for playback: ${magnet.substring(0, 50)}...`);
      
      const rdService = new RealDebridService(token);
      const directUrl = await rdService.processMagnetToDirectUrl(magnet, context);
      
      console.debug(`Successfully processed magnet for playback: ${directUrl}`);
      return directUrl;
      
    } catch (error) {
      console.error(`Failed to process magnet for playback: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private extractStreamMagnet(stream: SourceStream): string | undefined {
    if (stream.magnet && stream.magnet.toLowerCase().startsWith('magnet:')) {
      return stream.magnet;
    }
    if (stream.url && stream.url.toLowerCase().startsWith('magnet:')) {
      return stream.url;
    }
    if (stream.infoHash) {
      return `magnet:?xt=urn:btih:${stream.infoHash}`;
    }
    return undefined;
  }

  private buildResolveUrl(token: string, magnet: string, context?: StreamContext): string {
    const encodedToken = encodeURIComponent(token);
    const encodedMagnet = encodeURIComponent(magnet);
    const contextValue = StreamService.encodeStreamContext(context);
    const querySuffix = contextValue ? `?ctx=${contextValue}` : '';
    return `${this.resolveBaseUrl}/resolve/${encodedToken}/${encodedMagnet}${querySuffix}`;
  }
}
