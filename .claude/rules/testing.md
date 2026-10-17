---
paths:
  - "apps/**/*"
  - "packages/**/*"
---
# Pruebas y verificación

- Todos los componentes y screens tienen tests de comportamiento observable: contenido, interacción y estados relevantes. No depender solo de snapshots ni verificar detalles internos.
- API: Jest + Supertest. Web: Vitest + React Testing Library. Móvil: Jest + React Native Testing Library. Verificar compatibilidad del SDK y los runners.
- Motor: fixture completo de 14 días, ambos escenarios, corte temporal, conciliación, pagos parciales, recurrencias, movimientos históricos y ausencia de doble conteo.
- API: permisos entre tiendas, login cookie/Bearer, validación, idempotencia concurrente, transacciones y conflictos.
- Móvil: captura offline, reinicio, persistencia, dependencias, reconexión, token vencido, errores corregibles y resolución explícita.
- Web: aviso sin red, envío deshabilitado, formulario preservado, errores y actualizaciones.
- Integración real: cambio web → móvil; operación offline → reinicio → envío único; cobro parcial → caja/deuda/proyección consistentes; conflicto → resolución; riesgo → alerta local deduplicada.
- Usar bases exclusivas de pruebas; seed/reset nunca afectan bases ajenas. Los mocks de Expo UI no demuestran funcionamiento nativo: distinguir tests automatizados de revisión real en dispositivo.
- Ejecutar typecheck, tests y builds aplicables; corregir fallas. Registrar comandos, resultados y límites. Nunca afirmar una prueba de dispositivo o servicio no realizada.
