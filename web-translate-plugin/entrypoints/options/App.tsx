import { useEffect, useState, type FormEvent } from 'react';

import type { LlmPurpose } from '../../src/providers/openai/request-builder';
import {
  authorizeProviderSettings,
  checkMineruConfiguration,
  providerOriginPattern,
} from '../../src/settings/provider-access';
import {
  defaultSettings,
  inferProviderDialect,
  type ExtensionSettings,
  type ProviderDialect,
  type ReasoningMode,
} from '../../src/settings/schema';
import { getSettings, saveSettings } from '../../src/settings/store';

type Activity = 'loading' | 'idle' | 'saving' | 'checking-mineru' | `testing-${LlmPurpose}`;
type FieldName = 'baseUrl' | 'apiKey' | 'model' | 'agentModel' | 'mineruBaseUrl' | 'mineruToken' | 'mineruModel';

const purposeLabels: Record<LlmPurpose, string> = {
  'connection-test': '快速连通',
  translation: '翻译配置',
  agent: '智能体配置',
};

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [dialectManuallySelected, setDialectManuallySelected] = useState(false);
  const [activity, setActivity] = useState<Activity>('loading');
  const [feedback, setFeedback] = useState('正在读取现有设置');
  const [llmFeedback, setLlmFeedback] = useState<Record<LlmPurpose, string>>({
    'connection-test': '尚未测试',
    translation: '尚未测试',
    agent: '尚未测试',
  });
  const [mineruFeedback, setMineruFeedback] = useState('尚未检查；不会创建解析任务');
  const [fieldError, setFieldError] = useState<Partial<Record<FieldName, string>>>({});
  const showProgress = useDelayedProgress(activity !== 'idle');

  useEffect(() => {
    void getSettings().then(
      (value) => {
        setSettings(value);
        setDialectManuallySelected(
          value.openAi.dialect !== inferProviderDialect(value.openAi.baseUrl),
        );
        setFeedback('设置已加载');
        setActivity('idle');
      },
      (error: unknown) => {
        setFeedback(`读取失败：${errorText(error)}。请刷新页面重试`);
        setActivity('idle');
      },
    );
  }, []);

  function markLlmChanged() {
    setLlmFeedback({ 'connection-test': '配置已修改，请重新测试', translation: '配置已修改，请重新测试', agent: '配置已修改，请重新测试' });
  }

  function updateBase(field: 'baseUrl' | 'apiKey', value: string) {
    setSettings((current) => ({
      ...current,
      openAi: {
        ...current.openAi,
        [field]: value,
        ...(field === 'baseUrl'
          ? { dialect: dialectForEditedUrl(current.openAi.dialect, value, dialectManuallySelected) }
          : {}),
      },
    }));
    setFieldError((current) => ({ ...current, [field]: undefined }));
    markLlmChanged();
  }

  function updateDialect(dialect: ProviderDialect) {
    setDialectManuallySelected(true);
    setSettings((current) => {
      const reasoning = current.openAi.agent.profile.reasoning;
      const nextReasoning = reasoning.mode === 'on' && !availableReasoningModes(dialect).includes('on')
        ? { ...reasoning, mode: 'auto' as const }
        : reasoning;
      return {
        ...current,
        openAi: {
          ...current.openAi,
          dialect,
          agent: {
            ...current.openAi.agent,
            profile: { ...current.openAi.agent.profile, reasoning: nextReasoning },
          },
        },
      };
    });
    markLlmChanged();
  }

  function updateTranslation(patch: Partial<ExtensionSettings['openAi']['translation']>) {
    setSettings((current) => ({
      ...current,
      openAi: { ...current.openAi, translation: { ...current.openAi.translation, ...patch } },
    }));
    setFieldError((current) => ({ ...current, model: undefined }));
    markLlmChanged();
  }

  function updateAgent(patch: Partial<ExtensionSettings['openAi']['agent']>) {
    setSettings((current) => ({
      ...current,
      openAi: { ...current.openAi, agent: { ...current.openAi.agent, ...patch } },
    }));
    markLlmChanged();
  }

  function updateAgentProfile(patch: Partial<ExtensionSettings['openAi']['agent']['profile']>) {
    updateAgent({ profile: { ...settings.openAi.agent.profile, ...patch } });
    setFieldError((current) => ({ ...current, agentModel: undefined }));
  }

  function updateAgentReasoning(mode: ReasoningMode) {
    updateAgentProfile({ reasoning: { ...settings.openAi.agent.profile.reasoning, mode } });
  }

  function updateMineru(field: 'baseUrl' | 'token' | 'modelVersion', value: string) {
    setSettings((current) => ({
      ...current,
      mineru: { ...current.mineru, [field]: value } as ExtensionSettings['mineru'],
    }));
    const errorField = field === 'baseUrl' ? 'mineruBaseUrl' : field === 'token' ? 'mineruToken' : 'mineruModel';
    setFieldError((current) => ({ ...current, [errorField]: undefined }));
    setMineruFeedback('配置已修改，尚未检查');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setActivity('saving');
    setFeedback('正在申请 Provider Origin 权限');
    setFieldError({});
    try {
      const authorized = await authorizeProviderSettings(settings, requestPermissions);
      await saveSettings(authorized);
      setSettings(authorized);
      setFeedback('设置已保存，可以返回页面使用翻译功能');
    } catch (error) {
      reportError(error, 'save');
    } finally {
      setActivity('idle');
    }
  }

  async function testLlm(purpose: LlmPurpose) {
    setActivity(`testing-${purpose}`);
    setLlmFeedback((current) => ({ ...current, [purpose]: '正在申请权限并发送最小请求…' }));
    setFieldError((current) => ({ ...current, baseUrl: undefined, apiKey: undefined, model: undefined, agentModel: undefined }));
    try {
      const granted = await requestPermissions({ origins: [providerOriginPattern(settings.openAi.baseUrl)] });
      if (!granted) throw new Error('未获得 LLM Origin 授权');
      const response = (await browser.runtime.sendMessage({
        type: 'settings:test-llm',
        purpose,
        settings: {
          openAi: settings.openAi,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        },
      })) as { ok: true; value: { connected: true } } | { ok: false; error: string };
      if (!response?.ok) throw new Error(response?.error ?? '后台未返回测试结果');
      setLlmFeedback((current) => ({ ...current, [purpose]: '测试成功' }));
    } catch (error) {
      const message = errorText(error);
      const field = providerErrorField(message, 'llm');
      if (field) setFieldError((current) => ({ ...current, [field]: message }));
      setLlmFeedback((current) => ({ ...current, [purpose]: message }));
    } finally {
      setActivity('idle');
    }
  }

  async function checkMineru() {
    setActivity('checking-mineru');
    setMineruFeedback('正在检查配置并申请接口权限…');
    try {
      const checked = await checkMineruConfiguration(settings.mineru, requestPermissions);
      setSettings((current) => ({ ...current, mineru: checked }));
      setMineruFeedback('配置与权限已就绪；尚未创建解析任务或消耗额度');
    } catch (error) {
      reportError(error, 'mineru');
    } finally {
      setActivity('idle');
    }
  }

  function reportError(error: unknown, scope: 'save' | 'mineru') {
    const message = errorText(error);
    const field = providerErrorField(message, scope);
    if (field) setFieldError((current) => ({ ...current, [field]: message }));
    if (scope === 'mineru') setMineruFeedback(message);
    else setFeedback(`保存失败：${message}`);
  }

  const anyActionBusy = activity !== 'idle';
  const reasoningModes = availableReasoningModes(settings.openAi.dialect);
  const agentReasoning = settings.openAi.agent.profile.reasoning;

  return (
    <main>
      <header>
        <p className="eyebrow">Web Translate</p>
        <h1>Provider 设置</h1>
        <p>凭据仅保存在扩展本地。快速连通、翻译和智能体配置可分别测试。</p>
      </header>

      <form onSubmit={(event) => void save(event)} aria-busy={activity !== 'idle'}>
        <fieldset>
          <legend>LLM 基础连接（必需）</legend>
          <div className="field">
            <label htmlFor="dialect">Provider 类型</label>
            <select id="dialect" value={settings.openAi.dialect} onChange={(event) => updateDialect(event.target.value as ProviderDialect)}>
              <option value="dashscope">阿里云百炼 / DashScope</option>
              <option value="openai">OpenAI</option>
              <option value="minimax">MiniMax</option>
              <option value="generic-openai">通用 OpenAI 兼容</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="base-url">LLM 接口地址</label>
            <input id="base-url" type="url" required value={settings.openAi.baseUrl} onChange={(event) => updateBase('baseUrl', event.target.value)} aria-invalid={Boolean(fieldError.baseUrl)} />
            <p className="help">填写兼容接口根地址，例如百炼工作空间的 compatible-mode/v1 地址。</p>
            {fieldError.baseUrl && <p className="error">{fieldError.baseUrl}</p>}
          </div>
          <div className="field">
            <label htmlFor="api-key">LLM API Key</label>
            <input id="api-key" type="password" autoComplete="off" required value={settings.openAi.apiKey} onChange={(event) => updateBase('apiKey', event.target.value)} aria-invalid={Boolean(fieldError.apiKey)} />
            {fieldError.apiKey && <p className="error">{fieldError.apiKey}</p>}
          </div>
          <TestAction purpose="connection-test" activity={activity} busy={anyActionBusy} feedback={llmFeedback['connection-test']} onTest={testLlm} />
        </fieldset>

        <fieldset>
          <legend>翻译配置</legend>
          <p className="help">翻译固定关闭思考并要求 JSON 结构化输出，以降低耗时并保证逐块对齐。</p>
          <div className="field">
            <label htmlFor="translation-model">翻译模型</label>
            <input id="translation-model" required value={settings.openAi.translation.model} onChange={(event) => updateTranslation({ model: event.target.value })} aria-invalid={Boolean(fieldError.model)} />
            {fieldError.model && <p className="error">{fieldError.model}</p>}
          </div>
          <div className="field">
            <label htmlFor="translation-timeout">翻译超时（秒）</label>
            <input id="translation-timeout" type="number" min="5" max="120" value={settings.openAi.translation.timeoutMs / 1000} onChange={(event) => updateTranslation({ timeoutMs: Number(event.target.value) * 1000 })} />
          </div>
          <TestAction purpose="translation" activity={activity} busy={anyActionBusy} feedback={llmFeedback.translation} onTest={testLlm} />
        </fieldset>

        <fieldset>
          <legend>论文智能体配置</legend>
          <label className="checkbox-row">
            <input type="checkbox" checked={settings.openAi.agent.inheritTranslationModel} onChange={(event) => updateAgent({ inheritTranslationModel: event.target.checked })} />
            使用翻译模型
          </label>
          {!settings.openAi.agent.inheritTranslationModel && (
            <div className="field">
              <label htmlFor="agent-model">智能体模型</label>
              <input id="agent-model" required value={settings.openAi.agent.profile.model} onChange={(event) => updateAgentProfile({ model: event.target.value })} aria-invalid={Boolean(fieldError.agentModel)} />
              {fieldError.agentModel && <p className="error">{fieldError.agentModel}</p>}
            </div>
          )}
          <div className="field">
            <label htmlFor="reasoning-mode">思考模式</label>
            <select id="reasoning-mode" value={agentReasoning.mode} onChange={(event) => updateAgentReasoning(event.target.value as ReasoningMode)}>
              {reasoningModes.map((mode) => <option key={mode} value={mode}>{reasoningModeLabel(mode)}</option>)}
            </select>
            {settings.openAi.dialect === 'generic-openai' && <p className="help">通用兼容接口协议未知，不提供显式开启思考。</p>}
          </div>
          {settings.openAi.dialect === 'openai' && agentReasoning.mode === 'on' && (
            <div className="field">
              <label htmlFor="reasoning-effort">思考强度</label>
              <select id="reasoning-effort" value={agentReasoning.effort ?? 'medium'} onChange={(event) => updateAgentProfile({ reasoning: { ...agentReasoning, effort: event.target.value as 'low' | 'medium' | 'high' } })}>
                <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
              </select>
            </div>
          )}
          {settings.openAi.dialect === 'dashscope' && agentReasoning.mode === 'on' && (
            <div className="field">
              <label htmlFor="thinking-budget">思考 Token 上限（可选）</label>
              <input id="thinking-budget" type="number" min="1" max="131072" value={agentReasoning.budgetTokens ?? ''} onChange={(event) => updateAgentProfile({ reasoning: { ...agentReasoning, budgetTokens: event.target.value ? Number(event.target.value) : undefined } })} />
            </div>
          )}
          <div className="field">
            <label htmlFor="agent-timeout">智能体超时（秒）</label>
            <input id="agent-timeout" type="number" min="15" max="300" value={settings.openAi.agent.profile.timeoutMs / 1000} onChange={(event) => updateAgentProfile({ timeoutMs: Number(event.target.value) * 1000 })} />
          </div>
          <TestAction purpose="agent" activity={activity} busy={anyActionBusy} feedback={llmFeedback.agent} onTest={testLlm} />
        </fieldset>

        <fieldset>
          <legend>MinerU PDF 解析（PDF 功能必需）</legend>
          <p className="help">配置检查不会上传文件或消耗解析额度。</p>
          <div className="field">
            <label htmlFor="mineru-base-url">MinerU 接口地址</label>
            <input id="mineru-base-url" type="url" value={settings.mineru.baseUrl} onChange={(event) => updateMineru('baseUrl', event.target.value)} aria-invalid={Boolean(fieldError.mineruBaseUrl)} />
            {fieldError.mineruBaseUrl && <p className="error">{fieldError.mineruBaseUrl}</p>}
          </div>
          <div className="field">
            <label htmlFor="mineru-model">MinerU 模型版本</label>
            <select id="mineru-model" value={settings.mineru.modelVersion} onChange={(event) => updateMineru('modelVersion', event.target.value)}>
              <option value="vlm">vlm</option><option value="pipeline">pipeline</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="mineru-token">MinerU Token</label>
            <input id="mineru-token" type="password" autoComplete="off" value={settings.mineru.token} onChange={(event) => updateMineru('token', event.target.value)} aria-invalid={Boolean(fieldError.mineruToken)} />
            {fieldError.mineruToken && <p className="error">{fieldError.mineruToken}</p>}
          </div>
          <div className="provider-actions"><button type="button" disabled={anyActionBusy} onClick={() => void checkMineru()}>{activity === 'checking-mineru' ? '检查中…' : '检查 MinerU 配置'}</button></div>
          <p className="provider-status" aria-live="polite" data-state={feedbackState(mineruFeedback)}>{mineruFeedback}</p>
        </fieldset>

        <div className="actions"><button className="primary" type="submit" disabled={activity !== 'idle'}>{activity === 'saving' ? '保存中…' : '保存设置'}</button></div>
      </form>
      <div className="feedback" aria-live="polite" data-state={feedbackState(feedback)}><strong>{showProgress ? '处理中：' : '状态：'}</strong>{feedback}</div>
    </main>
  );
}

