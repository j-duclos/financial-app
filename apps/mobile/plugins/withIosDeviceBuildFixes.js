const fs = require("node:fs");
const path = require("node:path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withPodfile,
  withXcodeProject,
} = require("expo/config-plugins");

const FMT_POST_INSTALL = `
    # FlowSight: Xcode 26 Apple clang rejects fmt 11 FMT_STRING consteval
    # on both iPhoneOS and iPhoneSimulator SDKs. C++17 plus Apple-clang header patch.
    installer.pods_project.targets.each do |target|
      next unless target.name == 'fmt'
      target.build_configurations.each do |cfg|
        cfg.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end
    fmt_base = File.join(installer.sandbox.root, 'fmt/include/fmt/base.h')
    if File.exist?(fmt_base)
      File.chmod(0644, fmt_base)
      contents = File.read(fmt_base)
      patched = contents.gsub(
        'defined(__apple_build_version__) && __apple_build_version__ < 14000029L',
        'defined(__apple_build_version__)'
      )
      File.write(fmt_base, patched) if patched != contents
    end
`;

function injectFmtXcode26Podfile(contents) {
  if (contents.includes("FlowSight: Xcode 26 Apple clang rejects fmt")) {
    return contents;
  }
  const needle = "    react_native_post_install(";
  const idx = contents.indexOf(needle);
  if (idx === -1) {
    return contents;
  }
  const end = contents.indexOf("    )\n", idx);
  if (end === -1) {
    return contents;
  }
  const insertAt = end + "    )\n".length;
  return contents.slice(0, insertAt) + FMT_POST_INSTALL + contents.slice(insertAt);
}

function isPaidAppleIosCapabilities() {
  const paid = (process.env.APPLE_PAID_IOS_CAPABILITIES ?? "").trim().toLowerCase();
  return paid === "1" || paid === "true" || paid === "yes";
}

/** Personal Apple teams cannot sign Push; leftover capability blocks iPhone installs. */
function withStripPushEntitlementsForPersonalTeam(config) {
  if (isPaidAppleIosCapabilities()) {
    return config;
  }
  config = withEntitlementsPlist(config, (mod) => {
    delete mod.modResults["aps-environment"];
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    const modes = mod.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      mod.modResults.UIBackgroundModes = modes.filter((mode) => mode !== "remote-notification");
      if (mod.modResults.UIBackgroundModes.length === 0) {
        delete mod.modResults.UIBackgroundModes;
      }
    }
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const objects = mod.modResults.hash.project.objects;
    const projects = objects.PBXProject ?? {};
    for (const project of Object.values(projects)) {
      const attrs = project.attributes?.TargetAttributes;
      if (!attrs) continue;
      for (const target of Object.values(attrs)) {
        if (target.SystemCapabilities?.["com.apple.Push"]) {
          delete target.SystemCapabilities["com.apple.Push"];
        }
      }
    }
    return mod;
  });
}

/** fmt 11 + Xcode 26: same fix for iPhone and Simulator destinations. */
function withFmtXcode26Fix(config) {
  return withPodfile(config, (mod) => {
    mod.modResults.contents = injectFmtXcode26Podfile(mod.modResults.contents);
    return mod;
  });
}

const APP_DELEGATE_BUNDLE_URL = `  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bundleURL()
  }

  override func bundleURL() -> URL? {
#if targetEnvironment(simulator)
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }`;

const APP_DELEGATE_BUNDLE_URL_STOCK = `  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }`;

function replaceAppDelegateBundleURL(src) {
  if (src.includes("targetEnvironment(simulator)")) {
    return src;
  }
  if (src.includes(APP_DELEGATE_BUNDLE_URL_STOCK)) {
    return src.replace(APP_DELEGATE_BUNDLE_URL_STOCK, APP_DELEGATE_BUNDLE_URL);
  }
  const start = src.indexOf("  override func sourceURL(for bridge: RCTBridge)");
  const end = src.indexOf("\n}", start);
  if (start === -1 || end === -1) return src;
  const classEnd = src.indexOf("\n}", end + 1);
  if (classEnd === -1) return src;
  return src.slice(0, start) + APP_DELEGATE_BUNDLE_URL + src.slice(classEnd);
}

/** iPhone never loads Metro. Simulator Debug still can. */
function withPreferEmbeddedJsBundle(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const file = path.join(mod.modRequest.platformProjectRoot, "FlowSight", "AppDelegate.swift");
      if (!fs.existsSync(file)) return mod;
      const src = fs.readFileSync(file, "utf8");
      const next = replaceAppDelegateBundleURL(src);
      if (next !== src) fs.writeFileSync(file, next);
      return mod;
    },
  ]);
}

const XCODE_ENV_UPDATES = `# Physical iPhone: ship a production JS bundle. Do not talk to Metro.
# Expo Debug sets SKIP_BUNDLING=1 and React Native writes ip.txt (LAN Metro IP).
# That is not flowsight360.com. Cellular / Local Network prohibited then red-screens.
if [ "$PLATFORM_NAME" = "iphoneos" ]; then
  unset SKIP_BUNDLING
  export FORCE_BUNDLING=1
  export SKIP_BUNDLING_METRO_IP=1
  # react-native-xcode.sh sets DEV from CONFIGURATION; keep this script-local.
  export CONFIGURATION=Release
  rm -f "\${TARGET_BUILD_DIR:-}/\${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}/ip.txt" 2>/dev/null || true
  rm -f "\${CONFIGURATION_BUILD_DIR:-}/ip.txt" 2>/dev/null || true
  rm -f "\${CONFIGURATION_BUILD_DIR:-}/\${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}/ip.txt" 2>/dev/null || true
fi
`;

function withIphoneosAlwaysBundleJs(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const file = path.join(mod.modRequest.platformProjectRoot, ".xcode.env.updates");
      fs.writeFileSync(file, XCODE_ENV_UPDATES);
      return mod;
    },
  ]);
}

/** Xcode Run defaults to Debug, which always asks Metro. Device installs should be Release. */
function withReleaseLaunchScheme(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const file = path.join(
        mod.modRequest.platformProjectRoot,
        "FlowSight.xcodeproj/xcshareddata/xcschemes/FlowSight.xcscheme"
      );
      if (!fs.existsSync(file)) return mod;
      let src = fs.readFileSync(file, "utf8");
      src = src.replace(
        /<LaunchAction(\s+)buildConfiguration = "Debug"/,
        `<LaunchAction$1buildConfiguration = "Release"`
      );
      fs.writeFileSync(file, src);
      return mod;
    },
  ]);
}

module.exports = {
  injectFmtXcode26Podfile,
  withStripPushEntitlementsForPersonalTeam,
  withFmtXcode26Fix,
  withPreferEmbeddedJsBundle,
  withReleaseLaunchScheme,
  withIphoneosAlwaysBundleJs,
};
