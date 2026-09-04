module.exports = function (api) {
  // Re-transform when API env changes so EXPO_PUBLIC_* is not stuck inlined empty.
  api.cache.using(
    () => `${process.env.EXPO_PUBLIC_API_URL ?? ""}|${process.env.EXPO_PUBLIC_APP_ENV ?? ""}`
  );
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-reanimated/plugin"],
  };
};
