import { sql } from "./db";
import { env } from "./config";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.trunc(value)));

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

export const NORMALIZED_P = sql`
  CASE
    WHEN mp.capacity_amperage IS NOT NULL
      AND mp.capacity_voltage IS NOT NULL
      AND abs(r."P_value") > (CASE mp.type WHEN 'monofasico' THEN 1.0 ELSE 1.732 END)
        * mp.capacity_voltage * mp.capacity_amperage / 1000.0
    THEN r."P_value" / 1000.0
    ELSE r."P_value"
  END
`;

export const NORMALIZED_Q = sql`
  CASE
    WHEN mp.capacity_amperage IS NOT NULL
      AND mp.capacity_voltage IS NOT NULL
      AND abs(r."Q_value") > (CASE mp.type WHEN 'monofasico' THEN 1.0 ELSE 1.732 END)
        * mp.capacity_voltage * mp.capacity_amperage / 1000.0
    THEN r."Q_value" / 1000.0
    ELSE r."Q_value"
  END
`;

export async function listEnterprises() {
  return sql`
    SELECT id, name, acronym
    FROM enterprises_enterprise
    ORDER BY name ASC
    LIMIT 100
  `;
}

export async function enterpriseInfo(enterpriseId: number) {
  const enterprise = await sql`
    SELECT id, name, acronym
    FROM enterprises_enterprise
    WHERE id = ${enterpriseId}
  `;

  const headquarters = await sql`
    SELECT id, name, is_active, energy_provider, tariff_rating, supply_number
    FROM enterprises_energyheadquarter
    WHERE enterprise_id = ${enterpriseId}
    ORDER BY name ASC
  `;

  const points = await sql`
    SELECT mp.id, mp.name, mp.type, mp.capacity, mp.is_active,
           d.name AS device_name, d.model, p.id AS panel_id, p.name AS panel_name
    FROM enterprises_measurementpoint mp
    LEFT JOIN devices_device d ON d.id = mp.device_id
    LEFT JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
    WHERE d.id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM enterprises_electricalpanel p2
        JOIN enterprises_energyheadquarter h ON h.id = p2.energy_headquarter_id
        WHERE p2.id = d.electrical_panel_id
          AND h.enterprise_id = ${enterpriseId}
      )
    ORDER BY mp.is_active DESC, mp.name ASC
    LIMIT 100
  `;

  const devices = await sql`
    SELECT count(*) AS total, sum(CASE WHEN d.is_active THEN 1 ELSE 0 END) AS active
    FROM devices_device d
    JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
    JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
    WHERE h.enterprise_id = ${enterpriseId}
  `;

  return { enterprise: enterprise[0] ?? null, headquarters, points, devices: devices[0] };
}

export async function latestMetrics(enterpriseId: number, limit: number) {
  const n = clamp(limit, 1, 30);
  return sql`
    SELECT DISTINCT ON (r.measurement_point_id)
      r.measurement_point_id AS point_id,
      mp.name AS point_name,
      r.created_at AS last_reading,
      ${NORMALIZED_P} AS power_kw,
      r."EPpos_value" AS energy_counter_kwh,
      r."Ua_value" AS voltage_v,
      r."Ia_value" AS current_a,
      r."PF_value" AS power_factor
    FROM readings_reading r
    JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
    JOIN devices_device d ON d.id = mp.device_id
    JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
    JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
    WHERE h.enterprise_id = ${enterpriseId}
      AND r.created_at > now() - interval '7 days'
    ORDER BY r.measurement_point_id, r.created_at DESC
    LIMIT ${n}
  `;
}

