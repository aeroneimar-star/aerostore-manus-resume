import { AddressClientError } from './AddressClientError';
import { HttpAddressClient } from './http/HttpAddressClient';
import { MockAddressClient } from './mock/MockAddressClient';
import type { AddressClient } from './contracts';

export type AddressSource = 'mock' | 'http';

const readAddressSource = (value: string | undefined): AddressSource => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return process.env.EXPO_PUBLIC_APP_AUTH_SOURCE === 'visual' ? 'mock' : 'http';
  if (normalized === 'mock' || normalized === 'http') return normalized;
  throw new AddressClientError('INTERNAL_ERROR', 'EXPO_PUBLIC_ADDRESS_SOURCE deve ser mock ou http.');
};

export function createAddressClient(): AddressClient {
  const source = readAddressSource(process.env.EXPO_PUBLIC_ADDRESS_SOURCE);
  if (source === 'mock') return new MockAddressClient({ scenario: 'success' });
  const baseUrl = process.env.EXPO_PUBLIC_APP_AUTH_API_URL?.trim() ?? '';
  if (!baseUrl) {
    const unavailable = async () => { throw new AddressClientError('INTERNAL_ERROR', 'A API de enderecos nao foi configurada.'); };
    return {
      listAddresses: unavailable,
      getAddress: unavailable,
      createAddress: unavailable,
      updateAddress: unavailable,
      archiveAddress: unavailable,
      setDefaultAddress: unavailable,
      lookupPostalCode: unavailable,
    } as unknown as AddressClient;
  }
  return new HttpAddressClient({ baseUrl });
}

export const addressClient = createAddressClient();
