import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createExpoPlatform } from '../app-state/expoPlatform';
import { AppProviders } from '../app-state/NectaProvider';

export default function RootLayout() {
  const [platform] = useState(createExpoPlatform);
  return (
    <SafeAreaProvider>
      <AppProviders platform={platform}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTintColor: '#0B3D2E',
            headerTitleStyle: { fontSize: 18, fontWeight: '700' },
            headerBackTitle: 'Volver',
            // Encabezado opaco: el contenido no queda debajo de un fondo translúcido.
            headerTransparent: false,
            headerStyle: { backgroundColor: '#FFFFFF' },
            headerShadowVisible: true,
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Necta' }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="detalle" options={{ title: 'Día por día' }} />
          <Stack.Screen name="registrar/[tipo]" options={{ title: 'Registrar' }} />
          <Stack.Screen name="sincronizacion" options={{ title: 'Sincronización' }} />
        </Stack>
      </AppProviders>
    </SafeAreaProvider>
  );
}
