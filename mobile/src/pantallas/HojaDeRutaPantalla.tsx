import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import type { HojaGuardada } from '../almacenamiento';
import { Aviso } from '../componentes/Aviso';
import { formatearPesos } from '../dominio/dinero';
import { ColaPorClave, estadoCobro, ETIQUETA_COBRO, EstadoLocal, resumenEntregas, resumenVisitaEntrega } from '../dominio/estadoVisita';
import { colores, estilos } from '../estilos';
import type { Visita } from '../tipos';

const COLOR_ESTADO: Record<EstadoLocal, string> = {
  pendiente: colores.textoSuave,
  hecho: colores.ok,
  sin_sincronizar: colores.alerta,
  rechazado: colores.error,
};

interface Props {
  guardada: HojaGuardada | null;
  cola: ColaPorClave;
  error: string | null;
  cargando: boolean;
  enLinea: boolean;
  mensaje: string | null;
  onRecargar: () => void;
  onAbrirVisita: (visita: Visita) => void;
  onCerrarSesion: () => void;
}

export function HojaDeRutaPantalla({ guardada, cola, error, cargando, enLinea, mensaje, onRecargar, onAbrirVisita, onCerrarSesion }: Props) {
  const hoja = guardada?.hoja;
  const sinSincronizar = [...cola.values()].filter((item) => item.estado === 'pendiente').length;

  return (
    <FlatList
      contentContainerStyle={estilos.contenido}
      data={hoja?.visitas || []}
      keyExtractor={(visita) => visita.id}
      refreshControl={<RefreshControl refreshing={cargando} onRefresh={onRecargar} />}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <View style={estilos.fila}>
            <Text style={estilos.titulo}>Hoja de ruta</Text>
            <Pressable onPress={onCerrarSesion} accessibilityRole="button" hitSlop={12}>
              <Text style={estilos.botonSecundarioTexto}>Salir</Text>
            </Pressable>
          </View>
          {hoja ? (
            <Text style={estilos.subtitulo}>
              {hoja.fechaReparto.split('-').reverse().join('/')} · {hoja.sucursal}
              {hoja.patente ? ` · ${hoja.patente}` : ''}
            </Text>
          ) : null}
          {!enLinea ? (
            <Aviso tono="info">
              Sin conexión. Podés seguir cobrando: se sincroniza solo cuando vuelva la señal.
              {guardada ? ` Datos guardados ${new Date(guardada.descargadaEn).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.` : ''}
            </Aviso>
          ) : null}
          {sinSincronizar > 0 ? <Aviso tono="info">{sinSincronizar} entrega(s) o cobro(s) pendientes de sincronizar.</Aviso> : null}
          {mensaje ? <Aviso tono="ok">{mensaje}</Aviso> : null}
          {error && !hoja ? <Aviso tono="error">{error}</Aviso> : null}
        </View>
      }
      ListEmptyComponent={
        !cargando && !error ? <Text style={estilos.textoSuave}>No hay visitas para mostrar.</Text> : undefined
      }
      renderItem={({ item: visita }) => {
        const estado = estadoCobro(visita, cola);
        const entregas = resumenEntregas(visita, cola);
        const resumenEntrega = resumenVisitaEntrega(visita, cola);
        return (
          <Pressable
            style={estilos.tarjeta}
            onPress={() => onAbrirVisita(visita)}
            accessibilityRole="button"
            accessibilityLabel={`Visita ${visita.orden ?? ''} ${visita.comercio.razonSocial}, ${resumenEntrega.etiqueta}, ${ETIQUETA_COBRO[estado]}`}
          >
            <View style={estilos.fila}>
              <Text style={[estilos.texto, { fontWeight: '700', flex: 1 }]}>
                {visita.orden ?? '–'}. {visita.comercio.nombreFantasia || visita.comercio.razonSocial}
              </Text>
              <Text style={{ color: COLOR_ESTADO[estado], fontWeight: '700' }}>{ETIQUETA_COBRO[estado]}</Text>
            </View>
            <Text style={estilos.textoSuave}>
              {visita.comercio.domicilio}
              {visita.comercio.localidad ? `, ${visita.comercio.localidad}` : ''}
            </Text>
            <View style={estilos.fila}>
              <Text style={[estilos.texto, { fontWeight: '700' }]}>
                {visita.importe.sinCobroEnDestino ? 'Sin cobro en destino' : formatearPesos(visita.importe.totalCentavos)}
              </Text>
              <Text
                style={{
                  color: resumenEntrega.conExcepciones
                    ? colores.alerta
                    : resumenEntrega.completada
                    ? colores.ok
                    : colores.textoSuave,
                  fontWeight: '700',
                }}
              >
                {resumenEntrega.etiqueta}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