export async function energyConsumption(
  enterpriseId: number,
  days: number,
  limit: number
) {
  const d = clamp(days, 1, 90);
  const n = clamp(limit, 1, 50);
  const rows = await sql`
    WITH pts AS (
      SELECT mp.id, mp.name
      FROM enterprises_measurementpoint mp
      JOIN devices_device d ON d.id = mp.device_id
      JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
      JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
      WHERE h.enterprise_id = ${enterpriseId}
        AND mp.is_active
    ),
    hourly AS (
      SELECT r.measurement_point_id AS pid,
             date_trunc('hour', r.created_at) AS bucket,
             avg(${NORMALIZED_P}) AS avg_kw
      FROM readings_reading r
      JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
      JOIN pts ON pts.id = r.measurement_point_id
      WHERE r.created_at >= now() - make_interval(days => ${d})
        AND r."P_value" IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT pts.id AS point_id,
           pts.name AS point_name,
           CASE WHEN count(h.bucket) = 0 THEN NULL
                ELSE round(sum(h.avg_kw)::numeric, 2) END AS energy_kwh,
           count(h.bucket) AS hours_with_data,
           (SELECT max(r2.created_at) FROM readings_reading r2
             WHERE r2.measurement_point_id = pts.id) AS last_read
    FROM pts
    LEFT JOIN hourly h ON h.pid = pts.id
    GROUP BY pts.id, pts.name
    ORDER BY energy_kwh DESC NULLS LAST
    LIMIT ${n}
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    point_id: r.point_id,
    point_name: r.point_name,
    energy_kwh: Number(r.energy_kwh),
    hours_with_data: Number(r.hours_with_data),
    last_read: r.last_read,
  }));
}

export async function listPoints(enterpriseId: number) {
  return sql`
    SELECT mp.id, mp.name, mp.is_active
    FROM enterprises_measurementpoint mp
    JOIN devices_device d ON d.id = mp.device_id
    JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
    JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
    WHERE h.enterprise_id = ${enterpriseId}
    ORDER BY mp.is_active DESC, mp.name ASC
  `;
}

export async function listPanels(enterpriseId: number) {  return sql`
    SELECT p.id, p.name, p.is_main
    FROM enterprises_electricalpanel p
    JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
    WHERE h.enterprise_id = ${enterpriseId}
    ORDER BY p.name ASC
  `;
}

export async function comparePoints(
  enterpriseId: number,
  pointIds: number[],
  days: number
) {
  const d = clamp(days, 1, 90);
  return sql`
    WITH pts AS (
      SELECT mp.id, mp.name, p.name AS panel_name, h.name AS hq_name
      FROM enterprises_measurementpoint mp
      JOIN devices_device d ON d.id = mp.device_id
      JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
      JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
      WHERE h.enterprise_id = ${enterpriseId}
        AND mp.id = ANY(${pointIds})
    ),
    hourly AS (
      SELECT r.measurement_point_id AS pid,
             date_trunc('hour', r.created_at) AS hb,
             avg(${NORMALIZED_P}) AS avg_kw,
             max(${NORMALIZED_P}) AS peak_kw
      FROM readings_reading r
      JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
      JOIN pts ON pts.id = r.measurement_point_id
      WHERE r.created_at >= now() - make_interval(days => ${d})
        AND r."P_value" IS NOT NULL
      GROUP BY 1, 2
    ),
    agg AS (
      SELECT pid,
             sum(avg_kw) AS energy,
             avg(avg_kw) AS avg_power,
             max(peak_kw) AS peak,
             count(*) AS hours
      FROM hourly
      GROUP BY pid
    )
    SELECT pts.id AS point_id, pts.name AS point_name,
           pts.panel_name, pts.hq_name,
           CASE WHEN COALESCE(a.hours, 0) = 0 THEN NULL
                ELSE round(a.energy::numeric, 2) END AS energy_kwh,
           CASE WHEN COALESCE(a.hours, 0) = 0 THEN NULL
                ELSE round(a.avg_power::numeric, 3) END AS avg_power_kw,
           CASE WHEN COALESCE(a.hours, 0) = 0 THEN NULL
                ELSE round(a.peak::numeric, 2) END AS peak_power_kw,
           COALESCE(a.hours, 0) AS hours_with_data
    FROM pts
    LEFT JOIN agg a ON a.pid = pts.id
    ORDER BY energy_kwh DESC NULLS LAST
  `;
}

export async function panelBreakdown(
  enterpriseId: number,
  panelId: number | null,
  days: number
) {
  const d = clamp(days, 1, 90);
  return sql`
    WITH pts AS (
      SELECT mp.id, mp.name, mp.is_main, p.name AS panel_name
      FROM enterprises_measurementpoint mp
      JOIN devices_device d ON d.id = mp.device_id
      JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
      JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
      WHERE h.enterprise_id = ${enterpriseId}
        AND mp.is_active
        ${panelId != null ? sql`AND p.id = ${panelId}` : sql``}
    ),
    hourly AS (
      SELECT r.measurement_point_id AS pid,
             date_trunc('hour', r.created_at) AS hb,
             avg(${NORMALIZED_P}) AS avg_kw
      FROM readings_reading r
      JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
      JOIN pts ON pts.id = r.measurement_point_id
      WHERE r.created_at >= now() - make_interval(days => ${d})
        AND r."P_value" IS NOT NULL
      GROUP BY 1, 2
    ),
    agg AS (
      SELECT pid, sum(avg_kw) AS energy, count(*) AS hours
      FROM hourly
      GROUP BY pid
    )
    SELECT pts.id AS point_id, pts.name AS point_name,
           pts.panel_name, pts.is_main,
           CASE WHEN COALESCE(a.hours, 0) = 0 THEN NULL
                ELSE round(a.energy::numeric, 2) END AS energy_kwh,
           CASE WHEN COALESCE(a.hours, 0) = 0 THEN NULL
                ELSE round((a.energy * 100.0 / NULLIF(sum(a.energy) OVER (), 0))::numeric, 1) END AS share_pct,
           CASE WHEN COALESCE(sum(COALESCE(a.energy, 0)) OVER (), 0) = 0 THEN NULL
                ELSE round(sum(COALESCE(a.energy, 0)) OVER ()::numeric, 2) END AS scope_total_kwh,
           COALESCE(a.hours, 0) AS hours_with_data
    FROM pts
    LEFT JOIN agg a ON a.pid = pts.id
    ORDER BY energy_kwh DESC NULLS LAST
  `;
}

export async function readingHistory(
  enterpriseId: number,
  options: {
    pointId?: number | null;
    days: number;
    granularity: "hour" | "day" | "raw" | "minute" | "month";
    limit: number;
  }
) {
  const days = clamp(options.days, 1, 3660);
  const limit = clamp(options.limit, 1, 500);
  const granularity = options.granularity;
  const pointFilter =
    options.pointId != null ? sql`AND mp.id = ${options.pointId}` : sql``;

  if (granularity === "raw") {
    return sql`
      SELECT r.measurement_point_id AS point_id, mp.name AS point_name,
             r.created_at,
             ${NORMALIZED_P} AS power_kw,
             r."EPpos_value" AS energy_counter_kwh
      FROM readings_reading r
      JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
      JOIN devices_device d ON d.id = mp.device_id
      JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
      JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
      WHERE h.enterprise_id = ${enterpriseId}
        AND r.created_at >= now() - make_interval(days => ${days})
      ${pointFilter}
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `;
  }

  const isMinute = granularity === "minute";
  const src = isMinute ? sql`minute m` : sql`hourly h1`;
  const bucketExpr =
    isMinute
      ? sql`m.bucket`
      : granularity === "hour"
        ? sql`h1.hb`
        : granularity === "month"
          ? sql`date_trunc('month', h1.hb)`
          : sql`date_trunc('day', h1.hb)`;
  const hoursExpr = isMinute ? sql`round(count(*) / 12.0, 2)` : sql`count(*)`;
  const energyExpr = isMinute
    ? sql`round((sum(m.avg_kw) / 12.0)::numeric, 3)`
    : sql`round(sum(h1.avg_kw)::numeric, 3)`;
  const avgExpr = isMinute
    ? sql`round(avg(m.avg_kw)::numeric, 3)`
    : sql`round(avg(h1.avg_kw)::numeric, 3)`;

  const rows = await sql`
    WITH base AS (
      SELECT r.measurement_point_id AS pid,
             mp.name AS point_name,
             r.created_at,
             r."EPpos_value" AS ep,
             ${NORMALIZED_P} AS p_kw,
             r."Ua_value" AS ua,
             r."Ia_value" AS ia,
             r."PF_value" AS pf
      FROM readings_reading r
      JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
      JOIN devices_device d ON d.id = mp.device_id
      JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
      JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
      WHERE h.enterprise_id = ${enterpriseId}
        AND r.created_at >= now() - make_interval(days => ${days})
      ${pointFilter}
    ),
    lagged AS (
      SELECT *,
             lag(ep) OVER (PARTITION BY pid ORDER BY created_at) AS prev_ep
      FROM base
    ),
    minute AS (
      SELECT pid, point_name,
             to_timestamp(floor(extract(epoch FROM created_at) / 300) * 300) AS bucket,
             avg(p_kw) AS avg_kw,
             avg(ua) AS ua,
             avg(ia) AS ia,
             avg(pf) AS pf,
             count(*) FILTER (WHERE prev_ep IS NOT NULL AND ep < prev_ep) AS resets
      FROM lagged
      GROUP BY pid, point_name, bucket
    ),
    hourly AS (
      SELECT pid, point_name,
             date_trunc('hour', created_at) AS hb,
             avg(p_kw) AS avg_kw,
             avg(ua) AS ua,
             avg(ia) AS ia,
             avg(pf) AS pf,
             count(*) FILTER (WHERE prev_ep IS NOT NULL AND ep < prev_ep) AS resets
      FROM lagged
      GROUP BY pid, point_name, hb
    )
    SELECT pid AS point_id, point_name,
           ${bucketExpr} AS bucket,
           ${hoursExpr} AS hours_with_data,
           ${energyExpr} AS energy_kwh,
           ${avgExpr} AS avg_power_kw,
           round(avg(ua)::numeric, 1) AS avg_voltage_v,
           round(avg(ia)::numeric, 2) AS avg_current_a,
           round(avg(pf)::numeric, 3) AS avg_power_factor,
           sum(resets) AS ep_resets
    FROM ${src}
    GROUP BY pid, point_name, bucket
    ORDER BY bucket DESC
    LIMIT ${limit}
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    point_id: r.point_id,
    point_name: r.point_name,
    bucket: r.bucket,
    hours_with_data: toNum(r.hours_with_data),
    energy_kwh: toNum(r.energy_kwh),
    avg_power_kw: toNum(r.avg_power_kw),
    avg_voltage_v: toNum(r.avg_voltage_v),
    avg_current_a: toNum(r.avg_current_a),
    avg_power_factor: toNum(r.avg_power_factor),
    ep_resets: toNum(r.ep_resets),
  }));
}

