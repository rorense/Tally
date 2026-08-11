import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Modal,
  Pressable,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  ViewStyle,
} from 'react-native';
import { Colors, motion, radius } from '../theme/theme';
import { useThemedStyles } from '../theme/useTheme';

/**
 * A sheet that rises from the bottom of the screen over a dimmed backdrop.
 *
 * The animation is done by hand rather than with `animationType="slide"`,
 * which translates the whole modal — backdrop included — and so drags the dim
 * up the screen as a visible black rectangle. Here the backdrop fades while
 * only the sheet slides, both on the native driver, so a caller re-rendering
 * the screen behind the sheet cannot stutter the dismissal.
 *
 * `visible` is the caller's intent; the sheet stays mounted past it for as
 * long as the exit takes. Pass padding and any height cap through `style`.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  style,
  closeLabel = 'Close',
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Accessibility label for the backdrop, which dismisses on tap. */
  closeLabel?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const { height: windowHeight } = useWindowDimensions();

  const [mounted, setMounted] = useState(visible);
  const [sheetHeight, setSheetHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    // Hold the entrance until the sheet has been measured, so it travels
    // exactly its own height. The wait costs a frame and cannot be seen: at
    // progress 0 the sheet is off screen at either distance.
    if (visible && sheetHeight === 0) return;

    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? motion.sheetIn : motion.sheetOut,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Unfinished means a reopen interrupted the dismissal. Stay mounted and
      // let the next run pick up from wherever this one stopped.
      if (!finished || visible) return;
      setMounted(false);
      setSheetHeight(0);
    });
  }, [mounted, visible, sheetHeight, progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    // Any distance past the sheet's own height hides it equally well, so the
    // window is a safe stand-in until the real measurement arrives.
    outputRange: [sheetHeight || windowHeight, 0],
  });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        />
      </Animated.View>
      <Animated.View
        onLayout={(e: LayoutChangeEvent) => setSheetHeight(e.nativeEvent.layout.height)}
        style={[styles.sheet, style, { transform: [{ translateY }] }]}>
        {children}
      </Animated.View>
    </Modal>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
  });
