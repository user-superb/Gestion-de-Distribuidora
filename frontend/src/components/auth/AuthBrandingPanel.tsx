import React from 'react';
import { Truck } from 'lucide-react';

export const AuthBrandingPanel: React.FC = () => {
  return (
    <div className="hidden lg:flex lg:w-7/12 bg-slate-950 text-slate-100 flex-col justify-between p-12 relative overflow-hidden border-l border-slate-800 selection:bg-slate-700 selection:text-white">
      {/* Patrón de cuadrícula sutil */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)`,
          backgroundSize: '24px 24px',
        }}
      />

      {/* Espaciador superior */}
      <div className="relative z-10" />

      {/* Núcleo de información corporativa y logística */}
      <div className="relative z-10 my-auto max-w-xl space-y-8">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300">
            <Truck className="w-3.5 h-3.5 text-slate-400" />
            <span>Despacho & Distribución Comercial</span>
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-white leading-tight">
            Trazabilidad de Hojas de Ruta, Conciliación Bancaria y Despacho.
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed font-normal">
            Plataforma centralizada de control para comercios barriales y distribución mayorista.
            Coordina entregas de última milla, sincroniza cobros contra entrega y gestiona hojas de ruta operativas.
          </p>
        </div>

        {/* Pilares funcionales del sistema */}
        <div className="space-y-3 pt-2">
          <div className="p-3.5 rounded-md bg-slate-900/60 border border-slate-800 flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-slate-400 mt-1.5 flex-shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-slate-200 block">Organización de Repartos</span>
              <span className="text-slate-400">Consolidación de pedidos barriales y asignación ordenada de entregas por zona.</span>
            </div>
          </div>

          <div className="p-3.5 rounded-md bg-slate-900/60 border border-slate-800 flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-slate-400 mt-1.5 flex-shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-slate-200 block">Control y Auditoría de Acceso</span>
              <span className="text-slate-400">Perfiles segmentados por rol y sucursal para resguardar la información comercial.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer del panel */}
      <div className="relative z-10 pt-6 border-t border-slate-900 flex items-center justify-between text-xs text-slate-400">
        <span>© {new Date().getFullYear()} Sistema de Gestión y Logística de Distribución</span>
        <span>Mesa de Operaciones Regional</span>
      </div>
    </div>
  );
};
