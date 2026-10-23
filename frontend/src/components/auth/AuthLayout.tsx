import React from 'react';
import { AuthBrandingPanel } from './AuthBrandingPanel';
import { RepartoYaLogo } from '../common/RepartoYaLogo';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#F8FAFC] antialiased selection:bg-marca-azul selection:text-white">
      {/* Columna Izquierda / Principal (40%-45% en desktop, 100% en mobile) */}
      <div className="w-full lg:w-5/12 bg-white flex flex-col justify-between p-6 sm:p-10 lg:p-14 min-h-screen border-r border-slate-100 shadow-sm">
        {/* Cabecera / Identificador Institucional Superior */}
        <div className="flex items-center justify-between pb-6 border-b border-slate-100">
          <RepartoYaLogo variant="web" size="md" />
          <span className="text-[11px] font-semibold tracking-wider text-slate-600 uppercase bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
            Mesa Central
          </span>
        </div>

        {/* Zona Central: Formulario */}
        <div className="my-auto py-8">
          {children}
        </div>

        {/* Pie de página sutil institucional */}
        <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-2">
          <span>Portal de Operaciones</span>
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
