export const ELECTRIC_PARAMETERS = {
  Ua: { parameter: "Voltaje de fase R", unit: "V" },
  Ub: { parameter: "Voltaje de fase S", unit: "V" },
  Uc: { parameter: "Voltaje de fase T", unit: "V" },
  Uab: { parameter: "Voltaje entre RS", unit: "V" },
  Ubc: { parameter: "Voltaje entre ST", unit: "V" },
  Uac: { parameter: "Voltaje entre RT", unit: "V" },

  Ia: { parameter: "Corriente de la fase R", unit: "A" },
  Ib: { parameter: "Corriente de la fase S", unit: "A" },
  Ic: { parameter: "Corriente de la fase T", unit: "A" },
  In: { parameter: "Vector suma de las fases", unit: "A" },

  Pa: { parameter: "Potencia activa de la fase R", unit: "KW" },
  Pb: { parameter: "Potencia activa de la fase S", unit: "KW" },
  Pc: { parameter: "Potencia activa de la fase T", unit: "KW" },
  P: { parameter: "Potencia activa total", unit: "KW" },

  Qa: { parameter: "Potencia reactiva de la fase R", unit: "KVar" },
  Qb: { parameter: "Potencia reactiva de la fase S", unit: "KVar" },
  Qc: { parameter: "Potencia reactiva de la fase T", unit: "KVar" },
  Q: { parameter: "Potencia reactiva total", unit: "KVar" },
  Sa: { parameter: "Potencia aparente de la fase R", unit: "KVA" },
  Sb: { parameter: "Potencia aparente de la fase S", unit: "KVA" },
  Sc: { parameter: "Potencia aparente de la fase T", unit: "KVA" },
  S: { parameter: "Potencia aparente total", unit: "KVA" },
  PFa: { parameter: "Factor de potencia de la fase R", unit: "-" },
  PFb: { parameter: "Factor de potencia de la fase S", unit: "-" },
  PFc: { parameter: "Factor de potencia de la fase T", unit: "-" },
  PF: { parameter: "Factor de potencia total", unit: "-" },
  F: { parameter: "Frecuencia", unit: "Hz" },

  Et: { parameter: "Consumo total de energía", unit: "KWh" },
  EPtA: { parameter: "Consumo total de energía en la fase R", unit: "KWh" },
  EPtB: { parameter: "Consumo total de energía en la fase S", unit: "KWh" },
  EPtC: { parameter: "Consumo total de energía en la fase T", unit: "KWh" },

  THDVr: {
    parameter: "Distorsión armónica total en voltaje de la fase R",
    unit: "%",
  },
  THDVs: {
    parameter: "Distorsión armónica total en voltaje de la fase S",
    unit: "%",
  },
  THDVt: {
    parameter: "Distorsión armónica total en voltaje de la fase T",
    unit: "%",
  },

  THDIr: {
    parameter: "Distorsión armónica total en corriente de la fase R",
    unit: "%",
  },
  THDIs: {
    parameter: "Distorsión armónica total en corriente de la fase S",
    unit: "%",
  },
  THDIt: {
    parameter: "Distorsión armónica total en corriente de la fase T",
    unit: "%",
  },

  EPpos: { parameter: "Energía activa consumida", unit: "KWh" },
  EPneg: { parameter: "Energía activa generada", unit: "KWh" },
  EQpos: {
    parameter: "Energía reactiva inductiva",
    unit: "KVarh",
  },
  EQneg: { parameter: "Energía reactiva capacitiva", unit: "KVarh" },
  EPposA: {
    parameter: "Consumo de energía activa en la fase R",
    unit: "KWh",
  },
  EPnegA: {
    parameter: "Consumo de energía activa en la fase R",
    unit: "KWh",
  },
  EQposA: {
    parameter: "Consumo de energía reactiva en la fase R",
    unit: "KVarh",
  },
  EQnegA: {
    parameter: "Consumo de energía reactiva en la fase R",
    unit: "KVarh",
  },
  EPposB: {
    parameter: "Consumo de energía activa en la fase S",
    unit: "KWh",
  },
  EPnegB: {
    parameter: "Consumo de energía activa en la fase S",
    unit: "KWh",
  },
  EQposB: {
    parameter: "Consumo de energía reactiva en la fase S",
    unit: "KVarh",
  },
  EQnegB: {
    parameter: "Consumo de energía reactiva en la fase S",
    unit: "KVarh",
  },
  EPposC: {
    parameter: "Consumo de energía activa en la fase T",
    unit: "KWh",
  },
  EPnegC: {
    parameter: "Consumo de energía activa en la fase T",
    unit: "KWh",
  },
  EQposC: {
    parameter: "Consumo de energía reactiva en la fase T",
    unit: "KVarh",
  },
  EQnegC: {
    parameter: "Consumo de energía reactiva en la fase T",
    unit: "KVarh",
  },
  VfunA: { parameter: "Voltaje fundamental en la fase R", unit: "V" },
  VfunB: { parameter: "Voltaje fundamental en la fase S", unit: "V" },
  VfunC: { parameter: "Voltaje fundamental en la fase T", unit: "V" },
  IfunA: { parameter: "Corriente fundamental en la fase R", unit: "A" },
  IfunB: { parameter: "Corriente fundamental en la fase S", unit: "A" },
  IfunC: { parameter: "Corriente fundamental en la fase T", unit: "A" },
  V3A: { parameter: "Tercer armonico en voltaje de la fase R", unit: "%" },
  V5A: { parameter: "Quinto armonico en voltaje de la fase R", unit: "%" },
  V7A: { parameter: "Septimo armonico en voltaje de la fase R", unit: "%" },
  V9A: { parameter: "Noveno armonico en voltaje de la fase R", unit: "%" },
  V11A: { parameter: "Undecimo armonico en voltaje de la fase R", unit: "%" },
  V3B: { parameter: "Tercer armonico en voltaje de la fase S", unit: "%" },
  V5B: { parameter: "Quinto armonico en voltaje de la fase S", unit: "%" },
  V7B: { parameter: "Septimo armonico en voltaje de la fase S", unit: "%" },
  V9B: { parameter: "Noveno armonico en voltaje de la fase S", unit: "%" },
  V11B: { parameter: "Undecimo armonico en voltaje de la fase S", unit: "%" },
  V3C: { parameter: "Tercer armonico en voltaje de la fase T", unit: "%" },
  V5C: { parameter: "Quinto armonico en voltaje de la fase T", unit: "%" },
  V7C: { parameter: "Septimo armonico en voltaje de la fase T", unit: "%" },
  V9C: { parameter: "Noveno armonico en voltaje de la fase T", unit: "%" },
  V11C: { parameter: "Undecimo armonico en voltaje de la fase T", unit: "%" },
} as const;

