import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { usuarioActual } from "@/lib/session";
import ReintentarBtn from "@/components/ReintentarBtn";
import { fechaLima, soles } from "@/lib/formato";

export const metadata = { title: "Solicitudes pendientes — ALGARROBO" };

type Fila = {
  id: number;
  codigo: string;
  cliente: string;
  documento: string;
  monto: string;
  plazo_meses: number;
  creada_en: Date;
  agencia: string;
};

export default async function PendientesPage({
  searchParams,
}: {
  searchParams: Promise<{ decidida?: string; resultado?: string }>; // HU07
}) {
  const user = await usuarioActual();
  if (!user) redirect("/login");
  if (user.rol !== "administrador") redirect("/"); // la cola de pendientes es del administrador

  const { decidida, resultado } = await searchParams; // HU07

  let filas: Fila[] | null;
  try {
    
    filas = await query<Fila>(
      `SELECT s.id, s.codigo,
              CASE WHEN c.tipo = 'persona' THEN c.apellidos || ' ' || c.nombres
                   ELSE c.razon_social END AS cliente,
              COALESCE(c.dni, c.ruc) AS documento,
              s.monto, s.plazo_meses, s.creada_en, a.nombre AS agencia
         FROM solicitudes s
         JOIN clientes c ON c.id = s.cliente_id
         JOIN agencias a ON a.id = s.agencia_id
        WHERE s.estado = 'Pendiente'
          AND ($1::int IS NULL OR s.agencia_id = $1::int)
        ORDER BY s.creada_en ASC, s.id ASC`,
      [user.rol === "administrador" ? user.agenciaId : null],
    );
  } catch (err) {
    console.error("listar pendientes:", err);
    filas = null;
  }


  return (
    <>
      <h1>Solicitudes pendientes</h1>
            <p className="sub">
        Agencia {user.agencia} · de la más antigua a la más reciente.
      </p>

      {/* HU07: confirmación tras aprobar o rechazar */}
      {decidida && (
        <div className="aviso ok" role="status">
          Solicitud <strong>{decidida}</strong>{" "}
          {resultado === "rechazada" ? "rechazada" : "aprobada"} correctamente. Ya no aparece en
          la lista de pendientes.
        </div>
      )}

      {filas === null ? (
        <div className="panel">
          <div className="aviso err" role="alert">
            No se pudieron cargar las solicitudes pendientes. Intente nuevamente.
          </div>
          <ReintentarBtn />
        </div>
      ) : filas.length === 0 ? (
        <div className="panel vacio">No hay solicitudes pendientes</div>
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
                <th>Fecha de creación</th>
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
                  <td>{f.plazo_meses} {f.plazo_meses === 1 ? "mes" : "meses"}</td>
                  <td>{fechaLima(f.creada_en)}</td>
                  <td>
                    <Link href={`/solicitudes/${f.id}`}>Revisar</Link>
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