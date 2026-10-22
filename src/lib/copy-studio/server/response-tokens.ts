import type { ProviderConfig } from './provider';

/** Responses includes hidden reasoning in max_output_tokens. Keep the existing
 * visible JSON allowance available instead of spending it entirely on reasoning.
 * A short connection probe does not need the larger generation allowance.
 */
export function responseTokenLimit(config: ProviderConfig, maxTokens: number): number {
  const hostname = new URL(config.baseUrl).hostname;
  // The live AgentRouter GPT route emitted 7,000 reasoning tokens even with
  // effort=none, leaving no JSON. Do not assume the gateway disables reasoning.
  const gatewayReasoning = (hostname === 'agentrouter.org' || hostname.endsWith('.agentrouter.org'))
    && /^gpt-(?:6\.1-sol|6-astra|5\.6-sol)$/.test(config.model);
  const mayReason = gatewayReasoning || (config.reasoningEffort && config.reasoningEffort !== 'none');
  return Math.max(maxTokens, 512) + (mayReason && maxTokens > 512 ? 18_000 : 0);
}