export const READINGS_READING_MAP = {
  Ua: { column: "Ua_value", parameter: "Voltaje de fase R", unit: "V" },
  Ub: { column: "Ub_value", parameter: "Voltaje de fase S", unit: "V" },
  Uc: { column: "Uc_value", parameter: "Voltaje de fase T", unit: "V" },
  Uab: { column: "Uab_value", parameter: "Voltaje entre RS", unit: "V" },
  Ubc: { column: "Ubc_value", parameter: "Voltaje entre ST", unit: "V" },
  Uac: { column: "Uac_value", parameter: "Voltaje entre RT", unit: "V" },
  Ia: { column: "Ia_value", parameter: "Corriente de la fase R", unit: "A" },
  Ib: { column: "Ib_value", parameter: "Corriente de la fase S", unit: "A" },
  Ic: { column: "Ic_value", parameter: "Corriente de la fase T", unit: "A" },
  In: { column: "In_value", parameter: "Vector suma de las fases", unit: "A" },
  P: { column: "P_value", parameter: "Potencia activa total", unit: "KW" },
  Q: { column: "Q_value", parameter: "Potencia reactiva total", unit: "KVar" },
  S: { column: "S_value", parameter: "Potencia aparente total", unit: "KVA" },
  PF: { column: "PF_value", parameter: "Factor de potencia total", unit: "-" },
  F: { column: "F_value", parameter: "Frecuencia", unit: "Hz" },
  EPpos: {
    column: "EPpos_value",
    parameter: "Energía activa consumida",
    unit: "KWh",
  },
  EPneg: {
    column: "EPneg_value",
    parameter: "Energía activa generada",
    unit: "KWh",
  },
  EQpos: {
    column: "EQpos_value",
    parameter: "Energía reactiva inductiva",
    unit: "KVarh",
  },
  EQneg: {
    column: "EQneg_value",
    parameter: "Energía reactiva capacitiva",
    unit: "KVarh",
  },
  THDVr: {
    column: "THDUa_value",
    parameter: "Distorsión armónica total en voltaje de la fase R",
    unit: "%",
  },
  THDVs: {
    column: "THDUb_value",
    parameter: "Distorsión armónica total en voltaje de la fase S",
    unit: "%",
  },
  THDVt: {
    column: "THDUc_value",
    parameter: "Distorsión armónica total en voltaje de la fase T",
    unit: "%",
  },
  THDIr: {
    column: "THDIa_value",
    parameter: "Distorsión armónica total en corriente de la fase R",
    unit: "%",
  },
  THDIs: {
    column: "THDIb_value",
    parameter: "Distorsión armónica total en corriente de la fase S",
    unit: "%",
  },
  THDIt: {
    column: "THDIc_value",
    parameter: "Distorsión armónica total en corriente de la fase T",
    unit: "%",
  },
} as const;