function TestAction({ purpose, activity, busy, feedback, onTest }: { purpose: LlmPurpose; activity: Activity; busy: boolean; feedback: string; onTest: (purpose: LlmPurpose) => Promise<void> }) {
  const testing = activity === `testing-${purpose}`;
  return <><div className="provider-actions"><button type="button" disabled={busy || testing} onClick={() => void onTest(purpose)}>{testing ? '测试中…' : `测试${purposeLabels[purpose]}`}</button></div><p className="provider-status" aria-live="polite" data-state={feedbackState(feedback)}>{feedback}</p></>;
}

export function availableReasoningModes(dialect: ProviderDialect): ReasoningMode[] {
  return dialect === 'openai' || dialect === 'dashscope' ? ['off', 'auto', 'on'] : ['off', 'auto'];
}

export function dialectForEditedUrl(
  current: ProviderDialect,
  baseUrl: string,
  manuallySelected: boolean,
): ProviderDialect {
  return manuallySelected ? current : inferProviderDialect(baseUrl);
}

function reasoningModeLabel(mode: ReasoningMode): string {
  return mode === 'off' ? '关闭' : mode === 'auto' ? '自动' : '开启';
}

async function requestPermissions(permissions: { origins: string[] }) {
  return browser.permissions.request(permissions);
}

export function providerErrorField(message: string, scope: 'save' | 'llm' | 'mineru'): FieldName | null {
  if (scope === 'mineru' || /MinerU/.test(message)) {
    if (/Token/.test(message)) return 'mineruToken';
    if (/模型/.test(message)) return 'mineruModel';
    if (/HTTPS|接口地址|凭据|根地址/.test(message)) return 'mineruBaseUrl';
  }
  if (/智能体|问答/.test(message) && /模型/.test(message)) return 'agentModel';
  if (scope === 'llm' || /LLM|翻译/.test(message)) {
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
    if (!active) { setVisible(false); return; }
    const timer = window.setTimeout(() => setVisible(true), 300);
    return () => window.clearTimeout(timer);
  }, [active]);
  return visible;
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function feedbackState(value: string): 'error' | 'info' { return /失败|不能为空|必须|未获得|无效|超时/.test(value) ? 'error' : 'info'; }
