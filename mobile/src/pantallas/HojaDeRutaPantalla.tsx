// Hoja de ruta del día: paradas en el orden planificado (HU #20).
// Correcciones del cliente (24/10): dos pantallas "Por entregar" / "Entregadas", botón Actualizar
// y sin el desglose de remitos en la lista (los remitos se ven al entrar a la parada).
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { HojaGuardada } from '../almacenamiento';
import { Aviso } from '../componentes/Aviso';
import { formatearPesos } from '../dominio/dinero';
import type { ColaPorClave } from '../dominio/estadoVisita';
import { faltaCobrar, separarParadas } from '../dominio/organizacion';
import { consolidarParadas } from '../dominio/parada';
import { colores, estilos } from '../estilos';
import type { EstadoOperativoParada, ParadaConsolidada } from '../tipos';

interface Props {
  guardada: HojaGuardada | null;
  cola: ColaPorClave;
  error: string | null;
  cargando: boolean;
  enLinea: boolean;
  mensaje: string | null;
  onRecargar: () => void;
  onAbrirParada: (parada: ParadaConsolidada) => void;
  onCerrarSesion: () => void;
}

type Pestana = 'porEntregar' | 'entregadas';

const ESTILO_BADGE_ESTADO: Record<EstadoOperativoParada, { contenedor: any; texto: any }> = {
  Pendiente: { contenedor: estilos.badgePendiente, texto: estilos.badgePendienteTexto },
  'En curso': { contenedor: estilos.badgeEnCurso, texto: estilos.badgeEnCursoTexto },
  Entregado: { contenedor: estilos.badgeEntregado, texto: estilos.badgeEntregadoTexto },
  Rechazado: { contenedor: estilos.badgeRechazado, texto: estilos.badgeRechazadoTexto },
};

