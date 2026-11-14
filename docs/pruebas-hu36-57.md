# Guía de prueba · HU #46 a #50, #55 a #57 (y #36 a #39)

Set de datos: `backend/db/demo_hu36_57.sql` (más `backend/db/demo_hu55_extracto.csv` para importar).
Verificado el 14/11/2026 sobre `main` (`0b450ee`), con PostgreSQL local, en el escritorio y en la app móvil.

## Cargar o reiniciar los datos

```bash
cd backend
npx tsx src/scripts/runSqlFile.ts db/demo_hu36_57.sql
```

Se puede correr todas las veces que haga falta: borra lo que quedó de la prueba anterior y vuelve a crear todo con fechas relativas a hoy.
Si además corrés `npm run db:demo-movil-reset`, corré este script **después**: ese reinicio borra todas las imputaciones.

## Usuarios

Todos usan la contraseña de la semilla (`backend/db/seed.sql`).

| Usuario | Rol | Para qué |
|---|---|---|
| `supervisor` | Supervisor | Arqueo y rendición de efectivo (HU #47 a #50) |
| `chofer` | Transportista | App móvil: entregar y cobrar (HU #46) |
| `admin` | Administrativo, sucursal Central | Conciliación y auditoría |
| `admin_sistema` | Administrador del sistema | Auditoría; segundo operador en los casos de concurrencia |
| `gerencia` | Gerente | Aprobar discrepancias. El script le pone un límite de $100.000 |
| `admin_sur` | Administrativo, Depósito Sur | Ver el estado vacío de sugerencias. Lo crea el script |

Las rutas de ejemplo para el arqueo son del transportista **Mario Flete** (`chofer2`).
Los códigos de hoja (HR-00xx) cambian en cada reinicio: buscá las rendiciones por transportista e importe.

---

## HU #46 · Declarar efectivo recaudado

**Cómo funciona hoy:** el chofer no declara nada en la app. Cuando la ruta queda sin paradas pendientes, el sistema genera la rendición con el efectivo cobrado, y aparece en la bandeja del supervisor la próxima vez que abre o actualiza **Efectivo**.

| Escenario de la HU | Cómo probar el comportamiento actual | Resultado |
|---|---|---|
| E1 · declaración enviada | En la app (`chofer`): entregá o rechazá las 3 paradas de hoy y cobrá en efectivo. En el escritorio (`supervisor`) → **Efectivo** → *Actualizar* | Aparece "Carlos Repartidor · Pendiente de conteo" con el total cobrado en efectivo. Atajo sin usar la app: las rendiciones de Mario Flete ($54.650 y $72.700) ya están generadas así |
| E2 · sin conexión | En la app sin señal: cobrá la última parada (queda "sin sincronizar"). Con la señal de vuelta, se envía sola | Recién después de sincronizar aparece la rendición en el escritorio |
| E3 · ruta abierta | `supervisor` → **+ Iniciar Arqueo**: buscá la hoja de Mario Flete con $16.800 | "⚠️ Tiene 1 parada(s) con remitos o cobros pendientes. Debe completarse antes del arqueo." No se genera sola; el supervisor puede usar *Forzar Arqueo Anticipado* |

## HU #47 · Visualizar declaración de efectivo

| Escenario | Pasos | Resultado |
|---|---|---|
| E1 · visualización | `supervisor` → **Efectivo** → clic en una rendición de Mario Flete | Transportista, "Efectivo declarado", fecha de la hoja de ruta, sucursal y el detalle de cobros en efectivo |
| E2 · declaración cancelada | No se puede probar: la app ya no tiene "Anular declaración" | Ver "Hallazgos" |

Escenarios propuestos para reemplazar el E2 (el sistema ya los cumple):

| Escenario propuesto | Pasos | Resultado |
|---|---|---|
| Sin declaraciones para el filtro | En "Fecha de la hoja", elegí una fecha sin rutas (por ejemplo 01/09/2026) | "No hay declaraciones de efectivo para este filtro." |
| Acceso sin permiso | Entrá como `admin` (Administrativo) | "Efectivo" figura deshabilitado ("Solo para el supervisor de efectivo"). Por la URL `/dashboard/efectivo` tampoco entra: queda en su pantalla de inicio |
| Rendición ya cerrada | Pestaña **Aprobadas** → abrir cualquiera | Solo lectura: resultado, monto contado, quién aprobó y cuándo. No ofrece conteo ni botones |

## HU #48 · Aprobar rendición de efectivo

| Escenario | Pasos | Resultado |
|---|---|---|
| E1 · validación exitosa | Rendición de Mario Flete de **$54.650** → *Ingresar total* → `54.650` (o contar billetes: 2 de $20.000, 1 de $10.000, 2 de $2.000, 1 de $500, 1 de $100, 1 de $50) → *Aprobar rendición* | "Coincide con lo declarado". Mensaje "Rendición de Mario Flete aprobada sin diferencias. La hoja … quedó cerrada." |
| Regla · exactitud | Antes de aprobar, probá `54.649,99` | "Faltante de $0,01" y desaparece *Aprobar rendición* |

Escenarios propuestos para sumar (el sistema ya los cumple):

| Escenario propuesto | Pasos | Resultado |
|---|---|---|
| Fallo por monto no coincidente | Cargá `54.600` en vez de `54.650` | "Faltante de $50". Desaparece *Aprobar rendición* y quedan *Registrar diferencia* y *Aprobar con diferencia* |
| Fallo por rendición ya procesada | Abrí la misma rendición en dos pestañas (`supervisor` y `admin_sistema`), cargá el conteo en las dos y aprobá en una; después aprobá en la otra | "La rendición ya fue aprobada y la hoja de ruta está cerrada." No se modifica nada |
| Conteo sin cargar | Abrí la rendición y no cargues nada | "Cargá la cantidad de billetes contados." y no hay botón para aprobar |

## HU #49 · Registrar diferencia en el efectivo físico

| Escenario | Pasos | Resultado |
|---|---|---|
| E1 · faltante | Rendición de Mario Flete de **$72.700** → *Ingresar total* → `70.000` | "Faltante de $2.700". Los botones quedan deshabilitados hasta escribir la justificación (10 caracteres como mínimo). *Registrar diferencia* → "Con diferencia registrada", con quién y cuándo |
| E2 · valor negativo | En *Contar billetes*, escribí `-2` en cualquier billete (o `-70000` en *Ingresar total*) | "Registro bloqueado: El conteo no admite valores negativos" y desaparecen los botones |

## HU #50 · Aprobar rendición con diferencia

| Escenario | Pasos | Resultado |
|---|---|---|
| E1 · con discrepancia | Sobre la rendición del paso anterior (ya trae el monto y el motivo cargados) → *Aprobar con diferencia* | "Rendición … aprobada con diferencia. El descuadre quedó asentado y la hoja … cerrada." Queda en la pestaña **Aprobadas** y en Auditoría → "Validaciones aprobadas" |

---

## HU #55 · Auditoría de importaciones

Auditoría: con `admin`, menú de perfil (arriba a la derecha) → **Auditoría**.

| Escenario | Pasos | Resultado |
|---|---|---|
| E1 · historial | Acción "Importaciones" → *Buscar* → *Ver detalle* | 3 importaciones de ejemplo (dos usuarios, una con todo duplicado): fecha, usuario, archivo, cuenta, nuevas y duplicados omitidos |
| E1 · en vivo | Conciliación → *Ingresar movimientos* → importar `backend/db/demo_hu55_extracto.csv` en "Cuenta operativa demo". Importalo dos veces | 1.ª vez: 3 nuevas y 1 duplicado. 2.ª vez: 0 nuevas y 4 duplicados. Las dos aparecen en la auditoría |
| E2 · sin resultados | Acción "Importaciones" + *Más filtros*: Desde 01/01/2026, Hasta 31/01/2026 | "No se registran importaciones para los criterios seleccionados." |

## HU #56 · Auditoría de validaciones

| Escenario | Pasos | Resultado |
|---|---|---|
| E1 · trazabilidad | Acción "Validaciones aprobadas" + rango de los últimos 10 días | La rendición con faltante de $5.000 (declarado $85.000, rendido $80.000), validada por Valeria Logística, con su justificación; y otra coincidente. Las que apruebes en las HU #48 y #50 se suman acá |
| E2 · rango inválido | "Desde" posterior a "Hasta" | "El rango de fechas es inválido: revisá el orden y evitá fechas futuras." El calendario no deja elegir fechas futuras |

## HU #57 · Filtrar auditoría por usuario

| Escenario | Pasos | Resultado |
|---|---|---|
| E1 · filtro por usuario | Correo del usuario `admin` (figura bajo "Martín Jirafales Coordinador" en la tabla) | Solo su actividad. Con Acción "Reasignaciones": 2 registros |
| E1 · anulaciones | Correo `chofer@tutucas.com.ar` + Acción "Anulaciones" | La anulación de ejemplo del chofer |
| E2 · inexistente | Correo `nadie.existe@tutucas.com.ar` | "El usuario no arrojó actividad para los criterios seleccionados." |

---

## Extra · HU #36 a #39 (conciliación)

Con `admin` → **Conciliación**. La referencia de cada movimiento (`DEMO36-E1`, etc.) dice a qué escenario pertenece.

| HU · Escenario | Pasos | Resultado |
|---|---|---|
| #36 E1 | `DEMO36-E1` ($15.000) → `D36-001`, `D36-002`, `D36-003` → *Conciliar selección* | "Movimiento conciliado…"; en **Historial**, el movimiento "Imputado" con 3 remitos saldados |
| #36 E2 | `DEMO36-E2` ($15.000) → `D36-004` + `D36-005` ($20.000) | "Saldo que queda pendiente: $5.000", justificación obligatoria y *Enviar justificación* → Bandeja de discrepancias |
| #36 E3 | `DEMO36-E2` → `D36-006` + `K37-003` (otro comercio) | "Todos los remitos deben pertenecer al mismo comercio. No elegibles: K37-003." |
| #37 E1 | `DEMO37-E1-A`, `-B`, `-C` → `K37-001` ($30.000) | Los 3 movimientos imputados y el remito saldado |
| #37 E2 | `DEMO37-E2-A` + `-B` ($38.400) → `K37-002` ($48.000) | **No queda "Cobro parcial"**: exige justificar el faltante; si Gerencia lo aprueba, el remito queda saldado con un ajuste |
| #37 E3 | `DEMO37-E3-A` + `-B` ($30.000) → `K37-003` ($25.000) | "Sobrante sin imputar: $5.000"; aprobado, queda como saldo a favor |
| #38 E1 y E2 | Pestaña **Sugerencias de imputación** | `P38-001`: verde "COINCIDENCIA EXACTA". `P38-002` y `P38-003`: ámbar "COINCIDENCIA PARCIAL" |
| #38 E3 | Entrar como `admin_sur` | "Sin coincidencias automáticas detectadas…" |
| #39 E1 | *Aceptar sugerencia* en `P39-001` | "Imputación realizada: P39-001 quedó saldado." |
| #39 E2 y E3 | Dos pestañas (`admin` y `admin_sistema`): aceptar la misma sugerencia (`P39-002`), o las dos de `P39-003` | "Hay movimientos que ya no están pendientes…" / "…remitos… ya saldados" |

## Hallazgos de la verificación

Arqueo y rendición (HU #46 a #50):

- **HU #46:** ninguno de sus tres escenarios ocurre en la app. La declaración la genera el sistema con el efectivo cobrado; el chofer no puede informar otro monto ni ve en la app cuánto efectivo tiene que entregar.
- **HU #47 E2:** la app ya no permite anular. Y si se anula por API, el sistema vuelve a generar el arqueo en la siguiente consulta.
- **Bug (corregido en la rama `fix/arqueo-automatico-borradores`):** el arqueo automático también tomaba hojas **en borrador o sin paradas** y les creaba una rendición de $0; al aprobarla se cerraba una ruta que se estaba armando. Ahora solo se arquean hojas despachadas y con paradas, tanto en forma automática como desde *+ Iniciar Arqueo*.
- **Texto (corregido en la misma rama):** el detalle decía "Declarado desde la app"; ahora dice "Arqueo generado por el sistema".
- **Riesgo:** *Forzar Arqueo Anticipado* seguido de una aprobación cierra la hoja aunque queden paradas pendientes; la hoja desaparece de la app del chofer.
- **Código sin uso:** el backend conserva `POST /api/movil/rendicion` y `/rendicion/anular`, con sus tests, pero la app no los llama.

Conciliación y scripts:

- **Bug:** aprobar una discrepancia de faltante con un movimiento y varios remitos da error 500 (`aplicarDiscrepancia` intenta guardar un ajuste de $0).
- **Bug:** `demo_movil_reset.sql` falla si existe un cobro por transferencia o QR de un día anterior.
- **HU #37 E2:** el sistema no maneja "Cobro parcial".
