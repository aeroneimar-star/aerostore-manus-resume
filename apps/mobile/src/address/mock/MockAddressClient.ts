import type { AddressClient } from '../AddressClient';
import type {
  Address,
  AddressListResponse,
  AddressResponse,
  CreateAddressPayload,
  EmptyAddressResponse,
  PostalCodeResponse,
  UpdateAddressPayload,
} from '../contracts';
import { AddressClientError } from '../AddressClientError';
import { ADDRESS_API_VERSION } from '../contracts';

type MockScenario = 'success' | 'empty' | 'postal_found' | 'postal_not_found' | 'internal_error' | 'session_expired' | 'access_denied';

interface MockAddressClientOptions {
  scenario?: MockScenario;
  latencyMs?: number;
}

const META: { api_version: typeof ADDRESS_API_VERSION } = { api_version: ADDRESS_API_VERSION };

function generateId(): string {
  return `addr-${Math.random().toString(36).slice(2, 10)}`;
}

function iso(): string {
  return new Date().toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function maskPostalCode(cep: string): string {
  return cep.slice(0, 5) + '-' + cep.slice(5);
}

export class MockAddressClient implements AddressClient {
  private addresses: Address[] = [];
  private scenario: MockScenario;
  private latencyMs: number;
  private failWhen: string | null = null;
  private failCode: string = '';
  private failStatus: number = 500;

  constructor(options: MockAddressClientOptions = {}) {
    this.scenario = options.scenario || 'success';
    this.latencyMs = options.latencyMs ?? 0;

    // Seed default address for smoke
    this.addresses = [
      {
        id: generateId(),
        label: 'Casa',
        recipientName: 'Joao Silva',
        postalCode: '14010-030',
        street: 'R. Saldanha Marinho',
        number: '807',
        complement: 'Apto 42',
        neighborhood: 'Centro',
        city: 'Ribeirao Preto',
        state: 'SP',
        deliveryInstructions: 'Portao azul',
        validationStatus: 'VALID',
        isDefault: true,
        version: 1,
        updatedAt: iso(),
      },
      {
        id: generateId(),
        label: 'Trabalho',
        recipientName: 'Joao Silva',
        postalCode: '14015-175',
        street: 'Av. Nove de Julho',
        number: '49',
        complement: '',
        neighborhood: 'Sumare',
        city: 'Ribeirao Preto',
        state: 'SP',
        deliveryInstructions: '',
        validationStatus: 'VALID',
        isDefault: false,
        version: 1,
        updatedAt: iso(),
      },
    ];
  }

  setScenario(s: MockScenario): void { this.scenario = s; }
  setLatency(ms: number): void { this.latencyMs = ms; }
  setFailWhen(method: string, code: string, status: number): void {
    this.failWhen = method; this.failCode = code; this.failStatus = status;
  }
  clearFail(): void { this.failWhen = null; }
  reset(): void { this.addresses = []; this.clearFail(); }

  private checkFail(method: string): void {
    if (this.failWhen && this.failWhen === method) {
      throw { status: this.failStatus, code: this.failCode, message: this.failCode };
    }
  }

  async listAddresses(): Promise<AddressListResponse | EmptyAddressResponse> {
    await wait(this.latencyMs);
    if (this.scenario === 'empty') {
      return { success: true, data: [], meta: META };
    }
    if (this.scenario === 'internal_error') {
      throw new AddressClientError('INTERNAL_ERROR', 'Erro interno simulado.');
    }
    if (this.scenario === 'session_expired') {
      throw { status: 401, code: 'APP_SESSION_INVALID', message: 'Sessao expirada.' };
    }
    if (this.scenario === 'access_denied') {
      throw { status: 403, code: 'APP_ACCESS_NOT_APPROVED', message: 'Acesso negado.' };
    }
    this.checkFail('listAddresses');
    return { success: true, data: [...this.addresses], meta: META };
  }

  async getAddress(addressId: string): Promise<AddressResponse> {
    await wait(this.latencyMs);
    this.checkFail('getAddress');
    const addr = this.addresses.find((a) => a.id === addressId);
    if (!addr) throw new AddressClientError('ADDRESS_NOT_FOUND', 'Endereco nao encontrado.', { status: 404 });
    return { success: true, data: addr, meta: META };
  }

  async createAddress(payload: CreateAddressPayload): Promise<AddressResponse> {
    await wait(this.latencyMs);
    this.checkFail('createAddress');
    if (!payload.recipient_name || !payload.postal_code || !payload.street || !payload.number || !payload.neighborhood || !payload.city || !payload.state) {
      throw new AddressClientError('INVALID_ADDRESS_FIELDS', 'Campos obrigatorios faltando.', { status: 400 });
    }
    const addr: Address = {
      id: generateId(),
      label: payload.label || 'Casa',
      recipientName: payload.recipient_name,
      postalCode: maskPostalCode(payload.postal_code.replace(/\D/g, '')),
      street: payload.street,
      number: payload.number,
      complement: payload.complement || '',
      neighborhood: payload.neighborhood,
      city: payload.city,
      state: payload.state,
      deliveryInstructions: payload.delivery_instructions || '',
      validationStatus: 'PENDING',
      isDefault: this.addresses.length === 0,
      version: 1,
      updatedAt: iso(),
    };
    this.addresses.push(addr);
    return { success: true, data: addr, meta: META };
  }

  async updateAddress(addressId: string, payload: UpdateAddressPayload): Promise<AddressResponse> {
    await wait(this.latencyMs);
    this.checkFail('updateAddress');
    const idx = this.addresses.findIndex((a) => a.id === addressId);
    if (idx < 0) throw new AddressClientError('ADDRESS_NOT_FOUND', 'Endereco nao encontrado.', { status: 404 });
    const existing = this.addresses[idx];
    if (payload.expectedVersion !== undefined && payload.expectedVersion !== existing.version) {
      throw new AddressClientError('ADDRESS_VERSION_CONFLICT', 'Endereco foi modificado.', { status: 409 });
    }
    const updated: Address = {
      ...existing,
      ...(payload.recipient_name !== undefined && { recipientName: payload.recipient_name }),
      ...(payload.street !== undefined && { street: payload.street }),
      ...(payload.number !== undefined && { number: payload.number }),
      ...(payload.complement !== undefined && { complement: payload.complement }),
      ...(payload.neighborhood !== undefined && { neighborhood: payload.neighborhood }),
      ...(payload.city !== undefined && { city: payload.city }),
      ...(payload.state !== undefined && { state: payload.state }),
      ...(payload.label !== undefined && { label: payload.label }),
      ...(payload.delivery_instructions !== undefined && { deliveryInstructions: payload.delivery_instructions }),
      version: existing.version + 1,
      updatedAt: iso(),
    };
    this.addresses[idx] = updated;
    return { success: true, data: updated, meta: META };
  }

  async archiveAddress(addressId: string): Promise<{ success: true; meta: typeof META }> {
    await wait(this.latencyMs);
    this.checkFail('archiveAddress');
    const idx = this.addresses.findIndex((a) => a.id === addressId);
    if (idx < 0) throw new AddressClientError('ADDRESS_NOT_FOUND', 'Endereco nao encontrado.', { status: 404 });
    this.addresses.splice(idx, 1);
    return { success: true, meta: META };
  }

  async setDefaultAddress(addressId: string): Promise<AddressResponse> {
    await wait(this.latencyMs);
    this.checkFail('setDefaultAddress');
    this.addresses = this.addresses.map((a) => ({ ...a, isDefault: a.id === addressId }));
    const addr = this.addresses.find((a) => a.id === addressId);
    if (!addr) throw new AddressClientError('ADDRESS_NOT_FOUND', 'Endereco nao encontrado.', { status: 404 });
    return { success: true, data: addr, meta: META };
  }

  async lookupPostalCode(cep: string): Promise<PostalCodeResponse> {
    await wait(this.latencyMs);
    const clean = cep.replace(/\D/g, '');
    if (clean.length !== 8) {
      throw new AddressClientError('POSTAL_CODE_INVALID', 'CEP deve ter 8 digitos.', { status: 400 });
    }
    if (this.scenario === 'postal_not_found') {
      return {
        success: true,
        data: { postalCode: maskPostalCode(clean), street: '', neighborhood: '', city: '', state: '', source: 'manual', found: false, manualEntryAllowed: true },
        meta: META,
      };
    }
    // Mock lookup: 14010xxx -> Ribeirao Preto
    if (clean.startsWith('14010')) {
      return {
        success: true,
        data: {
          postalCode: maskPostalCode(clean),
          street: 'R. Saldanha Marinho',
          neighborhood: 'Centro',
          city: 'Ribeirao Preto',
          state: 'SP',
          source: 'correios',
          found: true,
          manualEntryAllowed: true,
        },
        meta: META,
      };
    }
    if (clean.startsWith('01310')) {
      return {
        success: true,
        data: {
          postalCode: maskPostalCode(clean),
          street: 'Av. Paulista',
          neighborhood: 'Bela Vista',
          city: 'Sao Paulo',
          state: 'SP',
          source: 'correios',
          found: true,
          manualEntryAllowed: true,
        },
        meta: META,
      };
    }
    // Default: unknown CEP, allow manual
    return {
      success: true,
      data: { postalCode: maskPostalCode(clean), street: '', neighborhood: '', city: '', state: '', source: 'manual', found: false, manualEntryAllowed: true },
      meta: META,
    };
  }
}
