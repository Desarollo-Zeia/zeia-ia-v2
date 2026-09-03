import { executeTool } from "./tools";
import { sql } from "./db";

const checks: Array<{ test: string; ok: boolean; detail: string }> = [];
const check = (test: string, ok: boolean, detail: string) => {
  checks.push({ test, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${test} — ${detail}`);
};

const OE = 3;
const scope = new Set([OE]);

console.log("=== Verificacion: cost_analysis y compare_periods ===\n");

// ---------- cost_analysis ----------
const res = (await executeTool("cost_analysis", { enterprise_id: OE, days: 30 }, scope)) as Record<string, any>;
const c = (res.results ?? [])[0] as Record<string, any> | undefined;

check("costo: tarifa cargada desde billingdata",
  !!c && typeof c.tariff_name === "string" && c.tariff_name.length > 0,
  `tarifa: ${c?.tariff_name}, moneda: ${c?.currency}`);

check("costo: energia en kWh y costo en moneda",
  typeof c?.energy_kwh === "number" && c.energy_kwh > 0 && typeof c?.energy_cost === "number" && c.energy_cost > 0,
  `${c?.energy_kwh} kWh -> ${c?.energy_cost} ${c?.currency}`);

const expectedEnergy = ((c?.kwh_peak ?? 0) * 39.15 + (c?.kwh_off_peak ?? 0) * 39.15) / 1000;
check("costo: energia = kWh x tarifa (39.15 USD/MWh)",
  Math.abs(expectedEnergy - (c?.energy_cost ?? 0)) < 0.5,
  `esperado ${expectedEnergy.toFixed(2)} vs ${c?.energy_cost}`);

check("costo: componentes suman total",
  Math.abs((c?.energy_cost ?? 0) + (c?.demand_cost ?? 0) + (c?.reactive_cost ?? 0) + (c?.fixed_charge ?? 0) - (c?.total_cost ?? 0)) < 0.05,
  `energia ${c?.energy_cost} + demanda ${c?.demand_cost} + reactiva ${c?.reactive_cost} + fijo ${c?.fixed_charge} = ${c?.total_cost}`);

check("costo: demanda pico en kW con tarifa 6.51 USD/kW",
  (c?.max_demand_kw_peak ?? 0) > 0 && Math.abs((c?.max_demand_kw_peak ?? 0) * 6.51 - (c?.demand_cost ?? 0)) < 0.05,
  `${c?.max_demand_kw_peak} kW -> ${c?.demand_cost} USD`);

check("costo: penalizacion reactiva aplica regla 30%",
  Math.abs((c?.penalized_kvarh ?? 0) - Math.max(0, (c?.reactive_kvarh ?? 0) - 0.3 * (c?.energy_kwh ?? 0))) < 0.5,
  `kvarh ${c?.reactive_kvarh}, penalizados ${c?.penalized_kvarh}`);

const pts = (c?.points ?? []) as Array<Record<string, any>>;
check("costo: puntos con costo (blended)",
  pts.length > 0 && pts.every((p) => p.cost == null || typeof p.cost === "number"),
  `top: ${pts[0]?.point_name} = ${pts[0]?.cost} ${c?.currency}`);

check("costo: proyeccion de ciclo presente",
  !!c?.cycle && typeof c.cycle.projected_cost === "number" && c.cycle.projected_cost > 0,
  `ciclo ${c?.cycle?.start} → ${c?.cycle?.end}, proyeccion ${c?.cycle?.projected_cost} ${c?.currency} (${c?.cycle?.days_elapsed}/${c?.cycle?.days_total} dias)`);

const cons = (await executeTool("energy_consumption", { enterprise_id: OE, days: 30, limit: 50 }, scope)) as Array<Record<string, unknown>>;
const sumCons = cons.reduce((a, r) => a + (Number(r.energy_kwh) || 0), 0);
check("costo: energia coincide con energy_consumption (misma integracion)",
  Math.abs(sumCons - (c?.energy_kwh ?? 0)) < Math.max(10, sumCons * 0.01),
  `energy_consumption suma ${sumCons.toFixed(0)} vs cost_analysis ${c?.energy_kwh}`);

// ---------- compare_periods ----------
const cmp = (await executeTool("compare_periods", { enterprise_id: OE, days: 30 }, scope)) as Record<string, any>;
const rows = (cmp.rows ?? []) as Array<Record<string, any>>;
const win = cmp.windows as Record<string, Record<string, string>> | undefined;
check("periodos: ventanas ancladas a ultima lectura",
  String(win?.current?.end ?? "").startsWith("2026-08-20"),
  `actual: ${win?.current?.start?.slice(0, 10)} → ${win?.current?.end?.slice(0, 10)}`);

const withBoth = rows.filter((r) => r.energy_current > 0 && r.energy_previous > 0);
check("periodos: filas con ambas ventanas y delta_pct",
  withBoth.length > 0 && withBoth.every((r) => typeof r.delta_pct === "number"),
  `${withBoth.length} puntos con delta (ej: ${withBoth[0]?.point_name} ${withBoth[0]?.delta_pct}%)`);

const sample = withBoth[0];
check("periodos: delta_pct = (curr-prev)/prev*100",
  !!sample && Math.abs(((sample.energy_current - sample.energy_previous) / sample.energy_previous) * 100 - sample.delta_pct) < 0.2,
  `${sample?.point_name}: ${sample?.energy_previous} -> ${sample?.energy_current} = ${sample?.delta_pct}%`);

const pointCmp = (await executeTool("compare_periods", { enterprise_id: OE, point_id: 77, days: 30 }, scope)) as Record<string, any>;
const pointRows = (pointCmp.rows ?? []) as Array<Record<string, any>>;
check("periodos: punto especifico filtra correctamente",
  pointRows.length === 1 && pointRows[0]?.point_id === 77,
  `${pointRows[0]?.point_name}: actual ${pointRows[0]?.energy_current} kWh`);

// ---------- resumen ----------
console.log("\n=== RESUMEN ===");
const ok = checks.every((r) => r.ok);
console.log(`${ok ? "TODO OK" : "HAY FALLOS"}: ${checks.filter((r) => r.ok).length}/${checks.length} pruebas`);

await sql.end();
process.exit(ok ? 0 : 1);
