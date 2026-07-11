export interface OpenAiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ExtensionSettings {
  openAi: OpenAiSettings;
  sourceLanguage: string;
  targetLanguage: string;
}

export const defaultSettings: ExtensionSettings = {
  openAi: {
    apiKey: '',
    baseUrl: '',
    model: '',
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};
