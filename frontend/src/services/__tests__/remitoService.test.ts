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


describe('Historia de Usuario #15 - Asignar Fecha a la Hoja de Ruta', () => {
  beforeEach(() => {
    remitoService.resetearDatosMock();
  });

  it('ESCENARIO 1: Programación exitosa: Se define la fecha (en el día o a futuro) y la ruta queda en estado "Pendiente de Despacho"', () => {
    const hojaInicial = remitoService.getHojaDeRutaActiva();
    expect(hojaInicial?.estado).toBe('borrador');

    const resultado = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    expect(resultado.success).toBe(true);
    expect(resultado.hojaDeRuta).toBeDefined();
    expect(resultado.hojaDeRuta?.fechaReparto).toBe('2026-10-25');
    expect(resultado.hojaDeRuta?.estado).toBe('pendiente_de_despacho');

    // También debe permitir programar en el mismo día actual
    const resultadoHoy = remitoService.asignarFechaHojaDeRuta('2026-10-20', '2026-10-20');
    expect(resultadoHoy.success).toBe(true);
    expect(resultadoHoy.hojaDeRuta?.fechaReparto).toBe('2026-10-20');
    expect(resultadoHoy.hojaDeRuta?.estado).toBe('pendiente_de_despacho');
  });

  it('ESCENARIO 2: Fallo por fecha pretérita: El administrativo intenta ingresar una fecha anterior a la actual. El sistema rechaza la programación.', () => {
    const hojaInicial = remitoService.getHojaDeRutaActiva();

    const resultado = remitoService.asignarFechaHojaDeRuta('2026-10-19', '2026-10-20');
    expect(resultado.success).toBe(false);
    expect(resultado.status).toBe(422);
    expect(resultado.error).toMatch(/fecha anterior a la actual|en el día o a futuro/i);

    // El estado debe mantenerse en borrador sin alterar la fecha previa
    const hojaPosterior = remitoService.getHojaDeRutaActiva();
    expect(hojaPosterior?.estado).toBe('borrador');
    expect(hojaPosterior?.fechaReparto).toBe(hojaInicial?.fechaReparto);
  });

  it('FLUJO MULTI-HOJA DE RUTA: Las visitas programadas pasan a la pestaña 3 y solo regresan a la pestaña 2 al eliminar la hoja de ruta', () => {
    // Armamos primera visita en pestaña 2
    const v1 = remitoService.agruparEnVisita(['rem-1', 'rem-2']);
    expect(v1.visita?.hojaDeRutaId).toBeNull();

    // Programamos la primera Hoja de Ruta
    const prog1 = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    expect(prog1.success).toBe(true);
    const hoja1Id = prog1.hojaDeRuta!.id;

    // La visita ya no está en armado (pestaña 2)
    expect(remitoService.getVisitas().filter((v) => !v.hojaDeRutaId).length).toBe(0);
    expect(remitoService.getVisitas().filter((v) => v.hojaDeRutaId === hoja1Id).length).toBe(1);

    // Armamos segunda visita en pestaña 2 y programamos una segunda Hoja de Ruta
    const v2 = remitoService.agruparEnVisita(['rem-3', 'rem-4']);
    expect(v2.visita?.hojaDeRutaId).toBeNull();
    const prog2 = remitoService.asignarFechaHojaDeRuta('2026-10-26', '2026-10-20');
    expect(prog2.success).toBe(true);
    const hoja2Id = prog2.hojaDeRuta!.id;

    expect(remitoService.getHojasDeRuta().length).toBe(2);

    // Eliminamos la primera Hoja de Ruta en pestaña 3: su visita vuelve a pestaña 2 (hojaDeRutaId: null)
    const del1 = remitoService.eliminarHojaDeRuta(hoja1Id);
    expect(del1.success).toBe(true);
    expect(remitoService.getHojasDeRuta().length).toBe(1);
    expect(remitoService.getVisitas().filter((v) => !v.hojaDeRutaId).length).toBe(1);
    expect(remitoService.getVisitas().filter((v) => v.hojaDeRutaId === hoja2Id).length).toBe(1);
  });
});

