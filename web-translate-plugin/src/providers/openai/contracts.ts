export type { TranslationSettings } from '../../settings/schema';

export interface TranslationBlockInput {
  id: string;
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
