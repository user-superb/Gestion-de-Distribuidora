# Épica 1.4 · Registro de cobro integrado en punto de entrega (app móvil)

Historias de Taiga cubiertas: **#25, #26, #27, #28, #29**. Actor: Transportista.
La app Expo también incluye la **HU #22** (confirmación individual de entrega de remitos), que implementó Florencia: ver *Integración con la HU #22*.
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

- **D1 · Stack móvil:** Expo (React Native + TypeScript), carpeta `mobile/`. Es una app que se instala en el celular y trabaja sin conexión. Consume la API de `backend/`: `/api/movil` para la hoja del día y el cobro, y `/api/transportista` para la entrega de remitos (HU #22).
- **D2 · QR sin integración (cambio respecto de la HU #27).** El QR lo genera Mercado Pago por fuera de la app; la app solo registra que el pago fue por QR. Por eso **no aplican tal como están escritos** los escenarios de #27: E1 (consultar la API de la pasarela, mostrar el QR, asentar el ID de transacción) y E2 (timeout de 60 s). **Hay que actualizar la HU en Taiga.**
- **D3 · Un envío por visita.** La app manda todos los pagos de la visita juntos (uno solo si el cobro es total, varios si es combinado). El backend valida todo y lo guarda en una única transacción.
- **D4 · Idempotencia.** Cada pago lleva una `clave_idempotencia` (uuid) que genera el celular. Si se reenvía un cobro ya registrado, el backend devuelve el registro original sin duplicarlo: vale la primera sincronización (RNF).
- **D5 · Qué pasa al cobrar.** Se guarda `visita.cobrada_en` con la hora del registro. Los cobros quedan en `pendiente` y la imputación a remitos la hace conciliación en el escritorio. El cobro **no** cambia el estado de la visita ni el de los remitos: eso lo maneja la entrega (HU #22), que pasa cada remito a `entregado` y cierra la visita (`completada`) cuando todos llegan a un estado final.
- **D6 · Ubicación.** El cobro guarda la ubicación del GPS si la hay, y si no se registra igual (RNF: "sin conexión GPS"). La entrega de remitos, en cambio, la exige (Regla 1 de la HU #22): sin GPS la app no la confirma.
- **D7 · Auditoría.** Cada cobro se registra en la tabla `auditoria` con la acción `alta`.

## Supuestos (a confirmar)

- **S1 · Condición de cobro (#25 E2).** La Visión v2 dice *"El cobro es siempre contra entrega. No existe cuenta corriente ni cobro diferido"*, y el esquema no tiene un campo de condición de cobro. Por eso todos los remitos se tratan como contra entrega. "Sin cobro en destino" solo aparece cuando no queda ningún remito cobrable (por ejemplo, porque se rechazaron todos).
- **S2 · Remitos rechazados (#25 E3).** Se excluyen del importe los remitos en estado `no_entregado`, `devuelto` o `anulado`. Registrar el rechazo desde el celular **no** es parte de estas historias.
- **S3 · Referencia duplicada (#28 E2).** Se compara la referencia sin espacios y sin distinguir mayúsculas, contra los cobros por transferencia del mismo comercio en el mismo día (hora de Argentina). Sin conexión no se puede verificar: el control lo hace el backend al sincronizar y, si la rechaza, el cobro queda en la app marcado como **rechazado** para que el transportista lo corrija.
- **S4 · QR sin conexión.** Se mantiene la regla de #29 y del RNF: el medio QR se deshabilita sin conexión, aunque con D2 ya no haya pasarela.
- **S5 · Sesión vencida al sincronizar.** La sesión expira a los 30 minutos sin actividad. Si la cola sin conexión encuentra la sesión vencida, los cobros quedan guardados en el celular y se sincronizan después de volver a iniciar sesión. El backend no se modifica.
- **S6 · Monto mayor al exigido.** También se rechaza, porque #29 E3 exige igualdad exacta y #26 habla de "monto exacto".

## Integración con la HU #22 (entrega de remitos)

Florencia implementó la HU #22 en la rama `mobile` como una pantalla web dentro del frontend (`MobileDispatchView`). El equipo decidió que la parte móvil sea **una app instalable que trabaje sin conexión**, así que la HU #22 se llevó a la app Expo:

- **Pantalla de visita** (`mobile/src/pantallas/VisitaPantalla.tsx`): arriba la entrega de remitos, uno por uno, y abajo el cobro. Si quedan varios remitos por entregar, hay un botón para confirmarlos todos juntos. Igual se envía una confirmación por remito, cada una con su hora y su GPS.
- **Backend:** se reusa tal cual la API de Florencia, `POST /api/transportista/remitos/:id/confirmar`.
- **Sin conexión:** la cola de la app (`mobile/src/sincronizacion/cola.ts`) guarda entregas y cobros y los envía en orden: la entrega llega antes que el cobro. La entrega conserva la hora en que se confirmó en el celular (HU #22 E2).
- **Choque que se corrigió:** la HU #22 deja la visita en `completada` al entregar todos los remitos, y el cobro rechazaba las visitas `completada` como "ya cobrada". Ahora el cobro usa su propio dato, `visita.cobrada_en`.
- `MobileDispatchView` (frontend web) **queda en el repo sin cambios**. Si se adopta la app, hay que decidir con el equipo si se saca.

### Pendientes para el equipo (no son preguntas al cliente)

1. **Seguridad de `/api/transportista`:** no exige sesión. Si no hay token usa por defecto al usuario 2, acepta `transportistaId` en el cuerpo y no verifica que el remito sea de la hoja del transportista. La app manda el token, pero conviene protegerla como `/api/movil`.
2. **GPS obligatorio en la entrega (Regla 1 de la HU #22) contra el RNF**, que pide guardar la operación indicando "sin conexión GPS". Hoy, sin GPS no se puede confirmar la entrega.
3. **¿Se puede cobrar antes de confirmar la entrega?** Ninguna HU lo prohíbe y hoy se permite.
4. **Dos endpoints de hoja de ruta:** `/api/transportista/hoja-activa` (Florencia) y `/api/movil/hoja-de-ruta` (cobro, con importes por marca). La app usa el segundo. Se podrían unificar.

## Correcciones de Martín (revisión del 24/10/2026)

Pedidos del cliente sobre la app y cómo quedaron. Las interpretaciones de los puntos ambiguos (2, 3, 5, 6 y 7) las decidió el equipo; conviene confirmarlas con Martín.

| # | Pedido | Cómo quedó |
|---|--------|------------|
| 1 | Sacar el detalle de remitos de la hoja de ruta | Las tarjetas de la hoja ya no tienen el desplegable de documentos: muestran la cantidad de remitos, las marcas y el total. |
| 2 | Al entrar, ver primero los remitos | Al tocar una parada se va directo a su pantalla, con los remitos arriba y el cobro abajo. Se sacó la pantalla intermedia "Detalle de parada". |
| 3 | En la pantalla de pagos, sacar la info del local | La pantalla de la parada muestra solo el nombre del comercio, sin domicilio ni otros datos. El cobro muestra el total y el desglose por marca. |
| 4 | Los remitos entregados, abajo | Los remitos por entregar van arriba y los resueltos (entregados o rechazados) abajo. |
| 5 | Elegir cuáles se entregan y rechazar los restantes | Cada remito pendiente tiene una casilla. Arrancan todos marcados y se desmarcan los que no se entregan. "Confirmar entrega (N)" confirma los marcados y "Rechazar restantes (M)" pide un motivo, el mismo para todos. |
| 6 | Navegar más fácil | Encabezado fijo con "‹ Hoja de ruta" y "↻ Actualizar", y el botón atrás de Android vuelve a la hoja. |
| 7 | Separar entregados y no entregados (2 pantallas) | La hoja de ruta tiene dos pestañas, "Por entregar" y "Entregadas". Una parada pasa a "Entregadas" cuando sus remitos están resueltos y ya se cobró, o no tiene nada que cobrar. Si se entregó pero falta el cobro, queda en "Por entregar" con la etiqueta "Falta cobrar". |
| 8 | Botón para actualizar | Botón "↻ Actualizar" en la hoja de ruta y en la parada, además de deslizar hacia abajo. |

Detalles de implementación:
- **Punto 5:** la API de entrega en lote (`/visitas/:id/confirmar-todo`, HU #23) confirma *todos* los pendientes de la visita, no solo los que se le mandan. Por eso la app la usa solo cuando están todos marcados. Si se eligió una parte, confirma cada remito por separado (`/remitos/:id/confirmar`, HU #22). Las reglas están en `mobile/src/dominio/organizacion.ts`.
- **HU #24 (rechazo):** la app enviaba `POST /api/transportista/remitos/:id/rechazar`, pero ese endpoint **no existía** y el servidor respondía 403, así que ningún rechazo llegaba a la base. Se implementó en `backend/src/services/rechazoService.ts`:
  - exige sesión de transportista y que el remito sea de su hoja;
  - guarda el motivo y la ubicación;
  - un reenvío no cambia el motivo original;
  - no permite rechazar un remito ya entregado;
  - cierra la visita como "Entregada con excepciones" (o `no_realizada` si se rechazó todo).

## Preguntas pendientes para la próxima entrevista con Martín

1. ¿Existen comercios en cuenta corriente o con pago anticipado? La HU #25 E2 lo da por hecho, pero la Visión v2 lo descarta. Si existen, ¿la condición va en el comercio, en el remito o en la visita?
2. ¿Quién registra el rechazo o la devolución de un remito antes del cobro, y desde dónde? (La Visión v2 deja la "gestión de devoluciones" fuera de alcance.)
3. Si una transferencia cargada sin conexión resulta duplicada al sincronizar, ¿el transportista la corrige desde la app o lo resuelve un administrativo?
4. QR: ¿hace falta guardar algún dato del pago de Mercado Pago (por ejemplo, el número de operación) para conciliarlo después?
5. ¿El transportista puede cobrar más de lo exigido (por ejemplo, un vuelto o una deuda anterior)? Hoy se rechaza.
6. Correcciones del 24/10: ¿las interpretaciones de los puntos 2, 3, 5, 6 y 7 (tabla de arriba) son lo que esperaba? En particular, ¿una parada entregada pero sin cobrar debe seguir en "Por entregar"?
7. ¿El domicilio del comercio debe verse en algún lado de la pantalla de la parada, o alcanza con verlo en la hoja de ruta?

## Cambios en la base

Migración `backend/db/migrations/003_cobro_movil.sql` (también incorporada a `schema.sql`):

- Agrega `cobro.referencia_transferencia` y la vuelve obligatoria para las transferencias.
- Agrega un índice para buscar referencias repetidas.
- Agrega `visita.cobrada_en`: cuándo se registró el cobro, separado del estado de la entrega.

Además, la HU #22 agregó en `schema.sql` las columnas `remito.entregado_por`, `remito.latitud` y `remito.longitud`. Una base creada antes de esa rama las tiene que agregar a mano: son `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
