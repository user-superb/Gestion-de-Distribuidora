// Detalle de parada: visualización de remitos y carga clasificados por marca antes de iniciar la entrega.
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Aviso } from '../componentes/Aviso';
import { formatearPesos } from '../dominio/dinero';
import type { ColaPorClave } from '../dominio/estadoVisita';
import { agruparRemitosPorMarca } from '../dominio/parada';
import { colores, estilos } from '../estilos';
import type { EstadoOperativoParada, ParadaConsolidada, Visita } from '../tipos';

interface Props {
  parada: ParadaConsolidada;
  cola: ColaPorClave;
  enLinea: boolean;
  onVolver: () => void;
  onIniciarEntrega: (visita: Visita) => void;
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

export function DetalleParadaPantalla({
  parada,
  cola,
  enLinea,
  onVolver,
  onIniciarEntrega,
}: Props) {
  const estiloBadge = ESTILO_BADGE_ESTADO[parada.estadoOperativo];
  const gruposMarca = useMemo(() => agruparRemitosPorMarca(parada.documentos), [parada.documentos]);

  return (
    <ScrollView
      contentContainerStyle={[estilos.contenido, { paddingBottom: 40 }]}
      testID="pantalla-detalle-parada"
    >
      {/* Botón Volver y Título */}
      <View style={estilos.fila}>
        <Pressable
          onPress={onVolver}
          accessibilityRole="button"
          accessibilityLabel="Volver a la hoja de ruta"
          hitSlop={12}
        >
          <Text style={estilos.botonSecundarioTexto}>← Volver</Text>
        </Pressable>
        <Text style={[estilos.subtitulo, { fontWeight: '700' }]}>Detalle de Parada</Text>
      </View>

      {!enLinea ? (
        <Aviso tono="info">
          Operando sin conexión. Los datos mostrados corresponden a la última sincronización.
        </Aviso>
      ) : null}

      {/* Cabecera de la Parada */}
      <View style={estilos.tarjeta}>
        <View style={estilos.fila}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <View style={estilos.secuenciaBadge}>
              <Text style={estilos.secuenciaTexto}>#{parada.orden}</Text>
            </View>
            <Text style={[estilos.titulo, { fontSize: 20, flex: 1 }]} numberOfLines={2}>
              {parada.comercio.nombreFantasia || parada.comercio.razonSocial}
            </Text>
          </View>
          <View style={[estilos.badge, estiloBadge.contenedor]}>
            <Text style={[estilos.badgeTexto, estiloBadge.texto]}>{parada.estadoOperativo}</Text>
          </View>
        </View>

        {parada.comercio.nombreFantasia && parada.comercio.razonSocial !== parada.comercio.nombreFantasia ? (
          <Text style={estilos.textoSuave}>Razón Social: {parada.comercio.razonSocial}</Text>
        ) : null}

        <Text style={estilos.texto}>
          📍 {parada.comercio.domicilio}
          {parada.comercio.localidad ? `, ${parada.comercio.localidad}` : ''}
        </Text>

        {parada.comercio.ventanaDesde && parada.comercio.ventanaHasta ? (
          <Text style={estilos.textoSuave}>
            🕐 Ventana de entrega: {parada.comercio.ventanaDesde} - {parada.comercio.ventanaHasta}
          </Text>
        ) : null}

        {parada.comercio.telefono ? (
          <Text style={estilos.textoSuave}>📞 Teléfono: {parada.comercio.telefono}</Text>
        ) : null}
      </View>

      {/* Totalizador General de la Parada */}
      <Text style={estilos.seccionTitulo}>Total General de la Parada</Text>
      <View style={estilos.tarjetaTotalizador} testID="totalizador-general">
        <View style={estilos.tarjetaTotalizadorFila}>
          <Text style={estilos.resumenCargaTexto}>📦 Total Bultos / Unidades:</Text>
          <Text style={estilos.totalizadorValor}>
            {parada.totalBultos} {parada.totalBultos === 1 ? 'bulto' : 'bultos'}
          </Text>
        </View>

        <View style={estilos.tarjetaTotalizadorFila}>
          <Text style={estilos.resumenCargaTexto}>📄 Total Remitos:</Text>
          <Text style={estilos.totalizadorValor}>
            {parada.totalRemitos} {parada.totalRemitos === 1 ? 'remito' : 'remitos'}
          </Text>
        </View>

        <View style={estilos.tarjetaTotalizadorFila}>
          <Text style={estilos.resumenCargaTexto}>💰 Importe Consolidado:</Text>
          <Text style={[estilos.totalizadorValor, { color: colores.titulo }]}>
            {parada.sinCobroEnDestino
              ? 'Sin cobro en destino'
              : formatearPesos(parada.totalImporteCentavos)}
          </Text>
        </View>
      </View>

      {/* Totalizador de Carga por Marca */}
      <Text style={estilos.seccionTitulo}>Totalizador de Carga por Marca</Text>
      <View style={{ gap: 8 }} testID="totalizador-marcas">
        {parada.resumenPorMarca.map((item) => (
          <View key={item.marca} style={estilos.tarjeta}>
            <View style={estilos.marcaCabecera}>
              <View style={estilos.marcaBadge}>
                <Text style={estilos.marcaBadgeTexto}>🏷️ {item.marca}</Text>
              </View>
              <Text style={[estilos.texto, { fontWeight: '700' }]}>
                {item.totalImporteCentavos > 0
                  ? formatearPesos(item.totalImporteCentavos)
                  : 'Sin cargo'}
              </Text>
            </View>

            <View style={estilos.resumenCargaFila}>
              <Text style={estilos.textoSuave}>
                📦 {item.totalBultos} {item.totalBultos === 1 ? 'bulto' : 'bultos'}
              </Text>
              <Text style={estilos.textoSuave}>
                📄 {item.totalRemitos} {item.totalRemitos === 1 ? 'remito' : 'remitos'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Listado de Remitos Clasificados por Marca */}
      <Text style={estilos.seccionTitulo}>Remitos Clasificados por Marca</Text>
      <View style={{ gap: 14 }} testID="remitos-clasificados">
        {gruposMarca.map((grupo) => (
          <View key={grupo.marca} style={estilos.tarjetaMarca}>
            {/* Cabecera del Grupo de Marca */}
            <View style={estilos.marcaCabecera}>
              <View style={estilos.marcaBadge}>
                <Text style={estilos.marcaBadgeTexto}>🏷️ Marca: {grupo.marca}</Text>
              </View>
              <Text style={[estilos.textoSuave, { fontWeight: '600', fontSize: 13 }]}>
                {grupo.totalBultos} bulto{grupo.totalBultos !== 1 ? 's' : ''} · {grupo.totalRemitos} remito{grupo.totalRemitos !== 1 ? 's' : ''}
              </Text>
            </View>

            {/* Lista de Remitos de esta Marca */}
            <View style={{ gap: 8 }}>
              {grupo.documentos.map((doc) => {
                const colorEstado =
                  doc.estadoOperativo === 'Entregado'
                    ? colores.ok
                    : doc.estadoOperativo === 'Rechazado'
                    ? colores.error
                    : colores.textoSuave;

                return (
                  <View
                    key={doc.id}
                    style={estilos.remitoItemDetalle}
                    accessibilityLabel={`Remito ${doc.numero}, marca ${doc.marca}, ${doc.bultos} bultos, estado ${doc.estadoOperativo}`}
                  >
                    <View style={estilos.remitoItemDetalleFila}>
                      <Text style={[estilos.texto, { fontWeight: '700', fontSize: 15 }]}>
                        Remito #{doc.numero}
                      </Text>
                      <View
                        style={[
                          estilos.badge,
                          {
                            backgroundColor:
                              doc.estadoOperativo === 'Entregado'
                                ? colores.okFondo
                                : doc.estadoOperativo === 'Rechazado'
                                ? colores.errorFondo
                                : colores.neutroSuave,
                          },
                        ]}
                      >
                        <Text style={{ fontWeight: '700', fontSize: 12, color: colorEstado }}>
                          {doc.estadoOperativo}
                        </Text>
                      </View>
                    </View>

                    <View style={estilos.remitoItemDetalleFila}>
                      <Text style={estilos.textoSuave}>
                        📦 Cantidad: {doc.bultos} {doc.bultos === 1 ? 'bulto / unidad' : 'bultos / unidades'}
                      </Text>
                      <Text style={[estilos.texto, { fontWeight: '600' }]}>
                        {formatearPesos(doc.importeCentavos)}
                      </Text>
                    </View>

                    {doc.motivoNoEntrega ? (
                      <Text style={[estilos.textoSuave, { color: colores.error, fontSize: 13 }]}>
                        Motivo no entrega: {doc.motivoNoEntrega}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>

      {/* Botón de Acción para Iniciar Entrega */}
      <View style={{ marginTop: 12, gap: 10 }}>
        <Pressable
          style={estilos.boton}
          onPress={() => onIniciarEntrega(parada.visitaPrincipal)}
          accessibilityRole="button"
          accessibilityLabel="Iniciar entrega de la parada"
        >
          <Text style={estilos.botonTexto}>
            {parada.estadoOperativo === 'Entregado' || parada.estadoOperativo === 'Rechazado'
              ? 'Ver registro de entrega y cobro →'
              : 'Iniciar entrega →'}
          </Text>
        </Pressable>

        <Pressable
          style={estilos.botonSecundario}
          onPress={onVolver}
          accessibilityRole="button"
          accessibilityLabel="Volver a la hoja de ruta"
        >
          <Text style={estilos.botonSecundarioTexto}>Volver a hoja de ruta</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
