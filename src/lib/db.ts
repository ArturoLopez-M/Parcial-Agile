import { Pool, type QueryResultRow } from "pg";
import bcrypt from "bcryptjs";

const g = globalThis as unknown as {
  __pgPool?: Pool;
  __schemaReady?: Promise<void>;
};

function pool(): Pool {
  if (!g.__pgPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("Falta la variable de entorno DATABASE_URL");
    }
    g.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
  }
  return g.__pgPool;
}

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS unaccent;
-- Código de cliente = máximo existente + 1. Si se borran todos los clientes, vuelve a CLI-0001.
-- El candado serializa altas simultáneas para no repetir códigos.
CREATE OR REPLACE FUNCTION siguiente_codigo_cliente() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(727002);
  SELECT COALESCE(MAX(substr(codigo, 5)::integer), 0) + 1 INTO n FROM clientes;
  RETURN 'CLI-' || lpad(n::text, 4, '0');
END $$;

ALTER TABLE clientes ALTER COLUMN codigo SET DEFAULT siguiente_codigo_cliente();
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pass_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS agencias (
  id      SERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS agencias (
  id      SERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  nombre        TEXT NOT NULL,
  usuario       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('dueno','administrador','agente')),
  agencia_id    INTEGER REFERENCES agencias(id),
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (rol = 'dueno' OR agencia_id IS NOT NULL)
);

CREATE SEQUENCE IF NOT EXISTS clientes_codigo_seq;
CREATE TABLE IF NOT EXISTS clientes (
  id             SERIAL PRIMARY KEY,
  codigo         TEXT NOT NULL UNIQUE
                 DEFAULT ('CLI-' || lpad(nextval('clientes_codigo_seq')::text, 4, '0')),
  tipo           TEXT NOT NULL CHECK (tipo IN ('persona','empresa')),
  nombres        TEXT,
  apellidos      TEXT,
  dni            TEXT UNIQUE,
  razon_social   TEXT,
  ruc            TEXT UNIQUE,
  rep_nombres    TEXT,
  rep_apellidos  TEXT,
  rep_dni        TEXT,
  telefono       TEXT NOT NULL,
  correo         TEXT NOT NULL,
  direccion      TEXT NOT NULL,
  agencia_id     INTEGER NOT NULL REFERENCES agencias(id),
  creado_por     INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (tipo = 'persona' AND nombres IS NOT NULL AND apellidos IS NOT NULL AND dni IS NOT NULL)
    OR
    (tipo = 'empresa' AND razon_social IS NOT NULL AND ruc IS NOT NULL
       AND rep_nombres IS NOT NULL AND rep_apellidos IS NOT NULL AND rep_dni IS NOT NULL)
  )
);

