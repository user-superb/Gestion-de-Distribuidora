// Ubicación del registro (D6). Si no hay GPS a tiempo, el cobro se guarda igual, "sin conexión GPS".
import * as Location from 'expo-location';
import type { Ubicacion } from './tipos';

// RNF: registrar un cobro en menos de 5 s (P90). No se espera al GPS más que esto.
const ESPERA_MAXIMA_MS = 4000;

export async function obtenerUbicacion(): Promise<Ubicacion | null> {
  try {
    const permiso = await Location.requestForegroundPermissionsAsync();
    if (permiso.status !== 'granted') return null;

    const actual = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const vencida = new Promise<null>((resolve) => setTimeout(() => resolve(null), ESPERA_MAXIMA_MS));
    const posicion = (await Promise.race([actual, vencida])) ?? (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }));
    if (!posicion) return null;

    return {
      latitud: posicion.coords.latitude,
      longitud: posicion.coords.longitude,
      precisionMetros: posicion.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}
