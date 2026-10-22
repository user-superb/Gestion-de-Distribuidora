import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { HojaGuardada } from '../almacenamiento';
import { Aviso } from '../componentes/Aviso';
import { formatearPesos } from '../dominio/dinero';
import type { ColaPorClave } from '../dominio/estadoVisita';
import { consolidarParadas } from '../dominio/parada';
import { colores, estilos } from '../estilos';
import type { EstadoOperativoParada, ParadaConsolidada, Visita } from '../tipos';

interface Props {
  guardada: HojaGuardada | null;
  cola: ColaPorClave;
  error: string | null;
  cargando: boolean;
  enLinea: boolean;
  mensaje: string | null;
  onRecargar: () => void;
  onAbrirParada: (parada: ParadaConsolidada) => void;
  onAbrirVisita?: (visita: Visita) => void;
  onCerrarSesion: () => void;
}

const ESTILO_BADGE_ESTADO: Record<
  EstadoOperativoParada,
  { contenedor: any; texto: any }
> = {
  Pendiente: { contenedor: estilos.badgePendiente, texto: estilos.badgePendienteTexto },
  'En curso': { contenedor: estilos.badgeEnCurso, texto: estilos.badgeEnCursoTexto },
  Entregado: { contenedor: estilos.badgeEntregado, texto: estilos.badgeEntregadoTexto },
  Rechazado: { contenedor: estilos.badgeRechazado, texto: estilos.badgeRechazadoTexto },
};

