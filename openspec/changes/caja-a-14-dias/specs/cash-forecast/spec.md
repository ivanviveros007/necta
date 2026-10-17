## ADDED Requirements

### Requirement: Ventana de 14 fechas locales

El sistema SHALL calcular la proyección para 14 fechas locales consecutivas en la zona horaria de la
tienda: la fecha de negocio actual y las 13 siguientes, con un saldo de cierre por día.

#### Scenario: Ventana del caso
- **WHEN** la fecha de negocio es 2026-05-25 en America/Bogota
- **THEN** la ventana va de 2026-05-25 a 2026-06-07 y contiene exactamente 14 días

#### Scenario: Fecha local distinta a UTC
- **WHEN** el instante actual es 2026-05-26T03:00:00Z y la tienda está en America/Bogota
- **THEN** la fecha de negocio es 2026-05-25

### Requirement: Saldo de referencia guardado con diferencia visible

El sistema SHALL partir de la suma de los saldos guardados de los bolsillos de la tienda en su moneda,
SHALL informar el saldo reconstruido y la diferencia, y MUST NOT corregir la diferencia de forma
automática.

#### Scenario: Diferencia del caso
- **WHEN** los bolsillos suman 1.900.000 guardados y 1.640.000 reconstruidos
- **THEN** la proyección parte de 1.900.000 y `reference.alignmentDelta` es 260.000

#### Scenario: Monedas distintas
- **WHEN** una usuaria tiene una tienda en COP y otra en USD
- **THEN** cada proyección usa solo bolsillos, deudas y compromisos de su tienda y moneda

### Requirement: Entradas esperadas explicables

El sistema SHALL incluir como entradas la base de ventas de contado confirmada por día de la semana y
los cobros programados de contrapartes puntuales; MUST NOT sumar cobros sin fecha confiable ni
extrapolar ingresos por porcentaje de captura. Un cobro es programado si su pendiente es > 0, vence
dentro de la ventana, no está vencido y la contraparte tiene ≥ 3 pagos en 6 meses con ≥ 80 % a
tiempo. Cada cobro incluido o excluido SHALL llevar la regla y los datos usados.

#### Scenario: Contraparte puntual
- **WHEN** Hotel Brisas debe 2.100.000 con vencimiento 2026-05-28 y pagó 6 de 6 a tiempo
- **THEN** el escenario esperado suma 2.100.000 el 2026-05-28 con base «6 de 6 a tiempo»

#### Scenario: Contraparte tardía
- **WHEN** Tienda La Esquina debe 850.000 con vencimiento 2026-05-26 y pagó 2 de 5 a tiempo
- **THEN** no suma al saldo y aparece en cobros sin fecha confiable con motivo `late_payer`

#### Scenario: Cuenta vencida
- **WHEN** Minimercado Sol debe 1.200.000 vencidos hace 20 días
- **THEN** no suma al saldo y aparece con motivo `overdue` y 20 días de atraso

#### Scenario: Grupo sin fechas individuales
- **WHEN** un saldo agrupado de 850.000 no tiene fecha de vencimiento individual
- **THEN** aparece con motivo `no_due_date` y su monto, sin fecha inventada ni marca de incobrable

### Requirement: Salidas incluyendo compromisos no registrados como deuda

El sistema SHALL restar cuentas por pagar pendientes en su vencimiento, compromisos únicos y
recurrentes cargados por la dueña y la base de gastos de contado de los días abiertos.

#### Scenario: Compromisos del caso
- **WHEN** existen proveedor 4.200.000 el 29, ayudantes 1.400.000 los días 15 y 30, arriendo 1.300.000
  el día 1 y cuota 650.000 el día 10
- **THEN** la ventana del 25-may al 7-jun resta 4.200.000 el 29-may, 1.400.000 el 30-may y 1.300.000 el
  1-jun, y no resta la cuota del 10-jun

### Requirement: Realizado reemplaza a lo previsto sin doble conteo

El sistema SHALL proyectar solo el pendiente de cada deuda, MUST NOT sumar una venta a crédito hasta
su cobro, y con `todayPolicy = fullDay` SHALL descontar de la base de hoy lo ya registrado hoy.

#### Scenario: Cobro parcial
- **WHEN** Hotel Brisas abona 500.000 hoy a su deuda de 2.100.000
- **THEN** el saldo de referencia sube 500.000 y el cobro programado del 28 es 1.600.000; el cierre del 28
  no cambia

