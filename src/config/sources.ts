/**
 * Sources Configuration - Direct SourceProvider instances
 */

import { StremioAddonProvider } from '../services/stremio-addon-provider.js';
import { TorrentIndexerProvider } from '../services/torrent-indexer-provider.js';
import type { BaseSourceProvider } from '../services/base-source-provider.js';

type AddonSourceConfig = {
  name: string;
  url: string;
};

const TORRENT_INDEXER_BASE_URL = process.env.TORRENT_INDEXER_URL || 'http://127.0.0.1:8090';

if (!process.env.TORRENT_INDEXER_URL) {
  console.info('[GuIndex] 🌐 TORRENT_INDEXER_URL não definido; usando fallback local http://127.0.0.1:8090');
}

const parseAddonSources = (): BaseSourceProvider[] => {
  // Default: Mico-Leão Dublado
  const defaultAddons: AddonSourceConfig[] = [
    {
      name: 'Mico-Leão Dublado',
      url: 'https://27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club'
    }
  ];

  const raw = process.env.STREMIO_ADDON_SOURCES;
  let sourceList: unknown = raw ? JSON.parse(raw) : defaultAddons;

  if (!Array.isArray(sourceList)) {
    console.warn('[GuIndex] ⚠️ STREMIO_ADDON_SOURCES deve ser um array JSON; usando defaults.');
    sourceList = defaultAddons;
  }

  const providers: BaseSourceProvider[] = [];
  const items = sourceList as AddonSourceConfig[];
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Partial<AddonSourceConfig>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!name || !url) {
      continue;
    }

    providers.push(new StremioAddonProvider(name, url));
  }
  return providers;
};

const sources: BaseSourceProvider[] = [];
if (TORRENT_INDEXER_BASE_URL) {
  sources.push(new TorrentIndexerProvider('GuIndex', TORRENT_INDEXER_BASE_URL));
}

sources.push(...parseAddonSources());

export const SOURCES: BaseSourceProvider[] = sources;
