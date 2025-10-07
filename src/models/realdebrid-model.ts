/**
 * Real-Debrid Models
 */

export interface TorrentInfo {
  id: string;
  status: string;
  files?: Array<{
    id: number;
    path: string;
    bytes: number;
    selected: number;
  }>;
  links?: string[];
}

export interface MagnetResponse {
  id: string;
}

export interface UnrestrictResponse {
  download: string;
}
