/**
 * Rota: /brand-switch
 * Brand Engine — Troca de marca e comparação lado a lado.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import BrandSwitchScreen from '../screens/BrandSwitchScreen';

export default function BrandSwitchRoute() {
  return (
    <View style={styles.container}>
      <BrandSwitchScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
});
