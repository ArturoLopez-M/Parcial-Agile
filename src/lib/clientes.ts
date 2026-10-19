import { query } from "./db";

export type ClienteEstado = "En Orden" | "Moroso" | "Extrajudicial";

export type ClienteFila = {
  id: number;
  codigo: string;
  tipo: "persona" | "empresa";
  nombre: string;
  documento: string;
  telefono: string;
  agencia: string;
  estado: ClienteEstado;
};

const NOMBRE_SQL = `CASE WHEN c.tipo = 'persona'
                         THEN c.apellidos || ' ' || c.nombres
                         ELSE c.razon_social END`;

const BASE = `
  SELECT c.id, c.codigo, c.tipo,
         ${NOMBRE_SQL} AS nombre,
         COALESCE(c.dni, c.ruc) AS documento,
         c.telefono,
         a.nombre AS agencia,
         c.estado
    FROM clientes c
    JOIN agencias a ON a.id = c.agencia_id`;

const ORDEN = `ORDER BY c.id ASC`;

const esc = (s: string) => s.replace(/[\\%_]/g, "\\$&");

async function recalcularEstados(): Promise<void> {
  const afectados = await query<{ cliente_id: number }>(
    `SELECT DISTINCT s.cliente_id
       FROM cuotas cu
       JOIN solicitudes s ON s.id = cu.solicitud_id
      WHERE cu.vencimiento < (now() AT TIME ZONE 'America/Lima')::date
        AND cu.estado <> 'Pagada'`,
  );
  for (const { cliente_id } of afectados) {
    await query("SELECT recalcular_estado_cliente($1)", [cliente_id]);
  }
}

export async function buscarClientes(texto: string): Promise<ClienteFila[]> {
  await recalcularEstados();

  const q = texto.trim().replace(/\s+/g, " ").slice(0, 100);

  if (!q) return query<ClienteFila>(`${BASE} ${ORDEN}`);

  if (/^\d+$/.test(q)) {
    return query<ClienteFila>(
      `${BASE} WHERE c.dni = $1 OR c.ruc = $1 ${ORDEN}`,
      [q],
    );
  }

  const palabras = q.split(" ").slice(0, 6);
  const condiciones = palabras.map(
    (_, i) =>
      `unaccent(lower(concat_ws(' ', c.nombres, c.apellidos, c.razon_social)))
         LIKE '%' || unaccent(lower($${i + 1})) || '%'`,
  );
  return query<ClienteFila>(
    `${BASE} WHERE ${condiciones.join(" AND ")} ${ORDEN}`,
    palabras.map(esc),
  );
}