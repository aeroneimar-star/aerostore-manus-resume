export class OrderClientError extends Error {
  code: string;
  httpStatus: number;

  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.name = "OrderClientError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
