import { useEffect, useState, type FormEvent } from 'react';

import { authorizeProviderSettings } from '../../src/settings/provider-access';
import { defaultSettings, type ExtensionSettings } from '../../src/settings/schema';
import { getSettings, saveSettings } from '../../src/settings/store';

type Activity = 'loading' | 'idle' | 'saving' | 'testing';

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [activity, setActivity] = useState<Activity>('loading');
  const [feedback, setFeedback] = useState('正在读取现有设置');
  const [fieldError, setFieldError] = useState<Partial<Record<'baseUrl' | 'apiKey' | 'model' | 'mineruBaseUrl' | 'mineruToken' | 'mineruModel', string>>>({});
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
  }

  async function authorize() {
    return authorizeProviderSettings(settings, (permissions) =>
      browser.permissions.request(permissions),
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setActivity('saving');
    setFeedback('正在申请精确 Provider Origin 权限');
    setFieldError({});
    try {
      const authorized = await authorize();
      await saveSettings(authorized);
      setSettings(authorized);
      setFeedback('保存成功，可以返回网页开始翻译');
    } catch (error) {
      reportError(error);
    } finally {
      setActivity('idle');
    }
  }

  async function testConnection() {
    setActivity('testing');
    setFeedback('正在申请权限并测试连接');
    setFieldError({});
    try {
      const authorized = await authorize();
      const response = (await browser.runtime.sendMessage({
        type: 'settings:test-provider',
        settings: authorized,
      })) as { ok: true; value: { connected: true } } | { ok: false; error: string };
      if (!response?.ok) throw new Error(response?.error ?? '后台未返回测试结果');
      setFeedback('连接成功；如需使用此配置，请点击保存');
    } catch (error) {
      reportError(error);
    } finally {
      setActivity('idle');
    }
  }

  function reportError(error: unknown) {
    const message = errorText(error);
    const field = /MinerU 模型/.test(message)
      ? 'mineruModel'
      : /MinerU/.test(message) && /HTTPS|接口地址|凭据/.test(message)
        ? 'mineruBaseUrl'
        : /HTTPS|接口地址|凭据/.test(message)
      ? 'baseUrl'
      : /API Key/.test(message)
        ? 'apiKey'
        : /模型/.test(message)
          ? 'model'
          : null;
    if (field) setFieldError({ [field]: `${message}，修正后重试` });
    setFeedback(`操作失败：${message}`);
  }

  const disabled = activity !== 'idle';
  return (
    <main>
      <header>
        <p className="eyebrow">Web Translate</p>
        <h1>Provider 设置</h1>
        <p>凭据仅保存在扩展本地，并由后台向你授权的精确 HTTPS Origin 发起请求。</p>
      </header>

      <form onSubmit={(event) => void save(event)} aria-busy={disabled}>
        <div className="field">
          <label htmlFor="base-url">接口地址</label>
          <input id="base-url" type="url" inputMode="url" required value={settings.openAi.baseUrl} onChange={(event) => updateOpenAi('baseUrl', event.target.value)} aria-describedby="base-url-help base-url-error" aria-invalid={Boolean(fieldError.baseUrl)} />
          <p id="base-url-help" className="help">例如 https://api.example.com/v1，仅支持 HTTPS。</p>
          {fieldError.baseUrl && <p id="base-url-error" className="error">{fieldError.baseUrl}</p>}
        </div>
        <fieldset>
          <legend>MinerU PDF 解析（可选）</legend>
          <p className="help">Token 留空时不会启用或申请 MinerU 权限。</p>
          <div className="field">
            <label htmlFor="mineru-base-url">MinerU 接口地址</label>
            <input id="mineru-base-url" type="url" inputMode="url" value={settings.mineru.baseUrl} onChange={(event) => updateMineru('baseUrl', event.target.value)} aria-describedby="mineru-base-url-help mineru-base-url-error" aria-invalid={Boolean(fieldError.mineruBaseUrl)} />
            <p id="mineru-base-url-help" className="help">默认 https://mineru.net，仅支持 HTTPS。</p>
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
            <input id="mineru-token" type="password" autoComplete="off" value={settings.mineru.token} onChange={(event) => updateMineru('token', event.target.value)} aria-describedby="mineru-token-error" aria-invalid={Boolean(fieldError.mineruToken)} />
            {fieldError.mineruToken && <p id="mineru-token-error" className="error">{fieldError.mineruToken}</p>}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="model">模型</label>
          <input id="model" required value={settings.openAi.model} onChange={(event) => updateOpenAi('model', event.target.value)} aria-describedby="model-error" aria-invalid={Boolean(fieldError.model)} />
          {fieldError.model && <p id="model-error" className="error">{fieldError.model}</p>}
        </div>
        <div className="field">
          <label htmlFor="api-key">API Key</label>
          <input id="api-key" type="password" autoComplete="off" required value={settings.openAi.apiKey} onChange={(event) => updateOpenAi('apiKey', event.target.value)} aria-describedby="api-key-error" aria-invalid={Boolean(fieldError.apiKey)} />
          {fieldError.apiKey && <p id="api-key-error" className="error">{fieldError.apiKey}</p>}
        </div>
        <div className="actions">
          <button className="primary" type="submit" disabled={disabled}>{activity === 'saving' ? '保存中…' : '保存设置'}</button>
          <button type="button" disabled={disabled} onClick={() => void testConnection()}>{activity === 'testing' ? '测试中…' : '测试连接'}</button>
        </div>
      </form>

      <div className="feedback" aria-live="polite" data-state={feedback.includes('失败') ? 'error' : 'info'}>
        <strong>{showProgress ? '处理中：' : '状态：'}</strong>{feedback}
      </div>
    </main>
  );
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
