// Una visita: entrega de sus remitos (HU #22) y cobro (HU #25 a #29).
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { colaOperaciones } from '../almacenamiento';
import { Aviso } from '../componentes/Aviso';
import {
  importeRestante,
  MEDIOS_SOLO_EN_LINEA,
  MedioPago,
  NOMBRE_MEDIO,
  PagoEnCarga,
  validarCobro,
} from '../dominio/cobro';
import { centavosATexto, formatearPesos, parsearPesos } from '../dominio/dinero';
import { armarEntrega, puedeConfirmarse } from '../dominio/entrega';
import { ColaPorClave, estadoCobro, estadoEntrega, ETIQUETA_ENTREGA, EstadoLocal } from '../dominio/estadoVisita';
import { colores, estilos } from '../estilos';
import type { CobroDto, Remito, Visita } from '../tipos';
import { obtenerUbicacion } from '../ubicacion';

interface Props {
  visita: Visita;
  cola: ColaPorClave;
  enLinea: boolean;
  onCambio: () => Promise<void>;
  onVolver: () => void;
  onListo: (mensaje: string) => void;
}

const MEDIOS: MedioPago[] = ['efectivo', 'transferencia', 'qr'];

const ETIQUETA_NO_ENTREGABLE: Record<string, string> = {
  no_entregado: 'No entregado',
  devuelto: 'Devuelto',
  anulado: 'Anulado',
};

const COLOR_ESTADO: Record<EstadoLocal, string> = {
  pendiente: colores.textoSuave,
  hecho: colores.ok,
  sin_sincronizar: colores.alerta,
  rechazado: colores.error,
};

