import { screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeApi, setOnline } from '../test/fakeApi';
import { renderApp } from '../test/render';

afterEach(() => setOnline(true));

describe('LoginPage', () => {
  it('credenciales incorrectas muestran error; correctas entran al home', async () => {
    installFakeApi({ loggedIn: false });
    const { user } = renderApp('/');
    await user.type(await screen.findByLabelText('Email'), 'carmen@limpiaya.test');
    await user.type(screen.getByLabelText('Contraseña'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos.');
    await user.clear(screen.getByLabelText('Contraseña'));
    await user.type(screen.getByLabelText('Contraseña'), 'Necta2026!');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('$ 1.900.000')).toBeInTheDocument();
  });

  it('sin red no se puede ingresar', async () => {
    installFakeApi({ loggedIn: false });
    setOnline(false);
    renderApp('/');
    expect(await screen.findByText('Necesitas conexión para ingresar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
  });

  it('sesión vencida (401) vuelve al login avisando', async () => {
    const fake = installFakeApi();
    fake.override('GET', '/v2/forecast/14d', () => ({ status: 401, body: { code: 'UNAUTHENTICATED', message: 'vencida' } }));
    renderApp('/');
    expect(await screen.findByText('Tu sesión venció. Vuelve a ingresar.')).toBeInTheDocument();
  });
});

describe('HomePage', () => {
  it('datos primero: saldo, mínimo, gráfico, indicadores, acción, pagos, cobros y hoy', async () => {
    installFakeApi();
    renderApp('/');
    expect(await screen.findByText('$ 1.900.000')).toBeInTheDocument();
    expect(screen.getByText(/Mínimo 14 d −\$ 590 mil · lun 1 jun/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Saldo de los próximos días/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Entra $ 6.860.000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Acción sugerida/ })).toHaveTextContent('Confirmar cobro · Hotel Brisas');
    expect(screen.getByText('2/3 cubiertos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Día por día ›' })).toBeInTheDocument();
    expect(await screen.findByText('Sin registros hoy')).toBeInTheDocument();
    // La fecha simulada del caso se distingue de la real.
    expect(screen.getByText('Fecha del caso · lun 25 may')).toBeInTheDocument();
  });

  it('la acción sugerida abre el cobro y «Ya pagó» actualiza saldo y pagos', async () => {
    const fake = installFakeApi();
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: /Acción sugerida/ }));
    await user.click(await screen.findByRole('button', { name: 'Ya pagó · Registrar $ 2,1 M' }));
    expect(await screen.findByText('$ 4.000.000')).toBeInTheDocument();
    expect(fake.snapshot.receivables.find((r) => r.id === 'rcv_brisas')!.pendingAmount).toBe(0);
    expect(await screen.findByText('Cobro Hotel Brisas')).toBeInTheDocument();
  });

  it('muestra el aviso persistente de alerta y permite marcarla', async () => {
    const fake = installFakeApi();
    fake.setAlerts([{ id: 'a1', status: 'active', acknowledgedAt: null, headline: 'Te faltan $ 590.000 el lunes 1 de junio' }]);
    const { user } = renderApp('/');
    expect(await screen.findByText(/Aviso:/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entendido' }));
    await waitFor(() => expect(screen.queryByText(/Aviso:/)).not.toBeInTheDocument());
  });

  it('un cambio desde otro dispositivo se refleja al llegar store.changed', async () => {
    const fake = installFakeApi();
    const { socket } = renderApp('/');
    await screen.findByText('$ 1.900.000');
    fake.externalChange({ type: 'receivable.payment', entityId: 'rcv_sol', payload: { bankId: 'bank_caja', amount: 300_000, paymentDate: '2026-05-25' } });
    act(() => socket.emit('store.changed', { storeId: 'store_limpia_ya', seq: 19 }));
    expect(await screen.findByText('$ 2.200.000')).toBeInTheDocument();
  });

  it('registrar un gasto desde el botón + actualiza saldo y «Hoy»', async () => {
    const fake = installFakeApi();
    const { user } = renderApp('/');
    await screen.findByText('$ 1.900.000');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    await user.type(screen.getByLabelText('Monto (COP)'), '100000');
    await user.click(screen.getByRole('button', { name: 'Guardar gasto $ 100 mil' }));
    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(await screen.findByText('$ 1.800.000')).toBeInTheDocument();
    expect(await screen.findByText('Gasto')).toBeInTheDocument();
  });
});

