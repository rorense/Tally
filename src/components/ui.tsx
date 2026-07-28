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
import { Colors, onFill, radius, spacing, type } from '../theme/theme';
import { useTheme, useThemedStyles } from '../theme/useTheme';

export function Screen({ children, scroll = true }: { children?: ReactNode; scroll?: boolean }) {
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.h1}>{children}</Text>;
}

export function H2({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.h2}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={[styles.body, muted && styles.bodyMuted]}>{children}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.caption}>{children}</Text>;
}

export function Field({
  label,
  hint,
  containerStyle,
  ...props
}: TextInputProps & { label?: string; hint?: string; containerStyle?: ViewStyle }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
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
  const styles = useThemedStyles(createStyles);
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && { opacity: 0.75 },
        isDisabled && { opacity: 0.45 },
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' ? styles.buttonTextSecondary.color : styles.buttonText.color}
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'primary' && styles.buttonTextPrimary,
            variant === 'secondary' && styles.buttonTextSecondary,
            variant === 'danger' && styles.buttonTextDanger,
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
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
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
            style={[styles.chip, active && { backgroundColor: tint, borderColor: tint }]}>
            <Text style={[styles.chipText, active && { color: onFill(tint) }]}>{opt}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const over = max > 0 && value > max;
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${pct * 100}%`, backgroundColor: over ? colors.danger : color ?? colors.accent },
        ]}
      />
    </View>
  );
}

export function Divider() {
  const styles = useThemedStyles(createStyles);
  return <View style={styles.divider} />;
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    screenContent: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: spacing.lg,
    },
    h1: { ...type.display, color: c.text, marginBottom: spacing.xs },
    h2: { ...type.title, color: c.text, marginBottom: spacing.md },
    body: { ...type.body, color: c.text },
    bodyMuted: { color: c.textMuted },
    caption: { ...type.caption, color: c.textMuted },
    fieldLabel: {
      ...type.label,
      color: c.textMuted,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    input: {
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      color: c.text,
      fontSize: 16,
    },
    hint: { ...type.caption, color: c.textFaint, marginTop: spacing.xs },
    button: {
      borderRadius: radius.md,
      paddingVertical: spacing.lg - 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonPrimary: { backgroundColor: c.accent },
    buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.border },
    buttonDanger: { backgroundColor: c.danger },
    buttonText: { ...type.heading, color: onFill(c.accent) },
    buttonTextPrimary: { color: onFill(c.accent) },
    buttonTextSecondary: { color: c.text },
    buttonTextDanger: { color: onFill(c.danger) },
    chip: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceRaised,
    },
    chipText: { ...type.label, color: c.textMuted },
    progressTrack: {
      height: 8,
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', borderRadius: radius.pill },
    divider: { height: 1, backgroundColor: c.border, marginVertical: spacing.md },
    empty: { alignItems: 'center', paddingVertical: spacing.xxl },
    emptyTitle: { ...type.heading, color: c.textMuted, marginBottom: spacing.xs },
    emptySub: { ...type.caption, color: c.textFaint, textAlign: 'center' },
  });