export function VisitaPantalla({ visita, cola, enLinea, onCambio, onVolver, onListo }: Props) {
  const { importe, comercio } = visita;
  const [pagos, setPagos] = useState<PagoEnCarga[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const enColaCobro = cola.get(`cobro:${visita.id}`);
  const [rechazo, setRechazo] = useState<string | null>(enColaCobro?.estado === 'rechazado' ? enColaCobro.motivo || null : null);
  const estado = estadoCobro(visita, cola);
  const yaCobrada = estado === 'hecho' || estado === 'sin_sincronizar';
  const validacion = validarCobro(pagos, importe.totalCentavos, enLinea);
  const porEntregar = visita.remitos.filter(
    (remito) => puedeConfirmarse(remito) && ['pendiente', 'rechazado'].includes(estadoEntrega(remito, cola))
  );

  // HU #22: cada remito se confirma por separado, con hora y GPS. Se guarda primero en el celular.
  async function confirmarEntregas(remitos: Remito[]) {
    setEntregando(true);
    setErrorEntrega(null);
    try {
      const entrega = armarEntrega(await obtenerUbicacion());
      if (!entrega) {
        setErrorEntrega('No se pudo obtener la ubicación GPS, y la entrega la exige. Activá la ubicación y volvé a intentar.');
        return;
      }
      for (const remito of remitos) {
        await colaOperaciones.encolar({ tipo: 'entrega', visitaId: visita.id, remitoId: remito.id, cuerpo: entrega });
      }
      if (enLinea) await colaOperaciones.sincronizar();
      await onCambio();
    } finally {
      setEntregando(false);
    }
  }

  function agregarMedio(medioPago: MedioPago) {
    const restante = importeRestante(pagos, importe.totalCentavos);
    setPagos([...pagos, { medioPago, importeTexto: restante ? centavosATexto(restante) : '', referencia: '' }]);
  }

  function actualizar(i: number, cambios: Partial<PagoEnCarga>) {
    setPagos(pagos.map((pago, j) => (j === i ? { ...pago, ...cambios } : pago)));
  }

  async function confirmarCobro() {
    if (!validacion.puedeConfirmar) return;
    setGuardando(true);
    setRechazo(null);
    try {
      const cuerpo: CobroDto = {
        pagos: pagos.map((pago) => ({
          claveIdempotencia: Crypto.randomUUID(),
          medioPago: pago.medioPago,
          importeCentavos: parsearPesos(pago.importeTexto) as number,
          ...(pago.medioPago === 'transferencia' ? { referenciaTransferencia: pago.referencia.trim() } : {}),
        })),
        registradoEn: new Date().toISOString(),
        ubicacion: await obtenerUbicacion(),
      };
      // Primero se guarda en el celular: el registro no depende de la señal (HU #26 E2, #29 E2).
      await colaOperaciones.encolar({ tipo: 'cobro', visitaId: visita.id, cuerpo });
      if (enLinea) await colaOperaciones.sincronizar();

      const resultado = (await colaOperaciones.estadoPorClave()).get(`cobro:${visita.id}`);
      if (resultado?.estado === 'rechazado') {
        setRechazo(resultado.motivo || 'El servidor rechazó el cobro.');
        return;
      }
      onListo(
        resultado?.estado === 'sincronizado'
          ? `Visita cobrada: ${comercio.razonSocial}`
          : `Cobro guardado en el celular (${comercio.razonSocial}). Se enviará al recuperar la conexión.`
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onVolver} accessibilityRole="button" hitSlop={12}>
        <Text style={estilos.botonSecundarioTexto}>‹ Volver a la hoja de ruta</Text>
      </Pressable>
      <Text style={estilos.titulo}>{comercio.nombreFantasia || comercio.razonSocial}</Text>
      <Text style={estilos.subtitulo}>{comercio.domicilio}</Text>

      {/* HU #22: confirmación individual de entrega de remitos */}
      <Text style={[estilos.texto, { fontWeight: '700' }]}>Entrega de remitos</Text>
      <View style={estilos.tarjeta}>
        {visita.remitos.map((remito) => {
          const noEntregable = ETIQUETA_NO_ENTREGABLE[remito.estado];
          const estadoRemito = estadoEntrega(remito, cola);
          const motivo = cola.get(`entrega:${remito.id}`)?.motivo;
          return (
            <View key={remito.id} style={{ paddingVertical: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: colores.borde }}>
              <View style={estilos.fila}>
                <Text style={[estilos.texto, { flex: 1 }]}>{remito.numero} · {remito.marca}</Text>
                <Text style={estilos.texto}>{formatearPesos(remito.importeCentavos)}</Text>
              </View>
              <View style={estilos.fila}>
                <Text style={{ fontWeight: '700', color: noEntregable ? colores.textoSuave : COLOR_ESTADO[estadoRemito] }}>
                  {noEntregable || ETIQUETA_ENTREGA[estadoRemito]}
                </Text>
                {!noEntregable && ['pendiente', 'rechazado'].includes(estadoRemito) ? (
                  <Pressable
                    onPress={() => confirmarEntregas([remito])}
                    disabled={entregando}
                    accessibilityRole="button"
                    accessibilityLabel={`Confirmar entrega del remito ${remito.numero}`}
                    hitSlop={8}
                  >
                    <Text style={estilos.botonSecundarioTexto}>Confirmar entrega</Text>
                  </Pressable>
                ) : null}
              </View>
              {estadoRemito === 'rechazado' && motivo ? <Text style={{ color: colores.error }}>{motivo}</Text> : null}
            </View>
          );
        })}
      </View>
      {porEntregar.length > 1 ? (
        <Pressable
          style={[estilos.botonSecundario, entregando && { borderColor: colores.deshabilitado }]}
          disabled={entregando}
          onPress={() => confirmarEntregas(porEntregar)}
          accessibilityRole="button"
        >
          <Text style={estilos.botonSecundarioTexto}>Confirmar entrega de los {porEntregar.length} remitos</Text>
        </Pressable>
      ) : null}
      {entregando ? <ActivityIndicator /> : null}
      {errorEntrega ? <Aviso tono="error">{errorEntrega}</Aviso> : null}

      {/* HU #25: importe de solo lectura, con desglose por marca */}
      <Text style={[estilos.texto, { fontWeight: '700' }]}>Cobro</Text>
      <View style={estilos.tarjeta} accessibilityLabel={`Importe a cobrar ${formatearPesos(importe.totalCentavos)}`}>
        <Text style={estilos.textoSuave}>Importe a cobrar</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', color: colores.texto }}>{formatearPesos(importe.totalCentavos)}</Text>
        {importe.sinCobroEnDestino ? <Text style={[estilos.texto, { fontWeight: '700' }]}>Sin cobro en destino</Text> : null}
        {importe.subtotalesPorMarca.map((subtotal) => (
          <View key={subtotal.marca} style={estilos.fila}>
            <Text style={estilos.texto}>{subtotal.marca}</Text>
            <Text style={estilos.texto}>{formatearPesos(subtotal.importeCentavos)}</Text>
          </View>
        ))}
        {importe.remitosExcluidos.length ? (
          <Text style={estilos.textoSuave}>Se descontaron remitos rechazados: {importe.remitosExcluidos.join(', ')}</Text>
        ) : null}
      </View>

      {rechazo ? <Aviso tono="error">No se pudo registrar el cobro: {rechazo}</Aviso> : null}

      {yaCobrada ? (
        <Aviso tono="ok">
          {estado === 'hecho' ? 'Esta visita ya está cobrada.' : 'Cobro guardado en el celular, pendiente de sincronizar.'}
        </Aviso>
      ) : importe.sinCobroEnDestino ? (
        <BotonConfirmar texto="Cerrar visita" habilitado={!guardando} guardando={guardando} onPress={confirmarCobro} />
      ) : (
        <>
          {pagos.map((pago, i) => (
            <View key={i} style={estilos.tarjeta}>
              <View style={estilos.fila}>
                <Text style={[estilos.texto, { fontWeight: '700' }]}>{NOMBRE_MEDIO[pago.medioPago]}</Text>
                <Pressable onPress={() => setPagos(pagos.filter((_, j) => j !== i))} accessibilityRole="button" hitSlop={12}>
                  <Text style={{ color: colores.error, fontWeight: '700' }}>Quitar</Text>
                </Pressable>
              </View>
              <TextInput
                style={estilos.input}
                value={pago.importeTexto}
                onChangeText={(importeTexto) => actualizar(i, { importeTexto })}
                keyboardType="decimal-pad"
                placeholder="Importe"
                accessibilityLabel={`Importe en ${NOMBRE_MEDIO[pago.medioPago]}`}
              />
              {pago.medioPago === 'transferencia' ? (
                <TextInput
                  style={estilos.input}
                  value={pago.referencia}
                  onChangeText={(referencia) => actualizar(i, { referencia })}
                  autoCapitalize="characters"
                  placeholder="Referencia del comprobante"
                  accessibilityLabel="Referencia del comprobante bancario"
                />
              ) : null}
            </View>
          ))}

          <Text style={estilos.textoSuave}>{pagos.length ? 'Agregar otro medio de pago:' : 'Elegí el medio de pago:'}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {MEDIOS.map((medio) => {
              const habilitado = enLinea || !MEDIOS_SOLO_EN_LINEA.includes(medio);
              return (
                <Pressable
                  key={medio}
                  style={[estilos.botonSecundario, { flex: 1 }, !habilitado && { borderColor: colores.deshabilitado }]}
                  disabled={!habilitado}
                  onPress={() => agregarMedio(medio)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !habilitado }}
                >
                  <Text
                    style={[estilos.botonSecundarioTexto, { fontSize: 15 }, !habilitado && { color: colores.deshabilitado }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {medio === 'qr' ? 'QR' : NOMBRE_MEDIO[medio]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!enLinea ? <Text style={estilos.textoSuave}>El cobro por QR necesita conexión.</Text> : null}

          {pagos.length ? (
            <>
              {/* HU #29 ESCENARIO 3: se resalta la diferencia y se bloquea la confirmación */}
              {validacion.errores.map((mensaje) => (
                <Aviso key={mensaje} tono="error">{mensaje}</Aviso>
              ))}
              <BotonConfirmar
                texto={`Confirmar cobro · ${formatearPesos(validacion.declaradoCentavos)}`}
                habilitado={validacion.puedeConfirmar && !guardando}
                guardando={guardando}
                onPress={confirmarCobro}
              />
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function BotonConfirmar({ texto, habilitado, guardando, onPress }: { texto: string; habilitado: boolean; guardando: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[estilos.boton, !habilitado && estilos.botonDeshabilitado]}
      disabled={!habilitado}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !habilitado }}
    >
      {guardando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>{texto}</Text>}
    </Pressable>
  );
}
