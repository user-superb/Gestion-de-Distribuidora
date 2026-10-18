import { Text, View } from 'react-native';
import { colores, estilos } from '../estilos';

const tonos = {
  info: { fondo: colores.alertaFondo, texto: colores.alerta },
  ok: { fondo: colores.okFondo, texto: colores.ok },
  error: { fondo: colores.errorFondo, texto: colores.error },
};

export function Aviso({ tono, children }: { tono: keyof typeof tonos; children: React.ReactNode }) {
  return (
    <View style={[estilos.aviso, { backgroundColor: tonos[tono].fondo }]} accessibilityRole="alert">
      <Text style={[estilos.avisoTexto, { color: tonos[tono].texto }]}>{children}</Text>
    </View>
  );
}
