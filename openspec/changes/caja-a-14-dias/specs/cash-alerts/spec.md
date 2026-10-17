## ADDED Requirements

### Requirement: Revisión diaria y por cambios agrupados

El servidor SHALL revisar la proyección de cada tienda diariamente a las 07:00 de su zona horaria y
tras cambios relevantes, agrupando los cambios de una tienda en lotes de 30 segundos mediante una cola
persistida.

#### Scenario: Varios cambios seguidos
- **WHEN** se registran 5 operaciones de una tienda en 10 segundos
- **THEN** se ejecuta una sola revisión para esa tienda en el siguiente lote

#### Scenario: Reinicio del servidor
- **WHEN** el servidor reinicia con revisiones pendientes en la cola
- **THEN** las procesa al arrancar

### Requirement: Alertas persistidas y deduplicadas

El sistema SHALL crear una alerta cuando algún escenario tiene faltante, con clave de deduplicación
`storeId:shortfall:escenario:fecha`, y SHALL notificar de nuevo solo si cambia la fecha, sube la
severidad o el faltante empeora más de 10 %.

#### Scenario: Revisión repetida
- **WHEN** dos revisiones encuentran el mismo faltante del 1-jun por 590.000
- **THEN** existe una sola alerta y una sola notificación

#### Scenario: Empeora
- **WHEN** el faltante del 1-jun pasa de 590.000 a 900.000
- **THEN** la alerta se actualiza y se notifica de nuevo

#### Scenario: Se resuelve
- **WHEN** una revisión ya no encuentra faltante
- **THEN** la alerta pasa a `resolved` y el aviso persistente desaparece

### Requirement: Canales con respaldo

El sistema SHALL notificar por push si hay dispositivo y preferencia activa; si no hay dispositivo, no
hay permiso o el push falla, SHALL usar correo; y SHALL mostrar siempre el aviso persistente en app y
web. WhatsApp MUST NOT usarse en esta entrega.

#### Scenario: Sin app
- **WHEN** Carmen no tiene dispositivo registrado
- **THEN** la alerta se entrega por correo y aparece en la web

#### Scenario: Push sin recibo de entrega
- **WHEN** el ticket push se acepta pero el recibo indica error
- **THEN** la entrega push queda `failed` y se agenda correo

### Requirement: Reintentos observables y adaptadores simulados

Las entregas SHALL registrar estado, intentos, próximo intento, ticket y error, con reintentos de
espera exponencial; en local los adaptadores push y correo SHALL ser simulados y no enviar mensajes
reales.

#### Scenario: Falla temporal del correo
- **WHEN** el adaptador de correo falla una vez
- **THEN** la entrega queda `retry` con `nextAttemptAt` posterior y en el siguiente intento queda `sent`

#### Scenario: Observabilidad local
- **WHEN** se consulta `GET /v2/dev/notifications`
- **THEN** se ven las entregas simuladas con canal, estado e intentos

### Requirement: Sin consumo de créditos

La proyección y las alertas básicas MUST NOT consumir créditos de IA.

#### Scenario: Usuaria sin créditos
- **WHEN** Carmen tiene 0 créditos
- **THEN** la proyección y las alertas funcionan igual
