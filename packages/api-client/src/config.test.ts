import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, configureApiClient, request } from "./config";

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
});
