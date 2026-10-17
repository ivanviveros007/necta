import Constants from 'expo-constants';

/**
 * URL de la API. En un teléfono físico `localhost` es el propio teléfono, así que:
 * 1. EXPO_PUBLIC_API_URL si está definida (p. ej. http://192.168.1.20:3000).
 * 2. Si no, la IP de la computadora que sirve Metro (hostUri) con el puerto 3000.
 */
export function resolveApiUrl(env: string | undefined = process.env.EXPO_PUBLIC_API_URL, hostUri: string | undefined = Constants.expoConfig?.hostUri): string {
  if (env) return env.replace(/\/$/, '');
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}
