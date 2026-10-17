import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAllDrafts } from '../hooks/useDraft';
import { installFakeApi, setOnline } from '../test/fakeApi';
import { testClient } from '../test/render';
import { CollectionForm, CommitmentForm, MovementForm, parseAmount, PaymentForm, SaleForm } from './forms';

function renderForm(ui: ReactElement) {
  clearAllDrafts();
  const user = userEvent.setup();
  return { user, ...render(<QueryClientProvider client={testClient()}>{ui}</QueryClientProvider>) };
}

const props = { online: true, businessDate: '2026-05-25' };

describe('parseAmount', () => {
  it('acepta puntos de miles y descarta texto', () => {
    expect(parseAmount('45.000')).toBe(45_000);
    expect(parseAmount('$ 1.200.000')).toBe(1_200_000);
    expect(parseAmount('')).toBe(0);
  });
});

describe('MovementForm (botón +)', () => {
  let fake: ReturnType<typeof installFakeApi>;
  beforeEach(() => {
    fake = installFakeApi();
    setOnline(true);
  });

  it('registra un gasto con monto grande y fecha de negocio', async () => {
    let done = false;
    const { user } = renderForm(<MovementForm {...props} onDone={() => (done = true)} />);
    await user.type(screen.getByLabelText('Monto (COP)'), '45000');
    expect(screen.getByLabelText('Monto (COP)')).toHaveValue('45.000');
    await user.click(screen.getByRole('button', { name: 'Guardar gasto $ 45 mil' }));
    await waitFor(() => expect(done).toBe(true));
    expect(fake.writes()[0]!.body).toMatchObject({ movement: { kind: 'expense', amount: 45_000, bankId: 'bank_caja', date: '2026-05-25' } });
  });

  it('fecha: Hoy por defecto; Ayer manda la fecha pasada y avisa que va al historial', async () => {
    const { user } = renderForm(<MovementForm {...props} />);
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Ayer' }));
    expect(await screen.findByText(/completa el historial, no cambia el saldo/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Monto (COP)'), '20000');
    await user.click(screen.getByRole('button', { name: /Guardar gasto/ }));
    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(fake.writes()[0]!.body).toMatchObject({ movement: { date: '2026-05-24' } });
  });

  it('fecha: Otra abre un calendario que no permite fechas futuras', async () => {
    const { user } = renderForm(<MovementForm {...props} />);
    await user.click(screen.getByRole('button', { name: 'Otra' }));
    const input = screen.getByLabelText('Otra fecha');
    expect(input).toHaveAttribute('max', '2026-05-25');
  });

  it('ingreso al banco con los botones de bolsillo', async () => {
    const { user } = renderForm(<MovementForm {...props} />);
    await user.click(screen.getByRole('button', { name: '+ Ingreso' }));
    await user.click(await screen.findByRole('button', { name: 'Banco' }));
    await user.type(screen.getByLabelText('Monto (COP)'), '100000');
    await user.click(screen.getByRole('button', { name: 'Guardar ingreso $ 100 mil' }));
    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(fake.writes()[0]!.body).toMatchObject({ movement: { kind: 'income', bankId: 'bank_banco' } });
  });

  it('Cobro: elegir quién pagó y registrar sin duplicar como ingreso', async () => {
    const { user } = renderForm(<MovementForm {...props} />);
    await user.click(screen.getByRole('button', { name: 'Cobro' }));
    await user.click(await screen.findByRole('button', { name: /Tienda Doña Fina/ }));
    await user.click(screen.getByRole('button', { name: 'Ya pagó · Registrar $ 600 mil' }));
    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(fake.writes()[0]!.url).toBe('/v2/receivables/rcv_fina/payments');
  });

  it('sin red: aviso, botón deshabilitado y lo escrito se conserva', async () => {
    const { user, rerender } = renderForm(<MovementForm {...props} />);
    await user.type(screen.getByLabelText('Monto (COP)'), '30000');
    rerender(
      <QueryClientProvider client={testClient()}>
        <MovementForm {...props} online={false} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión: no se puede guardar');
    expect(screen.getByRole('button', { name: /Guardar gasto/ })).toBeDisabled();
    expect(screen.getByLabelText('Monto (COP)')).toHaveValue('30.000');
  });

  it('error de la API se explica y el formulario no se pierde', async () => {
    fake.override('POST', '/v2/movements', () => ({ status: 422, body: { code: 'FUTURE_DATE_NOT_ALLOWED', message: 'futura' } }));
    const { user } = renderForm(<MovementForm {...props} />);
    await user.type(screen.getByLabelText('Monto (COP)'), '1000');
    await user.click(screen.getByRole('button', { name: /Guardar gasto/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no puede tener fecha futura');
    expect(screen.getByLabelText('Monto (COP)')).toHaveValue('1.000');
  });

  it('reintento tras una falla reutiliza el mismo clientMutationId', async () => {
    let calls = 0;
    fake.override('POST', '/v2/movements', () => {
      calls += 1;
      return calls === 1 ? { status: 503, body: { code: 'INTERNAL_ERROR', message: 'caído' } } : { status: 201, body: { entity: {}, seq: 1 } };
    });
    const { user } = renderForm(<MovementForm {...props} />);
    await user.type(screen.getByLabelText('Monto (COP)'), '1000');
    await user.click(screen.getByRole('button', { name: /Guardar gasto/ }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: /Guardar gasto/ }));
    await waitFor(() => expect(fake.writes()).toHaveLength(2));
    const [a, b] = fake.writes() as { body: { clientMutationId: string } }[];
    expect(a!.body.clientMutationId).toBe(b!.body.clientMutationId);
  });
});

describe('CollectionForm y PaymentForm', () => {
  let fake: ReturnType<typeof installFakeApi>;
  beforeEach(() => {
    fake = installFakeApi();
  });

  it('cobro parcial a una deuda existente', async () => {
    const { user } = renderForm(<CollectionForm {...props} />);
    await screen.findByRole('option', { name: /Minimercado Sol/ });
    await user.selectOptions(screen.getByLabelText('¿Quién te pagó?'), 'rcv_sol');
    expect(screen.getByText(/Pendiente: \$ 1.200.000 · vence 2026-05-05/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Monto (COP)'), '300000');
    await user.click(screen.getByRole('button', { name: 'Guardar cobro' }));
    await waitFor(() => expect(fake.snapshot.receivables.find((r) => r.id === 'rcv_sol')!.pendingAmount).toBe(900_000));
    expect(fake.writes()[0]!.url).toBe('/v2/receivables/rcv_sol/payments');
  });

  it('cobro mayor al pendiente: mensaje claro', async () => {
    const { user } = renderForm(<CollectionForm {...props} />);
    await screen.findByRole('option', { name: /Doña Fina/ });
    await user.selectOptions(screen.getByLabelText('¿Quién te pagó?'), 'rcv_fina');
    await user.type(screen.getByLabelText('Monto (COP)'), '900000');
    await user.click(screen.getByRole('button', { name: 'Guardar cobro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('mayor a lo que falta pagar');
  });

  it('pago al proveedor', async () => {
    const { user } = renderForm(<PaymentForm {...props} />);
    await screen.findByRole('option', { name: /Proveedor principal/ });
    await user.selectOptions(screen.getByLabelText('¿A quién le pagaste?'), 'pay_proveedor');
    await user.type(screen.getByLabelText('Monto (COP)'), '1000000');
    await user.click(screen.getByRole('button', { name: 'Guardar pago' }));
    await waitFor(() => expect(fake.snapshot.payables[0]!.pendingAmount).toBe(3_200_000));
  });
});

describe('SaleForm', () => {
  let fake: ReturnType<typeof installFakeApi>;
  beforeEach(() => {
    fake = installFakeApi();
  });

  it('venta a crédito con el contrato de ventas por lote', async () => {
    const { user } = renderForm(<SaleForm {...props} />);
    await screen.findByRole('option', { name: 'Hotel Brisas' });
    await user.selectOptions(screen.getByLabelText('Clienta'), 'cli_hotel_brisas');
    await user.type(screen.getByLabelText('Monto (COP)'), '2100000');
    await user.click(screen.getByRole('button', { name: 'A crédito' }));
    expect(screen.getByText('Si lo dejas vacío, vence a los 30 días.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar venta' }));
    expect(await screen.findByText('Venta guardada.')).toBeInTheDocument();
    const body = fake.writes()[0]!.body as { sales: { sale: { payments: unknown[]; items: unknown[] } }[] };
    expect(body.sales[0]!.sale.payments).toEqual([]);
    expect(body.sales[0]!.sale.items).toEqual([{ itemId: 'venta_general', quantitiesSold: 1, finalPrice: 2_100_000 }]);
  });

  it('el grupo agregado no se ofrece como clienta individual', async () => {
    renderForm(<SaleForm {...props} />);
    const select = await screen.findByLabelText('Clienta');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
    expect(select).not.toHaveTextContent('Otras 9 tiendas');
  });
});

describe('CommitmentForm', () => {
  let fake: ReturnType<typeof installFakeApi>;
  beforeEach(() => {
    fake = installFakeApi();
  });
  afterEach(() => setOnline(true));

  it('compromiso recurrente quincenal', async () => {
    const { user } = renderForm(<CommitmentForm {...props} />);
    await user.type(screen.getByLabelText('Concepto'), 'Servicios');
    await user.type(screen.getByLabelText('Monto (COP)'), '200000');
    await user.clear(screen.getByLabelText('Días del mes'));
    await user.type(screen.getByLabelText('Días del mes'), '15, 30');
    await user.click(screen.getByLabelText('Se puede pedir plazo'));
    await user.click(screen.getByRole('button', { name: 'Guardar compromiso' }));
    await screen.findByText('Compromiso guardado.');
    expect(fake.writes()[0]!.body).toMatchObject({
      commitment: { concept: 'Servicios', amount: 200_000, negotiable: true, schedule: { kind: 'monthly', daysOfMonth: [15, 30], startDate: '2026-05-25' } },
    });
  });

  it('compromiso de una vez', async () => {
    const { user } = renderForm(<CommitmentForm {...props} />);
    await user.type(screen.getByLabelText('Concepto'), 'Impuesto');
    await user.type(screen.getByLabelText('Monto (COP)'), '100000');
    await user.click(screen.getByRole('button', { name: 'Una vez' }));
    await user.click(screen.getByRole('button', { name: 'Guardar compromiso' }));
    await screen.findByText('Compromiso guardado.');
    expect(fake.writes()[0]!.body).toMatchObject({ commitment: { schedule: { kind: 'once', date: '2026-05-25' } } });
  });

  it('datos incompletos no se envían', async () => {
    const { user } = renderForm(<CommitmentForm {...props} />);
    await user.click(screen.getByRole('button', { name: 'Guardar compromiso' }));
    expect(fake.writes()).toHaveLength(0);
  });
});
