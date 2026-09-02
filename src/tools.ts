import type { OpenAI } from "openai";
import { validateDashboard, type Dashboard } from "./dashboard";
import {
  activeAlerts,
  alertSummary,
  dataCoverage,
  energyConsumption,
  enterpriseInfo,
  latestMetrics,
  listEnterprises,
  readingHistory,
} from "./queries";

type ToolArgs = Record<string, unknown>;

export interface RunCollector {
  dashboard: Dashboard | null;
}

const toNumber = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
        "Ultimas lecturas de energia por punto de medicion (potencia, energia, tension, corriente, factor de potencia).",
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
        "Consumo de energia (kWh) por punto de medicion en un periodo. Se calcula como la diferencia del contador de energia activa (EPpos) entre la primera y ultima lectura del periodo. Solo para preguntas de consumo/ahorro.",
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
        "Historial de lecturas de energia de una empresa (o de un punto especifico): promedios por hora o por dia (potencia kW, tension Ua, corriente Ia, PF y contador EPpos kWh min/max) o registros crudos mas recientes. Para preguntas de evolucion, tendencias, historicos o picos de consumo.",
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
        "Rango de fechas de los registros de lecturas (primera y ultima lectura). OBLIGATORIA para preguntas sobre disponibilidad de datos: 'desde cuando hay registros', 'hasta que fecha llegan los datos'. Nunca inventes ni supongas fechas.",
      parameters: {
        type: "object",
        properties: {
          point_id: {
            type: "integer",
            description: "Punto de medicion especifico (opcional, de latest_metrics o enterprise_info)",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "render_dashboard",
      description:
        "Construye el dashboard visual con las cards del catalogo (kpi, share, ranking, trend, table, context). Debe llamarse UNA sola vez, al FINAL, solo si consultaste datos con otras herramientas. Usa exclusivamente numeros devueltos por las herramientas; lo unico que puedes calcular son diferencias y porcentajes entre esos numeros. Toda cantidad lleva unidad. PARIDAD: todo dato o conclusion que menciones en tu texto debe tener su card en el dashboard; no dejes informacion relevante solo en el texto.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titulo corto del dashboard (la consulta del cliente)" },
          subtitle: { type: "string", description: "Periodo o alcance, ej: 'Ultimos 7 dias'" },
          cards: {
            type: "array",
            description: "3 a 10 cards. Catalogo: kpi (un valor grande + unidad), share (participacion % por punto), ranking (comparacion ordenada), trend (evolucion temporal, puntos t/v), table (detalle por filas), context (dato del sujeto: sede, tablero, ultima lectura, periodo).",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["kpi", "share", "ranking", "trend", "table", "context"],
                },
                title: { type: "string" },
                group: { type: "string", description: "Seccion: cards con el mismo group se muestran juntas bajo un titulo comun (ej: 'Alertas mas importantes' para 3 kpi de alertas)" },
                unit: { type: "string", description: "kWh, kW, V, A, %, Hz..." },
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
                  description: "share/ranking/context: [{label, value}]",
                  properties: {
                    label: { type: "string" },
                    value: { type: "string" },
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
                columns: { type: "array", description: "solo table", items: { type: "string" } },
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

  async enterprise_info(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    return enterpriseInfo(id);
  },

  async latest_metrics(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const limit = toNumber(args.limit) ?? 10;
    return latestMetrics(id, limit);
  },

  async energy_consumption(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const days = toNumber(args.days) ?? 7;
    const limit = toNumber(args.limit) ?? 20;
    return energyConsumption(id, days, limit);
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
      args.granularity === "hour" || args.granularity === "day" || args.granularity === "raw"
        ? args.granularity
        : "hour";
    return readingHistory(id, { pointId, days, granularity, limit });
  },

  async active_alerts(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const days = toNumber(args.days) ?? 7;
    const limit = toNumber(args.limit) ?? 20;
    const status = typeof args.status === "string" ? args.status : null;
    return activeAlerts(id, days, status, limit);
  },

  async alert_summary(args, scope) {
    const id = toNumber(args.enterprise_id);
    if (id == null) return { error: "enterprise_id invalido." };
    if (scope && !scope.has(id))
      return { error: "No tienes permiso para esa empresa." };
    const days = toNumber(args.days) ?? 7;
    return alertSummary(id, days);
  },

  async data_coverage(args) {
    const pointId = toNumber(args.point_id);
    return dataCoverage(pointId);
  },

  async render_dashboard(args, _scope, collector) {
    const dashboard = validateDashboard(args);
    if (!dashboard)
      return {
        error:
          "Dashboard invalido. Revisa el catalogo: cards con type/title y datos numericos validos.",
      };
    collector.dashboard = dashboard;
    return "Dashboard aceptado.";
  },
};

export async function executeTool(
  name: string,
  args: ToolArgs,
  scope: Set<number> | null,
  collector: RunCollector = { dashboard: null }
): Promise<unknown> {
  const fn = executors[name];
  if (!fn) return { error: `Herramienta desconocida: ${name}` };
  try {
    return await fn(args, scope, collector);
  } catch (err) {
    return { error: `Fallaron las consultas: ${String(err)}` };
  }
}
