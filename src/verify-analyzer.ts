import { runAnalysis } from "./analyzer";
import { sql } from "./db";

const checks: Array<{ test: string; ok: boolean; detail: string }> = [];
const check = (test: string, ok: boolean, detail: string) => {
  checks.push({ test, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${test} — ${detail}`);
};

console.log("=== Verificacion del analyzer (Modo Administrador) ===\n");

const a = await runAnalysis(3);

console.log(`Score: ${a.score}/100 (${a.grade}) | findings: ${a.findings.length}\n`);
for (const f of a.findings)
  console.log(` [${f.severity.toUpperCase()}] ${f.title} | impacto: ${f.money_impact ?? "-"} | ${f.asset}`);

check("estructura: score y grade validos",
  a.score >= 0 && a.score <= 100 && ["ok", "warning", "critical"].includes(a.grade),
  `score=${a.score} grade=${a.grade}`);

check("estructura: cobertura presente",
  !!a.coverage.last_reading,
  `ultima lectura: ${a.coverage.last_reading}`);

const reactive = a.findings.find((f) => f.id === "money-reactive");
check("findings: fuga reactiva detectada con monto",
  !!reactive && (reactive.money_impact ?? 0) > 800 && (reactive.money_impact ?? 0) < 3500,
  reactive ? `${reactive.money_impact} USD/mes` : "NO DETECTADA");

check("findings: datos desactualizados detectado (data hasta 20 ago)",
  a.findings.some((f) => f.id === "telemetry-site" && f.severity === "critical"),
  a.findings.find((f) => f.id === "telemetry-site")?.title ?? "NO DETECTADO");

check("findings: cada finding tiene pregunta sugerida",
  a.findings.every((f) => f.suggested_question.length > 10),
  `${a.findings.length} findings`);

check("findings: severidades validas",
  a.findings.every((f) => ["critical", "warning", "info"].includes(f.severity)),
  [...new Set(a.findings.map((f) => f.severity))].join(", "));

check("ok_summary: Items en orden presentes cuando corresponden",
  Array.isArray(a.ok_summary),
  `${a.ok_summary.length} items OK`);

// deterministicos: dos corridas seguidas = mismo score
const b = await runAnalysis(3);
check("determinismo: mismo score en corrida inmediata",
  a.score === b.score && a.findings.length === b.findings.length,
  `${a.score} vs ${b.score}, ${a.findings.length} vs ${b.findings.length} findings`);

console.log("\n=== RESUMEN ===");
const ok = checks.every((r) => r.ok);
console.log(`${ok ? "TODO OK" : "HAY FALLOS"}: ${checks.filter((r) => r.ok).length}/${checks.length} pruebas`);

await sql.end();
process.exit(ok ? 0 : 1);
