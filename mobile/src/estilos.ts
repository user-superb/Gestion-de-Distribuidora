// Estilos compartidos. Se trabaja de madrugada y en la calle: texto grande, alto contraste y botones amplios.
import { StyleSheet } from 'react-native';

/** Paleta RepartoYA (manual de marca): dos colores de marca y tres neutros. */
export const marca = {
  naranjaYa: '#F4661B', // acento: botones primarios, el "YA"
  azulRuta: '#123C6B', // principal: texto de marca, headers
  cremaPan: '#FFF6EC', // fondo cálido de las pantallas de la app
  carbon: '#1B1B1F', // texto de cuerpo
  blanco: '#FFFFFF',
};

export const colores = {
  fondo: marca.cremaPan,
  tarjeta: marca.blanco,
  texto: marca.carbon,
  textoSuave: 'rgba(27, 27, 31, 0.72)', // Carbón al 72 %
  borde: 'rgba(18, 60, 107, 0.18)', // Azul Ruta al 18 %
  primario: marca.naranjaYa,
  primarioTexto: marca.blanco,
  titulo: marca.azulRuta,
  enlace: marca.azulRuta,
  // Estados: no están en la paleta de marca. Se mantienen verde y rojo para que éxito y error no se confundan.
  ok: '#15803D',
  okFondo: '#DCFCE7',
  alerta: marca.azulRuta,
  alertaFondo: '#FDE3D3', // Naranja YA aclarado
  error: '#B91C1C',
  errorFondo: '#FEE2E2',
  deshabilitado: 'rgba(27, 27, 31, 0.3)',
};

export const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 12 },
  titulo: { fontSize: 24, fontWeight: '800', color: colores.titulo },
  subtitulo: { fontSize: 16, color: colores.textoSuave },
  texto: { fontSize: 17, color: colores.texto },
  textoSuave: { fontSize: 15, color: colores.textoSuave },
  tarjeta: {
    backgroundColor: colores.tarjeta,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colores.borde,
    gap: 6,
  },
  input: {
    backgroundColor: colores.tarjeta,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 18,
    color: colores.texto,
  },
  boton: {
    backgroundColor: colores.primario,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  botonDeshabilitado: { backgroundColor: colores.deshabilitado },
  // 19 px en negrita: blanco sobre Naranja YA cumple contraste de texto grande (WCAG, 3:1).
  botonTexto: { color: colores.primarioTexto, fontSize: 19, fontWeight: '800' },
  botonSecundario: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colores.enlace,
    backgroundColor: colores.tarjeta,
  },
  botonSecundarioTexto: { color: colores.enlace, fontSize: 17, fontWeight: '700' },
  aviso: { borderRadius: 10, padding: 12 },
  avisoTexto: { fontSize: 15, fontWeight: '600' },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
