export interface DiscrepanciaAjusteHistorial {
  tipo: 'reduccion_saldo' | 'saldo_favor';
  remitoId: string | null;
  comercioId: string | null;
  importeCentavos: string;
}

export interface DiscrepanciaHistorial {
  id: string;
  movimientoIds: string[];
  remitoIds: string[];
  motivoCodigo: string | null;
  nota: string;
  observacionResolucion: string | null;
  diferenciaCentavos: string;
  importeMovimiento: string;
  importeSeleccionado: string;
  resueltaEn: string | null;
  resueltaPor: string | null;
  comprobanteNombre: string | null;
  ajustes: DiscrepanciaAjusteHistorial[];
}

export interface ImputacionHistorial {
  id: string;
  remitoId: string;
  remitoNumero: string;
  remitoImporteCentavos?: string | null;
  comercio: string;
  comercioCuit: string | null;
  importeCentavos: string;
  imputadoEn: string;
  imputadoPor: string;
  esExcedenteDiscrepancia?: boolean;
}

export interface MovimientoConciliado {
  id: string;
  fecha_hora: string;
  ordenante: string | null;
  ordenante_cuit: string | null;
  concepto: string | null;
  referencia_externa: string | null;
  origen: string;
  importe_centavos: string;
  estado: string;
  cuenta_id: string;
  cuenta: string;
  sucursal_id: string;
  sucursal: string;
  comprobante_nombre: string | null;
  imputado_en: string;
  imputaciones: ImputacionHistorial[];
  discrepancia?: DiscrepanciaHistorial;
}

export interface MovimientoEnGrupo extends MovimientoConciliado {
  totalImputadoCentavos: string;
  tieneExcedente: boolean;
}

export interface RemitoConsolidadoHistorial {
  remitoId: string;
  remitoNumero: string;
  remitoImporteCentavos: string | null;
  comercio: string;
  comercioCuit: string | null;
  totalImputadoCentavos: string;
  imputadoPor: string;
  imputadoEn: string;
  detalleMovimientos: Array<{
    movimientoId: string;
    ordenante: string | null;
    referenciaExterna: string | null;
    importeCentavos: string;
    esExcedenteDiscrepancia: boolean;
  }>;
}

export interface GrupoHistorialConciliacion {
  key: string;
  movimientos: MovimientoEnGrupo[];
  remitos: RemitoConsolidadoHistorial[];
  discrepancia?: DiscrepanciaHistorial;
  totalMovimientosCentavos: string;
  totalImputadoCentavos: string;
  imputadoEn: string;
  sucursales: string[];
  cuentas: string[];
  comercioPrincipal: string;
}

