import { runAgent, freshSessionState } from "./agent";
import { env } from "./config";

const questions = process.argv.slice(2).join(" ").split("||").map((q) => q.trim()).filter(Boolean);
if (questions.length === 0) {
  console.error("uso: bun run src/chat-once.ts \"pregunta 1\" || \"pregunta 2 (seguimiento)\"");
  process.exit(1);
}

const history: Array<{ role: "user" | "assistant" | "tool"; content: string | null; [key: string]: unknown }> = [];
const sessionState = freshSessionState();

for (const question of questions) {
  console.log(`\n>>> CLIENTE: ${question}`);
  history.push({ role: "user", content: question });
  const { reply, dashboard } = await runAgent(history, new Set([env.defaultEnterpriseId]), undefined, sessionState);
  console.log(`ZeIA: ${reply.slice(0, 400)}`);
  if (dashboard) {
    console.log(`[dashboard: "${dashboard.title}" — ${dashboard.subtitle ?? "sin periodo"}]`);
    for (const c of dashboard.cards) console.log(`  - (${c.type}) ${c.title}`);
  } else {
    console.log("[dashboard: null]");
  }
}
process.exit(0);
