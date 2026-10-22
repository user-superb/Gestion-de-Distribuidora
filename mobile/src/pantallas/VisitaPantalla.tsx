// Una visita: entrega de sus remitos (HU #22 individual, HU #23 multimarca) y cobro (HU #25 a #29).
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { colaOperaciones } from '../almacenamiento';
import { Aviso } from '../componentes/Aviso';
import {
  calcularImporteVisitaLocal,
  importeRestante,
  MEDIOS_SOLO_EN_LINEA,
  MedioPago,
  NOMBRE_MEDIO,
  PagoEnCarga,
  validarCobro,
} from '../dominio/cobro';
import { centavosATexto, formatearPesos, parsearPesos } from '../dominio/dinero';
import {
  armarEntrega,
  armarEntregaLote,
  armarRechazo,
  MOTIVOS_RECHAZO_PREESTABLECIDOS,
  puedeConfirmarse,
} from '../dominio/entrega';
import {
  ColaPorClave,
  esRemitoResuelto,
  estadoCobro,
  estadoEntrega,
  ETIQUETA_ENTREGA,
  EstadoLocal,
  infoEstadoRemito,
  resumenVisitaEntrega,
} from '../dominio/estadoVisita';
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
  const { comercio } = visita;
  const importe = calcularImporteVisitaLocal(visita, cola);
  const [pagos, setPagos] = useState<PagoEnCarga[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [remitoARechazar, setRemitoARechazar] = useState<Remito | null>(null);
  const [motivoPreestablecido, setMotivoPreestablecido] = useState<string | null>(null);
  const [motivoManual, setMotivoManual] = useState<string>('');
  const [rechazando, setRechazando] = useState(false);

  const enColaCobro = cola.get(`cobro:${visita.id}`);
  const [rechazo, setRechazo] = useState<string | null>(enColaCobro?.estado === 'rechazado' ? enColaCobro.motivo || null : null);
  const estado = estadoCobro(visita, cola);
  const yaCobrada = estado === 'hecho' || estado === 'sin_sincronizar';
  const validacion = validarCobro(pagos, importe.totalCentavos, enLinea);
  const porEntregar = visita.remitos.filter((remito) => !esRemitoResuelto(remito, cola));
  const resumenEntrega = resumenVisitaEntrega(visita, cola);

  const motivoRechazoFinal = (motivoManual.trim() || motivoPreestablecido || '').trim();
  const puedeConfirmarRechazo = motivoRechazoFinal.length > 0;

  // HU: registrar el rechazo de un remito
  async function confirmarRechazo() {
    if (!remitoARechazar || !puedeConfirmarRechazo) return;
    setRechazando(true);
    setErrorEntrega(null);
    try {
      const ubicacion = await obtenerUbicacion().catch(() => null);
      const rechazoDto = armarRechazo(motivoRechazoFinal, ubicacion);
      if (!rechazoDto) return;

      await colaOperaciones.encolar({
        tipo: 'rechazo',
        visitaId: visita.id,
        remitoId: remitoARechazar.id,
        cuerpo: rechazoDto,
      });

      if (enLinea) await colaOperaciones.sincronizar();
      await onCambio();

      const resultado = (await colaOperaciones.estadoPorClave()).get(`rechazo:${remitoARechazar.id}`);
      onListo(
        resultado?.estado === 'sincronizado'
          ? `Remito ${remitoARechazar.numero} rechazado.`
          : `Rechazo guardado en el celular (Remito ${remitoARechazar.numero}). Se enviará al recuperar la conexión.`
      );

      setRemitoARechazar(null);
      setMotivoPreestablecido(null);
      setMotivoManual('');
    } catch (err: any) {
      setErrorEntrega(err.message || 'Error al registrar el rechazo.');
    } finally {
      setRechazando(false);
    }
  }

  // HU #22: cada remito se puede confirmar individualmente con hora y GPS
  async function confirmarEntregaIndividual(remito: Remito) {
    setEntregando(true);
    setErrorEntrega(null);
    try {
      const entrega = armarEntrega(await obtenerUbicacion());
      if (!entrega) {
        setErrorEntrega('No se pudo obtener la ubicación GPS, y la entrega la exige. Activá la ubicación y volvé a intentar.');
        return;
      }
      await colaOperaciones.encolar({ tipo: 'entrega', visitaId: visita.id, remitoId: remito.id, cuerpo: entrega });
      if (enLinea) await colaOperaciones.sincronizar();
      await onCambio();
    } finally {
      setEntregando(false);
    }
  }

  // HU #23: Confirmar en un solo paso la entrega de remitos multimarca de toda la visita
  async function confirmarTodaLaVisita() {
    if (porEntregar.length === 0) return;
    setEntregando(true);
    setErrorEntrega(null);
    try {
      const ubicacion = await obtenerUbicacion();
      const lote = armarEntregaLote(porEntregar, ubicacion);
      if (!lote) {
        setErrorEntrega('No se pudo obtener la ubicación GPS, y la entrega la exige. Activá la ubicación y volvé a intentar.');
        return;
      }

      // Se guarda como un bloque transaccional en la cola (Regla 4)
      await colaOperaciones.encolar({
        tipo: 'entrega_lote',
        visitaId: visita.id,
        entregas: lote.entregas,
        cuerpoGeneral: lote.cuerpoGeneral,
      });

      if (enLinea) await colaOperaciones.sincronizar();
      await onCambio();

      const tieneExcepciones = visita.remitos.some((r) => ['no_entregado', 'devuelto'].includes(r.estado));
      onListo(
        tieneExcepciones
          ? `Visita entregada con excepciones: ${comercio.nombreFantasia || comercio.razonSocial}`
          : `Visita completada: ${comercio.nombreFantasia || comercio.razonSocial}`
      );
    } finally {
      setEntregando(false);
    }
  }

  // Compatibilidad
  async function confirmarEntregas(remitos: Remito[]) {
    if (remitos.length === 1) {
      await confirmarEntregaIndividual(remitos[0]);
    } else {
      await confirmarTodaLaVisita();
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

      {/* HU #22 y HU #23: Entrega de remitos individuales y multimarca, y HU: Rechazo de remito */}
      <Text style={[estilos.texto, { fontWeight: '700' }]}>Entrega de remitos</Text>
      <View style={estilos.tarjeta}>
        {visita.remitos.map((remito) => {
          const info = infoEstadoRemito(remito, cola);
          return (
            <View key={remito.id} style={{ paddingVertical: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: colores.borde }}>
              <View style={estilos.fila}>
                <Text style={[estilos.texto, { flex: 1 }]}>{remito.numero} · {remito.marca}</Text>
                <Text style={estilos.texto}>{formatearPesos(remito.importeCentavos)}</Text>
              </View>
              <View style={estilos.fila}>
                <Text style={{ fontWeight: '700', color: info.color }}>
                  {info.texto}
                </Text>
                {info.puedeOperar ? (
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Pressable
                      style={[estilos.botonAccion, (entregando || rechazando) && { opacity: 0.5 }]}
                      onPress={() => confirmarEntregaIndividual(remito)}
                      disabled={entregando || rechazando}
                      accessibilityRole="button"
                      accessibilityLabel={`Confirmar entrega del remito ${remito.numero}`}
                      hitSlop={8}
                    >
                      <Text style={estilos.botonAccionTexto}>Confirmar entrega</Text>
                    </Pressable>
                    <Pressable
                      style={[estilos.botonAccionRechazar, (entregando || rechazando) && { opacity: 0.5 }]}
                      onPress={() => {
                        setRemitoARechazar(remito);
                        setMotivoPreestablecido(null);
                        setMotivoManual('');
                      }}
                      disabled={entregando || rechazando}
                      accessibilityRole="button"
                      accessibilityLabel={`Rechazar remito ${remito.numero}`}
                      hitSlop={8}
                    >
                      <Text style={estilos.botonAccionRechazarTexto}>Rechazar</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
              {info.motivo ? (
                <Text style={{ fontSize: 13, color: info.esRechazado ? colores.alerta : colores.error }}>
                  Motivo: {info.motivo}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* HU #23: Acción principal en un solo paso para remitos multimarca */}
      {porEntregar.length > 0 ? (
        <Pressable
          style={[estilos.boton, entregando && estilos.botonDeshabilitado, { marginVertical: 8 }]}
          disabled={entregando}
          onPress={confirmarTodaLaVisita}
          accessibilityRole="button"
          accessibilityLabel="Confirmar toda la visita"
        >
          {entregando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={estilos.botonTexto}>Confirmar toda la visita</Text>
          )}
        </Pressable>
      ) : resumenEntrega.completada ? (
        <Aviso tono={resumenEntrega.conExcepciones ? 'alerta' : 'ok'}>
          {resumenEntrega.conExcepciones
            ? 'Visita entregada con excepciones (existen remitos devueltos o no entregados).'
            : 'Todos los remitos de la visita fueron entregados.'}
        </Aviso>
      ) : null}
      {entregando && porEntregar.length === 0 ? <ActivityIndicator /> : null}
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

      {/* Modal / Diálogo de Rechazo de Remito */}
      <Modal
        visible={remitoARechazar !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!rechazando) {
            setRemitoARechazar(null);
            setMotivoPreestablecido(null);
            setMotivoManual('');
          }
        }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
          <View style={[estilos.tarjeta, { backgroundColor: '#fff', maxHeight: '90%' }]}>
            <Text style={[estilos.titulo, { fontSize: 20 }]}>Rechazar remito</Text>
            <Text style={[estilos.subtitulo, { marginBottom: 12 }]}>
              {remitoARechazar?.numero} · {remitoARechazar?.marca}
            </Text>
            <Text style={[estilos.textoSuave, { marginBottom: 8 }]}>
              Seleccioná un motivo preestablecido o ingresá uno manualmente:
            </Text>

            {/* Motivos preestablecidos */}
            <View style={{ gap: 6, marginBottom: 12 }}>
              {MOTIVOS_RECHAZO_PREESTABLECIDOS.map((motivo) => {
                const seleccionado = motivoPreestablecido === motivo && !motivoManual.trim();
                return (
                  <Pressable
                    key={motivo}
                    style={[
                      estilos.botonSecundario,
                      { paddingVertical: 10, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
                      seleccionado && { backgroundColor: colores.marcaSuave, borderColor: colores.enlace },
                    ]}
                    onPress={() => {
                      setMotivoPreestablecido(motivo);
                      setMotivoManual('');
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: seleccionado }}
                  >
                    <Text
                      style={[
                        estilos.botonSecundarioTexto,
                        { fontSize: 15, textAlign: 'center' },
                        seleccionado && { color: colores.enlace, fontWeight: '700' },
                      ]}
                    >
                      {motivo}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Ingreso manual */}
            <Text style={[estilos.textoSuave, { marginBottom: 4 }]}>O escribí el motivo manualmente:</Text>
            <TextInput
              style={[estilos.input, { minHeight: 44 }]}
              placeholder="Ingresá el motivo del rechazo..."
              value={motivoManual}
              onChangeText={(t) => {
                setMotivoManual(t);
                if (t.trim()) setMotivoPreestablecido(null);
              }}
              accessibilityLabel="Motivo de rechazo manual"
            />

            {/* Acciones */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable
                style={[estilos.botonSecundario, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}
                disabled={rechazando}
                onPress={() => {
                  setRemitoARechazar(null);
                  setMotivoPreestablecido(null);
                  setMotivoManual('');
                }}
                accessibilityRole="button"
              >
                <Text style={[estilos.botonSecundarioTexto, { textAlign: 'center' }]}>Cancelar</Text>
              </Pressable>

              <Pressable
                style={[
                  estilos.boton,
                  {
                    flex: 1,
                    backgroundColor: colores.error,
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingHorizontal: 8,
                  },
                  (!puedeConfirmarRechazo || rechazando) && estilos.botonDeshabilitado,
                ]}
                disabled={!puedeConfirmarRechazo || rechazando}
                onPress={confirmarRechazo}
                accessibilityRole="button"
                accessibilityLabel="Confirmar rechazo"
              >
                {rechazando ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[estilos.botonTexto, { textAlign: 'center', fontSize: 16 }]}>
                    Confirmar rechazo
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
