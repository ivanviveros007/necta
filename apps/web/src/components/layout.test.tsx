import type { AlertEntity } from '@necta/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllDrafts } from '../hooks/useDraft';
import { installFakeApi } from '../test/fakeApi';
import { testClient } from '../test/render';
import { AlertBanner, AppShell, OfflineBanner, QuickEntry } from './layout';

const alert: AlertEntity = {
  id: 'a1',
  storeId: 'store_limpia_ya',
  dedupKey: 'k',
  kind: 'shortfall',
  scenario: 'expected',
  severity: 'short',
  shortfallDate: '2026-06-01',
  amount: 590_000,
  headline: 'Te faltan $ 590.000 el lunes 1 de junio',
  detail: 'detalle',
  status: 'active',
  acknowledgedAt: null,
  notifiedCount: 1,
  createdAt: '2026-05-25T12:00:00.000Z',
  updatedAt: '2026-05-25T12:00:00.000Z',
};

describe('OfflineBanner', () => {
  it('solo aparece sin conexión', () => {
    const { rerender } = render(<OfflineBanner online />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<OfflineBanner online={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión');
  });
});

describe('AlertBanner', () => {
  it('muestra alertas activas no leídas y permite marcarlas', async () => {
    const onAck = vi.fn();
    render(<AlertBanner alerts={[alert, { ...alert, id: 'a2', status: 'resolved' }]} onAcknowledge={onAck} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Aviso: Te faltan $ 590.000 el lunes 1 de junio');
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(onAck).toHaveBeenCalledWith('a1');
  });

  it('nada si no hay alertas activas', () => {
    const { container } = render(<AlertBanner alerts={[{ ...alert, acknowledgedAt: 'x' }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('QuickEntry (FAB + hoja inferior)', () => {
  beforeEach(() => {
    installFakeApi();
    clearAllDrafts();
  });

  it('abre el formulario de ingreso/gasto y lo cierra al guardar', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={testClient()}>
        <QuickEntry online businessDate="2026-05-25" onIsCollection={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText('Monto (COP)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar ingreso o gasto' }));
    await user.type(screen.getByLabelText('Monto (COP)'), '45000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(screen.queryByLabelText('Monto (COP)')).not.toBeInTheDocument());
  });

  it('se puede cerrar sin guardar', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={testClient()}>
        <QuickEntry online businessDate="2026-05-25" onIsCollection={() => undefined} />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Registrar ingreso o gasto' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByLabelText('Monto (COP)')).not.toBeInTheDocument();
  });
});

describe('AppShell', () => {
  it('muestra tienda, navegación y salir', async () => {
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <AppShell storeName="Limpia Ya" userName="Carmen Ortiz" onLogout={onLogout} banners={<p>banner</p>} fab={<button>fab</button>}>
          <p>contenido</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText('Limpia Ya')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Secciones' })).toHaveTextContent('InicioDetalleRegistrarPagos fijos');
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onLogout).toHaveBeenCalled();
  });
});
