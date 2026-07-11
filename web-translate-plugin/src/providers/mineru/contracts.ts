export interface MineruSettings {
  baseUrl: string;
  token: string;
  modelVersion: 'vlm' | 'pipeline';
}

export type MineruTaskRef =
  | { kind: 'single'; id: string }
  | { kind: 'batch'; id: string; dataId: string };

export type MineruTaskResult =
  | { state: 'pending' | 'running' }
  | { state: 'done'; fullZipUrl: string }
  | { state: 'failed'; error: string };

export class MineruError extends Error {
  readonly name = 'MineruError';

  constructor(readonly code: string, readonly status?: number) {
    super(code);
  }
}
