import { useCallback, useState } from 'react';
import type { NativeSyntheticEvent, TargetedEvent, ViewStyle } from 'react-native';

import { theme } from '@/theme';

interface WebFocusTarget {
  matches?: (selector: string) => boolean;
}

const matchesFocusVisible = (
  event: NativeSyntheticEvent<TargetedEvent>,
): boolean => {
  const target = event.currentTarget as unknown as WebFocusTarget;
  return target.matches?.(':focus-visible') === true;
};

export const webFocusVisibleStyle: ViewStyle = {
  boxShadow: `inset 0 0 0 2px ${theme.colors.ink}`,
  outlineColor: theme.colors.copperSoft,
  outlineOffset: -3,
  outlineStyle: 'solid',
  outlineWidth: 3,
};

export function useWebFocusVisible() {
  const [focusVisible, setFocusVisible] = useState(false);

  const onFocus = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      setFocusVisible(matchesFocusVisible(event));
    },
    [],
  );
  const onBlur = useCallback(() => setFocusVisible(false), []);

  return {
    focusVisible,
    onBlur,
    onFocus,
  };
}
