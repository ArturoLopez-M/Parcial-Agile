import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { usuarioActual } from "@/lib/session";
import ReintentarBtn from "@/components/ReintentarBtn";
import { soles } from "@/lib/formato";
import FiltrosDashboard from "./FiltrosDashboard";

export const metadata = { title: "Dashboard — ALGARROBO" };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

type Resumen = {
  clientes: number;
  pendientes: number;
  aprobadas: number;
  rechazadas: number;
  solicitado: string;
  aprobado: string;
};

type PorAgencia = {
  id: number;
  nombre: string;
  clientes: number;
  pendientes: number;
  aprobadas: number;
  rechazadas: number;
  solicitado: string;
  aprobado: string;
};

function Indicador({ titulo, valor }: { titulo: string; valor: string | number }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>{titulo}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{valor}</div>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ agencia?: string; desde?: string; hasta?: string }>;
}) {
  const user = await usuarioActual();
  if (!user) redirect("/login");
  if (user.rol !== "dueno") redirect("/");

  const sp = await searchParams;
  const desde = FECHA_RE.test(sp.desde ?? "") ? (sp.desde as string) : "";
  const hasta = FECHA_RE.test(sp.hasta ?? "") ? (sp.hasta as string) : "";
  const rangoInvalido = desde !== "" && hasta !== "" && desde > hasta;

  let agencias: { id: number; nombre: string }[] = [];
  let resumen: Resumen | null = null;
  let porAgencia: PorAgencia[] = [];
  let error = false;

  try {
    agencias = await query<{ id: number; nombre: string }>(
      "SELECT id, nombre FROM agencias ORDER BY nombre",
    );
    const agenciaId = agencias.find((a) => String(a.id) === sp.agencia)?.id ?? null;

    if (!rangoInvalido) {
      // Fechas en hora de Lima. Clientes: fecha de registro; solicitudes: fecha de creación.
      const fcli = (d: string, h: string) => `($${d}::date IS NULL OR (c.creado_en AT TIME ZONE 'America/Lima')::date >= $${d}::date)
                AND ($${h}::date IS NULL OR (c.creado_en AT TIME ZONE 'America/Lima')::date <= $${h}::date)`;
      const fsol = (d: string, h: string) => `($${d}::date IS NULL OR (s.creada_en AT TIME ZONE 'America/Lima')::date >= $${d}::date)
                AND ($${h}::date IS NULL OR (s.creada_en AT TIME ZONE 'America/Lima')::date <= $${h}::date)`;

      const [r] = await query<Resumen>(
        `SELECT
           (SELECT COUNT(*) FROM clientes c
             WHERE ($1::int IS NULL OR c.agencia_id = $1::int) AND ${fcli("2", "3")})::int AS clientes,
           COUNT(*) FILTER (WHERE s.estado = 'Pendiente')::int AS pendientes,
           COUNT(*) FILTER (WHERE s.estado = 'Aprobada')::int AS aprobadas,
           COUNT(*) FILTER (WHERE s.estado = 'Rechazada')::int AS rechazadas,
           COALESCE(SUM(s.monto), 0) AS solicitado,
           COALESCE(SUM(s.monto) FILTER (WHERE s.estado = 'Aprobada'), 0) AS aprobado
         FROM solicitudes s
         WHERE ($1::int IS NULL OR s.agencia_id = $1::int) AND ${fsol("2", "3")}`,
        [agenciaId, desde || null, hasta || null],
      );
      resumen = r;

      // Comparación: todas las agencias (solo depende del rango de fechas).
      porAgencia = await query<PorAgencia>(
        `SELECT a.id, a.nombre,
                (SELECT COUNT(*) FROM clientes c WHERE c.agencia_id = a.id AND ${fcli("1", "2")})::int AS clientes,
                COUNT(s.id) FILTER (WHERE s.estado = 'Pendiente')::int AS pendientes,
                COUNT(s.id) FILTER (WHERE s.estado = 'Aprobada')::int AS aprobadas,
                COUNT(s.id) FILTER (WHERE s.estado = 'Rechazada')::int AS rechazadas,
                COALESCE(SUM(s.monto), 0) AS solicitado,
                COALESCE(SUM(s.monto) FILTER (WHERE s.estado = 'Aprobada'), 0) AS aprobado
           FROM agencias a
           LEFT JOIN solicitudes s ON s.agencia_id = a.id AND ${fsol("1", "2")}
          GROUP BY a.id, a.nombre
          ORDER BY a.nombre`,
        [desde || null, hasta || null],
      );
    }
  } catch (err) {
    console.error("dashboard:", err);
    error = true;
  }

  const agSel = agencias.find((a) => String(a.id) === sp.agencia);
  const maxAprobado = Math.max(0, ...porAgencia.map((p) => Number(p.aprobado)));

  return (
    <>
      <h1>Dashboard de indicadores</h1>
      <p className="sub">
        {agSel ? `Agencia ${agSel.nombre}` : "Todas las agencias"}
        {desde || hasta ? ` · ${desde || "inicio"} a ${hasta || "hoy"}` : " · todo el período"}
      </p>

      <FiltrosDashboard
        agencias={agencias}
        agencia={agSel ? String(agSel.id) : ""}
        desde={desde}
        hasta={hasta}
      />

      {rangoInvalido ? (
        <div className="aviso err" role="alert">
          La fecha «desde» no puede ser posterior a la fecha «hasta».
        </div>
      ) : error || !resumen ? (
        <div className="panel">
          <div className="aviso err" role="alert">
            No se pudieron cargar los indicadores. Intente nuevamente.
          </div>
          <ReintentarBtn />
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <Indicador titulo="Total de clientes" valor={resumen.clientes} />
            <Indicador titulo="Solicitudes pendientes" valor={resumen.pendientes} />
            <Indicador titulo="Solicitudes aprobadas" valor={resumen.aprobadas} />
            <Indicador titulo="Solicitudes rechazadas" valor={resumen.rechazadas} />
            <Indicador titulo="Monto total solicitado" valor={soles(resumen.solicitado)} />
            <Indicador titulo="Monto total aprobado" valor={soles(resumen.aprobado)} />
          </div>

          <h2 style={{ fontSize: 18, margin: "24px 0 8px" }}>Comparación entre agencias</h2>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Agencia</th>
                  <th>Clientes</th>
                  <th>Pendientes</th>
                  <th>Aprobadas</th>
                  <th>Rechazadas</th>
                  <th>Monto solicitado</th>
                  <th>Monto aprobado</th>
                </tr>
              </thead>
              <tbody>
                {porAgencia.map((p) => (
                  <tr key={p.id} style={agSel?.id === p.id ? { fontWeight: 700 } : undefined}>
                    <td>{p.nombre}</td>
                    <td>{p.clientes}</td>
                    <td>{p.pendientes}</td>
                    <td>{p.aprobadas}</td>
                    <td>{p.rechazadas}</td>
                    <td>{soles(p.solicitado)}</td>
                    <td>
                      {soles(p.aprobado)}
                      <div
                        aria-hidden="true"
                        style={{
                          height: 6,
                          borderRadius: 3,
                          marginTop: 6,
                          background: "#0f4c81",
                          width: maxAprobado > 0 ? `${(Number(p.aprobado) / maxAprobado) * 100}%` : 0,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}