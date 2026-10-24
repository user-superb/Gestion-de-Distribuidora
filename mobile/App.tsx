import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useNetInfo } from '@react-native-community/netinfo';
import { cerrarSesion, obtenerHojaDeRuta } from './src/api';
import { borrarHoja, colaOperaciones, guardarHoja, guardarSesion, leerSesion } from './src/almacenamiento';
import { verificarParadaActiva } from './src/dominio/parada';
import { estilos, marca } from './src/estilos';
import { VisitaPantalla } from './src/pantallas/VisitaPantalla';
import { HojaDeRutaPantalla } from './src/pantallas/HojaDeRutaPantalla';
import { LoginPantalla } from './src/pantallas/LoginPantalla';
import type { ParadaConsolidada, Sesion } from './src/tipos';
import { useJornada } from './src/useJornada';

export default function App() {
  const [iniciando, setIniciando] = useState(true);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);
  const [visitaAbierta, setVisitaAbierta] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const red = useNetInfo();
  const enLinea = red.isConnected === true && red.isInternetReachable !== false;

  // Corrección 6: el botón atrás de Android vuelve de la parada a la hoja de ruta.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!visitaAbierta) return false;
      setVisitaAbierta(null);
      return true;
    });
    return () => sub.remove();
  }, [visitaAbierta]);

  useEffect(() => {
    leerSesion().then((guardada) => {
      setSesion(guardada);
      setIniciando(false);
    });
  }, []);

  // Supuesto S5: la sesión venció. Los cobros sin enviar quedan guardados y salen después del nuevo login.
  const onSesionVencida = useCallback(() => {
    guardarSesion(null);
    setSesion(null);
    setVisitaAbierta(null);
    setAvisoLogin('Tu sesión venció. Volvé a ingresar: lo guardado en el celular se envía después.');
  }, []);

  const jornada = useJornada(sesion, enLinea, onSesionVencida);

  async function ingresar(nueva: Sesion) {
    await guardarSesion(nueva);
    setAvisoLogin(null);
    setSesion(nueva);
  }

  async function salir() {
    const pendientes = (await colaOperaciones.listar()).filter((item) => item.estado === 'pendiente').length;
    const cerrar = async () => {
      if (sesion) await cerrarSesion(sesion.token);
      await borrarHoja();
      await guardarSesion(null);
      setSesion(null);
        setVisitaAbierta(null);
    };
    if (pendientes > 0) {
      Alert.alert('Operaciones sin sincronizar', `Tenés ${pendientes} entrega(s) o cobro(s) sin enviar. Quedan guardados y se envían al volver a ingresar.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Salir igual', onPress: cerrar },
      ]);
    } else {
      await cerrar();
    }
  }

  // Al abrir la parada se verifica que la visita siga activa (HU #21) y se va directo a sus remitos (corrección 2).
  async function abrirParada(parada: ParadaConsolidada) {
    setMensaje(null);
    if (enLinea && sesion) {
      try {
        const hojaServidor = await obtenerHojaDeRuta(sesion.token);
        await guardarHoja(hojaServidor);
        await jornada.recargar();

        const verificacion = verificarParadaActiva(parada, hojaServidor, jornada.cola);
        if (!verificacion.activa) {
          // ESCENARIO 2: Fallo por remitos o visita cancelados
          Alert.alert(
            'Parada cancelada',
            verificacion.motivo || 'Esta parada o sus remitos fueron cancelados recientemente por administración.',
            [{ text: 'Entendido' }]
          );
          setMensaje('La parada fue cancelada o modificada por administración y se actualizó la hoja de ruta.');
                setVisitaAbierta(null);
          return;
        }

        // ESCENARIO 1: Despliegue exitoso
        setVisitaAbierta((verificacion.paradaActualizada || parada).visitaPrincipal.id);
      } catch {
        // En caso de error de red puntual al consultar, verificar contra la copia local
        const verificacionLocal = verificarParadaActiva(parada, jornada.guardada?.hoja, jornada.cola);
        if (!verificacionLocal.activa) {
          Alert.alert(
            'Parada cancelada',
            verificacionLocal.motivo || 'Esta parada o sus remitos fueron cancelados por administración.',
            [{ text: 'Entendido' }]
          );
                setVisitaAbierta(null);
          return;
        }
        setVisitaAbierta((verificacionLocal.paradaActualizada || parada).visitaPrincipal.id);
      }
    } else {
      // Modo sin conexión: verificar contra la copia local
      const verificacion = verificarParadaActiva(parada, jornada.guardada?.hoja, jornada.cola);
      if (!verificacion.activa) {
        Alert.alert(
          'Parada cancelada',
          verificacion.motivo || 'Esta parada no está activa.',
          [{ text: 'Entendido' }]
        );
            setVisitaAbierta(null);
        return;
      }
      setVisitaAbierta((verificacion.paradaActualizada || parada).visitaPrincipal.id);
    }
  }

  const visita = jornada.guardada?.hoja.visitas.find((v) => v.id === visitaAbierta);

  return (
    <SafeAreaProvider>
      {/* El login usa el fondo Naranja YA; el resto de las pantallas, Crema Pan. */}
      <SafeAreaView style={[estilos.pantalla, !iniciando && !sesion && { backgroundColor: marca.naranjaYa }]}>
        <StatusBar style={!iniciando && !sesion ? 'light' : 'dark'} />
        {iniciando ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <ActivityIndicator size="large" />
          </View>
        ) : !sesion ? (
          <LoginPantalla aviso={avisoLogin} onIngreso={ingresar} />
        ) : visita ? (
          <VisitaPantalla
            visita={visita}
            cola={jornada.cola}
            enLinea={enLinea}
            onCambio={jornada.recargar}
            onVolver={() => setVisitaAbierta(null)}
            onListo={(texto) => {
              setMensaje(texto);
              setVisitaAbierta(null);
                        jornada.recargar();
            }}
          />
        ) : (
          <HojaDeRutaPantalla
            {...jornada}
            enLinea={enLinea}
            mensaje={mensaje}
            onRecargar={jornada.recargar}
            onAbrirParada={abrirParada}
            onCerrarSesion={salir}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
