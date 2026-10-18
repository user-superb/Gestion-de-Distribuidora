import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { iniciarSesion } from '../api';
import { Aviso } from '../componentes/Aviso';
import { ErrorRed } from '../errores';
import { estilos } from '../estilos';
import type { Sesion } from '../tipos';

export function LoginPantalla({ aviso, onIngreso }: { aviso?: string | null; onIngreso: (sesion: Sesion) => void }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

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
      setError(e instanceof ErrorRed ? 'No hay conexión. Para iniciar sesión necesitás internet.' : (e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <View style={[estilos.contenido, { flex: 1, justifyContent: 'center' }]}>
      <Text style={estilos.titulo}>Tutucas · Reparto</Text>
      <Text style={estilos.subtitulo}>Ingresá con tu usuario de transportista.</Text>
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
    </View>
  );
}
