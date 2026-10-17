---
paths:
  - "apps/**/*"
  - "packages/**/*"
---
# Arquitectura y stack

Monorepo TypeScript con npm workspaces. API NestJS + Mongoose/MongoDB; web React + Vite; móvil React Native + Expo Router + Expo UI. TanStack Query en web y móvil para estado remoto; contratos Zod compartidos. Verificar versiones compatibles en documentación oficial antes de instalar.

- Screens y páginas solo componen UI y navegación. Sin cálculos financieros, acceso directo a base de datos ni requests dentro de ellas.
- Componentes por responsabilidad; hooks para comportamiento y coordinación; servicios y repositorios para red, persistencia y sincronización.
- `packages/cash-engine`: motor puro compartido entre API y móvil, sin UI, red o base de datos.
- `packages/contracts`: esquemas y tipos. Validar entradas en el servidor; los tipos no sustituyen autorización.
- SQLite es la fuente persistente de trabajo móvil. TanStack Query no sustituye la outbox; invalidar su caché después de reconciliar operaciones.
- Expo UI en controles adecuados; verificar plataformas y modo de ejecución. No asumir Expo Go. Web mantiene componentes React propios.
- Interfaz en español, montos COP legibles, contraste alto, controles grandes y uso con una mano. No comunicar estados únicamente por color.
- No incorporar un LLM ni RAG al cálculo inicial.
