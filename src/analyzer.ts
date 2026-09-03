import {
  NORMALIZED_P,
  comparePeriods,
  costAnalysis,
  dataCoverage,
  readingHistory,
  type CostResult,
  type PeriodRow,
} from "./queries";
import { sql } from "./db";

export type Severity = "critical" | "warning" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  category: "money" | "anomaly" | "telemetry" | "quality";
  title: string;
  detail: string;
  money_impact: number | null;
  asset: string;
  suggested_question: string;
}

export interface AnalysisResult {
  enterprise_id: number;
  generated_at: string;
  score: number;
  grade: "ok" | "warning" | "critical";
  findings: Finding[];
  cost: CostResult | null;
  coverage: { first_reading: string | null; last_reading: string | null };
  ok_summary: string[];
}

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export async function runAnalysis(enterpriseId: number): Promise<AnalysisResult> {
  const coverage = await dataCoverage(enterpriseId);
  const costs = (await costAnalysis(enterpriseId, 30)).filter((c) => c.hours_with_data > 0);
  const cost = costs[0] ?? null;

  const findings: Finding[] = [];
  const okSummary: string[] = [];

  const anchor = coverage.last_reading ? new Date(coverage.last_reading) : null;
  const staleHours = anchor
    ? Math.round((Date.now() - anchor.getTime()) / HOUR_MS)
    : null;

  // ---------- F1: datos desactualizados (sitio) ----------
  if (!anchor) {
    findings.push({
      id: "telemetry-site",
      severity: "critical",
      category: "telemetry",
      title: "Sin lecturas registradas",
      detail: "La plataforma no tiene ninguna lectura para esta empresa.",
      money_impact: null,
      asset: "Toda la sede",
      suggested_question: "¿Desde cuando hay registros de datos?",
    });
  } else if (staleHours != null && staleHours > 24) {
    findings.push({
      id: "telemetry-site",
      severity: staleHours > 72 ? "critical" : "warning",
      category: "telemetry",
      title: `Datos desactualizados (${staleHours} h)`,
      detail: `La ultima lectura llego el ${anchor.toISOString().slice(0, 16).replace("T", " ")}. Mientras no haya datos, consumos, alertas y costos quedan ciegos.`,
      money_impact: null,
      asset: "Toda la sede",
      suggested_question: "¿Desde cuando hay registros y hasta que fecha llegan los datos?",
    });
  } else {
    okSummary.push(`Telemetria al dia (ultima lectura hace ${staleHours} h).`);
  }

  // ---------- F2: fuga de dinero por reactiva ----------
  if (cost && cost.reactive_cost != null && cost.reactive_cost > 100) {
    findings.push({
      id: "money-reactive",
      severity: cost.reactive_cost > 500 ? "critical" : "warning",
      category: "money",
      title: "Fuga de dinero: penalizacion por energia reactiva",
      detail: `${cost.penalized_kvarh} kvarh penalizados (energia reactiva por encima del 30% del consumo activo). Corregir el factor de potencia (banco de capacitores) elimina o reduce este cargo.`,
      money_impact: cost.reactive_cost,
      asset: cost.hq_name,
      suggested_question: "Analiza mi penalizacion por energia reactiva y como puedo reducirla",
    });
  } else if (cost) {
    okSummary.push("Sin penalizacion relevante por energia reactiva.");
  }

  // ---------- F3: demanda pico vs contratada ----------
  if (cost && cost.max_demand_kw_peak != null) {
    const contracted = await sql`
      SELECT power_contracted FROM enterprises_power
      WHERE energy_headquarter_id = ${cost.hq_id} AND is_power_contracted_active
      ORDER BY id DESC LIMIT 1`;
    const contractedKw = contracted[0]
      ? Number((contracted[0] as Record<string, unknown>).power_contracted)
      : null;
    if (contractedKw && contractedKw > 0) {
      const ratio = cost.max_demand_kw_peak / contractedKw;
      if (ratio > 0.95) {
        findings.push({
          id: "money-demand",
          severity: "critical",
          category: "money",
          title: "Demanda pico al limite de lo contratado",
          detail: `Pico medido de ${cost.max_demand_kw_peak} kW vs ${contractedKw} kW contratados (${Math.round(ratio * 100)}%). Superar la potencia contratada genera penalizaciones y riesgo de corte. Aplanar picos (escalonar arranques) reduce el cargo de ${cost.demand_cost} ${cost.currency}.`,
          money_impact: cost.demand_cost,
          asset: cost.hq_name,
          suggested_question: "Analiza en que horas tengo mis picos de demanda y como aplanarlos",
        });
      } else if (ratio > 0.8) {
        findings.push({
          id: "money-demand",
          severity: "warning",
          category: "money",
          title: `Demanda pico al ${Math.round(ratio * 100)}% de lo contratado`,
          detail: `Pico medido de ${cost.max_demand_kw_peak} kW vs ${contractedKw} kW contratados. El cargo por demanda fue de ${cost.demand_cost} ${cost.currency}: cada kW de pico evitado ahorra al ritmo actual.`,
          money_impact: null,
          asset: cost.hq_name,
          suggested_question: "Analiza en que horas tengo mis picos de demanda y como aplanarlos",
        });
      } else {
        okSummary.push(`Demanda pico (${cost.max_demand_kw_peak} kW) holgada vs contratada (${contractedKw} kW).`);
      }
    }
  }

  // ---------- F4: deriva por punto (30d vs 30d previos) ----------
  let driftRows: PeriodRow[] = [];
  if (anchor) {
    const endCurrent = anchor;
    const startCurrent = new Date(anchor.getTime() - 30 * DAY_MS);
    const endPrevious = startCurrent;
    const startPrevious = new Date(startCurrent.getTime() - 30 * DAY_MS);
    driftRows = (await comparePeriods(enterpriseId, {
      startCurrent,
      endCurrent,
      startPrevious,
      endPrevious,
    })).filter((r) => (r.energy_current ?? 0) > 0 && (r.energy_previous ?? 0) > 0);

    const blended = cost?.blended_price_per_kwh ?? null;
    const drifted = driftRows
      .filter((r) => r.delta_pct != null && Math.abs(r.delta_pct) >= 15)
      .filter((r) => {
        const minHours = Math.min(r.hours_current ?? 0, r.hours_previous ?? 0);
        const maxHours = Math.max(r.hours_current ?? 0, r.hours_previous ?? 0);
        return maxHours === 0 || minHours / maxHours > 0.5;
      })
      .sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!))
      .slice(0, 4);
    for (const r of drifted) {
      const diff = (r.energy_current ?? 0) - (r.energy_previous ?? 0);
      findings.push({
        id: `drift-${r.point_id}`,
        severity: Math.abs(r.delta_pct!) >= 40 ? "warning" : "info",
        category: "anomaly",
        title: `${r.point_name}: ${r.delta_pct! > 0 ? "+" : ""}${r.delta_pct}% vs mes anterior`,
        detail: `${r.energy_previous} kWh (30 dias previos) -> ${r.energy_current} kWh (ultimos 30 dias), en ${r.panel_name}.`,
        money_impact: blended != null ? round(diff * blended) : null,
        asset: r.panel_name,
        suggested_question: `¿Por que cambio el consumo de ${r.point_name}? Analiza su evolucion diaria`,
      });
    }
    if (drifted.length === 0 && driftRows.length > 0)
      okSummary.push(`${driftRows.length} puntos activos sin deriva relevante (±15%) vs el mes anterior.`);
  }

  // ---------- F5: consumo fuera del horario habitual ----------
  if (anchor && cost) {
    const t3 = new Date(anchor.getTime() - 3 * DAY_MS);
    const t31 = new Date(anchor.getTime() - 31 * DAY_MS);
    const night = await sql`
      WITH pts AS (
        SELECT mp.id, mp.name
        FROM enterprises_measurementpoint mp
        JOIN devices_device d ON d.id = mp.device_id
        JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
        WHERE p.energy_headquarter_id = ${cost.hq_id} AND mp.is_active
      ),
      hist AS (
        SELECT r.measurement_point_id AS pid,
               extract(hour FROM r.created_at)::int AS h,
               avg(${NORMALIZED_P}) AS p_kw
        FROM readings_reading r
        JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
        JOIN pts ON pts.id = r.measurement_point_id
        WHERE r.created_at >= ${t31} AND r.created_at < ${t3}
          AND r."P_value" IS NOT NULL
        GROUP BY 1, 2
      ),
      mx AS (SELECT pid, max(p_kw) AS mp FROM hist GROUP BY pid),
      openh AS (
        SELECT hist.pid AS pid, hist.h AS h
        FROM hist JOIN mx ON mx.pid = hist.pid
        WHERE hist.p_kw >= 0.1 * mx.mp
      ),
      recent AS (
        SELECT r.measurement_point_id AS pid,
               date_trunc('hour', r.created_at) AS hb,
               avg(${NORMALIZED_P}) AS p_kw
        FROM readings_reading r
        JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
        JOIN pts ON pts.id = r.measurement_point_id
        WHERE r.created_at >= ${t3} AND r.created_at <= ${anchor}
          AND r."P_value" IS NOT NULL
        GROUP BY 1, 2
      )
      SELECT recent.pid,
        mp.name AS point_name,
        round(sum(CASE WHEN openh.pid IS NULL THEN recent.p_kw ELSE 0 END)::numeric, 2) AS closed_kwh,
        round(sum(recent.p_kw)::numeric, 2) AS total_kwh,
        (SELECT count(*) FROM hist WHERE hist.pid = recent.pid) AS baseline_hours
      FROM recent
      JOIN enterprises_measurementpoint mp ON mp.id = recent.pid
      LEFT JOIN openh ON openh.pid = recent.pid AND openh.h = extract(hour FROM recent.hb)::int
      GROUP BY recent.pid, mp.name
      HAVING sum(CASE WHEN openh.pid IS NULL THEN recent.p_kw ELSE 0 END) > 5
        AND sum(CASE WHEN openh.pid IS NULL THEN recent.p_kw ELSE 0 END)
            >= 0.08 * GREATEST(sum(recent.p_kw), 0.001)
        AND (SELECT count(*) FROM hist WHERE hist.pid = recent.pid) >= 336`;

    for (const row of night as Array<Record<string, unknown>>) {
      const closedKwh = Number(row.closed_kwh);
      if (!(closedKwh > 5)) continue;
      const money = cost.blended_price_per_kwh
        ? round(closedKwh * cost.blended_price_per_kwh)
        : null;
      findings.push({
        id: `night-${row.pid}`,
        severity: closedKwh > 50 ? "warning" : "info",
        category: "anomaly",
        title: `Consumo fuera del horario habitual: ${row.point_name}`,
        detail: `${closedKwh} kWh en los ultimos 3 dias en horas que historicamente estan apagadas (${Math.round((closedKwh / Number(row.total_kwh)) * 100)}% de su consumo). Verificar apagados automaticos o usos fuera de horario.`,
        money_impact: money != null ? round(money * 10) : null,
        asset: "Horario de operacion",
        suggested_question: `¿Por que ${row.point_name} consume fuera de su horario habitual?`,
      });
    }
    if (night.length === 0)
      okSummary.push("Sin consumos fuera del horario habitual de operacion.");
  }

  // ---------- F6: puntos con telemetria caida (individual) ----------
  if (anchor && cost) {
    const perPoint = await sql`
      SELECT mp.id, mp.name,
        (SELECT max(r.created_at) FROM readings_reading r WHERE r.measurement_point_id = mp.id) AS last
      FROM enterprises_measurementpoint mp
      JOIN devices_device d ON d.id = mp.device_id
      JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
      WHERE p.energy_headquarter_id = ${cost.hq_id} AND mp.is_active`;
    const fallen = (perPoint as Array<Record<string, unknown>>)
      .map((r) => ({ name: String(r.name), last: r.last as Date | null }))
      .filter((r) => r.last && (anchor.getTime() - r.last.getTime()) > 24 * HOUR_MS);
    if (fallen.length > 0) {
      findings.push({
        id: "telemetry-points",
        severity: "warning",
        category: "telemetry",
        title: `${fallen.length} puntos sin datos por mas de 24 h`,
        detail: `Puntos activos cuya ultima lectura es mas vieja que la de la sede: ${fallen.map((f) => f.name).join(", ")}. Revisar conexion o alimentacion de esos analizadores.`,
        money_impact: null,
        asset: "Telemetria",
        suggested_question: "¿Que puntos tienen datos desactualizados y desde cuando?",
      });
    }
  }

  // ---------- F7: calidad de dato - reinicios de contador ----------
  const hist = (await readingHistory(enterpriseId, { days: 30, granularity: "day", limit: 500 })) as Array<Record<string, unknown>>;
  const resets = hist.reduce((a, r) => a + (Number(r.ep_resets) || 0), 0);
  if (resets > 0) {
    findings.push({
      id: "quality-resets",
      severity: "info",
      category: "quality",
      title: `${resets} reinicios de contador en 30 dias`,
      detail: "Los contadores EPpos de algunos equipos se reiniciaron; el consumo reportado usa integracion de potencia y no se ve afectado, pero los equipos conviene revisarlos (cortes o reinicios frecuentes).",
      money_impact: null,
      asset: "Calidad de dato",
      suggested_question: "¿Que equipos han tenido reinicios de contador y cada cuanto?",
    });
  } else {
    okSummary.push("Contadores estables: sin reinicios en 30 dias.");
  }

  // ---------- score ----------
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;
  const score = Math.max(0, Math.min(100, 100 - (25 * critical + 10 * warnings + 3 * infos)));
  const grade = score >= 85 ? "ok" : score >= 60 ? "warning" : "critical";

  findings.sort((a, b) => {
    const sev = { critical: 0, warning: 1, info: 2 } as const;
    const bySev = sev[a.severity] - sev[b.severity];
    if (bySev !== 0) return bySev;
    return (b.money_impact ?? 0) - (a.money_impact ?? 0);
  });

  return {
    enterprise_id: enterpriseId,
    generated_at: new Date().toISOString(),
    score,
    grade,
    findings,
    cost,
    coverage: {
      first_reading: coverage.first_reading?.toISOString() ?? null,
      last_reading: coverage.last_reading?.toISOString() ?? null,
    },
    ok_summary: okSummary,
  };
}
