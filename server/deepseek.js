import { getSetting } from './db.js';

/* 配置按用户读取；没有个人 Key 时回退到服务端环境变量 */
export function deepseekConfig(userId) {
  const key = getSetting(userId, 'deepseek_api_key') || process.env.DEEPSEEK_API_KEY || '';
  const model = getSetting(userId, 'deepseek_model') || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const baseUrl = (getSetting(userId, 'deepseek_base_url') || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  return { key, model, baseUrl };
}

export async function chat({ userId, messages, json = true, temperature = 0.6, maxTokens = 8000, timeoutMs = 120000 }) {
  const { key, model, baseUrl } = deepseekConfig(userId);
  if (!key) {
    const err = new Error('尚未配置 DeepSeek API Key，请在「我的 → DeepSeek」中填写');
    err.status = 400;
    throw err;
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = new Error(`DeepSeek 请求失败：${e.name === 'TimeoutError' ? '响应超时' : e.message}`);
    err.status = 502;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch { /* 保留原文 */ }
    const err = new Error(`DeepSeek 返回错误(${res.status})：${String(msg).slice(0, 300)}`);
    err.status = res.status === 401 ? 400 : 502;
    throw err;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) {
    const err = new Error('DeepSeek 未返回内容');
    err.status = 502;
    throw err;
  }
  return content;
}
