# Mapa de Base de Datos — Energy Monitoring (ZeIA)

> PostgreSQL 16 · Base `energy` · host `localhost:5432`
> Origen: `C:\pgsql16\energy.dump` (dump completo de 2026-08-17, ~125 MB, Django + DRF)

## Visión general

Sistema de monitoreo de energía de **ZeIA** (plataforma SaaS multi-empresa):
- **Empresas (enterprises)**: Sanna, Oechsle, Pizza Hut, Burger King, KFC, Madam Tusan...
- **Sedes (energy headquarter)**: San Borja, Salaverry, etc.
- **Infraestructura**: tableros eléctricos (panels), puntos de medición (measurement points), dispositivos analizadores (ADW300/ADW210), pinzas/clamps, habitaciones para sensores de confort (CO2, temp/hum, calidad de aire).
- **Mediciones**: lecturas de energía eléctrica (potencia, energía, tensión, corriente, THD), lecturas de confort/calidad de aire.
- **Alertas**: umbrales, alertas generadas, reportes por email/WhatsApp, no-data monitor.

## Diagrama conceptual

```
enterprise (1) ──< energy_headquarter (1) ──< electrical_panel
                        │
                        ├──< room ──< deviceairquality / indicatorroom
                        ├──< panelautomatizationzeia (relays/breakers)
                        ├──< power, billingdata, billingactive, billingcycle
                        └──< measurement_point ──< clamp_assignment ──< device
                                              ──< readings ──< alerts
```

## Tablas de negocio (clientes + monitoreo)

### accounts (usuarios y roles)
| Tabla | Descripción |
|---|---|
| `accounts_user` | Usuarios (email, nombre, género, flags: energy_monitoring, air_quality, thermal_comfort, superuser/staff) |
| `accounts_energymonitoringmodule` | Módulos del árbol de navegación (mptt; `lft/rght/tree_id`), con `frontend_url` e `icon_url` |
| `accounts_userenergymodule` | Asignación módulo↔usuario |
| `accounts_userenterpriserole` | Rol de usuario por empresa (`role`, `date_joined`) |
| `auth_group`, `auth_permission`, `authtoken_token` | Django auth + DRF tokens |

### enterprises (jerarquía de cliente)
| Tabla | Descripción |
|---|---|
| `enterprises_enterprise` | Empresa cliente (name, acronym, background_color) |
| `enterprises_energyheadquarter` | Sede (energy_provider, supply_number, tarifa, demandas máx. 6 meses, webhook home assistant, billing_data) |
| `enterprises_electricalpanel` | Tablero eléctrico (type trifasico/monofasico, `threads`, `is_main`, headquarter) |
| `enterprises_room` | Sala (headquarter) — para sensores de confort |
| `enterprises_measurementpoint` | Punto de medición (channel, type, key, capacity, monitoring_topology, límites threshold por día) |
| `enterprises_clampassignment` | Asignación pinza/clamp → dispositivo + punto (histórico con unassigned_at) |
| `enterprises_panelautomatizationzeia` | Panel de automatización (relays/breakers) |
| `enterprises_favoritepoint` | Puntos favoritos de usuario por empresa/sede |
| `enterprises_power` | Potencias instalada/contratada/máxima declarada por sede |
| `enterprises_billingdata` | Tarifas (cargos fijos, energía pico/valle, reactivos, moneda/unidades) |
| `enterprises_billingactive` | Tarifa activa por sede + tipo de facturación |
| `enterprises_billingpermission` | Permisos de facturación por código |
| `enterprises_billingcycle` | Ciclos de facturación (start/end, is_current) |
| `enterprises_headquartertariffpdf` | PDFs de factura/pliego por mes |

### devices
| Tabla | Descripción |
|---|---|
| `devices_device` | Analizadores de red (dev_eui, model ADW300/ADW210, phase_type, is_multichannel, channels, electrical_panel) |
| `devices_deviceairquality` | Sensores de calidad de aire (dev_eui, type_sensor, room) con alertas de no-data |
| `devices_indicatordevice` | Indicador activado por sensor de aire (numeric, alert_high, alert_missing, unit) |
| `devices_indicatorroom` | Indicador activado por sala |
| `devices_deviceindicator` | Indicador asignado a analizador de red |

