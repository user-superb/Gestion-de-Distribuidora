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
  UserCheck,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { Remito, Visita, Comercio, Marca, HojaDeRuta, Transportista } from '../../types/domain';
import { remitoService, obtenerFechaActualISO } from '../../services/remitoService';

function formatearFechaCorta(fechaISO?: string): string {
  if (!fechaISO) return 'Sin programar';
  const partes = fechaISO.slice(0, 10).split('-');
  if (partes.length !== 3) return fechaISO;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

import { ModalCargaManual } from './ModalCargaManual';
import { ModalAnexarEntrega } from './ModalAnexarEntrega';

export const AgrupadorRemitos: React.FC = () => {
  const hoyISO = obtenerFechaActualISO();
  const [pendientes, setPendientes] = useState<Remito[]>([]);
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [hojasRuta, setHojasRuta] = useState<HojaDeRuta[]>([]);
  const [transportistas, setTransportistas] = useState<Transportista[]>([]);
  const [asignandoHojaId, setAsignandoHojaId] = useState<string | null>(null);
  const [errorAsignacionPorHoja, setErrorAsignacionPorHoja] = useState<Record<string, string>>({});
  const [exitoAsignacionPorHoja, setExitoAsignacionPorHoja] = useState<Record<string, string>>({});
  const [fechaInput, setFechaInput] = useState<string>(hoyISO);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState<string>('');
  const [ultimaVisitaId, setUltimaVisitaId] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);
  const [modalCargaManualAbierto, setModalCargaManualAbierto] = useState<boolean>(false);
  const [remitoParaAnexar, setRemitoParaAnexar] = useState<Remito | null>(null);
  const [hojaDestinoPreseleccionada, setHojaDestinoPreseleccionada] = useState<string | null>(null);
  const [modalAnexarAbierto, setModalAnexarAbierto] = useState<boolean>(false);

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
  }, []);

  // En Sección 2 solo se muestran las visitas en armado (las que aún no pertenecen a una Hoja de Ruta programada)
  const hojasProgramadasIds = new Set(
    hojasRuta
      .filter((h) => h.estado !== 'borrador')
      .map((h) => h.id)
  );
  const visitasEnArmado = visitas.filter(
    (v) => !v.hojaDeRutaId || !hojasProgramadasIds.has(v.hojaDeRutaId)
  );

  // En Sección 3 se muestran todas las Hojas de Ruta Armadas (en estado pendiente_de_despacho / publicada)
  const hojasArmadas = hojasRuta.filter((h) => {
    if (h.estado !== 'pendiente_de_despacho' && h.estado !== 'publicada') return false;
    const tieneVisitasDirectas = (h.visitas?.length || 0) > 0;
    const tieneVisitasEnEstado = visitas.some((v) => v.hojaDeRutaId === h.id);
    const tieneCantidadVisitas = (h.cantidadVisitas || 0) > 0;
    return tieneVisitasDirectas || tieneVisitasEnEstado || tieneCantidadVisitas;
  });

  const handleAsignarTransportista = async (hojaId: string, transportistaId: string) => {
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
    } else {
      setErrorAsignacionPorHoja((prev) => ({
        ...prev,
        [hojaId]: res.error || 'No se pudo asignar el transportista.',
      }));
    }
    setAsignandoHojaId(null);
  };

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

  
  const handleAsignarFecha = async (fechaAProgramar = fechaInput) => {
    if (visitasEnArmado.length === 0) {
      setMensaje({
        tipo: 'error',
        texto: 'Debés agrupar al menos una visita en la Sección 2 antes de programar una hoja de ruta.',
      });
      return;
    }

    // No pasamos un ID fijo para que arme una nueva Hoja de Ruta con las visitas actualmente en la Sección 2
    const resultado = await remitoService.asignarFechaHojaDeRutaAsync(fechaAProgramar);

    if (resultado.success && resultado.hojaDeRuta) {
      await recargarDatos();
      const codigo =
        resultado.hojaDeRuta.numero ||
        `HR-${String(resultado.hojaDeRuta.id).padStart(4, '0')}`;
      setMensaje({
        tipo: 'exito',
        texto: `Hoja de ruta ${codigo} armada para el ${formatearFechaCorta(
          resultado.hojaDeRuta.fechaReparto
        )} en estado "Pendiente de Despacho". La Sección 2 quedó libre para armar otra hoja de ruta.`,
      });
    } else {
      setMensaje({
        tipo: 'error',
        texto:
          resultado.error ||
          'No se pudo programar la fecha de la hoja de ruta.',
      });
    }
  };

  const handleEliminarHojaDeRuta = async (hoja: HojaDeRuta) => {
    const codigo = hoja.numero || `HR-${String(hoja.id).padStart(4, '0')}`;
    const res = await remitoService.eliminarHojaDeRutaAsync(hoja.id);
    if (res.success) {
      await recargarDatos();
      setMensaje({
        tipo: 'exito',
        texto: `La hoja de ruta ${codigo} fue eliminada y sus visitas volvieron a la Sección 2 (Secuencia de Visitas).`,
      });
    } else {
      setMensaje({
        tipo: 'error',
        texto: res.error || 'No se pudo eliminar la hoja de ruta.',
      });
    }
  };

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

  // Filtrado reactivo de pendientes por texto (número de remito, marca o comercio)
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

  // Análisis en vivo de los remitos que el usuario tiene tildados actualmente
  const remitosSeleccionadosObj = pendientes.filter((r) => seleccionados.has(r.id));
  const comerciosEnSeleccion = Array.from(new Set(remitosSeleccionadosObj.map((r) => r.comercioId)));
  const seleccionEsValida = comerciosEnSeleccion.length === 1;
  const subtotalSeleccion = remitosSeleccionadosObj.reduce((acc, r) => acc + r.importe, 0);

  return (
    <div className="space-y-6 mt-2">
      {/* Banner de Feedback (Éxito o Error de Regla de Negocio) */}
      {mensaje && (
        <div
          role={mensaje.tipo === 'error' ? 'alert' : 'status'}
          className={`p-4 rounded-md text-sm flex items-start gap-3 shadow-sm ${
            mensaje.tipo === 'error'
              ? 'bg-red-50 text-red-900 border border-red-300'
              : 'bg-emerald-50 text-emerald-900 border border-emerald-300'
          }`}
        >
          {mensaje.tipo === 'error' ? (
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 font-medium">{mensaje.texto}</div>
        </div>
      )}

      {/* Grilla Superior Lado a Lado: 1. Remitos Pendientes | 2. Secuencia de Visitas en Armado */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* COLUMNA IZQUIERDA (7 cols): 1. Remitos pendientes */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-md p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <Package className="w-5 h-5 text-blue-600" />
              <h2 className="text-base font-bold uppercase tracking-wide text-slate-800">
                1. Remitos Pendientes de Agrupar ({pendientes.length})
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setModalCargaManualAbierto(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors shadow-2xs cursor-pointer"
                title="Cargar manualmente entregas no contempladas en la importación"
              >
                <Plus className="w-4 h-4" />
                <span>Cargar Entrega Manual</span>
              </button>
            </div>
          </div>

          {/* Barra de Búsqueda Rápida y Filtros */}
          {pendientes.length > 0 && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar por nro. remito, comercio o marca..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all"
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

              {/* Botones de filtro rápido por comercio */}
              <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-2.5 rounded border border-slate-200/80">
                <span className="text-sm text-slate-600 font-medium mr-1">
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
                      className="px-2.5 py-1 text-sm bg-white hover:bg-blue-50 hover:border-blue-300 text-slate-700 font-medium rounded border border-slate-300 transition-colors shadow-2xs"
                    >
                      {com.razonSocial} <span className="text-blue-600 font-bold">({cant})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lista de Remitos */}
          <div className="space-y-3">
            {pendientes.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-md p-8 text-center space-y-2">
                <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto" />
                <div className="text-base font-semibold text-slate-700">
                  ¡Todos los remitos fueron agrupados!
                </div>
                <p className="text-sm text-slate-500">
                  Revisá las visitas en armado a la derecha o las hojas de ruta armadas abajo.
                </p>
              </div>
            ) : pendientesFiltrados.length === 0 ? (
              <div className="border border-slate-200 rounded-md p-6 text-center space-y-2 bg-slate-50">
                <div className="text-sm font-medium text-slate-700">
                  No se encontraron remitos para "{busqueda}"
                </div>
                <button
                  type="button"
                  onClick={() => setBusqueda('')}
                  className="text-sm text-blue-600 hover:underline"
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
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 border rounded-md transition-all ${
                      isSelected
                        ? 'bg-blue-50/80 border-blue-400 ring-1 ring-blue-400/30'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <label className="flex items-start sm:items-center gap-3 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        className="mt-1 sm:mt-0 w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                        checked={isSelected}
                        onChange={() => handleToggleSeleccion(remito.id)}
                      />
                      <div className="text-sm space-y-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-mono font-bold text-slate-900 text-base">
                            {remito.numeroRemito}
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium">
                            <Tag className="w-3 h-3 text-slate-500" />
                            Proveedor: {marca?.nombre || remito.marcaId}
                          </span>
                        </div>
                        <div className="text-sm text-slate-600 flex items-center gap-2">
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
                            className="text-xs px-2 py-0.5 border border-slate-300 rounded text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                            title="Anexar esta entrega a una hoja de ruta existente"
                          >
                            Anexar a ruta
                          </button>
                        </div>
                      </div>
                    </label>

                    {/* Comercio destinatario fijo */}
                    <div className="flex items-center gap-2 sm:w-64">
                      <div
                        className="flex items-center gap-2 w-full text-sm font-medium bg-slate-50 border border-slate-200 rounded px-2.5 py-2 text-slate-800"
                        title={`Destino: ${comercio?.razonSocial || remito.comercioId}`}
                      >
                        <Building className="w-4 h-4 text-slate-400 flex-shrink-0" />
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

          {/* Barra inferior de Previsualización y Botón "Agrupar" */}
          {seleccionados.size > 0 && (
            <div
              className={`p-4 rounded-md border text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                seleccionEsValida
                  ? 'bg-blue-50 border-blue-200 text-blue-950'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              }`}
            >
              <div className="space-y-1">
                <div className="font-semibold flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  <span>
                    {seleccionados.size} remito(s) seleccionado(s) • Subtotal: $
                    {subtotalSeleccion.toLocaleString('es-AR')}
                  </span>
                </div>
                <div className="text-sm">
                  {seleccionEsValida ? (
                    <span>
                      Destino común:{' '}
                      <strong>
                        {getComercio(comerciosEnSeleccion[0])?.razonSocial || comerciosEnSeleccion[0]}
                      </strong>
                    </span>
                  ) : (
                    <span className="text-amber-800 font-medium">
                      Atención: Seleccionaste remitos de {comerciosEnSeleccion.length} comercios
                      distintos. Solo se pueden agrupar remitos del mismo comercio.
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2.5 self-end sm:self-center">
                <button
                  type="button"
                  onClick={handleLimpiarSeleccion}
                  className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={handleAgrupar}
                  disabled={!seleccionEsValida}
                  className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded shadow-xs transition-colors flex-shrink-0 ${
                    seleccionEsValida
                      ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-80'
                  }`}
                  title={
                    !seleccionEsValida
                      ? 'Solo se agrupan remitos que compartan el mismo comercio'
                      : 'Consolidar documentos en una visita unificada'
                  }
                >
                  <span>Agrupar</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA (5 cols): 2. Secuencia de Visitas (en armado para una nueva Hoja de Ruta) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-md p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-2">
            <div className="flex items-center gap-2.5">
              <MapPin className="w-5 h-5 text-emerald-600" />
              <div>
                <h2 className="text-base font-bold uppercase tracking-wide text-slate-800">
                  2. Secuencia de Visitas ({visitasEnArmado.length})
                </h2>
                <span className="text-sm text-slate-500">
                  Ordená las visitas y programá la fecha para armar la hoja de ruta
                </span>
              </div>
            </div>

            <span className="text-xs px-2.5 py-1 rounded font-semibold inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 border border-emerald-300">
              <Truck className="w-3.5 h-3.5" />
              En armado
            </span>
          </div>

          {/* Panel: Asignar Fecha Determinada para Armar la Hoja de Ruta */}
          <div className="rounded-md border border-slate-200 bg-slate-50/80 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-bold text-slate-800">
                  Programar Día de Distribución
                </span>
              </div>
              <span className="text-xs text-slate-500">
                {visitasEnArmado.length > 0
                  ? `${visitasEnArmado.length} visita(s) lista(s) para armar ruta`
                  : 'Agrupá visitas para programar'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <input
                type="date"
                aria-label="Fecha de distribución de la hoja de ruta"
                min={hoyISO}
                value={fechaInput}
                onChange={(e) => {
                  setFechaInput(e.target.value);
                  setMensaje(null);
                }}
                className="border border-slate-300 rounded px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                disabled={!fechaInput || visitasEnArmado.length === 0}
                onClick={() => void handleAsignarFecha(fechaInput)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded shadow-2xs transition-colors"
                title={
                  visitasEnArmado.length === 0
                    ? 'Agrupá al menos una visita antes de programar la hoja de ruta'
                    : 'Programar fecha y armar la hoja de ruta en la Sección 3'
                }
              >
                Programar Fecha
              </button>
            </div>
          </div>

          {visitasEnArmado.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-md p-8 text-center space-y-2 bg-slate-50/50">
              <MapPin className="w-9 h-9 text-slate-400 mx-auto" />
              <div className="text-base font-semibold text-slate-700">
                No hay visitas en armado
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                Seleccioná remitos del mismo comercio en la <strong>Sección 1</strong> y presioná{' '}
                <strong>"Agrupar"</strong> para armar visitas, ordenarlas y programar una nueva{' '}
                <strong>Hoja de Ruta</strong>.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {visitasEnArmado.map((visita, index) => {
                const comercio = getComercio(visita.comercioId);
                const esReciente = visita.id === ultimaVisitaId;
                const isDragging = draggedIndex === index;
                const ordenNumero = index + 1;

                return (
                  <div
                    key={visita.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`border rounded-md p-4 space-y-3.5 transition-all cursor-grab active:cursor-grabbing hover:border-blue-300 ${
                      isDragging ? 'opacity-40 border-dashed border-blue-400 bg-blue-50' : ''
                    } ${
                      esReciente
                        ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    {/* Cabecera de la Visita con Parada #N, Asa de arrastre y flechas */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 flex-1">
                        <div
                          className="mt-0.5 text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-200/60"
                          title="Arrastrá para reordenar la secuencia"
                        >
                          <GripVertical className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2.5 py-0.5 bg-blue-700 text-white font-mono text-xs font-bold rounded shadow-2xs">
                              PARADA #{ordenNumero}
                            </span>
                            {esReciente && (
                              <span className="text-xs bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded font-semibold">
                                Recién agrupada
                              </span>
                            )}
                          </div>
                          <div className="text-base font-bold text-slate-900 mt-1">
                            {comercio?.razonSocial || 'Comercio destinatario'}
                          </div>
                          <div className="text-sm text-slate-600">
                            {comercio?.domicilio || 'Domicilio registrado'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Controles de orden accesibles: Subir / Bajar */}
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoverArriba(index)}
                            className="p-1.5 rounded bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed border border-slate-200 text-slate-600 hover:text-blue-600"
                            title={index === 0 ? 'Ya está en la primera posición' : 'Mover arriba'}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === visitasEnArmado.length - 1}
                            onClick={() => handleMoverAbajo(index)}
                            className="p-1.5 rounded bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed border border-slate-200 text-slate-600 hover:text-blue-600"
                            title={
                              index === visitasEnArmado.length - 1
                                ? 'Ya está en la última posición'
                                : 'Mover abajo'
                            }
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDesagrupar(visita.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-200 rounded transition-colors ml-1"
                          title="Desarmar esta visita y devolver los remitos a pendientes"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          <span>Desagrupar</span>
                        </button>
                      </div>
                    </div>

                    {/* Lista de Remitos consolidados adentro de esta Visita */}
                    <div className="bg-white border border-slate-200 rounded p-3 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1.5">
                        Documentos Consolidados en este Envío ({visita.remitos.length})
                      </div>
                      {visita.remitos.map((r) => {
                        const marca = getMarca(r.marcaId);
                        return (
                          <div
                            key={r.id}
                            className="flex items-center justify-between text-sm py-1 border-b last:border-b-0 border-slate-100"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                              <span className="font-mono font-semibold text-slate-800">
                                {r.numeroRemito}
                              </span>
                              <span className="text-sm text-slate-500">
                                ({marca?.nombre || r.marcaId})
                              </span>
                            </div>
                            <span className="font-mono font-medium text-slate-800">
                              ${r.importe.toLocaleString('es-AR')}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Pie de la Visita con Total a Cobrar */}
                    <div className="flex items-center justify-between text-sm pt-1.5 border-t border-slate-200/80">
                      <span className="text-slate-600">
                        Estado: <strong className="text-emerald-700">Agrupado en visita</strong>
                      </span>
                      <span className="font-bold text-slate-900 font-mono text-base">
                        Total Visita: ${visita.importeTotal.toLocaleString('es-AR')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* SECCIÓN INFERIOR DIFERENCIADA (Ancho completo): 3. Hojas de Ruta Armadas */}
      <section
        data-testid="hojas-de-ruta-armadas"
        className="bg-white border-2 border-slate-200 rounded-md shadow-sm overflow-hidden"
      >
        <div className="bg-slate-900 text-white px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-blue-500/20 border border-blue-400/30 text-blue-300">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold uppercase tracking-wide text-white">
                3. Hojas de Ruta Armadas ({hojasArmadas.length})
              </h2>
              <p className="text-sm text-slate-300 mt-0.5">
                Rutas programadas en estado "Pendiente de Despacho", listas para asignar transportista.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5 bg-slate-50/40">
          {hojasArmadas.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-md p-8 text-center space-y-2 bg-white">
              <ClipboardCheck className="w-9 h-9 text-slate-400 mx-auto" />
              <div className="text-base font-semibold text-slate-700">
                Todavía no hay hojas de ruta armadas
              </div>
              <p className="text-sm text-slate-500">
                Cuando agrupes visitas en la <strong>Sección 2</strong> y presiones{' '}
                <strong>"Programar Fecha"</strong>, la hoja de ruta armada aparecerá acá.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {hojasArmadas.map((hoja) => {
                const codigoHoja =
                  hoja.numero || `HR-${String(hoja.id).padStart(4, '0')}`;
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

                return (
                  <div
                    key={hoja.id}
                    className="border border-blue-200 rounded-md bg-white shadow-xs overflow-hidden"
                  >
                    {/* Barra superior de cada Hoja de Ruta Armada */}
                    <div className="px-5 py-3.5 bg-blue-50/70 border-b border-blue-200 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-base font-bold text-blue-950">
                          {codigoHoja}
                        </span>
                        <span className="px-2.5 py-0.5 rounded bg-blue-700 text-white text-xs font-semibold">
                          Pendiente de Despacho
                        </span>
                        <span className="text-sm text-slate-600">
                          Valor total:{' '}
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
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-white hover:bg-blue-50 border border-blue-300 rounded transition-colors cursor-pointer"
                            title="Anexar una entrega pendiente a esta hoja de ruta"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Anexar Entrega</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleEliminarHojaDeRuta(hoja)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-white hover:bg-red-50 border border-red-300 rounded transition-colors cursor-pointer"
                          title="Eliminar esta hoja de ruta y devolver sus visitas a la Sección 2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Eliminar Hoja de Ruta</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-5 space-y-4">
                      {/* Alerta Visual: Sincronización pendiente (HU #19 Escenario 2) */}
                      {(hoja.tieneSincronizacionPendiente || visitasHoja.some((v) => v.sincronizacionPendiente)) && (
                        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-md p-3.5 flex items-start gap-3 shadow-2xs">
                          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div className="text-xs space-y-0.5">
                            <strong className="font-bold text-amber-950 text-sm block">
                              Sincronización pendiente
                            </strong>
                            <p className="text-amber-800">
                              El transportista asignado no reporta conexión en su dispositivo móvil. Las paradas anexadas fueron registradas al final de la secuencia pero permanecen pendientes de sincronización con la aplicación de campo.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Resumen Operativo + Bloque de Transportista preparado para HU #14 */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 block">
                            Fecha de Distribución
                          </span>
                          <div className="mt-1 flex items-center gap-2 text-base font-bold font-mono text-slate-900">
                            <Calendar className="w-4 h-4 text-blue-600" />
                            <span>{formatearFechaCorta(hoja.fechaReparto)}</span>
                          </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 block">
                            Resumen de Carga
                          </span>
                          <div className="mt-1 flex items-center gap-2 text-base font-bold text-slate-900">
                            <Truck className="w-4 h-4 text-emerald-600" />
                            <span>
                              {visitasHoja.length} visita(s) • {totalRemitosHoja} remito(s)
                            </span>
                          </div>
                        </div>

                        {/* HU #14: Asignar Hoja de Ruta al Transportista */}
                        <div className="bg-blue-50/40 border border-blue-200 rounded-md p-3.5 flex flex-col justify-between gap-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <UserCheck className="w-5 h-5 text-blue-600 flex-shrink-0" />
                              <div>
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 block">
                                  Transportista Asignado
                                </span>
                                <strong
                                  className="text-sm text-slate-900 block truncate max-w-[200px]"
                                  title={hoja.transportistaNombre || 'Sin asignar'}
                                >
                                  {hoja.transportistaNombre || 'Sin asignar'}
                                </strong>
                              </div>
                            </div>
                            <span
                              className={`text-xs font-semibold px-2.5 py-1 rounded whitespace-nowrap border ${
                                hoja.transportistaId
                                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                  : 'bg-amber-100 text-amber-900 border-amber-300'
                              }`}
                            >
                              {hoja.transportistaId ? 'Asignado' : 'Sin transportista'}
                            </span>
                          </div>

                          {/* Selector de transportista habilitado */}
                          <div className="pt-2 border-t border-blue-100 flex items-center gap-2">
                            <div className="relative flex-1">
                              <select
                                value={hoja.transportistaId || ''}
                                onChange={(e) => void handleAsignarTransportista(hoja.id, e.target.value)}
                                disabled={asignandoHojaId === hoja.id}
                                aria-label="Seleccionar transportista para la hoja de ruta"
                                className="w-full text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 cursor-pointer"
                              >
                                <option value="">-- Seleccionar transportista --</option>
                                {transportistas.map((t) => {
                                  // Solapamiento: el transportista ya posee OTRA hoja de ruta asignada para esa misma fecha
                                  const ocupadoEnFecha = hojasRuta.some(
                                    (otra) =>
                                      otra.id !== hoja.id &&
                                      otra.transportistaId === t.id &&
                                      otra.fechaReparto === hoja.fechaReparto &&
                                      otra.estado !== 'anulada'
                                  );
                                  return (
                                    <option
                                      key={t.id}
                                      value={t.id}
                                      disabled={ocupadoEnFecha}
                                      className={ocupadoEnFecha ? 'text-slate-400 bg-slate-50' : 'text-slate-900'}
                                    >
                                      {t.nombre} {ocupadoEnFecha ? `(Ocupado el ${formatearFechaCorta(hoja.fechaReparto)})` : ''}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            {hoja.transportistaId && (
                              <button
                                type="button"
                                onClick={() => void handleAsignarTransportista(hoja.id, '')}
                                disabled={asignandoHojaId === hoja.id}
                                className="text-xs text-red-600 hover:text-red-800 px-2 py-1.5 border border-red-200 rounded hover:bg-red-50 font-medium transition-colors whitespace-nowrap"
                                title="Desasignar transportista"
                              >
                                Desasignar
                              </button>
                            )}
                          </div>

                          {/* Mensaje de error de solapamiento o regla para esta hoja */}
                          {errorAsignacionPorHoja[hoja.id] && (
                            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-1.5">
                              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                              <span>{errorAsignacionPorHoja[hoja.id]}</span>
                            </div>
                          )}

                          {/* Mensaje de confirmación de asignación */}
                          {exitoAsignacionPorHoja[hoja.id] && (
                            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2 flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                              <span>{exitoAsignacionPorHoja[hoja.id]}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Cronograma de Paradas de esta Hoja de Ruta */}
                      <div className="border border-slate-200 rounded-md overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                            Cronograma de Paradas ({visitasHoja.length})
                          </h3>
                          <span className="text-xs text-slate-500">
                            Secuencia ordenada de entrega
                          </span>
                        </div>

                        <div className="divide-y divide-slate-200">
                          {visitasHoja.map((visita, idx) => {
                            const comercio = getComercio(visita.comercioId);
                            const ordenNumero = visita.orden ?? idx + 1;
                            return (
                              <div
                                key={visita.id}
                                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2.5 flex-wrap">
                                    <span className="px-2.5 py-0.5 bg-blue-700 text-white font-mono text-xs font-bold rounded">
                                       PARADA #{ordenNumero}
                                     </span>
                                     {visita.sincronizacionPendiente ? (
                                       <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold rounded shadow-2xs">
                                         <AlertTriangle className="w-3 h-3 text-amber-600" />
                                         <span>Sincronización pendiente</span>
                                       </span>
                                     ) : (
                                       <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-medium rounded">
                                         <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                         <span>Sincronizado</span>
                                       </span>
                                     )}
                                    <strong className="text-base text-slate-900">
                                      {comercio?.razonSocial || 'Comercio destinatario'}
                                    </strong>
                                    <span className="text-sm text-slate-500">
                                      • {comercio?.domicilio || 'Domicilio registrado'}
                                    </span>
                                  </div>
                                  <div className="text-sm text-slate-600 flex flex-wrap gap-2 pt-0.5">
                                    {visita.remitos.map((r) => (
                                      <span
                                        key={r.id}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-xs text-slate-800"
                                      >
                                        <FileText className="w-3 h-3 text-blue-600" />
                                        {r.numeroRemito} (${r.importe.toLocaleString('es-AR')})
                                      </span>
                                    ))}
                                  </div>
                                </div>

                                <div className="text-left sm:text-right shrink-0">
                                  <span className="text-xs text-slate-500 block">
                                    Subtotal parada
                                  </span>
                                  <strong className="font-mono text-base text-slate-900">
                                    ${visita.importeTotal.toLocaleString('es-AR')}
                                  </strong>
                                </div>
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
      </section>

      {/* Modal para Carga Manual de Entregas (Escenario 1 y Escenario 2) */}
      <ModalCargaManual
        isOpen={modalCargaManualAbierto}
        onClose={() => setModalCargaManualAbierto(false)}
        comercios={comercios}
        marcas={marcas}
        onSuccess={handleCargaManualExitosa}
      />
    
  );
      {/* Modal para Anexar Entrega a Ruta (HU #19) */}
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
    </div>
  );
};
