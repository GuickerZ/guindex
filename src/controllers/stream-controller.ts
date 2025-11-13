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

      const envToken = process.env.REALDEBRID_TOKEN;
      const realDebridToken = StreamService.extractRealDebridToken(
        {},
        {},
        extra,
        envToken ? { token: envToken } : undefined
      );
      await this.ensureRealDebridAvailability(processableStreams, realDebridToken ?? envToken);

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

  private getStreamInfoHash(stream: SourceStream): string | undefined {
    if (typeof stream.infoHash === 'string' && stream.infoHash.trim()) {
      return stream.infoHash.trim().toLowerCase();
    }

    const magnet = this.extractStreamMagnet(stream);
    if (!magnet) {
      return undefined;
    }

    const match = magnet.match(/xt=urn:btih:([^&]+)/i);
    if (!match?.[1]) {
      return undefined;
    }

    return match[1].trim().toLowerCase();
  }

  private async ensureRealDebridAvailability(
    streams: SourceStream[],
    token?: string
  ): Promise<void> {
    const pendingHashes = new Map<string, SourceStream[]>();

    for (const stream of streams) {
      if (stream.cached !== undefined) {
        continue;
      }

      const hash = this.getStreamInfoHash(stream);
      if (!hash) {
        continue;
      }

      if (!pendingHashes.has(hash)) {
        pendingHashes.set(hash, []);
      }
      pendingHashes.get(hash)!.push(stream);
    }

    if (pendingHashes.size === 0) {
      return;
    }

    const cachedHashes = await RealDebridService.fetchCachedInfoHashes(
      [...pendingHashes.keys()],
      token
    );

    for (const [hash, relatedStreams] of pendingHashes.entries()) {
      const isCached = cachedHashes.has(hash);
      for (const stream of relatedStreams) {
        if (stream.cached === undefined) {
          stream.cached = isCached;
        }
      }
    }
  }

  private buildResolveUrl(token: string, magnet: string, context?: StreamContext): string {
    const base = this.resolveBaseUrl.endsWith('/')
      ? this.resolveBaseUrl
      : `${this.resolveBaseUrl}/`;
    const url = new URL('resolve', base);
    url.searchParams.set('token', token);
    url.searchParams.set('magnet', magnet);

    const contextValue = StreamService.encodeStreamContext(context);
    if (contextValue) {
      url.searchParams.set('ctx', contextValue);
    }

    return url.toString();
  }
}
