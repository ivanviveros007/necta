import type { AlertEntity } from '@necta/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
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

/** Botón flotante + hoja inferior de ingreso o gasto. */
export function QuickEntry({ online, businessDate, onIsCollection }: { online: boolean; businessDate: string; onIsCollection: () => void }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <>
      <button type="button" className="fab" aria-label="Registrar ingreso o gasto" onClick={() => setOpen(true)}>
        +
      </button>
      <dialog ref={dialog} className="sheet" aria-label="Registrar ingreso o gasto" onClose={() => setOpen(false)}>
        {open && (
          <>
            <div className="sheet-header">
              <h2>Registrar</h2>
              <button type="button" className="link" onClick={() => setOpen(false)}>
                Cerrar
              </button>
            </div>
            <MovementForm
              online={online}
              businessDate={businessDate}
              onDone={() => setOpen(false)}
              onIsCollection={() => {
                setOpen(false);
                onIsCollection();
              }}
            />
          </>
        )}
      </dialog>
    </>
  );
}

export function AppShell({
  storeName,
  userName,
  onLogout,
  banners,
  children,
  fab,
}: {
  storeName: string;
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
