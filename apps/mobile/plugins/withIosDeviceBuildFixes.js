const {
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

module.exports = {
  injectFmtXcode26Podfile,
  withStripPushEntitlementsForPersonalTeam,
  withFmtXcode26Fix,
};
