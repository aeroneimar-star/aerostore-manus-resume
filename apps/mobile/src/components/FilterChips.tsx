import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import {
  useWebFocusVisible,
  webFocusVisibleStyle,
} from '@/accessibility/useWebFocusVisible';
import { useAppTheme, theme } from '@/theme';

export interface ChipOption<T extends string | boolean | undefined> {
  label: string;
  value: T;
  count?: number;
}

interface FilterChipsProps<T extends string | boolean | undefined> {
  label: string;
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

interface FilterChipProps<T extends string | boolean | undefined> {
  active: boolean;
  onChange: (value: T) => void;
  option: ChipOption<T>;
}

function FilterChip<T extends string | boolean | undefined>({
  active,
  onChange,
  option,
}: FilterChipProps<T>) {
  const focus = useWebFocusVisible();
  const { tokens } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={
        option.count === undefined
          ? option.label
          : `${option.label}, ${option.count} produtos`
      }
      onBlur={focus.onBlur}
      onFocus={focus.onFocus}
      onPress={() => onChange(option.value)}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: tokens.borderStrong },
        active && { backgroundColor: tokens.primary, borderColor: tokens.primary },
        pressed && styles.chipPressed,
        focus.focusVisible && webFocusVisibleStyle,
      ]}>
      <Text style={[styles.label, { color: tokens.textSecondary }, active && { color: tokens.primaryText }]}>
        {option.label}
        {option.count === undefined ? '' : `  ${option.count}`}
      </Text>
    </Pressable>
  );
}

export function FilterChips<T extends string | boolean | undefined>({
  label,
  options,
  value,
  onChange,
}: FilterChipsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <FilterChip
            key={`${String(option.value)}-${option.label}`}
            active={active}
            onChange={onChange}
            option={option}
          />
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: theme.spacing.xs,
    paddingRight: theme.spacing.lg,
  },
  chip: {
    alignItems: 'center',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.sizes.touch,
    paddingHorizontal: theme.spacing.md,
  },
  chipPressed: {
    opacity: 0.7,
  },
  label: {
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '600',
  },
});
