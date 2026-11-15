# Decisiones de diseño: Integración Real del Frontend con el Backend

Alcance: `frontend/src/services/bffApi.ts`, `frontend/src/context/AuthContext.tsx`, `frontend/src/components/LoginView.tsx`, `frontend/src/views/DashboardView.tsx` y `frontend/src/views/SystemBackendView.tsx`.

---

## 1. Objetivo
Reemplazar las simulaciones locales del frontend por consultas reales a `api-rest` (`:8000`) siempre que los servicios backend estén disponibles, manteniendo el fallback controlado a mocks únicamente cuando el backend esté apagado o inaccesible.

---

## 2. Cambios y Decisiones

### F1. Autenticación estricta contra `auth-service` (`bffApi.ts` y `LoginView.tsx`)
- **Qué se decidió:**
  - `loginWithBff` ahora propaga los errores HTTP reales (`401`, `403`, `422`) devueltos por `POST /login` en lugar de caer silenciosamente a `generateMockJwt(...)`.
  - El fallback a JWT simulado solo ocurre si `api-rest` es inalcanzable por red o timeout.
  - Se normaliza el rol devuelto por el backend (`'admin'` $\rightarrow$ `'Administrador'`, `'user'` $\rightarrow$ `'Operador'`) para que `App.tsx` habilite correctamente la vista `#/system` solo para administradores.
  - Se actualizaron los botones rápidos de `LoginView.tsx` para pre-cargar las credenciales reales sembradas en `auth-db` (`user` / `user123` y `admin` / `admin123`).
- **Por qué:** Antes, un fallo `401` del backend era ignorado y el usuario entraba igual con un token falso, y el rol `'admin'` impedía acceder a la vista de administrador porque `App.tsx` esperaba `'Administrador'`.

### F2. Eliminación de demoras artificiales y consulta real de datos (`bffApi.ts`)
- **Qué se decidió:**
  - Se eliminaron los `setTimeout` artificiales en `loginWithBff`, `fetchIntersectionsFromBff` y `fetchIntersectionAnalyticsFromBff` cuando se consulta el backend real.
  - `fetchIntersectionsFromBff` consume directamente la respuesta de `GET /api/intersections` (en lugar de devolver `currentIntersectionsState` mockeado).
  - `fetchIntersectionAnalyticsFromBff` consulta `GET /api/intersections/{id}/history` incluso durante refrescos rápidos (`fastRefresh`), salvo que el usuario haya activado explícitamente una simulación local de demostración.
  - `logoutFromBff` llama a `POST /logout` enviando el token por cabecera `Authorization: Bearer <token>` y cuerpo JSON para invalidar la sesión en `auth-db`.

### F3. Polling en tiempo real y refresco desde PostgreSQL (`DashboardView.tsx`)
- **Qué se decidió:**
  - Cuando `DashboardView` detecta conexión real (`dataSource === 'bff-live'`) y no está en modo tolerancia a fallos, consulta `GET /api/intersections` automáticamente cada 5 segundos y actualiza el mapa y el panel de detalle (`NodeDetailPanel`).
  - Los botones de refresco (`Simular Batch` / `Reset`) consultan nuevamente `GET /api/intersections` cuando hay backend real; solo ejecutan `simulateNextWorkerBatchUpdate()` o `resetNormalTrafficSimulation()` si el backend está offline.
- **Trade-off aceptado:** Se eligió polling cada 5 s en lugar de WebSockets para mantener la simplicidad de HTTP/REST en `api-rest` y `visualization-backend`, alineado con el intervalo de captura del `edge-processor` (`FRAME_INTERVAL=5`).

### F4. Telemetría de salud real en la vista de Administrador (`SystemBackendView.tsx`)
- **Qué se decidió:**
  - Agregar `fetchSystemHealthFromBff()` en `bffApi.ts` para consultar `GET /api/system/health` con `Authorization: Bearer <token>`.
  - `SystemBackendView.tsx` consulta este endpoint al abrirse y cada 10 segundos, registrando el estado real (`ok` / `unreachable`) de `api-rest`, `auth-service`, `edge-processor`, `cv-module`, `visualization-backend` y `monitoring-pipeline` en el flujo de logs de la consola.
- **Qué permanece simulado:** La animación visual de paquetes en vuelo del diagrama de arquitectura sigue siendo ilustrativa hasta que `monitoring-pipeline` exponga métricas/eventos en vivo desde `logs_queue`.
