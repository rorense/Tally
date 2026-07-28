import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing, type } from '../theme/theme';

export function Screen({ children, scroll = true }: { children?: ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={styles.screen}>{children}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function H2({ children }: { children: ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: colors.textMuted }]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  return <Text style={styles.caption}>{children}</Text>;
}

export function Field({
  label,
  hint,
  containerStyle,
  ...props
}: TextInputProps & { label?: string; hint?: string; containerStyle?: ViewStyle }) {
  return (
    <View style={[{ marginBottom: spacing.lg }, containerStyle]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...props}
        style={[styles.input, props.style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.accent },
        variant === 'secondary' && {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: colors.border,
        },
        variant === 'danger' && { backgroundColor: colors.danger },
        pressed && { opacity: 0.75 },
        isDisabled && { opacity: 0.45 },
      ]}>
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'secondary' && { color: colors.text },
          ]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/** Horizontally scrolling single-select chip row, used for categories and countries. */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  colorFor,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  colorFor?: (v: T) => string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.xs }}>
      {options.map((opt) => {
        const active = opt === value;
        const tint = colorFor?.(opt) ?? colors.accent;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[
              styles.chip,
              active && { backgroundColor: tint, borderColor: tint },
            ]}>
            <Text style={[styles.chipText, active && { color: '#0B0E14' }]}>{opt}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ProgressBar({
  value,
  max,
  color = colors.accent,
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const over = max > 0 && value > max;
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${pct * 100}%`, backgroundColor: over ? colors.danger : color },
        ]}
      />
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  h1: { ...type.display, color: colors.text, marginBottom: spacing.xs },
  h2: { ...type.title, color: colors.text, marginBottom: spacing.md },
  body: { ...type.body, color: colors.text },
  caption: { ...type.caption, color: colors.textMuted },
  fieldLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  hint: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs },
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.lg - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { ...type.heading, color: '#fff' },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { ...type.label, color: colors.textMuted },
  progressTrack: {
    height: 8,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.pill },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { ...type.heading, color: colors.textMuted, marginBottom: spacing.xs },
  emptySub: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
});