export function HojaDeRutaPantalla({
  guardada,
  cola,
  error,
  cargando,
  enLinea,
  mensaje,
  onRecargar,
  onAbrirParada,
  onAbrirVisita,
  onCerrarSesion,
}: Props) {
  const hoja = guardada?.hoja;
  const sinSincronizar = [...cola.values()].filter((item) => item.estado === 'pendiente').length;

  const [desglosadas, setDesglosadas] = useState<Record<string, boolean>>({});

  const manejarApertura = (parada: ParadaConsolidada) => {
    if (onAbrirParada) {
      onAbrirParada(parada);
    } else if (onAbrirVisita) {
      onAbrirVisita(parada.visitaPrincipal);
    }
  };

  const paradas = useMemo(() => {
    return consolidarParadas(hoja?.visitas || [], cola);
  }, [hoja?.visitas, cola]);

  const toggleDesglose = (paradaId: string) => {
    setDesglosadas((prev) => ({
      ...prev,
      [paradaId]: !prev[paradaId],
    }));
  };

  // ESCENARIO 2: Ausencia de rutas asignadas para la fecha
  if (!cargando && (!hoja || paradas.length === 0)) {
    return (
      <ScrollView
        contentContainerStyle={[estilos.contenido, { flexGrow: 1 }]}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={onRecargar} />}
      >
        <View style={estilos.fila}>
          <Text style={estilos.titulo}>Hoja de ruta</Text>
          <Pressable onPress={onCerrarSesion} accessibilityRole="button" hitSlop={12}>
            <Text style={estilos.botonSecundarioTexto}>Salir</Text>
          </Pressable>
        </View>

        {!enLinea ? (
          <Aviso tono="info">
            Sin conexión. Podés reintentar actualizar cuando recuperes la señal.
          </Aviso>
        ) : null}

        {sinSincronizar > 0 ? (
          <Aviso tono="info">{sinSincronizar} entrega(s) o cobro(s) pendientes de sincronizar.</Aviso>
        ) : null}

        {mensaje ? <Aviso tono="ok">{mensaje}</Aviso> : null}
        {error ? <Aviso tono="error">{error}</Aviso> : null}

        <View style={estilos.contenedorSinActividad} testID="pantalla-sin-actividad">
          <View style={estilos.tarjetaSinActividad} accessibilityLabel="Sin actividad programada">
            <Text style={estilos.iconoSinActividad}>📋</Text>
            <Text style={estilos.tituloSinActividad}>Sin actividad programada</Text>
            <Text style={estilos.subtituloSinActividad}>
              No tenés hojas de ruta asignadas o en curso para la fecha operativa actual.
            </Text>
            <Pressable
              style={estilos.botonRecargar}
              onPress={onRecargar}
              accessibilityRole="button"
              accessibilityLabel="Actualizar hoja de ruta"
            >
              <Text style={estilos.botonRecargarTexto}>Actualizar</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  // ESCENARIO 1: Visualización correcta con paradas ordenadas según secuencia planificada
  return (
    <FlatList
      contentContainerStyle={estilos.contenido}
      data={paradas}
      keyExtractor={(parada) => parada.id}
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
              Sin conexión. Podés seguir operando: se sincroniza solo al recuperar la señal.
              {guardada
                ? ` Datos guardados ${new Date(guardada.descargadaEn).toLocaleTimeString('es-AR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}.`
                : ''}
            </Aviso>
          ) : null}
          {sinSincronizar > 0 ? (
            <Aviso tono="info">{sinSincronizar} entrega(s) o cobro(s) pendientes de sincronizar.</Aviso>
          ) : null}
          {mensaje ? <Aviso tono="ok">{mensaje}</Aviso> : null}
          {error && !hoja ? <Aviso tono="error">{error}</Aviso> : null}
        </View>
      }
      renderItem={({ item: parada }) => {
        const expandida = !!desglosadas[parada.id];
        const estiloBadge = ESTILO_BADGE_ESTADO[parada.estadoOperativo];

        return (
          <Pressable
            style={estilos.tarjeta}
            onPress={() => manejarApertura(parada)}
            accessibilityRole="button"
            accessibilityLabel={`Parada ${parada.orden} ${parada.comercio.razonSocial}, estado ${parada.estadoOperativo}`}
          >
            {/* Cabecera de la Parada: Secuencia, Nombre y Estado Operativo */}
            <View style={estilos.fila}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <View style={estilos.secuenciaBadge}>
                  <Text style={estilos.secuenciaTexto}>#{parada.orden}</Text>
                </View>
                <Text style={[estilos.texto, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>
                  {parada.comercio.nombreFantasia || parada.comercio.razonSocial}
                </Text>
              </View>

              <View style={[estilos.badge, estiloBadge.contenedor]}>
                <Text style={[estilos.badgeTexto, estiloBadge.texto]}>{parada.estadoOperativo}</Text>
              </View>
            </View>

            {/* Dirección y Localidad */}
            <Text style={estilos.textoSuave}>
              {parada.comercio.domicilio}
              {parada.comercio.localidad ? `, ${parada.comercio.localidad}` : ''}
            </Text>

            {/* Resumen Consolidado de Carga */}
            <View style={estilos.resumenCarga}>
              <View style={estilos.resumenCargaFila}>
                <Text style={estilos.resumenCargaTexto}>
                  📄 {parada.totalRemitos} remito{parada.totalRemitos !== 1 ? 's' : ''}
                </Text>
                <Text style={[estilos.texto, { fontWeight: '700' }]}>
                  {parada.sinCobroEnDestino
                    ? 'Sin cobro en destino'
                    : formatearPesos(parada.totalImporteCentavos)}
                </Text>
              </View>

              {parada.marcas.length > 0 ? (
                <Text style={[estilos.resumenCargaTexto, { fontStyle: 'italic' }]}>
                  🏷️ Marcas: {parada.marcas.join(', ')}
                </Text>
              ) : null}
            </View>

            {/* Botón para Desglosar Documentos Asociados */}
            <Pressable
              style={estilos.botonDesglose}
              onPress={() => toggleDesglose(parada.id)}
              accessibilityRole="button"
              accessibilityLabel={`Desglose de documentos para ${parada.comercio.razonSocial}`}
            >
              <Text style={estilos.botonDesgloseTexto}>
                {expandida
                  ? '▲ Ocultar detalle de documentos'
                  : `▼ Ver detalle de documentos (${parada.documentos.length})`}
              </Text>
            </Pressable>

            {/* Acordeón de Documentos Asociados */}
            {expandida ? (
              <View style={estilos.contenedorDocumentos}>
                {parada.documentos.map((doc) => {
                  const colorDoc =
                    doc.estadoOperativo === 'Entregado'
                      ? '#15803D'
                      : doc.estadoOperativo === 'Rechazado'
                      ? '#B91C1C'
                      : '#64748B';

                  return (
                    <View key={doc.id} style={estilos.documentoFila}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[estilos.texto, { fontWeight: '600', fontSize: 14 }]}>
                          Remito #{doc.numero} · {doc.marca}
                        </Text>
                        <Text style={{ fontSize: 12, color: colores.textoSuave }}>
                          {formatearPesos(doc.importeCentavos)}
                          {doc.motivoNoEntrega ? ` · Motivo: ${doc.motivoNoEntrega}` : ''}
                        </Text>
                      </View>
                      <Text style={{ fontWeight: '700', fontSize: 13, color: colorDoc }}>
                        {doc.estadoOperativo}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Botón de acción para acceder al detalle de la parada */}
            <View style={{ marginTop: 6, alignItems: 'flex-end' }}>
              <Pressable
                style={estilos.botonAccion}
                onPress={() => manejarApertura(parada)}
                accessibilityRole="button"
                accessibilityLabel={`Ver detalle de la parada ${parada.comercio.razonSocial}`}
              >
                <Text style={estilos.botonAccionTexto}>Ver detalle de parada →</Text>
              </Pressable>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
