import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/session";
import ClienteForm from "./ClienteForm";

export const metadata = { title: "Registrar cliente — ALGARROBO" };

export default async function NuevoClientePage() {
  const user = await usuarioActual();
  if (!user) redirect("/login");
    if (user.rol !== "agente") redirect("/clientes"); // solo el agente registra clientes
  return (
    <>
      <h1>Registrar cliente</h1>
      <ClienteForm />
    </>
  );
}
