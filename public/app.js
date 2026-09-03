const PALETTE = [
  "#35e0c8", "#4cc3ff", "#a78bfa", "#ffc857", "#ff6b6b",
  "#34d399", "#f472b6", "#94a3b8",
];

const SPAN_RULES = {
  kpi: { base: 3, max: 6 },
  context: { base: 12, max: 12 },
  "context-strip": { base: 12, max: 12 },
  share: { base: 4, max: 6 },
  ranking: { base: 6, max: 12 },
  trend: { base: 6, max: 12 },
  table: { base: 6, max: 12 },
  structure: { base: 6, max: 12 },
  insights: { base: 12, max: 12 },
};

const TOOLTIP_STYLE = {
  backgroundColor: "#101722",
  borderColor: "#2a3a4e",
  borderWidth: 1,
  titleColor: "#e8eef5",
  bodyColor: "#35e0c8",
  titleFont: { family: "JetBrains Mono", size: 12 },
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
  if (!dashboard) return;
  const grid = document.getElementById("cards");
  grid.className = "grid";

  const expanded = [];
  let heroUsed = false;
  for (const card of dashboard.cards) {
    if (card.type === "context") {
      expanded.push({
        type: "context-strip",
        title: card.title,
        items: card.items,
      });
    } else if (card.type === "kpi" && !heroUsed) {
      heroUsed = true;
      expanded.push({ ...card, hero: true });
    } else {
      expanded.push(card);
    }
  }

  let currentGroup = null;
  let sectionCards = [];

  const flushSection = () => {
    for (const item of packRows(sectionCards)) {
      const node = buildCard(item.card);
      if (!node) continue;
      node.classList.add(`s${item.span}`);
      grid.appendChild(node);
    }
    sectionCards = [];
  };

  for (const card of expanded) {
    const group = card.group ?? "";
    if (group !== currentGroup) {
      flushSection();
      currentGroup = group;
      if (group) {
        const head = el("div", "section-head");
        head.appendChild(el("h2", null, group));
        grid.appendChild(head);
      }
    }
    sectionCards.push(card);
  }
  flushSection();
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
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_STYLE,
            callbacks: {
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
            title: { display: Boolean(card.unit), text: card.unit, color: "#8a99ab", font: { family: "JetBrains Mono", size: 11 } },
            ticks: { color: "#8a99ab" },
            grid: { color: "#1c2735" },
          },
          y: { ticks: { color: "#e8eef5", font: { family: "JetBrains Mono" } }, grid: { display: false } },
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
          borderColor: "#35e0c8",
          backgroundColor: "rgba(53,224,200,.1)",
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
          x: { ticks: { color: "#8a99ab", maxTicksLimit: 12, font: { family: "JetBrains Mono" } }, grid: { display: false } },
          y: {
            title: { display: Boolean(card.unit), text: card.unit, color: "#8a99ab", font: { family: "JetBrains Mono", size: 11 } },
            ticks: { color: "#8a99ab", font: { family: "JetBrains Mono" } },
            grid: { color: "#1c2735" },
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
  log.hidden = false;
  const msg = el("div", `msg ${role}`);
  if (loading) msg.classList.add("loading");
  if (loading) msg.textContent = text;
  else msg.innerHTML = md(text);
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  return msg;
}

async function send(text) {
  const input = document.getElementById("chat-input");
  const button = document.getElementById("chat-send");
  if (!text.trim() || button.disabled) return;

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
      renderDashboard(data.dashboard ?? null);
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
