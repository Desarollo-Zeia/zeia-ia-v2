import { executeTool } from "./tools";
import { sql } from "./db";

const companies = (await executeTool("list_enterprises", {}, null)) as Array<{
  id: number;
  name: string;
}>;

console.log("Empresas:", companies.map((c) => `${c.id}=${c.name}`).join(", "));

const target =
  companies.find((c) => c.name === "Oechsle") ?? companies[0];
if (target) {
  const info = await executeTool("enterprise_info", { enterprise_id: target.id }, null);
  console.log("Info:", JSON.stringify(info).slice(0, 400));

  const metrics = await executeTool("latest_metrics", { enterprise_id: target.id, limit: 3 }, null);
  console.log("Metricas:", JSON.stringify(metrics).slice(0, 400));

  const alerts = await executeTool("active_alerts", { enterprise_id: target.id, days: 7, limit: 3 }, null);
  console.log("Alertas:", JSON.stringify(alerts).slice(0, 400));
}

await sql.end();
