/**
 * Base Source Provider Class
 */

import type { SourceStream } from '../models/source-model.js';

export interface SourceFetchOptions {
  realdebridToken?: string;
}

export abstract class BaseSourceProvider {
  constructor(public name: string) {}

  abstract getStreams(
    type: string,
    id: string,
    options?: SourceFetchOptions
  ): Promise<SourceStream[]>;
}
