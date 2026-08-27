import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui";
import { captureError } from "@/lib/monitoring";
import { useTheme } from "@/theme";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

function ErrorFallback({ error, onRetry, onHome }: { error: Error | null; onRetry: () => void; onHome: () => void }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: theme.spacing.lg,
        backgroundColor: theme.colors.background,
      }}
    >
      <Text style={{ color: theme.colors.text, ...theme.typography.title, marginBottom: 8 }}>
        Something went wrong
      </Text>
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.lg }}>
        The app hit an unexpected error. Your data on the server is unchanged. Try again or return to Home.
      </Text>
      {__DEV__ && error ? (
        <Text
          selectable
          style={{
            color: theme.colors.textMuted,
            fontSize: 11,
            marginBottom: theme.spacing.lg,
            fontFamily: "SpaceMono",
          }}
        >
          {error.message}
        </Text>
      ) : null}
      <View style={{ gap: theme.spacing.sm }}>
        <Button label="Try again" onPress={onRetry} />
        <Button label="Go to Home" variant="secondary" onPress={onHome} />
      </View>
    </View>
  );
}

/** Top-level error boundary — no stack traces in production UI. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureError(error, { componentStack: info.componentStack?.slice(0, 500) ?? "" });
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <AppErrorBoundaryFallback
          error={this.state.error}
          onRetry={this.reset}
        />
      );
    }
    return this.props.children;
  }
}

function AppErrorBoundaryFallback({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}) {
  const router = useRouter();
  return (
    <ErrorFallback
      error={error}
      onRetry={onRetry}
      onHome={() => {
        onRetry();
        router.replace("/(app)/(tabs)");
      }}
    />
  );
}