describe('Historia de Usuario #14 - Asignar Hoja de Ruta a Transportista', () => {
  beforeEach(() => {
    remitoService.resetearDatosMock();
  });

  it('ESCENARIO 1: Asignación exitosa sin hoja de ruta asignada previamente: El administrativo selecciona a un transportista habilitado sin otra hoja de ruta asignada en esa fecha y asigna la hoja de ruta. El sistema vincula la ruta a su perfil.', () => {
    // 1. Programamos una hoja de ruta
    remitoService.agruparEnVisita(['rem-1', 'rem-2']);
    const prog = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    expect(prog.success).toBe(true);
    const hojaId = prog.hojaDeRuta!.id;

    // 2. Asignamos al transportista Carlos Repartidor (id '2')
    const asignacion = remitoService.asignarTransportistaHojaDeRuta(hojaId, '2');
    expect(asignacion.success).toBe(true);
    expect(asignacion.hojaDeRuta?.transportistaId).toBe('2');
    expect(asignacion.hojaDeRuta?.transportistaNombre).toBe('Carlos Repartidor');

    // Verificamos que se refleje en el listado de hojas
    const hojas = remitoService.getHojasDeRuta();
    const hojaGuardada = hojas.find((h) => h.id === hojaId);
    expect(hojaGuardada?.transportistaId).toBe('2');
    expect(hojaGuardada?.transportistaNombre).toBe('Carlos Repartidor');
  });

  it('ESCENARIO 2: Fallo por solapamiento de asignación: El administrativo intenta asignar la ruta a un transportista que ya posee una ruta en curso para esa misma fecha. El sistema rechaza la asignación.', () => {
    // 1. Armamos y programamos primera hoja para fecha 2026-10-25
    remitoService.agruparEnVisita(['rem-1', 'rem-2']);
    const prog1 = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    const hoja1Id = prog1.hojaDeRuta!.id;

    // Asignamos a Carlos (id '2')
    const asig1 = remitoService.asignarTransportistaHojaDeRuta(hoja1Id, '2');
    expect(asig1.success).toBe(true);

    // 2. Armamos y programamos segunda hoja para la MISMA fecha 2026-10-25
    remitoService.agruparEnVisita(['rem-3', 'rem-4']);
    const prog2 = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    const hoja2Id = prog2.hojaDeRuta!.id;

    // Intentamos asignar también a Carlos (id '2') en la misma fecha
    const asig2 = remitoService.asignarTransportistaHojaDeRuta(hoja2Id, '2');
    expect(asig2.success).toBe(false);
    expect(asig2.status).toBe(422);
    expect(asig2.error).toMatch(/ya posee una hoja de ruta asignada para esa misma fecha/i);

    // Verificamos que la hoja 2 no quedó asignada a Carlos
    const hojas = remitoService.getHojasDeRuta();
    const hoja2 = hojas.find((h) => h.id === hoja2Id);
    expect(hoja2?.transportistaId).toBeNull();
  });

  it('REGLAS A CONSIDERAR: Rechaza si el transportista no existe o no está habilitado', () => {
    remitoService.agruparEnVisita(['rem-1']);
    const prog = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    const hojaId = prog.hojaDeRuta!.id;

    const noExiste = remitoService.asignarTransportistaHojaDeRuta(hojaId, '999');
    expect(noExiste.success).toBe(false);
    expect(noExiste.status).toBe(404);
  });

  it('DESASIGNACIÓN: Permite desasignar el transportista pasando null', () => {
    remitoService.agruparEnVisita(['rem-1']);
    const prog = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    const hojaId = prog.hojaDeRuta!.id;

    remitoService.asignarTransportistaHojaDeRuta(hojaId, '2');
    const desasig = remitoService.asignarTransportistaHojaDeRuta(hojaId, null);
    expect(desasig.success).toBe(true);
    expect(desasig.hojaDeRuta?.transportistaId).toBeNull();
    expect(desasig.hojaDeRuta?.transportistaNombre).toBeNull();
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

describe('Historia de Usuario #19 - Anexar una Entrega a una Ruta', () => {
  beforeEach(() => {
    remitoService.resetearDatosMock();
  });

  it('ESCENARIO 1: Anexión exitosa: Se asigna el remito a una ruta preexistente. La parada aparece al final de la secuencia del transportista.', () => {
    // 1. Armamos y programamos una Hoja de Ruta inicial con una parada (secuencia: 1)
    remitoService.agruparEnVisita(['rem-1', 'rem-2']);
    const prog = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    expect(prog.success).toBe(true);
    const hojaId = prog.hojaDeRuta!.id;

    // Asignamos transportista con dispositivo conectado
    remitoService.setConexionTransportista('2', true);
    remitoService.asignarTransportistaHojaDeRuta(hojaId, '2');

    // 2. Anexamos el remito pendiente 'rem-3' a la hoja de ruta
    const res = remitoService.anexarEntregaARuta('rem-3', hojaId);

    expect(res.success).toBe(true);
    expect(res.parada).toBeDefined();
    // La parada aparece al final de la secuencia (Parada #2)
    expect(res.ordenParada).toBe(2);
    expect(res.parada?.orden).toBe(2);
    expect(res.sincronizacionPendiente).toBe(false);
    expect(res.alerta).toBeUndefined();

    // El remito ya no figura entre los pendientes
    expect(remitoService.getRemitosPendientes().some((r) => r.id === 'rem-3')).toBe(false);

    // La parada quedó asociada a la hoja de ruta
    expect(res.parada?.hojaDeRutaId).toBe(hojaId);
    expect(res.parada?.remitos[0].id).toBe('rem-3');
  });

  it('ESCENARIO 2: Chofer desconectado: Se anexa el remito pero el dispositivo del transportista no reporta conexión. El sistema genera una alerta visual de "Sincronización pendiente".', () => {
    // 1. Armamos y programamos una Hoja de Ruta inicial
    remitoService.agruparEnVisita(['rem-1']);
    const prog = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    const hojaId = prog.hojaDeRuta!.id;

    // Chofer desconectado (dispositivoConectado = false)
    remitoService.setConexionTransportista('2', false);
    remitoService.asignarTransportistaHojaDeRuta(hojaId, '2');

    // 2. Anexamos el remito
    const res = remitoService.anexarEntregaARuta('rem-2', hojaId);

    // Se anexa la entrega al final de la secuencia
    expect(res.success).toBe(true);
    expect(res.ordenParada).toBe(2);
    expect(res.parada?.orden).toBe(2);

    // Genera alerta visual de sincronización pendiente
    expect(res.sincronizacionPendiente).toBe(true);
    expect(res.alerta).toBe('Sincronización pendiente');
    expect(res.hojaDeRuta?.tieneSincronizacionPendiente).toBe(true);
  });

  it('REGLA A CONSIDERAR: La ruta de destino debe encontrarse abierta (Rechaza cerrada o anulada)', () => {
    // 1. Programamos una hoja de ruta y la marcamos como cerrada
    remitoService.agruparEnVisita(['rem-1']);
    const prog = remitoService.asignarFechaHojaDeRuta('2026-10-25', '2026-10-20');
    const hojaId = prog.hojaDeRuta!.id;

    remitoService.cambiarEstadoHojaDeRuta('cerrada', hojaId);

    const res = remitoService.anexarEntregaARuta('rem-2', hojaId);
    expect(res.success).toBe(false);
    expect(res.status).toBe(422);
    expect(res.error).toMatch(/no se encuentra abierta/i);
    expect(res.error).toMatch(/cerrada/i);

    // Marcamos como anulada
    remitoService.cambiarEstadoHojaDeRuta('anulada', hojaId);
    const resAnulada = remitoService.anexarEntregaARuta('rem-2', hojaId);
    expect(resAnulada.success).toBe(false);
    expect(resAnulada.status).toBe(422);
    expect(resAnulada.error).toMatch(/no se encuentra abierta/i);
  });
});
