const PALETTE = [
  "#00B7CA", "#2EC4B6", "#4C8DFF", "#FF6B35",
  "#8B7CF6", "#E71D36", "#F5A524", "#8E8E93",
];

const SPAN_RULES = {
  kpi: { base: 3, max: 6 },
  context: { base: 3, max: 6 },
  share: { base: 4, max: 6 },
  ranking: { base: 6, max: 12 },
  trend: { base: 6, max: 12 },
  table: { base: 6, max: 12 },
  structure: { base: 6, max: 12 },
  insights: { base: 12, max: 12 },
};

const ROW_WEIGHT = {
  kpi: 1,
  context: 0,
  "context-strip": 0,
  share: 3,
  ranking: 3,
  trend: 3,
  table: 2,
  structure: 3,
  insights: 1,
};

const TOOLTIP_STYLE = {
  backgroundColor: "#FFFFFF",
  borderColor: "#E8E8E3",
  borderWidth: 1,
  titleColor: "#1C1C1E",
  bodyColor: "#009EAE",
  titleFont: { family: "Poppins", size: 12, weight: "600" },
  bodyFont: { family: "JetBrains Mono", size: 12 },
  padding: 10,
  displayColors: false,
};

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function fmtDateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?/.exec(String(value).trim());
  if (!m) return value;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(date.getTime())) return value;
  let out = `${DAYS[date.getDay()]}, ${date.getDate()} de ${MONTHS[date.getMonth()]}`;
  if (m[4] != null && !(m[4] === "00" && m[5] === "00")) out += ` · ${m[4]}:${m[5]}`;
  return out;
}

const sessionId = crypto.randomUUID();

const fmt = (n) =>
  Number(n).toLocaleString("es-PE", { maximumFractionDigits: 2 });

const charts = new Map();
let chartSeq = 0;

let currentView = "admin";
let lastFindings = null;
let lastDashboard = null;