#### Scenario: Venta de contado registrada hoy
- **WHEN** con corte al inicio del día la base es 260.000 y se registran 100.000 de ventas de contado hoy
- **THEN** el saldo sube 100.000 y la base restante de hoy es 160.000; el cierre de hoy no cambia

#### Scenario: Operación normal sin estimar hoy
- **WHEN** `todayPolicy = none`
- **THEN** hoy no suma base de ventas ni de gastos y mañana sí

### Requirement: Escenarios esperado y conservador

El sistema SHALL calcular un escenario esperado y uno conservador que es el esperado sin el cobro
programado de mayor monto, identificando ese cobro, y MUST NOT mostrar porcentajes de confianza.

#### Scenario: Caso completo esperado
- **WHEN** se proyecta el fixture del caso con corte al inicio del lunes 25
- **THEN** los cierres son 2.070.000 (25), 2.240.000 (26), 2.410.000 (27), 4.680.000 (28), 1.510.000
  (29), 540.000 (30), 540.000 (31), −590.000 (1-jun), −420.000, −250.000, −80.000, 350.000, 780.000 y
  780.000 (7-jun)

#### Scenario: Caso completo conservador
- **WHEN** se proyecta el mismo fixture en escenario conservador
- **THEN** se quita el cobro de Hotel Brisas, el cierre del 29 es −590.000 y el del 1-jun es −2.690.000

### Requirement: Primer faltante y estado

El sistema SHALL informar por escenario el primer día con cierre negativo, su monto y la salida que lo
provoca, y un estado global `covered`, `depends` o `short`.

#### Scenario: Estado del caso
- **WHEN** el esperado tiene faltante el 1-jun de 590.000 y el conservador el 29-may de 590.000
- **THEN** el estado es `short`, el primer faltante esperado es 2026-06-01 por 590.000 con causa
  «Arriendo bodega» y el conservador 2026-05-29 con causa «Proveedor principal»

#### Scenario: Cubierto
- **WHEN** ningún escenario tiene cierres negativos
- **THEN** el estado es `covered` y no hay primer faltante

### Requirement: Riesgo intradía

El sistema SHALL marcar un día cuando el cierre no es negativo solo gracias a un cobro programado del mismo
día (apertura + base neta < salidas comprometidas), porque el orden dentro del día es desconocido.

#### Scenario: Pago cubierto solo por un cobro del mismo día
- **WHEN** un día abre con 1.000.000, entra un cobro programado de 600.000 y sale un pago de 1.400.000
- **THEN** el cierre es 200.000 y el día tiene `intradayRisk = true`

#### Scenario: Viernes 29 del caso
- **WHEN** el 29 abre con 4.680.000, entran 600.000 de Doña Fina y salen 4.200.000 al proveedor
- **THEN** `intradayRisk` es false porque el saldo de apertura cubre el pago

### Requirement: Acciones con impacto calculado

El sistema SHALL recomendar acciones (confirmar cobro, cobrar primero, pedir plazo), cada una con su
impacto simulado sobre el escenario, ordenadas por la fecha del riesgo que mitigan; MUST NOT contactar a
terceros.

#### Scenario: Acciones del caso
- **WHEN** se proyecta el fixture del caso
- **THEN** la primera acción es confirmar el cobro de Hotel Brisas del 28; entre los cobros a priorizar
  Minimercado Sol aparece antes que Tienda La Esquina y su impacto elimina el faltante esperado; y
  aplazar el arriendo al menos 4 días evita el faltante del 1-jun

### Requirement: Trazabilidad del resultado

El sistema SHALL guardar con cada proyección confirmada la fecha de corte, la versión de datos
(`dataVersion`), los supuestos y el instante de cálculo.

#### Scenario: Snapshot
- **WHEN** el servidor calcula la proyección
- **THEN** se persiste un snapshot con `cutoff`, `dataVersion`, `assumptions` y `computedAt`

### Requirement: Motor puro compartido

El motor SHALL ser una función pura sin acceso a red, UI ni base de datos, usada por la API y por el
móvil con el mismo resultado para la misma entrada.

#### Scenario: Determinismo
- **WHEN** se ejecuta dos veces con la misma entrada
- **THEN** produce resultados idénticos
