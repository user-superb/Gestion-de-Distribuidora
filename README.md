# Gestion de Distribuidora - "Tutucas"
Proyecto para la materia de Ingeniería de Software de la Facultad de Informática (UNLP).

## Enunciado del proyecto
Coordinación y gestión logística de repartos para comercios de barrio: control de pedidos, trazabilidad de hojas de ruta, despacho y conciliación contra entrega.

---

## Módulo de Autenticación (Login)

Implementado siguiendo estrictamente los lineamientos de UI/UX corporativo B2B (anti-AI look, split-screen asimétrico, diseño sobrio de back-office) y los criterios de aceptación de la Historia de Usuario:

1. **Escenario 1 (Éxito y Redirección por Rol):** Autenticación con generación de token de sesión con timestamp en `sessionStorage` y redirección contextual por rol:
   - `Administrativo` -> `/dashboard` (Facturación y Hojas de Ruta)
   - `Transportista` -> `/mobile-dispatch` (Portal Móvil de Carga y Entrega)
   - `Supervisor` -> `/operations/routes` (Centro de Control Operativo)
   - `Gerente` -> `/management/metrics` (Auditoría y Conciliación)
2. **Escenario 2 (Fallo de Credenciales):** Alerta semántica con el mensaje exacto `"Credenciales incorrectas"`. Limpieza del campo de contraseña y preservación de foco inmediato.
3. **Escenario 3 (Bloqueo Preventivo):** Límite estricto de 5 intentos fallidos consecutivos. Bloqueo temporal del formulario con inputs y botón deshabilitados, e instrucciones de contacto con el Administrador o uso de recuperación de clave.

### Credenciales Mock para Pruebas

| Rol | Usuario / Correo | Contraseña | Destino Simulado |
| :--- | :--- | :--- | :--- |
| **Administrativo** | `admin@tutucas.com.ar` | `Password123!` | `/dashboard` |
| **Transportista** | `chofer@tutucas.com.ar` | `Password123!` | `/mobile-dispatch` |
| **Supervisor** | `supervisor@tutucas.com.ar` | `Password123!` | `/operations/routes` |
| **Gerente** | `gerencia@tutucas.com.ar` | `Password123!` | `/management/metrics` |

> En la parte inferior de la pantalla se incluye un **Panel de Testing (QA)** colapsable que permite autocompletar credenciales por rol, inducir fallos o forzar/resetear el bloqueo con 1 solo clic.

---

## Ejecución del Proyecto

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor de desarrollo
npm run dev

# 3. Compilar para producción (TypeScript + Vite)
npm run build
```