function setView(view) {
  if (view === "admin" && !lastFindings) { loadFindings(); return; }
  if (view === "analysis" && !lastDashboard) return;
  currentView = view;
  document.getElementById("view-panel").classList.toggle("active", view === "admin");
  const va = document.getElementById("view-analysis");
  va.classList.toggle("active", view === "analysis");
  va.disabled = !lastDashboard;
  if (view === "admin") renderFindingsPanel(lastFindings);
  else renderDashboard(lastDashboard);
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function clearDashboard() {
  for (const chart of charts.values()) chart.destroy();
  charts.clear();
  const cards = document.getElementById("cards");
  cards.innerHTML = "";
  document.getElementById("empty-state").hidden = true;
}

function renderMeta(dashboard) {
  const meta = document.getElementById("dash-meta");
  meta.innerHTML = "";
  if (!dashboard) return;
  meta.appendChild(el("h2", null, dashboard.title));
  if (dashboard.subtitle) meta.appendChild(el("p", null, dashboard.subtitle));
}

function renderDashboard(dashboard) {
  clearDashboard();
  renderMeta(dashboard);
  setMode("ANÁLISIS DE CONSULTA", "#4D5A63");
  if (!dashboard) return;
  const grid = document.getElementById("cards");
  grid.className = "grid";

  const expanded = [];
  let heroUsed = false;
  for (const card of dashboard.cards) {
    if (card.type === "context") {
      for (const item of card.items) {
        expanded.push({ type: "context", title: item.label, value: item.value });
      }
    } else if (card.type === "kpi" && !heroUsed) {
      heroUsed = true;
      expanded.push({ ...card, hero: true });
    } else {
      expanded.push(card);
    }
  }

  const units = [];
  let currentGroup = null;
  let bucket = [];
  const flushBucket = () => {
    if (bucket.length === 0) return;
    units.push({ kind: "row", items: packRows(bucket) });
    bucket = [];
  };

  for (const card of expanded) {
    const group = card.group ?? "";
    if (group !== currentGroup) {
      flushBucket();
      currentGroup = group;
      if (group) units.push({ kind: "head", title: group });
    }
    bucket.push(card);
  }
  flushBucket();

  const compact = window.matchMedia("(max-width: 940px)").matches;
  if (!compact) {
    grid.style.gridTemplateRows = units
      .map((u) => {
        if (u.kind === "head") return "minmax(30px, auto)";
        if (u.items.every((it) => it.card.type === "context")) return "auto";
        const single = u.items.length === 1 ? u.items[0].card.type : null;
        const weight = Math.max(...u.items.map((it) => ROW_WEIGHT[it.card.type] ?? 1));
        if (single === "insights") return "minmax(120px, 1fr)";
        const minHeight = weight >= 3 ? 230 : weight >= 2 ? 180 : 130;
        return `minmax(${minHeight}px, ${weight}fr)`;
      })
      .join(" ");
  } else {
    grid.style.gridTemplateRows = "";
  }

  for (const u of units) {
    if (u.kind === "head") {
      const head = el("div", "section-head");
      head.appendChild(el("h2", null, u.title));
      grid.appendChild(head);
      continue;
    }
    for (const item of u.items) {
      const node = buildCard(item.card);
      if (!node) continue;
      node.classList.add(`s${item.span}`);
      grid.appendChild(node);
    }
  }
}

function packRows(cards) {
  const rows = [];
  let row = [];
  let used = 0;

  const closeRow = () => {
    if (row.length === 0) return;
    let leftover = 12 - used;
    let progress = true;
    while (leftover > 0 && progress) {
      progress = false;
      for (const item of row) {
        if (leftover === 0) break;
        const max = (SPAN_RULES[item.card.type] ?? { max: 12 }).max;
        if (item.span < max) {
          item.span++;
          leftover--;
          progress = true;
        }
      }
    }
    rows.push(...row);
    row = [];
    used = 0;
  };

  for (const card of cards) {
    const rule = SPAN_RULES[card.type] ?? { base: 6, max: 12 };
    if (row.length > 0 && used + rule.base > 12) closeRow();
    row.push({ card, span: rule.base });
    used += rule.base;
    if (used === 12) closeRow();
  }
  closeRow();
  return rows;
}

function buildCard(card) {
  const node = el("section", `card card--${card.type}`);
  if (card.hero) node.classList.add("card--hero");
  switch (card.type) {
    case "kpi": return buildKpi(node, card);
    case "share": return buildShare(node, card);
    case "ranking": return buildRanking(node, card);
    case "trend": return buildTrend(node, card);
    case "table": return buildTable(node, card);
    case "context": return buildContext(node, card);
    case "context-strip": return buildContextStrip(node, card);
    case "structure": return buildStructure(node, card);
    case "insights": return buildInsights(node, card);
    default: return null;
  }
}

function buildKpi(node, card) {
  node.appendChild(el("h3", null, card.title));
  const body = el("div", "kpi-body");
  const row = el("div");
  row.appendChild(el("span", "kpi-value", fmt(card.value)));
  row.appendChild(el("span", "kpi-unit", card.unit));
  body.appendChild(row);
  if (card.delta && typeof card.delta.value === "number") {
    const up = card.delta.value > 0;
    const d = el(
      "div",
      `delta ${up ? "up" : "down"}`,
      `${up ? "▲" : "▼"} ${fmt(Math.abs(card.delta.value))}`
    );
    if (card.delta.label) d.appendChild(el("small", null, ` ${card.delta.label}`));
    body.appendChild(d);
  }
  if (card.note) body.appendChild(el("div", "kpi-note", fmtDateTime(card.note)));
  node.appendChild(body);
  return node;
}

function buildShare(node, card) {
  node.appendChild(el("h3", null, card.title));
  const total = card.items.reduce((s, i) => s + i.value, 0);
  const wrap = el("div", "chart-wrap");
  const canvas = el("canvas");
  wrap.appendChild(canvas);
  node.appendChild(wrap);

  const legend = el("div", "share-legend");
  card.items.forEach((item) => {
    const row = el("div", "row");
    row.appendChild(el("span", null, item.label));
    const pct = total ? (item.value / total) * 100 : 0;
    row.appendChild(el("b", null, `${fmt(pct)}% · ${fmt(item.value)} ${card.unit}`));
    legend.appendChild(row);
  });
  node.appendChild(legend);

  if (window.Chart) {
    const chart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: card.items.map((i) => i.label),
        datasets: [{
          data: card.items.map((i) => i.value),
          backgroundColor: PALETTE,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_STYLE,
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                return ` ${fmt(ctx.parsed)} ${card.unit} (${pct}%)`;
              },
            },
          },
        },
      },
    });
    charts.set(`c${chartSeq++}`, chart);
  }
  return node;
}

