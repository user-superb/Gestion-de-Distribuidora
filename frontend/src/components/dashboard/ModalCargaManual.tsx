// src/components/dashboard/ModalCargaManual.tsx
import React, { useState } from 'react';
import { X, Building2, Store, PackagePlus, AlertCircle } from 'lucide-react';
import { Comercio, Marca, CargaEntregaManualDto, Remito } from '../../types/domain';
import { remitoService } from '../../services/remitoService';

interface ModalCargaManualProps {
  isOpen: boolean;
  onClose: () => void;
  comercios: Comercio[];
  marcas: Marca[];
  onSuccess: (remito: Remito, mensajeExito: string) => void;
}

export const ModalCargaManual: React.FC<ModalCargaManualProps> = ({
  isOpen,
  onClose,
  comercios,
  marcas,
  onSuccess,
}) => {
  const [modo, setModo] = useState<'registrado' | 'no_registrado'>('registrado');
  const [comercioId, setComercioId] = useState<string>(comercios[0]?.id || '');

  // Datos para nuevo comercio no registrado
  const [razonSocial, setRazonSocial] = useState('');
  const [domicilio, setDomicilio] = useState('');
  const [localidad, setLocalidad] = useState('');
  const [telefono, setTelefono] = useState('');
  const [cuit, setCuit] = useState('');

  // Datos del remito/entrega
  const [marcaId, setMarcaId] = useState<string>(marcas[0]?.id || '');
  const [importe, setImporte] = useState<string>('');
  const [numeroRemito, setNumeroRemito] = useState<string>('');
  const [fechaEmision, setFechaEmision] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const importeNum = parseFloat(importe);
    if (!importe || isNaN(importeNum) || importeNum <= 0) {
      setError('Por favor, ingresá un importe numérico válido mayor a $0.');
      return;
    }

    if (!marcaId) {
      setError('Debés seleccionar una marca proveedora para la entrega.');
      return;
    }

    const payload: CargaEntregaManualDto = {
      marcaId,
      importe: importeNum,
      numeroRemito: numeroRemito.trim() || undefined,
      fechaEmision: fechaEmision || undefined,
    };

    if (modo === 'registrado') {
      if (!comercioId) {
        setError('Debés seleccionar un comercio destinatario registrado.');
        return;
      }
      payload.comercioId = comercioId;
    } else {
      if (!razonSocial.trim()) {
        setError('La Razón Social del nuevo comercio es obligatoria.');
        return;
      }
      if (!domicilio.trim()) {
        setError('El Domicilio del nuevo comercio es obligatorio.');
        return;
      }
      payload.nuevoComercio = {
        razonSocial: razonSocial.trim(),
        domicilio: domicilio.trim(),
        localidad: localidad.trim() || undefined,
        telefono: telefono.trim() || undefined,
        cuit: cuit.trim() || undefined,
      };
    }

    setLoading(true);
    try {
      const result = await remitoService.crearEntregaManualAsync(payload);
      if (result.success && result.remito) {
        const destino =
          result.comercio?.razonSocial ||
          (modo === 'registrado'
            ? comercios.find((c) => c.id === comercioId)?.razonSocial
            : razonSocial);

        const mensaje = `Carga manual exitosa: Se generó el remito interno ${result.remito.numeroRemito} (${destino}) disponible para asignar.`;
        onSuccess(result.remito, mensaje);
        onClose();
      } else {
        setError(result.error || 'Ocurrió un error al registrar la entrega manual.');
      }
    } catch (err: any) {
      setError(err.message || 'Error de comunicación al intentar registrar la entrega.');
    } finally {
      setLoading(false);
    }
  };

  const comercioSeleccionado = comercios.find((c) => c.id === comercioId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Encabezado */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-md">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Carga Manual de Entrega</h3>
              <p className="text-[11px] text-slate-500">
                Registrá entregas de mercadería no cubiertas por la importación automática
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido del Formulario */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="text-[11px] font-medium">{error}</div>
            </div>
          )}

          {/* Selector de Regla: Comercio Registrado vs No Registrado */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
              Destinatario de la Entrega
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setModo('registrado');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-xs font-medium transition-all ${
                  modo === 'registrado'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500/30'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>Comercio Registrado</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setModo('no_registrado');
                  setError(null);
                }}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-xs font-medium transition-all ${
                  modo === 'no_registrado'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500/30'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Store className="w-4 h-4" />
                <span>Nuevo (No Registrado)</span>
              </button>
            </div>
          </div>

          {/* Formulario según Selección de Destinatario */}
          {modo === 'registrado' ? (
            <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-md">
              <label className="block font-medium text-slate-700 text-[11px]">
                Seleccionar Comercio Registrado <span className="text-red-500">*</span>
              </label>
              <select
                value={comercioId}
                onChange={(e) => setComercioId(e.target.value)}
                className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              >
                {comercios.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razonSocial}
                  </option>
                ))}
              </select>
              {comercioSeleccionado && (
                <p className="text-[11px] text-slate-500 italic">
                  Domicilio de entrega: {comercioSeleccionado.domicilio}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 p-3 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-[11px] font-bold text-slate-700 uppercase">
                Datos Básicos del Destinatario
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-600 mb-1">
                    Razón Social / Nombre Comercial <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={razonSocial}
                    onChange={(e) => setRazonSocial(e.target.value)}
                    placeholder="Ej: Kiosco La Esquina"
                    className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-600 mb-1">
                    Domicilio de Entrega <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={domicilio}
                    onChange={(e) => setDomicilio(e.target.value)}
                    placeholder="Ej: Calle 12 N° 345, La Plata"
                    className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Localidad</label>
                  <input
                    type="text"
                    value={localidad}
                    onChange={(e) => setLocalidad(e.target.value)}
                    placeholder="Ej: La Plata"
                    className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="Ej: 221-555-1234"
                    className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-600 mb-1">CUIT (opcional)</label>
                  <input
                    type="text"
                    value={cuit}
                    onChange={(e) => setCuit(e.target.value)}
                    placeholder="Ej: 20304050607"
                    className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Datos del Remito y Entrega */}
          <div className="space-y-3 pt-1">
            <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
              Datos de la Mercadería y Remito
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">
                  Marca Proveedora <span className="text-red-500">*</span>
                </label>
                <select
                  value={marcaId}
                  onChange={(e) => setMarcaId(e.target.value)}
                  className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                >
                  {marcas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1">
                  Importe Total ($) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-medium">
                    $
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={importe}
                    onChange={(e) => setImporte(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-6 pr-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono font-medium"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1">
                  Nro. de Remito <span className="text-slate-400">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={numeroRemito}
                  onChange={(e) => setNumeroRemito(e.target.value)}
                  placeholder="Auto-generar si se omite"
                  className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Fecha de Emisión</label>
                <input
                  type="date"
                  value={fechaEmision}
                  onChange={(e) => setFechaEmision(e.target.value)}
                  className="w-full py-1.5 px-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md transition-colors shadow-xs cursor-pointer"
            >
              {loading ? 'Guardando...' : 'Generar Remito Interno'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
