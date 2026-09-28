import { describe, expect, it } from "vitest";
import { injectFmtXcode26Podfile } from "./withIosDeviceBuildFixes";

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
