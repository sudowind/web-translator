export interface TranslationSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export const defaultSettings: TranslationSettings = {
  apiKey: '',
  baseUrl: '',
  model: '',
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};
