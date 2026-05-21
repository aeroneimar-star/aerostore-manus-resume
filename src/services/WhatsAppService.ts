// src/services/WhatsAppService.ts

export class WhatsAppService {
  static sendPin(phone: string, pin: string, storeName: string) {
    // Simula envio via WhatsApp e destaca o PIN no console
    console.log("\n==============================");
    console.log("[AEROSTORE] ENVIO DE PIN VIA WHATSAPP");
    console.log(`Telefone: ${phone}`);
    console.log(`Loja: ${storeName}`);
    console.log("PIN DE VALIDAÇÃO: ");
    console.log("\x1b[42m\x1b[30m", pin, "\x1b[0m"); // Destaque visual (fundo verde, texto preto)
    console.log("==============================\n");
  }
}
