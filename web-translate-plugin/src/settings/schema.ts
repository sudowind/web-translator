export interface OpenAiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface MineruSettings {
  baseUrl: string;
  token: string;
  modelVersion: 'vlm' | 'pipeline';
}

export interface ExtensionSettings {
  openAi: OpenAiSettings;
  mineru: MineruSettings;
  sourceLanguage: string;
  targetLanguage: string;
}

export const defaultSettings: ExtensionSettings = {
  openAi: {
    apiKey: '',
    baseUrl: '',
    model: '',
  },
  mineru: {
    baseUrl: 'https://mineru.net',
    token: '',
    modelVersion: 'vlm',
  },
  sourceLanguage: 'en',
  targetLanguage: 'zh-CN',
};
