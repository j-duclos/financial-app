import React, { useEffect, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { Button } from "./Button";

type SheetProps = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Lift the sheet above the software keyboard (search/filter inputs). */
  keyboardAware?: boolean;
};

function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInset(0);
      return;
    }

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (event: KeyboardEvent) => {
      setInset(event.endCoordinates.height);
    };
    const onHide = () => setInset(0);

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [enabled]);

  return enabled ? inset : 0;
}

export function BottomSheet({
  visible,
  title,
  onClose,
  children,
  contentStyle,
  keyboardAware = false,
}: SheetProps) {
  const theme = useTheme();
  const safeInsets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset(visible && keyboardAware);

  const dismiss = () => {
    Keyboard.dismiss();
    onClose();
  };

  useEffect(() => {
    if (!visible) Keyboard.dismiss();
  }, [visible]);

  const sheetBottom = Math.max(0, keyboardInset - safeInsets.bottom);
  const keyboardMaxHeight =
    keyboardAware && keyboardInset > 0
      ? Dimensions.get("window").height - keyboardInset - 16
      : undefined;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={dismiss}>
      <View style={styles.modalRoot}>
        <Pressable
          style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}
          onPress={dismiss}
          accessibilityLabel="Dismiss"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              padding: theme.spacing.lg,
              paddingBottom: theme.spacing.xxl,
              bottom: sheetBottom,
              ...(keyboardMaxHeight != null ? { maxHeight: keyboardMaxHeight } : {}),
            },
            contentStyle,
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          </View>
          {title ? (
            <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 12 }}>
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

type ConfirmProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.overlayCenter, { backgroundColor: theme.colors.overlay }]}>
        <View
          accessibilityRole="alert"
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.xl,
            marginHorizontal: theme.spacing.xl,
            gap: theme.spacing.md,
          }}
        >
          <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>{title}</Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>{message}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label={cancelLabel} variant="secondary" onPress={onCancel} disabled={loading} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={confirmLabel}
                variant={destructive ? "danger" : "primary"}
                onPress={onConfirm}
                loading={loading}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayCenter: { flex: 1, justifyContent: "center" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    maxHeight: "85%",
  },
  handleWrap: { alignItems: "center", marginBottom: 8 },
  handle: { width: 40, height: 4, borderRadius: 2 },
});
