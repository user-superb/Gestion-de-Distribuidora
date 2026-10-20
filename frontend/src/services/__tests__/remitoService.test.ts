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

describe('Historia de Usuario #13 - Ordenar Secuencias de Visitas', () => {
  beforeEach(() => {
    remitoService.resetearDatosMock();
  });

  it('ESCENARIO 1: Cambio de orden exitoso: El administrativo arrastra una visita a la primera posición. El sistema actualiza la secuencia numérica de toda la ruta.', () => {
    // Agrupar visitas para dos comercios distintos
    const v1 = remitoService.agruparEnVisita(['rem-1']); // com-101
    const v2 = remitoService.agruparEnVisita(['rem-3']); // com-102
    const v3 = remitoService.agruparEnVisita(['rem-5']); // com-103

    expect(v1.success).toBe(true);
    expect(v2.success).toBe(true);
    expect(v3.success).toBe(true);

    const visitas = remitoService.getVisitas();
    expect(visitas.length).toBe(3);

    const id1 = v1.visita!.id;
    const id2 = v2.visita!.id;
    const id3 = v3.visita!.id;

    // El administrativo mueve la visita 3 a la primera posición: [id3, id1, id2]
    const resultado = remitoService.reordenarVisitas([id3, id1, id2]);
    expect(resultado.success).toBe(true);
    expect(resultado.visitas).toBeDefined();

    // La secuencia numérica de toda la ruta debe actualizarse (1, 2, 3)
    const reordenadas = resultado.visitas!;
    expect(reordenadas[0].id).toBe(id3);
    expect(reordenadas[0].orden).toBe(1);

    expect(reordenadas[1].id).toBe(id1);
    expect(reordenadas[1].orden).toBe(2);

    expect(reordenadas[2].id).toBe(id2);
    expect(reordenadas[2].orden).toBe(3);
  });

  it('ESCENARIO 2: Fallo por ruta en curso: El administrativo intenta reordenar una hoja de ruta que ya fue despachada. El sistema bloquea el cambio por encontrarse en ejecución.', () => {
    const v1 = remitoService.agruparEnVisita(['rem-1']);
    const v2 = remitoService.agruparEnVisita(['rem-3']);

    // Simular que la hoja de ruta fue despachada / está en ejecución
    remitoService.cambiarEstadoHojaDeRuta('en_curso');

    const id1 = v1.visita!.id;
    const id2 = v2.visita!.id;

    // Intentar reordenar
    const resultado = remitoService.reordenarVisitas([id2, id1]);

    expect(resultado.success).toBe(false);
    expect(resultado.status).toBe(409);
    expect(resultado.error).toMatch(/despachada.*en ejecución|en ejecución/i);
  });
});

describe('Historia de Usuario: Carga Manual de Entregas', () => {
  beforeEach(() => {
    remitoService.resetearDatosMock();
  });

  it('ESCENARIO 1: Carga manual exitosa de comercio registrado: Se ingresan los datos de una nueva entrega para un comercio ya registrado. El sistema genera un remito interno disponible para asignar.', () => {
    const totalInicial = remitoService.getRemitosPendientes().length;

    const res = remitoService.crearEntregaManual({
      comercioId: 'com-101',
      marcaId: 'marca-A',
      importe: 55000,
      numeroRemito: 'MAN-REG-99',
    });

    expect(res.success).toBe(true);
    expect(res.remito).toBeDefined();
    expect(res.remito?.comercioId).toBe('com-101');
    expect(res.remito?.marcaId).toBe('marca-A');
    expect(res.remito?.importe).toBe(55000);
    expect(res.remito?.estado).toBe('PENDIENTE');

    // Debe incrementar la cantidad de pendientes
    const pendientes = remitoService.getRemitosPendientes();
    expect(pendientes.length).toBe(totalInicial + 1);

    // El nuevo remito debe estar disponible para agrupar
    const agruparRes = remitoService.agruparEnVisita([res.remito!.id]);
    expect(agruparRes.success).toBe(true);
    expect(agruparRes.visita?.comercioId).toBe('com-101');
  });

  it('ESCENARIO 2: Carga manual exitosa de comercio no registrado: Se ingresan los datos de una nueva entrega para un comercio no registrado. Se ingresan los datos básicos del comercio. El sistema genera un remito interno disponible para asignar.', () => {
    const comerciosIniciales = remitoService.getComercios().length;

    const res = remitoService.crearEntregaManual({
      nuevoComercio: {
        razonSocial: 'Supermercado Central',
        domicilio: 'Av. 7 N° 850',
      },
      marcaId: 'marca-B',
      importe: 42000,
    });

    expect(res.success).toBe(true);
    expect(res.remito).toBeDefined();
    expect(res.comercio).toBeDefined();
    expect(res.comercio?.razonSocial).toBe('Supermercado Central');
    expect(res.comercio?.domicilio).toBe('Av. 7 N° 850');

    // Debe asociar el remito al nuevo comercio
    expect(res.remito?.comercioId).toBe(res.comercio?.id);
    expect(res.remito?.estado).toBe('PENDIENTE');
    expect(res.remito?.numeroRemito).toMatch(/^REM-MAN-\d+$/);

    // El nuevo comercio debe haberse agregado al listado
    expect(remitoService.getComercios().length).toBe(comerciosIniciales + 1);

    // El remito debe estar disponible para agrupar
    const agruparRes = remitoService.agruparEnVisita([res.remito!.id]);
    expect(agruparRes.success).toBe(true);
    expect(agruparRes.visita?.comercioId).toBe(res.comercio?.id);
  });

  it('VALIDACIONES: Rechaza entrega si no hay comercio ni datos básicos', () => {
    const res = remitoService.crearEntregaManual({
      marcaId: 'marca-A',
      importe: 10000,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/comercio registrado|datos básicos/);
  });

  it('VALIDACIONES: Rechaza importe menor o igual a cero', () => {
    const res = remitoService.crearEntregaManual({
      comercioId: 'com-101',
      marcaId: 'marca-A',
      importe: 0,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/positivo/);
  });

  it('VALIDACIONES: Rechaza número de remito duplicado para la misma marca', () => {
    remitoService.crearEntregaManual({
      comercioId: 'com-101',
      marcaId: 'marca-A',
      importe: 12000,
      numeroRemito: 'R-DUP-1',
    });

    const dup = remitoService.crearEntregaManual({
      comercioId: 'com-102',
      marcaId: 'marca-A',
      importe: 18000,
      numeroRemito: 'R-DUP-1',
    });

    expect(dup.success).toBe(false);
    expect(dup.error).toMatch(/R-DUP-1/);
  });
});
