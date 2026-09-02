import { createInterface } from "node:readline";
import { runAgent } from "./agent";

console.log("ZeIA agente (CLI) - escribe tu pregunta o /salir");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = () =>
  new Promise<string>((resolve) => rl.question("Tu: ", resolve));

const history: Array<{ role: "user" | "assistant" | "tool"; content: string | null; [key: string]: unknown }> = [];

while (true) {
  const input = await ask();
  const question = input.trim();
  if (!question) continue;
  if (question === "/salir" || question === "/exit") break;

  history.push({ role: "user", content: question });
  try {
    const { reply, dashboard } = await runAgent(history, null, (step) =>
      console.log(step)
    );
    console.log(`ZeIA: ${reply}`);
    if (dashboard)
      console.log(
        `[dashboard] ${(dashboard as { cards?: unknown[] }).cards?.length ?? 0} cards (disponible en la interfaz web)`
      );
  } catch (err) {
    console.error("Error:", String(err));
  }
}

rl.close();
process.exit(0);
