import { render } from '@testing-library/react-native';
import { describe, expect, it } from '@jest/globals';
import { StyleSheet } from 'react-native';
import { visualAppAuthClient } from '@/app-auth/AppAuthClient';
import { AccessStatusHeader, AccessStatusScreen, isCompactAccessHeader } from '@/screens/AccessStatusScreen';
import { theme } from '@/theme';

describe('responsive access status header', () => {
  it.each([375, 390, 430])('selects the compact layout at %i px', (width) => { expect(isCompactAccessHeader(width)).toBe(true); });
  it.each([431, 900])('preserves the desktop layout at %i px', (width) => { expect(isCompactAccessHeader(width)).toBe(false); });

  it('stacks both labels without shrinking in the compact layout', () => {
    const screen = render(<AccessStatusHeader compact />);
    const headerStyle = StyleSheet.flatten(screen.getByLabelText('Cabeçalho do status de acesso').props.style);
    const eyebrowStyle = StyleSheet.flatten(screen.getByText('AEROSTORE · ACESSO').props.style);
    const metaStyle = StyleSheet.flatten(screen.getByText('ATUALIZADO AGORA').props.style);
    expect(headerStyle).toEqual(expect.objectContaining({ flexDirection: 'column', alignItems: 'flex-start', gap: theme.spacing.xs, marginBottom: theme.spacing.xl }));
    expect(eyebrowStyle.fontSize).toBe(12); expect(metaStyle.fontSize).toBe(10);
  });

  it('keeps the desktop header horizontal', () => {
    const screen = render(<AccessStatusHeader compact={false} />);
    expect(StyleSheet.flatten(screen.getByLabelText('Cabeçalho do status de acesso').props.style)).toEqual(expect.objectContaining({ flexDirection: 'row', justifyContent: 'space-between' }));
  });

  it.each(['PENDING_PHONE_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED', 'CLOSED'])('keeps every %s action separated with complete borders', async (status) => {
    const snapshot = await visualAppAuthClient.status(`visual-${status.toLowerCase()}`, 'device');
    const screen = render(<AccessStatusScreen snapshot={snapshot} onRefresh={() => undefined} onProfile={() => undefined} onCatalog={() => undefined} onLogout={() => undefined} onVerifyPhone={() => undefined} />);
    expect(StyleSheet.flatten(screen.getByLabelText('Ações do status de acesso').props.style)).toEqual(expect.objectContaining({ width: '100%' }));
    const buttons = screen.getAllByRole('button');
    for (const [index, button] of buttons.entries()) {
      expect(StyleSheet.flatten(button.props.style)).toEqual(expect.objectContaining({ marginTop: index === 0 ? 0 : theme.spacing.sm, minHeight: theme.sizes.touch, borderRadius: theme.radii.pill }));
    }
  });
});
