import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

interface AlertBannerProps {
  type: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  message: string;
  children?: React.ReactNode;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({
  type,
  title,
  message,
  children,
}) => {
  const styles = {
    error: {
      container: 'bg-red-50 border-red-200 text-red-700',
      icon: <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />,
      titleColor: 'text-red-900',
    },
    warning: {
      container: 'bg-amber-50 border-amber-200 text-amber-800',
      icon: <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />,
      titleColor: 'text-amber-900',
    },
    info: {
      container: 'bg-slate-50 border-slate-200 text-slate-700',
      icon: <Info className="w-4 h-4 text-slate-600 flex-shrink-0 mt-0.5" />,
      titleColor: 'text-slate-900',
    },
    success: {
      container: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />,
      titleColor: 'text-emerald-900',
    },
  }[type];

  return (
    <div
      role="alert"
      className={`border rounded-md p-3.5 flex items-start gap-3 text-xs leading-relaxed transition-all ${styles.container}`}
    >
      {styles.icon}
      <div className="flex-1">
        {title && <p className={`font-semibold mb-0.5 ${styles.titleColor}`}>{title}</p>}
        <p className="font-medium">{message}</p>
        {children && <div className="mt-2 text-xs">{children}</div>}
      </div>
    </div>
  );
};
