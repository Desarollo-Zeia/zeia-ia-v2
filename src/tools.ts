import type { OpenAI } from "openai";
import { validateDashboard, type Dashboard } from "./dashboard";
import {
  activeAlerts,
  alertSummary,
  comparePeriods,
  comparePoints,
  costAnalysis,
  dataCoverage,
  energyConsumption,
  enterpriseInfo,
  latestMetrics,
  listEnterprises,
  listPanels,
  listPoints,
  panelBreakdown,
  readingHistory,
} from "./queries";

type ToolArgs = Record<string, unknown>;

export interface RunCollector {
  dashboard: Dashboard | null;
  numericDataSeen: boolean;
  structure: { panels: Map<string, string[]>; panelDisplay: Map<string, string>; pointDisplay: Map<string, string>; points: Set<string> } | null;
  lastDashboardError: string | null;
}

const NUMERIC_TOOLS = [
  "latest_metrics",
  "energy_consumption",
  "reading_history",
  "active_alerts",
  "alert_summary",
  "compare_points",
  "panel_breakdown",
  "cost_analysis",
  "compare_periods",
] as const;

const toNumber = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function emptyWithFreshness(
  enterpriseId: number,
  pointId?: number | null
) {
  const cov = await dataCoverage(enterpriseId, pointId);
  const last = cov.last_reading ? new Date(cov.last_reading) : null;
  const lastIso = last && !isNaN(last.getTime()) ? last.toISOString() : null;
  return {
    empty: true,
    data_note: lastIso
      ? `Sin resultados con datos en el periodo solicitado (ventana de esta herramienta). La ultima lectura recibida${pointId ? " para este punto" : " para esta empresa"} fue ${lastIso}. NO interpretes esto como consumo cero ni como ausencia de alertas. TAMPOCO invalida datos de periodos anteriores que otras herramientas ya te devolvieron en esta conversacion: si ya tienes datos, usalos y aclara al cliente que los registros llegan hasta ${lastIso}. Si el cliente no pidio un periodo exacto, REINTENTA con una ventana mayor (ej. days=30) antes de rendirte; si tampoco hay, reporta la fecha de ultima lectura y sugiere revisar la conexion del equipo.`
      : "Sin resultados y sin lecturas registradas para esta empresa en la plataforma.",
  };
}

