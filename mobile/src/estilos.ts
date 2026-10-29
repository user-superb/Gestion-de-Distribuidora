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
  // Tintes de los colores de marca para fondos de badges y paneles.
  marcaSuave: 'rgba(18, 60, 107, 0.08)', // Azul Ruta al 8 %
  neutroSuave: 'rgba(27, 27, 31, 0.06)', // Carbón al 6 %
  naranjaBorde: 'rgba(244, 102, 27, 0.35)', // Naranja YA al 35 %
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
    justifyContent: 'center',
  },
  botonDeshabilitado: { backgroundColor: colores.deshabilitado },
  // 19 px en negrita: blanco sobre Naranja YA cumple contraste de texto grande (WCAG, 3:1).
  botonTexto: { color: colores.primarioTexto, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  botonSecundario: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colores.enlace,
    backgroundColor: colores.tarjeta,
  },
  botonSecundarioTexto: { color: colores.enlace, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  botonAccion: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colores.enlace,
    backgroundColor: colores.marcaSuave,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonAccionTexto: {
    color: colores.enlace,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  botonAccionRechazar: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colores.error,
    backgroundColor: colores.errorFondo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonAccionRechazarTexto: {
    color: colores.error,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  aviso: { borderRadius: 10, padding: 12 },
  avisoTexto: { fontSize: 15, fontWeight: '600' },
  secuenciaBadge: {
    backgroundColor: colores.marcaSuave,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secuenciaTexto: {
    color: colores.titulo,
    fontWeight: '800',
    fontSize: 15,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTexto: {
    fontSize: 13,
    fontWeight: '700',
  },
  badgePendiente: { backgroundColor: colores.neutroSuave },
  badgePendienteTexto: { color: colores.textoSuave },
  badgeEnCurso: { backgroundColor: colores.alertaFondo },
  badgeEnCursoTexto: { color: colores.titulo },
  badgeEntregado: { backgroundColor: colores.okFondo },
  badgeEntregadoTexto: { color: colores.ok },
  badgeRechazado: { backgroundColor: colores.errorFondo },
  badgeRechazadoTexto: { color: colores.error },
  resumenCarga: {
    backgroundColor: colores.fondo,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    marginTop: 4,
  },
  resumenCargaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resumenCargaTexto: {
    fontSize: 14,
    color: colores.textoSuave,
  },
  botonDesglose: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: colores.marcaSuave,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  botonDesgloseTexto: {
    fontSize: 13,
    fontWeight: '600',
    color: colores.enlace,
  },
  contenedorDocumentos: {
    backgroundColor: colores.fondo,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: 10,
    gap: 8,
    marginTop: 6,
  },
  documentoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
  },
  contenedorSinActividad: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  seccionTitulo: {
    fontSize: 18,
    fontWeight: '800',
    color: colores.titulo,
    marginTop: 8,
  },
  tarjetaTotalizador: {
    backgroundColor: colores.alertaFondo,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colores.naranjaBorde,
    padding: 14,
    gap: 8,
  },
  tarjetaTotalizadorTitulo: {
    fontSize: 16,
    fontWeight: '800',
    color: colores.titulo,
  },
  tarjetaTotalizadorFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  totalizadorValor: {
    fontSize: 16,
    fontWeight: '800',
    color: colores.texto,
  },
  tarjetaMarca: {
    backgroundColor: colores.tarjeta,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: 14,
    gap: 10,
  },
  marcaCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  marcaBadge: {
    backgroundColor: colores.marcaSuave,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  marcaBadgeTexto: {
    color: colores.titulo,
    fontWeight: '800',
    fontSize: 14,
  },
  remitoItemDetalle: {
    backgroundColor: colores.fondo,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: 12,
    gap: 6,
  },
  remitoItemDetalleFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tarjetaSinActividad: {
    backgroundColor: colores.tarjeta,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colores.borde,
    width: '100%',
    maxWidth: 380,
    gap: 12,
  },
  iconoSinActividad: {
    fontSize: 48,
    marginBottom: 4,
  },
  tituloSinActividad: {
    fontSize: 22,
    fontWeight: '800',
    color: colores.titulo,
    textAlign: 'center',
  },
  subtituloSinActividad: {
    fontSize: 15,
    color: colores.textoSuave,
    textAlign: 'center',
    lineHeight: 22,
  },
  botonRecargar: {
    marginTop: 8,
    backgroundColor: colores.primario,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  botonRecargarTexto: {
    color: colores.primarioTexto,
    fontSize: 19,
    fontWeight: '800',
  },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  // En una fila "texto · importe": el texto ocupa lo que sobra y baja de línea; el importe no se achica.
  textoFlexible: { flex: 1, flexShrink: 1 },
  importeFijo: { flexShrink: 0, fontWeight: '700', textAlign: 'right' },
});
