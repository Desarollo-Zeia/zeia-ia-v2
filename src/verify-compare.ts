import { executeTool } from "./tools";
import { sql } from "./db";

const results: Array<{ test: string; ok: boolean; detail: string }> = [];
const check = (test: string, ok: boolean, detail: string) => {
  results.push({ test, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${test} — ${detail}`);
};

const toN = (v: unknown): number | null => (v == null ? null : Number(v));
const OE = 3;
const scope = new Set([OE]);

console.log("=== Verificacion: comparaciones, proporciones y granularidad minute ===\n");

// ---------- compare_points ----------
const cmp = (await executeTool("compare_points", { enterprise_id: OE, point_ids: [77, 78], days: 30 }, scope)) as Array<Record<string, unknown>>;
check("compare: 2 puntos con panel y sede",
  cmp.length === 2 && cmp.every((r) => r.panel_name && r.hq_name),
  cmp.map((r) => `${r.point_name} (${r.panel_name}): ${r.energy_kwh} kWh`).join(" | "));

const direct77 = await sql`
  SELECT COALESCE(sum(h.avg_kw), 0) AS integ FROM (
    SELECT date_trunc('hour', r.created_at) AS h, avg(r."P_value") AS avg_kw
    FROM readings_reading r
    WHERE r.measurement_point_id = 77
      AND r.created_at >= now() - interval '30 days'
      AND r."P_value" IS NOT NULL
    GROUP BY 1
  ) h`;
const integ77 = toN(direct77[0]?.integ) ?? 0;
const tool77 = toN(cmp.find((r) => Number(r.point_id) === 77)?.energy_kwh) ?? 0;
check("compare: energia Chiller 1 coincide con integracion directa",
  Math.abs(tool77 - integ77) < 1,
  `tool=${tool77} vs SQL=${integ77.toFixed(1)} kWh (Chiller 1 reporta kW, sin cambio de escala)`);

const peakOk = cmp.every((r) => toN(r.peak_power_kw)! >= toN(r.avg_power_kw)!);
check("compare: pico >= promedio en todos los puntos", peakOk,
  cmp.map((r) => `pico ${r.peak_power_kw} vs prom ${r.avg_power_kw}`).join(" | "));

// ---------- panel_breakdown ----------
const panels = await sql`
  SELECT DISTINCT p.id, p.name FROM enterprises_electricalpanel p
  JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
  WHERE h.enterprise_id = ${OE} AND p.name ILIKE '%TF-AA%' LIMIT 1`;
const panelId = toN(panels[0]?.id);
const bd = (await executeTool("panel_breakdown", { enterprise_id: OE, panel_id: panelId, days: 30 }, scope)) as Array<Record<string, unknown>>;
const shares = bd.map((r) => toN(r.share_pct) ?? 0);
const shareSum = shares.reduce((a, b) => a + b, 0);
check("breakdown: shares suman ~100%",
  bd.length > 0 && Math.abs(shareSum - 100) < 0.5,
  `${bd.length} puntos, suma=${shareSum.toFixed(1)}%`);

const total = toN(bd[0]?.scope_total_kwh) ?? 0;
const sumRows = bd.reduce((a, r) => a + (toN(r.energy_kwh) ?? 0), 0);
check("breakdown: scope_total coincide con suma de filas",
  Math.abs(total - sumRows) < 1,
  `total=${total} vs suma=${sumRows.toFixed(2)} kWh`);

const agg = bd.find((r) => String(r.point_name).toLowerCase().includes("llave"));
check("breakdown: marca is_main en agregadores",
  agg ? typeof agg.is_main === "boolean" : true,
  agg ? `${agg.point_name}: is_main=${agg.is_main}` : "sin llaves en este tablero");

// ---------- granularidad minute ----------
const min = (await executeTool("reading_history", { enterprise_id: OE, point_id: 71, days: 20, granularity: "minute", limit: 24 }, scope)) as Array<Record<string, unknown>>;
const buckets = min.map((r) => new Date(String(r.bucket)).getTime());
const aligned = buckets.every((b) => b % (5 * 60 * 1000) === 0);
check("minute: buckets alineados a grilla de 5 minutos",
  min.length >= 2 && aligned,
  `${min.length} buckets (huecos de datos permitidos), mas reciente ${min[0]?.bucket}`);
const minConsistent = min.every((r) => {
  const e = toN(r.energy_kwh)!;
  const approx = toN(r.avg_power_kw)! / 12;
  return Math.abs(e - approx) < 0.05;
});
check("minute: energy_kwh = avg_power_kw / 12 (integracion 5 min)",
  minConsistent, `${min.length} buckets verificados`);

// ---------- errores y freshness ----------
const onePoint = (await executeTool("compare_points", { enterprise_id: OE, point_ids: [77] }, scope)) as Record<string, unknown>;
check("compare: menos de 2 puntos rechazado",
  typeof onePoint.error === "string", JSON.stringify(onePoint).slice(0, 80));

const foreignCmp = (await executeTool("compare_points", { enterprise_id: OE, point_ids: [2, 77], days: 30 }, scope)) as Array<Record<string, unknown>>;
check("compare: punto ajeno excluido silenciosamente (scope)",
  Array.isArray(foreignCmp) && foreignCmp.length === 1, `devolvio ${foreignCmp.length} punto(s)`);

const badPanel = (await executeTool("panel_breakdown", { enterprise_id: OE, panel_id: 999999, days: 7 }, scope)) as Record<string, unknown>;
check("breakdown: tablero inexistente devuelve error con tableros validos",
  typeof badPanel.error === "string" && (badPanel.error as string).includes("Tableros validos"),
  JSON.stringify(badPanel).slice(0, 120));

// ---------- resumen ----------
console.log("\n=== RESUMEN ===");
const ok = results.every((r) => r.ok);
console.log(`${ok ? "TODO OK" : "HAY FALLOS"}: ${results.filter((r) => r.ok).length}/${results.length} pruebas`);

await sql.end();
process.exit(ok ? 0 : 1);
