// frontend/src/config/api.ts

/**
 * Configuración centralizada de URLs del Backend.
 *
 * - Si VITE_API_URL está definido, se utiliza esa URL base (limpiando cualquier '/api' duplicado).
 * - Si VITE_API_URL NO está definido, se usan rutas relativas ('/api').
 *   De este modo, tanto en desarrollo local como en port-forwarding (Codespaces, túneles, LAN),
 *   las peticiones pasan de forma transparente por el proxy de Vite en el puerto del frontend
 *   sin errores de CORS, sin problemas de mixed content (HTTPS -> HTTP) y sin fallar por
 *   apuntar a 'localhost' en el dispositivo del cliente.
 */
const rawEnvUrl = (import.meta as any).env?.VITE_API_URL ? String((import.meta as any).env.VITE_API_URL).trim() : '';

export const API_ROOT: string = rawEnvUrl ? rawEnvUrl.replace(/\/api\/?$/, '') : '';
export const API_BASE: string = API_ROOT ? `${API_ROOT}/api` : '/api';
