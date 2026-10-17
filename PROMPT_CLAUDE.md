# Encargo de implementación para Claude

Actuá como desarrollador full stack senior e implementá Necta «Caja a 14 días» hasta completar y verificar el recorrido funcional. No te limites a entregar un plan.


## Lectura inicial y fuentes

1. Leer `CLAUDE.md` y las tres reglas en `.claude/rules/` antes de diseñar.
2. Leer completo el PDF `/Users/bambam/Documents/coding/necta/Pruebas técnicas.pdf`, incluido el anexo. Si no está disponible, informar el bloqueo; no reconstruir contratos de memoria.
3. Leer `PROPUESTA.md`, fuente de decisiones y reglas financieras. Diferenciar acuerdos del candidato, políticas propuestas y requisitos explícitos del reto.
4. Trabajar en la raíz de este repositorio. En esta computadora: `/Users/bambam/Documents/coding/necta`.

Las convenciones técnicas viven en las reglas; el alcance funcional y las fases viven aquí. Evitar duplicarlas en nuevos documentos salvo referencias o escenarios verificables de OpenSpec.


## Resultado requerido

Monorepo TypeScript con npm workspaces:

- `apps/api`: NestJS, MongoDB con Mongoose, autenticación JWT, endpoints, sincronización y alertas locales.
- `apps/web`: React + Vite + TanStack Query, acceso con conexión obligatoria.
- `apps/mobile`: React Native + Expo + Expo Router + Expo UI (`@expo/ui`), TanStack Query, expo-sqlite y SecureStore. Offline-first para ventas, ingresos, gastos, cobros, pagos y ediciones.
- `packages/cash-engine`: motor financiero puro compartido por API y móvil, sin dependencias de UI, red ni bases de datos.
- `packages/contracts`: esquemas Zod y tipos compartidos.
- OpenSpec en `openspec/changes/caja-a-14-dias/` con proposal.md, design.md, tasks.md y specs por capacidad con escenarios WHEN/THEN.
- Diagrama Mermaid detallado con datos, responsabilidades, integraciones, fallas y recuperación.

Verificá versiones y compatibilidad con documentación oficial antes de instalar; no uses versiones supuestas. No agregues servicios o librerías que no aporten a este alcance.

## Recorrido funcional

1. Login email/contraseña con cuenta ficticia de Carmen sembrada. Contraseñas hasheadas; JWT con expiración. Móvil: Bearer y SecureStore. Web: cookie HttpOnly con protección de origen/CSRF y flags adecuados al entorno. Sin registro, recuperación ni refresh tokens. `x-client-platform` identifica plataforma, no autoriza.
2. Home con saldo actual, advertencia por diferencia de saldos, conclusión de caja a 14 días, fecha/monto del primer faltante, acción prioritaria y gráfico compacto del saldo con línea de cero y compromisos importantes.
3. Detalle diario y alternancia entre escenario esperado y conservador. Mostrar supuestos y dependencias concretas, sin porcentajes inventados de confianza.
4. FAB que abre bottom sheet de ingreso/gasto. Formularios adicionales para ventas, cobros, pagos y compromisos futuros/recurrentes. Evitar duplicar un cobro como ingreso independiente. Montos realizados no admiten fecha futura.
5. Operaciones móviles guardadas primero en SQLite con una outbox persistente y transacción local. Indicadores de pendientes, última sincronización, errores y conflictos. Persistencia al reiniciar.
6. Al recuperar conexión, enviar operaciones con IDs estables y dependencias ordenadas, obtener cambios incrementales y reconciliar. Misma operación repetida no duplica ningún efecto financiero. Conflictos de versión conservan ambas propuestas y requieren resolución explícita; también validar conflictos de negocio.
7. Proyección provisional local con el motor compartido, indicando pendientes. Reemplazar por resultado confirmado tras sincronizar sin sumar operaciones dos veces. JWT vencido pausa envío, no destruye pendientes ni impide captura local tras login previo.
8. Web sin red muestra aviso y deshabilita envío. Conservar formularios mientras la página esté abierta. Recuperar datos al reconectar.
9. Cambio web reflejado automáticamente en móvil conectado mediante evento WebSocket e invalidación/consulta; respaldo al volver a primer plano y reconectar. Los eventos no sustituyen el protocolo de sincronización.
10. Revisión diaria y por cambios relevantes con agrupación de lotes. Alertas persistidas y deduplicadas. Adaptadores de push/correo simulados localmente, con resultados y reintentos observables; no enviar mensajes reales. WhatsApp queda documentado como evolución.

