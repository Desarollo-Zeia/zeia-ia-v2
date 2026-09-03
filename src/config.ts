export const env = {
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
  baseUrl: process.env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://zeia_agent:zeia_agent_dev@127.0.0.1:5432/energy",
  port: Number(process.env.PORT ?? 3000),
  defaultEnterpriseId: Number(process.env.DEFAULT_ENTERPRISE_ID ?? 3),
  peakHourStart: Number(process.env.PEAK_HOUR_START ?? 18),
  peakHourEnd: Number(process.env.PEAK_HOUR_END ?? 23),
};
