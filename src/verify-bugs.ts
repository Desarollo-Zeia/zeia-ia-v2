import { executeTool } from "./tools";
import { agentDataNotes, CLIENT_TERMS } from "./parameters";
import { sql } from "./db";

const results: Array<{ bug: string; test: string; ok: boolean; detail: string }> = [];
const check = (bug: string, test: string, ok: boolean, detail: string) => {
  results.push({ bug, test, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${bug}] ${test} — ${detail}`);
};

const toN = (v: unknown): number | null => (v == null ? null : Number(v));
const OE = 3;
const scope = new Set([OE]);

console.log("=== Verificacion de bugs B1-B7 con datos reales ===\n");

// ---------- B1: consumo por integracion (no delta de contador) ----------
const cons = (await executeTool("energy_consumption", { enterprise_id: OE, days: 30, limit: 50 }, scope)) as Array<Record<string, unknown>>;
const tdA1 = cons.find((r) => r.point_name === "Tablero TD-A1 (Alumbrado Primer Piso)");
const toolEnergy = toN(tdA1?.energy_kwh);

const direct = await sql`
  SELECT COALESCE(sum(h.avg_kw), 0) AS integ FROM (
    SELECT date_trunc('hour', r.created_at) AS h,
           avg(CASE WHEN mp.capacity_amperage IS NOT NULL AND mp.capacity_voltage IS NOT NULL
                     AND abs(r."P_value") > (CASE mp.type WHEN 'monofasico' THEN 1.0 ELSE 1.732 END)
                       * mp.capacity_voltage * mp.capacity_amperage / 1000.0
                THEN r."P_value"/1000.0 ELSE r."P_value" END) AS avg_kw
    FROM readings_reading r
    JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
    WHERE r.measurement_point_id = 71
      AND r.created_at >= now() - interval '30 days'
      AND r."P_value" IS NOT NULL
    GROUP BY 1
  ) h`;
const integ = toN(direct[0]?.integ) ?? 0;

const counter = await sql`
  SELECT max("EPpos_value") - min("EPpos_value") AS delta
  FROM readings_reading
  WHERE measurement_point_id = 71
    AND created_at >= now() - interval '30 days'
    AND "EPpos_value" IS NOT NULL`;
const counterDelta = toN(counter[0]?.delta) ?? 0;

check("B1", "tool vs integracion directa (mismo metodo)",
  toolEnergy != null && Math.abs(toolEnergy - integ) < 1,
  `tool=${toolEnergy} vs SQL=${integ.toFixed(1)} kWh`);
check("B1", "el metodo viejo (delta contador) daba un numero distinto",
  toolEnergy != null && Math.abs((toolEnergy ?? 0) - counterDelta) > 1000,
  `viejo hubiese dicho ${counterDelta.toFixed(0)} kWh; el fix dice ${toolEnergy}`);

// ---------- B2: readingHistory integra, sin ep_delta max-min ----------
const hist = (await executeTool("reading_history", { enterprise_id: OE, point_id: 71, days: 30, granularity: "day", limit: 40 }, scope)) as Array<Record<string, unknown>>;
const buckets = hist.filter((h) => toN(h.energy_kwh) != null && toN(h.hours_with_data)! > 0);
const inconsistent = buckets.filter((h) => {
  const energy = toN(h.energy_kwh)!;
  const approx = toN(h.avg_power_kw)! * toN(h.hours_with_data)!;
  return Math.abs(energy - approx) > Math.max(1, energy * 0.02);
});
check("B2", "energy_kwh consistente con avg_power_kw x horas (integracion)",
  buckets.length > 0 && inconsistent.length === 0,
  `${buckets.length} buckets con datos, ${inconsistent.length} inconsistentes`);
check("B2", "campo ep_delta_kwh (max-min) eliminado; ep_resets presente",
  hist.length > 0 && !("ep_delta_kwh" in (hist[0] ?? {})) && "ep_resets" in (hist[0] ?? {}),
  Object.keys(hist[0] ?? {}).join(", "));

// ---------- B3: normalizacion W -> kW ----------
const raw = (await executeTool("reading_history", { enterprise_id: OE, point_id: 71, days: 30, granularity: "raw", limit: 100 }, scope)) as Array<Record<string, unknown>>;
const powers = raw.map((r) => Math.abs(toN(r.power_kw) ?? 0));
const maxP = Math.max(...powers, 0);
check("B3", "potencia de TD-A1 en escala fisica (< 200 kW para un tablero de 250A)",
  raw.length > 0 && maxP < 200,
  `max |power_kw| = ${maxP.toFixed(1)} kW en ${raw.length} lecturas (el bug daba ~48,000)`);

const physics = (await executeTool("reading_history", { enterprise_id: OE, point_id: 71, days: 30, granularity: "hour", limit: 500 }, scope)) as Array<Record<string, unknown>>;
const physicsRows = physics.filter((h) => toN(h.avg_power_kw) != null && toN(h.avg_voltage_v) != null && toN(h.avg_voltage_v)! > 0);
check("B3", "coherencia fisica P <= sqrt(3)*U*I (promedios por hora)",
  physicsRows.length === 0 || physicsRows.every((h) => {
    const u = toN(h.avg_voltage_v)!;
    const i = Math.max(toN(h.avg_current_a) ?? 0, 1);
    const p = toN(h.avg_power_kw)!;
    return p <= 1.732 * u * i / 1000 * 1.2 + 1;
  }),
  `${physicsRows.length} horas evaluadas`);

// ---------- B4/B5: fuente de verdad generada desde el diccionario ----------
const notes = agentDataNotes();
check("B4", "CLIENT_TERMS.describe integracion, no resta de contadores",
  CLIENT_TERMS.consumo.meaning.includes("integrando la potencia normalizada") &&
  !CLIENT_TERMS.consumo.meaning.includes("diferencia de contador"),
  CLIENT_TERMS.consumo.meaning.slice(0, 110) + "...");
check("B4", "el significado llega al prompt via agentDataNotes",
  notes.includes("integrando la potencia normalizada"),
  notes.slice(0, 140) + "...");
check("B5", "prompt generado: equivalencias THD presentes",
  notes.includes("THDVr = THDUa") && notes.includes("THDIt = THDIc_value".replace("THDIc_value", "THDIc")),
  "THDVr = THDUa, THDVs = THDUb, THDVt = THDUc, THDIr = THDIa...");
check("B5", "prompt generado: fases a/b/c = R/S/T fijas",
  notes.includes("a=R, b=S, c=T"), "regla de fase en el texto generado");
check("B5", "prompt generado: parametros sin dato listados desde el diccionario",
  ["Pa", "Et", "VfunA", "V3A"].every((k) => notes.includes(k)),
  "Pa, Et, VfunA, V3A... derivados de ELECTRIC_PARAMETERS");

// ---------- B6: data_coverage con scope ----------
const denied = (await executeTool("data_coverage", { enterprise_id: 1 }, scope)) as Record<string, unknown>;
check("B6", "data_coverage de otra empresa rechazado con scope",
  denied && typeof denied.error === "string",
  JSON.stringify(denied).slice(0, 80));

const foreign = await sql`
  SELECT mp.id FROM enterprises_measurementpoint mp
  JOIN devices_device d ON d.id = mp.device_id
  JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
  JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
  WHERE h.enterprise_id <> ${OE} LIMIT 1`;
const foreignId = toN(foreign[0]?.id);
const leak = (await executeTool("data_coverage", { enterprise_id: OE, point_id: foreignId }, scope)) as Record<string, unknown>;
check("B6", "punto ajeno no filtra fechas (resultado vacio)",
  foreignId != null && leak.first_reading == null && leak.last_reading == null,
  `punto ajeno id=${foreignId} -> first_reading=${leak.first_reading}`);

// ---------- B7: contrato de unidades ----------
check("B7", "campos con unidad en el nombre y valores numericos (no strings)",
  typeof tdA1?.energy_kwh === "number" &&
  raw.length > 0 && typeof raw[0]?.power_kw === "number" &&
  !("P_value" in (raw[0] ?? {})),
  `energy_kwh: ${typeof tdA1?.energy_kwh}, power_kw: ${typeof raw[0]?.power_kw}`);

// ---------- G14: resultados vacios incluyen frescura de datos ----------
const emptyAlerts = (await executeTool("active_alerts", { enterprise_id: OE, days: 7 }, scope)) as Record<string, unknown>;
check("G14", "resultado vacio incluye data_note con fecha de ultima lectura",
  emptyAlerts.empty === true &&
  typeof emptyAlerts.data_note === "string" &&
  (emptyAlerts.data_note as string).includes("ultima lectura"),
  JSON.stringify(emptyAlerts).slice(0, 160));

const emptyPoint = (await executeTool("latest_metrics", { enterprise_id: OE }, scope)) as Record<string, unknown>;
check("G14", "latest_metrics vacio tambien reporta frescura",
  emptyPoint.empty === true && typeof emptyPoint.data_note === "string",
  JSON.stringify(emptyPoint).slice(0, 120));

const collector = { dashboard: null, numericDataSeen: false, structure: null, lastDashboardError: null };
const rejected = await executeTool(
  "render_dashboard",
  { title: "test", cards: [{ type: "kpi", title: "Potencia", value: 0, unit: "kW" }] },
  scope,
  collector
);
check("G14", "dashboard con kpi sin datos numericos previos rechazado (anti-ceros)",
  !!rejected && typeof (rejected as Record<string, unknown>).error === "string",
  JSON.stringify(rejected).slice(0, 110));

// ---------- resumen ----------
console.log("\n=== RESUMEN ===");
for (const b of ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "G14"]) {
  const rs = results.filter((r) => r.bug === b);
  const ok = rs.every((r) => r.ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${b}: ${rs.filter((r) => r.ok).length}/${rs.length} pruebas`);
}

await sql.end();
process.exit(results.every((r) => r.ok) ? 0 : 1);
