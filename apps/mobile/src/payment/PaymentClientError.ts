export class PaymentClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string
  ) {
    super(message || code);
    this.name = "PaymentClientError";
  }
}
