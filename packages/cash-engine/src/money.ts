/**
 * Formato de montos para la interfaz: «$ 1.900.000», «−$ 590.000».
 * Implementado sin Intl para que sea idéntico en Node, navegador y Hermes.
 */
export function formatMoney(amount: number, currency = 'COP'): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '−' : '';
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const symbol = currency === 'COP' || currency === 'USD' ? '$' : currency;
  return `${sign}${symbol} ${grouped}`;
}

export function sum(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/** Monto compacto para tablas e indicadores: «$ 6,86 M», «$ 590 mil», «−$ 2,69 M». */
export function formatMoneyCompact(amount: number, currency = 'COP'): string {
  const sign = amount < 0 ? '−' : '';
  const abs = Math.abs(Math.round(amount));
  const symbol = currency === 'COP' || currency === 'USD' ? '$' : currency;
  const trim = (n: number, digits: number) => {
    const fixed = n.toFixed(digits);
    return (fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed).replace('.', ',');
  };
  if (abs >= 1_000_000) return `${sign}${symbol} ${trim(abs / 1_000_000, 2)} M`;
  if (abs >= 1_000) return `${sign}${symbol} ${trim(abs / 1_000, 0)} mil`;
  return `${sign}${symbol} ${abs}`;
}
