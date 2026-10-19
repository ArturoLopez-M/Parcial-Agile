"use server";

import { redirect } from "next/navigation";
import { query, withTransaction } from "@/lib/db";
import { usuarioActual } from "@/lib/session";
import {
  type ClienteInput,
  type Errores,
  normalizarCliente,
  validarCliente,
  validarContacto,
} from "@/lib/validators";

export type ClienteExistente = {
  id: number;
  codigo: string;
  tipo: "persona" | "empresa";
  nombre: string;
  documento: string;
};

export type RegistroResultado =
  | { ok: false; errores?: Errores; existente?: ClienteExistente; mensaje?: string }
  | undefined;

type Fila = {
  id: number;
  codigo: string;
  tipo: "persona" | "empresa";
  nombres: string | null;
  apellidos: string | null;
  dni: string | null;
  razon_social: string | null;
  ruc: string | null;
};

function aExistente(f: Fila): ClienteExistente {
  return {
    id: f.id,
    codigo: f.codigo,
    tipo: f.tipo,
    nombre: f.tipo === "persona" ? `${f.apellidos} ${f.nombres}` : (f.razon_social ?? ""),
    documento: (f.tipo === "persona" ? f.dni : f.ruc) ?? "",
  };
}

async function buscarDuplicado(i: ClienteInput): Promise<ClienteExistente | null> {
  const rows =
    i.tipo === "persona"
      ? await query<Fila>(
          "SELECT id,codigo,tipo,nombres,apellidos,dni,razon_social,ruc FROM clientes WHERE dni = $1",
          [i.dni],
        )
      : await query<Fila>(
          "SELECT id,codigo,tipo,nombres,apellidos,dni,razon_social,ruc FROM clientes WHERE ruc = $1",
          [i.ruc],
        );
  return rows[0] ? aExistente(rows[0]) : null;
}

export async function registrarCliente(entrada: ClienteInput): Promise<RegistroResultado> {
  const user = await usuarioActual();
  if (!user) redirect("/login");
    if (user.rol !== "agente") {
    return { ok: false, mensaje: "Solo el agente puede registrar clientes." };
  }

  const datos = normalizarCliente(entrada);
  const errores = validarCliente(datos);
  if (Object.keys(errores).length > 0) return { ok: false, errores };

  let nuevoId: number;
  try {
    const dup = await buscarDuplicado(datos);
    if (dup) return { ok: false, existente: dup };

    const esPersona = datos.tipo === "persona";
    const rows = await query<{ id: number }>(
      `INSERT INTO clientes
         (tipo, nombres, apellidos, dni, razon_social, ruc,
          rep_nombres, rep_apellidos, rep_dni,
          telefono, correo, direccion, agencia_id, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        datos.tipo,
        esPersona ? datos.nombres : null,
        esPersona ? datos.apellidos : null,
        esPersona ? datos.dni : null,
        esPersona ? null : datos.razonSocial,
        esPersona ? null : datos.ruc,
        esPersona ? null : datos.repNombres,
        esPersona ? null : datos.repApellidos,
        esPersona ? null : datos.repDni,
        datos.telefono,
        datos.correo,
        datos.direccion,
        user.agenciaId,
        user.id,
      ],
    );
    nuevoId = rows[0].id;
  } catch (err) {
    // 23505 = violación de unicidad (registro simultáneo del mismo DNI/RUC).
    if ((err as { code?: string }).code === "23505") {
      const dup = await buscarDuplicado(datos).catch(() => null);
      if (dup) return { ok: false, existente: dup };
    }
    console.error("registrarCliente:", err);
    return { ok: false, mensaje: "No se pudo registrar el cliente por un error del sistema. Intente de nuevo." };
  }
  redirect(`/clientes/${nuevoId}?registrado=1`);
}

export type ContactoState =
  | { ok?: boolean; errores?: Errores; mensaje?: string; telefono?: string; correo?: string }
  | undefined;

export async function actualizarContacto(
  id: number,
  telefonoIn: string,
  correoIn: string,
): Promise<ContactoState> {
  const user = await usuarioActual();
  if (!user) redirect("/login");
  if (user.rol !== "agente") {
    return { ok: false, mensaje: "Solo el agente puede modificar clientes." };
  }

  const telefono = telefonoIn.trim();
  const correo = correoIn.trim().toLowerCase();
  const errores = validarContacto(telefono, correo);
  if (Object.keys(errores).length > 0) return { ok: false, errores, telefono, correo };

  try {
    const resultado = await withTransaction(async (q) => {
      const actual = await q<{ telefono: string; correo: string }>(
        "SELECT telefono, correo FROM clientes WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (actual.length === 0) return "no-existe" as const;
      if (actual[0].telefono === telefono && actual[0].correo === correo) return "sin-cambios" as const;

      // Solo se actualiza la tabla clientes: las solicitudes existentes no se tocan.
      await q("UPDATE clientes SET telefono = $1, correo = $2 WHERE id = $3", [telefono, correo, id]);
      await q(
        `INSERT INTO clientes_modificaciones
           (cliente_id, usuario_id, telefono_anterior, correo_anterior, telefono_nuevo, correo_nuevo)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, user.id, actual[0].telefono, actual[0].correo, telefono, correo],
      );
      return "ok" as const;
    });

    if (resultado === "no-existe") return { ok: false, mensaje: "El cliente ya no existe.", telefono, correo };
    if (resultado === "sin-cambios") return { ok: false, mensaje: "No hay cambios que guardar.", telefono, correo };
  } catch (err) {
    console.error("actualizarContacto:", err);
    return { ok: false, mensaje: "No se pudo guardar. Intente de nuevo.", telefono, correo };
  }
  return { ok: true, mensaje: "Teléfono y correo actualizados.", telefono, correo };
}