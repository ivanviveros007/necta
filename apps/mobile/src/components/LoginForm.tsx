import { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '../services/apiClient';
import { Button, colors, Field, Notice, Title } from './ui';

/**
 * Campos centrados en la pantalla y el botón abajo, al alcance del pulgar.
 * El primer ingreso requiere conexión; luego la app funciona sin señal con la sesión guardada.
 */
export function LoginForm({ online, onLogin, footnote }: { online: boolean; onLogin: (email: string, password: string) => Promise<void>; footnote?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onLogin(email.trim(), password);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError('Email o contraseña incorrectos.');
      else if (e instanceof ApiError && e.transient) setError('No hay conexión con Necta. Para el primer ingreso necesitas señal.');
      else setError(e instanceof Error ? e.message : 'No se pudo ingresar.');
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Title>Necta</Title>
        <Field label="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <Field label="Contraseña" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} returnKeyType="go" onSubmitEditing={() => email && password && void submit()} />
        {!online ? <Notice tone="warn">Necesitas conexión para ingresar la primera vez.</Notice> : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </View>
      <View>
        <Button label={pending ? 'Ingresando…' : 'Ingresar'} disabled={pending || !email || !password} onPress={() => void submit()} />
        {footnote ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 4 }}>{footnote}</Text> : null}
      </View>
    </View>
  );
}
