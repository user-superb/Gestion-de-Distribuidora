import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { guardarApiUrl, iniciarSesion, leerApiUrlGuardada, obtenerApiUrl, restablecerApiUrl } from '../api';
import { Aviso } from '../componentes/Aviso';
import { ErrorApi, ErrorRed } from '../errores';
import { colores, estilos, marca } from '../estilos';
import type { Sesion } from '../tipos';

export function LoginPantalla({ aviso, onIngreso }: { aviso?: string | null; onIngreso: (sesion: Sesion) => void }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Configuración de URL del servidor en tiempo de ejecución
  const [urlServidor, setUrlServidor] = useState(obtenerApiUrl());
  const [editandoUrl, setEditandoUrl] = useState(false);
  const [inputUrl, setInputUrl] = useState(urlServidor);
  const [mensajeUrl, setMensajeUrl] = useState<string | null>(null);

  useEffect(() => {
    leerApiUrlGuardada().then((url) => {
      setUrlServidor(url);
      setInputUrl(url);
    });
  }, []);

  async function ingresar() {
    setError(null);
    setCargando(true);
    try {
      const sesion = await iniciarSesion(usuario.trim(), password);
      if (sesion.rol !== 'Transportista') {
        setError('Esta aplicación es solo para transportistas.');
        return;
      }
      onIngreso(sesion);
    } catch (e) {
      if (e instanceof ErrorRed) {
        setError(e.message || 'Sin conexión con el servidor. Revisá la dirección configurada o tu conexión a internet.');
      } else if (e instanceof ErrorApi) {
        setError(e.message);
      } else {
        setError((e as Error).message || 'Ocurrió un error inesperado al iniciar sesión.');
      }
    } finally {
      setCargando(false);
    }
  }

  async function guardarNuevaUrl() {
    const guardada = await guardarApiUrl(inputUrl);
    setUrlServidor(guardada);
    setInputUrl(guardada);
    setEditandoUrl(false);
    setError(null);
  }

  async function resetearUrl() {
    const reseteada = await restablecerApiUrl();
    setUrlServidor(reseteada);
    setInputUrl(reseteada);
    setMensajeUrl('URL restablecida a la predeterminada.');
    setTimeout(() => setMensajeUrl(null), 3000);
  }

  return (
    // Variante de marca 04 · App repartidor: fondo Naranja YA.
    <ScrollView
      style={{ backgroundColor: marca.naranjaYa }}
      contentContainerStyle={[estilos.contenido, { flexGrow: 1, justifyContent: 'center', gap: 20 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Image
        source={require('../../assets/marca/logo-repartidor.png')}
        style={{ width: 240, height: 170, alignSelf: 'center' }}
        resizeMode="contain"
        accessibilityLabel="RepartoYA"
      />
      <View style={[estilos.tarjeta, { backgroundColor: colores.fondo, borderColor: colores.fondo, gap: 12, padding: 20 }]}>
        <Text style={[estilos.texto, { fontWeight: '700', color: colores.titulo }]}>Ingresá con tu usuario de transportista.</Text>
        {aviso ? <Aviso tono="info">{aviso}</Aviso> : null}
        <TextInput
          style={estilos.input}
          placeholder="Usuario o email"
          autoCapitalize="none"
          autoCorrect={false}
          value={usuario}
          onChangeText={setUsuario}
          accessibilityLabel="Usuario o email"
        />
        <TextInput
          style={estilos.input}
          placeholder="Contraseña"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={ingresar}
          accessibilityLabel="Contraseña"
        />
        {error ? <Aviso tono="error">{error}</Aviso> : null}
        <Pressable
          style={[estilos.boton, (!usuario || !password || cargando) && estilos.botonDeshabilitado]}
          disabled={!usuario || !password || cargando}
          onPress={ingresar}
          accessibilityRole="button"
        >
          {cargando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Ingresar</Text>}
        </Pressable>

        {/* Panel de configuración de servidor para pruebas en red local / túneles */}
        {!editandoUrl ? (
          <View style={{ alignItems: 'center', marginTop: 4, gap: 2 }}>
            <Text style={[estilos.textoSuave, { fontSize: 13, textAlign: 'center' }]}>
              Servidor: <Text style={{ fontWeight: '700', color: colores.titulo }}>{urlServidor}</Text>
            </Text>
            <Pressable
              onPress={() => {
                setInputUrl(urlServidor);
                setEditandoUrl(true);
                setMensajeUrl(null);
              }}
              style={{ paddingVertical: 4, paddingHorizontal: 8 }}
              accessibilityRole="button"
            >
              <Text style={{ fontSize: 13, color: colores.enlace, fontWeight: '700', textDecorationLine: 'underline' }}>
                Cambiar servidor
              </Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: colores.tarjeta,
              borderRadius: 10,
              padding: 12,
              borderWidth: 1,
              borderColor: colores.borde,
              gap: 8,
              marginTop: 6,
            }}
          >
            <Text style={[estilos.texto, { fontSize: 14, fontWeight: '700', color: colores.titulo }]}>
              Configuración de Servidor API
            </Text>
            <Text style={[estilos.textoSuave, { fontSize: 12 }]}>
              Ingresá la URL pública de VS Code Port Forwarding o la IP de tu PC:
            </Text>
            <TextInput
              style={[estilos.input, { fontSize: 14, paddingVertical: 8, paddingHorizontal: 10 }]}
              placeholder="http://192.168.0.8:3001/api"
              autoCapitalize="none"
              autoCorrect={false}
              value={inputUrl}
              onChangeText={setInputUrl}
              accessibilityLabel="URL del servidor"
            />
            {mensajeUrl ? <Text style={{ fontSize: 12, color: colores.ok, fontWeight: '600' }}>{mensajeUrl}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Pressable
                style={[estilos.boton, { flex: 1, paddingVertical: 10 }]}
                onPress={guardarNuevaUrl}
                accessibilityRole="button"
              >
                <Text style={[estilos.botonTexto, { fontSize: 15 }]}>Guardar</Text>
              </Pressable>
              <Pressable
                style={[estilos.botonSecundario, { paddingVertical: 10, paddingHorizontal: 12 }]}
                onPress={resetearUrl}
                accessibilityRole="button"
              >
                <Text style={[estilos.botonSecundarioTexto, { fontSize: 14 }]}>Restablecer</Text>
              </Pressable>
              <Pressable
                style={[estilos.botonSecundario, { paddingVertical: 10, paddingHorizontal: 12, borderColor: colores.borde }]}
                onPress={() => setEditandoUrl(false)}
                accessibilityRole="button"
              >
                <Text style={[estilos.botonSecundarioTexto, { fontSize: 14, color: colores.textoSuave }]}>Cancelar</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

