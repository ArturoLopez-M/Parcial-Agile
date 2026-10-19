"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function FiltrosDashboard({
  agencias,
  agencia,
  desde,
  hasta,
}: {
  agencias: { id: number; nombre: string }[];
  agencia: string;
  desde: string;
  hasta: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Al cambiar cualquier filtro se actualizan los indicadores automáticamente.
  function aplicar(form: HTMLFormElement) {
    const f = new FormData(form);
    const p = new URLSearchParams();
    for (const k of ["agencia", "desde", "hasta"]) {
      const v = String(f.get(k) ?? "");
      if (v) p.set(k, v);
    }
    const qs = p.toString();
    start(() => router.replace(qs ? `/dashboard?${qs}` : "/dashboard"));
  }

  const hayFiltros = agencia !== "" || desde !== "" || hasta !== "";

  return (
    <form className="panel" onChange={(e) => aplicar(e.currentTarget)} aria-busy={pending}>
      <div className="grid">
        <div className="campo">
          <label htmlFor="agencia">Agencia</label>
          <select id="agencia" name="agencia" defaultValue={agencia}>
            <option value="">Todas las agencias</option>
            {agencias.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="desde">Desde</label>
          <input id="desde" name="desde" type="date" defaultValue={desde} />
        </div>
        <div className="campo">
          <label htmlFor="hasta">Hasta</label>
          <input id="hasta" name="hasta" type="date" defaultValue={hasta} />
        </div>
      </div>
      {hayFiltros && (
        <div className="acciones">
          <Link href="/dashboard" className="btn sec">
            Limpiar filtros
          </Link>
        </div>
      )}
    </form>
  );
}