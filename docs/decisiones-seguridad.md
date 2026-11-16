# Decisiones de diseño: seguridad

Alcance: almacenamiento de contraseñas en `auth-service` y `auth-db`.

Cada decisión registra:
- qué se decidió y por qué;
- de qué clase sale, o **[FUERA DE CLASE]**;
- el **trade-off aceptado**;
- **cómo afecta** al resto del sistema y al equipo;
- la alternativa que se descartó.

La seguridad no forma parte del temario del curso. Por eso la decisión principal está marcada **[FUERA DE CLASE]**: sigue buenas prácticas habituales (OWASP), sin agregar dependencias ni cambiar contratos entre servicios.

---

## S1. Contraseñas guardadas como hash PBKDF2-HMAC-SHA256 con sal
- **Por qué:** `auth-db.users` guardaba la contraseña en texto plano, y el login comparaba con `WHERE password = %s`. Cualquiera con acceso a la base, a un backup o al puerto 5433 veía todas las contraseñas.
- **Qué se hizo:**
  - `auth-service/passwords.py` calcula el hash con `hashlib.pbkdf2_hmac`, de la librería estándar. Usa una sal aleatoria de 16 bytes por usuario y 600 000 iteraciones (`PBKDF2_ITERATIONS`).
  - Formato: `pbkdf2_sha256$iteraciones$sal$hash`. Cada hash guarda sus iteraciones, así que subir el valor no invalida los hashes existentes.
  - El login busca solo por `username` y compara con `hmac.compare_digest`, que tarda lo mismo sin importar dónde difieran los valores.
  - Si el usuario no existe, se verifica igual contra un hash de relleno. La respuesta es la misma que con una contraseña incorrecta (401 "Invalid username or password") y la demora es similar, así que no se puede averiguar qué usuarios existen.
  - **Migración:** al arrancar, `auth-service` reemplaza por su hash toda contraseña que no tenga el prefijo `pbkdf2_sha256$` y registra el evento `passwords_migrated`. No hace falta borrar el volumen `auth_db_data`. Si `auth-db` todavía no acepta conexiones, el arranque se reintenta 10 veces, cada 2 s.
  - El seed de `init.sql` ya trae los hashes. Las contraseñas de los usuarios de desarrollo se leen de `AUTH_SEED_USER_PASSWORD` y `AUTH_SEED_ADMIN_PASSWORD` (por defecto `user123` y `admin123`).
- **Fuente:** **[FUERA DE CLASE]** (OWASP Password Storage Cheat Sheet). Leer las contraseñas del seed del entorno sale de 12-Factor III, Tema 2.0.
- **Trade-off aceptado:**
  - Cada login hace 600 000 iteraciones de hash: es CPU de `auth-service` y limita los logins por segundo. Se acepta porque el login es poco frecuente; las consultas usan el token, no la contraseña.
  - PBKDF2 resiste peor que bcrypt o Argon2 los ataques con GPU.
- **Cómo afecta:**
  - Ningún contrato cambia: `POST /login` recibe y devuelve lo mismo, y `api-rest`, el frontend y el canary de observabilidad no se modifican.
  - Las contraseñas ya no se pueden leer en la base. Para cambiar una hay que guardar un hash nuevo, generado con `passwords.hash_password`.
  - **Volver a una versión anterior** de `auth-service` con la base ya migrada deja a todos sin poder entrar (401), porque el código viejo compara texto plano contra el hash. Para recuperarlo hay que volver a cargar las contraseñas de desarrollo:
    `docker compose exec -T auth-db psql -U postgres -d auth_db -c "UPDATE users SET password='user123' WHERE username='user'; UPDATE users SET password='admin123' WHERE username='admin';"`.
    Al pasar de nuevo a la versión con hash, la migración las vuelve a convertir.
- **Alternativa descartada:**
  - bcrypt o Argon2: suman una dependencia nativa a la imagen.
  - Dejar el texto plano declarado como simplificación: es el punto que más fácilmente marca un evaluador.

## S2. Riesgos conocidos que no se corrigen (simplificaciones de desarrollo y trabajo futuro)
Se detectaron en la revisión del 15/11 y se dejan fuera para no tocar código de otros componentes después del congelamiento. El informe los declara como simplificaciones.
- **Servicios internos con puerto en el host:** `visualization-backend` (8003) tiene `POST /cameras` y `POST /intersections` sin autenticación. Desde el host se puede saltear el control de rol de `api-rest`. Lo mismo pasa con `auth-service` (8005). Corrección propuesta: quitar esos `ports` del compose, como ya se hizo con `cv-module` (D5 de `decisiones-mensajeria.md`).
- **CORS abierto:** `allow_origins=["*"]` con `allow_credentials=True` en `api-rest`, `auth-service` y `visualization-backend`. Corrección propuesta: limitar los orígenes al del frontend con una variable `CORS_ORIGINS`.
- **Detalle de excepciones en las respuestas:** `detail=f"... {e}"` devuelve al cliente mensajes internos de la base. Corrección propuesta: mensaje genérico y detalle en el log.
- **Login simulado del frontend:** con `api-rest` caído, el frontend acepta cualquier contraseña y deja elegir el rol. Solo muestra datos mock, porque `api-rest` valida token y rol en cada endpoint.
- **Credenciales por defecto:** RabbitMQ `guest`, PostgreSQL `postgres`, MinIO `minioadmin`, Grafana `admin1`. Se pueden cambiar todas por variable de entorno.
- **Sin TLS** y **sin límite de intentos de login**.
- **Token en `localStorage`:** un ataque XSS podría leerlo. Una cookie `HttpOnly` lo evita.
