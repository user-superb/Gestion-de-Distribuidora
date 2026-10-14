// frontend/src/services/__tests__/remitoService.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { remitoService } from '../remitoService';

describe('Historia de Usuario #12 - Agrupación de Remitos por Comercio', () => {
  beforeEach(() => {
    // Restaurar los datos mock iniciales antes de cada test
    remitoService.resetearDatosMock();
  });

  it('ESCENARIO 1: Debe agrupar exitosamente remitos que comparten el mismo comercioId en una visita unificada', () => {
    // rem-1 y rem-2 pertenecen a 'com-101' (Mayorista El Sol S.R.L.)
    const remitoIds = ['rem-1', 'rem-2'];
    const resultado = remitoService.agruparEnVisita(remitoIds);

    expect(resultado.success).toBe(true);
    expect(resultado.visita).toBeDefined();
    expect(resultado.visita?.comercioId).toBe('com-101');
    expect(resultado.visita?.remitos.length).toBe(2);
    // Importe total: 150000 + 85000 = 235000
    expect(resultado.visita?.importeTotal).toBe(235000);

    // Los remitos deben pasar a estado AGRUPADO y no aparecer en pendientes
    const pendientes = remitoService.getRemitosPendientes();
    expect(pendientes.some((r) => remitoIds.includes(r.id))).toBe(false);

    // La visita debe figurar en el listado de visitas activas
    const visitas = remitoService.getVisitas();
    expect(visitas.length).toBe(1);
    expect(visitas[0].id).toBe(resultado.visita?.id);
  });

  it('REGLA MULTIMARCA: Debe permitir agrupar remitos de distintas marcas si el comercio destinatario es el mismo', () => {
    // rem-1 es de marca-A y rem-2 es de marca-B, ambos para com-101
    const remitos = remitoService.getAllRemitos();
    const r1 = remitos.find((r) => r.id === 'rem-1');
    const r2 = remitos.find((r) => r.id === 'rem-2');

    expect(r1?.marcaId).not.toBe(r2?.marcaId);
    expect(r1?.comercioId).toBe(r2?.comercioId);

    const resultado = remitoService.agruparEnVisita(['rem-1', 'rem-2']);
    expect(resultado.success).toBe(true);
    expect(resultado.visita?.remitos.map((r) => r.marcaId)).toEqual(
      expect.arrayContaining(['marca-A', 'marca-B'])
    );
  });

  it('ESCENARIO 2 (RECHAZO): Debe rechazar la agrupación si se seleccionan remitos de distintos comercios', () => {
    // rem-1 pertenece a 'com-101' y rem-3 pertenece a 'com-102'
    const remitoIds = ['rem-1', 'rem-3'];
    const resultado = remitoService.agruparEnVisita(remitoIds);

    expect(resultado.success).toBe(false);
    expect(resultado.visita).toBeUndefined();
    expect(resultado.error).toContain('Los remitos seleccionados pertenecen a comercios distintos');

    // Ningún remito debe haber cambiado de estado
    const pendientes = remitoService.getRemitosPendientes();
    expect(pendientes.find((r) => r.id === 'rem-1')?.estado).toBe('PENDIENTE');
    expect(pendientes.find((r) => r.id === 'rem-3')?.estado).toBe('PENDIENTE');
    expect(remitoService.getVisitas().length).toBe(0);
  });

  it('Debe rechazar la agrupación si la lista de IDs está vacía', () => {
    const resultado = remitoService.agruparEnVisita([]);
    expect(resultado.success).toBe(false);
    expect(resultado.error).toContain('al menos un remito');
  });

  it('CONSOLIDACIÓN INCREMENTAL: Si ya existe una visita para un comercio, debe unificar los nuevos remitos en la misma visita', () => {
    // Primero agrupamos rem-1 (com-101)
    const primera = remitoService.agruparEnVisita(['rem-1']);
    expect(primera.success).toBe(true);
    const primerId = primera.visita?.id;

    // Luego agrupamos rem-2 (también com-101)
    const segunda = remitoService.agruparEnVisita(['rem-2']);
    expect(segunda.success).toBe(true);
    expect(segunda.visita?.id).toBe(primerId);
    expect(segunda.visita?.remitos.length).toBe(2);
    expect(segunda.visita?.importeTotal).toBe(235000);

    // Debe seguir habiendo solo una visita consolidada
    expect(remitoService.getVisitas().length).toBe(1);
  });

  it('DESAGRUPAR: Al desagrupar una visita, los remitos deben volver a pendientes y eliminarse la visita', () => {
    const agruparRes = remitoService.agruparEnVisita(['rem-1', 'rem-2']);
    const visitaId = agruparRes.visita!.id;

    expect(remitoService.getVisitas().length).toBe(1);
    expect(remitoService.getRemitosPendientes().length).toBe(3); // Quedaban rem-3, rem-4, rem-5

    remitoService.desagruparVisita(visitaId);

    expect(remitoService.getVisitas().length).toBe(0);
    expect(remitoService.getRemitosPendientes().length).toBe(5);
    expect(remitoService.getRemitosPendientes().find((r) => r.id === 'rem-1')).toBeDefined();
    expect(remitoService.getRemitosPendientes().find((r) => r.id === 'rem-2')).toBeDefined();
  });
});