## Cálculo y datos

Aplicá la política de PROPUESTA.md. Construí fixtures explícitos para el caso completo del PDF y verificá los 14 días. Guardá fecha de corte, versión de datos y supuestos del resultado. El saldo guardado no equivale a saldo verificado.

No codifiques nombres de clientes como reglas del motor. El fixture puede representar Brisas puntual y su retraso como prueba de estrés, mientras las reglas generales usan datos de cada cuenta. No inventes fechas individuales para el grupo agregado del anexo ni presentes su ausencia como cobro imposible.

Resolver saldo de referencia, carga histórica, pagos parciales, recurrencias, reemplazo de previsiones por realizados y límites del cálculo intradía. No extrapolar ingresos dividiendo por el porcentaje de registro. No entrenar modelos ni añadir un LLM/RAG; documentar futura extensión de voz para obligaciones confirmadas por la usuaria.

## Contratos y persistencia

Partí de los contratos existentes del PDF, preservando nombres de campos y su semántica. Definí y documentá extensiones necesarias para forecast, compromisos, recurrencias, sincronización, versiones y resolución de conflictos. Usá cursor opaco, paginación, borrados lógicos y respuestas por operación cuando corresponda.

MongoDB con índices únicos de idempotencia por tienda, escrituras condicionales por versión y transacciones para mantener consistencia de movimiento, saldo, cuenta y registro de operación. Una caída tras confirmar la transacción pero antes de responder debe permitir un reintento seguro. No confundir 409 por cambio de payload idempotente con conflicto de edición.

## Ejecución local

- Configuración reproducible de MongoDB local como replica set de un nodo, con health check y scripts de seed/reset exclusivos de datos de demo. Documentar requisitos; no borrar bases existentes.
- API y web locales; URL configurable para móvil en dispositivo físico. No asumir que localhost del teléfono es la computadora.
- `@nestjs/schedule` para revisión local, con estado y deduplicación persistentes en MongoDB. Documentar evolución a varios workers y costos por tienda sin inventar un presupuesto mensual.
- No publicar ni alterar gateway/ngrok o servicios vecinos. Los proyectos `/Users/bambam/Documents/coding/lexy`, `myFitnessCoach` y `hay-examen` solo son referencias de lectura si hacen falta.
- Preparar configuración futura de EAS Update, perfiles/canales y runtimeVersion. Usar projectId/URL reales únicamente si ya están disponibles; no inventar identificadores, crear proyectos remotos ni publicar OTA. Sin esos valores, la app local debe seguir funcionando. Documentar pasos de activación y límites frente a cambios nativos.

## Fases

1. Inspeccionar fuentes, producir OpenSpec, contratos, decisiones técnicas y diagrama. Dejar una lista ejecutable de tareas y continuar con implementación.
2. Crear monorepo, motor y fixtures con tests; persistencia, autenticación y API.
3. Web funcional y móvil funcional, componentes testeados, almacenamiento y sincronización.
4. Conectar recorrido completo, alertas locales y estados de falla; verificar en navegador y móvil disponible.
5. Ejecutar y corregir typecheck, pruebas y builds. Completar README, comandos de demo, límites de verificación y guía de video de hasta 10 minutos.

Actualizá tasks.md según avances reales. No marques tareas completas si no están verificadas. No sustituyas funcionalidad principal por mocks; los adaptadores externos de mensajería sí deben ser simulados.

## Criterios de finalización

Cumplir la matriz de `.claude/rules/testing.md` y los escenarios de OpenSpec. El recorrido principal debe funcionar con MongoDB y SQLite reales; simular únicamente proveedores externos de mensajería.

Entregar README con comandos reproducibles, credenciales ficticias locales, seed/reset seguro, configuración futura de EAS y límites conocidos. Registrar resultados reales de pruebas, typecheck, builds y verificación de interfaz.

Preparar un guion de video de hasta 10 minutos que cubra la solución, alternativas, evolución, prompts usados y una propuesta de IA corregida. Incluir ambas preguntas obligatorias del PDF. Dejar espacio para el tiempo real y la experiencia personal del candidato; no inventarlos.

Al terminar, resumir archivos principales, resultados comprobados y cualquier parte incompleta. No publicar.

