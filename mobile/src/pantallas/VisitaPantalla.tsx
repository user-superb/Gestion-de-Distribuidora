// Una parada: entrega de sus remitos (HU #22, #23, #24) y cobro (HU #25 a #29).
// Correcciones del cliente (24/10): se ven primero los remitos, el transportista elige cuáles entrega
// y puede rechazar los restantes, los resueltos quedan abajo y el cobro no muestra datos del comercio.
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
import { armarEntrega, armarEntregaLote, armarRechazo, MOTIVOS_RECHAZO_PREESTABLECIDOS } from '../dominio/entrega';
import { ColaPorClave, esRemitoResuelto, estadoCobro, InfoEstadoRemito, infoEstadoRemito } from '../dominio/estadoVisita';
import { ordenarRemitosParaEntrega, planificarEntrega } from '../dominio/organizacion';
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
const SIN_GPS = 'No se pudo obtener la ubicación GPS, y la entrega la exige. Activá la ubicación y volvé a intentar.';

/** Colores de la paleta para el estado que informa el dominio. */
function colorEstado(info: InfoEstadoRemito): string {
  if (info.texto.includes('sin sincronizar')) return colores.alerta;
  if (info.puedeOperar && info.motivo) return colores.error; // el servidor rechazó la operación
  if (info.texto === 'Entregado') return colores.ok;
  return colores.textoSuave;
}

