## ADDED Requirements

### Requirement: Login con email y contraseña

El sistema SHALL autenticar con email y contraseña hasheada (bcrypt) y emitir un JWT con expiración;
MUST NOT ofrecer registro público, recuperación ni refresh tokens.

#### Scenario: Credenciales válidas en móvil
- **WHEN** `POST /v2/auth/login` con `x-client-platform: mobile` y las credenciales de demo
- **THEN** responde `accessToken` y `expiresAt`, sin cookie

#### Scenario: Credenciales válidas en web
- **WHEN** el mismo login llega con `x-client-platform: web`
- **THEN** responde con cookie `necta_session` HttpOnly, `SameSite=Lax`, `Secure` fuera de desarrollo, y cookie `necta_csrf`, sin token en el cuerpo

#### Scenario: Contraseña incorrecta
- **WHEN** la contraseña no coincide
- **THEN** responde 401 genérico sin revelar si el email existe

### Requirement: Protección de origen y CSRF en web

Las requests con cookie que cambian datos SHALL tener `Origin` en la lista permitida y `x-csrf-token`
igual a la cookie `necta_csrf`.

#### Scenario: Origen ajeno
- **WHEN** un POST con cookie válida llega con `Origin: https://evil.test`
- **THEN** responde 403

#### Scenario: Sin token CSRF
- **WHEN** un POST con cookie válida no trae `x-csrf-token`
- **THEN** responde 403

### Requirement: Plataforma identifica, no autoriza

El encabezado `x-client-platform` SHALL usarse para elegir el formato de sesión y para métricas, y
MUST NOT conceder acceso.

#### Scenario: Encabezado sin token
- **WHEN** una request trae `x-client-platform: mobile` sin token
- **THEN** responde 401

### Requirement: Aislamiento por tienda

Cada request SHALL indicar `x-store-id` y el servidor SHALL verificar que la tienda pertenece a la
usuaria autenticada.

#### Scenario: Tienda ajena
- **WHEN** Carmen consulta la proyección con el `x-store-id` de otra usuaria
- **THEN** responde 403 y no revela datos

### Requirement: Sesión móvil persistente y offline

El móvil SHALL guardar el JWT en SecureStore; el primer ingreso requiere conexión; con una sesión previa
SHALL permitir trabajar sin señal; un JWT vencido SHALL pausar la sincronización hasta un nuevo login.

#### Scenario: Abrir sin señal con sesión previa
- **WHEN** Carmen abre la app sin señal y ya había iniciado sesión
- **THEN** ve su última proyección y puede registrar operaciones

#### Scenario: Cerrar sesión con pendientes
- **WHEN** intenta cerrar sesión con 2 operaciones pendientes
- **THEN** la app advierte y conserva la base local con esos pendientes
