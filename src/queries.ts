import { sql } from "./db";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.trunc(value)));

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
           d.name AS device_name, d.model, p.name AS panel_name
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
      r.created_at,
      r."P_value",
      r."EPpos_value",
      r."Ua_value",
      r."Ia_value",
      r."PF_value"
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
    SELECT mp.id AS point_id, mp.name AS point_name,
      (SELECT "EPpos_value" FROM readings_reading r
        WHERE r.measurement_point_id = mp.id
          AND r.created_at >= now() - make_interval(days => ${d})
        ORDER BY r.created_at ASC LIMIT 1) AS first_ep,
      (SELECT "EPpos_value" FROM readings_reading r
        WHERE r.measurement_point_id = mp.id
          AND r.created_at >= now() - make_interval(days => ${d})
        ORDER BY r.created_at DESC LIMIT 1) AS last_ep,
      (SELECT max(created_at) FROM readings_reading r
        WHERE r.measurement_point_id = mp.id
          AND r.created_at >= now() - make_interval(days => ${d})) AS last_read
    FROM enterprises_measurementpoint mp
    JOIN devices_device d ON d.id = mp.device_id
    JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
    JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
    WHERE h.enterprise_id = ${enterpriseId}
      AND mp.is_active
    ORDER BY point_name ASC
    LIMIT ${n}
  `;
  return rows.map((r) => ({
    point_id: r.point_id,
    point_name: r.point_name,
    ep_start: r.first_ep,
    ep_end: r.last_ep,
    energy_kwh:
      r.first_ep == null || r.last_ep == null
        ? null
        : Number(r.last_ep) - Number(r.first_ep),
    last_read: r.last_read,
  }));
}

export async function readingHistory(
  enterpriseId: number,
  options: {
    pointId?: number | null;
    days: number;
    granularity: "hour" | "day" | "raw";
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
             r.created_at, r."P_value", r."EPpos_value",
             r."Ua_value", r."Ia_value", r."PF_value"
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

  const bucket =
    granularity === "hour"
      ? sql`date_trunc('hour', r.created_at)`
      : sql`date_trunc('day', r.created_at)`;

  return sql`
    SELECT r.measurement_point_id AS point_id, mp.name AS point_name,
           ${bucket} AS bucket,
           count(*) AS n_readings,
           round(avg(r."P_value")::numeric, 3) AS avg_p_kw,
           round(avg(r."Ua_value")::numeric, 1) AS avg_ua_v,
           round(avg(r."Ia_value")::numeric, 2) AS avg_ia_a,
           round(avg(r."PF_value")::numeric, 3) AS avg_pf,
           min(r."EPpos_value") AS min_ep_kwh,
           max(r."EPpos_value") AS max_ep_kwh,
           round((max(r."EPpos_value") - min(r."EPpos_value"))::numeric, 3) AS ep_delta_kwh
    FROM readings_reading r
    JOIN enterprises_measurementpoint mp ON mp.id = r.measurement_point_id
    JOIN devices_device d ON d.id = mp.device_id
    JOIN enterprises_electricalpanel p ON p.id = d.electrical_panel_id
    JOIN enterprises_energyheadquarter h ON h.id = p.energy_headquarter_id
    WHERE h.enterprise_id = ${enterpriseId}
      AND r.created_at >= now() - make_interval(days => ${days})
    ${pointFilter}
    GROUP BY r.measurement_point_id, mp.name, bucket
    ORDER BY bucket DESC
    LIMIT ${limit}
  `;
}

export async function dataCoverage(pointId?: number | null) {
  if (pointId != null) {
    const rows = await sql`
      SELECT min(created_at) AS first_reading, max(created_at) AS last_reading
      FROM readings_reading
      WHERE measurement_point_id = ${pointId}
    `;
    return { point_id: pointId, ...rows[0] };
  }
  const rows = await sql`
    SELECT min(created_at) AS first_reading, max(created_at) AS last_reading
    FROM readings_reading
  `;
  return { point_id: null, ...rows[0] };
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
