import { expect, vi, beforeAll } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

// Mock @vercel/blob to avoid network calls and access denied errors
vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockImplementation(async () => ({ url: "http://mock-blob-url.com/file.txt" })),
  del: vi.fn().mockResolvedValue(undefined),
  head: vi.fn().mockResolvedValue({ url: "http://mock-blob-url.com/file.txt" }),
  list: vi.fn().mockResolvedValue({ blobs: [] }),
}));

// Mock localStorage
const localStorageMock = (function () {
  let store: Record<string, string> = {};
  return {
    getItem: function (key: string) {
      return store[key] || null;
    },
    setItem: function (key: string, value: string) {
      store[key] = value.toString();
    },
    clear: function () {
      store = {};
    },
    removeItem: function (key: string) {
      delete store[key];
    },
    length: 0,
    key: function (index: number) {
      return Object.keys(store)[index] || null;
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Ensure Vercel Blob tokens are unset to force local filesystem usage in tests
beforeAll(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL_BLOB_RW_TOKEN;
});
