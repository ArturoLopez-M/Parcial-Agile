import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { limiteCliente, type LimiteCliente } from "@/lib/limite";
import { soles } from "@/lib/formato";
import { usuarioActual } from "@/lib/session";
import ReintentarBtn from "@/components/ReintentarBtn";
import SolicitudForm from "./SolicitudForm";

export const metadata = { title: "Crear solicitud — ALGARROBO" };

type Cli = {
  id: number;
  codigo: string;
  tipo: "persona" | "empresa";
  nombre: string;
  documento: string;
  telefono: string;
  correo: string;
};

export default async function NuevaSolicitud({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

    const user = await usuarioActual();
  if (!user || user.rol !== "agente") redirect("/clientes"); // solo el agente crea solicitudes

  let c: Cli | undefined;
  let lim: LimiteCliente;
  try {
    const rows = await query<Cli>(
      `SELECT id, codigo, tipo,
              CASE WHEN tipo = 'persona' THEN apellidos || ' ' || nombres ELSE razon_social END AS nombre,
              COALESCE(dni, ruc) AS documento, telefono, correo
         FROM clientes WHERE id = $1`,
      [id],
    );
    c = rows[0];
    lim = await limiteCliente(id);
  } catch (err) {
    console.error("nueva solicitud:", err);
    return (
      <div className="panel">
        <div className="aviso err" role="alert">
          No se pudo cargar la información del cliente. Intente nuevamente.
        </div>
        <ReintentarBtn />
      </div>
    );
  }
  if (!c) notFound();

  const sinAgencia = !user?.agenciaId;

  return (
    <>
      <h1>
        Crear solicitud de préstamo <span className="badge">{c.codigo}</span>
      </h1>
      <p className="sub">
        {c.nombre} · {c.tipo === "persona" ? "DNI" : "RUC"} {c.documento}
      </p>

      <div className="panel">
        <h2>Límite del cliente</h2>
        <dl className="detalle">
          <div>
            <dt>Límite máximo</dt>
            <dd>{soles(lim.limite)}</dd>
          </div>
          <div>
            <dt>Reservado (pendientes y aprobadas)</dt>
            <dd>{soles(lim.reservado)}</dd>
          </div>
          <div>
            <dt>Disponible</dt>
            <dd>
              <strong>{soles(lim.disponible)}</strong>
            </dd>
          </div>
        </dl>
      </div>

      {sinAgencia ? (
        <div className="aviso warn" role="alert">
          Su usuario no está asociado a una agencia. Ingrese con un usuario de agencia para crear solicitudes.
        </div>
      ) : lim.disponible <= 0 ? (
        <div className="aviso warn" role="alert">
          El cliente ya alcanzó su límite de {soles(lim.limite)}. No se pueden crear más solicitudes
          hasta que se libere capital.
        </div>
      ) : (
        <SolicitudForm clienteId={c.id} disponible={lim.disponible} />
      )}

      <div className="acciones">
        <Link className="btn sec" href={`/clientes/${c.id}`}>
          Volver al cliente
        </Link>
      </div>
    </>
  );
}