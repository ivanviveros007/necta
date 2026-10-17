import { buildForecastInput, computeForecast, limpiaYaSnapshot, summarizeForecast, todayActivity } from '@necta/cash-engine';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ActionChip, BalanceHeader, CashChart, CollectionsTable, KpiRow, PaymentsTable, SectionLink, TodaySection } from './home';

const f = computeForecast(buildForecastInput(limpiaYaSnapshot()));
const s = summarizeForecast(f, 30);

describe('BalanceHeader', () => {
  it('saldo, mínimo proyectado y diferencia a pedido', async () => {
    render(<BalanceHeader summary={s} />);
    expect(screen.getByText('$ 1.900.000')).toBeInTheDocument();
    expect(screen.getByText(/Mínimo 14 d −\$ 590 mil · lun 1 jun/)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Diferencia con lo registrado' }));
    expect(screen.getByRole('note')).toHaveTextContent('Registrado $ 1.640.000 · dif. $ 260.000');
  });
});

describe('CashChart', () => {
  it('14 puntos y tooltip numérico al elegir un día', async () => {
    render(<CashChart days={f.scenarios.expected.days} />);
    expect(screen.getByRole('img').querySelectorAll('circle')).toHaveLength(14);
    await userEvent.click(screen.getByRole('button', { name: /mié 3 jun saldo/ }));
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('mié 3 jun');
    expect(tip).toHaveTextContent('Saldo−$ 250.000');
    expect(tip).toHaveTextContent('Entra+260 mil');
    expect(tip).toHaveTextContent('Sale−90 mil');
  });
});

describe('KpiRow y ActionChip', () => {
  it('totales compactos', () => {
    render(<KpiRow totals={s.totals} />);
    expect(screen.getByLabelText('Entra $ 6.860.000')).toHaveTextContent('$ 6,86 M');
    expect(screen.getByLabelText('Sale $ 7.980.000')).toHaveTextContent('$ 7,98 M');
    expect(screen.getByLabelText('Sin fecha $ 2.900.000')).toHaveTextContent('$ 2,9 M');
  });

  it('acción sugerida en una línea', async () => {
    const onPress = vi.fn();
    render(<ActionChip action={s.primaryAction} onPress={onPress} />);
    await userEvent.click(screen.getByRole('button', { name: /Acción sugerida/ }));
    expect(screen.getByRole('button')).toHaveTextContent('Confirmar cobro · Hotel Brisas');
    expect(onPress).toHaveBeenCalled();
  });

  it('sin acción no renderiza', () => {
    const { container } = render(<ActionChip action={null} onPress={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PaymentsTable y CollectionsTable', () => {
  it('pagos con estado: depende / faltante', () => {
    render(<PaymentsTable payments={s.payments} covered={s.coveredCount} />);
    expect(screen.getByText('2/3 cubiertos')).toBeInTheDocument();
    const rent = screen.getByLabelText(/Arriendo bodega/);
    expect(within(rent).getByText(/−590 mil/)).toBeInTheDocument();
    expect(within(screen.getByLabelText(/Proveedor principal/)).getByText(/depende/)).toBeInTheDocument();
  });

  it('cobros: tocar una fila abre ese cobro', async () => {
    const onPress = vi.fn();
    render(<CollectionsTable items={s.upcoming} onPress={onPress} />);
    await userEvent.click(screen.getByRole('button', { name: /Hotel Brisas/ }));
    expect(onPress).toHaveBeenCalledWith('rcv_brisas');
  });

  it('enlace al día por día', () => {
    render(
      <MemoryRouter>
        <SectionLink title="Próximos 14 días" to="/detalle" link="Día por día" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Día por día ›' })).toHaveAttribute('href', '/detalle');
  });
});

describe('TodaySection', () => {
  it('avance de ventas y gastos y lo registrado hoy', () => {
    const activity = todayActivity({
      businessDate: '2026-05-25',
      movements: [{ id: 'm1', kind: 'income', amount: 100_000, date: '2026-05-25', description: 'Venta de contados' }],
      sales: [],
      receivables: [{ counterpartyName: 'Tienda Doña Fina', payments: [{ clientMutationId: 'c1', amount: 600_000, paymentDate: '2026-05-25' }] }],
      payables: [],
      baseline: limpiaYaSnapshot().baseline,
    });
    render(<TodaySection activity={activity} />);
    expect(screen.getByRole('progressbar', { name: 'Ventas' })).toHaveAttribute('aria-valuenow', '38');
    expect(screen.getByText('Venta de contados')).toBeInTheDocument();
    expect(screen.getByText('Cobro Tienda Doña Fina')).toBeInTheDocument();
    expect(screen.getAllByLabelText('confirmado')).toHaveLength(2);
  });

  it('sin registros', () => {
    render(<TodaySection activity={{ items: [], sales: { done: 0, expected: 0 }, expenses: { done: 0, expected: 0 } }} />);
    expect(screen.getByText('Sin registros hoy')).toBeInTheDocument();
  });
});
