import React from 'react';
import { AuthBrandingPanel } from './AuthBrandingPanel';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-slate-50 antialiased selection:bg-slate-900 selection:text-white">
      {/* Columna Izquierda / Principal (40%-45% en desktop, 100% en mobile) */}
      <div className="w-full lg:w-5/12 bg-white flex flex-col justify-between p-6 sm:p-10 lg:p-14 min-h-screen">
        {/* Cabecera / Identificador Institucional Superior */}
        <div className="flex items-center justify-between pb-6 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-slate-950 flex items-center justify-center text-white font-bold text-base tracking-tighter">
              T
            </div>
            <div>
              <span className="font-semibold text-slate-900 text-sm tracking-tight block">
                Tutucas
              </span>
              <span className="text-[10px] text-slate-600 block uppercase tracking-wider font-medium">
                Distribución y Logística
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
              ERP v2.4
            </span>
          </div>
        </div>

        {/* Zona Central: Formulario */}
        <div className="my-auto py-8">
          {children}
        </div>

        {/* Pie de página sutil institucional */}
        <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-600 gap-2">
          <span>UNLP - Fac. de Informática | Ing. de Software</span>
          <div className="flex items-center gap-3">
            <a href="#terminos" className="hover:text-slate-700 transition-colors">Términos de servicio</a>
            <span>•</span>
            <a href="#seguridad" className="hover:text-slate-700 transition-colors">Políticas de seguridad</a>
          </div>
        </div>
      </div>

      {/* Columna Derecha: Brand Panel Logístico (55%-60% en desktop, oculta en mobile) */}
      <AuthBrandingPanel />
    </div>
  );
};
