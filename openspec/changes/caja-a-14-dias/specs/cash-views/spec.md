## ADDED Requirements

### Requirement: Home que responde la pregunta

El home de app y web SHALL mostrar, en este orden: conclusión de caja a 14 días, primer faltante (fecha y
monto), acción prioritaria, saldo guardado con advertencia de diferencia, y un gráfico compacto del
saldo diario con línea de cero y compromisos importantes.

#### Scenario: Home del caso
- **WHEN** Carmen abre el home el 25-may
- **THEN** ve que el lunes 1 de junio le faltan $ 590.000, que el pago del viernes depende de Hotel Brisas, la acción «Confirma el pago de Hotel Brisas» y la advertencia de diferencia de $ 260.000

#### Scenario: Estado no solo por color
- **WHEN** hay faltante
- **THEN** el estado se comunica con texto e ícono además del color

### Requirement: Detalle diario y escenarios

La vista de detalle SHALL listar los 14 días con entradas, salidas y cierre, permitir alternar entre
escenario esperado y conservador, y mostrar supuestos, dependencias y cobros sin fecha confiable sin
porcentajes de confianza.

#### Scenario: Alternar escenario
- **WHEN** Carmen elige «Conservador»
- **THEN** el viernes 29 muestra −$ 590.000 y se explica que se quitó el cobro de Hotel Brisas

### Requirement: Registro rápido

Un botón flotante SHALL abrir un bottom sheet de ingreso o gasto; SHALL existir formularios de venta,
cobro, pago y compromiso; el cobro de una deuda MUST NOT registrarse como ingreso independiente.

#### Scenario: Gasto desde el FAB
- **WHEN** Carmen toca «+», elige Gasto, escribe 45.000 y guarda
- **THEN** el bottom sheet se cierra, el gasto aparece y la proyección se actualiza

#### Scenario: Ingreso que es un cobro
- **WHEN** elige Ingreso y marca que es pago de una clienta
- **THEN** se la lleva al formulario de cobro de esa deuda

### Requirement: Estado de sincronización visible

El móvil SHALL mostrar pendientes, última sincronización, errores y conflictos, y la proyección
provisional cuando hay pendientes.

#### Scenario: Pendientes
- **WHEN** hay 2 operaciones sin enviar
- **THEN** el home muestra «2 pendientes · proyección provisional» y la hora de la última sincronización

### Requirement: Legible al sol y con una mano

La interfaz SHALL usar alto contraste, montos COP legibles (`$ 1.900.000`), controles de al menos 48 dp y
acciones principales al alcance del pulgar.

#### Scenario: Formato de montos
- **WHEN** se muestra 1900000 COP
- **THEN** se lee «$ 1.900.000»
