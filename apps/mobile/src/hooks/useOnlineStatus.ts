import { useNetworkState } from 'expo-network';

/** true/false según la red del sistema; null mientras no se sabe. */
export function useOnlineStatus(): boolean | null {
  const state = useNetworkState();
  return state.isConnected ?? null;
}
