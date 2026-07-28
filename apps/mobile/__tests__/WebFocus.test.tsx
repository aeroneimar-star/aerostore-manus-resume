import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';
import { StyleSheet } from 'react-native';

import { mockCatalogItems } from '@/catalog/mock/mockCatalogData';
import { FilterChips } from '@/components/FilterChips';
import { ProductCard } from '@/components/ProductCard';
import { ScreenState } from '@/components/ScreenState';
import { theme } from '@/theme';

const keyboardFocusEvent = {
  currentTarget: {
    matches: (selector: string) => selector === ':focus-visible',
  },
};

const pointerFocusEvent = {
  currentTarget: {
    matches: () => false,
  },
};

const expectVisibleFocus = (style: unknown) => {
  expect(StyleSheet.flatten(style)).toEqual(
    expect.objectContaining({
      outlineColor: theme.colors.copperSoft,
      outlineOffset: -3,
      outlineStyle: 'solid',
      outlineWidth: 3,
    }),
  );
};

describe('visible Web focus', () => {
  it('shows keyboard focus on filter chips and preserves selection', () => {
    const onChange = jest.fn();
    const screen = render(
      <FilterChips
        label="Filtrar"
        options={[
          { label: 'Todos', value: undefined },
          { label: 'Polos', value: 'polos' },
        ]}
        value={undefined}
        onChange={onChange}
      />,
    );

    fireEvent(screen.getByLabelText('Polos'), 'focus', keyboardFocusEvent);
    expectVisibleFocus(screen.getByLabelText('Polos').props.style);
    expect(screen.getByLabelText('Todos')).toHaveProp('accessibilityState', {
      checked: true,
    });

    fireEvent.press(screen.getByLabelText('Polos'));
    expect(onChange).toHaveBeenCalledWith('polos');

    fireEvent(screen.getByLabelText('Polos'), 'blur');
    expect(StyleSheet.flatten(screen.getByLabelText('Polos').props.style)).not.toEqual(
      expect.objectContaining({ outlineWidth: 3 }),
    );
  });

  it('shows keyboard focus on a product card and preserves activation', () => {
    const onPress = jest.fn();
    const label = `Ver produto ${mockCatalogItems[0].title}`;
    const screen = render(
      <ProductCard item={mockCatalogItems[0]} width={320} onPress={onPress} />,
    );

    fireEvent(screen.getByLabelText(label), 'focus', keyboardFocusEvent);
    expectVisibleFocus(screen.getByLabelText(label).props.style);

    fireEvent.press(screen.getByLabelText(label));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows keyboard focus on retry and preserves its callback', () => {
    const onRetry = jest.fn();
    const screen = render(<ScreenState kind="error" onRetry={onRetry} />);

    fireEvent(
      screen.getByLabelText('Tentar carregar novamente'),
      'focus',
      keyboardFocusEvent,
    );
    expectVisibleFocus(
      screen.getByLabelText('Tentar carregar novamente').props.style,
    );

    fireEvent.press(screen.getByLabelText('Tentar carregar novamente'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show a persistent focus ring for pointer focus', () => {
    const screen = render(
      <ProductCard
        item={mockCatalogItems[0]}
        width={320}
        onPress={jest.fn()}
      />,
    );
    const label = `Ver produto ${mockCatalogItems[0].title}`;

    fireEvent(screen.getByLabelText(label), 'focus', pointerFocusEvent);
    expect(StyleSheet.flatten(screen.getByLabelText(label).props.style)).not.toEqual(
      expect.objectContaining({ outlineWidth: 3 }),
    );
  });
});
