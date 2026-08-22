const OpenAI = require("openai");

// Lazy init: o client so e criado quando um recurso de IA e realmente usado.
// Assim o servidor sobe mesmo sem OPENAI_API_KEY configurada.
let openaiClient = null;

function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return openaiClient;
}