export const CLIENT_TERMS = {
  energia: {
    keys: ["EPpos", "EPneg"],
    columns: ["EPpos_value", "EPneg_value"],
    meaning:
      "Energía activa consumida/generada (kWh); EPpos es un contador acumulativo que puede reiniciarse",
    tool: "energy_consumption",
  },
  consumo: {
    keys: ["EPpos", "EPneg"],
    columns: ["EPpos_value", "EPneg_value"],
    meaning:
      "Energía activa (kWh); el consumo lo calcula energy_consumption integrando la potencia normalizada por hora (robusto ante reinicios del contador EPpos)",
    tool: "energy_consumption",
  },
  potencia: {
    keys: ["P"],
    columns: ["P_value"],
    meaning: "Potencia activa total (kW)",
    tool: "latest_metrics|reading_history",
  },
  corriente: {
    keys: ["Ia", "Ib", "Ic", "In"],
    columns: ["Ia_value", "Ib_value", "Ic_value", "In_value"],
    meaning: "Corriente por fase (A)",
    tool: "latest_metrics|reading_history",
  },
  tension: {
    keys: ["Ua", "Ub", "Uc", "Uab", "Ubc", "Uac"],
    columns: ["Ua_value", "Ub_value", "Uc_value", "Uab_value", "Ubc_value", "Uac_value"],
    meaning: "Voltaje de fase o entre fases (V)",
    tool: "latest_metrics|reading_history",
  },
  "factor de potencia": {
    keys: ["PF"],
    columns: ["PF_value"],
    meaning: "Factor de potencia total (-)",
    tool: "latest_metrics|reading_history",
  },
  thd: {
    keys: ["THDVr", "THDVs", "THDVt", "THDIr", "THDIs", "THDIt"],
    columns: ["THDUa_value", "THDUb_value", "THDUc_value", "THDIa_value", "THDIb_value", "THDIc_value"],
    meaning: "Distorsión armónica en voltaje/corriente (%)",
    tool: "latest_metrics|reading_history",
  },
  frecuencia: {
    keys: ["F"],
    columns: ["F_value"],
    meaning: "Frecuencia de red (Hz)",
    tool: "latest_metrics|reading_history",
  },
} as const;

export function agentDataNotes(): string {
  const vocab = Object.entries(CLIENT_TERMS)
    .map(([term, v]) => `"${term}" = ${v.keys.join("/")} (${v.meaning})`)
    .join("; ");

  const thd = Object.entries(READINGS_READING_MAP)
    .filter(([key]) => key.startsWith("THD"))
    .map(([key, v]) => `${key} = ${v.column.replace("_value", "")}`)
    .join(", ");

  const unmapped = Object.keys(ELECTRIC_PARAMETERS).filter(
    (key) => !(key in READINGS_READING_MAP)
  );

  return [
    `Vocabulario del cliente -> parametros: ${vocab}.`,
    `Equivalencias web = BD: ${thd}. Las fases de la BD a/b/c se muestran al cliente como R/S/T (a=R, b=S, c=T); nunca inventes otra equivalencia.`,
    `Parametros sin dato por punto en la BD (si el cliente los pide, aclara que no se publican y ofrece el total): ${unmapped.join(", ")}.`,
  ].join(" ");
}
