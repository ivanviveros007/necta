---
paths:
  - "apps/**/*"
  - "packages/**/*"
---
# Offline y sincronización

- Móvil offline-first para ventas, ingresos, gastos, cobros, pagos y ediciones. Guardar dato y outbox en una transacción expo-sqlite; sobrevivir al cierre/reinicio.
- Conservar clientMutationId y payload en reintentos. ID nuevo para una operación nueva; no modificar un payload que ya pudo procesarse.
- Enviar dependencias en orden, con un coordinador por cuenta/tienda. Pull incremental con cursor opaco, paginación y borrados lógicos. No avanzar cursor perdiendo cambios.
- Extender idempotencia del contrato de ventas al resto de operaciones, con índices únicos por tienda. Hacer atómicos efectos financieros y registro de idempotencia en MongoDB.
- Si se pierde la respuesta después del commit, repetir devuelve el resultado previo sin duplicar saldo, deuda ni movimiento.
- Versiones y escrituras condicionales para ediciones. Conflicto: conservar propuesta local y estado remoto para resolución explícita, sin sobrescritura silenciosa. Distinguir conflicto de versión de reutilización de ID con otro payload.
- Validar conflictos de negocio, incluidos pagos contra una deuda cancelada o insuficiente.
- Reintentar fallas temporales con espera creciente y jitter; pausar por sesión vencida y exponer validaciones/conflictos sin bucles infinitos.
- Sincronizar al abrir, volver a primer plano y reconectar. No prometer envío inmediato con la app cerrada.
- Motor local con datos confirmados y pendientes aplicados una vez; mostrar proyección provisional, última sincronización y conflictos. Reconciliar con servidor sin doble conteo.
- Eventos WebSocket avisan cambios: consultar/sincronizar e invalidar caché. Recuperar por pull al reconectar; eventos perdidos no pueden causar pérdida de datos.
- Web requiere conexión: aviso y envío deshabilitado sin red, formulario conservado mientras la página permanezca abierta, consulta actualizada al reconectar.
