// Estado de la jornada: hoja de ruta (del servidor o guardada en el celular) y cola de entregas y cobros.
import { useCallback, useEffect, useState } from 'react';
import { obtenerHojaDeRuta } from './api';
import { borrarHoja, colaOperaciones, guardarHoja, HojaGuardada, leerHoja } from './almacenamiento';
import { esHojaOperativaVigente } from './dominio/parada';
import { ErrorApi, ErrorRed } from './errores';
import type { ColaPorClave } from './dominio/estadoVisita';
import type { Sesion } from './tipos';

export function useJornada(sesion: Sesion | null, enLinea: boolean, onSesionVencida: () => void) {
  const [guardada, setGuardada] = useState<HojaGuardada | null>(null);
  const [cola, setCola] = useState<ColaPorClave>(new Map());
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
      if (local && esHojaOperativaVigente(local.hoja)) {
        setGuardada(local);
      } else if (local && !esHojaOperativaVigente(local.hoja)) {
        await borrarHoja();
        setGuardada(null);
      }

      if (enLinea) {
        const sincronizacion = await colaOperaciones.sincronizar();
        if (sincronizacion.sesionVencida) {
          onSesionVencida();
          return;
        }
        try {
          const hojaServidor = await obtenerHojaDeRuta(sesion.token);
          if (hojaServidor && esHojaOperativaVigente(hojaServidor)) {
            setGuardada(await guardarHoja(hojaServidor));
            setError(null);
          } else {
            await borrarHoja();
            setGuardada(null);
            setError(null);
          }
        } catch (e) {
          if (e instanceof ErrorApi && e.status === 401) {
            onSesionVencida();
            return;
          }
          if (e instanceof ErrorApi && e.status === 404) {
            // Escenario 2: Ausencia de rutas asignadas para la fecha
            await borrarHoja();
            setGuardada(null);
            setError(null);
          } else if (!(e instanceof ErrorRed)) {
            setError((e as Error).message);
          }
        }
      }
      setCola(await colaOperaciones.estadoPorClave());
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
