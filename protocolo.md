# Protocolo

Cómo ZeIA convierte una pregunta del cliente en un dashboard. Catálogo **cerrado**: nada fuera de esta lista.

## Principios

1. Máximo **10 cards** por respuesta, mínimo 3 si hubo consulta de datos. Si sobra espacio, no se rellena.
2. **Paridad texto-dashboard**: todo dato, ranking o conclusión del texto debe existir como card; nada relevante queda solo en el texto.
3. Todo número viene de una herramienta. Lo único calculable en el cliente: diferencias y porcentajes entre esos datos.
4. Toda cantidad lleva unidad (`kWh`, `kW`, `V`, `A`, `%`, `Hz`, `USD/MWh`). Sin unidad, no se muestra: en kpi/share/ranking/trend via `unit`; en `table` en el encabezado de columna; en `context` dentro del value.
5. Sin datos → no hay card numérica; se explica en el texto del chat (con fecha de última lectura si aplica).
6. El cliente se acostumbra a una forma: el mismo tipo de pregunta genera siempre el mismo layout.
7. Los gráficos siempre con tooltip al hover (valor + unidad + %), y los ejes rotulados con la unidad.
8. **Toda respuesta que consultó herramientas se grafica** — incluidas las estructurales (tableros/puntos/sedes) con la card `structure`.
9. **Toda respuesta con datos termina con una card `insights`**: el análisis del asistente para el cliente (1-5 frases basadas solo en datos).

## Catálogo de cards (8 tipos)

| Tipo | Uso | Límites |
|---|---|---|
| `kpi` | Un valor grande: consumo, potencia, conteo de alertas. Con delta opcional (▲▼ vs periodo anterior) y nota. | 1 valor |
| `share` | Participación % de cada punto sobre un total (donut). Responde "¿cuánto representa X del total?" | ≤ 8 items |
| `ranking` | Comparación ordenada entre puntos (barras horizontales). Responde "¿quién consume más?" | ≤ 8 items |
| `trend` | Evolución temporal (línea). Responde "¿cómo fue a lo largo de...?" | ≤ 60 puntos |
| `table` | Detalle multi-atributo (punto, tablero, sede, valor). | ≤ 6 columnas, ≤ 12 filas |
| `context` | Dato del sujeto: cada chip se renderiza como **card independiente** (base 3, acento teal). Van primero. Última lectura, sede, tablero, etc. | ≤ 6 chips |
| `structure` | Jerarquía tablero → puntos de monitoreo: cada tablero con su badge de conteo ("9 puntos de monitoreo activos") y sus puntos como chips. | ≤ 8 tableros, ≤ 12 puntos c/u |
| `insights` | Apartado de **análisis del asistente**: frases con lo que el cliente debe tomar en cuenta (anomalías, comparaciones, advertencias de datos, recomendaciones). Ancho completo, va al final. | ≤ 6 frases |

Todas las cards aceptan `group` (opcional): cards con el mismo `group` se agrupan bajo un título de sección (ej: "Alertas más importantes" para un trío de kpi). Cards sin `group` van sueltas al inicio.

## Cuándo usar cada tipo (árbol de decisión)

1. ¿La respuesta es un solo número? → `kpi` (+ `delta` si hay periodo anterior).
2. ¿Hay eje temporal y el patrón importa? → `trend` (mínimo 3 buckets; con menos, `kpi` + `delta`).
3. ¿Es comparación entre entidades? → `ranking` si importa el orden; `share` si la pregunta es participación sobre un total.
4. ¿Más de 8 entidades o importan varios atributos por fila? → `table`.
5. `context` nunca responde: solo acompaña (máximo 1 por dashboard).

**Reglas de no-uso:**
- Nada de `trend` con 1-2 puntos.
- Nada de `share` para comparar dos entidades: eso es `ranking`.
- Nada de donuts con más de 8 categorías: agrupar en "Otros" o usar `table`.
- **Máximo DOS gráficos** (trend/ranking/share) por dashboard, el resto son de apoyo (kpi/context/table).