function buildRanking(node, card) {
  node.appendChild(el("h3", null, card.title));
  const wrap = el("div", "chart-wrap");
  const canvas = el("canvas");
  wrap.appendChild(canvas);
  node.appendChild(wrap);

  const sorted = [...card.items].sort((a, b) => a.value - b.value);
  if (window.Chart) {
    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: sorted.map((i) => i.label),
        datasets: [{
          data: sorted.map((i) => i.value),
          backgroundColor: PALETTE.map((c) => `${c}cc`),
          borderRadius: 6,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: true },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_STYLE,
            callbacks: {
              title: (items) => items[0]?.label ?? "",
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? ((ctx.parsed.x / total) * 100).toFixed(1) : 0;
                return ` ${fmt(ctx.parsed.x)} ${card.unit} (${pct}% del total)`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: Boolean(card.unit), text: card.unit, color: "#8E8E93", font: { family: "JetBrains Mono", size: 11 } },
            ticks: { color: "#8E8E93" },
            grid: { color: "#E8E8E3" },
          },
          y: { ticks: { color: "#4D5A63", font: { family: "JetBrains Mono" } }, grid: { display: false } },
        },
      },
    });
    charts.set(`c${chartSeq++}`, chart);
  } else {
    const list = el("ul", "fallback-list");
    for (const item of sorted.reverse()) {
      const li = el("li");
      li.appendChild(el("span", null, item.label));
      li.appendChild(el("b", null, `${fmt(item.value)} ${card.unit}`));
      list.appendChild(li);
    }
    wrap.replaceWith(list);
  }
  return node;
}

