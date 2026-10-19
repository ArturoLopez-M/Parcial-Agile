import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/session";

export default async function Inicio() {
  const user = await usuarioActual();
  if (!user) redirect("/login");
    if (user.rol === "dueno") redirect("/dashboard");
  redirect(user.rol === "agente" ? "/clientes" : "/solicitudes/pendientes");
}
