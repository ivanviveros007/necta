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
