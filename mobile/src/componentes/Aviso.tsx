import { Text, View } from 'react-native';
import { colores, estilos } from '../estilos';

const tonos = {
  info: { fondo: colores.alertaFondo, texto: colores.alerta },
  alerta: { fondo: colores.alertaFondo, texto: colores.alerta },
  ok: { fondo: colores.okFondo, texto: colores.ok },
  error: { fondo: colores.errorFondo, texto: colores.error },
};

export function Aviso({ tono, children }: { tono: keyof typeof tonos; children: React.ReactNode }) {
  const estiloTono = tonos[tono] ?? tonos.info;
  return (
    <View style={[estilos.aviso, { backgroundColor: estiloTono.fondo }]} accessibilityRole="alert">
      <Text style={[estilos.avisoTexto, { color: estiloTono.texto }]}>{children}</Text>
    </View>
  );
}
