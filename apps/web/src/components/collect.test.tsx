import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../test/fakeApi';
import { testClient } from '../test/render';
import { ReceivableSheet } from './collect';

function renderUi(ui: ReactElement) {
  return { user: userEvent.setup(), ...render(<QueryClientProvider client={testClient()}>{ui}</QueryClientProvider>) };
}

describe('ReceivableSheet', () => {
  let fake: ReturnType<typeof installFakeApi>;
  beforeEach(() => {
    fake = installFakeApi();
  });

  it('«Ya pagó» registra el cobro total con un toque', async () => {
    const onClose = vi.fn();
    const { user } = renderUi(<ReceivableSheet receivableId="rcv_brisas" businessDate="2026-05-25" online onClose={onClose} />);
    expect(await screen.findByText('Hotel Brisas')).toBeInTheDocument();
    expect(screen.getByText('Debe $ 2.100.000 · vence jue 28 may')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ya pagó · Registrar $ 2,1 M' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fake.snapshot.receivables.find((r) => r.id === 'rcv_brisas')!.pendingAmount).toBe(0);
  });

  it('cobro parcial: el botón lo dice', async () => {
    const { user } = renderUi(<ReceivableSheet receivableId="rcv_brisas" businessDate="2026-05-25" online onClose={() => undefined} />);
    const input = await screen.findByLabelText('Monto (COP)');
    await user.clear(input);
    await user.type(input, '500000');
    await user.click(screen.getByRole('button', { name: 'Pagó una parte · Registrar $ 500 mil' }));
    await waitFor(() => expect(fake.snapshot.receivables.find((r) => r.id === 'rcv_brisas')!.pendingAmount).toBe(1_600_000));
  });

  it('«Paga otro día» mueve el vencimiento', async () => {
    const onClose = vi.fn();
    const { user } = renderUi(<ReceivableSheet receivableId="rcv_brisas" businessDate="2026-05-25" online onClose={onClose} />);
    await user.click(await screen.findByRole('button', { name: 'Paga otro día' }));
    await user.click(screen.getByRole('radio', { name: 'mar 2 jun' }));
    await user.click(screen.getByRole('button', { name: 'Mover a mar 2 jun' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fake.snapshot.receivables.find((r) => r.id === 'rcv_brisas')!.creditDueBy).toBe('2026-06-02');
    expect(fake.writes()[0]!.body).toMatchObject({ baseVersion: 1, newDueDate: '2026-06-02' });
  });

  it('sin red no permite guardar', async () => {
    renderUi(<ReceivableSheet receivableId="rcv_brisas" businessDate="2026-05-25" online={false} onClose={() => undefined} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
    expect(screen.getByRole('button', { name: /Ya pagó/ })).toBeDisabled();
  });
});
