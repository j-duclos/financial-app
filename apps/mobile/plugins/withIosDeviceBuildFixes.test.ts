import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { injectFmtXcode26Podfile } from "./withIosDeviceBuildFixes";

const pluginJs = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "withIosDeviceBuildFixes.js"),
  "utf8"
);

describe("injectFmtXcode26Podfile", () => {
  it("injects C++17 for the fmt pod after react_native_post_install", () => {
    const contents = injectFmtXcode26Podfile(`    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`);
    expect(contents).toContain("CLANG_CXX_LANGUAGE_STANDARD");
    expect(contents).toContain("target.name == 'fmt'");
    expect(contents).toContain("File.chmod(0644, fmt_base)");
  });

  it("is idempotent", () => {
    const once = injectFmtXcode26Podfile(`    react_native_post_install(
      installer,
    )
`);
    expect(injectFmtXcode26Podfile(once)).toBe(once);
  });
});

describe("iPhone JS embedding", () => {
  it("embeds JS on physical iPhone instead of Metro", () => {
    expect(pluginJs).toMatch(/FORCE_BUNDLING=1/);
    expect(pluginJs).toMatch(/SKIP_BUNDLING_METRO_IP=1/);
    expect(pluginJs).toMatch(/export CONFIGURATION=Release/);
    expect(pluginJs).toMatch(/targetEnvironment\(simulator\)/);
  });
});
