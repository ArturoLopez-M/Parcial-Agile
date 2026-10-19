import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { usuarioActual } from "@/lib/session";
import ReintentarBtn from "@/components/ReintentarBtn";
import ContactoForm from "./ContactoForm";

export const metadata = { title: "Detalle de cliente — ALGARROBO" };

type Cliente = {
  id: number;
  codigo: string;
  tipo: "persona" | "empresa";
  nombres: string | null;
  apellidos: string | null;
  dni: string | null;
  razon_social: string | null;
  ruc: string | null;
  rep_nombres: string | null;
  rep_apellidos: string | null;
  rep_dni: string | null;
  telefono: string;
  correo: string;
  direccion: string;
  agencia: string;
  creado_en: Date;
  estado: string;
};

function Bloqueado({ id, label, valor }: { id: string; label: string; valor: string }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={valor} readOnly aria-readonly="true" />
    </div>
  );
}

export default async function ClienteDetalle({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ registrado?: string; solicitud?: string }>;
}) {
  const user = await usuarioActual();
  const esAgente = user?.rol === "agente";
  const { id: idParam } = await params;
  const { registrado, solicitud } = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let c: Cliente | undefined;
  try {
    const rows = await query<Cliente>(
      `SELECT c.*, a.nombre AS agencia
         FROM clientes c JOIN agencias a ON a.id = c.agencia_id
        WHERE c.id = $1`,
      [id],
    );
    c = rows[0];
  } catch (err) {
    console.error("detalle cliente:", err);
    return (
      <div className="panel">
        <div className="aviso err" role="alert">
          No se pudo cargar el cliente. Intente nuevamente.
        </div>
        <ReintentarBtn />
      </div>
    );
  }
  if (!c) notFound();

  const esPersona = c.tipo === "persona";
  const puedeCrearSolicitud = esAgente && c.estado === "En Orden";

  return (
    <>
      <h1>
        {esPersona ? `${c.apellidos} ${c.nombres}` : c.razon_social}{" "}
        <span className="badge">{c.codigo}</span>
      </h1>
      <p className="sub">
        {esPersona ? "Persona natural" : "Empresa"} · Registrado en agencia {c.agencia} el{" "}
        {new Date(c.creado_en).toLocaleDateString("es-PE", { timeZone: "America/Lima" })}
      </p>

      {/* Badge de estado */}
      <div style={{ marginBottom: 16 }}>
        <span
          className="badge"
          style={{
            background:
              c.estado === "En Orden"
                ? "#d1fae5"
                : c.estado === "Moroso"
                ? "#ffedd5"
                : "#fee2e2",
            color:
              c.estado === "En Orden"
                ? "#065f46"
                : c.estado === "Moroso"
                ? "#9a3412"
                : "#991b1b",
            fontSize: 13,
            padding: "4px 14px",
          }}
        >
          {c.estado}
        </span>
      </div>

      {/* Aviso si no puede pedir préstamos */}
      {esAgente && c.estado !== "En Orden" && (
        <div className="aviso err" role="alert">
          Este cliente tiene estado <strong>{c.estado}</strong> y no puede solicitar préstamos.
        </div>
      )}

      {registrado === "1" && (
        <div className="aviso ok" role="status">
          Cliente registrado correctamente con el código <strong>{c.codigo}</strong>.
        </div>
      )}

      {solicitud && (
        <div className="aviso ok" role="status">
          Solicitud creada correctamente con el código <strong>{solicitud}</strong>. Quedó en
          estado Pendiente.
        </div>
      )}

      <div className="panel">
        <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Datos del cliente (bloqueados)</h2>
        <div className="grid">
          <Bloqueado id="codigo" label="Código de cliente" valor={c.codigo} />
          {esPersona ? (
            <>
              <Bloqueado id="nombres" label="Nombres" valor={c.nombres ?? ""} />
              <Bloqueado id="apellidos" label="Apellidos" valor={c.apellidos ?? ""} />
              <Bloqueado id="dni" label="DNI" valor={c.dni ?? ""} />
            </>
          ) : (
            <>
              <Bloqueado id="razon" label="Razón social" valor={c.razon_social ?? ""} />
              <Bloqueado id="ruc" label="RUC" valor={c.ruc ?? ""} />
            </>
          )}
          <Bloqueado id="direccion" label="Dirección" valor={c.direccion} />
        </div>
      </div>

      {!esPersona && (
        <div className="panel">
          <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Representante legal (bloqueado)</h2>
          <div className="grid">
            <Bloqueado id="rn" label="Nombres" valor={c.rep_nombres ?? ""} />
            <Bloqueado id="ra" label="Apellidos" valor={c.rep_apellidos ?? ""} />
            <Bloqueado id="rd" label="DNI" valor={c.rep_dni ?? ""} />
          </div>
        </div>
      )}

      <div className="panel">
        <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>
          {esAgente ? "Contacto (editable)" : "Contacto"}
        </h2>
        {esAgente ? (
          <ContactoForm id={c.id} telefono={c.telefono} correo={c.correo} />
        ) : (
          <div className="grid">
            <Bloqueado id="tel" label="Teléfono" valor={c.telefono} />
            <Bloqueado id="cor" label="Correo electrónico" valor={c.correo} />
          </div>
        )}
      </div>

      <div className="acciones">
        {puedeCrearSolicitud && (
          <Link className="btn" href={`/clientes/${c.id}/solicitud`}>
            Crear solicitud
          </Link>
        )}
        <Link className="btn sec" href="/clientes">
          Volver a la lista
        </Link>
      </div>
    </>
  );
}