export function agruparHistorialConciliaciones(items: MovimientoConciliado[]): GrupoHistorialConciliacion[] {
  if (!items.length) return [];

  const parent = items.map((_, index) => index);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const porDiscrepancia = new Map<string, number>();
  const porRemito = new Map<string, number>();

  items.forEach((mov, idx) => {
    if (mov.discrepancia?.id) {
      const prev = porDiscrepancia.get(mov.discrepancia.id);
      if (prev === undefined) porDiscrepancia.set(mov.discrepancia.id, idx);
      else union(prev, idx);
    }
    for (const imp of mov.imputaciones) {
      const prev = porRemito.get(imp.remitoId);
      if (prev === undefined) porRemito.set(imp.remitoId, idx);
      else union(prev, idx);
    }
  });

  const gruposMap = new Map<number, MovimientoConciliado[]>();
  items.forEach((mov, idx) => {
    const root = find(idx);
    if (!gruposMap.has(root)) gruposMap.set(root, []);
    gruposMap.get(root)!.push(mov);
  });

  const grupos: GrupoHistorialConciliacion[] = [];
  for (const movsGrupo of gruposMap.values()) {
    const movsOrdenados = [...movsGrupo].sort((a, b) => {
      const diff = new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime();
      return diff !== 0 ? diff : Number(a.id) - Number(b.id);
    });

    const movimientos: MovimientoEnGrupo[] = movsOrdenados.map((mov) => {
      const totalImp = mov.imputaciones.reduce((acc, imp) => acc + BigInt(imp.importeCentavos || '0'), 0n);
      const tieneExcedente = mov.imputaciones.some((imp) => imp.esExcedenteDiscrepancia) || totalImp === 0n;
      return {
        ...mov,
        totalImputadoCentavos: totalImp.toString(),
        tieneExcedente,
      };
    });

    const remitosMap = new Map<string, {
      remitoId: string;
      remitoNumero: string;
      remitoImporteCentavos: string | null;
      comercio: string;
      comercioCuit: string | null;
      totalImputado: bigint;
      imputadoPor: string;
      imputadoEn: string;
      detalleMovimientos: RemitoConsolidadoHistorial['detalleMovimientos'];
    }>();

    for (const mov of movimientos) {
      for (const imp of mov.imputaciones) {
        if (!remitosMap.has(imp.remitoId)) {
          remitosMap.set(imp.remitoId, {
            remitoId: imp.remitoId,
            remitoNumero: imp.remitoNumero,
            remitoImporteCentavos: imp.remitoImporteCentavos ?? null,
            comercio: imp.comercio,
            comercioCuit: imp.comercioCuit ?? null,
            totalImputado: 0n,
            imputadoPor: imp.imputadoPor,
            imputadoEn: imp.imputadoEn,
            detalleMovimientos: [],
          });
        }
        const entry = remitosMap.get(imp.remitoId)!;
        entry.totalImputado += BigInt(imp.importeCentavos || '0');
        if (new Date(imp.imputadoEn) > new Date(entry.imputadoEn)) {
          entry.imputadoEn = imp.imputadoEn;
          entry.imputadoPor = imp.imputadoPor;
        }
        entry.detalleMovimientos.push({
          movimientoId: mov.id,
          ordenante: mov.ordenante,
          referenciaExterna: mov.referencia_externa,
          importeCentavos: imp.importeCentavos,
          esExcedenteDiscrepancia: Boolean(imp.esExcedenteDiscrepancia),
        });
      }
    }

    const remitos: RemitoConsolidadoHistorial[] = Array.from(remitosMap.values()).map((r) => ({
      remitoId: r.remitoId,
      remitoNumero: r.remitoNumero,
      remitoImporteCentavos: r.remitoImporteCentavos,
      comercio: r.comercio,
      comercioCuit: r.comercioCuit,
      totalImputadoCentavos: r.totalImputado.toString(),
      imputadoPor: r.imputadoPor,
      imputadoEn: r.imputadoEn,
      detalleMovimientos: r.detalleMovimientos,
    }));

    const discrepancia = movimientos.find((m) => m.discrepancia)?.discrepancia;
    const totalMovimientos = movimientos.reduce((acc, m) => acc + BigInt(m.importe_centavos || '0'), 0n);
    const totalImputado = remitos.reduce((acc, r) => acc + BigInt(r.totalImputadoCentavos || '0'), 0n);
    const imputadoEn = movimientos.reduce((latest, m) => (
      new Date(m.imputado_en) > new Date(latest) ? m.imputado_en : latest
    ), movimientos[0].imputado_en);

    const sucursales = [...new Set(movimientos.map((m) => m.sucursal).filter(Boolean))];
    const cuentas = [...new Set(movimientos.map((m) => m.cuenta).filter(Boolean))];
    const comercioPrincipal = remitos[0]?.comercio || movimientos[0]?.ordenante || 'Comercio no informado';
    const key = discrepancia
      ? `disc-${discrepancia.id}`
      : `op-${movimientos.map((m) => m.id).join('-')}`;

    grupos.push({
      key,
      movimientos,
      remitos,
      discrepancia,
      totalMovimientosCentavos: totalMovimientos.toString(),
      totalImputadoCentavos: totalImputado.toString(),
      imputadoEn,
      sucursales,
      cuentas,
      comercioPrincipal,
    });
  }

  return grupos.sort((a, b) => new Date(b.imputadoEn).getTime() - new Date(a.imputadoEn).getTime());
}
