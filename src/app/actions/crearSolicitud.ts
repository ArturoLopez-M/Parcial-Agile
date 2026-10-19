"use server";

import { redirect } from "next/navigation";
import { withTransaction } from "@/lib/db";
import { usuarioActual } from "@/lib/session";
import {
  LIMITE_CLIENTE,
  TASA_MENSUAL,
  normalizarSolicitud,
  parseMonto,
  validarSolicitud,
  type SolicitudInput,
} from "@/lib/reglas";
import { soles } from "@/lib/formato";
import type { Errores } from "@/lib/validators";

export type SolicitudResultado =
  | { ok: false; errores?: Errores; mensaje?: string }
  | undefined;

type Salida =
  | { tipo: "ok"; codigo: string }
  | { tipo: "limite"; disponible: number }
  | { tipo: "noexiste" };

export async function crearSolicitud(
  clienteId: number,
  entrada: SolicitudInput,
): Promise<SolicitudResultado> {
  const user = await usuarioActual();
  if (!user) redirect("/login");
    if (user.rol !== "agente" || !user.agenciaId) {
    return { ok: false, mensaje: "Solo el agente puede crear solicitudes." };
  
  }
  if (!Number.isInteger(clienteId) || clienteId <= 0) {
    return { ok: false, mensaje: "Cliente no válido." };
  }

  const datos = normalizarSolicitud(entrada);
  const errores = validarSolicitud(datos);
  if (Object.keys(errores).length > 0) return { ok: false, errores };

  const monto = parseMonto(datos.monto)!;
  const plazo = Number(datos.plazo); 

  let salida: Salida;
  try {
    salida = await withTransaction<Salida>(async (q) => {
      // Bloquea al cliente: serializa solicitudes simultáneas y evita pasarse del límite.
      const c = await q<{ telefono: string; correo: string }>(
        "SELECT telefono, correo FROM clientes WHERE id = $1 FOR UPDATE",
        [clienteId],
      );
      if (!c[0]) return { tipo: "noexiste" };

      const lim = await q<{ excede: boolean; disponible: string }>(
        `SELECT $2::numeric > ($3::numeric - COALESCE(SUM(monto), 0)) AS excede,
                ($3::numeric - COALESCE(SUM(monto), 0)) AS disponible
           FROM solicitudes
          WHERE cliente_id = $1 AND estado IN ('Pendiente','Aprobada')`,
        [clienteId, monto, LIMITE_CLIENTE],
      );
      if (lim[0].excede) {
        return { tipo: "limite", disponible: Math.max(0, Number(lim[0].disponible)) };
      }

const ins = await q<{ codigo: string }>(
  `INSERT INTO solicitudes
     (cliente_id, agencia_id, monto, plazo_meses, tasa_mensual, finalidad, observaciones,
      telefono, correo, creado_por)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
   RETURNING codigo`,
  [
    clienteId,
    user.agenciaId,
    monto,
    plazo,
    TASA_MENSUAL,
    datos.finalidad,
    datos.observaciones || null,
    c[0].telefono,
    c[0].correo,
    user.id,
  ],
);
      return { tipo: "ok", codigo: ins[0].codigo };
    });
  } catch (err) {
    console.error("crearSolicitud:", err);
    return { ok: false, mensaje: "No se pudo crear la solicitud por un error del sistema. Intente de nuevo." };
  }

  if (salida.tipo === "noexiste") return { ok: false, mensaje: "El cliente ya no existe." };
  if (salida.tipo === "limite") {
    return {
      ok: false,
      errores: {
        monto: `El monto supera el límite disponible del cliente (${soles(salida.disponible)}).`,
      },
    };
  }
  redirect(`/clientes/${clienteId}?solicitud=${salida.codigo}`);
}