import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNecta } from '../app-state/NectaProvider';
import { API_URL_FOR_DISPLAY } from '../app-state/expoPlatform';
import { LoginForm } from '../components/LoginForm';
import { colors } from '../components/ui';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export default function LoginScreen() {
  const { status, login } = useNecta();
  const online = useOnlineStatus();
  const [done, setDone] = useState(false);
  if (status === 'ready' || done) return <Redirect href="/" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1, paddingHorizontal: 24, paddingBottom: 12 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <LoginForm
          online={online !== false}
          footnote={__DEV__ ? `API: ${API_URL_FOR_DISPLAY}` : undefined}
          onLogin={async (e, p) => {
            await login(e, p);
            setDone(true);
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
