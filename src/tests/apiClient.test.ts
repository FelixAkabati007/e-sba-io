import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request } from '../lib/apiClient';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('apiClient', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Reset window/localStorage if needed, but apiClient checks them safely
  });

  it('should throw "Network Error" when fetch fails with "Failed to fetch"', async () => {
    fetchMock.mockRejectedValue(new Error('TypeError: Failed to fetch'));

    await expect(request('/test', 'GET')).rejects.toThrow(
      'Network Error: Unable to connect to server'
    );
  });

  it('should throw "Request timed out" when fetch is aborted', async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    fetchMock.mockRejectedValue(error);

    await expect(request('/test', 'GET')).rejects.toThrow(
      'Request timed out'
    );
  });

  it('should return data when fetch succeeds', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true }),
    });

    const result = await request('/test', 'GET');
    expect(result).toEqual({ success: true });
  });
});
