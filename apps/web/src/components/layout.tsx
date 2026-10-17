import type { AlertEntity } from '@necta/contracts';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { Sheet, SheetHeader } from './collect';
import { MovementForm } from './forms';

export function OfflineBanner({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <div className="banner offline" role="alert">
      <span aria-hidden="true">⚠ </span>Sin conexión. La web necesita internet para guardar; tus formularios se conservan mientras no cierres la página.
    </div>
  );
}

export function AlertBanner({ alerts, onAcknowledge }: { alerts: AlertEntity[]; onAcknowledge?: (id: string) => void }) {
  const active = alerts.filter((a) => a.status === 'active' && !a.acknowledgedAt);
  if (active.length === 0) return null;
  return (
    <div className="banner alert" role="alert">
      {active.map((a) => (
        <div key={a.id} className="alert-row">
          <span>
            <span aria-hidden="true">🔔 </span>
            <strong>Aviso:</strong> {a.headline}
          </span>
          {onAcknowledge && (
            <button type="button" className="link" onClick={() => onAcknowledge(a.id)}>
              Entendido
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Botón flotante + hoja inferior: gasto, ingreso o cobro. */
export function QuickEntry({ online, businessDate }: { online: boolean; businessDate: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fab" aria-label="Registrar" onClick={() => setOpen(true)}>
        +
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Registrar">
        <SheetHeader title="Registrar" onClose={() => setOpen(false)} />
        <MovementForm online={online} businessDate={businessDate} onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

export function AppShell({
  storeName,
  dateBadge,
  userName,
  onLogout,
  banners,
  children,
  fab,
}: {
  storeName: string;
  /** Marca visible cuando la fecha de negocio es simulada (demo del caso). */
  dateBadge?: string;
  userName: string;
  onLogout: () => void;
  banners: ReactNode;
  children: ReactNode;
  fab: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <strong>{storeName}</strong>
          <span className="muted"> · {userName}</span>
          {dateBadge ? (
            <span className="date-badge" title="La API usa una fecha fija para reproducir el caso">
              {dateBadge}
            </span>
          ) : null}
        </div>
        <nav aria-label="Secciones">
          <NavLink to="/" end>
            Inicio
          </NavLink>
          <NavLink to="/detalle">Detalle</NavLink>
          <NavLink to="/registrar">Registrar</NavLink>
          <NavLink to="/compromisos">Pagos fijos</NavLink>
        </nav>
        <button type="button" className="link" onClick={onLogout}>
          Salir
        </button>
      </header>
      {banners}
      <main>{children}</main>
      {fab}
    </div>
  );
}
