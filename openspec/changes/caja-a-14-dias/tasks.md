## 1. Especificación y base del monorepo

- [x] 1.1 OpenSpec: proposal, design (decisiones, contratos, diagrama Mermaid, fallas), specs por capacidad y tasks; validar con `openspec validate`
- [x] 1.2 Monorepo npm workspaces con TypeScript 6.0, versiones verificadas contra registros oficiales
- [x] 1.3 MongoDB local en replica set de un nodo (puerto 27018, datos en `.data/`), health check y scripts start/stop

## 2. Contratos y motor

- [x] 2.1 `packages/contracts`: esquemas Zod de contratos existentes y extensiones (sesión, registro, compromisos, sync, proyección, alertas)
- [x] 2.2 `packages/cash-engine`: fechas locales, recurrencias, reglas de cobro programado, escenarios, primer faltante, riesgo intradía
- [x] 2.3 Motor: acciones con impacto simulado y orden por fecha de riesgo
- [x] 2.4 Motor: conclusión, supuestos y dependencias en español
- [x] 2.5 Fixture completo del caso y tests de los 14 días en ambos escenarios, corte, pagos parciales, recurrencias, histórico y doble conteo
- [x] 2.6 Motor: aplicación de operaciones pendientes para proyección provisional (una sola vez)

## 3. API

- [x] 3.1 NestJS base: config, conexión Mongo con verificación de replica set, `x-client-platform`, validación Zod, fecha de negocio
- [x] 3.2 Auth: login bcrypt + JWT, Bearer móvil, cookie HttpOnly + CSRF/origen web, `x-store-id` y aislamiento
- [x] 3.3 Operaciones: registro idempotente, contador `seq`, transacciones, versiones, borrado lógico, reglas de negocio
- [x] 3.4 Endpoints de registro: ventas por lote, movimientos, cobros/pagos, compromisos, base, bolsillos y ajuste
- [x] 3.5 Sync push/pull con cursor opaco, paginación, dependencias y conflictos
- [x] 3.6 Proyección: armado de entrada desde Mongo, snapshot, `GET /v2/forecast/14d`
- [x] 3.7 Gateway socket.io `store.changed` autenticado
- [x] 3.8 Revisión diaria + lotes, alertas deduplicadas, entregas push/correo simuladas con reintentos y recibos
- [x] 3.9 Seed/reset de demo exclusivos de la base `necta_demo` con el caso completo
- [x] 3.10 Tests API (Jest + Supertest, base exclusiva de pruebas): login cookie/Bearer, CSRF, permisos entre tiendas, validación, idempotencia concurrente, transacciones, conflictos, pull paginado, alertas

## 4. Web

- [x] 4.1 Vite + React + TanStack Query + React Router; cliente API con cookie y CSRF
- [x] 4.2 Login, home (conclusión, faltante, acción, saldo, gráfico), detalle con escenarios
- [x] 4.3 Formularios: ingreso/gasto, venta, cobro, pago, compromiso; sin red: aviso, envío deshabilitado, formulario conservado
- [x] 4.4 Socket `store.changed` → invalidación; refetch al reconectar
- [x] 4.5 Tests Vitest + RTL de todos los componentes y páginas

## 5. Móvil

- [ ] 5.1 Expo SDK 58 + Expo Router + Expo UI; development build; URL de API configurable para dispositivo físico
- [ ] 5.2 Sesión: login online, JWT en SecureStore, base SQLite por usuaria/tienda
- [ ] 5.3 Repositorios SQLite: entidades + outbox en una transacción, estado confirmado, meta
- [ ] 5.4 SyncCoordinator: orden, dependencias, backoff con jitter, 401 pausa, pull paginado, reconciliación sin doble conteo
- [ ] 5.5 Disparadores: abrir, primer plano, reconexión, socket, tras registrar
- [ ] 5.6 Pantallas: home, detalle, FAB + bottom sheet, formularios, sincronización/conflictos, alertas
- [ ] 5.7 Tests Jest + RNTL de componentes, screens, hooks y servicios (outbox, reinicio, dependencias, 401, conflictos)

## 6. Recorrido y verificación

- [ ] 6.1 Integración real: cambio web → móvil; offline → reinicio → envío único; cobro parcial consistente; conflicto → resolución; riesgo → alerta deduplicada
- [ ] 6.2 Verificación en navegador del recorrido web
- [ ] 6.3 Verificación en simulador iOS (development build) del recorrido móvil
- [ ] 6.4 Typecheck, tests y builds de todos los workspaces
- [ ] 6.5 Configuración EAS (perfiles, canales, runtimeVersion) sin identificadores inventados
- [ ] 6.6 README con comandos verificados, credenciales demo, seed/reset, límites; guion de video; benchmark del motor
