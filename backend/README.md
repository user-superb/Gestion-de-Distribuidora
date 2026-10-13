# Módulo Backend - API & Servicios

Espacio reservado para el backend de la plataforma de distribución "Tutucas".

### Integración Prevista:
- **API REST / GraphQL:** Endpoints de autenticación (`/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`), gestión de hojas de ruta, pedidos y clientes.
- **Base de Datos:** Persistencia de usuarios, roles, sucursales y auditoría.
- **Conexión con Frontend:** El servicio de autenticación del frontend (`frontend/src/services/authService.ts`) está tipado e interfaces preparado para reemplazar el mock por llamadas HTTP `fetch` / `axios` a este módulo.
