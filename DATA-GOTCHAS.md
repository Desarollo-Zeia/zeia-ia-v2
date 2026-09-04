# DATA-GOTCHAS — Diferencias entre la BD y la nomenclatura web

> Fuente de verdad para el agente ZeIA. Cada gotcha incluye: qué es, evidencia
> real (verificada contra la BD `energy`, dump 2026-02→2026-08), impacto, y la
> regla de defensa que debe implementar la capa semántica.
>
> Contexto: el agente lee Postgres (columnas `*_value` de `readings_reading`),
> la web le habla al cliente con el diccionario `ELECTRIC_PARAMETERS`
> (`src/parameters.ts`). Entre medio hay traducciones que hoy dependen de
> código disperso y del buen juicio del LLM. Este documento es el inventario
> completo de esas fricciones.

---

## 0. Inventario de capas actuales (dónde vive el conocimiento hoy)

| Capa | Archivo | Qué sabe | Riesgo |
|---|---|---|---|
| Diccionario web | `src/parameters.ts` → `ELECTRIC_PARAMETERS` | Clave web → nombre humano + unidad | Duplicado en 3 lugares más (ver abajo) |
| Mapeo BD↔web | `src/parameters.ts` → `READINGS_READING_MAP` | 25 claves ↔ columnas `*_value` | Duplicado en SQL y en el prompt |
| Vocabulario cliente | `src/parameters.ts` → `CLIENT_TERMS` | "consumo"→EPpos, "potencia"→P, etc. | Codifica el método incorrecto de cálculo (G4) |
| SQL | `src/queries.ts` | Columnas hardcodeadas en 6 funciones | Se drifta del mapa si alguien edita a mano |
| Prompt del agente | `src/agent.ts` reglas 4, 7, 9 | Traducción THD y reglas de interpretación **en prosa** | Cambiar el prompt no cambia las queries (y viceversa) |
| Contrato de salida | `protocolo.md` | Cards, unidades de display | Usa `kWh/kW/kvar` en minúsculas; el diccionario dice `KWh/KW/KVar` (G11) |

**Conclusión del inventario:** el conocimiento ya está centralizado *nominalmente*
en `parameters.ts`, pero las demás capas lo repiten a mano. Cualquier cambio
(nuevo parámetro, corrección de fase, factor de escala) exige editar 3-4
archivos sincronizados. Ese es el problema raíz de la fuente de verdad.

---

## 1. Catálogo de gotchas

### G1 · Fases: el dispositivo dice a/b/c, la web dice R/S/T

- **Qué es:** un sistema trifásico tiene 3 fases. El hardware (Acrel ADW300/210)
  y la BD las nombran `a, b, c` (`THDIa_value`, `Ua_value`, `Ib_value`...). La
  web las presenta al cliente como `R, S, T` (`THDIr` = "fase R").
- **Mapeo asumido:** `a→R, b→S, c→T`.
- **Evidencia:** `READINGS_READING_MAP` ya codifica `THDVr → THDUa_value`; el
  prompt del agente (regla 7) lo repite en prosa.
- **Impacto:** si la traducción se hace mal (o de forma inconsistente entre web,
  chat y alertas), el dato es correcto pero la **etiqueta** miente. En el chat
  esto genera instrucciones físicas erradas ("mida la fase S" cuando el problema
  está en la R). Nadie detecta el error: no hay NULL, no hay excepción.
- **Defensa:** el mapeo vive en UN archivo; el LLM nunca traduce — recibe datos
  ya etiquetados. ⚠️ **Validar con el equipo de hardware que a↔R es correcto**
  (es una convención, no un hecho medible desde la BD).

### G2 · THD: doble nomenclatura de clave (no solo de fase)

- **Qué es:** además del cambio de fase, la clave completa cambia de nombre:
  `THDUa_value` (BD) ↔ `THDVr` (web) ↔ "Distorsión armónica total en voltaje de
  la fase R" (humano). Tres representaciones del mismo dato.
- **Evidencia:** `values_per_channel` trae `THDIa/THDUa`; la web nunca muestra
  esas claves.
