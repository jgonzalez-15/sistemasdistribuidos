-- Auth Database Schema
CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(100) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'admin'))
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(100) PRIMARY KEY,
    token VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Usuarios de desarrollo (user/user123, admin/admin123). La contraseña se guarda como hash
-- PBKDF2-HMAC-SHA256 (formato pbkdf2_sha256$iteraciones$sal$hash), nunca en texto plano.
-- auth-service también los crea al arrancar y migra cualquier contraseña vieja en texto plano.
-- Ver docs/decisiones-seguridad.md (S1).
INSERT INTO users (username, password, role) VALUES
    ('user', 'pbkdf2_sha256$600000$YVMXfLDZv4/Y2OK0hCBZVA==$HhVfws23Z2NSNHd/AdJHxRQLARRon7Q8cYQ/tfO+W4c=', 'user'),
    ('admin', 'pbkdf2_sha256$600000$1VdThcTU8y1tTNm8FCBooA==$lqqjSq4tncixLnd1GDSKhncsc2FiEr6bucMVSV6lQ+U=', 'admin')
ON CONFLICT (username) DO NOTHING;
