import { useEffect, useState, type FormEvent } from 'react';

import {
  authorizeProviderSettings,
  checkMineruConfiguration,
  providerOriginPattern,
} from '../../src/settings/provider-access';
import { defaultSettings, type ExtensionSettings } from '../../src/settings/schema';
import { getSettings, saveSettings } from '../../src/settings/store';

type Activity =
  | 'loading'
  | 'idle'
  | 'saving'
  | 'testing-llm'
  | 'checking-mineru';

type FieldName =
  | 'baseUrl'
  | 'apiKey'
  | 'model'
  | 'mineruBaseUrl'
  | 'mineruToken'
  | 'mineruModel';

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [activity, setActivity] = useState<Activity>('loading');
  const [feedback, setFeedback] = useState('正在读取现有设置');
  const [llmFeedback, setLlmFeedback] = useState('LLM：尚未测试');
  const [mineruFeedback, setMineruFeedback] = useState(
    'MinerU：尚未检查，尚未创建解析任务',
  );
  const [fieldError, setFieldError] = useState<
    Partial<Record<FieldName, string>>
  >({});
  const showProgress = useDelayedProgress(activity !== 'idle');

  useEffect(() => {
    void getSettings().then(
      (value) => {
        setSettings(value);
        setFeedback('设置已加载');
        setActivity('idle');
      },
      (error: unknown) => {
        setFeedback(`读取失败：${errorText(error)}。请刷新页面重试`);
        setActivity('idle');
      },
    );
  }, []);

  function updateOpenAi(field: 'baseUrl' | 'apiKey' | 'model', value: string) {
    setSettings((current) => ({
      ...current,
      openAi: { ...current.openAi, [field]: value },
    }));
    setFieldError((current) => ({ ...current, [field]: undefined }));
    setLlmFeedback('LLM：配置已修改，尚未重新测试');
  }

  function updateMineru(
    field: 'baseUrl' | 'token' | 'modelVersion',
    value: string,
  ) {
    setSettings((current) => ({
      ...current,
      mineru: {
        ...current.mineru,
        [field]: value,
      } as ExtensionSettings['mineru'],
    }));
    const errorField = field === 'baseUrl'
      ? 'mineruBaseUrl'
      : field === 'token'
        ? 'mineruToken'
        : 'mineruModel';
    setFieldError((current) => ({ ...current, [errorField]: undefined }));
    setMineruFeedback('MinerU：配置已修改，尚未检查或创建解析任务');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setActivity('saving');
    setFeedback('正在申请精确 Provider Origin 权限');
    setFieldError({});
    try {
      const authorized = await authorizeProviderSettings(
        settings,
        requestPermissions,
      );
      await saveSettings(authorized);
      setSettings(authorized);
      setFeedback('设置已保存，可以返回页面使用翻译功能');
    } catch (error) {
      reportError(error, 'save');
    } finally {
      setActivity('idle');
    }
  }

  async function testLlm() {
    setActivity('testing-llm');
    setLlmFeedback('LLM：正在申请接口 Origin 权限并发送最小请求');
    clearLlmErrors();
    try {
      const granted = await requestPermissions({
        origins: [providerOriginPattern(settings.openAi.baseUrl)],
      });
      if (!granted) throw new Error('未获得 LLM Origin 授权');
      const response = (await browser.runtime.sendMessage({
        type: 'settings:test-llm',
        settings: {
          openAi: settings.openAi,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        },
      })) as
        | { ok: true; value: { connected: true } }
        | { ok: false; error: string };
      if (!response?.ok) {
        throw new Error(response?.error ?? 'LLM 后台未返回测试结果');
      }
      setLlmFeedback('LLM：连接成功');
    } catch (error) {
      reportError(error, 'llm');
    } finally {
      setActivity('idle');
    }
  }

  async function checkMineru() {
    setActivity('checking-mineru');
    setMineruFeedback('MinerU：正在检查配置并申请接口 Origin 权限');
    clearMineruErrors();
    try {
      const checked = await checkMineruConfiguration(
        settings.mineru,
        requestPermissions,
      );
      setSettings((current) => ({ ...current, mineru: checked }));
      setMineruFeedback(
        'MinerU：配置与权限已就绪，尚未创建解析任务或验证 Token 可用性',
      );
    } catch (error) {
      reportError(error, 'mineru');
    } finally {
      setActivity('idle');
    }
  }

  function clearLlmErrors() {
    setFieldError((current) => ({
      ...current,
      baseUrl: undefined,
      apiKey: undefined,
      model: undefined,
    }));
  }

  function clearMineruErrors() {
    setFieldError((current) => ({
      ...current,
      mineruBaseUrl: undefined,
      mineruToken: undefined,
      mineruModel: undefined,
    }));
  }

  function reportError(error: unknown, scope: 'save' | 'llm' | 'mineru') {
    const message = errorText(error);
    const field = providerErrorField(message, scope);
    if (field) {
      setFieldError((current) => ({
        ...current,
        [field]: `${message}，修正后重试`,
      }));
    }
    if (scope === 'llm') {
      setLlmFeedback(`LLM：${message}`);
    } else if (scope === 'mineru') {
      setMineruFeedback(`MinerU：${message}；尚未创建解析任务`);
    } else {
      setFeedback(`保存失败：${message}`);
    }
  }

  const formBusy = activity === 'loading' || activity === 'saving';
  return (
    <main>
      <header>
        <p className="eyebrow">Web Translate</p>
        <h1>Provider 设置</h1>
        <p>凭据仅保存在扩展本地，并由后台向你授权的精确 HTTPS Origin 发起请求。</p>
      </header>

      <form onSubmit={(event) => void save(event)} aria-busy={activity !== 'idle'}>
        <fieldset>
          <legend>LLM 翻译与论文问答（必需）</legend>
          <p className="help">用于普通网页翻译、PDF 逐页译文和论文智能体。</p>
          <div className="field">
            <label htmlFor="base-url">LLM 接口地址</label>
            <input id="base-url" type="url" inputMode="url" required value={settings.openAi.baseUrl} onChange={(event) => updateOpenAi('baseUrl', event.target.value)} aria-describedby="base-url-help base-url-error" aria-invalid={Boolean(fieldError.baseUrl)} />
            <p id="base-url-help" className="help">OpenAI 兼容接口根地址，例如 https://api.example.com/v1。</p>
            {fieldError.baseUrl && <p id="base-url-error" className="error">{fieldError.baseUrl}</p>}
          </div>
          <div className="field">
            <label htmlFor="model">LLM 模型</label>
            <input id="model" required value={settings.openAi.model} onChange={(event) => updateOpenAi('model', event.target.value)} aria-describedby="model-error" aria-invalid={Boolean(fieldError.model)} />
            {fieldError.model && <p id="model-error" className="error">{fieldError.model}</p>}
          </div>
          <div className="field">
            <label htmlFor="api-key">LLM API Key</label>
            <input id="api-key" type="password" autoComplete="off" required value={settings.openAi.apiKey} onChange={(event) => updateOpenAi('apiKey', event.target.value)} aria-describedby="api-key-error" aria-invalid={Boolean(fieldError.apiKey)} />
            {fieldError.apiKey && <p id="api-key-error" className="error">{fieldError.apiKey}</p>}
          </div>
          <div className="provider-actions">
            <button type="button" disabled={formBusy || activity === 'testing-llm'} onClick={() => void testLlm()}>
              {activity === 'testing-llm' ? '测试中…' : '测试 LLM'}
            </button>
          </div>
          <p className="provider-status" aria-live="polite" data-state={feedbackState(llmFeedback)}>{llmFeedback}</p>
        </fieldset>

        <fieldset>
          <legend>MinerU PDF 解析（PDF 功能必需）</legend>
          <p className="help">配置检查不会上传文件或消耗解析额度；真实可用性在启用 PDF 解析时验证。</p>
          <div className="field">
            <label htmlFor="mineru-base-url">MinerU 接口地址</label>
            <input id="mineru-base-url" type="url" inputMode="url" value={settings.mineru.baseUrl} onChange={(event) => updateMineru('baseUrl', event.target.value)} aria-describedby="mineru-base-url-help mineru-base-url-error" aria-invalid={Boolean(fieldError.mineruBaseUrl)} />
            <p id="mineru-base-url-help" className="help">只填写 API 根地址 https://mineru.net，不要填写 /apiManage/docs 文档页。</p>
            {fieldError.mineruBaseUrl && <p id="mineru-base-url-error" className="error">{fieldError.mineruBaseUrl}</p>}
          </div>
          <div className="field">
            <label htmlFor="mineru-model">MinerU 模型版本</label>
            <select id="mineru-model" value={settings.mineru.modelVersion} onChange={(event) => updateMineru('modelVersion', event.target.value)} aria-describedby="mineru-model-error" aria-invalid={Boolean(fieldError.mineruModel)}>
              <option value="vlm">vlm</option>
              <option value="pipeline">pipeline</option>
            </select>
            {fieldError.mineruModel && <p id="mineru-model-error" className="error">{fieldError.mineruModel}</p>}
          </div>
          <div className="field">
            <label htmlFor="mineru-token">MinerU Token</label>
            <input id="mineru-token" type="password" autoComplete="off" value={settings.mineru.token} onChange={(event) => updateMineru('token', event.target.value)} aria-describedby="mineru-token-help mineru-token-error" aria-invalid={Boolean(fieldError.mineruToken)} />
            <p id="mineru-token-help" className="help">填写 API 管理页面生成的原始 Token，不要添加 Bearer 前缀。</p>
            {fieldError.mineruToken && <p id="mineru-token-error" className="error">{fieldError.mineruToken}</p>}
          </div>
          <div className="provider-actions">
            <button type="button" disabled={formBusy || activity === 'checking-mineru'} onClick={() => void checkMineru()}>
              {activity === 'checking-mineru' ? '检查中…' : '检查 MinerU 配置'}
            </button>
          </div>
          <p className="provider-status" aria-live="polite" data-state={feedbackState(mineruFeedback)}>{mineruFeedback}</p>
        </fieldset>

        <div className="actions">
          <button className="primary" type="submit" disabled={activity !== 'idle'}>
            {activity === 'saving' ? '保存中…' : '保存设置'}
          </button>
        </div>
      </form>

      <div className="feedback" aria-live="polite" data-state={feedback.includes('失败') ? 'error' : 'info'}>
        <strong>{showProgress ? '处理中：' : '状态：'}</strong>{feedback}
      </div>
    </main>
  );
}

async function requestPermissions(permissions: { origins: string[] }) {
  return browser.permissions.request(permissions);
}

export function providerErrorField(
  message: string,
  scope: 'save' | 'llm' | 'mineru',
): FieldName | null {
  if (scope === 'mineru' || /MinerU/.test(message)) {
    if (/Token/.test(message)) return 'mineruToken';
    if (/模型/.test(message)) return 'mineruModel';
    if (/HTTPS|接口地址|凭据|根地址/.test(message)) return 'mineruBaseUrl';
  }
  if (scope === 'llm' || /LLM/.test(message)) {
    if (/API Key/.test(message)) return 'apiKey';
    if (/模型/.test(message)) return 'model';
    if (/HTTPS|接口地址|凭据|HTTP/.test(message)) return 'baseUrl';
  }
  if (/API Key/.test(message)) return 'apiKey';
  if (/模型/.test(message)) return 'model';
  if (/HTTPS|接口地址|凭据/.test(message)) return 'baseUrl';
  return null;
}

function useDelayedProgress(active: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(timer);
  }, [active]);
  return visible;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function feedbackState(value: string): 'error' | 'info' {
  return /失败|不能为空|必须|未获得|无效/.test(value) ? 'error' : 'info';
}
