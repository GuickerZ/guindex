/**
 * Debrid Models
 */

export type DebridProvider = 'realdebrid' | 'torbox';

export interface DebridSelection {
  provider: DebridProvider;
  token: string;
}
