import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { createTheme, type AppTheme, type ThemeMode } from "./tokens";

const ThemeContext = createContext<AppTheme>(createTheme("light"));

export function ThemeProvider({
  children,
  forceMode,
}: {
  children: React.ReactNode;
  forceMode?: ThemeMode;
}) {
  const system = useColorScheme();
  const theme = useMemo(() => {
    const mode: ThemeMode = forceMode ?? (system === "dark" ? "dark" : "light");
    return createTheme(mode);
  }, [forceMode, system]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}
