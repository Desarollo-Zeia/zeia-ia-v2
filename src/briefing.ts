import { costAnalysis } from "./queries";
import { comparePeriods, dataCoverage } from "./queries";
import { activeAlerts } from "./queries";
import { sql } from "./db";
import { env } from "./config";

const enterpriseId = env.defaultEnterpriseId;
const days = 7;

const coverage = await dataCoverage(enterpriseId);
const costs = await costAnalysis(enterpriseId, 30);

const anchor = coverage.last_reading ? new Date(coverage.last_reading) : null;
let comparison: Awaited<ReturnType<typeof comparePeriods>> = [];
let windows: { current?: string; previous?: string } = {};
if (anchor) {
  const endCurrent = anchor;
  const startCurrent = new Date(anchor.getTime() - days * 86400000);
  const endPrevious = startCurrent;
  const startPrevious = new Date(startCurrent.getTime() - days * 86400000);
  windows = {
    current: `${startCurrent.toISOString().slice(0, 10)} → ${endCurrent.toISOString().slice(0, 10)}`,
    previous: `${startPrevious.toISOString().slice(0, 10)} → ${endPrevious.toISOString().slice(0, 10)}`,
  };
  comparison = await comparePeriods(enterpriseId, {
    startCurrent,
    endCurrent,
    startPrevious,
    endPrevious,
  });
}

const alerts = (await activeAlerts(enterpriseId, days, null, 50)) as Array<Record<string, unknown>>;

const lines: string[] = [];
lines.push(`=== BRIEFING SEMANAL ZeIA — enterprise ${enterpriseId} ===`);
lines.push(`Generado: ${new Date().toISOString()}`);
lines.push(`Ultima lectura recibida: ${coverage.last_reading ?? "SIN DATOS"}`);
if (coverage.last_reading) {
  const staleHours = Math.round((Date.now() - new Date(coverage.last_reading).getTime()) / 3600000);
  lines.push(`Antiguedad de datos: ${staleHours} h ${staleHours > 24 ? "⚠ DATOS DESACTUALIZADOS" : "OK"}`);
}

for (const c of costs) {
  if (c.hours_with_data === 0) continue;
  lines.push("");
  lines.push(`-- ${c.hq_name} (${c.currency}) — tarifa: ${c.tariff_name}`);
  lines.push(`Consumo: ${c.energy_kwh} kWh | Costo total: ${c.total_cost} ${c.currency}`);
  lines.push(`  Energia: ${c.energy_cost} | Demanda pico: ${c.demand_cost} (${c.max_demand_kw_peak} kW entre ${env.peakHourStart}:00-${env.peakHourEnd}:00) | Reactiva penalizada: ${c.reactive_cost} (${c.penalized_kvarh} kvarh)`);
  if (c.cycle?.projected_cost != null)
    lines.push(`  Proyeccion ciclo ${c.cycle.start} → ${c.cycle.end}: ${c.cycle.projected_cost} ${c.currency} (${c.cycle.days_elapsed}/${c.cycle.days_total} dias transcurridos)`);
  const top = c.points.slice(0, 3);
  if (top.length > 0)
    lines.push(`  Top costos: ${top.map((p) => `${p.point_name} ${p.cost} ${c.currency}`).join(" | ")}`);
}

if (comparison.length > 0) {
  const relevant = comparison
    .filter((r) => (r.energy_current ?? 0) > 0 && r.delta_pct != null)
    .sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!))
    .slice(0, 5);
  if (relevant.length > 0) {
    lines.push("");
    lines.push(`-- Variacion semanal (semana ANTERIOR ${windows.previous} vs ACTUAL ${windows.current})`);
    for (const r of relevant)
      lines.push(`  ${r.point_name}: ${r.energy_current} kWh (${r.delta_pct! > 0 ? "+" : ""}${r.delta_pct}%)`);
  }
}

lines.push("");
lines.push(`-- Alertas ultimos ${days} dias: ${alerts.length}`);
const latestAlert = alerts[0];
if (latestAlert)
  lines.push(`  Mas reciente: ${latestAlert.timestamp} ${latestAlert.alert_type} ${latestAlert.current_subtype ?? ""}`);

console.log(lines.join("\n"));
console.log("\n=== JSON ===");
console.log(JSON.stringify({ coverage, costs, windows, comparison_top: comparison.slice(0, 10), alerts_count: alerts.length }, null, 2));

await sql.end();
