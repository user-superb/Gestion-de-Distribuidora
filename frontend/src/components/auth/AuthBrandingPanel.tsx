import React from 'react';
import { Truck, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { RepartoYaLogo } from '../common/RepartoYaLogo';

export const AuthBrandingPanel: React.FC = () => {
  return (
    <div
      className="hidden lg:flex lg:w-7/12 bg-[#123C6B] text-white flex-col justify-between p-12 lg:p-16 relative overflow-hidden"
      style={{ backgroundColor: '#123C6B', color: '#FFFFFF' }}
    >
      {/* Patrón de cuadrícula y resplandor sutil */}
      <div 
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #ffffff 1.5px, transparent 0)`,
          backgroundSize: '28px 28px',
        }}
      />

      <div
        className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ backgroundColor: '#F4661B' }}
      />
      <div
        className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full opacity-15 blur-3xl pointer-events-none"
        style={{ backgroundColor: '#38BDF8' }}
      />

      {/* Cabecera del panel con Variante 03 · APP ADMIN / LOGIN · FONDO AZUL */}
      <div className="relative z-10">
        <div
          className="inline-flex items-center gap-3 px-3 py-1.5 rounded-full border border-white/20 backdrop-blur-sm shadow-xs"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.12)' }}
        >
          <RepartoYaLogo variant="admin" size="sm" showText={false} />
          <span className="text-xs font-bold tracking-wider uppercase text-[#FFF6EC]" style={{ color: '#FFF6EC' }}>
            Portal Corporativo y Despacho
          </span>
        </div>
      </div>

      {/* Núcleo de información corporativa y logística */}
      <div className="relative z-10 my-auto max-w-xl space-y-8">
        <div className="space-y-4">
          <div className="mb-2">
            <RepartoYaLogo variant="admin" size="xl" />
          </div>

          <h2 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-white leading-tight">
            Trazabilidad de Hojas de Ruta, Conciliación Bancaria y Despacho.
          </h2>
          <p className="text-sm lg:text-base text-slate-100 leading-relaxed font-normal opacity-95">
            Plataforma centralizada de distribución para comercios de barrio.
            Coordina entregas multimarca, consolida cobranzas en punto de destino y concilia transferencias contra extractos bancarios.
          </p>
        </div>

        {/* Pilares funcionales del sistema */}
        <div className="space-y-3.5 pt-2">
          <div
            className="p-4 rounded-xl border border-white/20 backdrop-blur-sm flex items-start gap-3.5 shadow-md"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.10)' }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm"
              style={{ backgroundColor: '#F4661B' }}
            >
              <Truck className="w-5 h-5 text-white" />
            </div>
            <div className="text-xs lg:text-sm">
              <span className="font-bold text-white block text-sm">Organización de Repartos & Hojas de Ruta</span>
              <span className="text-slate-100 opacity-90">Consolidación de remitos multimarca por comercio y despacho con transportistas asignados.</span>
            </div>
          </div>

          <div
            className="p-4 rounded-xl border border-white/20 backdrop-blur-sm flex items-start gap-3.5 shadow-md"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.10)' }}
          >
            <div
              className="w-9 h-9 rounded-lg border border-white/25 flex items-center justify-center text-[#FFF6EC] shrink-0 mt-0.5 shadow-sm"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#FFF6EC' }}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="text-xs lg:text-sm">
              <span className="font-bold text-white block text-sm">Conciliación Bancaria Sugerida & Rendición</span>
              <span className="text-slate-100 opacity-90">Cruce automatizado de transferencias bancarias y comprobantes contra remitos entregados.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer del panel */}
      <div className="relative z-10 pt-6 border-t border-white/15 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-slate-200 gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-white">
          <CheckCircle2 className="w-4 h-4 text-[#F4661B]" style={{ color: '#F4661B' }} />
          RepartoYA v2.0 · Plataforma Logística
        </span>
        <span className="text-slate-200 opacity-80">© {new Date().getFullYear()} Mesa de Operaciones Regional</span>
      </div>
    </div>
  );
};
