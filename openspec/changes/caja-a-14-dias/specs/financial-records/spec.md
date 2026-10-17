## ADDED Requirements

### Requirement: Contratos existentes preservados

El sistema SHALL aceptar `POST /v2/sale/batch`, `GET /v2/receivables/:id`,
`POST /v2/receivables/:id/payments` y `GET /v2/banks/:id/projection` con los nombres de campos del
anexo; las extensiones SHALL ser opcionales o aditivas.

#### Scenario: Venta a crédito sin vencimiento
- **WHEN** se registra por lote una venta sin pagos ni `expiresAt` con `saleDate` 2026-05-14
- **THEN** se crea una cuenta por cobrar con `creditDueBy` 2026-06-13 y `pendingAmount` igual al total

#### Scenario: Proyección de bolsillo
- **WHEN** se consulta `GET /v2/banks/bank_banco/projection` en la demo
- **THEN** responde `storedLedgerBalance` 1.300.000, `projectedBalance` 1.040.000 y `alignmentDelta` 260.000

### Requirement: Idempotencia por tienda

Toda operación que crea o cambia datos financieros SHALL llevar `clientMutationId`; el servidor SHALL
registrar `(storeId, clientMutationId)` con índice único y hash del payload en la misma transacción que
sus efectos.

#### Scenario: Reintento idéntico
- **WHEN** el mismo cobro con el mismo `clientMutationId` y payload llega dos veces
- **THEN** la deuda y el saldo cambian una sola vez y la segunda respuesta es `duplicate` con el resultado original

#### Scenario: Reintentos concurrentes
- **WHEN** dos requests idénticos llegan en paralelo
- **THEN** solo uno aplica efectos y ambos devuelven el mismo resultado

#### Scenario: Mismo ID con otro payload
- **WHEN** llega el mismo `clientMutationId` con otro monto
- **THEN** la API responde 409 `IDEMPOTENCY_PAYLOAD_MISMATCH` y no cambia ningún dato

#### Scenario: Respuesta perdida tras el commit
- **WHEN** la transacción se confirma y la respuesta no llega al cliente
- **THEN** el reintento devuelve el resultado guardado sin duplicar saldo, deuda ni movimiento

### Requirement: Cobros y pagos parciales consistentes

Un cobro o pago SHALL, en una transacción, reducir el pendiente, registrar el pago con fecha y bolsillo
y ajustar el saldo del bolsillo; MUST NOT registrarse además como ingreso independiente.

#### Scenario: Cobro parcial
- **WHEN** se registra un cobro de 300.000 en `bank_caja` a la deuda de Minimercado Sol de 1.200.000
- **THEN** el pendiente es 900.000, el saldo de caja sube 300.000 y no se crea un movimiento de ingreso

#### Scenario: Cobro mayor al pendiente
- **WHEN** se intenta cobrar 1.300.000 sobre un pendiente de 1.200.000
- **THEN** se rechaza con `PAYMENT_EXCEEDS_PENDING` y nada cambia

#### Scenario: Deuda cancelada
- **WHEN** se intenta cobrar sobre una deuda con pendiente 0
- **THEN** se rechaza con `DEBT_ALREADY_SETTLED`

### Requirement: Movimientos realizados sin fecha futura

Ventas de contado, ingresos, gastos, cobros y pagos realizados MUST NOT tener fecha posterior a la fecha
de negocio de la tienda.

#### Scenario: Gasto con fecha futura
- **WHEN** la fecha de negocio es 2026-05-25 y se registra un gasto con fecha 2026-05-26
- **THEN** se rechaza con `FUTURE_DATE_NOT_ALLOWED`

### Requirement: Carga histórica y conciliación

Un movimiento con fecha anterior a `balanceAsOf` del bolsillo SHALL completar el historial sin cambiar
el saldo guardado y SHALL reflejarse en la diferencia de conciliación; uno posterior SHALL cambiar el
saldo guardado.

#### Scenario: Copia del cuaderno
- **WHEN** el domingo se carga una venta de contado del miércoles anterior a `balanceAsOf`
- **THEN** el saldo guardado no cambia, el reconstruido sube y `alignmentDelta` baja en ese monto

#### Scenario: Corrección explícita
- **WHEN** la dueña ajusta el saldo de caja a un nuevo valor con motivo
- **THEN** se guarda un ajuste trazable, `balanceAsOf` pasa al instante del ajuste y la diferencia se recalcula

### Requirement: Versiones y borrado lógico

Las entidades editables SHALL tener `version` incrementada en cada cambio, `seq` por tienda y
`deletedAt` para borrados lógicos; el borrado de un movimiento SHALL revertir su efecto en el saldo.

#### Scenario: Borrar un gasto
- **WHEN** se borra un gasto de 90.000 con la versión correcta
- **THEN** el gasto queda con `deletedAt`, el saldo sube 90.000 y el cambio aparece en el pull

### Requirement: Anular un cobro o pago mal cargado

El sistema SHALL permitir anular un cobro o pago identificado por su `clientMutationId`: en una
transacción el pago queda marcado como anulado (sin borrarse), la deuda recupera el monto, el bolsillo
lo revierte y la puntualidad de la contraparte deja de contarlo. MUST NOT anular dos veces el mismo pago.

#### Scenario: Anular un cobro
- **WHEN** se anula el cobro de 600.000 de Tienda Doña Fina registrado hoy en caja
- **THEN** el pendiente vuelve a 600.000, la caja baja 600.000, el pago conserva `voidedAt` y la proyección vuelve a contar ese cobro el viernes 29

#### Scenario: Anulación repetida
- **WHEN** se intenta anular otra vez un pago ya anulado con otra operación
- **THEN** se rechaza con `PAYMENT_ALREADY_VOIDED` y nada cambia

#### Scenario: Datos que no coinciden
- **WHEN** la anulación llega con un monto distinto al del pago guardado
- **THEN** se rechaza con `VALIDATION_ERROR`

### Requirement: Reprogramar un cobro

El sistema SHALL permitir cambiar el vencimiento de una cuenta por cobrar con `baseVersion`, conservando
el vencimiento original para medir la puntualidad, y MUST NOT aceptar fechas anteriores a hoy ni deudas
saldadas.

#### Scenario: La clienta paga otro día
- **WHEN** Hotel Brisas pasa del 28-may al 2-jun
- **THEN** `creditDueBy` es 2026-06-02, `originalDueBy` es 2026-05-28 y el primer faltante esperado pasa al viernes 29

### Requirement: Corregir o borrar un ingreso o gasto

La dueña SHALL poder corregir monto, descripción y fecha (nunca futura) o borrar lógicamente un ingreso o
gasto con `baseVersion`. En el móvil, si el alta aún no se envió, la corrección MUST reemplazar la
operación pendiente en lugar de generar dos envíos.

#### Scenario: Corrección antes de sincronizar
- **WHEN** Carmen corrige sin señal un gasto que todavía no se envió
- **THEN** la outbox conserva una sola operación de alta con el valor corregido
