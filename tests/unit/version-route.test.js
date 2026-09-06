import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
}));

vi.mock("@/lib/updateNotifier", () => ({
  checkForUpdate: mocks.checkForUpdate,
}));

const { GET } = await import("../../src/app/api/version/route.js");

describe("GET /api/version", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkForUpdate.mockResolvedValue({
      currentVersion: "0.5.65",
      latestVersion: "0.5.66",
      hasUpdate: true,
      source: "https://github.com/arsydoni4326-alt/9routercustom.git",
    });
  });

  it("returns update info sourced from the custom fork repo", async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.hasUpdate).toBe(true);
    expect(body.latestVersion).toBe("0.5.66");
    expect(body.currentVersion).toBe("0.5.65");
    expect(body.source).toContain("9routercustom");
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports no update when versions match", async () => {
    mocks.checkForUpdate.mockResolvedValue({
      currentVersion: "0.5.65",
      latestVersion: "0.5.65",
      hasUpdate: false,
      source: "https://github.com/arsydoni4326-alt/9routercustom.git",
    });

    const response = await GET();
    const body = await response.json();

    expect(body.hasUpdate).toBe(false);
  });
});