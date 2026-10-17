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
    expect(await screen.findByRole('heading', { name: 'Te faltan $ 590.000 el lunes 1 de junio' })).toBeInTheDocument();
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
  it('responde la pregunta en el orden acordado', async () => {
    installFakeApi();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Te faltan $ 590.000 el lunes 1 de junio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Primer faltante')).toHaveTextContent('Si Hotel Brisas no paga: faltan $ 590.000 el viernes 29 de mayo');
    expect(screen.getByLabelText('Qué hacer primero')).toHaveTextContent('Confirma el pago de Hotel Brisas');
    expect(screen.getByRole('note')).toHaveTextContent('diferencia de $ 260.000');
    expect(screen.getByRole('img', { name: /Saldo diario/ })).toBeInTheDocument();
    expect(screen.getByText('Limpia Ya')).toBeInTheDocument();
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

  it('registrar un gasto desde el FAB actualiza la proyección', async () => {
    const fake = installFakeApi();
    const { user } = renderApp('/');
    await screen.findByText('$ 1.900.000');
    await user.click(screen.getByRole('button', { name: 'Registrar ingreso o gasto' }));
    await user.type(screen.getByLabelText('Monto (COP)'), '100000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(fake.writes()).toHaveLength(1));
    expect(await screen.findByText('$ 1.800.000')).toBeInTheDocument();
  });
});

describe('DetailPage', () => {
  it('alterna escenario y explica la prueba de estrés', async () => {
    installFakeApi();
    const { user } = renderApp('/detalle');
    await screen.findByRole('heading', { name: 'Día por día' });
    await user.click(screen.getByRole('button', { name: 'Conservador' }));
    expect(screen.getByText(/Prueba de estrés: igual al esperado pero sin Cobro Hotel Brisas/)).toBeInTheDocument();
    const friday = screen.getByRole('rowheader', { name: /viernes 29 de mayo/ }).closest('tr')!;
    expect(within(friday).getByText('−$ 590.000')).toBeInTheDocument();
    expect(screen.getByText('Cóbrale a Minimercado Sol')).toBeInTheDocument();
    expect(screen.getByText(/No sumamos \$ 2.900.000/)).toBeInTheDocument();
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

  it('el ingreso que es un cobro lleva al formulario de cobro', async () => {
    installFakeApi();
    const { user } = renderApp('/');
    await screen.findByText('$ 1.900.000');
    await user.click(screen.getByRole('button', { name: 'Registrar ingreso o gasto' }));
    await user.click(screen.getByRole('button', { name: 'Ingreso' }));
    await user.click(screen.getByRole('button', { name: 'Regístralo como cobro' }));
    expect(await screen.findByLabelText('¿Quién te pagó?')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Registrar ingreso o gasto' }));
    await user.type(screen.getByLabelText('Monto (COP)'), '1000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
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
