# App móvil del transportista · "Tutucas Reparto"

Expo (React Native + TypeScript). Es una app que se instala en el celular y trabaja sin conexión. Cubre la **HU #22** (entrega de remitos) y la **Épica 1.4 · Registro de cobro en el punto de entrega** (HU #25 a #29).
Usa **Expo SDK 57**: el Expo Go de Play Store todavía no soporta la SDK 58, que salió el 15/10/2026. Cuando la soporte, se puede actualizar con `npx expo install expo@latest --fix`.
Las reglas, decisiones y preguntas pendientes están en [`docs/requerimientos/epica-1.4-cobro-movil.md`](../docs/requerimientos/epica-1.4-cobro-movil.md).

## Qué hace

1. **Login** con el mismo usuario del sistema (solo rol Transportista).
2. **Hoja de ruta del día**: las visitas en orden, con el importe a cobrar de cada una. Se guarda en el celular para trabajar sin señal.
3. **Entrega de remitos** (HU #22): cada remito se confirma por separado, con la hora y el GPS. Sin GPS no se puede confirmar.
4. **Cobro de una visita**: importe de solo lectura con el desglose por marca, y registro en efectivo, por transferencia (con referencia obligatoria), por QR, o combinando varios medios. La suma tiene que ser exacta.
5. **Sin conexión**: la entrega y el cobro se guardan en el celular y se envían solos cuando vuelve la señal. El QR se deshabilita sin conexión. Los reenvíos no duplican cobros, porque cada pago lleva una clave de idempotencia.

Cobrar en efectivo por el total lleva 3 toques: abrir la visita → *Efectivo* (precarga el total) → *Confirmar*.

## Cómo correrlo

Primero el backend (en otra terminal):

```bash
cd backend
npm install
npm run db:init              # solo la primera vez: crea tutucas_db con schema.sql y seed.sql
npm run db:migrate-cobro-movil   # si la base ya existía antes de esta rama
npm run db:demo-movil        # hoja de ruta de HOY para el usuario "chofer"
npm run dev
```

Después la app:

```bash
cd mobile
npm install
cp .env.example .env         # y poner la IP de tu PC
npx expo start
```

Escaneá el QR con **Expo Go** en un Android, en la misma red Wi-Fi que la PC. Usuario de prueba: `chofer` / `Password123!`.

**Probar en la PC, sin celular:** `npx expo start --web` abre la app en el navegador. Para verla como en un teléfono, usá la vista de dispositivo móvil de las herramientas de desarrollador (F12). Si el backend no está en el puerto 3001, indicalo así: `EXPO_PUBLIC_API_URL=http://localhost:3101/api npx expo start --web`.
La hoja de demo trae tres visitas: una con dos marcas, una con un remito devuelto (que se descuenta del total) y una de un solo remito.
Para volver a dejarlas pendientes y probar de nuevo: `npm run db:demo-movil-reset` (en `backend/`).

## Tests

```bash
npm test          # reglas de cobro y cola de sincronización
npm run typecheck
```

Los tests de la API están en `backend/src/__tests__/cobroMovil.test.ts` (`cd backend && npm test`).

## Estructura

```
App.tsx                      navegación: login → hoja de ruta → visita
src/api.ts                   llamadas a /api/auth, /api/movil y /api/transportista
src/almacenamiento.ts        sesión, hoja guardada y cola (AsyncStorage)
src/useJornada.ts            carga la hoja y sincroniza al abrir o al volver la señal
src/ubicacion.ts             GPS del registro, con 4 s de espera máxima
src/dominio/                 reglas puras (sin React): importes, validación de cobro, estado de visita
src/sincronizacion/cola.ts   cola de entregas y cobros sin conexión
src/pantallas/               Login, HojaDeRuta, Visita (entrega + cobro)
```
