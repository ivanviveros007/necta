# Caja a 14 días

## Why

Necta registra ventas, cobros, pagos y gastos, pero nada mira hacia adelante: los resúmenes muestran
totales por cobrar y por pagar sin ventana de fechas. Carmen Ortiz (Limpia Ya, Barranquilla) tiene
COP 1.900.000 guardados, COP 5.600.000 por cobrar y debe pagar COP 4.200.000 el viernes 29. Su
pregunta —«¿Me alcanza para pagarle el viernes, o le pido plazo? ¿A quién le cobro primero?»— no
tiene respuesta en la app. Sin esa respuesta, las usuarias se atrasan con proveedores o recurren a
préstamos informales caros para tapar huecos que se podían ver venir.

Además, Carmen opera casi siempre sin señal y registra solo 20–30 % de sus movimientos. Hoy la app
no guarda nada sin conexión, así que los datos llegan tarde o no llegan.

## What Changes

- **Proyección «Caja a 14 días»** (nuevo): saldo diario estimado de hoy a 13 días después, en dos
  escenarios explícitos (esperado y conservador), con el primer faltante diario, supuestos y
  dependencias visibles, y acciones recomendadas con su impacto calculado. Sin porcentajes de
  confianza inventados.
- **Motor financiero puro compartido** (`packages/cash-engine`) entre API y móvil, para que el
  teléfono calcule una proyección provisional sin señal y el servidor la confirme con el mismo
  código.
- **Compromisos futuros y recurrentes** (nuevo): pagos que Necta no conocía (ayudantes cada
  quincena, arriendo, cuotas de préstamo) y la base de ventas/gastos de contado habituales, cargados
  y confirmados por la dueña.
- **Móvil offline-first** (cambio de comportamiento): ventas, ingresos, gastos, cobros, pagos y
  ediciones se guardan en SQLite con una outbox persistente y se sincronizan sin duplicar.
- **Protocolo de sincronización** (nuevo): push idempotente por operación, pull incremental con
  cursor opaco, versiones por entidad y conflictos con resolución explícita. Extiende el patrón
  `clientMutationId` que ya existe en ventas por lote.
- **Revisión y alertas** (nuevo): revisión diaria y por cambios relevantes, alertas persistidas y
  deduplicadas, con push → correo como respaldo, más aviso persistente en app y web. Adaptadores
  simulados en local.
- **Sesiones**: login email/contraseña con JWT; Bearer en móvil (SecureStore), cookie HttpOnly con
  protección de origen y CSRF en web.
- **Avisos en tiempo real**: evento WebSocket que invalida datos en clientes conectados; no
  sustituye el protocolo de sincronización.

## Capabilities

### New Capabilities

- `cash-forecast`: cálculo de caja a 14 días, escenarios, faltante, supuestos y acciones.
- `cash-commitments`: compromisos futuros y recurrentes, y base de contado habitual.
- `financial-records`: ventas, ingresos/gastos, cobros y pagos parciales, saldo guardado vs
  reconstruido, con idempotencia y versiones.
- `offline-sync`: outbox móvil, push/pull, conflictos, sesión vencida y eventos en tiempo real.
- `cash-alerts`: revisión programada, alertas deduplicadas y canales con reintentos.
- `auth-sessions`: login, sesiones por plataforma y aislamiento por tienda.
- `cash-views`: experiencia en app y web (home, detalle, registro, estados sin red).

### Modified Capabilities

Ninguna especificación previa existe en este repositorio. Los contratos existentes del anexo
(`/v2/sale/batch`, `/v2/receivables/:id`, `/v2/receivables/:id/payments`,
`/v2/banks/:id/projection`, `/v2/push-notifications/*`, mensajería) se **preservan** con sus nombres
de campos y se extienden de forma compatible (ver `design.md`, «Contratos»).

## Goal

Que la dueña vea, con al menos una semana de anticipación y pese a datos incompletos, si su caja va
a cubrir lo que debe, qué tan firme es esa respuesta (de qué depende) y qué hacer: a quién cobrarle
primero y qué pago negociar.

**Medida de éxito propuesta** (a validar con producto): proporción de usuarias con un faltante
proyectado que registran una acción (cobro, aplazamiento confirmado) antes de la fecha del faltante;
error absoluto entre saldo proyectado y real a 7 y 14 días medido contra resultados reales.

## Scope

Dentro:

- API NestJS + MongoDB, web React/Vite, móvil Expo; monorepo local con datos ficticios del caso.
- Política de cálculo de `PROPUESTA.md`, fixture completo del caso y verificación de los 14 días.
- Outbox móvil, sincronización idempotente, conflictos, eventos en tiempo real.
- Revisión diaria y por cambios, alertas deduplicadas, push y correo **simulados**.
- Configuración futura de EAS Update sin identificadores inventados.

Fuera (y por qué):

- **WhatsApp para alertas**: requiere plantillas aprobadas y ampliar el servicio interno, que hoy
  solo envía OTP. Documentado como evolución.
- **LLM, RAG o modelos entrenados**: seis meses de datos de una tienda con 20–30 % de captura no
  sostienen un modelo estadístico honesto; un LLM no aporta al cálculo y agrega costo y variabilidad.
- **Datos de otras tiendas** (p. ej. cómo paga Hotel Brisas a otras distribuidoras): sin reglas de
  privacidad ni consentimiento existentes. Aislamiento estricto por usuaria, tienda y moneda.
- **Registro público, recuperación de contraseña, refresh tokens**: solo cuenta de demo sembrada.
- **Publicación** de API, web, binarios u OTA.
- **Aumento de quincena** en el caso base, hasta precisar su alcance.
- **Contacto automático a terceros**: Necta recomienda, no cobra ni negocia por la dueña.

## Impact

- Nuevas colecciones: compromisos, base de contado, registro de operaciones (idempotencia), log de
  cambios por tienda, snapshots de proyección, alertas, entregas de notificaciones, cola de revisión.
- Campos nuevos en entidades existentes: `version`, `seq`, `deletedAt`, `clientMutationId`.
- La app móvil pasa a requerir *development build* (Expo UI, SQLite), no Expo Go.
- Las proyecciones y alertas básicas **no consumen créditos de IA**.
