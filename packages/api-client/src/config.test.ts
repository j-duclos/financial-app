import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, configureApiClient, fetchAuthenticatedFile, request } from "./config";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

function empty401(): Response {
  return {
    status: 401,
    ok: false,
    text: async () => "",
  } as Response;
}

describe("configureApiClient unauthorized handling", () => {
  const onUnauthorized = vi.fn();
  const setAccessToken = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    onUnauthorized.mockReset();
    setAccessToken.mockReset();
    configureApiClient({
      baseUrl: "http://test.local",
      getAccessToken: () => "access-old",
      getRefreshToken: () => "refresh-token",
      setAccessToken,
      onUnauthorized,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes access and retries the protected request after 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(empty401())
      .mockResolvedValueOnce(jsonResponse(200, { access: "access-new" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request<{ id: number }>("/api/profile/");

    expect(result).toEqual({ id: 1 });
    expect(setAccessToken).toHaveBeenCalledWith("access-new");
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("invokes onUnauthorized when refresh fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(empty401())
      .mockResolvedValueOnce(empty401());
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/api/profile/")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("invokes onUnauthorized when retry still returns 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(empty401())
      .mockResolvedValueOnce(jsonResponse(200, { access: "access-new" }))
      .mockResolvedValueOnce(empty401());
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/api/profile/")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onUnauthorized for public login failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(empty401());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      request("/api/auth/token/", { method: "POST", body: "{}" })
    ).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("does not invoke onUnauthorized for public password-reset failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(empty401());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      request("/api/auth/forgot-password/", { method: "POST", body: "{}" })
    ).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("shares one refresh for concurrent 401s and notifies unauthorized once", async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/auth/refresh/")) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return empty401();
      }
      return empty401();
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.allSettled([
      request("/api/profile/"),
      request("/api/accounts/"),
      request("/api/dashboard/summary-fast/"),
    ]);

    expect(refreshCalls).toBe(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("resets unauthorized notification when configureApiClient is called again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(empty401());
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/api/profile/")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    configureApiClient({
      baseUrl: "http://test.local",
      getAccessToken: () => "access-old",
      getRefreshToken: () => "refresh-token",
      setAccessToken,
      onUnauthorized,
    });

    await expect(request("/api/profile/")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(2);
  });

  it("flattens nested errors objects from guided-strategy validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        detail: "Guided strategy configuration is invalid.",
        errors: {
          source_account_id: "Source account must be an eligible cash/asset account.",
          savings_transfer_rule_ids: ["Select at least one savings-transfer rule."],
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/api/scenarios/12/guided-strategy/")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("source_account_id"),
    });
  });
});

describe("fetchAuthenticatedFile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    configureApiClient({
      baseUrl: "http://test.local",
      getAccessToken: () => "access-token",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns bytes and Content-Disposition filename without using the DOM", async () => {
    const body = new TextEncoder().encode('{"ok":true}');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-disposition"
            ? 'attachment; filename="financial-app-export-2026-09-06.json"'
            : name.toLowerCase() === "content-type"
              ? "application/json"
              : null,
      },
      arrayBuffer: async () => body.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = await fetchAuthenticatedFile(
      "/api/profile/export-data/",
      "financial-app-data-2026-09-06.json"
    );
    expect(file.filename).toBe("financial-app-export-2026-09-06.json");
    expect(file.contentType).toBe("application/json");
    expect(Array.from(file.data.slice(0, 1))).toEqual([body[0]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
