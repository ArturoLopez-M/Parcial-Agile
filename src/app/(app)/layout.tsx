import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { Marca } from "@/components/Logo";
import { ETIQUETA_ROL, usuarioActual } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await usuarioActual();
  if (!user) redirect("/login");

  return (
    <>
      <header className="topbar">
        <Link href="/" className="marca" style={{ textDecoration: "none" }} aria-label="ALGARROBO — inicio">
          <Marca size={38} />
        </Link>
        <nav>
          <Link href="/clientes">Clientes</Link>
          {user.rol !== "administrador" && <Link href="/clientes/nuevo">Registrar cliente</Link>}
          {user.rol !== "agente" && <Link href="/solicitudes/pendientes">Solicitudes pendientes</Link>}
          {user.rol !== "agente" && <Link href="/solicitudes/historial">Historial de solicitudes</Link>}
        </nav>
        <div className="quien">
          <Link href="/cuenta" title="Mi cuenta y contraseña" style={{ display: "flex", alignItems: "center", gap: 12, color: "inherit", textDecoration: "none" }}>
            <span className="avatar">{user.nombre.charAt(0).toUpperCase()}</span>
            <span className="datos">
              <strong>{user.nombre}</strong>
              <small>
                {ETIQUETA_ROL[user.rol]} · {user.agencia ?? "Todas las agencias"}
              </small>
            </span>
          </Link>
          <form action={logout}>
            <button type="submit">Cerrar sesión</button>
          </form>
        </div>
      </header>
      <main className="contenido">{children}</main>
    </>
  );
}