- **Impacto:** el agente que lea el JSON crudo y lo cite textualmente ("THDIa =
  22") usa un vocabulario que el cliente no reconoce.
- **Defensa:** toda salida hacia el cliente usa solo claves/nombres del
  diccionario; las claves de dispositivo quedan confinadas a la capa de datos.

### G3 · Unidades de potencia: vatios vs kilovatios según dispositivo ⚠️

- **Qué es:** la columna `P_value` (y `Q_value`, `S_value`, y las claves
  `P/Q/S` de `values_per_channel`) llega en **escalas distintas según el
  dispositivo**: algunos reportan kW, otros vatios. El diccionario declara
  `KW` para todos — mentira piadosa que la BD desmiente.
- **Evidencia (Oechsle, jul 2026):**
  - `Tablero TD-A1`: `P = 48,243` con `Ia = 74.9 A`, `Uab = 390 V` → físicamente
    imposible en kW (el tablero es 250 A ≈ 164 kW máx). Es **48.2 kW** → vatios.
  - `Chiller 1`: `P = 98` con `Ia = 178 A`, `Uab = 456 V` → `√3·456·178 ≈ 140 kVA`
    → consistente en **kW**.
  - Mismo patrón en `TD-A2..A4` y `TD-FE` (vatios) vs `TG-TR2`, llaves generales,
    chillers (kW).
- **Impacto:** sin normalizar, el promedio mezcla escalas y el error es de ×1000
  para los puntos en vatios. El ranking de consumo, el share y cualquier KPI
  quedan inservibles; el dashboard diría "alumbrado: 48,243 kW".
- **Defensa:** factor de escala **por punto de medición**, decidido con la
  capacidad física del punto: `P > √3 × capacity_voltage × capacity_amperage`
  → el valor está en vatios → dividir por 1000. Se calcula una vez por punto
  (o se verifica por lectura), nunca se deja al LLM interpretar la escala.

### G4 · Contadores de energía (EPpos) se reinician + el cálculo actual está roto ⚠️

- **Qué es:** `EPpos_value` es un odómetro acumulado. Los equipos se reinician
  y el contador vuelve a 0 (o salta a un valor previo tras resincronizar).
- **Evidencia:** **140 resets detectados en 6 puntos de Oechsle** entre feb y
  ago 2026 (EPpos baja >1 kWh entre lecturas consecutivas). Ejemplo documentado:
  TD-A1 se reseteó a 0 un 15-jul a las 15:00 y continuó desde ~100,949.
- **Impacto:** el consumo calculado como `último EPpos − primer EPpos` es
  inválido si hubo reset en el período. **Los tools actuales lo hacen así:**
  - `energyConsumption()` (`queries.ts:111-121`): `last_ep − first_ep` ❌
  - `readingHistory()`: `ep_delta_kwh = max − min` (`queries.ts:172`) ❌
  Con 140 resets reales, estos números ya están corruptos hoy, no "a futuro".
- **Defensa (verificada empíricamente el 2026-09-03):** integración de
  potencia: consumo = `Σ (P_kW normalizado × 1h)` por bucket horario. Es el
  ÚNICO método válido para estos dispositivos:
  - El delta simple (`max − min`) sobre TD-A1 en julio dio **111,513 kWh**
    cuando la realidad es **19,409 kWh** (5.7× de sobreconteo).
  - El delta segmentado (`Σ greatest(ep − lag(ep), 0)`) dio **424,761 kWh** —
    peor: el contador se reinicia a 0 y luego **re-sincroniza saltando de
    vuelta** a su valor (~100k en minutos, ej. 15-jul 15:38), y cada salto de
    re-sincronización se cuenta como consumo. Con este comportamiento, TODO
    método basado en deltas de contador es inválido.
  - La integración (19,409 kWh) coincide con la física (48.6 kW × ~12h/día).
  Mantener `ep_resets` como bandera de calidad de dato. Cruz de verificación
  recomendada: si integración y contador (cuando sea confiable) divergen
  sistemáticamente en un punto, revisar ese dispositivo.
- **Nota:** `CLIENT_TERMS.consumo` dice literalmente "el consumo se calcula como
  diferencia de contador EPpos" — codifica el método roto como verdad. Corregir
  junto con las queries.

### G5 · `values_per_channel`: muñeca rusa de 3 capas + columnas espejo

- **Qué es:** el tipo real es `jsonb[]` (array Postgres), cuyo único elemento es
  un **string** que contiene otro array JSON de objetos `{channel, values}`.
- **Evidencia (estructura real):**
  ```
  jsonb[] → "[{\"values\": {\"P\": 48243.95}, \"channel\": 1}]"
            ▲ string, no objeto: hace falta unnest → cast → jsonb_array_elements
  ```
- **Columnas espejo:** `P_value` = copia exacta del `P` del canal 1 (verificado
  lectura a lectura en agosto 2026). Hoy todos los dispositivos reportan 1 solo
  canal y `is_multichannel = false` en los 36 dispositivos con datos.
- **Impacto hoy:** bajo (canal 1 = columnas planas). El parseo de 3 capas es
  fricción, no peligro: errores de parseo devuelven **NULL silencioso**, no
  error.
- **Impacto futuro:** el ADW210 soporta múltiples canales y el modelo ya lo
  anticipa (`is_multichannel`, `clamp_assignment`). El día que haya N canales,
  las columnas planas dejarán de representar el total: usarlas = ignorar
  circuitos completos.
- **Defensa:** decidir HOY la política — (a) canal 1 vía columnas planas es
  suficiente y cualquier punto multicanal se modela como puntos de medición
  separados (uno por clamp, que es como ya se modela con `clamp_assignment`),
  o (b) los cálculos siempre parsean el JSON completo. Cualquiera es válida;
  debe estar escrita.

### G6 · Parámetros por fase que el diccionario promete y la BD no tiene

- **Qué es:** `ELECTRIC_PARAMETERS` define `Pa/Pb/Pc`, `Qa/Qb/Qc`, `Sa/Sb/Sc`,
  `PFa/PFb/PFc`, `Et`, `EPtA/B/C`, `EPposA/B/C`, `VfunA/B/C`, `IfunA/B/C`,
  `V3A…V11C` (35+ claves). `readings_reading` **no tiene columnas** para
  ninguno; `values_per_channel` tampoco los trae (solo totales P/Q/S/PF/F,
  U por fase, I por fase, THD y contadores).
- **Evidencia:** `information_schema.columns` + muestras del JSON: 17 claves
  distintas máximo, todas totales o por-fase-de-U/I/THD.
- **Impacto:** si el cliente pide "potencia de la fase R", el dato no existe.
  El prompt (regla 9) ya lo contempla ("di que no se publican por punto").
- **Defensa:** la capa semántica marca estas claves como `disponible: false`
  para que el agente responda con el total sin prometer datos inexistentes.
  No prometerlos en dashboards ni chips sugeridos.

### G7 · Disponibilidad de parámetros según modelo de dispositivo

- **Qué es:** no todos los dispositivos reportan todos los parámetros.
- **Evidencia:** en agosto 2026 solo el **ADW300** envía THD (18 dispositivos);
  el ADW210 (multicanal) no envía THD en ninguna lectura reciente. Los
  monofásicos no tienen Uab/Ubc/Uac.
- **Impacto:** pedir "THD del punto X" puede no tener respuesta no porque el
  dato esté mal sino porque ese hardware no lo reporta.
- **Defensa:** disponibilidad por punto derivada de los datos (o del modelo de
  dispositivo), expuesta al agente para que no diga "no hay datos" cuando la
  respuesta correcta es "ese equipo no reporta THD".

### G8 · Potencia negativa (inyección / convención de signo)

- **Qué es:** `P_value` puede ser negativo.
- **Evidencia:** **28,386 lecturas con P < 0** en Oechsle (feb–ago 2026). Con
  `EPneg` ("energía activa generada") en el diccionario, el signo tiene
  significado: inversión de pinza CT o generación real.
- **Impacto:** promediar P sin tratar el signo distorsiona consumos; el agente
  podría narrar "consumo negativo" sin explicación.
- **Defensa:** decisión documentada: ¿P negativo = inyección real o error de
  instalación (pinza invertida)? Mientras tanto, la capa semántica lo etiqueta
  ("lectura con signo negativo") y no lo mezcla en totales de consumo sin flag.

### G9 · Columna `capacity` redundante y semánticamente ambigua

- **Qué es:** `enterprises_measurementpoint` tiene `capacity` (texto libre:
  "380v/800A") **y** `capacity_amperage` / `capacity_voltage` (numéricas).
- **Evidencia:** los 6 puntos muestreados son consistentes entre sí, pero
  `capacity` es solo texto duplicado y la regla de G3 depende de las numéricas.
- **Impacto:** menor hoy; riesgo de drift si alguien actualiza una y no la otra.
- **Defensa:** tratar `capacity_amperage/voltage` como fuente; `capacity` es
  display. La regla de normalización usa SIEMPRE las numéricas.

### G10 · Alertas: tercer consumidor de la nomenclatura

- **Qué es:** `alerts_alertthreshold.measurement` guarda el **nombre de columna
  BD** que dispara la alerta (`P_value`, `Uab_value`...), y las alertas traen
  subtipos (`current_phase`, `phase_type`, `current_subtype`...).
- **Impacto:** cuando el chat resume alertas debe traducir columna→nombre
  cliente con el MISMO mapa de G1/G2, o dirá "alerta de THDIa" en vez de
  "distorsión armónica en corriente fase R".
- **Defensa:** el mismo diccionario resuelve `measurement` → nombre humano.

### G11 · Estética de unidades: `KWh/KW/KVar/KVA` vs `kWh/kW/kvar/kVA`

- **Qué es:** el diccionario escribe `"KW"`, `"KWh"`, `"KVar"`, `"KVA"`;
  `protocolo.md` exige `kWh, kW, V, A, %, Hz`; la notación SI correcta es
  kW, kWh, kvar, kVA.
- **Impacto:** cosmético pero visible para el cliente y para los tests (un test
  que compare unidades fallaría por casing).
- **Defensa:** la capa semántica emite unidades SI canónicas; el diccionario se
  corrige o se mapea al mostrar.

### G12 · Tiempo: `readings_reading` solo tiene `created_at`

- **Qué es:** no hay columna `timestamp` de medición (las alertas sí la tienen).
  `created_at` es la hora de inserción Django ≈ hora de medición (los analizadores
  suben casi en tiempo real, cadencia ~60-70 s).
- **Evidencia:** columnas de la tabla; cadencia regular observada; timestamps
  en `-05` (Lima).
- **Impacto:** si algún día la ingesta se desacopla (batch/replay),
  `created_at` dejará de ser la hora de la medición y todos los buckets
  horarios se desplazarán.
- **Defensa:** asumir `created_at` = tiempo de medición está bien hoy; anotar
  que si cambia el ingestador, el rollup es lo primero a migrar.

### G13 · `data_coverage` ignora el scope multiempresa

- **Qué es:** el tool `data_coverage` (`tools.ts:299`) no filtra por empresa:
  devuelve el min/max **global** de `readings_reading` aunque el cliente solo
  tenga permiso sobre la suya; con `point_id` ni siquiera valida pertenencia.
- **Impacto:** fuga menor (fechas de primera/última lectura de otros clientes o
  de puntos ajenos). Es el único tool sin chequeo de scope.
- **Defensa:** mismo patrón que los demás (`scope.has(enterprise)`) o validar
  que el punto pertenezca a la empresa del cliente.

### G14 · `latest_metrics` oculta puntos silenciosos

- **Qué es:** el tool filtra `created_at > now() - 7 days` y aplica
  `DISTINCT ON (point)`; un punto que dejó de reportar hace 8 días **desaparece
  del listado** sin explicación.
- **Impacto:** el agente no puede distinguir "consumo cero" de "sin datos", y
  puede contestar cosas raras si el cliente pregunta por un punto caído.
- **Defensa:** implementada el 2026-09-03 a nivel de datos + prompt:
  1. Los tools (`latest_metrics`, `energy_consumption`, `reading_history`,
     `active_alerts`, `alert_summary`) devuelven, cuando el resultado es
     vacío, un objeto `{empty: true, data_note}` con la **fecha de la última
     lectura** (vía `data_coverage`) y la instrucción de no interpretarlo
     como consumo cero ni ausencia de problemas.
  2. `RunCollector.numericDataSeen` registra si algún tool devolvió filas
     con datos; `render_dashboard` **rechaza** cards numéricas
     (kpi/share/ranking/trend/table) si no hubo datos numéricos en el run
     (detectado en simulación: el agente fabricaba "0 kW" en cards mientras
     el texto decía "no hay datos").
  3. Regla 14 del prompt del agente respalda ambas defensas.
  Verificado en `src/verify-bugs.ts` (G14: 3/3) y en simulaciones de chat.

---

## 2. Bugs de la cadena del agente (resumen accionable)

> **Estado: los 7 bugs (B1-B7) fueron corregidos el 2026-09-03** en
> `queries.ts`, `tools.ts`, `parameters.ts` y `agent.ts`. Verificado con
> `bun run src/tools-test.ts`: normalización kW OK en lecturas crudas,
> `ep_resets` presente, `data_coverage` con scope OK. Las capas de defensa
> (L1-L7, sección 3) siguen abiertas.

| # | Dónde | Bug | Corrección aplicada |
|---|---|---|---|
| B1 | `queries.ts` `energyConsumption` | consumo = `last_ep − first_ep`, roto por los 140 resets reales (G4) | consumo = integración horaria de P normalizada (`avg_kw × 1h` por bucket); expone `hours_with_data` |
| B2 | `queries.ts` `readingHistory` | `ep_delta_kwh = max − min`, mismo problema (G4) | eliminado: la energía por bucket también se calcula integrando P (`energy_kwh = Σ avg_kw por hora`); `ep_resets` se mantiene como bandera de calidad. El delta segmentado se probó y se descartó: dio 424,761 kWh vs 19,409 reales (G4) |
| B3 | `queries.ts` (todos los tools) | `P_value` se devuelve crudo: el LLM narrará "48243 kW" (G3) | expresión `NORMALIZED_P` contra capacidad física (√3·V·A trifásico, V·A monofásico, con `abs` para P negativas) |
| B4 | `parameters.ts` `CLIENT_TERMS` | documenta el método incorrecto como verdad (G4) | `energia`/`consumo` reescritos: integración + contador reiniciable |
| B5 | `agent.ts` reglas 4/7/9 | mapeos en prosa, duplicados del código (G1/G2/G6) | `agentDataNotes()` genera vocabulario, equivalencias THD y lista de parámetros no publicados desde `parameters.ts`; el prompt los interpola |
| B6 | `tools.ts` `data_coverage` | sin scope de empresa (G13) | requiere `enterprise_id`, valida scope y pertenencia del punto |
| B7 | `tools.ts` / `queries.ts` | nada distingue kW de W en las respuestas de tools (G3) | tools devuelven campos con unidad en el nombre (`power_kw`, `energy_kwh`, `voltage_v`...) ya normalizados; `numeric` de PG coaccionado a number null-safe; el prompt prohíbe re-escalar unidades |

---

## 3. Capas faltantes para blindar la fuente de verdad

1. **L1 · Diccionario único y completo** — extender `parameters.ts` para que
   cada parámetro lleve: clave web, nombre humano, unidad SI, categoría,
   fase, columna BD, y disponibilidad por familia de dispositivo. Todo lo
   demás se **deriva** de aquí (SQL, prompt, tests). Hoy: 3 copias manuales.
2. **L2 · Normalización de unidades** — factor de escala por punto de medición
   (regla de capacidad de G3), aplicado en `queries.ts` antes de que el número
   llegue al LLM. Nunca en el prompt.
3. **L3 · Energía a prueba de resets** — reemplazar deltas de contador por
   integración de potencia (o delta segmentado) en `energyConsumption` y
   `readingHistory`; cruz de verificación contador vs integración como alerta
   de calidad de dato.
4. **L4 · Vista canónica (opcional pero recomendada)** — `v_lecturas_cliente`
   con columnas renombradas a nomenclatura cliente (`thd_corriente_fase_r`...).
   Protege a futuros desarrolladores y habilita text-to-SQL seguro si algún día
   se quiere.
5. **L5 · Tests dorados** — fixtures con: THDIa=22 → la respuesta dice "fase R"
   y "22%"; contador con reset → consumo correcto; punto en vatios → kW
   correcto. En CI, corren con cada cambio de prompt o de modelo.
6. **L6 · Prompt generado, no escrito a mano** — las reglas 4/7/9 del prompt se
   construyen desde el diccionario; editar el diccionario actualiza el agente.
7. **L7 · Contrato de tools con unidades** — cada respuesta de tool incluye la
   unidad normalizada y el punto aplicado; el prompt prohíbe al modelo alterar
   unidades o etiquetas.

---

## 4. Supuestos abiertos (validar con hardware/plataforma)

| # | Supuesto | Qué pasaría si es falso |
|---|---|---|
| S1 | `a→R, b→S, c→T` | etiquetas de fase al revés en todo el sistema (G1) |
| S2 | `created_at` ≈ hora de medición | buckets horarios desplazados si cambia el ingestador (G12) |
| S3 | `P_value` siempre = canal 1 de `values_per_channel` | totales mal si se activa multicanal sin actualizar la política (G5) |
| S4 | P negativo = inyección/pinza invertida (decidir cuál) | consumos distorsionados en promedios (G8) |
| S5 | Unidades W/kW estables por dispositivo (no cambian con firmware) | la regla de G3 necesitaría re-detección periódica |
| S6 | Topología eléctrica real de los tableros: en Oechsle, la acometida del tablero TG-TR2 mide ~45,200 kWh/30d mientras la suma de sus 9 puntos es ~90,100 kWh (los hijos "consumen" el doble que la acometida) | las proporciones cambian según se use la acometida (47.6% para Chiller 1) o la suma de puntos (23.9%); se necesita validar CTs/ratios y jerarquía llave→hijos con el cliente/instalador |
| S7 | Horas punta para el cargo por demanda: la BD no guarda las franjas horarias de la tarifa; `cost_analysis` usa `PEAK_HOUR_START=18` / `PEAK_HOUR_END=23` (env, hora local Lima) y media horaria (la factura real usa demanda de 15 min) | el costo por demanda varía si la franja real de Kallpa/pliego difiere; para Oechsle el cargo de energía es igual pico/valle (39.15) así que solo afecta el término de demanda (6.51 USD/kW) |
| S8 | `billingdata` de `energy_headquarter.billing_data_id` es la tarifa de energía; `billingactive` tiene 4 filas activas con `billing_permission` distintos (probablemente módulos: energía/confort/agua) y una con currency PEN | usar la fila equivocada cambiaría moneda y precios; validar con plataforma qué permission corresponde a cada módulo |
| S9 | La penalización reactiva aplica sobre `max(0, EQ − 30% × EP)` con el cargo de `billingdata` (0.0492 USD/kvarh) | si el pliego real usa otra fórmula (percentil, exclusión de puntas), el costo reactiva difiere; para Oechsle son ~594 USD/mes — validar con factura histórica |
| S10 | La proyección de ciclo usa costo/día = total / horas distintas con datos, escalado a los días del ciclo | si el consumo del resto del ciclo difiere del promedio (estacionalidad), la proyección se desvía |
| S11 | Horario de operación aprendido por punto: horas "abiertas" = promedio de potencia ≥ 10% del pico horario del punto en las 4 semanas previas (ventana 31d→3d antes de la última lectura); consumo nocturno = kWh recientes (3d) en horas NO abiertas, con umbrales >5 kWh y ≥8% del total | falsos positivos con puntos de consumo verdaderamente 24/7 (refrigeración) o baselines cortos |
| S12 | Health Score = 100 − (25×crítico + 10×advertencia + 3×info), sin ponderación por monto | dos hallazgos con severidades iguales pueden tener impactos económicos muy distintos; futura versión: score ponderado por dinero |
| S13 | Demanda pico del analyzer = suma de acometidas `is_main` por hora (misma base que cost_analysis); lo contratado sale de `enterprises_power.is_power_contracted_active` (686 kW en Oechsle) | si la acometida facturada real es un solo punto (no la suma), el ratio pico/contratado cambia |

---

*Última verificación de evidencia: 2026-09-03, BD `energy` local
(`localhost:5432`), datos de Oechsle Salaverry (headquarter 67).*
