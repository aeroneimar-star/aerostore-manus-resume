import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { theme } from '@/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.ink },
          headerShadowVisible: false,
          headerTintColor: theme.colors.ivory,
          headerTitleStyle: {
            fontFamily: theme.typography.body,
            fontSize: 14,
            fontWeight: '600',
          },
          contentStyle: { backgroundColor: theme.colors.ink },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="access-status" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="catalog" options={{ headerShown: false }} />
        <Stack.Screen name="cart" options={{ title: 'Carrinho', headerBackTitle: 'Catálogo' }} />
        <Stack.Screen
          name="product/[slug]"
          options={{ title: 'Coleção AEROSTORE', headerBackTitle: 'Catálogo' }}
        />
      </Stack>
    </>
  );
}
