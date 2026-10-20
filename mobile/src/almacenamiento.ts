// Persistencia local: sesión, última hoja de ruta descargada y cola de cobros.
// RNF: el celular guarda la hoja completa de la jornada para trabajar 24 h sin conexión.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { confirmarEntrega, confirmarTodaLaVisita, enviarCobro } from './api';
import { ErrorApi } from './errores';
import { ColaOperaciones } from './sincronizacion/cola';
import type { HojaDeRuta, Sesion } from './tipos';

let sesionActual: Sesion | null = null;

export async function leerSesion(): Promise<Sesion | null> {
  const guardada = await AsyncStorage.getItem('sesion');
  sesionActual = guardada ? JSON.parse(guardada) : null;
  return sesionActual;
}

export async function guardarSesion(sesion: Sesion | null): Promise<void> {
  sesionActual = sesion;
  if (sesion) await AsyncStorage.setItem('sesion', JSON.stringify(sesion));
  else await AsyncStorage.removeItem('sesion');
}

export interface HojaGuardada {
  hoja: HojaDeRuta;
  descargadaEn: string;
}

export async function guardarHoja(hoja: HojaDeRuta): Promise<HojaGuardada> {
  const guardada = { hoja, descargadaEn: new Date().toISOString() };
  await AsyncStorage.setItem('hoja-de-ruta', JSON.stringify(guardada));
  return guardada;
}

export async function borrarHoja(): Promise<void> {
  await AsyncStorage.removeItem('hoja-de-ruta');
}

export async function leerHoja(): Promise<HojaGuardada | null> {
  const guardada = await AsyncStorage.getItem('hoja-de-ruta');
  return guardada ? JSON.parse(guardada) : null;
}

/** Cola única de la app (entregas y cobros). Envía con el token de la sesión vigente al momento de sincronizar. */
export const colaOperaciones = new ColaOperaciones(AsyncStorage, async (operacion) => {
  if (!sesionActual) throw new ErrorApi('Iniciá sesión para sincronizar.', 401);
  if (operacion.tipo === 'entrega') {
    await confirmarEntrega(sesionActual.token, operacion.remitoId, operacion.cuerpo);
  } else if (operacion.tipo === 'entrega_lote') {
    await confirmarTodaLaVisita(sesionActual.token, operacion.visitaId, {
      ...operacion.cuerpoGeneral,
      entregas: operacion.entregas,
    });
  }
  else await enviarCobro(sesionActual.token, operacion.visitaId, operacion.cuerpo);
});
