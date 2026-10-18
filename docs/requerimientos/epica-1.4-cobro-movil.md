# Épica 1.4 · Registro de cobro integrado en punto de entrega (app móvil)

Historias de Taiga cubiertas: **#25, #26, #27, #28, #29**. Actor: Transportista.
Fuentes: HU de Taiga, *Visión y Alcance v2* (12/09) y *Requerimientos no funcionales*.

## Historias

| HU | Título | Resumen |
|----|--------|---------|
| #25 | Visualizar importe de cobro | Importe total y por marca, solo lectura. Descuenta remitos rechazados o devueltos. Si no hay nada que cobrar, muestra $0,00 con la leyenda "Sin cobro en destino". |
| #26 | Cobro efectivo total | Efectivo por el monto exacto, liquida la visita. Funciona sin conexión. Rechaza un monto menor al exigido. |
| #27 | Cobro QR total | Registra que el comercio pagó por QR de Mercado Pago (ver decisión D2). |
| #28 | Cobro transferencia total | Referencia del comprobante obligatoria. Bloquea una referencia repetida para el mismo comercio en el mismo día. |
| #29 | Cobro combinado | Varios medios en una visita. La suma debe ser exacta: si no, se bloquea el botón y se muestra la diferencia. Funciona sin conexión salvo QR. |

## Decisiones tomadas

- **D1 · Stack móvil:** Expo (React Native + TypeScript), carpeta `mobile/`. Consume la API de `backend/` bajo `/api/movil`.
- **D2 · QR sin integración (cambio respecto de la HU #27).** El QR lo genera Mercado Pago por fuera de la app; la app solo registra que el pago fue por QR. Por eso **no aplican tal como están escritos** los escenarios de #27: E1 (consultar la API de la pasarela, mostrar el QR, asentar el ID de transacción) y E2 (timeout de 60 s). **Hay que actualizar la HU en Taiga.**
- **D3 · Un envío por visita.** La app manda todos los pagos de la visita juntos (uno solo si el cobro es total, varios si es combinado). El backend valida todo y lo guarda en una única transacción.
- **D4 · Idempotencia.** Cada pago lleva una `clave_idempotencia` (uuid) que genera el celular. Si se reenvía un cobro ya registrado, el backend devuelve el registro original sin duplicarlo: vale la primera sincronización (RNF).
- **D5 · Qué pasa al liquidar.** La visita pasa a `completada` con la ubicación, la fecha y la hora del registro. Los cobros quedan en `pendiente` y la imputación a remitos la hace conciliación en el escritorio. Los remitos de la visita que no fueron rechazados pasan a `entregado`, para que aparezcan en la bandeja de conciliación.
- **D6 · Ubicación.** Se toma del GPS del celular. Si no hay señal, se guarda `gps_disponible = false`, que es lo que pide el RNF de indicar "sin conexión GPS".
- **D7 · Auditoría.** Cada cobro se registra en la tabla `auditoria` con la acción `alta`.

## Supuestos (a confirmar)

- **S1 · Condición de cobro (#25 E2).** La Visión v2 dice *"El cobro es siempre contra entrega. No existe cuenta corriente ni cobro diferido"*, y el esquema no tiene un campo de condición de cobro. Por eso todos los remitos se tratan como contra entrega. "Sin cobro en destino" solo aparece cuando no queda ningún remito cobrable (por ejemplo, porque se rechazaron todos).
- **S2 · Remitos rechazados (#25 E3).** Se excluyen del importe los remitos en estado `no_entregado`, `devuelto` o `anulado`. Registrar el rechazo desde el celular **no** es parte de estas historias.
- **S3 · Referencia duplicada (#28 E2).** Se compara la referencia sin espacios y sin distinguir mayúsculas, contra los cobros por transferencia del mismo comercio en el mismo día (hora de Argentina). Sin conexión no se puede verificar: el control lo hace el backend al sincronizar y, si la rechaza, el cobro queda en la app marcado como **rechazado** para que el transportista lo corrija.
- **S4 · QR sin conexión.** Se mantiene la regla de #29 y del RNF: el medio QR se deshabilita sin conexión, aunque con D2 ya no haya pasarela.
- **S5 · Sesión vencida al sincronizar.** La sesión expira a los 30 minutos sin actividad. Si la cola sin conexión encuentra la sesión vencida, los cobros quedan guardados en el celular y se sincronizan después de volver a iniciar sesión. El backend no se modifica.
- **S6 · Monto mayor al exigido.** También se rechaza, porque #29 E3 exige igualdad exacta y #26 habla de "monto exacto".

## Preguntas pendientes para la próxima entrevista con Martín

1. ¿Existen comercios en cuenta corriente o con pago anticipado? La HU #25 E2 lo da por hecho, pero la Visión v2 lo descarta. Si existen, ¿la condición va en el comercio, en el remito o en la visita?
2. ¿Quién registra el rechazo o la devolución de un remito antes del cobro, y desde dónde? (La Visión v2 deja la "gestión de devoluciones" fuera de alcance.)
3. Si una transferencia cargada sin conexión resulta duplicada al sincronizar, ¿el transportista la corrige desde la app o lo resuelve un administrativo?
4. QR: ¿hace falta guardar algún dato del pago de Mercado Pago (por ejemplo, el número de operación) para conciliarlo después?
5. ¿El transportista puede cobrar más de lo exigido (por ejemplo, un vuelto o una deuda anterior)? Hoy se rechaza.

## Cambios en la base

Migración `backend/db/migrations/003_cobro_movil.sql` (también incorporada a `schema.sql`):

- Agrega `cobro.referencia_transferencia` y la vuelve obligatoria para las transferencias.
- Agrega un índice para buscar referencias por visita.
