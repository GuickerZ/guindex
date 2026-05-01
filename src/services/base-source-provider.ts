/**
 * Base Source Provider Class
 */

import type { SourceStream } from '../models/source-model.js';

export interface SourceFetchOptions {
  debridProvider?: 'realdebrid' | 'torbox';
  realdebridToken?: string;
  torboxToken?: string;
  forceFresh?: boolean;
}

export abstract class BaseSourceProvider {
  constructor(public name: string) {}

  abstract getStreams(
    type: string,
    id: string,
    options?: SourceFetchOptions
  ): Promise<SourceStream[]>;
}
