// frontend/src/types/entregas.ts
// Tipos para las métricas de entregas diarias y eficiencia de flota de Gerencia.

export interface MetricasEntregasDiarias {
  fecha: string;
  totalDespachados: number;
  exitosas: number;
  pendientes: number;
  rechazadas: number;
  porcentajeExitosas: number;
  porcentajePendientes: number;
  porcentajeRechazadas: number;
  tasaEfectividad: number;
  operacionInactiva: boolean;
  mensajeEstado?: string;
  filtrosAplicados: {
    fecha: string;
    sucursalId: string | null;
  };
}

export interface EntregasFiltros {
  fecha?: string; // Formato AAAA-MM-DD
  sucursalId?: string;
}
