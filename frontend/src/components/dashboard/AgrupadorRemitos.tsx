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
  RotateCcw,
  Layers,
  FileText,
  Search,
  X,
} from 'lucide-react';
import { Remito, Visita, Comercio, Marca } from '../../types/domain';
import { remitoService } from '../../services/remitoService';

export const AgrupadorRemitos: React.FC = () => {
  const [pendientes, setPendientes] = useState<Remito[]>([]);
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState<string>('');
  const [ultimaVisitaId, setUltimaVisitaId] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null);
  const [backendConectado, setBackendConectado] = useState<boolean>(false);

  const getComercio = (id: string) =>
    comercios.find((c) => c.id === id) || remitoService.getComercioById(id);

  const getMarca = (id: string) =>
    marcas.find((m) => m.id === id) || remitoService.getMarcaById(id);

  const recargarDatos = async () => {
    const isOnline = await remitoService.checkBackend();
    setBackendConectado(isOnline);

    const [pend, vis, com, mar] = await Promise.all([
      remitoService.getRemitosPendientesAsync(),
      remitoService.getVisitasAsync(),
      remitoService.getComerciosAsync(),
      remitoService.getMarcasAsync(),
    ]);

    setPendientes(pend);
    setVisitas(vis);
    setComercios(com);
    setMarcas(mar);
  };

  useEffect(() => {
    recargarDatos();
  }, []);

  const handleToggleSeleccion = (id: string) => {
    const nuevos = new Set(seleccionados);
    nuevos.has(id) ? nuevos.delete(id) : nuevos.add(id);
    setSeleccionados(nuevos);
    setMensaje(null);
  };

  const handleCambiarComercio = async (remitoId: string, nuevoComercioId: string) => {
    await remitoService.asignarComercioARemitoAsync(remitoId, nuevoComercioId);
    await recargarDatos();
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
        texto: `¡Agrupación exitosa! Se consolidaron ${seleccionados.size} remito(s) en la visita unificada para "${comercio?.razonSocial || result.visita.comercioId}" (ID: ${result.visita.comercioId}). Mirá el detalle en el panel derecho.`,
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

  const handleResetDemo = async () => {
    await remitoService.resetearDatosAsync();
    setSeleccionados(new Set());
    setUltimaVisitaId(null);
    setMensaje(null);
    setBusqueda('');
    await recargarDatos();
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
    <div className="space-y-4 mt-2">
      {/* Cabecera de la Historia de Usuario y Contadores */}
      <div className="bg-slate-900 text-white p-4 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded">
              Épica 1.1 • Planificación de Hoja de Ruta
            </span>
            {backendConectado ? (
              <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Backend SQLite Conectado (:3001)
              </span>
            ) : (
              <span className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                Modo Mock Local
              </span>
            )}
          </div>
          <h2 className="text-sm font-semibold mt-1">
            Agrupación de Remitos por Comercio para Armar Visitas
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right text-xs">
            <span className="text-slate-400 block text-[10px]">ESTADO ACTUAL</span>
            <span className="font-mono">
              <strong>{pendientes.length}</strong> pendientes •{' '}
              <strong className="text-emerald-400">{visitas.length}</strong> visita(s) armada(s)
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetDemo}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded border border-slate-700 transition-colors"
            title="Restaurar los datos iniciales de prueba"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reiniciar Demo</span>
          </button>
        </div>
      </div>

      {/* Banner de Feedback (Éxito o Error de Regla de Negocio) */}
      {mensaje && (
        <div
          className={`p-3.5 rounded-md text-xs flex items-start gap-2.5 shadow-sm ${
            mensaje.tipo === 'error'
              ? 'bg-red-50 text-red-900 border border-red-300'
              : 'bg-emerald-50 text-emerald-900 border border-emerald-300'
          }`}
        >
          {mensaje.tipo === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 font-medium">{mensaje.texto}</div>
        </div>
      )}

      {/* Grilla Principal Lado a Lado: Izquierda Pendientes | Derecha Visitas Armadas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* COLUMNA IZQUIERDA (7 cols): Remitos sin agrupar */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-md p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                1. Remitos Pendientes de Agrupar ({pendientes.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">
              Seleccioná remitos del mismo comercio
            </span>
          </div>

          {/* Barra de Búsqueda Rápida y Filtros */}
          {pendientes.length > 0 && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar por nro. remito, comercio o marca..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all"
                />
                {busqueda && (
                  <button
                    type="button"
                    onClick={() => setBusqueda('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    title="Limpiar búsqueda"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Botones de filtro rápido por comercio */}
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 p-2 rounded border border-slate-200/80">
                <span className="text-[11px] text-slate-600 font-medium mr-1">
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
                      className="px-2 py-1 text-[11px] bg-white hover:bg-blue-50 hover:border-blue-300 text-slate-700 font-medium rounded border border-slate-300 transition-colors shadow-2xs"
                    >
                      {com.razonSocial} <span className="text-blue-600 font-bold">({cant})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lista de Remitos */}
          <div className="space-y-2">
            {pendientes.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-md p-8 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <div className="text-xs font-semibold text-slate-700">
                  ¡Todos los remitos fueron agrupados!
                </div>
                <p className="text-[11px] text-slate-500">
                  Revisá las Visitas Consolidadas en la columna de la derecha o desagrupá alguna para seguir probando.
                </p>
              </div>
            ) : pendientesFiltrados.length === 0 ? (
              <div className="border border-slate-200 rounded-md p-6 text-center space-y-1 bg-slate-50">
                <div className="text-xs font-medium text-slate-700">
                  No se encontraron remitos para "{busqueda}"
                </div>
                <button
                  type="button"
                  onClick={() => setBusqueda('')}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Limpiar filtro de búsqueda
                </button>
              </div>
            ) : (
              pendientesFiltrados.map((remito) => {
                const marca = getMarca(remito.marcaId);
                const isSelected = seleccionados.has(remito.id);

                return (
                  <div
                    key={remito.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 border rounded-md transition-all ${
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
                      <div className="text-xs space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-slate-900">
                            {remito.numeroRemito}
                          </span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-medium">
                            <Tag className="w-2.5 h-2.5 text-slate-500" />
                            Proveedor: {marca?.nombre || remito.marcaId}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600">
                          Importe:{' '}
                          <strong className="font-mono text-slate-900">
                            ${remito.importe.toLocaleString('es-AR')}
                          </strong>
                        </div>
                      </div>
                    </label>

                    {/* Desplegable para asignar/cambiar el comercio destinatario */}
                    <div className="flex items-center gap-1.5 sm:w-56">
                      <Building className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <select
                        value={remito.comercioId}
                        onChange={(e) => handleCambiarComercio(remito.id, e.target.value)}
                        className="w-full text-[11px] font-medium bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        title="Comercio destinatario del remito"
                      >
                        {comercios.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.razonSocial} (ID: {c.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Barra inferior de Previsualización y Botón "Agrupar" */}
          {seleccionados.size > 0 && (
            <div
              className={`p-3 rounded-md border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                seleccionEsValida
                  ? 'bg-blue-50 border-blue-200 text-blue-950'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              }`}
            >
              <div className="space-y-0.5">
                <div className="font-semibold flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  <span>
                    {seleccionados.size} remito(s) seleccionado(s) • Subtotal: $
                    {subtotalSeleccion.toLocaleString('es-AR')}
                  </span>
                </div>
                <div className="text-[11px]">
                  {seleccionEsValida ? (
                    <span>
                      Destino común:{' '}
                      <strong>
                        {getComercio(comerciosEnSeleccion[0])?.razonSocial || comerciosEnSeleccion[0]} (ID: {comerciosEnSeleccion[0]})
                      </strong>
                    </span>
                  ) : (
                    <span className="text-amber-800 font-medium">
                      Atención: Seleccionaste remitos de {comerciosEnSeleccion.length} comercios
                      distintos ({comerciosEnSeleccion.join(', ')}). La regla exige el mismo comercio.
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  type="button"
                  onClick={handleLimpiarSeleccion}
                  className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={handleAgrupar}
                  disabled={!seleccionEsValida}
                  className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded shadow-xs transition-colors flex-shrink-0 ${
                    seleccionEsValida
                      ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-80'
                  }`}
                  title={
                    !seleccionEsValida
                      ? 'Solo se agrupan remitos que compartan exactamente el mismo identificador de comercio'
                      : 'Consolidar documentos en una visita unificada'
                  }
                >
                  <span>Agrupar</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA (5 cols): Grupos de Remitos / Visitas Creadas */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-md p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                2. Visitas Armadas por Comercio ({visitas.length})
              </h3>
            </div>
            <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-semibold">
              Hoja de Ruta
            </span>
          </div>

          {visitas.length === 0 ? (
            <div className="border-2 border-dashed border-slate-200 rounded-md p-8 text-center space-y-2 bg-slate-50/50">
              <MapPin className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="text-xs font-semibold text-slate-700">
                Todavía no hay grupos armados
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Cuando selecciones remitos del mismo comercio a la izquierda y presiones{' '}
                <strong>"Agrupar"</strong>, aparecerán acá consolidados como una{' '}
                <strong>Visita</strong> lista para el transportista.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visitas.map((visita, index) => {
                const comercio = getComercio(visita.comercioId);
                const esReciente = visita.id === ultimaVisitaId;

                return (
                  <div
                    key={visita.id}
                    className={`border rounded-md p-3.5 space-y-3 transition-all ${
                      esReciente
                        ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    {/* Cabecera de la Visita (Comercio Destino) */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 bg-emerald-600 text-white font-mono text-[10px] font-bold rounded">
                            VISITA #{index + 1} ({visita.id})
                          </span>
                          {esReciente && (
                            <span className="text-[10px] bg-emerald-200 text-emerald-900 px-1.5 py-0.5 rounded font-semibold">
                              Recién agrupada
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-bold text-slate-900 mt-1">
                          {comercio?.razonSocial || `Comercio #${visita.comercioId}`}
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {comercio?.domicilio || 'Domicilio registrado'} •{' '}
                          <span className="font-mono text-slate-500">ID: {visita.comercioId}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDesagrupar(visita.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-600 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-200 rounded transition-colors"
                        title="Desarmar esta visita y devolver los remitos a pendientes"
                      >
                        <Undo2 className="w-3 h-3" />
                        <span>Desagrupar</span>
                      </button>
                    </div>

                    {/* Lista de Remitos consolidados adentro de esta Visita */}
                    <div className="bg-white border border-slate-200 rounded p-2.5 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 pb-1">
                        Documentos Consolidados en este Envío ({visita.remitos.length})
                      </div>
                      {visita.remitos.map((r) => {
                        const marca = getMarca(r.marcaId);
                        return (
                          <div
                            key={r.id}
                            className="flex items-center justify-between text-xs py-1 border-b last:border-b-0 border-slate-100"
                          >
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                              <span className="font-mono font-semibold text-slate-800">
                                {r.numeroRemito}
                              </span>
                              <span className="text-[11px] text-slate-500">
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
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/80">
                      <span className="text-slate-600 text-[11px]">
                        Estado: <strong className="text-emerald-700">AGRUPADO EN VISITA</strong>
                      </span>
                      <span className="font-bold text-slate-900 font-mono">
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
    </div>
  );
};