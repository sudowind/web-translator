export type { OpenAiSettings } from '../../settings/schema';

export interface TranslationBlockInput {
  id: string;
  kind?: BlockKind;
  text: string;
}

export interface TranslationRequest {
  blocks: TranslationBlockInput[];
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationResult {
  id: string;
  text: string;
}
import type { BlockKind } from '../../document/model';