export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "list_enterprises",
      description:
        "Lista las empresas (clientes) registradas en la plataforma con su id y acronimo. Se usa para identificar la empresa antes de cualquier consulta.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "enterprise_info",
      description:
        "Informacion general de una empresa: sedes, puntos de medicion, dispositivos analizadores y tarifa.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "latest_metrics",
      description:
        "Ultimas lecturas por punto de medicion con valores ya normalizados: potencia activa en kW (power_kw), contador de energia en kWh (energy_counter_kwh), tension en V, corriente en A, factor de potencia.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          limit: { type: "integer", description: "Maximo de puntos a devolver (1-30, por defecto 10)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "energy_consumption",
      description:
        "Consumo de energia (kWh) por punto de medicion en un periodo. Calculado integrando la potencia activa normalizada por hora, robusto ante reinicios del contador EPpos. Solo para preguntas de consumo/ahorro.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          days: { type: "integer", description: "Dias hacia atras (1-90, por defecto 7)" },
          limit: { type: "integer", description: "Maximo de puntos a devolver (1-50, por defecto 20)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reading_history",
      description:
        "Historial de lecturas de energia de una empresa (o de un punto especifico) con energia en kWh integrada (energy_kwh, robusta ante reinicios del contador) y potencia media en kW. Granularidades: 'minute' = bloques de 5 min (solo ventanas de hasta 12 horas, ideal para 'las ultimas 2 horas'); 'hour' = por hora (hasta 48 horas); 'day' = por dia (ventanas largas); 'month' = por mes, IDEAL para '¿cual fue el mes mas costoso?' y analisis historicos (usa days hasta 3660 para cubrir todo el historial); 'raw' = lecturas crudas individuales, SOLO si el cliente las pide explicitamente (nunca para graficas ni totales). Incluye hours_with_data y ep_resets por bucket: un bucket con hours_with_data menor a lo esperado esta INCOMPLETO (mes parcial), aclaralo al cliente y no lo compares de igual a igual.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          point_id: { type: "integer", description: "Punto de medicion especifico (opcional, de latest_metrics o enterprise_info)" },
          days: { type: "integer", description: "Dias hacia atras (1-3660, por defecto 30)" },
          granularity: {
            type: "string",
            enum: ["hour", "day", "raw"],
            description: "day = promedio diario (rangos amplios, meses); hour = promedio por hora (detalle fino); raw = lecturas crudas mas recientes",
          },
          limit: { type: "integer", description: "Maximo de filas (1-500, por defecto 60)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "active_alerts",
      description:
        "Alertas registradas (umbrales superados) para una empresa en un periodo, ordenadas por fecha mas reciente.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          days: { type: "integer", description: "Dias hacia atras (1-90, por defecto 7)" },
          status: { type: "string", description: "Estado de la alerta: NEW / ACKNOWLEDGED / RESOLVED (opcional)" },
          limit: { type: "integer", description: "Maximo de alertas a devolver (1-50, por defecto 20)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "alert_summary",
      description:
        "Resumen de alertas por tipo y estado para una empresa en un periodo (conteos).",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          days: { type: "integer", description: "Dias hacia atras (1-90, por defecto 7)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "data_coverage",
      description:
        "Rango de fechas de los registros de lecturas (primera y ultima lectura) de una empresa, o de un punto especifico. OBLIGATORIA para preguntas sobre disponibilidad de datos: 'desde cuando hay registros', 'hasta que fecha llegan los datos'. Nunca inventes ni supongas fechas.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          point_id: {
            type: "integer",
            description: "Punto de medicion especifico (opcional, de latest_metrics o enterprise_info)",
          },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_points",
      description:
        "Compara de 2 a 8 puntos de medicion (del mismo tablero o de tableros distintos) en un periodo: energia integrada en kWh, potencia media y pico en kW, horas con datos y ep_resets, por punto. Devuelve panel_name y hq_name de cada punto para comparaciones cruzadas. Ideal para 'compara X vs Y'.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          point_ids: {
            type: "array",
            items: { type: "integer" },
            description: "Ids de los puntos a comparar (2-8, de enterprise_info o latest_metrics)",
          },
          days: { type: "integer", description: "Dias hacia atras (1-90, por defecto 7)" },
        },
        required: ["enterprise_id", "point_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "panel_breakdown",
      description:
        "Desglose de consumo por punto para toda la sede o un tablero especifico: energia kWh por punto, share_pct (porcentaje que representa cada punto del total del alcance) y scope_total_kwh. OJO: puede incluir puntos agregadores (llaves generales, is_main) que ya contienen el consumo de otros puntos: excluyelos de las proporciones y aclaralo si el cliente los incluye.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          panel_id: { type: "integer", description: "Id del tablero (de enterprise_info). Opcional: sin el, desglosa toda la sede" },
          days: { type: "integer", description: "Dias hacia atras (1-90, por defecto 7)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cost_analysis",
      description:
        "Costo en dinero del consumo energetico por sede, usando la tarifa activa de la base de datos: desglose energia (kWh), demanda pico (kW), energia reactiva penalizada (kvarh), cargo fijo y total en la moneda de la tarifa. Incluye costo por punto de medicion (campo points, ya calculado) y proyeccion al ciclo de facturacion actual (campo cycle). OBLIGATORIA para preguntas de dinero: costo, gasto, factura, ahorro, soles/dolares.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          days: { type: "integer", description: "Dias hacia atras (1-90, por defecto 30)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_periods",
      description:
        "Compara el consumo energetico de dos ventanas consecutivas (ej. este mes vs el anterior) por punto de medicion: energy_current, energy_previous y delta_pct ya calculados. Las ventanas se anclan a la ULTIMA LECTURA disponible, no a la fecha de hoy: reporta las fechas exactas de las ventanas que devuelve la herramienta. Ideal para 'gaste mas o menos que el mes anterior'.",
      parameters: {
        type: "object",
        properties: {
          enterprise_id: { type: "integer", description: "Id de la empresa (de list_enterprises)" },
          point_id: { type: "integer", description: "Punto de medicion especifico (opcional)" },
          panel_id: { type: "integer", description: "Tablero especifico (opcional, de enterprise_info)" },
          days: { type: "integer", description: "Dias de cada ventana (1-90, por defecto 30)" },
        },
        required: ["enterprise_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "render_dashboard",
      description:
        "OBLIGATORIO en TODA respuesta que haya consultado datos, incluidas preguntas estructurales (tableros, puntos, sedes). Construye el dashboard con el catalogo de cards: kpi, share, ranking, trend, table, context, structure (jerarquia tableros->puntos), insights (analisis del asistente). REGLAS: (1) todo valor numerico lleva SIEMPRE su unidad (kpi/share/ranking/trend usan unit; context y table incluyen la unidad en el texto o el encabezado de columna); (2) agrega SIEMPRE una card insights al final con 1-5 frases de analisis relevante basado EXCLUSIVAMENTE en los datos obtenidos (anomalias, comparaciones, advertencias, recomendaciones); (3) usa exclusivamente numeros devueltos por las herramientas, lo unico calculable son diferencias y porcentajes; NUNCA uses 0 ni tarifas inventadas si una herramienta no devolvio datos; (4) PARIDAD ESTRICTA: todo punto, porcentaje o dato que menciones en el texto debe tener su card (mencionas top consumidores -> ranking; mencionas porcentajes -> share/ranking; mencionas desglose -> table); (5) DENSIDAD: la pantalla no debe quedar vacia, agrega ranking/table/share que llenen (minimo 5 cards con datos, hasta 10).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titulo corto del dashboard (la consulta del cliente)" },
          subtitle: { type: "string", description: "Periodo o alcance, ej: 'Ultimos 7 dias'" },
          cards: {
            type: "array",
            description: "3 a 10 cards. Catalogo: kpi (valor grande + unit), share (participacion %), ranking (comparacion ordenada), trend (evolucion temporal), table (detalle por filas, unidades en el encabezado de columna), context (sede, tablero, ultima lectura, periodo), structure (jerarquia tablero->puntos: items [{label: tablero, value: ej '9 puntos activos', points: [nombres de puntos]}]), insights (analisis del asistente: items = frases).",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["kpi", "share", "ranking", "trend", "table", "context", "structure", "insights"],
                },
                title: { type: "string" },
                group: { type: "string", description: "Seccion: cards con el mismo group se muestran juntas bajo un titulo comun (ej: 'Alertas mas importantes' para 3 kpi de alertas)" },
                unit: { type: "string", description: "kWh, kW, V, A, %, USD/MWh, Hz... OBLIGATORIA en cards numericas" },
                value: { type: "number", description: "solo kpi" },
                note: { type: "string", description: "solo kpi" },
                delta: {
                  type: "object",
                  description: "solo kpi: variacion vs periodo anterior",
                  properties: {
                    value: { type: "number" },
                    label: { type: "string" },
                  },
                },
                items: {
                  type: "array",
                  description: "share/ranking: [{label, value numerico}]; context: [{label, value}]; structure: [{label: tablero, value: descripcion con unidades, points: [puntos]}]; insights: [{value: frase}] (o strings)",
                  properties: {
                    label: { type: "string" },
                    value: { type: "string" },
                    points: { type: "array", items: { type: "string" }, description: "solo structure: puntos de monitoreo del tablero" },
                  },
                },
                points: {
                  type: "array",
                  description: "solo trend: [{t: fecha/etiqueta, v: numero}], max 60",
                  properties: {
                    t: { type: "string" },
                    v: { type: "number" },
                  },
                },
                columns: { type: "array", description: "solo table, con unidad ej 'Consumo (kWh)'", items: { type: "string" } },
                rows: { type: "array", description: "solo table", items: { type: "array", items: { type: "string" } } },
              },
              required: ["type", "title"],
            },
          },
        },
        required: ["title", "cards"],
      },
    },
  },
] satisfies OpenAI.Chat.Completions.ChatCompletionTool[];

