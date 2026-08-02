import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useAppTheme, theme } from '@/theme';

function RootLayoutInner() {
  const { active, tokens } = useAppTheme();

  return (
    <>
      <StatusBar style={active === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: tokens.background },
          headerShadowVisible: false,
          headerTintColor: active === 'dark' ? tokens.textPrimary : tokens.textPrimary,
          headerTitleStyle: {
            fontFamily: theme.typography.body,
            fontSize: 14,
            fontWeight: '600',
            color: tokens.textPrimary,
          },
          contentStyle: { backgroundColor: tokens.background },
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
        <Stack.Screen name="address-list" options={{ title: 'Enderecos', headerBackTitle: 'Voltar' }} />
        <Stack.Screen name="address-form" options={{ title: 'Endereco', headerBackTitle: 'Enderecos' }} />
        <Stack.Screen name="fulfillment" options={{ title: 'Entrega', headerBackTitle: 'Carrinho' }} />
        <Stack.Screen name="checkout-review" options={{ title: 'Revisao do Pedido', headerBackTitle: 'Entrega' }} />
        <Stack.Screen name="payment" options={{ title: 'Pagamento', headerBackTitle: 'Revisao' }} />
        <Stack.Screen name="payment-pix" options={{ title: 'PIX', headerBackTitle: 'Pagamento' }} />
        <Stack.Screen name="payment-confirm" options={{ title: 'Confirmar', headerBackTitle: 'Pagamento' }} />
        <Stack.Screen name="payment-error" options={{ title: 'Erro', headerBackTitle: 'Pagamento' }} />
        <Stack.Screen name="order-success" options={{ headerShown: false }} />
        <Stack.Screen name="order-error" options={{ headerShown: false }} />
        <Stack.Screen name="order-list" options={{ title: 'Meus Pedidos', headerBackTitle: 'Voltar' }} />
        <Stack.Screen name="order-timeline" options={{ title: 'Timeline do Pedido', headerBackTitle: 'Meus Pedidos' }} />
        <Stack.Screen name="order-tracking" options={{ title: 'Rastreamento', headerBackTitle: 'Meus Pedidos' }} />
        <Stack.Screen name="order-cancelled" options={{ headerShown: false }} />
        <Stack.Screen name="order-return" options={{ title: 'Devolucao', headerBackTitle: 'Meus Pedidos' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  );
}
