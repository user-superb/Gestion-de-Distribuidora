// Estado de la jornada: hoja de ruta (del servidor o guardada en el celular) y cola de entregas y cobros.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { obtenerHojaDeRuta } from './api';
import { borrarHoja, colaOperaciones, fijarSesionActual, guardarHoja, HojaGuardada, leerHoja } from './almacenamiento';
import { esHojaOperativaVigente } from './dominio/parada';
import { ErrorApi, ErrorRed } from './errores';
import type { ColaPorClave } from './dominio/estadoVisita';
import type { Sesion, Visita } from './tipos';

export function useJornada(
  sesion: Sesion | null,
  enLinea: boolean,
  onSesionVencida: () => void,
  onParadaAnexada?: (mensaje: string) => void
) {
  const [guardada, setGuardada] = useState<HojaGuardada | null>(null);
  const [cola, setCola] = useState<ColaPorClave>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  // Registro de IDs de visitas ya conocidas en la hoja actual para detectar anexiones en vivo (HU #19)
  const hojaIdActualRef = useRef<string | null>(null);
  const visitasConocidasRef = useRef<Set<string>>(new Set());

  const detectarParadasAnexadas = useCallback(
    (hojaId: string, visitasNuevas: Visita[]) => {
      const idsNuevos = new Set(visitasNuevas.map((v) => String(v.id)));
      if (hojaIdActualRef.current === hojaId && visitasConocidasRef.current.size > 0) {
        const anexadas = visitasNuevas.filter((v) => !visitasConocidasRef.current.has(String(v.id)));
        if (anexadas.length > 0) {
          const descripciones = anexadas.map((v) => {
            const comercioNombre = v.comercio?.nombreFantasia || v.comercio?.razonSocial || 'Comercio';
            const remitoNums = (v.remitos || []).map((r) => r.numero).join(', ');
            const ordenTxt = v.orden ? `#${v.orden}` : '';
            return `Parada ${ordenTxt} · ${comercioNombre}${remitoNums ? ` (Remito ${remitoNums})` : ''}`.trim();
          });
          const detalleTexto =
            anexadas.length === 1
              ? `Se te anexó la ${descripciones[0]} al final de tu hoja de ruta.`
              : `Se te anexaron ${anexadas.length} paradas a tu hoja de ruta:\n• ${descripciones.join('\n• ')}`;

          Alert.alert('🔔 Nueva parada anexada', detalleTexto, [{ text: 'Ver hoja de ruta' }]);
          onParadaAnexada?.(detalleTexto);
        }
      }
      hojaIdActualRef.current = hojaId;
      visitasConocidasRef.current = idsNuevos;
    },
    [onParadaAnexada]
  );

  const recargar = useCallback(async (silencioso = false) => {
    if (!sesion) {
      setGuardada(null);
      hojaIdActualRef.current = null;
      visitasConocidasRef.current = new Set();
      return;
    }
    fijarSesionActual(sesion);
    if (!silencioso) setCargando(true);
    try {
      const local = await leerHoja();
      if (local && esHojaOperativaVigente(local.hoja)) {
        if (hojaIdActualRef.current !== local.hoja.id) {
          hojaIdActualRef.current = local.hoja.id;
          visitasConocidasRef.current = new Set((local.hoja.visitas || []).map((v) => String(v.id)));
        }
        setGuardada(local);
      } else if (local && !esHojaOperativaVigente(local.hoja)) {
        await borrarHoja();
        setGuardada(null);
      }

      if (enLinea) {
        // 1. Validar la sesión con el servidor, reportar latido de conexión y refrescar la hoja de ruta
        try {
          const hojaServidor = await obtenerHojaDeRuta(sesion.token);
          if (hojaServidor && esHojaOperativaVigente(hojaServidor)) {
            detectarParadasAnexadas(hojaServidor.id, hojaServidor.visitas || []);
            setGuardada(await guardarHoja(hojaServidor));
            setError(null);
          } else {
            await borrarHoja();
            setGuardada(null);
            setError(null);
            hojaIdActualRef.current = null;
            visitasConocidasRef.current = new Set();
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
            hojaIdActualRef.current = null;
            visitasConocidasRef.current = new Set();
          } else if (!(e instanceof ErrorRed)) {
            setError((e as Error).message);
          }
        }

        // 2. Una vez confirmada la validez de la sesión activa, procesar la cola de operaciones pendientes
        try {
          const sincronizacion = await colaOperaciones.sincronizar();
          if (sincronizacion.sesionVencida) {
            onSesionVencida();
            return;
          }
        } catch {
          // Errores de sincronización de cola se reintentan en el siguiente ciclo
        }
      }
      setCola(await colaOperaciones.estadoPorClave());
    } finally {
      if (!silencioso) setCargando(false);
    }
  }, [sesion, enLinea, onSesionVencida, detectarParadasAnexadas]);

  // Al abrir la app y cada vez que vuelve la conexión: sincroniza y actualiza la hoja.
  useEffect(() => {
    void recargar(false);
  }, [recargar]);

  // Latido periódico y sincronización en segundo plano mientras haya sesión y señal (HU #19)
  useEffect(() => {
    if (!sesion || !enLinea) return;
    const intervalo = setInterval(() => {
      void recargar(true);
    }, 3500);
    return () => clearInterval(intervalo);
  }, [sesion, enLinea, recargar]);

  return { guardada, cola, error, cargando, recargar: () => recargar(false) };
}
