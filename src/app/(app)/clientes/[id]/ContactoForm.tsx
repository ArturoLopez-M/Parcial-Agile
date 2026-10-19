"use client";

import { useState, useTransition } from "react";
import { actualizarContacto } from "@/app/actions/clientes";
import { validarContacto, type Errores } from "@/lib/validators";

export default function ContactoForm({
  id,
  telefono,
  correo,
}: {
  id: number;
  telefono: string;
  correo: string;
}) {
  const [guardado, setGuardado] = useState({ telefono, correo });
  const [v, setV] = useState({ telefono, correo });
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pending, start] = useTransition();

  function cambiar(name: "telefono" | "correo", valor: string) {
    const limpio = name === "telefono" ? valor.replace(/\D/g, "") : valor;
    setV((p) => ({ ...p, [name]: limpio }));
    setErrores((p) => ({ ...p, [name]: "" }));
    setAviso(null);
  }

  function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    const errs = validarContacto(v.telefono.trim(), v.correo.trim().toLowerCase());
    setErrores(errs);
    if (Object.keys(errs).length > 0) return;
    setConfirmando(true);
  }

  function cancelar() {
    // Al cancelar se conservan los datos originales.
    setConfirmando(false);
    setV(guardado);
    setErrores({});
  }

  function confirmar() {
    start(async () => {
      const r = await actualizarContacto(id, v.telefono, v.correo);
      setConfirmando(false);
      if (r?.ok) {
        const nuevo = { telefono: r.telefono ?? v.telefono, correo: r.correo ?? v.correo };
        setGuardado(nuevo);
        setV(nuevo);
        setAviso({ ok: true, texto: r.mensaje ?? "Datos actualizados." });
      } else {
        if (r?.errores) setErrores(r.errores);
        setAviso({ ok: false, texto: r?.mensaje ?? "Revise los campos marcados." });
      }
    });
  }

  return (
    <form onSubmit={alEnviar} noValidate>
      {aviso && (
        <div className={`aviso ${aviso.ok ? "ok" : "err"}`} role={aviso.ok ? "status" : "alert"}>
          {aviso.texto}
        </div>
      )}
      <div className="grid">
        <div className="campo">
          <label htmlFor="telefono">Teléfono *</label>
          <input
            id="telefono"
            name="telefono"
            inputMode="tel"
            maxLength={9}
            value={v.telefono}
            onChange={(e) => cambiar("telefono", e.target.value)}
            className={errores.telefono ? "invalido" : ""}
            autoComplete="off"
          />
          {errores.telefono && <span className="error">{errores.telefono}</span>}
        </div>
        <div className="campo">
          <label htmlFor="correo">Correo electrónico *</label>
          <input
            id="correo"
            name="correo"
            type="email"
            maxLength={120}
            value={v.correo}
            onChange={(e) => cambiar("correo", e.target.value)}
            className={errores.correo ? "invalido" : ""}
            autoComplete="off"
          />
          {errores.correo && <span className="error">{errores.correo}</span>}
        </div>
      </div>
      <div className="acciones">
        <button className="btn sec" type="submit" disabled={pending}>
          Guardar teléfono y correo
        </button>
      </div>

      {confirmando && (
        <div className="modal-fondo" role="dialog" aria-modal="true" aria-labelledby="conf-contacto">
          <div className="modal">
            <h2 id="conf-contacto">Confirmar cambios</h2>
            <p>¿Está seguro de guardar los nuevos datos de contacto?</p>
            <div className="acciones">
              <button className="btn" type="button" onClick={confirmar} disabled={pending}>
                {pending ? "Guardando…" : "Sí, guardar"}
              </button>
              <button className="btn sec" type="button" onClick={cancelar} disabled={pending}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}