function buildTrend(node, card) {
  node.appendChild(el("h3", null, card.title));
  const wrap = el("div", "chart-wrap");
  const canvas = el("canvas");
  wrap.appendChild(canvas);
  node.appendChild(wrap);

  if (window.Chart) {
    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: card.points.map((p) => fmtDateTime(p.t)),
        datasets: [{
          data: card.points.map((p) => p.v),
          borderColor: "#00B7CA",
          backgroundColor: "rgba(0,183,202,.12)",
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_STYLE,
            callbacks: {
              label: (ctx) => ` ${fmt(ctx.parsed.y)} ${card.unit}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: "#8E8E93", maxTicksLimit: 12, font: { family: "JetBrains Mono" } }, grid: { display: false } },
          y: {
            title: { display: Boolean(card.unit), text: card.unit, color: "#8E8E93", font: { family: "JetBrains Mono", size: 11 } },
            ticks: { color: "#8E8E93", font: { family: "JetBrains Mono" } },
            grid: { color: "#E8E8E3" },
          },
        },
      },
    });
    charts.set(`c${chartSeq++}`, chart);
  } else {
    const list = el("ul", "fallback-list");
    for (const p of card.points) {
      const li = el("li");
      li.appendChild(el("span", null, fmtDateTime(p.t)));
      li.appendChild(el("b", null, `${fmt(p.v)} ${card.unit}`));
      list.appendChild(li);
    }
    wrap.replaceWith(list);
  }
  return node;
}

function buildTable(node, card) {
  node.appendChild(el("h3", null, card.title));
  const wrap = el("div", "table-wrap");
  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const col of card.columns) headRow.appendChild(el("th", null, col));
  thead.appendChild(headRow);
  const tbody = el("tbody");
  for (const row of card.rows) {
    const tr = el("tr");
    for (const cell of row) tr.appendChild(el("td", null, fmtDateTime(cell)));
    tbody.appendChild(tr);
  }
  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);
  node.appendChild(wrap);
  return node;
}

function buildContext(node, card) {
  node.appendChild(el("h3", null, card.title));
  node.appendChild(el("div", "context-value", fmtDateTime(card.value)));
  return node;
}

function buildContextStrip(node, card) {
  node.classList.add("card--context");
  const wrap = el("div", "context-strip");
  for (const item of card.items) {
    const chip = el("div", "context-chip");
    chip.appendChild(el("span", "context-label", item.label));
    chip.appendChild(el("span", "context-value-sm", fmtDateTime(item.value)));
    wrap.appendChild(chip);
  }
  node.appendChild(wrap);
  return node;
}

function buildStructure(node, card) {
  node.appendChild(el("h3", null, card.title));
  const list = el("div", "structure-list");
  card.items.forEach((item, idx) => {
    const panel = el("div", "structure-panel");
    const color = PALETTE[idx % PALETTE.length];
    panel.style.setProperty("--panel-accent", color);

    const head = el("div", "structure-head");
    const name = el("span", "structure-name", item.label);
    name.title = item.label;
    head.appendChild(name);
    if (item.value) head.appendChild(el("span", "structure-badge", item.value));
    panel.appendChild(head);

    if (item.points && item.points.length > 0) {
      const chips = el("div", "structure-points");
      for (const point of item.points.slice(0, 12)) {
        const chip = el("span", "point-chip", point);
        chip.title = point;
        chips.appendChild(chip);
      }
      panel.appendChild(chips);
    }
    list.appendChild(panel);
  });
  node.appendChild(list);
  return node;
}

function buildInsights(node, card) {
  node.appendChild(el("h3", null, card.title));
  const list = el("ul", "insight-list");
  for (const text of card.items) {
    const li = el("li", null, text);
    list.appendChild(li);
  }
  node.appendChild(list);
  return node;
}

function md(text) {
  const escape = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = String(text).split("\n").map((line) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
    const content = heading ? heading[1] : line;
    const formatted = escape(content)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
    if (heading) return `<div class="md-h">${formatted}</div>`;
    if (/^\s*[-*•]\s+/.test(line)) return `<div class="md-li">${formatted.replace(/^\s*[-*•]\s+/, "• ")}</div>`;
    return `<div>${formatted}</div>`;
  });
  return lines.join("");
}

function addMsg(role, text, loading) {
  const log = document.getElementById("chat-log");
  const msg = el("div", `msg ${role}`);
  if (loading) msg.classList.add("loading");
  if (loading) msg.textContent = text;
  else msg.innerHTML = md(text);
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  return msg;
}

const drawer = document.getElementById("chat-drawer");
const backdrop = document.getElementById("drawer-backdrop");

function openDrawer() {
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;
  requestAnimationFrame(() => backdrop.classList.add("open"));
  document.getElementById("chat-btn").classList.add("active");
  setTimeout(() => document.getElementById("chat-input").focus(), 300);
}

function closeDrawer() {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  backdrop.classList.remove("open");
  document.getElementById("chat-btn").classList.remove("active");
  setTimeout(() => { backdrop.hidden = true; }, 260);
}

function addViewNotice() {
  const log = document.getElementById("chat-log");
  const msg = el("div", "msg notice");
  const btn = el("button", "notice-btn", "Ver análisis en el panel");
  btn.addEventListener("click", closeDrawer);
  msg.appendChild(btn);
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
}

function sectionHeader(text, color, target) {
  const head = sectionLabel(text, color);
  const btn = el("button", "adm-toggle");
  btn.setAttribute("aria-expanded", "true");
  btn.setAttribute("aria-controls", target);
  btn.title = "Mostrar / ocultar esta sección";
  btn.appendChild(el("span", null, "Ocultar"));
  btn.appendChild(el("span", "chev", "▾"));
  btn.addEventListener("click", () => {
    const grid = document.getElementById(target);
    if (!grid) return;
    const collapsed = grid.classList.toggle("collapsed");
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.firstChild.textContent = collapsed ? "Mostrar" : "Ocultar";
  });
  head.appendChild(btn);
  return head;
}

function renderSkeleton() {
  clearDashboard();
  const root = document.getElementById("cards");
  root.className = "adm";
  root.style.gridTemplateRows = "";
  document.getElementById("empty-state").hidden = true;
  const hero = el("div", "adm-hero");
  for (let i = 0; i < 3; i++) {
    const item = el("div", "adm-hero-item");
    item.appendChild(el("div", "sk-line sk-w40"));
    item.appendChild(el("div", "sk-line sk-w80"));
    item.appendChild(el("div", "sk-line sk-w60"));
    hero.appendChild(item);
  }
  root.appendChild(hero);
  const sections = [["Acciones requeridas", 2], ["Vigilar", 3]];
  for (const [title, n] of sections) {
    root.appendChild(sectionLabel(title, "#E8E8E3"));
    const grid = el("div", "adm-cards");
    for (let i = 0; i < n; i++) {
      const c = el("section", "adm-card");
      c.appendChild(el("div", "sk-line sk-w30"));
      c.appendChild(el("div", "sk-line sk-w90"));
      c.appendChild(el("div", "sk-line sk-w100"));
      c.appendChild(el("div", "sk-line sk-w70"));
      grid.appendChild(c);
    }
    root.appendChild(grid);
  }
}
function setMode(label, color) {
  const badge = document.getElementById("mode-badge");
  if (!badge) return;
  badge.textContent = label;
  badge.style.color = color;
  badge.style.borderColor = color;
}

async function loadFindings() {
  const grid = document.getElementById("cards");
  const empty = document.getElementById("empty-state");
  const meta = document.getElementById("dash-meta");
  setMode("CARGANDO PANEL", "#8E8E93");
  clearDashboard();
  meta.innerHTML = "";
  renderSkeleton();
  try {
    const res = await fetch("/findings");
    if (!res.ok) {
      const detail = res.status === 404
        ? "El servidor no tiene el endpoint /findings. Reinicia el server (bun run server) para cargar la version actual."
        : `El server respondio ${res.status} al pedir el panel.`;
      clearDashboard();
      empty.hidden = true;
      meta.innerHTML = "";
      meta.appendChild(el("h2", null, "Modo Administrador"));
      meta.appendChild(el("p", null, "No disponible"));
      const errCard = el("section", "card finding finding--critical");
      errCard.appendChild(el("h3", "finding-title", "Panel del administrador no disponible"));
      errCard.appendChild(el("p", "finding-detail", detail));
      errCard.appendChild(el("p", "finding-detail", "Mientras tanto puedes preguntarle a ZeIA en el chat de abajo."));
      grid.appendChild(errCard);
      setMode("SIN PANEL", "#E71D36");
      return;
    }
    const data = await res.json();
    if (data && data.findings) {
      lastFindings = data;
      setView("admin");
    }
  } catch (err) {
    clearDashboard();
    empty.hidden = true;
    const errCard = el("section", "card finding finding--critical");
    errCard.appendChild(el("h3", "finding-title", "No pude contactar al servidor"));
    errCard.appendChild(el("p", "finding-detail", String(err)));
    grid.appendChild(errCard);
    setMode("SIN CONEXION", "#E71D36");
  }
}

function buildGauge(score, grade) {
  const colors = { ok: "#2EC4B6", warning: "#FF6B35", critical: "#E71D36" };
  const color = colors[grade] ?? "#00B7CA";
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  const R = 34;
  const C = 2 * Math.PI * R;
  const wrap = el("div", "gauge");
  wrap.title = `Salud de la instalación: ${clamped} de 100. Resta 25 por hallazgo crítico, 10 por advertencia y 3 por vigilancia.`;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 84 84");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Estado ${clamped} de 100`);
  const track = document.createElementNS(NS, "circle");
  track.setAttribute("cx", "42");
  track.setAttribute("cy", "42");
  track.setAttribute("r", String(R));
  track.setAttribute("class", "gauge-track");
  const val = document.createElementNS(NS, "circle");
  val.setAttribute("cx", "42");
  val.setAttribute("cy", "42");
  val.setAttribute("r", String(R));
  val.setAttribute("class", "gauge-val");
  val.setAttribute("stroke", color);
  val.setAttribute("stroke-dasharray", C.toFixed(1));
  val.setAttribute("stroke-dashoffset", (C * (1 - clamped / 100)).toFixed(1));
  svg.appendChild(track);
  svg.appendChild(val);
  const num = el("div", "gauge-num");
  const big = el("span", null, String(clamped));
  big.appendChild(el("small", null, "/100"));
  num.appendChild(big);
  wrap.appendChild(svg);
  wrap.appendChild(num);
  return wrap;
}

function renderFindingsPanel(a) {
  clearDashboard();
  const root = document.getElementById("cards");
  root.className = "adm";
  root.style.gridTemplateRows = "";
  setMode("MODO ADMINISTRADOR", "#009EAE");
  const meta = document.getElementById("dash-meta");
  meta.innerHTML = "";
  meta.appendChild(el("h2", null, "Modo Administrador"));
  meta.appendChild(el("p", null, `Actualizado ${a.generated_at.slice(11, 16)}`));
  document.getElementById("empty-state").hidden = true;

  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of a.findings) counts[f.severity]++;

  /* 1. Estado: una franja, tres datos, cero decoracion */
  const gradeMeta = { ok: ["Operativo", "ok"], warning: ["Atención", "warning"], critical: ["Crítico", "critical"] }[a.grade];
  const hero = el("div", "adm-hero");
  const scoreBlock = el("div", "adm-hero-item adm-hero-item--score");
  scoreBlock.appendChild(el("div", "adm-label", "Estado de la instalación"));
  const scoreLine = el("div", "adm-score-line");
  scoreLine.appendChild(buildGauge(a.score, a.grade));
  scoreLine.appendChild(el("span", `adm-grade adm-grade--${gradeMeta[1]}`, gradeMeta[0]));
  scoreBlock.appendChild(scoreLine);
  hero.appendChild(scoreBlock);

  if (a.cost) {
    const costBlock = el("div", "adm-hero-item");
    costBlock.appendChild(el("div", "adm-label", "Costo de energía · 30 días"));
    const costLine = el("div", "adm-score-line");
    costLine.appendChild(el("span", "adm-cost", fmt(a.cost.total_cost)));
    costLine.appendChild(el("span", "adm-cost-cur", a.cost.currency));
    costBlock.appendChild(costLine);
    costBlock.appendChild(el("div", "adm-sub", `${fmt(a.cost.energy_kwh ?? 0)} kWh · pico ${fmt(a.cost.max_demand_kw_peak ?? 0)} kW`));
    hero.appendChild(costBlock);
  }

  const countBlock = el("div", "adm-hero-item");
  countBlock.appendChild(el("div", "adm-label", "Hallazgos"));
  const countLines = el("div", "adm-counts");
  countLines.appendChild(el("div", "fc fc--critical", `${counts.critical} requieren acción`));
  countLines.appendChild(el("div", "fc fc--warning", `${counts.warning} en atención`));
  countLines.appendChild(el("div", "fc fc--info", `${counts.info} en vigilancia`));
  countBlock.appendChild(countLines);
  hero.appendChild(countBlock);
  root.appendChild(hero);

  /* 2. Acciones requeridas: critical + warning como cola priorizada */
  const acciones = [
    ...a.findings.filter((f) => f.severity === "critical"),
    ...a.findings.filter((f) => f.severity === "warning"),
  ];
  if (acciones.length > 0) {
    root.appendChild(sectionHeader("Acciones requeridas", "#E71D36", "sec-acciones"));
    const grid = el("div", "adm-cards");
    grid.id = "sec-acciones";
    acciones.forEach((f, i) => grid.appendChild(buildFindingCard(f, i)));
    root.appendChild(grid);
  }

  /* 3. Vigilar: grilla de cards */
  const vigilar = a.findings.filter((f) => f.severity === "info");
  if (vigilar.length > 0) {
    root.appendChild(sectionHeader("Vigilar", "#00B7CA", "sec-vigilar"));
    const grid = el("div", "adm-cards");
    grid.id = "sec-vigilar";
    for (const f of vigilar) grid.appendChild(buildFindingCard(f, null));
    root.appendChild(grid);
  }

  /* 4. En orden: franja final discreta */
  if (a.ok_summary && a.ok_summary.length > 0) {
    const ok = el("div", "adm-ok");
    const list = el("ul");
    for (const t of a.ok_summary) list.appendChild(el("li", null, t));
    ok.appendChild(el("span", "adm-ok-title", "En orden"));
    ok.appendChild(list);
    root.appendChild(ok);
  }
}

function sectionLabel(text, color) {
  const head = el("div", "adm-section");
  const bar = el("span", "adm-section-bar");
  bar.style.background = color;
  head.appendChild(bar);
  head.appendChild(el("h2", null, text));
  return head;
}

function moneyNode(amount) {
  const wrap = el("div", "adm-money");
  if (amount == null) {
    wrap.classList.add("adm-money--na");
    wrap.textContent = "—";
    return wrap;
  }
  if (amount < 0) {
    wrap.classList.add("adm-money--save");
    wrap.innerHTML = `${fmt(Math.abs(amount))} <small>USD/mes de ahorro</small>`;
  } else {
    wrap.innerHTML = `${fmt(amount)} <small>USD/mes</small>`;
  }
  return wrap;
}

function buildFindingCard(f, i) {
  const card = el("article", `adm-card adm-card--${f.severity}`);
  const head = el("div", "adm-card-head");
  if (f.asset) head.appendChild(el("div", "adm-kicker", f.asset));
  if (i != null) head.appendChild(el("span", "adm-rank", String(i + 1).padStart(2, "0")));
  card.appendChild(head);
  card.appendChild(el("h3", "adm-title", f.title));
  card.appendChild(el("p", "adm-detail", f.detail));
  const foot = el("div", "adm-card-foot");
  const moneyBlock = el("div", "adm-money-block");
  moneyBlock.appendChild(el("div", "adm-money-label", "Impacto mensual"));
  moneyBlock.appendChild(moneyNode(f.money_impact));
  foot.appendChild(moneyBlock);
  const btn = el("button", "analyze-btn", "Analizar con ZeIA");
  btn.addEventListener("click", () => send(f.suggested_question));
  foot.appendChild(btn);
  card.appendChild(foot);
  return card;
}

async function send(text) {
  const input = document.getElementById("chat-input");
  const button = document.getElementById("chat-send");
  if (!text.trim() || button.disabled) return;

  openDrawer();
  addMsg("user", text);
  input.value = "";
  button.disabled = true;
  const pending = addMsg("assistant", "Consultando datos...", true);

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, session_id: sessionId }),
    });
    const data = await res.json();
    pending.remove();
    if (data.error) {
      addMsg("assistant", `Error: ${data.error}`);
    } else {
      addMsg("assistant", data.reply || "(sin respuesta)");
      if (data.dashboard) {
        lastDashboard = data.dashboard;
        setView("analysis");
        addViewNotice();
      }
    }
  } catch (err) {
    pending.remove();
    addMsg("assistant", `No pude contactar al servidor: ${String(err)}`);
  } finally {
    button.disabled = false;
    input.focus();
  }
}

document.getElementById("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  send(document.getElementById("chat-input").value);
});

document.querySelectorAll(".suggestions .chip").forEach((chip) => {
  chip.addEventListener("click", () => send(chip.textContent));
});

document.getElementById("chat-btn").addEventListener("click", () => {
  drawer.classList.contains("open") ? closeDrawer() : openDrawer();
});
document.getElementById("drawer-close").addEventListener("click", closeDrawer);
backdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
});

document.getElementById("view-panel").addEventListener("click", () => {
  if (currentView === "admin") loadFindings();
  else setView("admin");
});
document.getElementById("view-analysis").addEventListener("click", () => setView("analysis"));

loadFindings();
