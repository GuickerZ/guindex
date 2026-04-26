/**
 * Sources Configuration - Direct SourceProvider instances
 */

import { StremioAddonProvider } from '../services/stremio-addon-provider.js';
import { TorrentIndexerProvider } from '../services/torrent-indexer-provider.js';
import type { BaseSourceProvider } from '../services/base-source-provider.js';

const TORRENT_INDEXER_BASE_URL =
  process.env.TORRENT_INDEXER_URL ||
  'http://guindex.duckdns.org:8090';

if (!process.env.TORRENT_INDEXER_URL) {
  console.log('[GuIndex] Usando instancia padrao do torrent-indexer: http://guindex.duckdns.org:8090');
}

export const SOURCES: BaseSourceProvider[] = [
  new TorrentIndexerProvider('GuIndex', TORRENT_INDEXER_BASE_URL),
  new StremioAddonProvider('Mico-Leão Dublado', 'https://27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club'),
  
  
  
  // Future sources can be added here:
  // new StremioAddonProvider('AnotherAddon', 'https://another-addon.com'),
  // new ExampleScraperProvider('TorrentSite', 'https://torrent-site.com'),
  // new CustomScraperProvider('AnotherSite', 'https://another-site.com')
];
