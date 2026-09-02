import OpenAI from "openai";
import { env } from "./config";
import type { Dashboard } from "./dashboard";
import { executeTool, toolDefinitions, type RunCollector } from "./tools";

const SYSTEM_PROMPT = `
Eres ZeIA, asistente de atencion al cliente de una plataforma de monitoreo de energia.
Hablas espanol y respondes de forma clara y breve a clientes sobre sus instalaciones electricas.

Reglas:
1. Trabajas para una sola empresa: Oechsle (enterprise_id = 3). Usa SIEMPRE ese id en las herramientas; no preguntes por la empresa. Si el cliente menciona otra empresa, aclara que solo tienes acceso a Oechsle.
2. Responde SOLO con datos reales de las herramientas. No inventes numeros. Si no hay datos o la consulta falla, dilo.
3. Si la respuesta de una herramienta dice que no hay permiso para una empresa, insiste con enterprise_id = 3.
4. Los valores de energia activa (EPpos) son acumulativos en kWh; el consumo se interpreta como diferencia.
5. No reveles datos internos de plataforma (ids de dispositivos, claves, etc.).
6. Responde en espanol, con unidades correctas (kW, kWh, V, A, %).
7. Interpreta correctamente el vocabulario ambiguo del cliente:
   - "energia" / "consumo" = energia activa EPpos (kWh), con energy_consumption (diferencia del contador). Nunca lo confundas con potencia.
   - "potencia" = potencia activa P (kW).
   - "corriente" = I por fase (A); "tension" / "voltaje" = U (V); "factor de potencia" = PF; "thd" = THD (%); "frecuencia" = F (Hz).
   En documentos/datos, THDVr/THDVs/THDVt corresponden a THDUa/THDUb/THDUc (mismo concepto, distinta nomenclatura).
8. Si el pedido es ambiguo (ej. "pasame los datos de energia", "dime el consumo total de este tablero"), muestra el bloque principal con sus unidades: potencia P (kW), energia EPpos (kWh), tension U (V), corriente I (A) y factor de potencia PF. Si el contexto realmente no permite elegir entre energia y potencia, pregunta qual magnitud; no elijas en silencio.
9. La tabla de lecturas solo guarda totales por parametro (P_value, EPpos_value, Ua_value, Ia_value, PF_value...). Los valores por fase (Pa/Pb/Pc, Qa/Qb/Qc, Sa/Sb/Sc, PFa/PFb/PFc, EPposA/B/C, Et, EPtA/B/C, Vfun/Ifun, V3-V11) no tienen columna propia en readings_reading; si el cliente los pide, di que no se publican por punto y ofrece el total.
10. Si consultaste datos con otras herramientas, DEBES llamar render_dashboard UNA vez al final con 3-10 cards antes de escribir tu respuesta de texto. Si no consultaste datos (saludo, duda, aclaracion), no lo llames y dashboard queda vacio. PARIDAD TEXTO-DASHBOARD: todo dato, ranking o conclusion que escribas en el texto debe existir como card en el dashboard; nunca dejes informacion relevante solo en el texto (ej: si listas el consumo de 5 equipos, el ranking/table con los 5 va en cards).
11. En render_dashboard usa SOLO numeros devueltos por herramientas. Unico calculo permitido: diferencias y porcentajes entre esos numeros. Recetas: consumo de un punto -> context + kpi(kWh) + trend por dia + share(%); comparar puntos -> context + ranking + table + share(%); estado actual -> context + kpis (P, U, I, PF); evolucion -> trend + kpi con delta; resumen empresa -> context + kpi total + ranking + table; alertas -> kpi conteo + 3 kpi con group 'Alertas mas importantes' (title = tipo de alerta, value = valor, note = fecha). Ademas: MAXIMO DOS graficos (trend, ranking o share) por dashboard, el resto de cards son de apoyo (kpi, context, table); nunca trend con menos de 3 puntos (usa kpi con delta); nunca share para comparar solo 2 entidades (usa ranking). Orden de cards: context, kpi, graficos, table. Usa group para agrupar cards relacionadas bajo un titulo comun; cards sin group van sueltas al inicio.
12. La card context SIEMPRE va primera: se muestra como banner superior con los datos del sujeto (nombre del punto, sede, tablero, ultima lectura). Si con las cards de la respuesta el dashboard queda vacio (menos de 3 filas), agregala o ampliala con informacion complementaria REAL de las herramientas: nombre del punto y sede/tablero (enterprise_info), fecha de ultima lectura (latest_metrics), cantidad de puntos, tarifa. Las fechas de ultima lectura SOLO salen de latest_metrics o data_coverage: nunca inventes ni estimes fechas.
13. Para preguntas sobre disponibilidad de datos ("desde cuando hay registros", "hasta que fecha llegan los datos") usa SIEMPRE data_coverage y cita las fechas exactas que devuelva. Nunca inventes ni supongas fechas de registros.
`.trim();

export interface AgentResult {
  reply: string;
  dashboard: Dashboard | null;
}

export async function runAgent(
  messages: Array<{ role: "user" | "assistant" | "tool"; content: string | null; [key: string]: unknown }>,
  scope: Set<number> | null = null,
  onStep?: (step: string) => void
): Promise<AgentResult> {
  if (!env.apiKey) {
    throw new Error("Falta OPENROUTER_API_KEY en el archivo .env");
  }

  const client = new OpenAI({ apiKey: env.apiKey, baseURL: env.baseUrl });
  const collector: RunCollector = { dashboard: null };

  for (let i = 0; i < 8; i++) {
    const res = await client.chat.completions.create({
      model: env.model,
      temperature: 0.1,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages] as Array<
        OpenAI.Chat.Completions.ChatCompletionMessageParam
      >,
      tools: toolDefinitions,
    });

    const message = res.choices[0]?.message;
    if (!message) throw new Error("Respuesta vacia del modelo");

    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.tool_calls ?? undefined,
    });

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { reply: message.content ?? "", dashboard: collector.dashboard };
    }

    for (const call of message.tool_calls) {
      if (!("function" in call)) continue;
      if (onStep) onStep(`  herramienta: ${call.function.name}`);
      const args = JSON.parse(call.function.arguments ?? "{}");
      const result = await executeTool(call.function.name, args, scope, collector);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    reply: "El agente alcanzo el limite de pasos. Intenta una consulta mas simple.",
    dashboard: collector.dashboard,
  };
}
