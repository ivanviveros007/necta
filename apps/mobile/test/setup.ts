/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Mocks de módulos nativos para Jest. Demuestran comportamiento de React, NO el funcionamiento
 * nativo de Expo UI, SecureStore o SQLite en el teléfono: eso se verifica en el dispositivo.
 */
import { randomUUID } from 'node:crypto';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

jest.mock('expo-crypto', () => ({ randomUUID: () => randomUUID() }));

jest.mock('expo-network', () => {
  const state = { isConnected: true, isInternetReachable: true };
  return {
    useNetworkState: () => state,
    addNetworkStateListener: () => ({ remove: () => undefined }),
    __state: state,
  };
});

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = ({ children, testID }: { children?: unknown; testID?: string }) => React.createElement(View, { testID }, children);
  return { __esModule: true, default: Stub, Svg: Stub, Circle: Stub, Line: Stub, Polyline: Stub };
});

jest.mock('@expo/ui', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const Host = ({ children }: { children?: unknown }) => React.createElement(View, null, children);
  const PickerItem = () => null;
  const Picker = ({ selectedValue, onValueChange, children, testID }: { selectedValue: string; onValueChange: (v: string) => void; children: unknown; testID?: string }) => {
    const items = React.Children.toArray(children) as { props: { label: string; value: string } }[];
    return React.createElement(
      View,
      { testID, accessibilityRole: 'combobox', accessibilityValue: { text: String(selectedValue) } },
      items.map((item) =>
        React.createElement(
          Pressable,
          { key: item.props.value, accessibilityRole: 'menuitem', accessibilityState: { selected: item.props.value === selectedValue }, onPress: () => onValueChange(item.props.value) },
          React.createElement(Text, null, item.props.label),
        ),
      ),
    );
  };
  Picker.Item = PickerItem;
  const BottomSheet = ({ isPresented, children }: { isPresented: boolean; children: unknown }) =>
    isPresented ? React.createElement(View, { testID: 'bottom-sheet' }, children) : null;
  const RNHostView = ({ children }: { children?: unknown }) => React.createElement(View, null, children);
  return { Host, Picker, BottomSheet, RNHostView };
});
