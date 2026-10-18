import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useNetInfo } from '@react-native-community/netinfo';
import { cerrarSesion } from './src/api';
import { borrarHoja, colaOperaciones, guardarSesion, leerSesion } from './src/almacenamiento';
import { estilos } from './src/estilos';
import { VisitaPantalla } from './src/pantallas/VisitaPantalla';
import { HojaDeRutaPantalla } from './src/pantallas/HojaDeRutaPantalla';
import { LoginPantalla } from './src/pantallas/LoginPantalla';
import type { Sesion } from './src/tipos';
import { useJornada } from './src/useJornada';

export default function App() {
  const [iniciando, setIniciando] = useState(true);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [avisoLogin, setAvisoLogin] = useState<string | null>(null);
  const [visitaAbierta, setVisitaAbierta] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const red = useNetInfo();
  const enLinea = red.isConnected === true && red.isInternetReachable !== false;

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

  const visita = jornada.guardada?.hoja.visitas.find((v) => v.id === visitaAbierta);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={estilos.pantalla}>
        <StatusBar style="dark" />
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
            onAbrirVisita={(v) => {
              setMensaje(null);
              setVisitaAbierta(v.id);
            }}
            onCerrarSesion={salir}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
