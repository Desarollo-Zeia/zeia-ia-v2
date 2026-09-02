export type Card =
  | { type: "kpi"; title: string; value: number; unit: string; note?: string; group?: string; delta?: { value: number; label?: string } }
  | { type: "share"; title: string; unit: string; group?: string; items: Array<{ label: string; value: number }> }
  | { type: "ranking"; title: string; unit: string; group?: string; items: Array<{ label: string; value: number }> }
  | { type: "trend"; title: string; unit: string; group?: string; points: Array<{ t: string; v: number }> }
  | { type: "table"; title: string; group?: string; columns: string[]; rows: string[][] }
  | { type: "context"; title: string; group?: string; items: Array<{ label: string; value: string }> };

export interface Dashboard {
  title: string;
  subtitle?: string;
  cards: Card[];
}

const MAX_CARDS = 10;
const MAX_ITEMS = 8;
const MAX_POINTS = 60;
const MAX_COLUMNS = 6;
const MAX_ROWS = 12;
const MAX_CONTEXT = 6;

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim().slice(0, 200) : "";

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const strArray = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v.slice(0, max).map((x) => str(x)).filter(Boolean)
    : [];

const itemArray = (
  v: unknown,
  max: number
): Array<{ label: string; value: number }> => {
  if (!Array.isArray(v)) return [];
  const out: Array<{ label: string; value: number }> = [];
  for (const raw of v.slice(0, max)) {
    if (raw == null || typeof raw !== "object") continue;
    const label = str((raw as Record<string, unknown>).label);
    const value = num((raw as Record<string, unknown>).value);
    if (!label || value == null) continue;
    out.push({ label, value });
  }
  return out;
};

function validateCard(raw: unknown): Card | null {
  if (raw == null || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const title = str(c.title) || "—";
  const group = str(c.group) || undefined;

  switch (c.type) {
    case "kpi": {
      const value = num(c.value);
      const unit = str(c.unit);
      if (value == null) return null;
      const deltaRaw = c.delta as Record<string, unknown> | undefined;
      const deltaValue = deltaRaw ? num(deltaRaw.value) : null;
      return {
        type: "kpi",
        title,
        group,
        value,
        unit,
        note: str(c.note) || undefined,
        delta:
          deltaValue != null
            ? { value: deltaValue, label: str(deltaRaw?.label) || undefined }
            : undefined,
      };
    }
    case "share":
    case "ranking": {
      const items = itemArray(c.items, MAX_ITEMS);
      if (items.length === 0) return null;
      return {
        type: c.type,
        title,
        group,
        unit: str(c.unit),
        items,
      } as Card;
    }
    case "trend": {
      if (!Array.isArray(c.points)) return null;
      const points: Array<{ t: string; v: number }> = [];
      for (const p of c.points.slice(-MAX_POINTS)) {
        if (p == null || typeof p !== "object") continue;
        const t = str((p as Record<string, unknown>).t);
        const v = num((p as Record<string, unknown>).v);
        if (!t || v == null) continue;
        points.push({ t, v });
      }
      if (points.length < 2) return null;
      return { type: "trend", title, group, unit: str(c.unit), points };
    }
    case "table": {
      const columns = strArray(c.columns, MAX_COLUMNS);
      if (columns.length === 0 || !Array.isArray(c.rows)) return null;
      const rows = c.rows
        .slice(0, MAX_ROWS)
        .map((r) =>
          Array.isArray(r) ? r.slice(0, columns.length).map((x) => str(x)) : []
        )
        .filter((r) => r.length > 0);
      if (rows.length === 0) return null;
      return { type: "table", title, group, columns, rows };
    }
    case "context": {
      if (!Array.isArray(c.items)) return null;
      const items: Array<{ label: string; value: string }> = [];
      for (const raw of c.items.slice(0, MAX_CONTEXT)) {
        if (raw == null || typeof raw !== "object") continue;
        const label = str((raw as Record<string, unknown>).label);
        const value = str((raw as Record<string, unknown>).value);
        if (!label || !value) continue;
        items.push({ label, value });
      }
      if (items.length === 0) return null;
      return { type: "context", title, group, items };
    }
    default:
      return null;
  }
}

export function validateDashboard(raw: unknown): Dashboard | null {
  if (raw == null || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.cards)) return null;
  const cards = d.cards
    .slice(0, MAX_CARDS)
    .map(validateCard)
    .filter((c): c is Card => c !== null);
  if (cards.length === 0) return null;
  const title = str(d.title);
  const subtitle = str(d.subtitle);
  return {
    title: title || "Consulta",
    subtitle: subtitle || undefined,
    cards,
  };
}