export function VisitaPantalla({ visita, cola, enLinea, onCambio, onVolver, onListo }: Props) {
  const { comercio } = visita;
  const importe = calcularImporteVisitaLocal(visita, cola);
  const [pagos, setPagos] = useState<PagoEnCarga[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [avisoEntrega, setAvisoEntrega] = useState<string | null>(null);
  // Corrección 5: arrancan todos marcados; se guarda lo que el transportista desmarcó.
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [aRechazar, setARechazar] = useState<Remito[]>([]);
  const [motivoPreestablecido, setMotivoPreestablecido] = useState<string | null>(null);
  const [motivoManual, setMotivoManual] = useState<string>('');
  const [rechazando, setRechazando] = useState(false);

  const enColaCobro = cola.get(`cobro:${visita.id}`);
  const [rechazo, setRechazo] = useState<string | null>(enColaCobro?.estado === 'rechazado' ? enColaCobro.motivo || null : null);
  const estado = estadoCobro(visita, cola);
  const yaCobrada = estado === 'hecho' || estado === 'sin_sincronizar';
  const validacion = validarCobro(pagos, importe.totalCentavos, enLinea);

  const remitos = ordenarRemitosParaEntrega(visita.remitos, cola); // corrección 4
  const porEntregar = remitos.filter((remito) => !esRemitoResuelto(remito, cola));
  const seleccionados = porEntregar.filter((remito) => !desmarcados.has(remito.id));
  const restantes = porEntregar.filter((remito) => desmarcados.has(remito.id));
  const ocupado = entregando || rechazando;

  const motivoRechazoFinal = (motivoManual.trim() || motivoPreestablecido || '').trim();

  function alternar(remito: Remito) {
    const nuevo = new Set(desmarcados);
    if (nuevo.has(remito.id)) nuevo.delete(remito.id);
    else nuevo.add(remito.id);
    setDesmarcados(nuevo);
  }

  async function actualizar() {
    setActualizando(true);
    try {
      await onCambio();
    } finally {
      setActualizando(false);
    }
  }

  // HU #22 / #23: confirma los remitos elegidos, con hora y GPS. Se guarda primero en el celular.
  async function confirmarSeleccion() {
    const plan = planificarEntrega(seleccionados, porEntregar);
    if (plan === 'nada') return;
    setEntregando(true);
    setErrorEntrega(null);
    setAvisoEntrega(null);
    try {
      const ubicacion = await obtenerUbicacion();
      if (plan === 'lote') {
        const lote = armarEntregaLote(porEntregar, ubicacion);
        if (!lote) return setErrorEntrega(SIN_GPS);
        await colaOperaciones.encolar({ tipo: 'entrega_lote', visitaId: visita.id, entregas: lote.entregas, cuerpoGeneral: lote.cuerpoGeneral });
      } else {
        const entrega = armarEntrega(ubicacion);
        if (!entrega) return setErrorEntrega(SIN_GPS);
        for (const remito of seleccionados) {
          await colaOperaciones.encolar({ tipo: 'entrega', visitaId: visita.id, remitoId: remito.id, cuerpo: { ...entrega } });
        }
      }
      if (enLinea) await colaOperaciones.sincronizar();
      await onCambio();
      setAvisoEntrega(
        `${seleccionados.length} remito(s) entregado(s).` + (restantes.length ? ` Quedan ${restantes.length} sin confirmar.` : '')
      );
    } finally {
      setEntregando(false);
    }
  }

  // HU #24: rechazo con motivo. Corrección 5: un solo motivo para todos los remitos restantes.
  async function confirmarRechazo() {
    if (aRechazar.length === 0 || !motivoRechazoFinal) return;
    setRechazando(true);
    setErrorEntrega(null);
    try {
      const ubicacion = await obtenerUbicacion().catch(() => null);
      for (const remito of aRechazar) {
        const cuerpo = armarRechazo(motivoRechazoFinal, ubicacion);
        if (!cuerpo) return;
        await colaOperaciones.encolar({ tipo: 'rechazo', visitaId: visita.id, remitoId: remito.id, cuerpo });
      }
      if (enLinea) await colaOperaciones.sincronizar();
      await onCambio();
      setAvisoEntrega(`${aRechazar.length} remito(s) rechazado(s): ${motivoRechazoFinal}.`);
      cerrarModal();
    } catch (err: any) {
      setErrorEntrega(err.message || 'Error al registrar el rechazo.');
    } finally {
      setRechazando(false);
    }
  }

  function cerrarModal() {
    setARechazar([]);
    setMotivoPreestablecido(null);
    setMotivoManual('');
  }

  function agregarMedio(medioPago: MedioPago) {
    const restante = importeRestante(pagos, importe.totalCentavos);
    setPagos([...pagos, { medioPago, importeTexto: restante ? centavosATexto(restante) : '', referencia: '' }]);
  }

  function actualizarPago(i: number, cambios: Partial<PagoEnCarga>) {
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
      const nombre = comercio.nombreFantasia || comercio.razonSocial;
      onListo(
        resultado?.estado === 'sincronizado'
          ? `Parada cobrada: ${nombre}`
          : `Cobro guardado en el celular (${nombre}). Se enviará al recuperar la conexión.`
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Corrección 6: encabezado fijo para volver y actualizar sin buscar los botones */}
      <View style={[estilos.fila, { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, backgroundColor: colores.fondo }]}>
        <Pressable onPress={onVolver} accessibilityRole="button" accessibilityLabel="Volver a la hoja de ruta" hitSlop={12}>
          <Text style={estilos.botonSecundarioTexto}>‹ Hoja de ruta</Text>
        </Pressable>
        <Pressable onPress={actualizar} disabled={actualizando} accessibilityRole="button" accessibilityLabel="Actualizar parada" hitSlop={12}>
          {actualizando ? <ActivityIndicator color={colores.enlace} /> : <Text style={estilos.botonSecundarioTexto}>↻ Actualizar</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[estilos.contenido, { paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
        {/* Corrección 3: solo el nombre; sin domicilio ni otros datos del comercio */}
        <Text style={estilos.titulo}>{comercio.nombreFantasia || comercio.razonSocial}</Text>

        {/* Corrección 2: primero los remitos */}
        <Text style={estilos.seccionTitulo}>Remitos</Text>
        <View style={estilos.tarjeta}>
          {porEntregar.length ? <Text style={estilos.textoSuave}>Desmarcá los que no se entregan.</Text> : null}
          {remitos.map((remito) => {
            const info = infoEstadoRemito(remito, cola);
            const pendiente = !esRemitoResuelto(remito, cola);
            const marcado = pendiente && !desmarcados.has(remito.id);
            return (
              <Pressable
                key={remito.id}
                onPress={() => pendiente && alternar(remito)}
                disabled={!pendiente || ocupado}
                accessibilityRole={pendiente ? 'checkbox' : undefined}
                accessibilityState={pendiente ? { checked: marcado } : undefined}
                accessibilityLabel={`Remito ${remito.numero}, ${remito.marca}, ${formatearPesos(remito.importeCentavos)}, ${info.texto}`}
                style={{ paddingVertical: 10, gap: 4, borderBottomWidth: 1, borderBottomColor: colores.borde, opacity: pendiente ? 1 : 0.75 }}
              >
                <View style={[estilos.fila, { alignItems: 'flex-start' }]}>
                  {pendiente ? (
                    <View
                      style={{
                        width: 26, height: 26, borderRadius: 6, borderWidth: 2, marginTop: 1,
                        borderColor: marcado ? colores.primario : colores.borde,
                        backgroundColor: marcado ? colores.primario : colores.tarjeta,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {marcado ? <Text style={{ color: colores.primarioTexto, fontWeight: '800', fontSize: 16 }}>✓</Text> : null}
                    </View>
                  ) : null}
                  <Text style={[estilos.texto, { flex: 1 }]}>{remito.numero} · {remito.marca}</Text>
                  <Text style={[estilos.texto, { fontWeight: '700' }]}>{formatearPesos(remito.importeCentavos)}</Text>
                </View>
                {!pendiente || info.motivo ? (
                  <Text style={{ fontWeight: '700', color: colorEstado(info) }}>
                    {info.texto}{info.motivo ? ` · ${info.motivo}` : ''}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Corrección 5: confirmar los marcados y, si quedan, rechazar los restantes */}
        {porEntregar.length ? (
          <View style={{ gap: 10 }}>
            <Pressable
              style={[estilos.boton, (seleccionados.length === 0 || ocupado) && estilos.botonDeshabilitado]}
              disabled={seleccionados.length === 0 || ocupado}
              onPress={confirmarSeleccion}
              accessibilityRole="button"
            >
              {entregando ? <ActivityIndicator color="#fff" /> : <Text style={estilos.botonTexto}>Confirmar entrega ({seleccionados.length})</Text>}
            </Pressable>
            {restantes.length ? (
              <Pressable
                style={[estilos.botonSecundario, { borderColor: colores.error }, ocupado && { opacity: 0.5 }]}
                disabled={ocupado}
                onPress={() => setARechazar(restantes)}
                accessibilityRole="button"
              >
                <Text style={[estilos.botonSecundarioTexto, { color: colores.error }]}>Rechazar restantes ({restantes.length})</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Aviso tono="ok">Todos los remitos de la parada están resueltos.</Aviso>
        )}
        {avisoEntrega ? <Aviso tono="ok">{avisoEntrega}</Aviso> : null}
        {errorEntrega ? <Aviso tono="error">{errorEntrega}</Aviso> : null}

        {/* HU #25: importe de solo lectura, con desglose por marca */}
        <Text style={estilos.seccionTitulo}>Cobro</Text>
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
          <Aviso tono="ok">{estado === 'hecho' ? 'Esta parada ya está cobrada.' : 'Cobro guardado en el celular, pendiente de sincronizar.'}</Aviso>
        ) : importe.sinCobroEnDestino ? (
          <BotonConfirmar texto="Cerrar parada" habilitado={!guardando} guardando={guardando} onPress={confirmarCobro} />
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
                  onChangeText={(importeTexto) => actualizarPago(i, { importeTexto })}
                  keyboardType="decimal-pad"
                  placeholder="Importe"
                  accessibilityLabel={`Importe en ${NOMBRE_MEDIO[pago.medioPago]}`}
                />
                {pago.medioPago === 'transferencia' ? (
                  <TextInput
                    style={estilos.input}
                    value={pago.referencia}
                    onChangeText={(referencia) => actualizarPago(i, { referencia })}
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
                    <Text style={[estilos.botonSecundarioTexto, { fontSize: 15 }, !habilitado && { color: colores.deshabilitado }]} numberOfLines={1} adjustsFontSizeToFit>
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

      {/* HU #24: motivo del rechazo, uno solo para todos los remitos restantes */}
      <Modal visible={aRechazar.length > 0} transparent animationType="slide" onRequestClose={() => !rechazando && cerrarModal()}>
        <View style={{ flex: 1, backgroundColor: 'rgba(27, 27, 31, 0.5)', justifyContent: 'center', padding: 20 }}>
          <ScrollView style={[estilos.tarjeta, { maxHeight: '90%' }]} contentContainerStyle={{ gap: 8 }}>
            <Text style={[estilos.titulo, { fontSize: 20 }]}>Rechazar {aRechazar.length === 1 ? 'remito' : `${aRechazar.length} remitos`}</Text>
            <Text style={estilos.subtitulo}>{aRechazar.map((remito) => `${remito.numero} · ${remito.marca}`).join('\n')}</Text>
            <Text style={estilos.textoSuave}>Elegí un motivo o escribilo:</Text>

            {MOTIVOS_RECHAZO_PREESTABLECIDOS.map((motivo) => {
              const elegido = motivoPreestablecido === motivo && !motivoManual.trim();
              return (
                <Pressable
                  key={motivo}
                  style={[estilos.botonSecundario, { paddingVertical: 10, paddingHorizontal: 12 }, elegido && { backgroundColor: colores.marcaSuave, borderColor: colores.enlace }]}
                  onPress={() => {
                    setMotivoPreestablecido(motivo);
                    setMotivoManual('');
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: elegido }}
                >
                  <Text style={[estilos.botonSecundarioTexto, { fontSize: 15 }, elegido && { fontWeight: '800' }]}>{motivo}</Text>
                </Pressable>
              );
            })}

            <TextInput
              style={[estilos.input, { minHeight: 44 }]}
              placeholder="Otro motivo…"
              value={motivoManual}
              onChangeText={(texto) => {
                setMotivoManual(texto);
                if (texto.trim()) setMotivoPreestablecido(null);
              }}
              accessibilityLabel="Motivo de rechazo"
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <Pressable style={[estilos.botonSecundario, { flex: 1 }]} disabled={rechazando} onPress={cerrarModal} accessibilityRole="button">
                <Text style={estilos.botonSecundarioTexto}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[estilos.boton, { flex: 1, backgroundColor: colores.error, paddingHorizontal: 8 }, (!motivoRechazoFinal || rechazando) && estilos.botonDeshabilitado]}
                disabled={!motivoRechazoFinal || rechazando}
                onPress={confirmarRechazo}
                accessibilityRole="button"
              >
                {rechazando ? <ActivityIndicator color="#fff" /> : <Text style={[estilos.botonTexto, { fontSize: 17 }]}>Rechazar</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
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
