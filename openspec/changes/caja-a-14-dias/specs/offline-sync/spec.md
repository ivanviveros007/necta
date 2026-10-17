## ADDED Requirements

### Requirement: Captura local transaccional

La app móvil SHALL guardar ventas, ingresos, gastos, cobros, pagos, compromisos y ediciones en SQLite,
escribiendo la entidad y su fila de outbox en una sola transacción, con o sin señal.

#### Scenario: Gasto sin señal
- **WHEN** Carmen registra un gasto sin señal
- **THEN** el gasto aparece en la lista, la outbox tiene 1 pendiente y la proyección se marca provisional

#### Scenario: Reinicio
- **WHEN** cierra y vuelve a abrir la app antes de sincronizar
- **THEN** el gasto y la operación pendiente siguen presentes

### Requirement: Proyección provisional sin doble conteo

La app SHALL calcular con el motor compartido la proyección sobre el último estado confirmado más los
efectos de operaciones no reconciliadas, aplicados una vez, y SHALL reemplazarla por la confirmada
tras sincronizar.

#### Scenario: Antes y después de sincronizar
- **WHEN** hay un cobro pendiente de 300.000 y luego se sincroniza
- **THEN** antes y después del pull el saldo muestra +300.000 una sola vez

#### Scenario: Aplicado pero no traído
- **WHEN** el push devuelve `applied` con `seq` 57 y el último cursor es 56
- **THEN** el efecto local sigue contando hasta que el pull alcanza el `seq` 57 y se borra de la outbox en la misma transacción

### Requirement: Envío ordenado con dependencias

El coordinador SHALL enviar operaciones en orden de creación, un coordinador por usuaria y tienda, y
SHALL respetar `dependsOn`.

#### Scenario: Venta y cobro offline
- **WHEN** se crea offline una venta a crédito y luego un cobro sobre esa venta
- **THEN** se envían en ese orden y el cobro se aplica a la cuenta generada

#### Scenario: Dependencia rechazada
- **WHEN** la venta es rechazada por validación
- **THEN** el cobro queda `blocked` y no se reintenta en bucle

### Requirement: Pull incremental con cursor opaco

El servidor SHALL entregar cambios con `seq` mayor al cursor, paginados, incluyendo borrados lógicos,
y el cliente MUST NOT avanzar el cursor sin persistir la página.

#### Scenario: Paginación
- **WHEN** hay 450 cambios y `limit` = 200
- **THEN** se reciben 3 páginas con `hasMore` true, true, false y ningún cambio se omite

#### Scenario: Cursor inválido
- **WHEN** el cursor no es decodificable
- **THEN** la API responde 400 `INVALID_CURSOR`

### Requirement: Conflictos explícitos

Una edición con `baseVersion` desactualizada SHALL devolver `conflict` con el estado remoto; la app
SHALL conservar ambas propuestas y pedir resolución explícita.

#### Scenario: Usar la mía
- **WHEN** Carmen elige su versión en un conflicto
- **THEN** se crea una operación nueva con `baseVersion` remota y su cambio, y la operación en conflicto se descarta

#### Scenario: Usar la del servidor
- **WHEN** elige la versión remota
- **THEN** la entidad local queda igual a la remota y la operación se descarta

### Requirement: Reintentos y sesión vencida

Las fallas temporales SHALL reintentarse con espera exponencial y jitter; un 401 SHALL pausar el envío
sin borrar pendientes ni impedir captura local.

#### Scenario: JWT vencido
- **WHEN** el push responde 401
- **THEN** la sincronización queda en `auth_expired`, la outbox se conserva, se puede seguir registrando y tras un nuevo login se envía todo una sola vez

#### Scenario: Error de validación
- **WHEN** una operación es `rejected`
- **THEN** se muestra con su motivo, no se reintenta y la dueña puede corregirla con una operación nueva

### Requirement: Disparadores de sincronización

La app SHALL sincronizar al abrir, al volver a primer plano, al recuperar red, tras un registro con red y
al recibir un evento `store.changed`; MUST NOT prometer envío con la app cerrada.

#### Scenario: Cambio desde la web
- **WHEN** la web registra un cobro y el móvil está conectado
- **THEN** el móvil recibe `store.changed`, hace pull y refresca la proyección sin acción de la usuaria

#### Scenario: Evento perdido
- **WHEN** el móvil estaba desconectado del socket durante el cambio
- **THEN** al reconectar o volver a primer plano hace pull y obtiene el cambio

### Requirement: Web con conexión obligatoria

La web SHALL mostrar un aviso sin red, deshabilitar el envío y conservar el formulario mientras la
página esté abierta, y SHALL volver a consultar al reconectar.

#### Scenario: Pierde la red con el formulario lleno
- **WHEN** la web pierde la red con un gasto a medio cargar
- **THEN** aparece «Sin conexión», el botón Guardar se deshabilita y el formulario conserva sus valores
