/**
 * FlareGit Cloudflare Workers AI Client
 * 
 * Invokes Cloudflare Workers AI models for code repair, conflict reasoning,
 * and requirement analysis. Supports both Worker binding (env.AI) and
 * Cloudflare REST API / AI Gateway.
 */

export interface WorkersAIConfig {
  accountId?: string;
  apiToken?: string;
  gatewayId?: string;
  modelId?: string;
  aiBinding?: any; // Cloudflare Worker env.AI binding
}

export interface WorkersAIResponse {
  modelId: string;
  response: string;
  latencyMs: number;
  tokensUsed?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  costEstimatedUsd: number;
}

export const SUPPORTED_MODELS = {
  REASONING_PRIMARY: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  FAST_INSTRUCT: "@cf/meta/llama-3.1-8b-instruct-fp8",
  CODE_GEN: "@cf/meta/llama-3.1-70b-instruct",
} as const;

export class WorkersAIClient {
  private accountId: string;
  private apiToken?: string;
  private gatewayId?: string;
  private modelId: string;
  private aiBinding?: any;

  constructor(config?: WorkersAIConfig) {
    this.accountId = config?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "9888fed381861dcc35a37b026ff176e9";
    this.apiToken = config?.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
    this.gatewayId = config?.gatewayId ?? process.env.CLOUDFLARE_AI_GATEWAY;
    this.modelId = config?.modelId ?? SUPPORTED_MODELS.REASONING_PRIMARY;
    this.aiBinding = config?.aiBinding;
  }

  /**
   * Run inference through Cloudflare Workers AI
   */
  async runInference(prompt: string, opts?: { modelId?: string; maxTokens?: number }): Promise<WorkersAIResponse> {
    const selectedModel = opts?.modelId ?? this.modelId;
    const startTime = Date.now();

    // 1. If running inside a Cloudflare Worker with env.AI binding
    if (this.aiBinding) {
      const result = await this.aiBinding.run(selectedModel, {
        prompt,
        max_tokens: opts?.maxTokens ?? 2048,
      });

      const latencyMs = Date.now() - startTime;
      const text = typeof result === "string" ? result : result.response ?? JSON.stringify(result);

      return {
        modelId: selectedModel,
        response: text,
        latencyMs,
        tokensUsed: {
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: Math.ceil(text.length / 4),
          totalTokens: Math.ceil((prompt.length + text.length) / 4),
        },
        costEstimatedUsd: 0.0001,
      };
    }

    // 2. If running via Cloudflare REST API / AI Gateway
    if (this.apiToken) {
      let endpoint = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${selectedModel}`;
      if (this.gatewayId) {
        endpoint = `https://gateway.ai.cloudflare.com/v1/${this.accountId}/${this.gatewayId}/workers-ai/${selectedModel}`;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          max_tokens: opts?.maxTokens ?? 2048,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Cloudflare Workers AI API error (${res.status}): ${errorText}`);
      }

      const json = await res.json() as any;
      const latencyMs = Date.now() - startTime;
      const responseText = json.result?.response ?? json.response ?? "";

      return {
        modelId: selectedModel,
        response: responseText,
        latencyMs,
        tokensUsed: {
          promptTokens: json.result?.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4),
          completionTokens: json.result?.usage?.completion_tokens ?? Math.ceil(responseText.length / 4),
          totalTokens: json.result?.usage?.total_tokens,
        },
        costEstimatedUsd: 0.0001,
      };
    }

    // 3. Fallback when local without token: return informative mock response for offline development
    return {
      modelId: `${selectedModel} (local-fallback)`,
      response: "```typescript\n// Synthesized by FlareGit Cloudflare Workers AI\n```",
      latencyMs: 12,
      costEstimatedUsd: 0.0,
    };
  }
}
