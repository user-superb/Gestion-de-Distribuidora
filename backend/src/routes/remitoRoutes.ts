// backend/src/routes/remitoRoutes.ts
import { Router } from 'express';
import { remitoService } from '../services/remitoService.js';

export const remitoRouter = Router();

remitoRouter.get('/comercios', async (_req, res) => {
  try {
    const comercios = await remitoService.getComercios();
    res.json(comercios);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.get('/marcas', async (_req, res) => {
  try {
    const marcas = await remitoService.getMarcas();
    res.json(marcas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.get('/transportistas', async (_req, res) => {
  try {
    const transportistas = await remitoService.getTransportistasHabilitados();
    res.json(transportistas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.get('/remitos/pendientes', async (_req, res) => {
  try {
    const pendientes = await remitoService.getRemitosPendientes();
    res.json(pendientes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.get('/remitos', async (_req, res) => {
  try {
    const remitos = await remitoService.getAllRemitos();
    res.json(remitos);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.get('/visitas', async (_req, res) => {
  try {
    const visitas = await remitoService.getVisitas();
    res.json(visitas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.post('/remitos/manual', async (req, res) => {
  try {
    const result = await remitoService.crearEntregaManual(req.body);
    if (!result.success) {
      return res.status(result.status || 400).json(result);
    }
    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.post('/remitos/asignar-comercio', async (req, res) => {
  try {
    const { remitoId, nuevoComercioId } = req.body;
    if (!remitoId || !nuevoComercioId) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos: remitoId, nuevoComercioId' });
    }
    await remitoService.asignarComercioARemito(remitoId, nuevoComercioId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.post('/visitas/agrupar', async (req, res) => {
  try {
    const { remitoIds } = req.body;
    if (!Array.isArray(remitoIds) || remitoIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe enviar un arreglo remitoIds con al menos un ID.' });
    }
    const result = await remitoService.agruparEnVisita(remitoIds);
    if (!result.success) {
      return res.status(422).json(result);
    }
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.delete('/visitas/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const result = await remitoService.quitarVisitaDeHojaDeRuta(id);
    if (!result.success) {
      return res.status(result.status || 409).json(result);
    }
    res.json({ message: 'Visita quitada exitosamente', ...result });
  } catch (error: any) {
    res.status(error?.status || 500).json({ success: false, error: error.message });
  }
});

remitoRouter.delete(['/hojas-de-ruta/:hojaId/visitas/:visitaId', '/hoja-de-ruta/:hojaId/visitas/:visitaId'], async (req, res) => {
  try {
    const hojaId = String(req.params.hojaId);
    const visitaId = String(req.params.visitaId);
    const result = await remitoService.quitarVisitaDeHojaDeRuta(visitaId, hojaId);
    if (!result.success) {
      return res.status(result.status || 409).json(result);
    }
    res.json({ message: 'Visita quitada de la hoja de ruta exitosamente', ...result });
  } catch (error: any) {
    res.status(error?.status || 500).json({ success: false, error: error.message });
  }
});

remitoRouter.get('/hoja-de-ruta/activa', async (_req, res) => {
  try {
    const hoja = await remitoService.getHojaDeRutaActiva();
    res.json(hoja);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.get('/hojas-de-ruta', async (_req, res) => {
  try {
    const hojas = await remitoService.getHojasDeRuta();
    res.json(hojas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.delete('/hojas-de-ruta/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await remitoService.eliminarHojaDeRuta(id);
    if (!result.success) {
      return res.status(result.status || 409).json(result);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.patch('/hoja-de-ruta/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    if (!estado) {
      return res.status(400).json({ error: 'Debe especificar el nuevo estado.' });
    }
    await remitoService.cambiarEstadoHojaDeRuta(id, estado);
    res.json({ success: true, id, estado });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

remitoRouter.patch('/hoja-de-ruta/:id/transportista', async (req, res) => {
  try {
    const { id } = req.params;
    const { transportistaId } = req.body;
    const result = await remitoService.asignarTransportistaHojaDeRuta(id, transportistaId ?? null);
    if (!result.success) {
      return res.status(result.status || 422).json(result);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.patch('/hoja-de-ruta/:id/fecha', async (req, res) => {
  try {
    const { id } = req.params;
    const fechaReparto = req.body?.fechaReparto ?? req.body?.fecha;
    const result = await remitoService.asignarFechaHojaDeRuta(fechaReparto, id);
    if (!result.success) {
      return res.status(result.status || 422).json(result);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.patch('/hoja-de-ruta/fecha', async (req, res) => {
  try {
    const fechaReparto = req.body?.fechaReparto ?? req.body?.fecha;
    const hojaDeRutaId = req.body?.hojaDeRutaId;
    const result = await remitoService.asignarFechaHojaDeRuta(fechaReparto, hojaDeRutaId);
    if (!result.success) {
      return res.status(result.status || 422).json(result);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.put('/visitas/reordenar', async (req, res) => {
  try {
    const { visitaIds, hojaDeRutaId } = req.body;
    if (!Array.isArray(visitaIds)) {
      return res.status(400).json({ success: false, error: 'Debe enviar un arreglo de visitaIds.' });
    }
    const result = await remitoService.reordenarVisitas(visitaIds, hojaDeRutaId);
    if (!result.success) {
      return res.status(result.status || 400).json(result);
    }
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.post('/hoja-de-ruta/:id/anexar-entrega', async (req, res) => {
  try {
    const { id } = req.params;
    const { remitoId, dispositivoConectado } = req.body;
    const result = await remitoService.anexarEntregaARuta(remitoId, id, {
      dispositivoConectado:
        dispositivoConectado !== undefined ? Boolean(dispositivoConectado) : undefined,
    });
    if (!result.success) {
      return res.status(result.status || 422).json(result);
    }
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.post('/remitos/:id/anexar', async (req, res) => {
  try {
    const { id } = req.params;
    const { hojaDeRutaId, dispositivoConectado } = req.body;
    const result = await remitoService.anexarEntregaARuta(id, hojaDeRutaId, {
      dispositivoConectado:
        dispositivoConectado !== undefined ? Boolean(dispositivoConectado) : undefined,
    });
    if (!result.success) {
      return res.status(result.status || 422).json(result);
    }
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

remitoRouter.patch('/transportistas/:id/conexion', async (req, res) => {
  try {
    const { id } = req.params;
    const { conectado } = req.body;
    const result = await remitoService.actualizarConexionTransportista(id, Boolean(conectado));
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
