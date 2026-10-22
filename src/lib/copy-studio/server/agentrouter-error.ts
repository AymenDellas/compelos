import { AppError } from './errors';

/** Classify provider/CLI diagnostics without returning account details, IDs or raw HTML. */
export function agentRouterError(message: string, status?: number): AppError {
  if (/aliyun_waf|cf-chl-|challenge-platform|security challenge|request has been blocked|potential threats to the server/i.test(message))
    return new AppError(502, 'AgentRouter’s security gateway blocked the hosted request. The API key may still be valid. Ask AgentRouter to allow server-side access from this deployment, or configure a provider that supports it.');
  if (/non-SSE response[\s\S]*(?:text\/html|<!doctype)|content.type.{0,10}text\/html|<!doctype html|<html/i.test(message))
    return new AppError(502, 'AgentRouter returned an HTML page instead of AI data. Check its API endpoint and server-access policy. This does not establish that the API key is invalid.');
  if (/无可用渠道|no (?:available |enabled )?(?:channels?|routes?|providers?).{0,100}(?:model|group)|(?:model|group).{0,100}no (?:available |enabled )?(?:channels?|routes?|providers?)/i.test(message))
    return new AppError(503, 'The configured AI model has no available route on this AgentRouter account. Check COPY_STUDIO_MODEL against the account’s available models. Retrying the same model will not resolve this.');
  if (/(?:not support|不支持)[\s\S]*\/chat\/completions[\s\S]*\/responses|use.{0,30}\/v1\/responses/i.test(message))
    return new AppError(503, 'This AI model requires the Responses API. Set COPY_STUDIO_API_FORMAT=responses and restart the dashboard. Your saved work is unchanged.');
  if (/quota|overdue|balance|credits|insufficient/i.test(message) || status === 402)
    return new AppError(502, 'AgentRouter reports an account balance or quota issue. Check your account before retrying.');
  if (/unauthorized.client/i.test(message))
    return new AppError(502, 'AgentRouter rejected the client request. Please retry or check AgentRouter service status.');
  if (/invalid.*(?:key|token)|authentication/i.test(message))
    return new AppError(502, 'AgentRouter rejected the credentials. Check the Copy Studio token in the dashboard environment.');
  if (status === 401 || /\b401\b/.test(message))
    return new AppError(502, 'AgentRouter could not authenticate this request. Check that the deployed API key belongs to the configured AgentRouter endpoint.');
  if (status === 403)
    return new AppError(502, 'AgentRouter refused access to this model or endpoint. Check the account’s model permissions. This does not establish that the API key is invalid.');
  if (status === 429 || /429|rate.limit/i.test(message))
    return new AppError(429, 'AgentRouter is busy or rate limited. Please wait a moment and retry.');
  if (/timed?.?out|deadline|wall.clock|wall.time|FatalBudgetExceededError/i.test(message))
    return new AppError(504, 'The AI request timed out. Your previous draft is safe. Please retry.');
  if (status === 404)
    return new AppError(503, 'The configured AI model or endpoint was not found. Check COPY_STUDIO_MODEL and COPY_STUDIO_API_FORMAT.');
  if (status && status >= 500)
    return new AppError(503, 'AgentRouter is temporarily unavailable. Your saved work is safe. Please retry when the provider is available.');
  return new AppError(502, 'AgentRouter could not finish this response. Your previous draft is safe. Please retry.');
}

/** Provider error bodies are diagnostic input only; bound them before classification. */
export async function readAgentRouterError(response: Response): Promise<AppError> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  if (reader) try {
    while (bytes < 32_000) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = 32_000 - bytes;
      text += decoder.decode(value.subarray(0, remaining), { stream: true });
      bytes += value.byteLength;
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try {
    const value = JSON.parse(text);
    const error = value?.error;
    text = [value?.type, value?.code, value?.message,
      typeof error === 'string' ? error : error?.message, error?.type, error?.code].filter(v => typeof v === 'string').join(' ');
  } catch { /* HTML and plain text are classified, never returned verbatim. */ }
  return agentRouterError(text, response.status);
}