const executors: Record<
  string,
  (args: ToolArgs, scope: Set<number> | null, collector: RunCollector) => Promise<unknown>
> = {
  async list_enterprises(args, scope) {
    const rows = await listEnterprises();
    const scoped = scope
      ? rows.filter((r) => scope.has(Number((r as { id: number }).id)))
      : rows;
    if (scoped.length === 0)
      return { error: "No hay empresas permitidas para este cliente." };
    return scoped;
  },

  async enterprise_info(args, scope, collector) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const info = await enterpriseInfo(id);
    const panels = new Map<string, string[]>();
    const panelDisplay = new Map<string, string>();
    const pointDisplay = new Map<string, string>();
    const points = new Set<string>();
    for (const p of (info.points ?? []) as Array<{ panel_name?: string; name?: string; is_active?: boolean }>) {
      const pointName = String(p.name ?? "").toLowerCase().trim();
      if (pointName) {
        points.add(pointName);
        pointDisplay.set(pointName, String(p.name ?? "").trim());
      }
      const panelName = String(p.panel_name ?? "").toLowerCase().trim();
      if (!panelName) continue;
      if (!panels.has(panelName)) {
        panels.set(panelName, []);
        panelDisplay.set(panelName, String(p.panel_name ?? "").trim());
      }
      if (p.is_active && pointName) panels.get(panelName)!.push(pointName);
    }
    collector.structure = { panels, panelDisplay, pointDisplay, points };
    return info;
  },

  async latest_metrics(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const limit = toNumber(args.limit) ?? 10;
    const rows = await latestMetrics(id, limit);
    return rows.length > 0 ? rows : emptyWithFreshness(id);
  },

  async energy_consumption(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const days = toNumber(args.days) ?? 7;
    const limit = toNumber(args.limit) ?? 20;
    const rows = await energyConsumption(id, days, limit);
    const withData = rows.filter((r) => Number(r.hours_with_data) > 0);
    return withData.length > 0 ? rows : emptyWithFreshness(id);
  },

  async reading_history(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const pointId = toNumber(args.point_id);
    const days = toNumber(args.days) ?? 30;
    const limit = toNumber(args.limit) ?? 60;
    const granularity =
      args.granularity === "hour" ||
      args.granularity === "day" ||
      args.granularity === "raw" ||
      args.granularity === "minute" ||
      args.granularity === "month"
        ? args.granularity
        : "hour";
    const rows = await readingHistory(id, { pointId, days, granularity, limit });
    return rows.length > 0 ? rows : emptyWithFreshness(id, pointId);
  },

  async compare_points(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const rawIds = Array.isArray(args.point_ids) ? args.point_ids : [];
    const pointIds = rawIds
      .map((v) => toNumber(v))
      .filter((v): v is number => v != null)
      .slice(0, 8);
    if (pointIds.length < 2)
      return { error: "point_ids requiere al menos 2 puntos (maximo 8)." };
    const days = toNumber(args.days) ?? 7;
    const rows = await comparePoints(id, pointIds, days);
    const withData = rows.filter((r) => Number((r as Record<string, unknown>).hours_with_data) > 0);
    return withData.length > 0 ? rows : emptyWithFreshness(id, pointIds[0]);
  },

  async panel_breakdown(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const panelId = toNumber(args.panel_id);
    let validPanels: Array<Record<string, unknown>> | null = null;
    if (panelId != null) {
      validPanels = (await listPanels(id)) as Array<Record<string, unknown>>;
      if (!validPanels.some((p) => Number(p.id) === panelId))
        return {
          error: `panel_id ${panelId} no pertenece a esta empresa o no existe. Tableros validos: ${JSON.stringify(
            validPanels.map((p) => ({ id: Number(p.id), name: p.name }))
          )}. Usa uno de esos ids (salen de enterprise_info, campo panel_id).`,
        };
    }
    const days = toNumber(args.days) ?? 7;
    const rows = await panelBreakdown(id, panelId, days);
    const withData = rows.filter((r) => Number((r as Record<string, unknown>).hours_with_data) > 0);
    return withData.length > 0 ? rows : emptyWithFreshness(id);
  },

  async active_alerts(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const days = toNumber(args.days) ?? 7;
    const limit = toNumber(args.limit) ?? 20;
    const status = typeof args.status === "string" ? args.status : null;
    const rows = await activeAlerts(id, days, status, limit);
    return rows.length > 0 ? rows : emptyWithFreshness(id);
  },

  async alert_summary(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const days = toNumber(args.days) ?? 7;
    const rows = await alertSummary(id, days);
    return rows.length > 0 ? rows : emptyWithFreshness(id);
  },

  async data_coverage(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const pointId = toNumber(args.point_id);
    const cov = await dataCoverage(id, pointId);
    if (pointId != null && cov.first_reading == null && cov.last_reading == null) {
      const validPoints = (await listPoints(id)) as Array<Record<string, unknown>>;
      return {
        error: `El punto ${pointId} no pertenece a esta empresa o no tiene lecturas. Puntos validos: ${JSON.stringify(
          validPoints.slice(0, 50).map((p) => ({ id: Number(p.id), name: p.name, activo: p.is_active }))
        )}. Resuelve el id desde enterprise_info o usa uno de esta lista.`,
      };
    }
    return cov;
  },

  async cost_analysis(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const days = toNumber(args.days) ?? 30;
    const results = await costAnalysis(id, days);
    const withData = results.filter((r) => r.hours_with_data > 0);
    if (withData.length === 0) return emptyWithFreshness(id);
    return { results: withData };
  },

  async compare_periods(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const pointId = toNumber(args.point_id);
    const panelId = toNumber(args.panel_id);
    const days = Math.min(90, Math.max(1, toNumber(args.days) ?? 30));
    const cov = await dataCoverage(id, pointId);
    if (!cov.last_reading) return emptyWithFreshness(id, pointId);
    const last = new Date(cov.last_reading);
    const endCurrent = last;
    const startCurrent = new Date(last.getTime() - days * 86400000);
    const endPrevious = startCurrent;
    const startPrevious = new Date(startCurrent.getTime() - days * 86400000);
    const rows = await comparePeriods(id, {
      pointId,
      panelId,
      startCurrent,
      endCurrent,
      startPrevious,
      endPrevious,
    });
    const withData = rows.filter(
      (r) => (r.energy_current ?? 0) > 0 || (r.energy_previous ?? 0) > 0
    );
    if (withData.length === 0) return emptyWithFreshness(id, pointId);
    return {
      windows: {
        current: { start: startCurrent.toISOString(), end: endCurrent.toISOString() },
        previous: { start: startPrevious.toISOString(), end: endPrevious.toISOString() },
      },
      rows: withData,
    };
  },

  async render_dashboard(args, _scope, collector) {
    const NUMERIC_CARD_TYPES = new Set(["kpi", "share", "ranking", "trend", "table"]);
    const rawCards = Array.isArray((args as { cards?: unknown }).cards)
      ? ((args as { cards: unknown[] }).cards as Array<Record<string, unknown>>)
      : [];
    const hasNumericCards = rawCards.some((c) => NUMERIC_CARD_TYPES.has(String(c.type)));
    if (!collector.numericDataSeen && hasNumericCards) {
      collector.lastDashboardError =
        "No obtuviste datos numericos de las herramientas en esta conversacion (o solo devolvieron aviso de datos desactualizados). NO puedes mostrar kpi/share/ranking/trend/table: los numeros serian inventados. Usa cards context, structure o insights (solo texto real obtenido) y explica en el texto que no hay datos recientes.";
      return { error: collector.lastDashboardError };
    }
    if (collector.structure) {
      const idx = rawCards.findIndex((c) => String(c.type) === "structure");
      if (idx >= 0) {
        const canonical = {
          type: "structure",
          title: "Tableros y puntos de monitoreo",
          items: [...collector.structure.panels.entries()]
            .map(([lower, pts]) => ({
              label: collector.structure!.panelDisplay.get(lower) ?? lower,
              value: `${pts.length} puntos de monitoreo activos`,
              points: pts.map((p) => collector.structure!.pointDisplay.get(p) ?? p),
            }))
            .sort((a, b) => b.points.length - a.points.length),
        };
        rawCards[idx] = canonical;
      }
    } else if (rawCards.some((c) => String(c.type) === "structure")) {
      collector.lastDashboardError =
        "Para mostrar la jerarquia de tableros y puntos debes llamar primero enterprise_info: la estructura se construye con datos de la base, no se inventa.";
      return { error: collector.lastDashboardError };
    }
    const hasInsights = rawCards.some((c) => String(c.type) === "insights");
    if (!hasInsights) {
      const items: string[] = [];
      if (collector.structure) {
        const panelCount = collector.structure.panels.size;
        const totalActive = [...collector.structure.panels.values()].reduce((a, v) => a + v.length, 0);
        const biggest = [...collector.structure.panels.entries()].sort((a, b) => b[1].length - a[1].length)[0];
        const bigName = biggest ? collector.structure.panelDisplay.get(biggest[0]) ?? biggest[0] : null;
        items.push(`Se monitorean ${totalActive} puntos de medicion activos distribuidos en ${panelCount} tableros.`);
        if (bigName) items.push(`El tablero con mas puntos activos es ${bigName} (${biggest![1].length} puntos).`);
      }
      if (collector.numericDataSeen)
        items.push("Los valores provienen directamente de las herramientas de consulta; el consumo se calcula integrando la potencia normalizada por hora, robusto ante reinicios del contador.");
      if (items.length > 0) {
        while (rawCards.length >= 10) rawCards.pop();
        rawCards.push({ type: "insights", title: "Analisis", items });
      }
    }
    const dashboard = validateDashboard(args);
    if (!dashboard) {
      collector.lastDashboardError =
        "Dashboard invalido. Revisa el catalogo: cards con type/title y datos numericos validos.";
      return { error: collector.lastDashboardError };
    }
    const PRIORITY: Record<string, number> = {
      kpi: 0, ranking: 1, trend: 1, share: 1, table: 2, structure: 3, context: 4, insights: 9,
    };
    dashboard.cards.sort(
      (a, b) => (PRIORITY[a.type] ?? 5) - (PRIORITY[b.type] ?? 5)
    );
    collector.lastDashboardError = null;
    collector.dashboard = dashboard;
    return "Dashboard aceptado.";
  },
};