CREATE SEQUENCE IF NOT EXISTS solicitudes_codigo_seq;
CREATE TABLE IF NOT EXISTS solicitudes (
  id           SERIAL PRIMARY KEY,
  codigo       TEXT NOT NULL UNIQUE
               DEFAULT ('SOL-' || lpad(nextval('solicitudes_codigo_seq')::text, 4, '0')),
  cliente_id   INTEGER NOT NULL REFERENCES clientes(id),
  agencia_id   INTEGER NOT NULL REFERENCES agencias(id),
  monto        NUMERIC(12,2) NOT NULL CHECK (monto > 0 AND monto <= 10000),
  plazo_meses  INTEGER NOT NULL CHECK (plazo_meses BETWEEN 1 AND 60),
  estado       TEXT NOT NULL DEFAULT 'Pendiente'
               CHECK (estado IN ('Pendiente','Aprobada','Rechazada')),
  telefono     TEXT NOT NULL,
  correo       TEXT NOT NULL,
  creado_por   INTEGER REFERENCES usuarios(id),
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_estado_agencia
  ON solicitudes (estado, agencia_id, creada_en);
  ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS finalidad      TEXT,
  ADD COLUMN IF NOT EXISTS observaciones  TEXT,
  ADD COLUMN IF NOT EXISTS decidido_por   INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS decidido_en    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;
  ALTER TABLE solicitudes
  
  ADD COLUMN IF NOT EXISTS tasa_mensual NUMERIC(7,6);

  CREATE TABLE IF NOT EXISTS cuotas (
  id            SERIAL PRIMARY KEY,
  solicitud_id  INTEGER NOT NULL REFERENCES solicitudes(id),
  numero        INTEGER NOT NULL,
  vencimiento   DATE NOT NULL,
  capital       NUMERIC(12,2) NOT NULL,
  interes       NUMERIC(12,2) NOT NULL,
  total         NUMERIC(12,2) NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'Programada'
                CHECK (estado IN ('Programada','Próxima a vencer','Vencida pendiente de verificación')),
  UNIQUE (solicitud_id, numero)
);

CREATE TABLE IF NOT EXISTS clientes_modificaciones (
  id                SERIAL PRIMARY KEY,
  cliente_id        INTEGER NOT NULL REFERENCES clientes(id),
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
  telefono_anterior TEXT NOT NULL,
  correo_anterior   TEXT NOT NULL,
  telefono_nuevo    TEXT NOT NULL,
  correo_nuevo      TEXT NOT NULL,
  modificado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const AGENCIAS = ["Trujillo", "Chiclayo", "Piura", "Tumbes"];

// Cada usuario tiene su propia contraseña inicial. Cada uno puede cambiarla en "Mi cuenta".
const ABREV: Record<string, string> = { Trujillo: "Tru", Chiclayo: "Chi", Piura: "Piu", Tumbes: "Tum" };
const PASS_VERSION = 2; // al subirla, los usuarios semilla sin contraseña propia reciben la nueva inicial

function usuariosSemilla() {
  const lista: { nombre: string; usuario: string; rol: string; agencia: string | null; pass: string }[] = [
    { nombre: "Dueño del negocio", usuario: "dueno", rol: "dueno", agencia: null, pass: "Dueno@Alg26" },
  ];
  for (const ag of AGENCIAS) {
    const slug = ag.toLowerCase();
    lista.push(
      { nombre: `Administrador ${ag}`, usuario: `admin.${slug}`, rol: "administrador", agencia: ag, pass: `Admin${ABREV[ag]}@Alg26` },
      { nombre: `Agente ${ag}`, usuario: `agente.${slug}`, rol: "agente", agencia: ag, pass: `Agente${ABREV[ag]}@Alg26` },
    );
  }
  return lista;
}

async function sembrarUsuarios(p: Pool) {
  const vacia = (await p.query("SELECT 1 FROM usuarios LIMIT 1")).rows.length === 0;
  for (const u of usuariosSemilla()) {
    if (vacia) {
      await p.query(
        `INSERT INTO usuarios (nombre, usuario, password_hash, rol, agencia_id, pass_version)
         VALUES ($1, $2, $3, $4, (SELECT id FROM agencias WHERE nombre = $5), $6)`,
        [u.nombre, u.usuario, await bcrypt.hash(u.pass, 10), u.rol, u.agencia, PASS_VERSION],
      );
    } else {
      // Migra a la contraseña individual solo a quien aún no cambió la suya (pass_version < 2).
      const ex = await p.query("SELECT 1 FROM usuarios WHERE usuario = $1 AND pass_version < $2", [u.usuario, PASS_VERSION]);
      if (ex.rows.length > 0) {
        await p.query("UPDATE usuarios SET password_hash = $2, pass_version = $3 WHERE usuario = $1", [
          u.usuario,
          await bcrypt.hash(u.pass, 10),
          PASS_VERSION,
        ]);
      }
    }
  }
}

async function seed(p: Pool) {
  for (const nombre of AGENCIAS) {
    await p.query(
      "INSERT INTO agencias (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING",
      [nombre],
    );
  }

  await sembrarUsuarios(p);

  // Datos de demostración (solo si SEED_DEMO=true y no hay clientes aún).
  if (process.env.SEED_DEMO === "true") {
    const c = await p.query("SELECT 1 FROM clientes LIMIT 1");
    if (c.rows.length === 0) await seedDemo(p);
  }
}

async function seedDemo(p: Pool) {
  const ag = async (n: string) =>
    (await p.query("SELECT id FROM agencias WHERE nombre=$1", [n])).rows[0].id as number;
  const us = async (u: string) =>
    (await p.query("SELECT id FROM usuarios WHERE usuario=$1", [u])).rows[0].id as number;

  const trujillo = await ag("Trujillo");
  const piura = await ag("Piura");
  const chiclayo = await ag("Chiclayo");
  const uTru = await us("agente.trujillo");
  const uPiu = await us("agente.piura");
  const uChi = await us("agente.chiclayo");

  const personas: [string, string, string, string, string, string, number, number][] = [
    ["CARLOS ALBERTO", "QUISPE MAMANI", "45871236", "987654321", "carlos.quispe@correo.com", "Av. España 1020, Trujillo", trujillo, uTru],
    ["MARÍA ELENA", "ROJAS VILLANUEVA", "40125879", "976543210", "maria.rojas@correo.com", "Jr. Lima 345, Piura", piura, uPiu],
    ["JOSÉ LUIS", "ACUÑA TORRES", "32658741", "965432109", "jose.acuna@correo.com", "Calle Los Pinos 78, Chiclayo", chiclayo, uChi],
  ];
  const ids: number[] = [];
  for (const [n, a, dni, tel, mail, dir, agId, uId] of personas) {
    const r = await p.query(
      `INSERT INTO clientes (tipo,nombres,apellidos,dni,telefono,correo,direccion,agencia_id,creado_por)
       VALUES ('persona',$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [n, a, dni, tel, mail, dir, agId, uId],
    );
    ids.push(r.rows[0].id);
  }
  const e = await p.query(
    `INSERT INTO clientes (tipo,razon_social,ruc,rep_nombres,rep_apellidos,rep_dni,telefono,correo,direccion,agencia_id,creado_por)
     VALUES ('empresa','COMERCIAL EL NORTE S.A.C.','20100070970','LUIS FERNANDO','PAREDES CRUZ','18123456','944556677','contacto@elnorte.pe','Av. Larco 500, Trujillo',$1,$2) RETURNING id`,
    [trujillo, uTru],
  );
  ids.push(e.rows[0].id);

  const sol: [number, number, number, number, string, string, number][] = [
    [ids[0], trujillo, 3000, 12, "987654321", "carlos.quispe@correo.com", uTru],
    [ids[3], trujillo, 8000, 24, "944556677", "contacto@elnorte.pe", uTru],
    [ids[1], piura, 1500, 6, "976543210", "maria.rojas@correo.com", uPiu],
    [ids[2], chiclayo, 5000, 18, "965432109", "jose.acuna@correo.com", uChi],
    [ids[0], trujillo, 1000, 3, "987000111", "quispe.nuevo@correo.com", uTru],
  ];
  let i = 0;
  for (const [cid, agId, monto, plazo, tel, mail, uId] of sol) {
    await p.query(
      `INSERT INTO solicitudes (cliente_id,agencia_id,monto,plazo_meses,telefono,correo,creado_por,creada_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' hours')::interval)`,
      [cid, agId, monto, plazo, tel, mail, uId, String((sol.length - i) * 5)],
    );
    i++;
  }
}

async function initSchema() {
  const p = pool();
  const client = await p.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(SCHEMA);
    await seed(p);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(727001)");
    } finally {
      client.release();
    }
  }
}

export function ensureSchema(): Promise<void> {
  if (!g.__schemaReady) {
    g.__schemaReady = initSchema().catch((err) => {
      g.__schemaReady = undefined;
      throw err;
    });
  }
  return g.__schemaReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  await ensureSchema();
  const r = await pool().query<T>(text, params);
  return r.rows;
}
type Q = <R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<R[]>;

export async function withTransaction<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const q: Q = async (text, params) => (await client.query(text, params)).rows as never;
    const out = await fn(q);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

