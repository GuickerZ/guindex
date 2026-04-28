import 'dotenv/config';
import { TorrentIndexerProvider } from './src/services/torrent-indexer-provider';

async function run() {
  const provider = new TorrentIndexerProvider('Torrent Indexer', 'http://localhost:7000');

  const meta = await provider['fetchCinemetaMeta']('movie', 'tt0102492');
  console.log('Cinemeta aliases:', meta?.aliases);
  console.log('Cinemeta name:', meta?.name);
  
  const tmdbTitles = await provider['fetchLocalizedTitleCandidates']('tt0102492');
  console.log('TMDB titles:', tmdbTitles);
}

run().catch(console.error);