**Orden de lectura en pantalla (fijo):** `context` → `kpi` → gráfico principal (ancho doble) → `table` → `insights`.

## Layout (sin scroll, una pantalla)

La grilla ancla a la altura de la ventana: las filas se estiran para llenar la pantalla y las cards se encogen; el scroll solo aparece si el contenido realmente no cabe (fallback móvil = scroll normal).

**Filas de 12 columnas:** `kpi`/`context` = 3 (4 por fila) · `share` = 4 (3 por fila) · `ranking`/`trend`/`table` = 6 (2 por fila) · `insights` = 12 (fila completa). El motor de layout expande cards para rellenar huecos (`dense`) — envía las cards en orden de lectura y cada fila cierra en 12.

## Recetas (intención → layout fijo)

| El cliente pregunta... | Layout |
|---|---|
| Consumo de un punto ("consumo de chiller 1") | `context` + `kpi` kWh + `trend` por día + `share` (% vs otros puntos) |
| Comparar puntos ("chiller 1 vs chiller 2") | `ranking` + `table` (+ `share` si ayuda) |
| Estado actual ("¿cómo está X ahora?") | `context` + grid de `kpi` (P kW, U V, I A, PF) |
| Evolución / tendencia | `trend` + `kpi` con delta |
| Resumen de empresa | `kpi` total kWh + `ranking` + `table` |
| Alertas | `kpi` conteo + `table` reciente |
| Pregunta ambigua ("datos de energía") | Bloque principal: `kpi` P + `kpi` EPpos + `trend`; nunca mezclar kWh con kW en la misma card |
| Estructural ("¿qué tableros tengo?") | `structure` (tableros → puntos) + `context` + `insights` |

En **todas** las recetas, la card `insights` cierra el dashboard con el análisis del asistente.

## Formato de fechas

Toda fecha `YYYY-MM-DD HH:MM:SS` (o ISO) se muestra como **"Miércoles, 27 de Julio · 15:40"**: día de la semana + día + mes, hora sin segundos, sin conversión de zona horaria. Las fechas solo salen de herramientas (latest_metrics, data_coverage); nunca inventadas.

## Contrato HTTP

`POST /chat {"message": "...", "session_id?": "uuid"}` →

Sesión: memoria del server, últimos 8 turnos (solo texto, sin payloads de tools), TTL 2h de inactividad. `session_id` nuevo por carga de página → refresh o reinicio del server = sesión nueva. Sin `session_id` = request sin historial.

```json
{
  "reply": "texto para el chat",
  "dashboard": {
    "title": "Consumo de Chiller 1",
    "subtitle": "Últimos 7 días",
    "cards": [
      { "type": "kpi",    "title": "Consumo", "value": 1234.5, "unit": "kWh", "delta": { "value": -8.2, "label": "vs semana anterior" }, "note": "..." },
      { "type": "kpi",    "title": "Energía reactiva inductiva", "value": 933.68, "unit": "kvar", "note": "31/08/2026", "group": "Alertas más importantes" },
      { "type": "share",  "title": "Participación", "unit": "kWh", "items": [{ "label": "Chiller 1", "value": 1234.5 }] },
      { "type": "ranking","title": "Top consumo", "unit": "kWh", "items": [{ "label": "Chiller 1", "value": 1234.5 }] },
      { "type": "trend",  "title": "Consumo por día", "unit": "kWh", "points": [{ "t": "2026-08-01", "v": 120.4 }] },
      { "type": "table",  "title": "Detalle", "columns": ["Punto", "kWh"], "rows": [["Chiller 1", "1234.5"]] },
      { "type": "context","title": "Ubicación", "items": [{ "label": "Sede", "value": "San Borja" }] }
    ]
  }
}
```

`dashboard` es `null` si la pregunta no requirió consultar datos. El servidor valida y recorta todo lo que exceda los límites.
