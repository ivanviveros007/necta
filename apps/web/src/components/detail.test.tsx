import { buildForecastInput, computeForecast, limpiaYaSnapshot } from '@necta/cash-engine';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ActionsTable, AssumptionsToggle, DayTable, ScenarioToggle, UnscheduledTable } from './detail';

const f = computeForecast(buildForecastInput(limpiaYaSnapshot()));

describe('DayTable + ScenarioToggle', () => {
  function Harness() {
    const [s, setS] = useState<'expected' | 'conservative'>('expected');
    return (
      <>
        <ScenarioToggle value={s} onChange={setS} />
        <DayTable scenario={f.scenarios[s]} />
      </>
    );
  }

  it('Día · Entra · Sale · Saldo compactos; conservador deja el viernes en negativo', async () => {
    render(<Harness />);
    const friday = () => screen.getByRole('button', { name: /vie 29 may/ }).closest('tr')!;
    expect(within(friday()).getByText('$ 1,51 M')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Conservador' }));
    expect(within(friday()).getByText('−$ 590 mil')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(15);
  });

  it('una fila se despliega con sus movimientos', async () => {
    render(<DayTable scenario={f.scenarios.expected} />);
    const monday = screen.getByRole('button', { name: /lun 1 jun/ });
    expect(monday).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(monday);
    const flows = screen.getByRole('list', { name: /Movimientos del lun 1 jun/ });
    expect(within(flows).getByText('Arriendo bodega')).toBeInTheDocument();
    expect(within(flows).getByText('−1.300.000')).toBeInTheDocument();
  });
});

describe('ActionsTable', () => {
  it('verbo, contraparte, monto y efecto; las de cobro abren el cobro', async () => {
    const onReceivable = vi.fn();
    render(<ActionsTable actions={f.actions} onReceivable={onReceivable} />);
    expect(screen.getAllByText('Confirmar')).toHaveLength(2);
    expect(screen.getByText('+4 d')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirma el pago de Hotel Brisas' }));
    expect(onReceivable).toHaveBeenCalledWith('rcv_brisas');
    // Aplazar no tiene acción directa todavía.
    expect(screen.queryByRole('button', { name: /Pide plazo/ })).not.toBeInTheDocument();
  });

  it('sin acciones', () => {
    render(<ActionsTable actions={[]} />);
    expect(screen.getByText('Sin acciones')).toBeInTheDocument();
  });
});

describe('UnscheduledTable y AssumptionsToggle', () => {
  it('motivo corto y acceso al cobro', async () => {
    const onReceivable = vi.fn();
    render(<UnscheduledTable items={f.unscheduledReceivables} onReceivable={onReceivable} />);
    expect(screen.getByText('vencido 20 d')).toBeInTheDocument();
    expect(screen.getByText('paga tarde')).toBeInTheDocument();
    expect(screen.getByText('sin fecha')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Minimercado Sol/ }));
    expect(onReceivable).toHaveBeenCalledWith('rcv_sol');
  });

  it('supuestos plegados por defecto', async () => {
    render(<AssumptionsToggle assumptions={f.assumptions} />);
    const details = screen.getByText(`Supuestos (${f.assumptions.length})`).closest('details')!;
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText(`Supuestos (${f.assumptions.length})`));
    expect(details).toHaveAttribute('open');
  });
});
