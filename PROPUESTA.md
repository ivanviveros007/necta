# Necta — propuesta consolidada

Estado: propuesta para implementar una aplicación funcional web y móvil con API local. Claude recibirá esta propuesta para generar OpenSpec, implementar, probar y documentar la solución.

## Objetivo

Responder si el negocio podrá cubrir sus compromisos durante los próximos 14 días, qué condiciones afectan la respuesta y qué acciones puede tomar su dueña. Detectar el primer faltante diario, no solo el saldo final.

## Decisiones acordadas

- Repositorio GitHub: https://github.com/ivanviveros007/necta. Acceso SSH con alias `github-work`: `git@github-work:ivanviveros007/necta.git`.
- Monorepo con API NestJS sobre Node.js, web React con Vite y móvil React Native con Expo y Expo UI (@expo/ui).
- MongoDB en el servidor y SQLite mediante expo-sqlite en el móvil.
- Móvil offline-first: ventas, ingresos, gastos, cobros, pagos y ediciones se guardan localmente, con pendientes persistentes y posterior sincronización.
- Web con conexión obligatoria: aviso sin red, envío deshabilitado y conservación del formulario mientras la página permanezca abierta.
- Partir del saldo guardado de COP 1.900.000 y mostrar la diferencia de COP 260.000 con el reconstruido; no corregirlo automáticamente.
- Escenario esperado y conservador, con supuestos visibles y sin porcentajes de confianza injustificados.
- Home con saldo disponible, conclusión de caja a 14 días, acción prioritaria y gráfico de saldo diario con acceso al detalle.
- Botón flotante para abrir un bottom sheet de ingreso o gasto. Distinguir movimientos realizados, compromisos futuros y cobros de deudas existentes.
- Screens livianas; componentes, hooks, servicios y repositorios separados. Todos los componentes, incluidas las screens, deben tener tests de comportamiento.
- Sin LLM en el cálculo inicial. Evolución futura: extender el registro por voz existente a obligaciones futuras y recurrentes, con confirmación humana.
- No incorporar datos comerciales de otras tiendas en la primera versión. Aislamiento por usuario, tienda y moneda.
- Proyección y alertas básicas sin consumo de créditos de IA.
- Ejecución local para demostrar el recorrido y grabar el video, sin publicación. Configuración de EAS Update preparada para activación futura, sin publicar actualizaciones.

## Política de cálculo propuesta

Estas reglas completan una propuesta implementable; no se presentan como requisitos explícitos del enunciado.

1. Ventana de 14 fechas locales: hoy y los 13 días siguientes. Ejemplo del caso: 25 de mayo a 7 de junio de 2026, America/Bogota.
2. El saldo de referencia lleva fecha y hora. Para la demostración, COP 1.900.000 al inicio del lunes 25. Los movimientos posteriores afectan caja; los anteriores completan el historial y requieren conciliación si no estaban incluidos. Una corrección de saldo se registra explícitamente y con trazabilidad.
3. Saldo diario = saldo anterior + entradas realizadas o previstas - salidas realizadas o previstas. No mezclar monedas. Importes en unidades monetarias enteras para COP.
4. En operación normal, usar el saldo actualizado al instante de consulta y estimar ventas desde mañana. Para hoy, no estimar ventas restantes automáticamente; permitir una previsión explícita de Carmen. En el ejemplo con corte al inicio del lunes, incluir la jornada completa. No extrapolar los registros multiplicándolos por el porcentaje de captura.
5. Ventas habituales del caso: COP 260.000 de lunes a jueves, COP 520.000 viernes y sábado, domingo cero. No incluir el aumento de quincena en el caso base hasta precisar su alcance. Gastos diarios de COP 90.000 los días abiertos como supuesto del ejemplo.
6. Escenario esperado del ejemplo: Brisas cobra el jueves y Doña Fina el viernes. No asignar fechas inventadas a Sol, La Esquina ni al grupo de otras tiendas; se mantienen visibles como cobros sin fecha confiable. Para producción, cada inclusión debe identificar una regla explicable y los datos utilizados; no codificar nombres particulares.
7. Escenario conservador inicial: mismo cálculo, desplazando el cobro de Brisas fuera de la ventana para mostrar la sensibilidad a esa dependencia. Es una prueba de estrés explícita, no un intervalo estadístico ni el peor caso posible.
8. Incluir proveedor, ayudantes y arriendo en sus fechas. Los dos últimos requieren confirmación o carga: el sistema no puede inferirlos del contrato existente. La cuota del día 10 queda fuera de esta ventana.
9. Cobros y pagos parciales actualizan el saldo y el pendiente. La parte realizada reemplaza a la prevista, sin descontarla o sumarla dos veces. Las ventas a crédito no aumentan caja hasta su cobro.
10. Un resultado diario representa el cierre estimado. Si cobro y pago coinciden en fecha y se desconoce el orden, advertir dependencia de horario: no garantizar liquidez intradía.
11. El teléfono usa el mismo motor puro que el servidor para generar una estimación provisional con operaciones pendientes. Al sincronizar se concilia contra la versión confirmada del servidor; los conflictos quedan identificados.

