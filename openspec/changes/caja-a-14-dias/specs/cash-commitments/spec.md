## ADDED Requirements

### Requirement: Compromisos únicos y recurrentes

El sistema SHALL permitir crear, editar y borrar lógicamente compromisos de entrada o salida con
monto, concepto, marca `negotiable` y calendario único (`once`) o mensual por días del mes
(`monthly`), con fecha de inicio y fin opcional.

#### Scenario: Ayudantes cada quincena
- **WHEN** la dueña crea un compromiso de salida de 1.400.000 mensual los días 15 y 30
- **THEN** la proyección del 25-may al 7-jun lo resta el 30-may

#### Scenario: Día inexistente en el mes
- **WHEN** un compromiso mensual del día 30 se evalúa en febrero
- **THEN** se aplica el último día de febrero

#### Scenario: Compromiso fuera de vigencia
- **WHEN** un compromiso tiene `endDate` 2026-05-20
- **THEN** no aparece en la ventana que empieza el 25-may

#### Scenario: Monto inválido
- **WHEN** se envía un compromiso con monto 0 o negativo o con días fuera de 1–31
- **THEN** la API responde 400 con el campo inválido y no se guarda

### Requirement: Base de contado habitual confirmada

El sistema SHALL guardar por tienda la base de ventas y gastos de contado por día de la semana,
editable por la dueña, y la proyección SHALL mostrarla como supuesto.

#### Scenario: Base del caso
- **WHEN** la base es 260.000 lun–jue, 520.000 vie–sáb, 0 dom y 90.000 de gastos los días abiertos
- **THEN** la proyección suma 170.000 netos un martes, 430.000 un sábado y 0 un domingo

#### Scenario: Sin base cargada
- **WHEN** la tienda no tiene base
- **THEN** la proyección no suma ventas habituales y lista el supuesto faltante «Carga tus ventas de contado habituales…»

### Requirement: Supuestos pendientes de confirmación

El sistema SHALL listar como supuesto cada compromiso cargado por la dueña y advertir cuando no hay
compromisos recurrentes cargados.

#### Scenario: Sin recurrentes
- **WHEN** la tienda no tiene compromisos recurrentes
- **THEN** la proyección incluye el supuesto «No cargaste pagos fijos (arriendo, sueldos, cuotas)…»

### Requirement: Ediciones con versión

Las ediciones de compromisos y de la base SHALL incluir `baseVersion` y escribirse solo si coincide.

#### Scenario: Edición concurrente
- **WHEN** la web edita el arriendo a versión 2 y el móvil envía una edición con `baseVersion` 1
- **THEN** el móvil recibe `conflict` con la versión remota y su propuesta queda pendiente de resolución
