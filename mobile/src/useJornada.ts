// Estado de la jornada: hoja de ruta (del servidor o guardada en el celular) y cola de cobros.
import { useCallback, useEffect, useState } from 'react';
import { obtenerHojaDeRuta } from './api';
import { colaCobros, guardarHoja, HojaGuardada, leerHoja } from './almacenamiento';
import { ErrorApi, ErrorRed } from './errores';
import type { CobroEnCola } from './sincronizacion/cola';
import type { Sesion } from './tipos';

export function useJornada(sesion: Sesion | null, enLinea: boolean, onSesionVencida: () => void) {
  const [guardada, setGuardada] = useState<HojaGuardada | null>(null);
  const [cola, setCola] = useState<Map<string, CobroEnCola>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!sesion) {
      setGuardada(null);
      return;
    }
    setCargando(true);
    try {
      const local = await leerHoja();
      if (local) setGuardada(local);

      if (enLinea) {
        const sincronizacion = await colaCobros.sincronizar();
        if (sincronizacion.sesionVencida) {
          onSesionVencida();
          return;
        }
        try {
          setGuardada(await guardarHoja(await obtenerHojaDeRuta(sesion.token)));
          setError(null);
        } catch (e) {
          if (e instanceof ErrorApi && e.status === 401) {
            onSesionVencida();
            return;
          }
          if (e instanceof ErrorApi && e.status === 404) setError(e.message);
          else if (!(e instanceof ErrorRed)) setError((e as Error).message);
        }
      }
      setCola(await colaCobros.estadoPorVisita());
    } finally {
      setCargando(false);
    }
  }, [sesion, enLinea, onSesionVencida]);

  // Al abrir la app y cada vez que vuelve la conexión: sincroniza y actualiza la hoja.
  useEffect(() => {
    recargar();
  }, [recargar]);

  return { guardada, cola, error, cargando, recargar };
}
