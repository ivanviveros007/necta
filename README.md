# Necta · Caja a 14 días

Responde la pregunta de la dueña de un pequeño negocio: **¿me alcanza la plata para lo que tengo que
pagar en las próximas dos semanas, qué tan firme es la respuesta y qué hago?** API, web y app móvil
offline-first con un mismo motor financiero.

- Especificación (entregable principal): [`openspec/changes/caja-a-14-dias/`](openspec/changes/caja-a-14-dias/)
  — `proposal.md`, `design.md` (decisiones, alternativas, contratos, diagramas Mermaid, fallas), `tasks.md`, `specs/*/spec.md`.

## Estructura

| Paquete | Qué es |
| --- | --- |
| `packages/cash-engine` | Motor puro (sin red, UI ni base): escenarios esperado/conservador, primer faltante, cobertura de pagos, acciones con impacto, operaciones pendientes, «Hoy». Lo usan API y móvil (y el resumen, también la web). |
| `packages/contracts` | Esquemas Zod de los contratos existentes y sus extensiones. |
| `apps/api` | NestJS 12 + MongoDB (replica set): JWT Bearer/cookie + CSRF, operaciones idempotentes y transaccionales, sync push/pull, socket `store.changed`, revisión programada y alertas simuladas. |
| `apps/web` | React 19 + Vite 8 + TanStack Query. Requiere conexión. |
| `apps/mobile` | Expo SDK 58 + Expo Router + Expo UI, SQLite + outbox, SecureStore. Offline-first. |

## Requisitos

- Node ≥ 22.12 (probado con 22.20) y npm 10.
- `mongod` 7+ en el PATH (probado con MongoDB Community 7.0.31, `brew install mongodb-community@7.0`). No hace falta Docker.
- Para el móvil: Xcode 26 y un iPhone o simulador. **No funciona en Expo Go** (usa Expo UI y SQLite): requiere *development build*.

## Puesta en marcha (comandos verificados)

```bash
npm install
npm run mongo:start          # MongoDB propio: puerto 27018, datos en .data/, replica set rs0 (no toca otras instancias)
cp apps/api/.env.example apps/api/.env
npm run build:api            # compila motor, contratos y API
npm run seed                 # siembra el caso «Limpia Ya» en la base necta_demo (borra solo datos de demo)
npm run dev:api              # http://localhost:3000  (escucha en 0.0.0.0 para el teléfono)
npm run dev:web              # http://localhost:5173  (proxy /v2 y /socket.io → API; cookie de mismo origen)
```

**Credenciales ficticias de demo:** `carmen@limpiaya.test` / `Necta2026!`

La demo fija la fecha de negocio en **lunes 25 de mayo de 2026** (`BUSINESS_DATE` en `apps/api/.env`) para
reproducir el caso; web y móvil lo marcan como «Fecha del caso». Sin `BUSINESS_DATE` se usa la fecha real de
la zona de la tienda.

### Móvil

```bash
cd apps/mobile
npx expo run:ios --device "Nombre del iPhone"   # o: npx expo run:ios  (simulador)
npm start                                         # Metro para el development build ya instalado
```

- La app usa `EXPO_PUBLIC_API_URL` si está definida; si no, la IP de la computadora que sirve Metro con el
  puerto 3000 (en un teléfono, `localhost` es el propio teléfono). Teléfono y computadora en la misma red.
- Firma: `appleTeamId` en `app.json`. La primera vez puede hacer falta que Xcode cree el perfil
  (`xcodebuild … -allowProvisioningUpdates`).
- Tras resembrar la base: en la app, **Sincronización → «Volver a descargar todo»** (se niega si hay registros sin enviar).

## Pruebas, typecheck y builds

```bash
npm test          # motor (Vitest) + contratos (Vitest) + API (Jest + Supertest, MongoDB real) + web (Vitest + RTL)
npm run typecheck # los cinco paquetes
npm run build -w @necta/web
npm run bench     # costo del motor por tienda
```

Resultados de la última corrida (17-oct-2026, M1 Pro, Node 22.20):

| Suite | Resultado |
| --- | --- |
| Motor | 63/63 |
| Contratos | 9/9 |
| API (base exclusiva `necta_test_api`) | 60/60 |
| Web | 59/59 |
| Typecheck (motor, contratos, API, web, móvil) | sin errores |
| Build web | OK |
| Benchmark motor | ~0,25 ms de CPU por tienda (10.000 tiendas ≈ 2,5 s), sin contar lecturas a MongoDB |

Notas:

- Las pruebas de la API usan la base `necta_test_api`. **No correr dos veces en paralelo**: comparten esa base.
- NestJS 12 se publica solo como ESM; en Node 22 Jest no hace `require(esm)`, así que `apps/api/test/esm-to-cjs.transformer.cjs`
  transpila esos paquetes y el script de test usa `--experimental-vm-modules` (el driver de MongoDB 7 carga `os` con `import()` dinámico).

## Verificación manual realizada

- **Navegador (Chrome, con la primera versión de la home):** login, home, gasto desde el botón +, detalle con escenario
  conservador, sin errores de consola. La home de datos actual se revisó con capturas de la persona usuaria.
- **iPhone 14 Pro (iOS 26.6.2), development build:** login, home de datos, hoja de cobro «Ya pagó», gasto cargado sin
  señal que llegó al servidor sin duplicarse (logs `[sync] push ok applied`). Probado por la persona usuaria en el dispositivo.
- No verificado en dispositivo: edición/anulación desde «Hoy», selector de fecha nativo, re-descarga completa.

## Límites conocidos (honestos)

- **Tests automatizados del móvil: no escritos.** Está listo el entorno (Jest + `jest-expo`, SQLite real vía `node:sqlite`,
  mocks de Expo UI/SecureStore), pero no hay suites. Los mocks de Expo UI no prueban el comportamiento nativo.
- **Tiempo real web → móvil** no medido en el teléfono (requiere la app en primer plano; con la app en segundo plano iOS
  cierra el socket y la app sincroniza al volver a primer plano).
- Solo se corrigen ingresos/gastos y cobros/pagos **de hoy** (desde «Hoy»); falta una lista de días anteriores.
- **Aplazar** un pago es solo una recomendación: no hay operación para mover la fecha de un pago o compromiso.
- Push y correo son **simulados** (`GET /v2/dev/notifications`); WhatsApp queda como evolución.
- Datos del caso ficticios; el historial de puntualidad se siembra como resumen (no se inventan pagos históricos).

## EAS Update (preparado, sin activar)

`apps/mobile/eas.json` define perfiles `development` / `preview` / `production` con canales homónimos y `app.json`
usa `runtimeVersion: { policy: "fingerprint" }`. **No hay `projectId` ni URL de updates**: no se inventaron. Para activar:

1. `npx eas-cli@latest login` y `npx eas-cli@latest init` (crea el proyecto y agrega `extra.eas.projectId`).
2. `npx eas-cli@latest update:configure` (agrega `updates.url`).
3. `npx eas-cli@latest build --profile preview` y luego `npx eas-cli@latest update --channel preview`.

Límite: un update OTA solo llega a builds con el mismo *fingerprint*; cualquier cambio nativo (módulos, permisos,
`app.json` nativo) exige un build nuevo.

## Despliegue propuesto (no ejecutado)

API en contenedores (Cloud Run / ECS) con MongoDB Atlas (replica set por transacciones); socket.io con adaptador Redis al
escalar; web estática en CDN con la API bajo el mismo sitio (cookie `SameSite=Lax`); revisión diaria en cola particionada
por zona horaria. Detalle en `design.md`.
