# Guía de pruebas para la Demo — Conciliación Bancaria (Extractos, Transferencia Manual y Cobro QR Manual)

En esta carpeta (`ejemplos_extractos/`) se encuentran los archivos listos para probar en vivo las 3 historias de usuario en la vista **Conciliación bancaria**.

---

## 1. Importar un extracto bancario en archivo digital (`Importar extracto`)
* **`extracto_ejemplo_valido.csv`** y **`extracto_ejemplo_valido.xls`**:
  * **Escenario 1 (Importación exitosa con omisión de duplicados)**: Seleccioná la cuenta `Cuenta operativa demo` y subí cualquiera de los dos archivos. Vas a ver el resumen consolidado con registros nuevos insertados y duplicados omitidos. Si lo subís por segunda vez seguida, omitirá todos sin dar error.
* **`extracto_error_estructura.csv`**:
  * **Escenario 2 (Fallo por estructura o formato inválido)**: Le faltan columnas obligatorias (`concepto`, `referencia`). El sistema aborta antes de persistir datos y muestra la alerta.
* **`extracto_error_cuenta_inconsistente.csv`**:
  * **Escenario 3 (Fallo por cuenta inconsistente)**: Tiene CBU y moneda (`USD`) que no coinciden con la `Cuenta operativa demo` (`ARS`).

---

## 2. Cargar manualmente un movimiento de transferencia bancaria (`Cargar transferencia`)
Archivos de comprobante incluidos en esta carpeta para adjuntar en el campo **"Comprobante de respaldo (PDF/JPG/PNG)"**:
* **`comprobante_transferencia_valido.pdf`** (Documento PDF válido con cabecera `%PDF`).
* **`comprobante_transferencia_valido.png`** (Imagen PNG válida).

### Datos sugeridos para probar cada escenario en la Demo:
1. **ESCENARIO 1 — Carga manual exitosa con comprobante y conciliación**:
   * **Cuenta**: `Cuenta operativa demo`
   * **Fecha contable**: Fecha de hoy (viene precargada)
   * **Importe ($)**: `157000` (coincide exacto con los remitos entregados de *Mayorista El Sol S.R.L.*: `R-0001-45120` de \$150.000 + `R-0002-89310` de \$7.000, o `150000` para un solo remito)
   * **N° de operación / referencia**: `OP-MANUAL-9001`
   * **Comercio / ordenante**: Hacé clic en el campo, escribí `el so` y apretá `Tab` (o hacé clic en la opción desplegable) para que autocomplete **`Mayorista El Sol S.R.L.`**
   * **Comprobante de respaldo**: Adjuntá **`comprobante_transferencia_valido.pdf`** o **`comprobante_transferencia_valido.png`**
   * **Resultado**: Se guarda bajo la etiqueta azul **"Carga Manual"** en la bandeja de Movimientos pendientes, con botón para descargar su comprobante y listo para tildar y conciliar.

2. **ESCENARIO 2 — Fallo por fecha contable futura**:
   * Cambiá la **Fecha contable** por un día posterior a hoy (ej. mañana).
   * **Resultado**: El sistema bloquea el guardado, resalta en rojo el campo de fecha y notifica que no se admiten movimientos bancarios anticipados.

3. **ESCENARIO 3 — Fallo por comprobante u operación bancaria duplicada**:
   * Ingresá en **N° de operación / referencia** un código ya existente en esa cuenta, por ejemplo `OP-MANUAL-9001` (el que acabás de cargar) o `DEMO-E5-04-001` (que viene en la semilla inicial).
   * **Resultado**: El sistema impide la persistencia, resalta el campo de número de operación y alerta sobre la coincidencia en la misma cuenta.

---

## 3. Cargar manualmente un ingreso por cobro QR (`Cargar cobro QR`)
*(No requiere adjuntar archivo de comprobante; se homologa operativamente con el ID de transacción de la pasarela).*

### Datos sugeridos para probar cada escenario en la Demo:
1. **ESCENARIO 1 — Registro manual de ingreso QR exitoso**:
   * **Cuenta / billetera de acreditación**: `Cuenta operativa demo`
   * **Fecha contable**: Fecha de hoy
   * **Importe ($)**: `150000`
   * **ID de transacción (pasarela QR)**: `MP-QR-884422`
   * **Comercio / ordenante**: Escribí `el so` o `luna` y presioná `Tab` para autocompletar **`Mayorista El Sol S.R.L.`** o **`Autoservicio Luna`**
   * **Resultado**: Se incorpora a la bandeja de pendientes con la etiqueta violeta **"QR - Carga Manual"** y se habilita en la pestaña **Sugerencias de imputación** y en la conciliación manual bajo las mismas reglas de matching que una transferencia.

2. **ESCENARIO 2 — Fallo por ID de transacción QR duplicado**:
   * Intentá volver a registrar otro cobro QR con el mismo **ID de transacción**: `MP-QR-884422` (o `DEMO-E5-04-001`).
   * **Resultado**: Bloquea el alta, resalta el campo de ID de transacción e informa que el comprobante ya fue registrado para impedir dobles imputaciones.

3. **ESCENARIO 3 — Fallo por inconsistencia en fecha o importe**:
   * Ingresá un **Importe** igual a `0` o negativo (ej. `-500`) y/o una **Fecha contable** futura.
   * **Resultado**: El sistema detiene la operación, resalta en rojo los campos no válidos e impide el ingreso del comprobante a tesorería.
