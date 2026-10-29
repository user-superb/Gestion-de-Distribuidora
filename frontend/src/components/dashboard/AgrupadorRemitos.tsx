// src/components/dashboard/AgrupadorRemitos.tsx
import React, { useState, useEffect } from 'react';
import {
  Package,
  AlertCircle,
  CheckCircle2,
  MapPin,
  Undo2,
  Tag,
  Building,
  ArrowRight,
  ArrowLeft,
  Layers,
  FileText,
  Search,
  X,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Truck,
  Plus,
  Calendar,
  ClipboardCheck,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Check,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  User,
} from 'lucide-react';
import { Remito, Visita, Comercio, Marca, HojaDeRuta, Transportista } from '../../types/domain';
import { remitoService, obtenerFechaActualISO } from '../../services/remitoService';
import { ModalCargaManual } from './ModalCargaManual';
import { ModalAnexarEntrega } from './ModalAnexarEntrega';

function formatearFechaCorta(fechaISO?: string): string {
  if (!fechaISO) return 'Sin programar';
  const partes = fechaISO.slice(0, 10).split('-');
  if (partes.length !== 3) return fechaISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

interface PasoConfig {
  id: number;
  titulo: string;
  subtitulo: string;
}

const PASOS: PasoConfig[] = [
  { id: 1, titulo: 'Agrupar remitos', subtitulo: 'Selección por comercio' },
  { id: 2, titulo: 'Ordenar y programar', subtitulo: 'Secuencia y fecha' },
  { id: 3, titulo: 'Asignar transportista', subtitulo: 'Chofer disponible' },
  { id: 4, titulo: 'Confirmar', subtitulo: 'Revisión final' },
];

interface AgrupadorRemitosProps {
  vistaInicial?: 'armado' | 'armadas';
  onCambioVista?: (vista: 'armado' | 'armadas') => void;
}

export const AgrupadorRemitos: React.FC<AgrupadorRemitosProps> = ({
  vistaInicial = 'armado',
  onCambioVista,
}) => {
  const [subvista, setSubvista] = useState<'armado' | 'armadas'>(vistaInicial);

  useEffect(() => {
    if (vistaInicial) {
      setSubvista(vistaInicial);
    }
  }, [vistaInicial]);

  const cambiarSubvista = (nueva: 'armado' | 'armadas') => {
    setSubvista(nueva);
    onCambioVista?.(nueva);
  };
  const hoyISO = obtenerFechaActualISO();

  // Estado del flujo secuencial (stepper)
  const [pasoActual, setPasoActual] = useState<number>(1);

  // Datos base
  const [pendientes, setPendientes] = useState<Remito[]>([]);
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [hojasRuta, setHojasRuta] = useState<HojaDeRuta[]>([]);
  const [transportistas, setTransportistas] = useState<Transportista[]>([]);

  // Paso 1: Selección y agrupación
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState<string>('');
  const [ultimaVisitaId, setUltimaVisitaId] = useState<string | null>(null);

  // Paso 2: Orden y programación
  const [fechaInput, setFechaInput] = useState<string>(hoyISO);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Paso 3: Asignación de transportista
  // TODO: conectar con listado real de transportistas (implementado con remitoService.getTransportistasAsync() y fallback mock)
  const [transportistaSeleccionadoId, setTransportistaSeleccionadoId] = useState<string>('');
  const [busquedaTransportista, setBusquedaTransportista] = useState<string>('');

  // Paso 4: Confirmación deliberada
  const [confirmacionChecked, setConfirmacionChecked] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Modales auxiliares y feedback
  const [mensaje, setMensaje] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);
  const [modalCargaManualAbierto, setModalCargaManualAbierto] = useState<boolean>(false);
  const [remitoParaAnexar, setRemitoParaAnexar] = useState<Remito | null>(null);
  const [hojaDestinoPreseleccionada, setHojaDestinoPreseleccionada] = useState<string | null>(null);
  const [modalAnexarAbierto, setModalAnexarAbierto] = useState<boolean>(false);

  // Panel inferior de Hojas de ruta armadas
  const [mostrarHojasArmadas, setMostrarHojasArmadas] = useState<boolean>(true);
  const [asignandoHojaId, setAsignandoHojaId] = useState<string | null>(null);
  const [errorAsignacionPorHoja, setErrorAsignacionPorHoja] = useState<Record<string, string>>({});
  const [exitoAsignacionPorHoja, setExitoAsignacionPorHoja] = useState<Record<string, string>>({});
  // Confirmación deliberada por tipeo de nombre para eliminación de hoja de ruta
  const [hojaParaEliminarId, setHojaParaEliminarId] = useState<string | null>(null);
  const [textoConfirmacionEliminar, setTextoConfirmacionEliminar] = useState<string>('');
  const [isEliminando, setIsEliminando] = useState<boolean>(false);

  // HU #45: Reemplazo de hoja de ruta asignada a un transportista
  const [modalReemplazo, setModalReemplazo] = useState<{
    hojaDestino: HojaDeRuta;
    transportista: Transportista;
    hojaPrevia: HojaDeRuta;
  } | null>(null);
  // Confirmación deliberada por tipeo para quitar una visita de una hoja de ruta
  const [visitaParaQuitarId, setVisitaParaQuitarId] = useState<string | null>(null);
  const [hojaDeVisitaParaQuitarId, setHojaDeVisitaParaQuitarId] = useState<string | null>(null);
  const [textoConfirmacionQuitarVisita, setTextoConfirmacionQuitarVisita] = useState<string>('');
  const [isQuitandoVisita, setIsQuitandoVisita] = useState<boolean>(false);

  const getComercio = (id: string) =>
    comercios.find((c) => c.id === id) || remitoService.getComercioById(id);

  const getMarca = (id: string) =>
    marcas.find((m) => m.id === id) || remitoService.getMarcaById(id);

  const recargarDatos = async () => {
    const [pend, vis, com, mar, listaHojas, trans] = await Promise.all([
      remitoService.getRemitosPendientesAsync(),
      remitoService.getVisitasAsync(),
      remitoService.getComerciosAsync(),
      remitoService.getMarcasAsync(),
      remitoService.getHojasDeRutaAsync(),
      remitoService.getTransportistasAsync(),
    ]);

    setPendientes(pend);
    setVisitas(vis);
    setComercios(com);
    setMarcas(mar);
    setHojasRuta(listaHojas);
    setTransportistas(trans);
  };

  useEffect(() => {
    recargarDatos();
    const handleFocus = () => {
      recargarDatos();
    };
    window.addEventListener('focus', handleFocus);
    const interval = setInterval(recargarDatos, 10000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, []);

  // Visitas en armado (las que aún no pertenecen a una Hoja de Ruta programada)
  const hojasProgramadasIds = new Set(
    hojasRuta
      .filter((h) => h.estado !== 'borrador')
      .map((h) => h.id)
  );
  const visitasEnArmado = visitas.filter(
    (v) => !v.hojaDeRutaId || !hojasProgramadasIds.has(v.hojaDeRutaId)
  );

  // Hojas de Ruta Armadas ya creadas
  const hojasArmadas = hojasRuta.filter((h) => {
    if (
      h.estado !== 'pendiente_de_despacho' &&
      h.estado !== 'publicada' &&
      h.estado !== 'en_curso' &&
      h.estado !== 'cerrada'
    ) {
      return false;
    }
    const tieneVisitasDirectas = (h.visitas?.length || 0) > 0;
    const tieneVisitasEnEstado = visitas.some((v) => v.hojaDeRutaId === h.id);
    const tieneCantidadVisitas = (h.cantidadVisitas || 0) > 0;
    return tieneVisitasDirectas || tieneVisitasEnEstado || tieneCantidadVisitas;
  });

  // Requisitos mínimos de avance entre pasos
  const paso1Completo = visitasEnArmado.length > 0;
  const fechaEsValida = Boolean(fechaInput && fechaInput >= hoyISO);
  const paso2Completo = paso1Completo && fechaEsValida;
  const paso3Completo = paso2Completo; // El transportista puede ser asignado u opcional

  const puedeIrAlPaso = (objetivo: number): boolean => {
    if (objetivo <= pasoActual) return true; // Retroceder libremente
    if (objetivo === 2) return paso1Completo;
    if (objetivo === 3) return paso2Completo;
    if (objetivo === 4) return paso3Completo;
    return false;
  };

  const cambiarPaso = (nuevoPaso: number) => {
    if (puedeIrAlPaso(nuevoPaso)) {
      setPasoActual(nuevoPaso);
      setMensaje(null);
    }
  };

  // --- Operaciones Paso 1 ---
  const handleToggleSeleccion = (id: string) => {
    const nuevos = new Set(seleccionados);
    nuevos.has(id) ? nuevos.delete(id) : nuevos.add(id);
    setSeleccionados(nuevos);
    setMensaje(null);
  };

  const handleSeleccionarPorComercio = (comercioId: string) => {
    const idsMismoComercio = pendientes
      .filter((r) => r.comercioId === comercioId)
      .map((r) => r.id);
    setSeleccionados(new Set(idsMismoComercio));
    setMensaje(null);
  };

  const handleLimpiarSeleccion = () => {
    setSeleccionados(new Set());
    setMensaje(null);
  };

  const handleAgrupar = async () => {
    const result = await remitoService.agruparEnVisitaAsync(Array.from(seleccionados));

    if (result.success && result.visita) {
      const comercio = getComercio(result.visita.comercioId);
      setUltimaVisitaId(result.visita.id);
      setMensaje({
        tipo: 'exito',
        texto: `Se consolidaron ${seleccionados.size} remito(s) en la visita para "${comercio?.razonSocial || 'el comercio seleccionado'}".`,
      });
      await recargarDatos();
      setSeleccionados(new Set());
    } else {
      setMensaje({ tipo: 'error', texto: result.error || 'Error al agrupar remitos.' });
    }
  };

  const handleDesagrupar = async (visitaId: string) => {
    await remitoService.desagruparVisitaAsync(visitaId);
    await recargarDatos();
    setMensaje({
      tipo: 'exito',
      texto: 'La visita fue desagrupada y sus remitos volvieron a la bandeja de pendientes.',
    });
  };

  const handleCargaManualExitosa = async (_remito: Remito, textoExito: string) => {
    await recargarDatos();
    setMensaje({ tipo: 'exito', texto: textoExito });
  };

  const handleAbrirAnexar = (remito: Remito, hojaId?: string) => {
    setRemitoParaAnexar(remito);
    setHojaDestinoPreseleccionada(hojaId || null);
    setModalAnexarAbierto(true);
  };

  const handleAnexionExitosa = async (_resultado: any, textoExito: string) => {
    await recargarDatos();
    setMensaje({ tipo: 'exito', texto: textoExito });
  };

  // --- Operaciones Paso 2 ---
  const handleReordenar = async (nuevoOrdenVisitas: Visita[]) => {
    const ids = nuevoOrdenVisitas.map((v) => v.id);
    const res = await remitoService.reordenarVisitasAsync(ids);
    if (res.success) {
      await recargarDatos();
      setMensaje({
        tipo: 'exito',
        texto: 'Secuencia de reparto actualizada correctamente.',
      });
    } else {
      setMensaje({
        tipo: 'error',
        texto: res.error || 'No se pudo modificar el orden de las visitas.',
      });
      await recargarDatos();
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = draggedIndex ?? Number(e.dataTransfer.getData('text/plain'));
    setDraggedIndex(null);

    if (sourceIndex === null || isNaN(sourceIndex) || sourceIndex === targetIndex) {
      return;
    }

    const nuevaLista = [...visitasEnArmado];
    const [removido] = nuevaLista.splice(sourceIndex, 1);
    nuevaLista.splice(targetIndex, 0, removido);
    await handleReordenar(nuevaLista);
  };

  const handleMoverArriba = async (index: number) => {
    if (index <= 0) return;
    const nuevaLista = [...visitasEnArmado];
    const temp = nuevaLista[index - 1];
    nuevaLista[index - 1] = nuevaLista[index];
    nuevaLista[index] = temp;
    await handleReordenar(nuevaLista);
  };

  const handleMoverAbajo = async (index: number) => {
    if (index >= visitasEnArmado.length - 1) return;
    const nuevaLista = [...visitasEnArmado];
    const temp = nuevaLista[index + 1];
    nuevaLista[index + 1] = nuevaLista[index];
    nuevaLista[index] = temp;
    await handleReordenar(nuevaLista);
  };

  // --- Operaciones Paso 4: Confirmación Final ---
  const handleConfirmarHojaDeRuta = async () => {
    if (!confirmacionChecked) {
      setMensaje({
        tipo: 'error',
        texto: 'Debés marcar la casilla de verificación confirmando que los datos son correctos.',
      });
      return;
    }

    if (visitasEnArmado.length === 0) {
      setMensaje({
        tipo: 'error',
        texto: 'No hay visitas para conformar la hoja de ruta.',
      });
      return;
    }

    setIsSubmitting(true);
    setMensaje(null);

    try {
      // 1. Programar la fecha de la hoja de ruta
      const resultado = await remitoService.asignarFechaHojaDeRutaAsync(fechaInput);

      if (!resultado.success || !resultado.hojaDeRuta) {
        setMensaje({
          tipo: 'error',
          texto: resultado.error || 'No se pudo crear la hoja de ruta.',
        });
        setIsSubmitting(false);
        return;
      }

      const nuevaHojaId = resultado.hojaDeRuta.id;
      const codigo =
        resultado.hojaDeRuta.numero || `HR-${String(nuevaHojaId).padStart(4, '0')}`;

      // 2. Si se seleccionó transportista en el Paso 3, asignarlo
      if (transportistaSeleccionadoId) {
        const resAsignacion = await remitoService.asignarTransportistaHojaDeRutaAsync(
          nuevaHojaId,
          transportistaSeleccionadoId
        );
        if (!resAsignacion.success) {
          console.warn('Aviso: no se pudo asignar transportista automáticamente:', resAsignacion.error);
        }
      }

      await recargarDatos();
      setPasoActual(1);
      setConfirmacionChecked(false);
      setTransportistaSeleccionadoId('');
      setMensaje({
        tipo: 'exito',
        texto: `¡Hoja de ruta ${codigo} creada exitosamente para el ${formatearFechaCorta(
          fechaInput
        )} en estado "Pendiente de despacho"!`,
      });
      cambiarSubvista('armadas');
    } catch {
      setMensaje({
        tipo: 'error',
        texto: 'Ocurrió un error inesperado al procesar la confirmación.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Operaciones de gestión en Hojas de Ruta Armadas existentes
  const handleAsignarTransportistaEnHoja = async (hojaId: string, transportistaId: string) => {
    const hoja = hojasRuta.find((h) => h.id === hojaId);
    const visitasHoja = visitas.filter((v) => v.hojaDeRutaId === hojaId);
    const tieneEntregas = visitasHoja.some(
      (v) =>
        v.estado === 'en_curso' ||
        v.estado === 'completada' ||
        v.remitos.some(
          (r) =>
            r.estado === 'entregado' ||
            r.estado === 'no_entregado' ||
            r.estado === 'devuelto'
        )
    );
    if (hoja?.estado === 'en_curso' || hoja?.estado === 'cerrada' || tieneEntregas) {
      setErrorAsignacionPorHoja((prev) => ({
        ...prev,
        [hojaId]:
          'No se puede modificar ni desasignar el transportista: la hoja de ruta ya fue despachada o cuenta con entregas realizadas.',
      }));
      return;
    }

    setAsignandoHojaId(hojaId);
    setErrorAsignacionPorHoja((prev) => ({ ...prev, [hojaId]: '' }));
    setExitoAsignacionPorHoja((prev) => ({ ...prev, [hojaId]: '' }));

    const res = await remitoService.asignarTransportistaHojaDeRutaAsync(
      hojaId,
      transportistaId || null
    );

    if (res.success && res.hojaDeRuta) {
      const hojaActualizada = res.hojaDeRuta;
      setHojasRuta((prev) =>
        prev.map((h) => (h.id === hojaId ? { ...h, ...hojaActualizada } : h))
      );
      const nombre = hojaActualizada.transportistaNombre;
      setExitoAsignacionPorHoja((prev) => ({
        ...prev,
        [hojaId]: nombre
          ? `Transportista "${nombre}" asignado exitosamente.`
          : 'Transportista desvinculado de la hoja de ruta.',
      }));
      // Sincronizar listado general para actualizar disponibilidad en otras fechas
      void recargarDatos();
    } else {
      setErrorAsignacionPorHoja((prev) => ({
        ...prev,
        [hojaId]: res.error || 'No se pudo asignar el transportista.',
      }));
    }
    setAsignandoHojaId(null);
  };

  const handleConfirmarReemplazo = async () => {
    if (!modalReemplazo) return;
    const { hojaDestino, transportista, hojaPrevia } = modalReemplazo;
    const hojaId = hojaDestino.id;
    setAsignandoHojaId(hojaId);
    setErrorAsignacionPorHoja((prev) => ({ ...prev, [hojaId]: '' }));
    setExitoAsignacionPorHoja((prev) => ({ ...prev, [hojaId]: '' }));
    setModalReemplazo(null);

    const res = await remitoService.reemplazarHojaDeRutaTransportistaAsync(
      hojaDestino.id,
      transportista.id
    );

    if (res.success && res.hojaDeRuta) {
      const hojaActualizada = res.hojaDeRuta;
      setHojasRuta((prev) =>
        prev.map((h) => {
          if (h.id === hojaId) return { ...h, ...hojaActualizada };
          if (h.id === hojaPrevia.id) return { ...h, transportistaId: null, transportistaNombre: null };
          return h;
        })
      );
      setExitoAsignacionPorHoja((prev) => ({
        ...prev,
        [hojaId]: `Reemplazo exitoso: se asignó a "${transportista.nombre}" y se desvinculó de la hoja anterior (${hojaPrevia.numero || 'HR-' + hojaPrevia.id}).`,
      }));
      void recargarDatos();
    } else {
      setErrorAsignacionPorHoja((prev) => ({
        ...prev,
        [hojaId]: res.error || 'No se pudo reemplazar la hoja de ruta.',
      }));
    }
    setAsignandoHojaId(null);
  };

  const handleSolicitarEliminarHoja = (hoja: HojaDeRuta) => {
    const visitasHoja = visitas.filter((v) => v.hojaDeRutaId === hoja.id);
    const tieneEntregas = visitasHoja.some(
      (v) =>
        v.estado === 'en_curso' ||
        v.estado === 'completada' ||
        v.remitos.some(
          (r) =>
            r.estado === 'entregado' ||
            r.estado === 'no_entregado' ||
            r.estado === 'devuelto'
        )
    );
    if (hoja.estado === 'en_curso' || hoja.estado === 'cerrada' || tieneEntregas) {
      setMensaje({
        tipo: 'error',
        texto: 'No se puede eliminar la hoja de ruta: ya fue despachada o contiene entregas realizadas.',
      });
      return;
    }

    setHojaParaEliminarId(hoja.id);
    setTextoConfirmacionEliminar('');
  };

  const handleCancelarEliminarHoja = () => {
    setHojaParaEliminarId(null);
    setTextoConfirmacionEliminar('');
  };

  const handleConfirmarEliminarHoja = async (hoja: HojaDeRuta) => {
    const codigo = hoja.numero || `HR-${String(hoja.id).padStart(4, '0')}`;
    const codigoLimpio = codigo.trim().toLowerCase();
    const textoLimpio = textoConfirmacionEliminar.trim().toLowerCase();

    if (
      textoLimpio !== codigoLimpio &&
      (!hoja.numero || textoLimpio !== hoja.numero.trim().toLowerCase())
    ) {
      setMensaje({
        tipo: 'error',
        texto: `El nombre ingresado no coincide con "${codigo}". Escribilo exactamente para confirmar.`,
      });
      return;
    }

    setIsEliminando(true);
    setMensaje(null);

    try {
      const res = await remitoService.eliminarHojaDeRutaAsync(hoja.id);
      if (res.success) {
        await recargarDatos();
        setHojaParaEliminarId(null);
        setTextoConfirmacionEliminar('');
        setMensaje({
          tipo: 'exito',
          texto: `La hoja de ruta ${codigo} fue eliminada y sus visitas volvieron a la secuencia de armado.`,
        });
      } else {
        setMensaje({
          tipo: 'error',
          texto: res.error || 'No se pudo eliminar la hoja de ruta.',
        });
      }
    } finally {
      setIsEliminando(false);
    }
  };

  const handleSolicitarQuitarVisita = (visita: Visita, hoja: HojaDeRuta) => {
    const estadoVisita = String(visita.estado || '').toLowerCase();
    const esVisitaEntregada =
      estadoVisita === 'completada' ||
      estadoVisita === 'entregado' ||
      (visita.remitos || []).some(
        (r) => r.estado === 'entregado' || r.estado === 'no_entregado' || r.estado === 'devuelto'
      ) ||
      hoja.estado === 'cerrada';

    if (esVisitaEntregada) {
      setMensaje({
        tipo: 'error',
        texto: 'No se puede quitar la visita: ya fue entregada o se encuentra completada en la ruta histórica.',
      });
      return;
    }

    setVisitaParaQuitarId(visita.id);
    setHojaDeVisitaParaQuitarId(hoja.id);
    setTextoConfirmacionQuitarVisita('');
  };

  const handleCancelarQuitarVisita = () => {
    setVisitaParaQuitarId(null);
    setHojaDeVisitaParaQuitarId(null);
    setTextoConfirmacionQuitarVisita('');
  };

  const handleConfirmarQuitarVisita = async (visita: Visita, hoja: HojaDeRuta) => {
    const comercio = getComercio(visita.comercioId);
    const nombreEsperado = (comercio?.razonSocial || `Parada ${visita.orden || ''}`).trim().toLowerCase();
    const textoLimpio = textoConfirmacionQuitarVisita.trim().toLowerCase();
    const paradaIdentificador = `parada ${visita.orden || ''}`.trim().toLowerCase();

    if (textoLimpio !== nombreEsperado && textoLimpio !== paradaIdentificador) {
      setMensaje({
        tipo: 'error',
        texto: `El texto ingresado no coincide con "${comercio?.razonSocial || 'el nombre'}". Escribilo exactamente para confirmar.`,
      });
      return;
    }

    setIsQuitandoVisita(true);
    setMensaje(null);

    try {
      const res = await remitoService.quitarVisitaDeHojaDeRutaAsync(visita.id, hoja.id);
      if (res.success) {
        await recargarDatos();
        setVisitaParaQuitarId(null);
        setHojaDeVisitaParaQuitarId(null);
        setTextoConfirmacionQuitarVisita('');
        setMensaje({
          tipo: 'exito',
          texto: `La parada (${comercio?.razonSocial || 'visita'}) fue removida de la hoja de ruta y sus remitos volvieron a la bandeja de pendientes.`,
        });
      } else {
        setMensaje({
          tipo: 'error',
          texto: res.error || 'No se pudo quitar la visita de la hoja de ruta.',
        });
      }
    } finally {
      setIsQuitandoVisita(false);
    }
  };

  // Filtrado de remitos pendientes
  const terminoBusqueda = busqueda.trim().toLowerCase();
  const pendientesFiltrados = pendientes.filter((r) => {
    if (!terminoBusqueda) return true;
    const marca = getMarca(r.marcaId);
    const comercio = getComercio(r.comercioId);
    return (
      r.numeroRemito.toLowerCase().includes(terminoBusqueda) ||
      (marca && marca.nombre.toLowerCase().includes(terminoBusqueda)) ||
      (comercio && comercio.razonSocial.toLowerCase().includes(terminoBusqueda))
    );
  });

  // Análisis de selección en Paso 1
  const remitosSeleccionadosObj = pendientes.filter((r) => seleccionados.has(r.id));
  const comerciosEnSeleccion = Array.from(new Set(remitosSeleccionadosObj.map((r) => r.comercioId)));
  const seleccionEsValida = comerciosEnSeleccion.length === 1;
  const subtotalSeleccion = remitosSeleccionadosObj.reduce((acc, r) => acc + r.importe, 0);

  // Totales para Paso 4
  const totalRemitosEnArmado = visitasEnArmado.reduce((acc, v) => acc + v.remitos.length, 0);
  const totalImporteEnArmado = visitasEnArmado.reduce((acc, v) => acc + v.importeTotal, 0);
  const comerciosUnicosEnArmado = Array.from(new Set(visitasEnArmado.map((v) => v.comercioId)));
  const transportistaSeleccionado = transportistas.find((t) => t.id === transportistaSeleccionadoId);

  return (
    <div className="space-y-6 mt-2">
      {/* Banner de Feedback (Éxito o Error) */}
      {mensaje && (
        <div
          role={mensaje.tipo === 'error' ? 'alert' : 'status'}
          className={`p-3.5 rounded-lg text-sm flex items-start gap-3 shadow-xs transition-all ${
            mensaje.tipo === 'error'
              ? 'bg-red-50 text-red-900 border border-red-300'
              : 'bg-emerald-50 text-emerald-900 border border-emerald-300'
          }`}
        >
          {mensaje.tipo === 'error' ? (
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          )}
          <div className="flex-1 font-medium">{mensaje.texto}</div>
          <button
            type="button"
            onClick={() => setMensaje(null)}
            className="text-slate-400 hover:text-slate-600 p-0.5"
            aria-label="Cerrar notificación"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Selector de subvista: Remitos pendientes (Armar ruta) vs Hojas de ruta armadas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="inline-flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200 text-xs sm:text-sm">
          <button
            type="button"
            onClick={() => cambiarSubvista('armado')}
            className={`px-3 py-1.5 font-bold rounded-md transition-all flex items-center gap-2 cursor-pointer ${
              subvista === 'armado'
                ? 'bg-white text-marca-azul shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-4 h-4 text-blue-600" />
            <span>Remitos pendientes (Armar ruta)</span>
            {pendientes.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[11px] font-bold">
                {pendientes.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => cambiarSubvista('armadas')}
            className={`px-3 py-1.5 font-bold rounded-md transition-all flex items-center gap-2 cursor-pointer ${
              subvista === 'armadas'
                ? 'bg-white text-marca-azul shadow-xs border border-slate-200/80'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardCheck className="w-4 h-4 text-emerald-600" />
            <span>Hojas de ruta armadas</span>
            {hojasArmadas.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                {hojasArmadas.length}
              </span>
            )}
          </button>
        </div>

        {subvista === 'armadas' ? (
          <button
            type="button"
            onClick={() => cambiarSubvista('armado')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-marca-naranja hover:bg-marca-naranja-hover text-white rounded-md transition-colors shadow-xs cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Armar nueva hoja de ruta</span>
          </button>
        ) : (
          <span className="text-xs text-slate-500">
            Paso {pasoActual} de 4: {PASOS[pasoActual - 1]?.titulo}
          </span>
        )}
      </div>

      {subvista === 'armado' ? (
        <div className="space-y-6">

      {/* Indicador de Progreso Secuencial (Stepper de 4 Pasos) */}
      <nav aria-label="Progreso de armado de hoja de ruta" className="bg-white border border-slate-200 rounded-lg p-2.5 sm:p-3 shadow-xs">
        <ol className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {PASOS.map((paso) => {
            const esActivo = paso.id === pasoActual;
            const esCompletado =
              paso.id < pasoActual &&
              (paso.id === 1 ? paso1Completo : paso.id === 2 ? paso2Completo : true);
            const esBloqueado = !puedeIrAlPaso(paso.id) && !esActivo;

            return (
              <li key={paso.id}>
                <button
                  type="button"
                  onClick={() => cambiarPaso(paso.id)}
                  disabled={esBloqueado}
                  aria-current={esActivo ? 'step' : undefined}
                  className={`w-full text-left p-2.5 rounded-md transition-all flex items-center gap-3 border ${
                    esActivo
                      ? 'bg-marca-azul text-white border-marca-azul shadow-md ring-2 ring-marca-azul/20'
                      : esCompletado
                      ? 'bg-emerald-50/70 border-emerald-300 text-slate-800 hover:bg-emerald-100/60 cursor-pointer'
                      : esBloqueado
                      ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                      esActivo
                        ? 'bg-marca-naranja text-white shadow-2xs'
                        : esCompletado
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {esCompletado ? <Check className="w-4 h-4 stroke-[2.5]" /> : paso.id}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block text-xs font-bold leading-tight truncate ${
                        esActivo ? 'text-white' : 'text-slate-800'
                      }`}
                    >
                      Paso {paso.id}: {paso.titulo}
                    </span>
                    <span
                      className={`block text-[11px] truncate mt-0.5 ${
                        esActivo ? 'text-slate-200' : 'text-slate-500'
                      }`}
                    >
                      {paso.subtitulo}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* =========================================================================
          PASO 1: AGRUPAR REMITOS
      ========================================================================= */}
      {pasoActual === 1 && (
        <section aria-labelledby="titulo-paso-1" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Columna Izquierda: Remitos pendientes por agrupar (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-blue-600 shrink-0" />
                  <div>
                    <h2 id="titulo-paso-1" className="text-base font-bold text-slate-800">
                      Remitos pendientes de agrupar
                    </h2>
                    <span className="text-xs text-slate-500">
                      {pendientes.length} documento(s) disponible(s) en la bandeja
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalCargaManualAbierto(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-marca-naranja hover:bg-marca-naranja-hover text-white rounded-md transition-colors shadow-xs cursor-pointer"
                  title="Cargar manualmente entregas no contempladas en la importación"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Cargar entrega manual</span>
                </button>
              </div>

              {/* Búsqueda rápida */}
              {pendientes.length > 0 && (
                <div className="space-y-2.5">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar por nro. remito, comercio o marca..."
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all"
                    />
                    {busqueda && (
                      <button
                        type="button"
                        onClick={() => setBusqueda('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                        title="Limpiar búsqueda"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Filtro rápido por comercio */}
                  <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 p-2 rounded-md border border-slate-200/80">
                    <span className="text-xs text-slate-600 font-medium mr-1">
                      Autoseleccionar por comercio:
                    </span>
                    {comercios.map((com) => {
                      const cant = pendientes.filter((r) => r.comercioId === com.id).length;
                      if (cant === 0) return null;
                      return (
                        <button
                          key={com.id}
                          type="button"
                          onClick={() => handleSeleccionarPorComercio(com.id)}
                          className="px-2 py-0.5 text-xs bg-white hover:bg-blue-50 hover:border-blue-300 text-slate-700 font-medium rounded border border-slate-300 transition-colors shadow-2xs cursor-pointer"
                        >
                          {com.razonSocial} <span className="text-blue-600 font-bold">({cant})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Lista densa de remitos pendientes con scroll optimizado */}
              <div className="max-h-[440px] overflow-y-auto pr-1 space-y-2">
                {pendientes.length === 0 ? (
                  <div className="border-2 border-dashed border-slate-200 rounded-md p-6 text-center space-y-2 bg-slate-50/50">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <div className="text-sm font-bold text-slate-800">
                      Todos los remitos disponibles ya fueron agrupados
                    </div>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Podés continuar al <strong>Paso 2</strong> para ordenar la secuencia y programar la fecha, o cargar una nueva entrega manual con el botón superior.
                    </p>
                  </div>
                ) : pendientesFiltrados.length === 0 ? (
                  <div className="border border-slate-200 rounded-md p-6 text-center space-y-2 bg-slate-50">
                    <div className="text-xs sm:text-sm font-medium text-slate-700">
                      No se encontraron remitos para "{busqueda}"
                    </div>
                    <button
                      type="button"
                      onClick={() => setBusqueda('')}
                      className="text-xs text-blue-600 hover:underline font-semibold"
                    >
                      Limpiar filtro de búsqueda
                    </button>
                  </div>
                ) : (
                  pendientesFiltrados.map((remito) => {
                    const marca = getMarca(remito.marcaId);
                    const comercio = getComercio(remito.comercioId);
                    const isSelected = seleccionados.has(remito.id);

                    return (
                      <div
                        key={remito.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 border rounded-md transition-all ${
                          isSelected
                            ? 'bg-blue-50/90 border-blue-400 ring-1 ring-blue-400/30'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <label className="flex items-start sm:items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                          <input
                            type="checkbox"
                            className="mt-1 sm:mt-0 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 shrink-0"
                            checked={isSelected}
                            onChange={() => handleToggleSeleccion(remito.id)}
                          />
                          <div className="min-w-0 text-xs space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-slate-900 text-sm">
                                {remito.numeroRemito}
                              </span>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                                <Tag className="w-2.5 h-2.5 text-slate-500" />
                                {marca?.nombre || remito.marcaId}
                              </span>
                            </div>
                            <div className="text-slate-600 flex items-center gap-2">
                              <span>
                                Importe:{' '}
                                <strong className="font-mono text-slate-900">
                                  ${remito.importe.toLocaleString('es-AR')}
                                </strong>
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleAbrirAnexar(remito);
                                }}
                                className="text-[11px] px-1.5 py-0.5 border border-slate-300 rounded text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                                title="Anexar esta entrega a una hoja de ruta existente"
                              >
                                Anexar a ruta
                              </button>
                            </div>
                          </div>
                        </label>

                        {/* Comercio fijo */}
                        <div className="flex items-center gap-1.5 sm:w-56 shrink-0">
                          <div
                            className="flex items-center gap-1.5 w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800"
                            title={`Destino: ${comercio?.razonSocial || remito.comercioId}`}
                          >
                            <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">
                              {comercio?.razonSocial || remito.comercioId}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Barra inferior de consolidación (Acción "Agrupar") */}
              {seleccionados.size > 0 && (
                <div
                  className={`p-3 rounded-md border text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                    seleccionEsValida
                      ? 'bg-blue-50 border-blue-200 text-blue-950'
                      : 'bg-amber-50 border-amber-300 text-amber-950'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-blue-700" />
                      <span>
                        {seleccionados.size} remito(s) seleccionado(s) • Subtotal: $
                        {subtotalSeleccion.toLocaleString('es-AR')}
                      </span>
                    </div>
                    <div>
                      {seleccionEsValida ? (
                        <span className="text-xs text-slate-700">
                          Destino común:{' '}
                          <strong>
                            {getComercio(comerciosEnSeleccion[0])?.razonSocial || comerciosEnSeleccion[0]}
                          </strong>
                        </span>
                      ) : (
                        <span className="text-xs text-amber-900 font-semibold">
                          Atención: Seleccionaste remitos de {comerciosEnSeleccion.length} comercios distintos. Solo se pueden agrupar remitos del mismo comercio.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={handleLimpiarSeleccion}
                      className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      onClick={handleAgrupar}
                      disabled={!seleccionEsValida}
                      className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-md shadow-xs transition-colors shrink-0 ${
                        seleccionEsValida
                          ? 'bg-marca-naranja hover:bg-marca-naranja-hover text-white cursor-pointer'
                          : 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-80'
                      }`}
                      title={
                        !seleccionEsValida
                          ? 'Solo se pueden agrupar remitos que pertenezcan al mismo comercio'
                          : 'Consolidar remitos seleccionados en una visita'
                      }
                    >
                      <span>Consolidar en visita</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Columna Derecha: Visitas armadas en borrador (5 cols) */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <h2 className="text-base font-bold text-slate-800">
                      Visitas armadas ({visitasEnArmado.length})
                    </h2>
                    <span className="text-xs text-slate-500">
                      Paradas conformadas listas para la ruta
                    </span>
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  En borrador
                </span>
              </div>

              {visitasEnArmado.length === 0 ? (
                <div className="border-2 border-dashed border-slate-200 rounded-md p-6 text-center space-y-2 bg-slate-50/50">
                  <MapPin className="w-8 h-8 text-slate-400 mx-auto" />
                  <div className="text-sm font-semibold text-slate-700">
                    Aún no hay visitas armadas
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
                    Seleccioná los remitos del mismo comercio en la columna izquierda y presioná <strong>"Consolidar en visita"</strong> para armar las paradas de la hoja de ruta.
                  </p>
                </div>
              ) : (
                <div className="max-h-[440px] overflow-y-auto pr-1 space-y-2.5">
                  {visitasEnArmado.map((visita, idx) => {
                    const comercio = getComercio(visita.comercioId);
                    const esReciente = visita.id === ultimaVisitaId;

                    return (
                      <div
                        key={visita.id}
                        className={`border rounded-md p-3 space-y-2 text-xs transition-all ${
                          esReciente
                            ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500/20'
                            : 'border-slate-200 bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 bg-blue-700 text-white font-mono text-[11px] font-bold rounded">
                                Visita {idx + 1}
                              </span>
                              {esReciente && (
                                <span className="text-[10px] bg-emerald-200 text-emerald-900 px-1.5 py-0.5 rounded font-semibold">
                                  Recién agrupada
                                </span>
                              )}
                            </div>
                            <div className="text-sm font-bold text-slate-900 mt-0.5">
                              {comercio?.razonSocial || 'Comercio destinatario'}
                            </div>
                            <div className="text-slate-500 text-[11px]">
                              {comercio?.domicilio || 'Domicilio registrado'}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDesagrupar(visita.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-200 rounded transition-colors cursor-pointer shrink-0"
                            title="Desarmar esta visita y devolver sus remitos a pendientes"
                          >
                            <Undo2 className="w-3 h-3" />
                            <span>Desagrupar</span>
                          </button>
                        </div>

                        {/* Remitos de la visita */}
                        <div className="bg-white border border-slate-200 rounded p-2 space-y-1">
                          <span className="text-[11px] font-semibold text-slate-500 block">
                            Documentos ({visita.remitos.length}):
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {visita.remitos.map((r) => (
                              <span
                                key={r.id}
                                className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px] text-slate-800"
                              >
                                {r.numeroRemito} (${r.importe.toLocaleString('es-AR')})
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/80 text-[11px]">
                          <span className="text-slate-600">Subtotal visita:</span>
                          <strong className="font-mono text-sm text-slate-900">
                            ${visita.importeTotal.toLocaleString('es-AR')}
                          </strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Botón de avance al Paso 2 */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {visitasEnArmado.length > 0
                    ? `${visitasEnArmado.length} visita(s) lista(s)`
                    : 'Mínimo 1 visita requerida'}
                </span>
                <button
                  type="button"
                  onClick={() => cambiarPaso(2)}
                  disabled={!paso1Completo}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-md shadow-xs transition-colors ${
                    paso1Completo
                      ? 'bg-marca-azul hover:bg-blue-800 text-white cursor-pointer'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-75'
                  }`}
                  title={
                    !paso1Completo
                      ? 'Consolidá al menos una visita para poder avanzar al siguiente paso'
                      : 'Avanzar a ordenar y programar'
                  }
                >
                  <span>Continuar a ordenar y programar</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* =========================================================================
          PASO 2: ORDENAR Y PROGRAMAR
      ========================================================================= */}
      {pasoActual === 2 && (
        <section aria-labelledby="titulo-paso-2" className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-2">
            <div>
              <h2 id="titulo-paso-2" className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <span>Ordenar paradas y programar fecha de distribución</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Definí el orden óptimo de entrega para el transportista y el día de salida del reparto.
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded font-semibold bg-blue-50 text-blue-800 border border-blue-200 self-start sm:self-auto">
              {visitasEnArmado.length} parada(s) para secuenciar
            </span>
          </div>

          {/* Selector de Fecha de Distribución */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label htmlFor="fecha-reparto" className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-marca-naranja" />
                <span>Fecha de distribución de la hoja de ruta:</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFechaInput(hoyISO)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border transition-colors cursor-pointer ${
                    fechaInput === hoyISO
                      ? 'bg-marca-azul text-white border-marca-azul'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Hoy ({formatearFechaCorta(hoyISO)})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    setFechaInput(d.toISOString().slice(0, 10));
                  }}
                  className="px-2.5 py-1 text-xs font-semibold bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                >
                  Mañana
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <input
                id="fecha-reparto"
                type="date"
                min={hoyISO}
                value={fechaInput}
                onChange={(e) => setFechaInput(e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
              {!fechaEsValida && (
                <span className="text-xs text-red-600 font-semibold flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  La fecha no puede ser anterior al día de hoy.
                </span>
              )}
            </div>
          </div>

          {/* Lista de Visitas con Drag-and-Drop y Flechas Accesibles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="font-semibold">Secuencia planificada de visitas:</span>
              <span>Podés arrastrar con el asa o usar las flechas para reordenar</span>
            </div>

            {visitasEnArmado.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center space-y-2">
                <MapPin className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="text-sm font-semibold text-slate-700">
                  No hay visitas para ordenar
                </div>
                <p className="text-xs text-slate-500">
                  Volvé al <strong>Paso 1</strong> para seleccionar remitos y consolidarlos en visitas.
                </p>
                <button
                  type="button"
                  onClick={() => setPasoActual(1)}
                  className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-bold"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Volver a agrupar remitos</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                {visitasEnArmado.map((visita, index) => {
                  const comercio = getComercio(visita.comercioId);
                  const isDragging = draggedIndex === index;
                  const ordenNumero = index + 1;

                  return (
                    <div
                      key={visita.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, index)}
                      className={`border rounded-md p-3 transition-all cursor-grab active:cursor-grabbing hover:border-blue-300 ${
                        isDragging ? 'opacity-40 border-dashed border-blue-400 bg-blue-50' : 'bg-slate-50/70 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <div
                            className="mt-1 text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-200/60 shrink-0"
                            title="Arrastrá para reordenar"
                          >
                            <GripVertical className="w-5 h-5" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 bg-blue-700 text-white font-mono text-xs font-bold rounded">
                                Parada {ordenNumero}
                              </span>
                              <strong className="text-sm font-bold text-slate-900 truncate">
                                {comercio?.razonSocial || 'Comercio destinatario'}
                              </strong>
                            </div>
                            <div className="text-xs text-slate-600 mt-0.5">
                              {comercio?.domicilio || 'Domicilio registrado'}
                            </div>

                            {/* Desglose compacto de remitos */}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] text-slate-500 font-medium">
                                {visita.remitos.length} remito(s):
                              </span>
                              {visita.remitos.map((r) => {
                                const marca = getMarca(r.marcaId);
                                return (
                                  <span
                                    key={r.id}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-mono text-[11px]"
                                  >
                                    <FileText className="w-2.5 h-2.5 text-blue-600" />
                                    <span>{r.numeroRemito}</span>
                                    <span className="text-slate-400">({marca?.nombre || r.marcaId})</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Controles de orden accesibles: Subir / Bajar / Desagrupar */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <span className="text-[11px] text-slate-500 block">Subtotal</span>
                            <strong className="font-mono text-sm text-slate-900 block">
                              ${visita.importeTotal.toLocaleString('es-AR')}
                            </strong>
                          </div>

                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => handleMoverArriba(index)}
                              className="p-1 rounded bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed border border-slate-200 text-slate-600 hover:text-blue-600 cursor-pointer"
                              title={index === 0 ? 'Ya está primera' : 'Mover arriba'}
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === visitasEnArmado.length - 1}
                              onClick={() => handleMoverAbajo(index)}
                              className="p-1 rounded bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed border border-slate-200 text-slate-600 hover:text-blue-600 cursor-pointer"
                              title={index === visitasEnArmado.length - 1 ? 'Ya está última' : 'Mover abajo'}
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Navegación del Paso 2 */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPasoActual(1)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver a agrupar remitos</span>
            </button>

            <button
              type="button"
              onClick={() => cambiarPaso(3)}
              disabled={!paso2Completo}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-md shadow-xs transition-colors ${
                paso2Completo
                  ? 'bg-marca-azul hover:bg-blue-800 text-white cursor-pointer'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-75'
              }`}
            >
              <span>Continuar a asignar transportista</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {/* =========================================================================
          PASO 3: ASIGNAR TRANSPORTISTA
      ========================================================================= */}
      {pasoActual === 3 && (
        <section aria-labelledby="titulo-paso-3" className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-2">
            <div>
              <h2 id="titulo-paso-3" className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Truck className="w-5 h-5 text-marca-naranja" />
                <span>Asignar transportista para la hoja de ruta</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Seleccioná el chofer habilitado que conducirá el reparto para el día {formatearFechaCorta(fechaInput)}.
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 self-start sm:self-auto">
              Fecha asignada: {formatearFechaCorta(fechaInput)}
            </span>
          </div>

          {/* Filtro y Búsqueda de Chofer */}
          <div className="space-y-3">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar transportista por nombre o usuario..."
                value={busquedaTransportista}
                onChange={(e) => setBusquedaTransportista(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
              />
              {busquedaTransportista && (
                <button
                  type="button"
                  onClick={() => setBusquedaTransportista('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Selector de transportistas en estilo Tarjeta/Radio */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
              {/* Opción: Sin transportista asignado */}
              <label
                className={`border rounded-lg p-3 flex items-start gap-3 cursor-pointer transition-all ${
                  transportistaSeleccionadoId === ''
                    ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500/30'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="selector-transportista"
                  value=""
                  checked={transportistaSeleccionadoId === ''}
                  onChange={() => setTransportistaSeleccionadoId('')}
                  className="mt-1 w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-800">Dejar sin transportista asignado</span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">
                      Opcional
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Podrás vincular un transportista más adelante desde la sección de Hojas de ruta armadas.
                  </p>
                </div>
              </label>

              {/* Listado real de transportistas con verificación de solapamiento */}
              {transportistas
                .filter((t) => {
                  if (!busquedaTransportista.trim()) return true;
                  const term = busquedaTransportista.toLowerCase();
                  return t.nombre.toLowerCase().includes(term) || t.usuario.toLowerCase().includes(term);
                })
                .map((t) => {
                  const isSelected = transportistaSeleccionadoId === t.id;
                  const cleanTId = String(t.id).replace(/^usr_/, '').trim();
                  const fechaObjetivo = (fechaInput || '').slice(0, 10);

                  // Hojas asignadas a este transportista que no estén anuladas
                  const hojasDeChofer = hojasRuta.filter(
                    (otra) =>
                      String(otra.transportistaId || '').replace(/^usr_/, '').trim() === cleanTId &&
                      otra.estado !== 'anulada'
                  );

                  // Verificación de solapamiento: ¿el transportista ya tiene OTRA hoja en esa misma fecha específica?
                  const hojaSolapadaEnFecha = hojasDeChofer.find(
                    (otra) => (otra.fechaReparto || '').slice(0, 10) === fechaObjetivo
                  );
                  const ocupadoEnFecha = Boolean(hojaSolapadaEnFecha);

                  // Rutas del chofer en otras fechas distintas a la programada (demuestra que puede trabajar múltiples días)
                  const otrasFechas = hojasDeChofer.filter(
                    (otra) => (otra.fechaReparto || '').slice(0, 10) !== fechaObjetivo
                  );

                  return (
                    <label
                      key={t.id}
                      className={`border rounded-lg p-3 flex items-start gap-3 transition-all ${
                        ocupadoEnFecha
                          ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                          : isSelected
                          ? 'border-marca-naranja bg-orange-50/60 ring-1 ring-marca-naranja/30 cursor-pointer'
                          : 'border-slate-200 bg-white hover:border-slate-300 cursor-pointer'
                      }`}
                    >
                      <input
                        type="radio"
                        name="selector-transportista"
                        value={t.id}
                        disabled={ocupadoEnFecha}
                        checked={isSelected}
                        onChange={() => setTransportistaSeleccionadoId(t.id)}
                        className="mt-1 w-4 h-4 text-marca-naranja focus:ring-marca-naranja"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <span className="font-bold text-sm text-slate-900 truncate">{t.nombre}</span>
                          {ocupadoEnFecha ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-semibold border border-red-200">
                              Ocupado en esta fecha ({formatearFechaCorta(fechaInput)})
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold border border-emerald-200">
                              Disponible
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
                          <span>Usuario: @{t.usuario}</span>
                          {t.dispositivoConectado !== undefined && (
                            <span className="inline-flex items-center gap-1 text-[11px]">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  t.dispositivoConectado ? 'bg-emerald-500' : 'bg-amber-500'
                                }`}
                              />
                              {t.dispositivoConectado ? 'Conectado' : 'Sin conexión'}
                            </span>
                          )}
                        </div>
                        {/* Indicador de disponibilidad multijornada */}
                        {ocupadoEnFecha ? (
                          <p className="text-[11px] text-red-600 mt-1">
                            Ya tiene asignada la hoja {hojaSolapadaEnFecha?.numero || `HR-${hojaSolapadaEnFecha?.id}`} para este día.
                          </p>
                        ) : otrasFechas.length > 0 ? (
                          <p className="text-[11px] text-blue-700 mt-1 font-medium">
                            ✓ Habilitado: ya asignado en {otrasFechas.length} {otrasFechas.length === 1 ? 'otra jornada' : 'otras jornadas'} ({otrasFechas.map((o) => `${formatearFechaCorta(o.fechaReparto)} [${o.numero || o.id}]`).join(', ')}).
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-400 mt-1">
                            Sin otras rutas asignadas en el calendario.
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
            </div>
          </div>

          {/* Navegación del Paso 3 */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPasoActual(2)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver a ordenar y programar</span>
            </button>

            <button
              type="button"
              onClick={() => cambiarPaso(4)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold bg-marca-azul hover:bg-blue-800 text-white rounded-md shadow-xs transition-colors cursor-pointer"
            >
              <span>Continuar a confirmación</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {/* =========================================================================
          PASO 4: CONFIRMAR (PANTALLA DE REVISIÓN Y ACCIÓN DELIBERADA)
      ========================================================================= */}
      {pasoActual === 4 && (
        <section aria-labelledby="titulo-paso-4" className="bg-white border-2 border-slate-300 rounded-lg p-5 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h2 id="titulo-paso-4" className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6 text-emerald-600" />
              <span>Revisión y confirmación de la hoja de ruta</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Verificá el resumen operativo antes de generar la hoja de ruta definitiva. Esta acción asociará las visitas y los remitos a la ruta de despacho.
            </p>
          </div>

          {/* Tarjetas KPI de Resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-1">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                Fecha de reparto
              </span>
              <strong className="text-base font-mono font-bold text-slate-900 block">
                {formatearFechaCorta(fechaInput)}
              </strong>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-1">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                Total de paradas
              </span>
              <strong className="text-base font-mono font-bold text-slate-900 block">
                {visitasEnArmado.length} visita(s)
              </strong>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-1">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-amber-600" />
                Carga consolidada
              </span>
              <strong className="text-base font-bold text-slate-900 block">
                {totalRemitosEnArmado} remito(s) en {comerciosUnicosEnArmado.length} comercio(s)
              </strong>
            </div>

            <div className="bg-blue-50/70 border border-blue-200 rounded-md p-3.5 space-y-1">
              <span className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                Valor consolidado
              </span>
              <strong className="text-base font-mono font-bold text-blue-950 block">
                ${totalImporteEnArmado.toLocaleString('es-AR')}
              </strong>
            </div>
          </div>

          {/* Bloque de Transportista Asignado */}
          <div className="bg-slate-50 border border-slate-200 rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-700">
                <User className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-500 block">Transportista asignado:</span>
                <strong className="text-sm font-bold text-slate-900">
                  {transportistaSeleccionado ? transportistaSeleccionado.nombre : 'Sin transportista asignado'}
                </strong>
                {transportistaSeleccionado && (
                  <span className="text-xs text-slate-500 block">
                    Usuario: @{transportistaSeleccionado.usuario} · Asignado para la jornada del {formatearFechaCorta(fechaInput)}
                  </span>
                )}
              </div>
            </div>

            <div>
              {transportistaSeleccionado ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 text-xs font-semibold border border-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Listo para despacho
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-900 text-xs font-semibold border border-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Quedará pendiente de chofer
                </span>
              )}
            </div>
          </div>

          {/* Tabla Resumen de la Secuencia de Visitas */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                Secuencia final de paradas ({visitasEnArmado.length})
              </span>
              <span className="text-xs text-slate-500 font-mono">
                Total acumulado: ${totalImporteEnArmado.toLocaleString('es-AR')}
              </span>
            </div>

            <div className="divide-y divide-slate-200 max-h-64 overflow-y-auto">
              {visitasEnArmado.map((visita, idx) => {
                const comercio = getComercio(visita.comercioId);
                return (
                  <div key={visita.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded bg-blue-700 text-white font-mono font-bold text-[11px]">
                        Parada {idx + 1}
                      </span>
                      <div>
                        <strong className="text-slate-900 text-xs block">
                          {comercio?.razonSocial || 'Comercio'}
                        </strong>
                        <span className="text-slate-500 text-[11px]">
                          {comercio?.domicilio} • {visita.remitos.length} remito(s)
                        </span>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-slate-900">
                      ${visita.importeTotal.toLocaleString('es-AR')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bloque de Acción Deliberada (Checkbox Obligatorio) */}
          <div className="bg-amber-50/70 border-2 border-amber-300 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-amber-950">
                  Confirmación deliberada de creación
                </h4>
                <p className="text-xs text-amber-800 mt-0.5">
                  Para evitar creaciones accidentales, debés validar expresamente la revisión antes de habilitar el botón final de generación.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 p-3 bg-white rounded-md border border-amber-300/80 cursor-pointer hover:bg-amber-50/40 transition-colors">
              <input
                type="checkbox"
                checked={confirmacionChecked}
                onChange={(e) => setConfirmacionChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-marca-naranja rounded focus:ring-marca-naranja shrink-0 cursor-pointer"
              />
              <span className="text-xs sm:text-sm font-bold text-slate-900">
                Revisé los datos y son correctos para la distribución
              </span>
            </label>
          </div>

          {/* Navegación y Botón Final */}
          <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPasoActual(3)}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors cursor-pointer self-start sm:self-auto"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver a transportista</span>
            </button>

            <button
              type="button"
              onClick={handleConfirmarHojaDeRuta}
              disabled={!confirmacionChecked || isSubmitting || visitasEnArmado.length === 0}
              className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-extrabold rounded-md shadow-md transition-all ${
                confirmacionChecked && !isSubmitting && visitasEnArmado.length > 0
                  ? 'bg-marca-naranja hover:bg-marca-naranja-hover text-white cursor-pointer hover:shadow-lg'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-75'
              }`}
              title={
                !confirmacionChecked
                  ? 'Marcá la casilla de revisión para habilitar la creación de la hoja de ruta'
                  : 'Crear hoja de ruta definitiva'
              }
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>{isSubmitting ? 'Creando hoja de ruta...' : 'Crear hoja de ruta'}</span>
            </button>
          </div>
        </section>
      )}
        </div>
      ) : (
        <section
          data-testid="hojas-de-ruta-armadas"
          className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden"
        >
        <button
          type="button"
          onClick={() => setMostrarHojasArmadas(!mostrarHojasArmadas)}
          className="w-full bg-marca-azul text-white px-5 py-3.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-blue-950 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ClipboardCheck className="w-5 h-5 text-marca-crema" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Hojas de ruta armadas ({hojasArmadas.length})
              </h3>
              <p className="text-xs text-slate-200">
                Rutas programadas, asignadas y despachadas en la sucursal
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void recargarDatos();
              }}
              className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Actualizar datos"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {mostrarHojasArmadas ? (
              <ChevronUp className="w-5 h-5 text-slate-200" />
            ) : (
              <ChevronDown className="w-5 h-5 text-slate-200" />
            )}
          </div>
        </button>

        {mostrarHojasArmadas && (
          <div className="p-4 sm:p-5 space-y-4 bg-slate-50/40 border-t border-slate-200">
            {hojasArmadas.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center space-y-2 bg-white">
                <ClipboardCheck className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="text-sm font-semibold text-slate-700">
                  Todavía no hay hojas de ruta armadas
                </div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Completá el flujo de 4 pasos para programar y confirmar una nueva hoja de ruta.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {hojasArmadas.map((hoja) => {
                  const codigoHoja = hoja.numero || `HR-${String(hoja.id).padStart(4, '0')}`;
                  const visitasHoja =
                    hoja.visitas && hoja.visitas.length > 0
                      ? hoja.visitas
                      : visitas.filter((v) => v.hojaDeRutaId === hoja.id);
                  const totalRemitosHoja = visitasHoja.reduce(
                    (acc, v) => acc + v.remitos.length,
                    0
                  );
                  const importeTotalHoja = visitasHoja.reduce(
                    (acc, v) => acc + v.importeTotal,
                    0
                  );
                  const tieneEntregas = visitasHoja.some(
                    (v) =>
                      v.estado === 'en_curso' ||
                      v.estado === 'completada' ||
                      v.remitos.some(
                        (r) =>
                          r.estado === 'entregado' ||
                          r.estado === 'no_entregado' ||
                          r.estado === 'devuelto'
                      )
                  );
                  const esDespachada = hoja.estado === 'en_curso' || tieneEntregas;
                  const todasCompletadas =
                    visitasHoja.length > 0 &&
                    visitasHoja.every(
                      (v) =>
                        v.estado === 'completada' ||
                        (v.remitos.length > 0 &&
                          v.remitos.every((r) => r.estado === 'entregado' || r.estado === 'no_entregado'))
                    );

                  return (
                    <div
                      key={hoja.id}
                      className="border border-blue-200 rounded-lg bg-white shadow-2xs overflow-hidden"
                    >
                      {/* Cabecera de la hoja */}
                      <div className="px-4 py-3 bg-blue-50/70 border-b border-blue-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-mono text-sm font-bold text-blue-950">
                            {codigoHoja}
                          </span>
                          {todasCompletadas ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 shadow-2xs">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Completada</span>
                            </span>
                          ) : esDespachada ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-semibold inline-flex items-center gap-1 shadow-2xs">
                              <Truck className="w-3 h-3" />
                              <span>Despachada</span>
                            </span>
                          ) : hoja.estado === 'publicada' ? (
                            <span className="px-2 py-0.5 rounded bg-sky-700 text-white text-[11px] font-semibold">
                              Publicada
                            </span>
                          ) : hoja.estado === 'cerrada' ? (
                            <span className="px-2 py-0.5 rounded bg-slate-700 text-white text-[11px] font-semibold">
                              Cerrada
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-blue-700 text-white text-[11px] font-semibold">
                              Pendiente de despacho
                            </span>
                          )}
                          <span className="text-xs text-slate-600">
                            Total:{' '}
                            <strong className="font-mono text-slate-900">
                              ${importeTotalHoja.toLocaleString('es-AR')}
                            </strong>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {pendientes.length > 0 && (
                            <button
                              type="button"
                              onClick={() => handleAbrirAnexar(pendientes[0], hoja.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-white hover:bg-blue-50 border border-blue-300 rounded transition-colors cursor-pointer"
                              title="Anexar una entrega pendiente a esta hoja de ruta"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Anexar entrega</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={esDespachada}
                            onClick={() => handleSolicitarEliminarHoja(hoja)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border transition-colors ${
                              esDespachada
                                ? 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                                : hojaParaEliminarId === hoja.id
                                ? 'bg-red-50 border-red-400 text-red-800'
                                : 'text-red-700 bg-white hover:bg-red-50 border-red-300 cursor-pointer'
                            }`}
                            title={
                              esDespachada
                                ? 'No se puede eliminar: la ruta ya fue despachada o cuenta con entregas realizadas.'
                                : 'Eliminar esta hoja de ruta y devolver sus visitas al flujo de armado'
                            }
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Eliminar</span>
                          </button>
                        </div>
                      </div>

                      {/* Cuadro de Confirmación Deliberada por Tipeo de Nombre */}
                      {hojaParaEliminarId === hoja.id && (() => {
                        const esTextoCoincidente =
                          textoConfirmacionEliminar.trim().toLowerCase() === codigoHoja.trim().toLowerCase() ||
                          (hoja.numero && textoConfirmacionEliminar.trim().toLowerCase() === hoja.numero.trim().toLowerCase());
                        return (
                          <div className="p-3.5 bg-red-50/95 border-b border-red-200 text-xs text-red-900 space-y-2.5 animate-in fade-in duration-150">
                            <div className="flex items-start gap-2.5">
                              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                              <div className="space-y-0.5">
                                <strong className="text-xs font-bold text-red-950 block">
                                  ¿Deseás eliminar la hoja de ruta {codigoHoja}?
                                </strong>
                                <p className="text-[11px] text-red-800">
                                  Esta acción desarmará la hoja de ruta y devolverá sus visitas al flujo de armado. Para confirmar, escribí el nombre de la hoja de ruta{' '}
                                  <span className="font-mono font-bold bg-red-100 text-red-950 px-1.5 py-0.5 rounded border border-red-300 select-all">
                                    {codigoHoja}
                                  </span>{' '}
                                  a continuación:
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 pt-0.5">
                              <input
                                type="text"
                                autoFocus
                                placeholder={`Escribí "${codigoHoja}"`}
                                value={textoConfirmacionEliminar}
                                onChange={(e) => setTextoConfirmacionEliminar(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (esTextoCoincidente && !isEliminando) {
                                      void handleConfirmarEliminarHoja(hoja);
                                    }
                                  }
                                }}
                                className="bg-white border border-red-300 rounded px-2.5 py-1 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 w-52 placeholder-slate-400"
                              />
                              <button
                                type="button"
                                disabled={!esTextoCoincidente || isEliminando}
                                onClick={() => void handleConfirmarEliminarHoja(hoja)}
                                className={`px-3 py-1 text-xs font-bold rounded flex items-center gap-1.5 transition-all ${
                                  esTextoCoincidente && !isEliminando
                                    ? 'bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-xs'
                                    : 'bg-red-200 text-red-400 cursor-not-allowed opacity-70'
                                }`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>{isEliminando ? 'Eliminando...' : 'Confirmar eliminación'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelarEliminarHoja}
                                className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors cursor-pointer"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Detalles y Asignación de Chofer */}
                      <div className="p-4 space-y-3.5 text-xs">
                        {/* Alerta de Sincronización pendiente (HU #19) */}
                        {(hoja.tieneSincronizacionPendiente || visitasHoja.some((v) => v.sincronizacionPendiente)) && (
                          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3 flex items-start gap-2.5">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                              <strong className="font-bold text-amber-950 text-xs block">
                                Sincronización pendiente
                              </strong>
                              <p className="text-amber-800 text-[11px]">
                                El transportista asignado no reporta conexión. Las paradas anexadas permanecen en espera de sincronización con la app móvil.
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5">
                            <span className="text-[11px] font-semibold text-slate-500 block">
                              Fecha de reparto
                            </span>
                            <span className="text-xs font-mono font-bold text-slate-900 mt-0.5 block">
                              {formatearFechaCorta(hoja.fechaReparto)}
                            </span>
                          </div>

                          <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5">
                            <span className="text-[11px] font-semibold text-slate-500 block">
                              Carga consolidada
                            </span>
                            <span className="text-xs font-bold text-slate-900 mt-0.5 block">
                              {visitasHoja.length} visita(s) • {totalRemitosHoja} remito(s)
                            </span>
                          </div>

                          {/* Gestión de transportista en hoja armada */}
                          <div className="bg-blue-50/40 border border-blue-200 rounded-md p-2.5 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-slate-600">
                                Transportista:
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                  hoja.transportistaId
                                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                    : 'bg-amber-100 text-amber-900 border-amber-300'
                                }`}
                              >
                                {hoja.transportistaId ? 'Asignado' : 'Sin chofer'}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <select
                                value={hoja.transportistaId || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (!val) {
                                    void handleAsignarTransportistaEnHoja(hoja.id, '');
                                    return;
                                  }
                                  const cleanTId = String(val).replace(/^usr_/, '').trim();
                                  const t = transportistas.find(
                                    (tr) => String(tr.id).replace(/^usr_/, '').trim() === cleanTId
                                  );
                                  const fechaHojaNorm = (hoja.fechaReparto || '').slice(0, 10);
                                  const hojaPreviaOcupada = hojasRuta.find(
                                    (otra) =>
                                      otra.id !== hoja.id &&
                                      String(otra.transportistaId || '').replace(/^usr_/, '').trim() === cleanTId &&
                                      (otra.fechaReparto || '').slice(0, 10) === fechaHojaNorm &&
                                      otra.estado !== 'anulada'
                                  );

                                  if (hojaPreviaOcupada && t) {
                                    // HU #45: Reemplazar hoja de ruta
                                    const esActiva =
                                      hojaPreviaOcupada.estado === 'en_curso' ||
                                      hojaPreviaOcupada.estado === 'cerrada';
                                    if (esActiva) {
                                      setErrorAsignacionPorHoja((prev) => ({
                                        ...prev,
                                        [hoja.id]:
                                          'No se puede reemplazar la hoja de ruta: el transportista posee una hoja de ruta en curso para esa misma fecha.',
                                      }));
                                      return;
                                    }
                                    setModalReemplazo({
                                      hojaDestino: hoja,
                                      transportista: t,
                                      hojaPrevia: hojaPreviaOcupada,
                                    });
                                  } else {
                                    void handleAsignarTransportistaEnHoja(hoja.id, val);
                                  }
                                }}
                                disabled={asignandoHojaId === hoja.id || esDespachada}
                                aria-label="Seleccionar transportista para la hoja de ruta"
                                className="w-full text-xs bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 font-medium focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="">-- Seleccionar transportista --</option>
                                {transportistas.map((t) => {
                                  const cleanTId = String(t.id).replace(/^usr_/, '').trim();
                                  const fechaHojaNorm = (hoja.fechaReparto || '').slice(0, 10);
                                  const hojaPreviaOcupada = hojasRuta.find(
                                    (otra) =>
                                      otra.id !== hoja.id &&
                                      String(otra.transportistaId || '').replace(/^usr_/, '').trim() === cleanTId &&
                                      (otra.fechaReparto || '').slice(0, 10) === fechaHojaNorm &&
                                      otra.estado !== 'anulada'
                                  );
                                  const ocupadoEnFecha = Boolean(hojaPreviaOcupada);
                                  const esActiva =
                                    hojaPreviaOcupada &&
                                    (hojaPreviaOcupada.estado === 'en_curso' ||
                                      hojaPreviaOcupada.estado === 'cerrada');

                                  return (
                                    <option key={t.id} value={t.id} disabled={Boolean(esActiva)}>
                                      {t.nombre}{' '}
                                      {esActiva
                                        ? `(Ruta activa en curso)`
                                        : ocupadoEnFecha
                                        ? `(Asignado en ${hojaPreviaOcupada?.numero || 'otra hoja'} - Reemplazar)`
                                        : '(Disponible)'}
                                    </option>
                                  );
                                })}
                              </select>
                              {hoja.transportistaId && !esDespachada && (
                                <button
                                  type="button"
                                  onClick={() => void handleAsignarTransportistaEnHoja(hoja.id, '')}
                                  className="text-xs px-2 py-1 text-red-600 hover:text-red-800 border border-red-200 rounded hover:bg-red-50 cursor-pointer"
                                  title="Desvincular chofer"
                                >
                                  Quitar
                                </button>
                              )}
                            </div>

                            {errorAsignacionPorHoja[hoja.id] && (
                              <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-1.5">
                                {errorAsignacionPorHoja[hoja.id]}
                              </div>
                            )}
                            {exitoAsignacionPorHoja[hoja.id] && (
                              <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-1.5">
                                {exitoAsignacionPorHoja[hoja.id]}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Lista de paradas de la hoja armada */}
                        <div className="border border-slate-200 rounded-md overflow-hidden">
                          <div className="px-3 py-1.5 bg-slate-100 text-[11px] font-bold text-slate-700 uppercase">
                            Cronograma de paradas ({visitasHoja.length})
                          </div>
                          <div className="divide-y divide-slate-200 max-h-64 overflow-y-auto">
                            {visitasHoja.map((visita, idx) => {
                              const comercio = getComercio(visita.comercioId);
                              const ordenNumero = visita.orden ?? idx + 1;
                              const estadoVisita = String(visita.estado || '').toLowerCase();
                              const esVisitaEntregada =
                                estadoVisita === 'completada' ||
                                estadoVisita === 'entregado' ||
                                (visita.remitos || []).some(
                                  (r) => r.estado === 'entregado' || r.estado === 'no_entregado' || r.estado === 'devuelto'
                                ) ||
                                hoja.estado === 'cerrada';

                              const esParaQuitar = visitaParaQuitarId === visita.id && hojaDeVisitaParaQuitarId === hoja.id;
                              const nombreComercio = comercio?.razonSocial || `Parada ${ordenNumero}`;
                              const textoLimpio = textoConfirmacionQuitarVisita.trim().toLowerCase();
                              const esTextoCoincidente =
                                textoLimpio === nombreComercio.trim().toLowerCase() ||
                                textoLimpio === `parada ${ordenNumero}`.toLowerCase();

                              return (
                                <div key={visita.id} className="transition-colors">
                                  <div
                                    className={`p-2.5 flex items-center justify-between text-xs hover:bg-slate-50 ${
                                      esParaQuitar ? 'bg-amber-50/60' : ''
                                    }`}
                                  >
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="px-1.5 py-0.5 rounded bg-blue-700 text-white font-mono font-bold text-[10px]">
                                          Parada {ordenNumero}
                                        </span>
                                        <strong className="text-slate-900">{comercio?.razonSocial}</strong>
                                        {esVisitaEntregada && (
                                          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold text-[10px]">
                                            Entregado / Histórica
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-slate-500 mt-0.5">
                                        {comercio?.domicilio} • {visita.remitos.length} remito(s)
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <span className="font-mono font-bold text-slate-900">
                                        ${visita.importeTotal.toLocaleString('es-AR')}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={esVisitaEntregada}
                                        onClick={() => handleSolicitarQuitarVisita(visita, hoja)}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded border transition-colors ${
                                          esVisitaEntregada
                                            ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                                            : esParaQuitar
                                            ? 'bg-amber-100 border-amber-400 text-amber-900'
                                            : 'text-red-700 bg-white hover:bg-red-50 border-red-300 cursor-pointer'
                                        }`}
                                        title={
                                          esVisitaEntregada
                                            ? 'No se puede quitar: la visita ya fue entregada o completada.'
                                            : 'Quitar esta parada de la hoja de ruta y reprogramar remitos'
                                        }
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        <span>Quitar</span>
                                      </button>
                                    </div>
                                  </div>

                                  {/* Cuadro de Confirmación Deliberada por Tipeo para Quitar Visita */}
                                  {esParaQuitar && (
                                    <div className="p-3 bg-red-50/95 border-t border-b border-red-200 text-xs text-red-900 space-y-2 animate-in fade-in duration-150">
                                      <div className="flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                                        <div className="space-y-0.5">
                                          <strong className="text-xs font-bold text-red-950 block">
                                            ¿Deseás quitar la Parada {ordenNumero} ({nombreComercio}) de la hoja de ruta?
                                          </strong>
                                          <p className="text-[11px] text-red-800">
                                            Se eliminará la parada y sus {visita.remitos.length} remito(s) volverán a la bandeja de pendientes para reprogramarlos en otra secuencia.
                                            Para confirmar, escribí el nombre del comercio{' '}
                                            <span className="font-mono font-bold bg-red-100 text-red-950 px-1 py-0.5 rounded border border-red-300 select-all">
                                              {nombreComercio}
                                            </span>{' '}
                                            a continuación:
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                        <input
                                          type="text"
                                          autoFocus
                                          placeholder={`Escribí "${nombreComercio}"`}
                                          value={textoConfirmacionQuitarVisita}
                                          onChange={(e) => setTextoConfirmacionQuitarVisita(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              if (esTextoCoincidente && !isQuitandoVisita) {
                                                void handleConfirmarQuitarVisita(visita, hoja);
                                              }
                                            }
                                          }}
                                          className="bg-white border border-red-300 rounded px-2.5 py-1 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 w-52 placeholder-slate-400"
                                        />
                                        <button
                                          type="button"
                                          disabled={!esTextoCoincidente || isQuitandoVisita}
                                          onClick={() => void handleConfirmarQuitarVisita(visita, hoja)}
                                          className={`px-2.5 py-1 text-xs font-bold rounded flex items-center gap-1 transition-all ${
                                            esTextoCoincidente && !isQuitandoVisita
                                              ? 'bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-xs'
                                              : 'bg-red-200 text-red-400 cursor-not-allowed opacity-70'
                                          }`}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                          <span>{isQuitandoVisita ? 'Quitando...' : 'Confirmar remoción'}</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={handleCancelarQuitarVisita}
                                          className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors cursor-pointer"
                                        >
                                          Cancelar
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {/* Modal para Carga Manual de Entregas */}
      <ModalCargaManual
        isOpen={modalCargaManualAbierto}
        onClose={() => setModalCargaManualAbierto(false)}
        comercios={comercios}
        marcas={marcas}
        onSuccess={handleCargaManualExitosa}
      />

      {/* Modal para Anexar Entrega a Ruta */}
      <ModalAnexarEntrega
        isOpen={modalAnexarAbierto}
        onClose={() => {
          setModalAnexarAbierto(false);
          setRemitoParaAnexar(null);
        }}
        remito={remitoParaAnexar}
        hojasDeRuta={hojasRuta}
        transportistas={transportistas}
        comercios={comercios}
        marcas={marcas}
        preselectedHojaId={hojaDestinoPreseleccionada}
        onSuccess={handleAnexionExitosa}
      />

      {/* Modal HU #45: Reemplazar Hoja de Ruta Asignada */}
      {modalReemplazo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-modal-reemplazo"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 border border-amber-200">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <h3 id="titulo-modal-reemplazo" className="font-bold text-base text-slate-800">
                  Reemplazar hoja de ruta asignada
                </h3>
                <p className="text-xs text-slate-500">
                  Historia de usuario #45 · Épica 1.1
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-600 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
              <p>
                El transportista <strong className="text-slate-800">{modalReemplazo.transportista.nombre}</strong> ya tiene asignada una hoja de ruta para la fecha <strong className="text-slate-800">{formatearFechaCorta(modalReemplazo.hojaDestino.fechaReparto)}</strong>:
              </p>
              <div className="bg-white p-2.5 rounded border border-slate-200 space-y-1">
                <div className="text-slate-500 flex justify-between">
                  <span>Hoja actual asignada:</span>
                  <span className="font-bold text-red-700">
                    {modalReemplazo.hojaPrevia.numero || `HR-${modalReemplazo.hojaPrevia.id}`} (Desvincular)
                  </span>
                </div>
                <div className="text-slate-500 flex justify-between">
                  <span>Nueva hoja a asignar:</span>
                  <span className="font-bold text-emerald-700">
                    {modalReemplazo.hojaDestino.numero || `HR-${modalReemplazo.hojaDestino.id}`} (Vincular)
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Al confirmar, el sistema vinculará la nueva hoja de ruta al perfil del transportista y desvinculará la anterior.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setModalReemplazo(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmarReemplazo()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Confirmar reemplazo</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
