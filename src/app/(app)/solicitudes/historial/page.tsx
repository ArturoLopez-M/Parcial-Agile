import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { usuarioActual } from "@/lib/session";
import ReintentarBtn from "@/components/ReintentarBtn";
import { fechaLima, soles } from "@/lib/formato";

export const metadata = { title: "Historial de solicitudes — ALGARROBO" };

const ESTADOS = ["Pendiente", "Aprobada", "Rechazada"];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

type Fila = {
  id: number;
  codigo: string;
  cliente: string;
  documento: string;
  monto: string;
  plazo_meses: number;
  estado: string;
  creada_en: Date;
  decidido_en: Date | null;
  decisor: string | null;
  motivo_rechazo: string | null;
  agencia: string;
};

export default async function HistorialPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; desde?: string; hasta?: string }>;
}) {
  const user = await usuarioActual();
  if (!user) redirect("/login");
  if (user.rol === "agente") redirect("/clientes");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const estado = ESTADOS.includes(sp.estado ?? "") ? (sp.estado as string) : "";
  const desde = FECHA_RE.test(sp.desde ?? "") ? (sp.desde as string) : "";
  const hasta = FECHA_RE.test(sp.hasta ?? "") ? (sp.hasta as string) : "";
  const rangoInvalido = desde !== "" && hasta !== "" && desde > hasta;
  const hayFiltros = q !== "" || estado !== "" || desde !== "" || hasta !== "";
  const verTodas = user.rol === "dueno";

  let filas: Fila[] | null = [];
  if (!rangoInvalido) {
    try {
      // Administrador: solo su agencia. Dueño: todas.
      // Búsqueda y filtros se aplican conjuntamente (AND).
      const patron = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
      filas = await query<Fila>(
        `SELECT s.id, s.codigo,
                COALESCE(c.apellidos || ' ' || c.nombres, c.razon_social) AS cliente,
                COALESCE(c.dni, c.ruc) AS documento,
                s.monto, s.plazo_meses, s.estado, s.creada_en,
                s.decidido_en, s.motivo_rechazo, u.nombre AS decisor,
                a.nombre AS agencia
           FROM solicitudes s
           JOIN clientes c ON c.id = s.cliente_id
           JOIN agencias a ON a.id = s.agencia_id
           LEFT JOIN usuarios u ON u.id = s.decidido_por
          WHERE ($1::int IS NULL OR s.agencia_id = $1::int)
            AND ($2::text IS NULL OR s.estado = $2::text)
            AND ($3::date IS NULL OR (s.creada_en AT TIME ZONE 'America/Lima')::date >= $3::date)
            AND ($4::date IS NULL OR (s.creada_en AT TIME ZONE 'America/Lima')::date <= $4::date)
            AND ($5::text IS NULL
                 OR unaccent(COALESCE(c.apellidos || ' ' || c.nombres, c.razon_social)) ILIKE unaccent($5::text)
                 OR unaccent(COALESCE(c.nombres || ' ' || c.apellidos, c.razon_social)) ILIKE unaccent($5::text)
                 OR COALESCE(c.dni, c.ruc) ILIKE $5::text)
          ORDER BY s.creada_en DESC, s.id DESC`,
        [
          user.rol === "administrador" ? user.agenciaId : null,
          estado || null,
          desde || null,
          hasta || null,
          patron,
        ],
      );
    } catch (err) {
      console.error("historial solicitudes:", err);
      filas = null;
    }
  }

  return (
    <>
      <h1>Historial de solicitudes</h1>
      <p className="sub">
        {verTodas ? "Todas las agencias" : `Agencia ${user.agencia}`} · pendientes, aprobadas y
        rechazadas, de la más reciente a la más antigua.
      </p>

      <form
        key={`${q}|${estado}|${desde}|${hasta}`}
        action="/solicitudes/historial"
        method="get"
        className="panel"
        role="search"
        >
        <div className="grid">
          <div className="campo">
            <label htmlFor="q">Cliente (nombre o DNI)</label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={100}
              placeholder="Ej. Pérez o 12345678"
            />
          </div>
          <div className="campo">
            <label htmlFor="estado">Estado</label>
            <select id="estado" name="estado" defaultValue={estado}>
              <option value="">Todos</option>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="desde">Registrada desde</label>
            <input id="desde" name="desde" type="date" defaultValue={desde} />
          </div>
          <div className="campo">
            <label htmlFor="hasta">Registrada hasta</label>
            <input id="hasta" name="hasta" type="date" defaultValue={hasta} />
          </div>
        </div>
        <div className="acciones">
          <button type="submit" className="btn">
            Buscar
          </button>
          {hayFiltros && (
            <Link href="/solicitudes/historial" className="btn sec">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      {rangoInvalido ? (
        <div className="aviso err" role="alert">
          La fecha «desde» no puede ser posterior a la fecha «hasta».
        </div>
      ) : filas === null ? (
        <div className="panel">
          <div className="aviso err" role="alert">
            No se pudo cargar el historial. Intente nuevamente.
          </div>
          <ReintentarBtn />
        </div>
      ) : filas.length === 0 ? (
        <div className="panel vacio">No se encontraron solicitudes</div>
      ) : (
        <div className="tabla-wrap">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Cliente</th>
                <th>DNI / RUC</th>
                <th>Monto</th>
                <th>Plazo</th>
                <th>Estado</th>
                <th>Fecha de registro</th>
                <th>Decisión</th>
                {verTodas && <th>Agencia</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.codigo}</td>
                  <td>{f.cliente}</td>
                  <td>{f.documento}</td>
                  <td>{soles(f.monto)}</td>
                  <td>
                    {f.plazo_meses} {f.plazo_meses === 1 ? "mes" : "meses"}
                  </td>
                  <td>
                    <span className="badge">{f.estado}</span>
                  </td>
                  <td>{fechaLima(f.creada_en)}</td>
                  <td>
                    {f.decidido_en ? (
                      <>
                        {fechaLima(f.decidido_en)} · {f.decisor ?? "—"}
                        {f.estado === "Rechazada" && (
                          <>
                            <br />
                            Motivo: {f.motivo_rechazo ?? "—"}
                          </>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {verTodas && <td>{f.agencia}</td>}
                  <td>
                    <Link href={`/solicitudes/${f.id}?desde=historial`}>Ver detalle</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}