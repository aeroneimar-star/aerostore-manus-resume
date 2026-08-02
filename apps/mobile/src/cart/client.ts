import { HttpCartClient } from './http/HttpCartClient';
import { MockCartClient } from './mock/MockCartClient';

export function createCartClient(options: { mode?: 'http' | 'mock'; baseUrl?: string; accessToken?: string } = {}) {
  if (options.mode === 'mock') {
    return new MockCartClient();
  }
  if (options.baseUrl) {
    return new HttpCartClient({ baseUrl, accessToken: options.accessToken });
  }
  return new MockCartClient();
}
