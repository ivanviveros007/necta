import { buildForecastInput, computeForecast, limpiaYaSnapshot } from '@necta/cash-engine';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ActionsList,
  AssumptionsList,
  BalanceCard,
  BalanceChart,
  ConclusionCard,
  DayTable,
  DependenciesList,
  Money,
  PriorityAction,
  ScenarioToggle,
  ShortfallSummary,
  StatusBadge,
  UnscheduledList,
} from './forecast';

const f = computeForecast(buildForecastInput(limpiaYaSnapshot()));

describe('Money y StatusBadge', () => {
  it('formatea COP y marca negativos', () => {
    render(<Money amount={-590_000} />);
    const el = screen.getByText('−$ 590.000');
    expect(el).toHaveClass('negative');
  });

  it('el estado se comunica con texto e ícono, no solo color', () => {
    render(<StatusBadge status="short" />);
    expect(screen.getByRole('status')).toHaveTextContent('✕ Te falta plata');
  });
});

describe('ConclusionCard', () => {
  it('muestra la conclusión del caso', () => {
    render(<ConclusionCard forecast={f} />);
    expect(screen.getByRole('heading', { name: 'Te faltan $ 590.000 el lunes 1 de junio' })).toBeInTheDocument();
    expect(screen.getByText(/dependes de que Hotel Brisas pague/)).toBeInTheDocument();
  });
});

describe('ShortfallSummary', () => {
  it('primer faltante por escenario, nombrando la dependencia', () => {
    render(<ShortfallSummary expected={f.scenarios.expected} conservative={f.scenarios.conservative} currency="COP" />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Esperado: faltan $ 590.000 el lunes 1 de junio (Arriendo bodega)');
    expect(items[1]).toHaveTextContent('Si Hotel Brisas no paga: faltan $ 590.000 el viernes 29 de mayo (Proveedor principal)');
  });

  it('sin faltante lo dice explícitamente', () => {
    const ok = { ...f.scenarios.expected, firstShortfall: null };
    render(<ShortfallSummary expected={ok} conservative={{ ...ok, kind: 'conservative' }} currency="COP" />);
    expect(screen.getAllByText(/sin faltante en 14 días/)).toHaveLength(2);
  });
});

describe('Acciones', () => {
  it('acción prioritaria: confirmar Hotel Brisas', () => {
    render(<PriorityAction action={f.actions[0]} />);
    expect(screen.getByLabelText('Qué hacer primero')).toHaveTextContent('Confirma el pago de Hotel Brisas');
  });

  it('sin acción no renderiza nada', () => {
    const { container } = render(<PriorityAction action={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lista ordenada con impacto', () => {
    render(<ActionsList actions={f.actions} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Confirma el pago de Hotel Brisas');
    expect(screen.getByText('Cóbrale a Minimercado Sol')).toBeInTheDocument();
    expect(screen.getByText(/Si lo pagas 4 días después/)).toBeInTheDocument();
  });

  it('lista vacía', () => {
    render(<ActionsList actions={[]} />);
    expect(screen.getByText('No hay acciones pendientes.')).toBeInTheDocument();
  });
});

describe('BalanceCard', () => {
  it('saldo guardado con advertencia de diferencia, sin corregirla', () => {
    render(<BalanceCard reference={f.reference} currency="COP" />);
    expect(screen.getByText('$ 1.900.000')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Con tus movimientos registrados da $ 1.640.000: diferencia de $ 260.000');
  });

  it('sin diferencia no advierte', () => {
    render(<BalanceCard reference={{ ...f.reference, reconstructedBalance: 1_900_000, alignmentDelta: 0 }} currency="COP" />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('BalanceChart', () => {
  it('describe los 14 cierres y los pagos importantes de forma accesible', () => {
    render(<BalanceChart days={f.scenarios.expected.days} currency="COP" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toContain('1 jun: −$ 590.000');
    expect(img.querySelectorAll('circle')).toHaveLength(14);
    expect(img.querySelector('line.zero')).not.toBeNull();
    expect(screen.getByText(/29 may Proveedor principal/)).toBeInTheDocument();
  });
});

describe('ScenarioToggle y DayTable', () => {
  function Harness() {
    const [s, setS] = useState<'expected' | 'conservative'>('expected');
    return (
      <>
        <ScenarioToggle value={s} onChange={setS} />
        <DayTable scenario={f.scenarios[s]} currency="COP" />
      </>
    );
  }

  it('alterna escenarios y muestra el viernes 29 en negativo en el conservador', async () => {
    render(<Harness />);
    const friday = () => screen.getByRole('rowheader', { name: /viernes 29 de mayo/ }).closest('tr')!;
    expect(within(friday()).getByText('$ 1.510.000')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Conservador' }));
    expect(screen.getByRole('button', { name: 'Conservador' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(friday()).getByText('−$ 590.000')).toBeInTheDocument();
    expect(within(friday()).getByText('(faltante)')).toBeInTheDocument();
    expect(screen.getByText(/sin Cobro Hotel Brisas/)).toBeInTheDocument();
  });

  it('lista entradas y salidas de cada día', () => {
    render(<DayTable scenario={f.scenarios.expected} currency="COP" />);
    const monday = screen.getByRole('rowheader', { name: /lunes 1 de junio/ }).closest('tr')!;
    expect(within(monday).getByText('Arriendo bodega')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(15);
  });
});

describe('Supuestos, dependencias y cobros sin fecha', () => {
  it('supuestos visibles; los faltantes se marcan', () => {
    render(
      <AssumptionsList
        assumptions={[...f.assumptions, { code: 'x', text: 'Carga tus ventas', source: 'user', missing: true }]}
      />,
    );
    expect(screen.getByText(/lun–jue \$ 260.000/)).toBeInTheDocument();
    expect(screen.getByText('Falta:')).toBeInTheDocument();
  });

  it('dependencias', () => {
    render(<DependenciesList dependencies={f.dependencies} />);
    expect(screen.getByText(/para pagar «Proveedor principal» dependes de que Hotel Brisas/)).toBeInTheDocument();
  });

  it('sin dependencias', () => {
    render(<DependenciesList dependencies={[]} />);
    expect(screen.getByText('Ningún pago depende de un solo cobro.')).toBeInTheDocument();
  });

  it('cobros sin fecha confiable con su motivo, sin inventar fechas', () => {
    render(<UnscheduledList items={f.unscheduledReceivables} currency="COP" />);
    expect(screen.getByText(/vencido hace 20 días/)).toBeInTheDocument();
    expect(screen.getByText(/suele pagar tarde/)).toBeInTheDocument();
    expect(screen.getByText(/sin fecha individual \(próximas dos semanas\)/)).toBeInTheDocument();
  });

  it('todo con fecha confiable', () => {
    render(<UnscheduledList items={[]} currency="COP" />);
    expect(screen.getByText('Todos tus cobros tienen fecha confiable.')).toBeInTheDocument();
  });
});
