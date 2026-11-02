# Épica 2.3 · Circuito digital de rendición y control de efectivo

Historias de Taiga cubiertas: **#46, #47, #48, #49, #50**. Asignadas a Santiago.

| HU | Título | Actor | Dónde | Puntos |
|----|--------|-------|-------|--------|
| #46 | Declarar efectivo recaudado | Transportista | **Mobile** (app Expo) | Mobile 5 |
| #47 | Visualizar declaración de efectivo | Supervisor de efectivo | Desktop | DB & Desktop 2 |
| #48 | Aprobar rendición de efectivo | Supervisor de efectivo | Desktop | DB & Desktop 3 |
| #49 | Registrar diferencia en el efectivo físico | Supervisor de efectivo | Desktop | DB & Desktop 3 |
| #50 | Aprobar rendición con diferencia | Supervisor de efectivo | Desktop | DB & Desktop 3 |

## Escenarios y dónde se cumplen

| HU · Escenario | Cómo se cumple | Test |
|---|---|---|
| #46 E1 · Declaración enviada | En la app, "💵 Rendir efectivo" → monto (precargado con el efectivo cobrado) → *Declarar* → *Confirmar*. Aparece en el escritorio del supervisor, sección **Efectivo**. | backend `rendicionEfectivo.test.ts`, mobile `rendicion.test.ts` |
| #46 E2 · Sin conexión | La declaración se guarda en la cola del celular ("Declarado · sin sincronizar") y sale sola al volver la señal, después de los cobros. La clave de idempotencia evita duplicados. | ambos |
| #46 E3 · Fallo por ruta abierta | Con paradas pendientes en el celular, la pantalla bloquea la declaración y lista las paradas. El backend también lo valida (409 `VISITAS_PENDIENTES`). | ambos |
| #47 E1 · Visualización correcta | El listado y el detalle muestran el nombre del transportista, el monto declarado y la fecha de la hoja de ruta (además, el efectivo cobrado según el sistema). | backend, frontend `rendicionEfectivoService.test.ts` |
| #47 E2 · Declaración cancelada | El transportista la anula desde la app ("Anular declaración"). Si el supervisor intenta abrirla, el sistema responde 410 y el escritorio muestra "Declaración retractada". | backend, frontend, mobile |
| #48 E1 · Validación exitosa | Si lo contado es **exactamente** igual a lo declarado, aparece *Aprobar rendición*: queda `validada`, se cierra la hoja de ruta y los cobros en efectivo quedan validados. Con un centavo de diferencia no se puede aprobar como coincidente. | backend, frontend |
| #49 E1 · Registro de faltante | El supervisor carga el conteo (por billetes o el total). El sistema calcula el faltante o sobrante y exige una justificación escrita (10 caracteres como mínimo). Queda `con_diferencia`. | backend, frontend |
| #49 E2 · Valor negativo | Un valor negativo en el conteo bloquea el registro: el escritorio oculta los botones y el backend responde 400. | backend, frontend |
| #50 E1 · Aprobación con discrepancia | *Aprobar con diferencia* con monto y motivo: calcula la diferencia, queda `validada`, cierra la hoja de ruta y deja el descuadre asentado en `auditoria` (`descuadre: true`). | backend, frontend |

## Decisiones

- **D1 · Tabla existente.** Se reutiliza `rendicion_efectivo` del esquema original. La migración `007_rendicion_efectivo.sql` (idempotente) le agrega: transportista, fecha de declaración, clave de idempotencia, anulación, conteo de billetes (jsonb) y quién registró la diferencia. El servidor la aplica al iniciar, y `npm run db:migrate` también la aplica.
- **D2 · Estados.** `pendiente` (declarada) → `con_diferencia` (HU #49) → `validada` (HU #48 o #50). `anulada` cuando el transportista la retracta. Una hoja admite **una sola** rendición activa (índice único parcial), así que después de anular se puede volver a declarar.
- **D3 · Qué cuenta como "visita pendiente" (HU #46 E3).** Una visita está pendiente si tiene algún remito sin entregar ni rechazar, o si tiene importe a cobrar y no se cobró. En el celular es la pestaña "Por entregar", que ya incluye lo registrado sin señal.
- **D4 · Monto declarado.** La app lo precarga con el efectivo cobrado en la jornada, pero el transportista puede corregirlo: declara el dinero físico que lleva. Si difiere, la app avisa y el supervisor lo cuenta.
- **D5 · Cierre del circuito.** Aprobar, con o sin diferencia, pasa la hoja de ruta a `cerrada` y los cobros en efectivo de la rendición a `validado`. Al cerrarse, la hoja deja de aparecer en la app.
- **D6 · Anulación (HU #47 E2).** Se puede anular mientras la declaración está `pendiente`. Si el supervisor ya registró una diferencia, no se puede. La anulación también funciona sin conexión: se envía después de la declaración.
- **D7 · Conteo por billetes.** El escritorio permite contar billetes de $20.000 a $10, más monedas, o ingresar el total directamente. El backend verifica que el total coincida con el detalle.
- **D8 · Reconteo.** Si después de registrar una diferencia un nuevo conteo coincide, se puede aprobar sin diferencia.
- **D9 · Auditoría.** Declaración (`alta`), anulación (`anulacion`), diferencia (`modificacion`, con la justificación) y aprobación (`validacion`) quedan en `auditoria`.

## Supuestos (a confirmar con el cliente)

- **S1 · "Supervisor de efectivo".** Es el rol **Supervisor** del sistema. El Administrador del sistema también accede. El Administrativo ve "Efectivo" deshabilitado.
- **S2 · Sin filtro por sucursal.** El supervisor ve las rendiciones de todas las sucursales, como el resto de los módulos de escritorio hoy.
- **S3 · Diferencia en el escenario #49.** La HU #49 "registra" y la #50 "aprueba". Se modelaron como dos pasos: registrar deja la rendición abierta; aprobar con diferencia la cierra. También se puede aprobar con diferencia directamente, sin registrarla antes, porque la #50 pide monto y motivo igual.

## API

App móvil (rol Transportista):

- `POST /api/movil/rendicion` `{ hojaDeRutaId, declaradoCentavos, claveIdempotencia, declaradoEn }`
- `POST /api/movil/rendicion/anular` `{ claveIdempotencia, anuladaEn }`
- `GET /api/movil/hoja-de-ruta` ahora incluye `rendicion` y, por visita, `efectivoCobradoCentavos`.

Escritorio (roles Supervisor y Administrador del sistema):

- `GET /api/efectivo/rendiciones?estado=pendiente,con_diferencia&fecha=AAAA-MM-DD`
- `GET /api/efectivo/rendiciones/:id` (410 si fue retractada)
- `POST /api/efectivo/rendiciones/:id/aprobar` `{ rendidoCentavos, conteo? }` (HU #48)
- `POST /api/efectivo/rendiciones/:id/diferencia` `{ rendidoCentavos, conteo?, justificacion }` (HU #49)
- `POST /api/efectivo/rendiciones/:id/aprobar-con-diferencia` `{ rendidoCentavos, conteo?, motivo }` (HU #50)

## Cómo probarlo

1. `cd backend && npm run db:migrate && npm run db:demo-movil-reset && npm run dev`
2. App: entrar como `chofer`, entregar, rechazar o cobrar las 3 paradas → "💵 Rendir efectivo".
3. Escritorio: entrar como `supervisor` → **Efectivo** → abrir la declaración → contar → aprobar.