export async function executeTool(
  name: string,
  args: ToolArgs,
  scope: Set<number> | null,
  collector: RunCollector = { dashboard: null, numericDataSeen: false, structure: null, lastDashboardError: null }
): Promise<unknown> {
  const fn = executors[name];
  if (!fn) return { error: `Herramienta desconocida: ${name}` };
  try {
    const result = await fn(args, scope, collector);
    const asObj = result as Record<string, unknown> | null;
    const rowsLen = Array.isArray(asObj?.rows) ? asObj!.rows.length : 0;
    const pointsLen = Array.isArray(asObj?.points) ? asObj!.points.length : 0;
    const resultsLen = Array.isArray(asObj?.results) ? asObj!.results.length : 0;
    const dataCount = Array.isArray(result) ? result.length : rowsLen + pointsLen + resultsLen;
    if (NUMERIC_TOOLS.includes(name as (typeof NUMERIC_TOOLS)[number]) && dataCount > 0)
      collector.numericDataSeen = true;
    if (process.env.DEBUG_TOOLS)
      console.log(
        `  [debug] ${name} args=${JSON.stringify(args).slice(0, 200)} -> ${JSON.stringify(result).slice(0, 300)}`
      );
    return result;
  } catch (err) {
    return { error: `Fallaron las consultas: ${String(err)}` };
  }
}
