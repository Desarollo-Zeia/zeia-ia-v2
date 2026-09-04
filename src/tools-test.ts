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

  const metrics = (await executeTool("latest_metrics", { enterprise_id: target.id, limit: 3 }, null)) as Array<Record<string, unknown>>;
  console.log("Metricas (7d):", JSON.stringify(metrics).slice(0, 400));

  const raw = (await executeTool("reading_history", { enterprise_id: target.id, days: 30, granularity: "raw", limit: 50 }, null)) as Array<Record<string, unknown>>;
  const badScale = raw.filter((m) => Math.abs(Number(m.power_kw)) > 5000);
  console.log(`Normalizacion kW en ${raw.length} lecturas crudas (ninguna > 5000 kW):`, badScale.length === 0 ? "OK" : `FALLO: ${JSON.stringify(badScale.slice(0, 3))}`);

  const consumption = (await executeTool("energy_consumption", { enterprise_id: target.id, days: 30, limit: 5 }, null)) as Array<Record<string, unknown>>;
  console.log("Consumo 30d:", JSON.stringify(consumption).slice(0, 500));

  const history = (await executeTool("reading_history", { enterprise_id: target.id, days: 30, granularity: "day", limit: 3 }, null)) as Array<Record<string, unknown>>;
  console.log("Historial (dia):", JSON.stringify(history).slice(0, 500));
  console.log("energy_kwh + ep_resets presentes:", history.some((h) => "energy_kwh" in h && "ep_resets" in h) ? "OK" : "FALLO");

  const coverage = await executeTool("data_coverage", { enterprise_id: target.id }, null);
  console.log("Cobertura:", JSON.stringify(coverage).slice(0, 300));

  const coverageScoped = await executeTool("data_coverage", { enterprise_id: target.id, point_id: 71 }, null);
  console.log("Cobertura punto 71:", JSON.stringify(coverageScoped).slice(0, 300));

  const alerts = await executeTool("active_alerts", { enterprise_id: target.id, days: 90, limit: 3 }, null);
  console.log("Alertas (90d):", JSON.stringify(alerts).slice(0, 400));
}

await sql.end();
