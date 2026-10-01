import type { RepairModel } from "../core/pipeline/repair.js";

export interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface WorkersAIConfig {
  /** Worker `env.AI` binding (production). */
  binding?: AiBinding;
  /** REST access for local development only: both required, read from the environment. */
  accountId?: string;
  apiToken?: string;
  /** AI Gateway id for logging, rate limits and spend caps. */
  gatewayId?: string;
  model?: string;
  maxOutputTokens?: number;
  /** Hard spending control: calls allowed before the client refuses further work. */
  maxCalls?: number;
}

export const DEFAULT_CODE_MODEL = "@cf/openai/gpt-oss-120b";

export class WorkersAINotConfiguredError extends Error {
  constructor() {
    super("Workers AI is not configured: provide the AI binding, or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  }
}

function extractText(result: unknown): string {
  const r = (result as { result?: unknown })?.result ?? result;
  if (typeof r === "string") return r;
  const obj = r as { response?: unknown; choices?: Array<{ message?: { content?: string } }> };
  const text = typeof obj?.response === "string" ? obj.response : obj?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Workers AI returned no text");
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export class WorkersAIClient {
  private calls = 0;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly maxCalls: number;

  constructor(private readonly cfg: WorkersAIConfig = {}) {
    this.model = cfg.model ?? process.env.FLAREGIT_AI_MODEL ?? DEFAULT_CODE_MODEL;
    this.maxTokens = cfg.maxOutputTokens ?? 8192;
    this.maxCalls = cfg.maxCalls ?? 20;
  }

  get isConfigured(): boolean {
    return Boolean(this.cfg.binding ?? (this.accountId && this.apiToken));
  }
  private get accountId() {
    return this.cfg.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  }
  private get apiToken() {
    return this.cfg.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  }

  async complete(prompt: string): Promise<string> {
    if (!this.isConfigured) throw new WorkersAINotConfiguredError();
    if (++this.calls > this.maxCalls) throw new Error(`Workers AI call budget exhausted (${this.maxCalls})`);
    const input = { messages: [{ role: "user", content: prompt }], max_tokens: this.maxTokens };

    if (this.cfg.binding) {
      const options = this.cfg.gatewayId ? { gateway: { id: this.cfg.gatewayId } } : undefined;
      return extractText(await this.cfg.binding.run(this.model, input, options));
    }

    const base = this.cfg.gatewayId
      ? `https://gateway.ai.cloudflare.com/v1/${this.accountId}/${this.cfg.gatewayId}/workers-ai`
      : `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run`;
    const res = await fetch(`${base}/${this.model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Workers AI error ${res.status}`);
    return extractText(await res.json());
  }

  asModel(): RepairModel {
    return (prompt) => this.complete(prompt);
  }
}
