/**
 * Stream Controller
 */

import type { StremioStream, StreamRequest, StreamResponse } from '../models/stream-model.js';
import type { SourceStream, StreamContext } from '../models/source-model.js';
import type { DebridProvider } from '../models/debrid-model.js';
import { RealDebridService } from '../services/realdebrid-service.js';
import { SourceService } from '../services/source-service.js';
import { StreamService } from '../services/stream-service.js';
import { ConfigService } from '../services/config-service.js';
import { TorboxService } from '../services/torbox-service.js';

export class StreamController {
  private config = ConfigService.loadConfig();
  private readonly resolveBaseUrl = this.config.baseUrl;
  private readonly torboxStreamLimit = this.config.torboxStreamLimit ?? 12;

  async handleStreamRequest(args: StreamRequest): Promise<StreamResponse> {
    const { type, id, extra } = args;

    try {
      console.info(`[GuIndex] 📥 Processando requisição de stream: ${type}/${id}`);
      
      // Fetch streams from all configured sources
      const debridSelection = StreamService.resolveDebridSelection({
        query: {},
        headers: {},
        extra,
        env: {
          realdebridToken: process.env.REALDEBRID_TOKEN,
          torboxToken: process.env.TORBOX_TOKEN
        }
      });
      const selectedProvider = debridSelection.provider;
      const selectedToken = debridSelection.token;
      const fetchOptions = selectedToken
        ? {
            debridProvider: selectedProvider,
            realdebridToken: selectedProvider === 'realdebrid' ? selectedToken : undefined,
            torboxToken: selectedProvider === 'torbox' ? selectedToken : undefined
          }
        : undefined;
      const sourceStreams = await SourceService.fetchStreamsFromAllSources(type, id, fetchOptions);
      
      // Split streams by transport type
      const processableStreams = sourceStreams.filter((stream) =>
        stream.magnet ||
        stream.infoHash ||
        (stream.url && (stream.url.startsWith('magnet:') || stream.url.startsWith('https://')))
      );

      if (processableStreams.length === 0) {
        console.info(`[GuIndex] ⚠️ Nenhum stream processável/magnet encontrado para ${type}/${id}`);
        return { streams: [] };
      }

      console.info(`[GuIndex] 🔄 Preparando ${processableStreams.length} streams brutos para verificação Debrid`);

      const availabilityStart = Date.now();
      await this.ensureDebridAvailability(processableStreams, selectedProvider, selectedToken);
      console.info(`[GuIndex] ⏱️ Verificação de cache no Debrid levou ${Date.now() - availabilityStart}ms`);

      if (!selectedToken) {
        console.info(`[GuIndex] ⚠️ Sem token Debrid. Retornando em modo fallback (Magnets diretos)`);
      }

      let streamMetadata: StremioStream[] = processableStreams
        .map((stream) => {
          const magnet = this.extractStreamMagnet(stream);
          const isHttpStream = stream.url?.startsWith('https://');
          const isCached = stream.cached === true;

          const commonOptions = {
            fallbackMagnet: magnet,
            forceNotWebReady:
              selectedProvider === 'torbox' ? false : !isCached || !selectedToken,
            realDebridReady: selectedProvider === 'realdebrid' ? isCached : undefined,
            torboxReady: selectedProvider === 'torbox' ? isCached : undefined,
            debridProvider: selectedProvider ?? 'realdebrid'
          };

          if (!selectedToken) {
            const url = magnet ?? stream.url;
            if (!url) return undefined;
            return StreamService.createStreamMetadata(stream, url, commonOptions);
          }

          if (selectedProvider !== 'torbox' && !magnet) {
            console.debug(`[GuIndex] ⏭️ Ignorando stream incompatível sem magnet: ${stream.name ?? stream.title}`);
            return undefined;
          }

          const resolveUrl = this.buildResolveUrl({
            token: selectedToken,
            magnet,
            provider: selectedProvider,
            context: stream.context,
            linkType: isHttpStream ? 'webdl' : 'torrent',
            originalUrl: isHttpStream ? stream.url : undefined
          });

          const meta = StreamService.createStreamMetadata(stream, resolveUrl, commonOptions);
          return meta;
        })
        .filter((stream): stream is StremioStream => Boolean(stream));

      // Sort and limit for TorBox to keep JSON lean
      if (selectedProvider === 'torbox') {
        streamMetadata = streamMetadata
          .sort((a, b) => {
            const aReady = a.behaviorHints?.torboxReady ? 1 : 0;
            const bReady = b.behaviorHints?.torboxReady ? 1 : 0;
            if (aReady !== bReady) return bReady - aReady;
            const aSize = (a.behaviorHints as any)?.videoSize ?? 0;
            const bSize = (b.behaviorHints as any)?.videoSize ?? 0;
            return bSize - aSize;
          })
          .slice(0, this.torboxStreamLimit);
      }

      streamMetadata.sort((a, b) => {
        const aReady = a.behaviorHints?.realDebridReady || a.behaviorHints?.torboxReady ? 1 : 0;
        const bReady = b.behaviorHints?.realDebridReady || b.behaviorHints?.torboxReady ? 1 : 0;
        return bReady - aReady;
      });

      console.info(`[GuIndex] 📤 Entrega final: ${streamMetadata.length} streams formatados enviados ao Stremio`);
      return { streams: streamMetadata };
      
    } catch (error) {
      console.error(`Stream processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { streams: [] };
    }
  }

  /**
   * Processes a link (magnet or WebDL URL) through the selected debrid provider when user actually plays the stream.
   */
  async processLinkForPlayback(params: {
    magnet?: string;
    url?: string;
    token: string;
    provider: DebridProvider;
    context?: StreamContext;
  }): Promise<string> {
    const { magnet, url, token, provider, context } = params;

    if (!token) {
      throw new Error('Debrid token is required for playback');
    }

    try {
      console.debug(`Processing link for playback via ${provider}`);

      if (provider === 'torbox') {
        const service = new TorboxService(token);
        if (url && !magnet) {
          const result = await service.processWebDlToDirectUrl(url, context);
          return result.url;
        }
        if (!magnet) throw new Error('Magnet is required for torrent playback');
        const result = await service.processMagnetToDirectUrl(magnet, context);
        return result.url;
      }

      // RealDebrid only supports torrents here
      if (!magnet) {
        throw new Error('Magnet is required for Real-Debrid playback');
      }
      const directUrl = await new RealDebridService(token).processMagnetToDirectUrl(magnet, context);
      return directUrl;
    } catch (error) {
      console.error(`Failed to process link for playback: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      const normalizedHash = stream.infoHash.trim().toLowerCase();
      if (normalizedHash) {
        return `magnet:?xt=urn:btih:${normalizedHash}`;
      }
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

  private async ensureDebridAvailability(
    streams: SourceStream[],
    provider?: DebridProvider,
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

    let cachedHashes = new Set<string>();
    if (provider === 'torbox') {
      cachedHashes = await TorboxService.fetchCachedInfoHashes([...pendingHashes.keys()], token);
    } else {
      cachedHashes = await RealDebridService.fetchCachedInfoHashes([...pendingHashes.keys()], token);
    }

    for (const [hash, relatedStreams] of pendingHashes.entries()) {
      const isCached = cachedHashes.has(hash);
      for (const stream of relatedStreams) {
        stream.cached = isCached;
      }
    }
  }

  private buildResolveUrl(params: {
    token: string;
    magnet?: string;
    originalUrl?: string;
    context?: StreamContext;
    provider?: DebridProvider;
    linkType?: 'torrent' | 'webdl';
  }): string {
    const { token, magnet, originalUrl, context, provider, linkType } = params;
    const base = this.resolveBaseUrl.endsWith('/')
      ? this.resolveBaseUrl
      : `${this.resolveBaseUrl}/`;
    
    // Novo formato: /provider/token/resolve?magnet=...
    const url = new URL(`${provider}/${token}/resolve`, base);
    
    if (magnet) url.searchParams.set('magnet', magnet);
    if (originalUrl) url.searchParams.set('url', originalUrl);
    if (linkType) url.searchParams.set('linkType', linkType);

    const contextValue = StreamService.encodeStreamContext(context);
    if (contextValue) {
      url.searchParams.set('ctx', contextValue);
    }

    return url.toString();
  }
}