export function HojaDeRutaPantalla({ guardada, cola, error, cargando, enLinea, mensaje, onRecargar, onAbrirParada, onCerrarSesion }: Props) {
  const hoja = guardada?.hoja;
  const sinSincronizar = [...cola.values()].filter((item) => item.estado === 'pendiente').length;
  const [pestana, setPestana] = useState<Pestana>('porEntregar');

  const paradas = useMemo(() => consolidarParadas(hoja?.visitas || [], cola), [hoja?.visitas, cola]);
  const { porEntregar, entregadas } = useMemo(() => separarParadas(paradas, cola), [paradas, cola]);
  const lista = pestana === 'porEntregar' ? porEntregar : entregadas;

  const encabezado = (
    <View style={{ gap: 10 }}>
      <View style={estilos.fila}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
          <Image source={require('../../assets/marca/isotipo.png')} style={{ width: 56, height: 28 }} resizeMode="contain" accessibilityLabel="RepartoYA" />
          <Text style={estilos.titulo}>Hoja de ruta</Text>
        </View>
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

      {/* Corrección 8: botón visible para actualizar (además de deslizar hacia abajo) */}
      <Pressable
        style={[estilos.botonSecundario, { paddingVertical: 10, flexDirection: 'row', gap: 8 }, cargando && { borderColor: colores.deshabilitado }]}
        onPress={onRecargar}
        disabled={cargando}
        accessibilityRole="button"
        accessibilityLabel="Actualizar hoja de ruta"
      >
        {cargando ? <ActivityIndicator color={colores.enlace} /> : null}
        <Text style={estilos.botonSecundarioTexto}>{cargando ? 'Actualizando…' : '↻ Actualizar'}</Text>
      </Pressable>

      {!enLinea ? (
        <Aviso tono="info">
          Sin conexión. Podés seguir operando: se sincroniza solo al recuperar la señal.
          {guardada
            ? ` Datos guardados ${new Date(guardada.descargadaEn).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.`
            : ''}
        </Aviso>
      ) : null}
      {sinSincronizar > 0 ? <Aviso tono="info">{sinSincronizar} operación(es) pendientes de sincronizar.</Aviso> : null}
      {mensaje ? <Aviso tono="ok">{mensaje}</Aviso> : null}
      {error ? <Aviso tono="error">{error}</Aviso> : null}

      {/* Corrección 7: dos pantallas, por entregar y entregadas */}
      {paradas.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
          <BotonPestana texto={`Por entregar (${porEntregar.length})`} activa={pestana === 'porEntregar'} onPress={() => setPestana('porEntregar')} />
          <BotonPestana texto={`Entregadas (${entregadas.length})`} activa={pestana === 'entregadas'} onPress={() => setPestana('entregadas')} />
        </View>
      ) : null}
    </View>
  );

  // HU #20 ESCENARIO 2: sin rutas asignadas para la fecha
  if (!cargando && (!hoja || paradas.length === 0)) {
    return (
      <ScrollView contentContainerStyle={[estilos.contenido, { flexGrow: 1 }]} refreshControl={<RefreshControl refreshing={cargando} onRefresh={onRecargar} />}>
        {encabezado}
        <View style={estilos.contenedorSinActividad} testID="pantalla-sin-actividad">
          <View style={estilos.tarjetaSinActividad} accessibilityLabel="Sin actividad programada">
            <Text style={estilos.iconoSinActividad}>📋</Text>
            <Text style={estilos.tituloSinActividad}>Sin actividad programada</Text>
            <Text style={estilos.subtituloSinActividad}>No tenés hojas de ruta asignadas o en curso para la fecha operativa actual.</Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <FlatList
      contentContainerStyle={estilos.contenido}
      data={lista}
      keyExtractor={(parada) => parada.id}
      refreshControl={<RefreshControl refreshing={cargando} onRefresh={onRecargar} />}
      ListHeaderComponent={encabezado}
      ListEmptyComponent={
        <Text style={[estilos.textoSuave, { textAlign: 'center', marginTop: 24 }]}>
          {pestana === 'porEntregar' ? 'No quedan paradas por entregar.' : 'Todavía no hay paradas entregadas.'}
        </Text>
      }
      renderItem={({ item: parada }) => {
        const falta = faltaCobrar(parada, cola);
        const badge = falta ? ESTILO_BADGE_ESTADO['En curso'] : ESTILO_BADGE_ESTADO[parada.estadoOperativo];
        return (
          <Pressable
            style={estilos.tarjeta}
            onPress={() => onAbrirParada(parada)}
            accessibilityRole="button"
            accessibilityLabel={`Parada ${parada.orden} ${parada.comercio.razonSocial}, ${falta ? 'falta cobrar' : parada.estadoOperativo}`}
          >
            <View style={estilos.fila}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <View style={estilos.secuenciaBadge}>
                  <Text style={estilos.secuenciaTexto}>#{parada.orden}</Text>
                </View>
                <Text style={[estilos.texto, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>
                  {parada.comercio.nombreFantasia || parada.comercio.razonSocial}
                </Text>
              </View>
              <View style={[estilos.badge, badge.contenedor]}>
                <Text style={[estilos.badgeTexto, badge.texto]}>{falta ? 'Falta cobrar' : parada.estadoOperativo}</Text>
              </View>
            </View>

            <Text style={estilos.textoSuave}>
              {parada.comercio.domicilio}
              {parada.comercio.localidad ? `, ${parada.comercio.localidad}` : ''}
            </Text>

            {/* El texto de marcas se achica y baja de línea; el importe nunca se corta. */}
            <View style={[estilos.fila, { alignItems: 'flex-start' }]}>
              <Text style={[estilos.resumenCargaTexto, estilos.textoFlexible]}>
                {parada.totalRemitos} remito{parada.totalRemitos !== 1 ? 's' : ''}
                {parada.marcas.length ? ` · ${parada.marcas.join(', ')}` : ''}
              </Text>
              <Text style={[estilos.texto, estilos.importeFijo]}>
                {parada.sinCobroEnDestino ? 'Sin cobro' : formatearPesos(parada.totalImporteCentavos)}
              </Text>
            </View>
            <Text style={[estilos.botonDesgloseTexto, { alignSelf: 'flex-end', fontSize: 15 }]}>Abrir ›</Text>
          </Pressable>
        );
      }}
    />
  );
}

function BotonPestana({ texto, activa, onPress }: { texto: string; activa: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[
        estilos.botonSecundario,
        { flex: 1, paddingVertical: 10 },
        activa ? { backgroundColor: colores.titulo, borderColor: colores.titulo } : { borderColor: colores.borde },
      ]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: activa }}
    >
      <Text style={[estilos.botonSecundarioTexto, { fontSize: 15 }, activa && { color: colores.tarjeta }]} numberOfLines={1} adjustsFontSizeToFit>
        {texto}
      </Text>
    </Pressable>
  );
}