### Comprobación parcial del caso

Con los supuestos anteriores y ambos cobros puntuales: COP 1.510.000 al cierre del viernes, COP 540.000 el sábado y faltante de COP 590.000 el lunes 1. Sin Brisas: faltante de COP 590.000 al cierre del viernes y COP 2.690.000 el lunes 1. Son resultados condicionales: faltan cobros por ubicar y validar los supuestos. La tabla completa se prepara como fixture verificable.

## Alertas y acciones propuestas

- Detectar faltantes dentro de la ventana y dependencias relevantes de cobros. Priorizar confirmar Brisas y mostrar necesidades posteriores al pago del proveedor.
- Push según permisos y preferencias; correo como alternativa; aviso persistente en app y web. WhatsApp fuera del primer alcance porque requiere ampliar la integración y aprobar plantillas.
- Deduplicar avisos; notificar cambios significativos o escalamiento de urgencia. Registrar y reintentar fallas temporales; consultar recibos de Expo. No equiparar aceptación con entrega o lectura.
- Recomendar acciones con su impacto; no enviar mensajes a terceros ni negociar automáticamente.

## Autenticación y sesiones

El enunciado describe sesión por token en móvil, cookies en web y encabezado x-client-platform; no entrega un proveedor ni endpoints de login. Mantener estos mecanismos con una cuenta ficticia de Carmen sembrada para la demo, sin alta pública, recuperación ni proveedores externos.

Claude debe implementar login simple con email y contraseña, contraseñas hasheadas y JWT con vencimiento, usando una cuenta ficticia de Carmen sembrada para desarrollo. Sin registro público, recuperación ni refresh tokens. Token móvil guardado en SecureStore y JWT en cookie HttpOnly en web; configurar protección CSRF/origen y flags de cookies según entorno. La identidad y permisos se verifican en el servidor; el encabezado de plataforma no concede acceso. El primer ingreso requiere conexión; una sesión local previa permite trabajar offline y la sincronización requiere credenciales válidas. Si vence el JWT, permitir continuar localmente y pausar la sincronización hasta un nuevo login. Separar SQLite por usuario y tienda; cerrar sesión no debe borrar operaciones pendientes silenciosamente.

## Organización técnica

Las convenciones de arquitectura, pruebas y sincronización están en `.claude/rules/`. El encargo, stack detallado, contratos a extender, ejecución local y fases están en `PROMPT_CLAUDE.md`. Claude los transformará en OpenSpec verificable antes de implementar y mantendrá esa especificación actualizada.

## Evolución futura

Extender la extracción por voz existente para registrar obligaciones futuras y recurrentes con confirmación explícita. El motor conserva trazabilidad de datos y supuestos; se podrá evaluar su error contra resultados reales. No incorporar un LLM/RAG ni entrenamiento a esta entrega.

## Alcance de la entrega

Aplicación funcional web y móvil con API y MongoDB locales, datos ficticios del caso, OpenSpec, diagrama y video. No publicar web, API, binarios ni actualizaciones OTA. Configurar EAS Update para uso futuro sin requerir activarlo para la demostración. La documentación explica despliegue y escala como diseño, aunque la ejecución sea local. El tiempo real invertido se declara en el video, como pide el reto.