### indicators
| Tabla | Descripción |
|---|---|
| `indicators_indicator` | Indicadores (name, abbreviation, is_active, unit_measure) |
| `indicators_unitmeasure` | Unidades de medida (abbreviation: °C, %, ppm...) |

### readings (telemetría)
| Tabla | Descripción |
|---|---|
| `readings_reading` | **Lectura eléctrica**: `values_per_channel` (jsonb[]), P/Q/S (kW/kvar/kVA), PF, F (frecuencia), EPpos/EPneg (kWh), EQpos/EQneg (kvarh), Ua/Ub/Uc/Uab/Ubc/Uac (tensión), Ia/Ib/Ic/In (corriente), THDU/THDI por fase; refs a device, measurement_point, clamp_assignment |
| `readings_readingairqualityandenergy` | Lecturas de calidad de aire (value, status_ica, indicator_device, room) |
| `readings_readingthermalcomfort` | Lecturas de confort térmico (room) |

### controls
| Tabla | Descripción |
|---|---|
| `control_devices_controldevice` | Dispositivos de control (dev_uid, state, room, controlled_device) |
| `control_devices_controldevicedata` | Datos del dispositivo de control (voltage, active_power, power_factor, power_consumed, current, state, time) |
| `control_devices_controlleddevice` | Catálogo de dispositivos controlados |

### alerts
| Tabla | Descripción |
|---|---|
| `alerts_alertthreshold` | Umbrales: alert_type (voltage_fluctuation, power_demand, current_monitoring, energy_monitoring, harmonic_distortion, unbalanced...), measurement (P_value, Uab_value...), scope (enterprise/sede/punto), email/whatsapp |
| `alerts_alert` | Alertas generadas (status, timestamp, value, subtipos, acuse, whatsapp/email reporting) |
| `alerts_commentalert` | Comentarios de usuarios sobre alertas |
| `alerts_energythresholdprofile` | Perfiles de límites técnicos (tolerancias de voltaje, THD, CUF/VUF, IQR, límites por día EPpos/EPneg, contrato) |
| `alerts_currentstatusreportschedule` | Horario de reportes de estado por umbral |
| `alerts_limitalert` | Alertas de límites de indicadores de sensores (room/device) |
| `alerts_nodatamonitor` | Monitor de equipos sin datos (timeout, reminders, status, down_since) |

### historical (snaoshots JSONB para histórico)
| Tabla | Contenido |
|---|---|
| `historical_readinghistory` | Snapshot JSONB de lecturas por panel |
| `historical_readinghistoryairqualityco2temphum` | CO2/temp/hum por room |
| `historical_readinghistoryenergyrelays` | Relays de energía por panel automatización |
| `historical_readinghistorythermalcomfortpersonsensor` / `...relaybraker` / `...temphum` | Confort por room/panel |

### Infra Django/Celery (no tocar por la app)
`django_migrations`, `django_content_type`, `django_admin_log`, `django_session`, `django_celery_beat_*`, `django_celery_results_*`, `pruebabruno` (tabla de prueba).

## Datos observados (dump 2026-08-17)
- 8 empresas con sedes activas: Sanna (San Borja, San Isidro, Salaverry), Oechsle Salaverry, Pizza Hut/Burger King/KFC Salaverry, Madam Tusan (Óvalo Gutierrez).
- ~50 analizadores ADW300/ADW210 activos (marca ZeIA), + dispositivos "falsos" (`*_falso` / `_false`) desactivados para pruebas.
- ~180 puntos de medición (monofásico/trifásico, 220V–460V, 20A–4000A).
- ~430 umbrales de alertas, mayormente voltage_fluctuation + current_monitoring.
- Fuentes: energía = EPpos/EPneg; corrientes y tensiones por fase; THD.
- Tablas `indicators_*`, `enterprises_room`, `devices_deviceairquality` están **vacías** en el dump (módulo de confort sin datos aún).

## Claves técnicas
- Todos los `id` son `BIGINT IDENTITY`; timestamps con timezone; `created_at`/`modified_at` en casi todas las tablas de negocio.
- FKs `DEFERRABLE INITIALLY DEFERRED` (patrón Django).
- Convención de nombres: `<app>_<model>`, columna FK = `<modelo>_id`, restricción = hash corto.
- JSONB: `values_per_channel` (readings), `data` (historical), `extra_parameter_overrides` (profiles).
