# Necta — instrucciones del proyecto

## Entrada

Este repositorio implementará «Caja a 14 días»: API, web y móvil funcionales para una demostración local.

Antes de implementar, leer `PROMPT_CLAUDE.md`, `PROPUESTA.md` y el PDF indicado en el prompt. No importar automáticamente toda la especificación en este archivo: consultar las fuentes según la fase.

## Responsabilidad de cada documento

- `CLAUDE.md`: orientación y convenciones permanentes.
- `PROMPT_CLAUDE.md`: encargo, recorrido esperado, fases y entregables.
- `PROPUESTA.md`: decisiones del producto, política financiera y supuestos del caso.
- `.claude/rules/architecture.md`: estructura de código y stack.
- `.claude/rules/testing.md`: pruebas y evidencia.
- `.claude/rules/offline-sync.md`: persistencia y sincronización.
- `openspec/changes/caja-a-14-dias/`: especificación y tareas que se crearán y mantendrán durante el trabajo.

Las reglas están acotadas por rutas. En la fase inicial de diseño, leer las tres explícitamente antes de escribir OpenSpec, aunque todavía no existan apps o packages.

## Convenciones esenciales

- Monorepo TypeScript: NestJS/MongoDB, React/Vite y Expo/SQLite.
- Móvil offline-first; web requiere red. Compartir el motor financiero entre API y móvil.
- Screens livianas; comportamiento en hooks y servicios. Todos los componentes y screens tienen tests.
- Resolver decisiones rutinarias y documentarlas. No reabrir acuerdos; corregir contradicciones con fundamento y pruebas.
- Mantener OpenSpec alineado con la implementación. Marcar tareas completas solo con evidencia real.
- No inventar datos, precisión estadística, IDs de EAS ni resultados de pruebas.

## Entorno y Git

- Repositorio: https://github.com/ivanviveros007/necta
- SSH: `git@github-work:ivanviveros007/necta.git`.
- Revisar estado y remotos antes de actuar; conservar documentos y cambios existentes. No asumir que Git continúa vacío.
- No clonar encima, hacer reset destructivo, force push ni cambiar configuración global o claves.
- Trabajar dentro de este proyecto. Referencias vecinas son de solo lectura.
- Ejecución local. No publicar servicios, binarios, OTA ni crear proyectos remotos. No hacer push ni crear PR sin instrucción posterior.
- Secretos en variables de entorno; ejemplos sin credenciales reales. No imprimir secretos.

## Comandos

Todavía no hay implementación ni comandos verificados. Al crear los workspaces, documentar en README los comandos reales de instalación, inicio, seed/reset de demo, typecheck, tests y builds. Actualizar esta sección con comandos comprobados, sin inventarlos.
