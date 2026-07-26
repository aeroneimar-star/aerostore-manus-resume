import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { theme } from '@/theme';

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
          <Pressable
            key={`${String(option.value)}-${option.label}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={
              option.count === undefined
                ? option.label
                : `${option.label}, ${option.count} produtos`
            }
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && styles.chipPressed,
            ]}>
            <Text style={[styles.label, active && styles.labelActive]}>
              {option.label}
              {option.count === undefined ? '' : `  ${option.count}`}
            </Text>
          </Pressable>
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
    borderColor: '#373631',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.sizes.touch,
    paddingHorizontal: theme.spacing.md,
  },
  chipActive: {
    backgroundColor: theme.colors.ivory,
    borderColor: theme.colors.ivory,
  },
  chipPressed: {
    opacity: 0.7,
  },
  label: {
    color: theme.colors.paper,
    fontFamily: theme.typography.body,
    fontSize: 13,
    fontWeight: '600',
  },
  labelActive: {
    color: theme.colors.ink,
  },
});