export async function dataCoverage(
  enterpriseId: number,
  pointId?: number | null
): Promise<{
  point_id: number | null;
  enterprise_id: number;
  first_reading: Date | null;
  last_reading: Date | null;
}> {
  const pointFilter =
    pointId != null ? sql`AND mp.id = ${pointId}` : sql``;
  const rows = await sql`
    SELECT min(r.created_at) AS first_reading, max(r.created_at) AS last_reading
    FROM readings_reading r
    JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
    JOIN devices_device d ON d.id = mp.device_id
    JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
    JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
    WHERE h.enterprise_id = ${enterpriseId}
    ${pointFilter}
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return {
    point_id: pointId ?? null,
    enterprise_id: enterpriseId,
    first_reading: (row?.first_reading as Date | null) ?? null,
    last_reading: (row?.last_reading as Date | null) ?? null,
  };
}

export async function activeAlerts(
  enterpriseId: number,
  days: number,
  status: string | null,
  limit: number
) {
  const d = clamp(days, 1, 90);
  const n = clamp(limit, 1, 50);
  return sql`
    SELECT a.id, a.alert_status, a.status, a.timestamp, a.value,
           a.energy_subtype, a.current_subtype, a.fluctuation_subtype,
           th.alert_type, th.name AS threshold_name
    FROM alerts_alert a
    JOIN alerts_alertthreshold th ON th.id = a.alert_threshold_id
    WHERE th.enterprise_id = ${enterpriseId}
      AND a.timestamp >= now() - make_interval(days => ${d})
      ${status ? sql`AND a.status = ${status}` : sql``}
    ORDER BY a.timestamp DESC
    LIMIT ${n}
  `;
}

export async function alertSummary(enterpriseId: number, days: number) {
  const d = clamp(days, 1, 90);
  return sql`
    SELECT th.alert_type, a.status, count(*) AS total
    FROM alerts_alert a
    JOIN alerts_alertthreshold th ON th.id = a.alert_threshold_id
    WHERE th.enterprise_id = ${enterpriseId}
      AND a.timestamp >= now() - make_interval(days => ${d})
    GROUP BY th.alert_type, a.status
    ORDER BY total DESC
    LIMIT 50
  `;
}

export interface CostPoint {
  point_id: number;
  point_name: string;
  energy_kwh: number | null;
  cost: number | null;
}

export interface CostResult {
  hq_id: number;
  hq_name: string;
  currency: string;
  energy_kwh: number | null;
  kwh_peak: number;
  kwh_off_peak: number;
  energy_cost: number | null;
  blended_price_per_kwh: number | null;
  max_demand_kw_peak: number | null;
  demand_cost: number;
  reactive_kvarh: number | null;
  penalized_kvarh: number;
  reactive_cost: number;
  fixed_charge: number;
  total_cost: number | null;
  hours_with_data: number;
  last_reading: Date | null;
  points: CostPoint[];
  cycle: {
    start: string;
    end: string;
    is_current: boolean;
    days_total: number;
    days_elapsed: number;
    projected_cost: number | null;
  } | null;
  tariff_name: string;
}

export async function costAnalysis(
  enterpriseId: number,
  days: number
): Promise<CostResult[]> {
  const d = clamp(days, 1, 90);
  const hqs = await sql`
    SELECT h.id, h.name, h.billing_data_id
    FROM enterprises_energyheadquarter h
    WHERE h.enterprise_id = ${enterpriseId} AND h.is_active
    ORDER BY h.name ASC
  `;

  const results: CostResult[] = [];
  for (const hq of hqs as Array<Record<string, unknown>>) {
    const hqId = Number(hq.id);
    if (!hq.billing_data_id) continue;

    const billingRows = await sql`
      SELECT billing_name, monthly_fixed_charge,
             charge_for_active_energy_peak, charge_for_active_energy_off_peak,
             charge_for_active_power_generation_peak,
             charge_for_reactive_energy_exceeding_30_percent,
             currency, energy_unit
      FROM enterprises_billingdata WHERE id = ${Number(hq.billing_data_id)}`;
    const b = billingRows[0] as Record<string, unknown> | undefined;
    if (!b) continue;

    const pricePeak = toNum(b.charge_for_active_energy_peak) ?? 0;
    const priceOff = toNum(b.charge_for_active_energy_off_peak) ?? pricePeak;
    const demandPrice = toNum(b.charge_for_active_power_generation_peak) ?? 0;
    const reactivePrice = toNum(b.charge_for_reactive_energy_exceeding_30_percent) ?? 0;
    const fixed = toNum(b.monthly_fixed_charge) ?? 0;
    const currency = String(b.currency ?? "PEN");
    const unitDivisor = String(b.energy_unit ?? "MWh").toUpperCase() === "KWH" ? 1 : 1000;

    const cycleRows = await sql`
      SELECT start_date, end_date, is_current
      FROM enterprises_billingcycle
      WHERE energy_headquarter_id = ${hqId} AND is_current
      ORDER BY id DESC LIMIT 1`;
    const cyc = cycleRows[0] as Record<string, unknown> | undefined;

    const hourlies = await sql`
      WITH pts AS (
        SELECT mp.id, mp.name, mp.is_main
        FROM enterprises_measurementpoint mp
        JOIN devices_device d ON d.id = mp.device_id
        JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
        WHERE p.energy_headquarter_id = ${hqId} AND mp.is_active
      ),
      hourly AS (
        SELECT r.measurement_point_id AS pid,
               date_trunc('hour', r.created_at) AS hb,
               avg(${NORMALIZED_P}) AS p_kw,
               avg(${NORMALIZED_Q}) AS q_kvar
        FROM readings_reading r
        JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
        JOIN pts ON pts.id = r.measurement_point_id
        WHERE r.created_at >= now() - make_interval(days => ${d})
          AND r."P_value" IS NOT NULL
        GROUP BY 1, 2
      )
      SELECT h.pid, h.hb, h.p_kw, h.q_kvar, pts.is_main
      FROM hourly h JOIN pts ON pts.id = h.pid`;

    let kwhPeak = 0;
    let kwhOff = 0;
    let eqKvarh = 0;
    let maxKwPeak: number | null = null;
    const mainHour = new Map<string, number>();
    const perPoint = new Map<number, { name: string; energy: number }>();
    for (const row of hourlies as Array<Record<string, unknown>>) {
      const pid = Number(row.pid);
      const hb = row.hb instanceof Date ? row.hb : new Date(String(row.hb));
      const hour = Number(hb.getHours());
      const p = toNum(row.p_kw) ?? 0;
      const q = toNum(row.q_kvar) ?? 0;
      const isMain = Boolean(row.is_main);
      const inPeak = hour >= env.peakHourStart && hour < env.peakHourEnd;      if (inPeak) {
        kwhPeak += p;
        maxKwPeak = maxKwPeak == null ? p : Math.max(maxKwPeak, p);
      } else {
        kwhOff += p;
      }
      eqKvarh += Math.abs(q);
      if (isMain && inPeak) {
        const key = hb.toISOString();
        mainHour.set(key, (mainHour.get(key) ?? 0) + p);
      }
      const entry = perPoint.get(pid) ?? { name: "", energy: 0 };
      entry.energy += p;
      perPoint.set(pid, entry);
    }
    if (mainHour.size > 0) {
      maxKwPeak = Math.max(...mainHour.values());
    }

    const names = await sql`
      SELECT mp.id, mp.name FROM enterprises_measurementpoint mp
      WHERE mp.id = ANY(${[...perPoint.keys()]})`;
    for (const n of names as Array<Record<string, unknown>>)
      perPoint.set(Number(n.id), { name: String(n.name), energy: perPoint.get(Number(n.id))?.energy ?? 0 });

    const energyKwh = kwhPeak + kwhOff;
    const distinctHours = new Set((hourlies as Array<Record<string, unknown>>).map((r) => String(r.hb))).size;
    const hoursWithData = distinctHours;
    const energyCost = energyKwh > 0 ? (kwhPeak * pricePeak + kwhOff * priceOff) / unitDivisor : null;
    const blended = energyCost != null && energyKwh > 0 ? energyCost / energyKwh : pricePeak / unitDivisor;
    const demandCost = maxKwPeak != null ? maxKwPeak * demandPrice : 0;
    const penalizedKvarh = Math.max(0, eqKvarh - 0.3 * energyKwh);
    const reactiveCost = penalizedKvarh * reactivePrice;
    const totalCost = (energyCost ?? 0) + demandCost + reactiveCost + fixed;

    const points: CostPoint[] = [...perPoint.entries()]
      .map(([pid, v]) => ({
        point_id: pid,
        point_name: v.name,
        energy_kwh: v.energy > 0 ? Math.round(v.energy * 100) / 100 : null,
        cost: v.energy > 0 ? Math.round(v.energy * blended * 100) / 100 : null,
      }))
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      .slice(0, 50);

    let cycleInfo: CostResult["cycle"] = null;
    if (cyc) {
      const start = new Date(String(cyc.start_date));
      const end = new Date(String(cyc.end_date));
      const daysTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
      const now = new Date();
      const daysElapsed = Math.min(daysTotal, Math.max(0, Math.ceil((now.getTime() - start.getTime()) / 86400000)));
      const dailyAvg = energyKwh > 0 && hoursWithData > 0 ? totalCost / (hoursWithData / 24) : 0;
      cycleInfo = {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        is_current: Boolean(cyc.is_current),
        days_total: daysTotal,
        days_elapsed: daysElapsed,
        projected_cost: dailyAvg > 0 ? Math.round(dailyAvg * daysTotal * 100) / 100 : null,
      };
    }

    const lastRow = await sql`
      SELECT max(r.created_at) AS last_reading
      FROM readings_reading r
      JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
      JOIN devices_device d ON d.id = mp.device_id
      JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
      WHERE p.energy_headquarter_id = ${hqId}`;
    const lastReading = (lastRow[0] as Record<string, unknown> | undefined)?.last_reading as Date | null;

    results.push({
      hq_id: hqId,
      hq_name: String(hq.name),
      currency,
      energy_kwh: energyKwh > 0 ? Math.round(energyKwh * 100) / 100 : null,
      kwh_peak: Math.round(kwhPeak * 100) / 100,
      kwh_off_peak: Math.round(kwhOff * 100) / 100,
      energy_cost: energyCost != null ? Math.round(energyCost * 100) / 100 : null,
      blended_price_per_kwh: Math.round(blended * 10000) / 10000,
      max_demand_kw_peak: maxKwPeak != null ? Math.round(maxKwPeak * 100) / 100 : null,
      demand_cost: Math.round(demandCost * 100) / 100,
      reactive_kvarh: eqKvarh > 0 ? Math.round(eqKvarh * 100) / 100 : null,
      penalized_kvarh: Math.round(penalizedKvarh * 100) / 100,
      reactive_cost: Math.round(reactiveCost * 100) / 100,
      fixed_charge: fixed,
      total_cost: Math.round(totalCost * 100) / 100,
      hours_with_data: hoursWithData,
      last_reading: lastReading,
      points,
      cycle: cycleInfo,
      tariff_name: String(b.billing_name ?? ""),
    });
  }
  return results;
}

export interface PeriodRow {
  point_id: number;
  point_name: string;
  panel_name: string;
  energy_current: number | null;
  energy_previous: number | null;
  delta_pct: number | null;
  hours_current: number | null;
  hours_previous: number | null;
}

export async function comparePeriods(
  enterpriseId: number,
  options: {
    pointId?: number | null;
    panelId?: number | null;
    startCurrent: Date;
    endCurrent: Date;
    startPrevious: Date;
    endPrevious: Date;
  }
): Promise<PeriodRow[]> {
  const pointFilter =
    options.pointId != null ? sql`AND mp.id = ${options.pointId}` : sql``;
  const panelFilter =
    options.panelId != null ? sql`AND p.id = ${options.panelId}` : sql``;
  const rows = await sql`
    WITH pts AS (
      SELECT mp.id, mp.name, p.name AS panel_name
      FROM enterprises_measurementpoint mp
      JOIN devices_device d ON d.id = mp.device_id
      JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
      JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
      WHERE h.enterprise_id = ${enterpriseId}
      ${pointFilter}
      ${panelFilter}
    ),
    hourly AS (
      SELECT r.measurement_point_id AS pid,
             date_trunc('hour', r.created_at) AS hb,
             avg(${NORMALIZED_P}) AS avg_kw
      FROM readings_reading r
      JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
      JOIN pts ON pts.id = r.measurement_point_id
      WHERE r.created_at >= ${options.startPrevious}
        AND r.created_at < ${options.endCurrent}
        AND r."P_value" IS NOT NULL
      GROUP BY 1, 2
    ),
    agg AS (
      SELECT pid,
             sum(CASE WHEN hb >= ${options.startCurrent} THEN avg_kw ELSE 0 END) AS energy_curr,
             sum(CASE WHEN hb < ${options.startCurrent} THEN avg_kw ELSE 0 END) AS energy_prev,
             count(*) FILTER (WHERE hb >= ${options.startCurrent}) AS hours_curr,
             count(*) FILTER (WHERE hb < ${options.startCurrent}) AS hours_prev
      FROM hourly
      GROUP BY pid
    )
    SELECT pts.id AS point_id, pts.name AS point_name, pts.panel_name,
           CASE WHEN a.energy_curr > 0 THEN round(a.energy_curr::numeric, 2) END AS energy_current,
           CASE WHEN a.energy_prev > 0 THEN round(a.energy_prev::numeric, 2) END AS energy_previous,
           CASE WHEN COALESCE(a.energy_prev, 0) > 0 AND COALESCE(a.energy_curr, 0) > 0
                THEN round(((a.energy_curr - a.energy_prev) / a.energy_prev * 100)::numeric, 1) END AS delta_pct,
           a.hours_curr AS hours_current,
           a.hours_prev AS hours_previous
    FROM pts
    LEFT JOIN agg a ON a.pid = pts.id
    ORDER BY energy_current DESC NULLS LAST
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    point_id: Number(r.point_id),
    point_name: String(r.point_name),
    panel_name: String(r.panel_name ?? ""),
    energy_current: toNum(r.energy_current),
    energy_previous: toNum(r.energy_previous),
    delta_pct: toNum(r.delta_pct),
    hours_current: toNum(r.hours_current),
    hours_previous: toNum(r.hours_previous),
  }));
}