describe('Editar un ingreso o gasto', () => {
  it('desde «Hoy»: corregir monto y luego eliminar con doble confirmación', async () => {
    const fake = installFakeApi();
    const { user } = renderApp('/');
    await screen.findByText('$ 1.900.000');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    await user.type(screen.getByLabelText('Monto (COP)'), '45000');
    await user.click(screen.getByRole('button', { name: 'Guardar gasto $ 45 mil' }));
    await user.click(await screen.findByRole('button', { name: /Editar Gasto/ }));
    const amount = screen.getAllByLabelText('Monto (COP)').at(-1)!;
    await user.clear(amount);
    await user.type(amount, '40000');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(fake.writes().at(-1)!).toMatchObject({ method: 'PATCH', body: { baseVersion: 1, changes: { amount: 40_000 } } }));
    expect(await screen.findByText('$ 1.860.000')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Editar Gasto/ }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Sí, eliminar $ 40 mil' }));
    await waitFor(() => expect(fake.writes().at(-1)!.method).toBe('DELETE'));
    expect(await screen.findByText('$ 1.900.000')).toBeInTheDocument();
  });
});

describe('DetailPage', () => {
  it('tabla por día, escenario conservador y acciones que abren el cobro', async () => {
    installFakeApi();
    const { user } = renderApp('/detalle');
    await screen.findByRole('heading', { name: 'Día por día' });
    await user.click(screen.getByRole('button', { name: 'Conservador' }));
    expect(screen.getByText(/Sin Hotel Brisas \(−2,1 M\)/)).toBeInTheDocument();
    const friday = screen.getByRole('button', { name: /vie 29 may/ }).closest('tr')!;
    expect(within(friday).getByText('−$ 590 mil')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirma el pago de Hotel Brisas' }));
    expect(await screen.findByRole('button', { name: 'Ya pagó · Registrar $ 2,1 M' })).toBeInTheDocument();
  });
});

describe('RecordPage', () => {
  it('pestañas por tipo; el cobro baja la deuda', async () => {
    const fake = installFakeApi();
    const { user } = renderApp('/registrar');
    await user.click(await screen.findByRole('tab', { name: 'Cobro' }));
    expect(screen.getByRole('tab', { name: 'Cobro' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByRole('option', { name: /Hotel Brisas/ });
    await user.selectOptions(screen.getByLabelText('¿Quién te pagó?'), 'rcv_brisas');
    await user.type(screen.getByLabelText('Monto (COP)'), '500000');
    await user.click(screen.getByRole('button', { name: 'Guardar cobro' }));
    await waitFor(() => expect(fake.snapshot.receivables.find((r) => r.id === 'rcv_brisas')!.pendingAmount).toBe(1_600_000));
  });

  it('sin red: envío deshabilitado y el formulario se conserva al cambiar de pestaña', async () => {
    installFakeApi();
    const { user } = renderApp('/registrar/compromiso');
    await user.type(await screen.findByLabelText('Concepto'), 'Arriendo local 2');
    act(() => setOnline(false));
    expect(await screen.findByText(/Sin conexión. La web necesita internet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar compromiso' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Venta' }));
    await user.click(screen.getByRole('tab', { name: 'Pago fijo o futuro' }));
    expect(screen.getByLabelText('Concepto')).toHaveValue('Arriendo local 2');
    act(() => setOnline(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar compromiso' })).toBeEnabled());
  });

});

describe('CommitmentsPage', () => {
  it('lista los pagos fijos cargados', async () => {
    installFakeApi();
    renderApp('/compromisos');
    expect(await screen.findByText('Arriendo bodega')).toBeInTheDocument();
    expect(screen.getByText(/\$ 1.400.000 los días 15 y 30 de cada mes/)).toBeInTheDocument();
  });
});

describe('Cabeceras de la web', () => {
  it('envía plataforma web, tienda y CSRF; GET sin CSRF', async () => {
    const fake = installFakeApi();
    const { user } = renderApp('/');
    await screen.findByText('$ 1.900.000');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    await user.type(screen.getByLabelText('Monto (COP)'), '1000');
    await user.click(screen.getByRole('button', { name: 'Guardar gasto $ 1 mil' }));
    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    const w = fake.writes()[0]!;
    expect(w.headers).toMatchObject({ 'x-client-platform': 'web', 'x-store-id': 'store_limpia_ya', 'x-csrf-token': 'csrf-test' });
    const g = fake.requests.find((r) => r.url === '/v2/forecast/14d')!;
    expect(g.headers['x-csrf-token']).toBeUndefined();
  });

  it('cerrar sesión vuelve al login', async () => {
    installFakeApi();
    const { user } = renderApp('/');
    await screen.findByText('$ 1.900.000');
    await user.click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
  });
});
