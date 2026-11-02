// HU #46 · Declarar efectivo recaudado al terminar la ruta (y anularlo antes de llegar a la caja, HU #47 E2).
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { colaOperaciones } from '../almacenamiento';
import { Aviso } from '../componentes/Aviso';
import { centavosATexto, formatearPesos, parsearPesos } from '../dominio/dinero';
import type { ColaPorClave } from '../dominio/estadoVisita';
import { consolidarParadas } from '../dominio/parada';
import {
  armarDeclaracion,
  efectivoCobrado,
  estadoDeclaracion,
  paradasPendientes,
  puedeAnular,
  textoEstadoDeclaracion,
  validarDeclaracion,
} from '../dominio/rendicion';
import { colores, estilos } from '../estilos';
import type { HojaDeRuta } from '../tipos';

interface Props {
  hoja: HojaDeRuta;
  cola: ColaPorClave;
  enLinea: boolean;
  onCambio: () => Promise<void>;
  onVolver: () => void;
}

export function RendicionPantalla({ hoja, cola, enLinea, onCambio, onVolver }: Props) {
  const paradas = useMemo(() => consolidarParadas(hoja.visitas, cola), [hoja.visitas, cola]);
  const pendientes = paradasPendientes(paradas, cola);
  const cobrado = efectivoCobrado(hoja, cola);
  const declaracion = estadoDeclaracion(hoja, cola);

  const [montoTexto, setMontoTexto] = useState(centavosATexto(cobrado));
  const [confirmando, setConfirmando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const monto = parsearPesos(montoTexto);
  const validacion = validarDeclaracion(pendientes, monto, declaracion);
  const diferencia = monto === null ? 0 : monto - cobrado;

  async function declarar() {
    if (!validacion.ok || monto === null) return;
    setGuardando(true);
    setError(null);
    try {
      // E2: primero se guarda en el celular; sale sola cuando hay señal.
      const cuerpo = armarDeclaracion(hoja.id, monto, Crypto.randomUUID());
      await colaOperaciones.encolar({ tipo: 'rendicion', hojaId: hoja.id, cuerpo });
      if (enLinea) await colaOperaciones.sincronizar();
      const resultado = (await colaOperaciones.estadoPorClave()).get(`rendicion:${hoja.id}`);
      if (resultado?.estado === 'rechazado') {
        setError(resultado.motivo || 'El servidor rechazó la declaración.');
      } else {
        setAviso(
          resultado?.estado === 'sincronizado'
            ? `Declaraste ${formatearPesos(monto)}. Ya figura en el escritorio del supervisor.`
            : `Declaración guardada en el celular (${formatearPesos(monto)}). Se envía sola al recuperar la conexión.`
        );
      }
      setConfirmando(false);
      await onCambio();
    } finally {
      setGuardando(false);
    }
  }

  async function anular() {
    if (declaracion.estado === 'sin_declarar' || !declaracion.claveIdempotencia) return;
    setGuardando(true);
    setError(null);
    try {
      await colaOperaciones.encolar({
        tipo: 'anulacion_rendicion',
        hojaId: hoja.id,
        cuerpo: { claveIdempotencia: declaracion.claveIdempotencia, anuladaEn: new Date().toISOString() },
      });
      if (enLinea) await colaOperaciones.sincronizar();
      const resultado = (await colaOperaciones.estadoPorClave()).get(`anulacion_rendicion:${declaracion.claveIdempotencia}`);
      if (resultado?.estado === 'rechazado') {
        setError(resultado.motivo || 'No se pudo anular la declaración.');
      } else {
        setAviso(
          resultado?.estado === 'pendiente'
            ? 'Anulación guardada en el celular. Se avisa al supervisor al recuperar la conexión.'
            : 'Anulaste la declaración. El supervisor verá que fue retractada.'
        );
        setMontoTexto(centavosATexto(cobrado));
      }
      setAnulando(false);
      await onCambio();
    } finally {
      setGuardando(false);
    }
  }

  const colorEstado =
    declaracion.estado === 'validada' ? colores.ok : declaracion.estado === 'sin_sincronizar' ? colores.alerta : colores.titulo;

  return (
    <View style={{ flex: 1 }}>
      <View style={[estilos.fila, { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colores.borde, backgroundColor: colores.fondo }]}>
        <Pressable onPress={onVolver} accessibilityRole="button" accessibilityLabel="Volver a la hoja de ruta" hitSlop={12}>
          <Text style={estilos.botonSecundarioTexto}>‹ Hoja de ruta</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[estilos.contenido, { paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
        <Text style={estilos.titulo}>Rendir efectivo</Text>
        <Text style={estilos.subtitulo}>
          {hoja.fechaReparto.split('-').reverse().join('/')} · {hoja.sucursal}
          {hoja.patente ? ` · ${hoja.patente}` : ''}
        </Text>

        {!enLinea ? <Aviso tono="info">Sin conexión. La declaración se guarda en el celular y se envía sola al recuperar la señal.</Aviso> : null}
        {aviso ? <Aviso tono="ok">{aviso}</Aviso> : null}
        {error ? <Aviso tono="error">{error}</Aviso> : null}

        <View style={estilos.tarjetaTotalizador}>
          <Text style={estilos.tarjetaTotalizadorTitulo}>Efectivo cobrado en la jornada</Text>
          <View style={estilos.tarjetaTotalizadorFila}>
            <Text style={[estilos.textoSuave, estilos.textoFlexible]}>Según los cobros registrados en la app</Text>
            <Text style={[estilos.totalizadorValor, estilos.importeFijo]}>{formatearPesos(cobrado)}</Text>
          </View>
        </View>

        {declaracion.estado !== 'sin_declarar' ? (
          <View style={estilos.tarjeta} testID="declaracion-actual">
            <Text style={[estilos.texto, { fontWeight: '800', color: colorEstado }]}>{textoEstadoDeclaracion(declaracion)}</Text>
            <View style={estilos.fila}>
              <Text style={[estilos.texto, estilos.textoFlexible]}>Efectivo declarado</Text>
              <Text style={[estilos.texto, estilos.importeFijo]}>{formatearPesos(declaracion.declaradoCentavos)}</Text>
            </View>
            {declaracion.declaradoEn ? (
              <Text style={estilos.textoSuave}>
                Declarado a las {new Date(declaracion.declaradoEn).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            ) : null}
            <Text style={estilos.textoSuave}>
              {declaracion.estado === 'sin_sincronizar'
                ? 'Está guardada en el celular: llega al supervisor apenas haya conexión.'
                : declaracion.estado === 'pendiente'
                  ? 'Entregá el efectivo en la caja: el supervisor lo va a contar.'
                  : declaracion.estado === 'con_diferencia'
                    ? 'El supervisor contó el efectivo y registró una diferencia. Acercate a la caja.'
                    : 'La rendición está aprobada y la hoja de ruta cerrada.'}
            </Text>

            {puedeAnular(declaracion) && !anulando ? (
              <Pressable style={[estilos.botonSecundario, { borderColor: colores.error, marginTop: 6 }]} onPress={() => setAnulando(true)} disabled={guardando} accessibilityRole="button">
                <Text style={[estilos.botonSecundarioTexto, { color: colores.error }]}>Anular declaración</Text>
              </Pressable>
            ) : null}
            {anulando ? (
              <View style={{ gap: 8, marginTop: 6 }}>
                <Text style={estilos.texto}>¿Anular la declaración de {formatearPesos(declaracion.declaradoCentavos)}? El supervisor verá que la retractaste y podés volver a declarar.</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable style={[estilos.botonSecundario, { flex: 1 }]} onPress={() => setAnulando(false)} disabled={guardando} accessibilityRole="button">
                    <Text style={estilos.botonSecundarioTexto}>Volver</Text>
                  </Pressable>
                  <Pressable style={[estilos.boton, { flex: 1, backgroundColor: colores.error }]} onPress={anular} disabled={guardando} accessibilityRole="button">
                    {guardando ? <ActivityIndicator color={colores.primarioTexto} /> : <Text style={estilos.botonTexto}>Sí, anular</Text>}
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {declaracion.motivoRechazo ? <Aviso tono="error">El servidor rechazó la declaración anterior: {declaracion.motivoRechazo}</Aviso> : null}

            {/* ESCENARIO 3: con visitas pendientes la app bloquea la rendición final */}
            {pendientes.length > 0 ? (
              <View style={[estilos.tarjeta, { borderColor: colores.error }]} testID="rendicion-bloqueada">
                <Text style={[estilos.texto, { fontWeight: '800', color: colores.error }]}>
                  No podés rendir todavía
                </Text>
                <Text style={estilos.texto}>Terminá estas paradas (entregá, rechazá o cobrá) antes de declarar el efectivo:</Text>
                {pendientes.map((parada) => (
                  <Text key={parada.id} style={estilos.textoSuave}>
                    #{parada.orden} · {parada.comercio.nombreFantasia || parada.comercio.razonSocial}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={estilos.tarjeta}>
              <Text style={[estilos.texto, { fontWeight: '700' }]}>¿Cuánto efectivo llevás?</Text>
              <TextInput
                style={[estilos.input, pendientes.length > 0 && { opacity: 0.5 }]}
                value={montoTexto}
                onChangeText={(texto) => {
                  setMontoTexto(texto);
                  setConfirmando(false);
                }}
                editable={pendientes.length === 0 && !guardando}
                keyboardType="decimal-pad"
                accessibilityLabel="Efectivo que llevás"
                placeholder="0,00"
              />
              {monto !== null && diferencia !== 0 && pendientes.length === 0 ? (
                <Text style={[estilos.textoSuave, { color: colores.alerta }]}>
                  Declarás {formatearPesos(Math.abs(diferencia))} {diferencia < 0 ? 'menos' : 'más'} de lo cobrado en efectivo. El supervisor va a contar la diferencia.
                </Text>
              ) : null}
              {!validacion.ok && pendientes.length === 0 ? <Text style={[estilos.textoSuave, { color: colores.error }]}>{validacion.error}</Text> : null}

              {!confirmando ? (
                <Pressable
                  style={[estilos.boton, !validacion.ok && estilos.botonDeshabilitado]}
                  onPress={() => setConfirmando(true)}
                  disabled={!validacion.ok || guardando}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !validacion.ok }}
                >
                  <Text style={estilos.botonTexto}>Declarar efectivo</Text>
                </Pressable>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={estilos.texto}>¿Confirmás que llevás {formatearPesos(monto ?? 0)} en efectivo?</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable style={[estilos.botonSecundario, { flex: 1 }]} onPress={() => setConfirmando(false)} disabled={guardando} accessibilityRole="button">
                      <Text style={estilos.botonSecundarioTexto}>Corregir</Text>
                    </Pressable>
                    <Pressable style={[estilos.boton, { flex: 1 }]} onPress={declarar} disabled={guardando} accessibilityRole="button">
                      {guardando ? <ActivityIndicator color={colores.primarioTexto} /> : <Text style={estilos.botonTexto}>Confirmar</Text>}
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
