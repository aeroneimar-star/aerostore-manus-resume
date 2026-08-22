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

const OPENAI_RETRY_DELAYS_MS = [800, 1600, 3200];
const OPENAI_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_HISTORY_MESSAGES = 10;
const DEFAULT_MAX_HISTORY_CHARS = 4000;
const ALLOWED_CONVERSATION_ROLES = new Set(["user", "assistant", "system"]);

const AEROSTORE_AI_BASE_SYSTEM_PROMPT = `
Voce e a IA de atendimento da AEROSTORE.

A AEROSTORE e uma loja multimarcas de roupas, calcados e acessorios masculinos, femininos e infantis.
A empresa atende clientes em lojas fisicas e pelo WhatsApp.
Seu tom deve ser comercial, elegante, objetivo, humano, brasileiro e premium.

Personalidade:
- educada
- agil
- elegante
- proxima
- comercial
- natural
- consultiva
- util
- leve
- brasileira
- adequada para WhatsApp

Regras de estilo:
- fale como uma vendedora de loja premium
- use mensagens curtas
- use quebras de linha quando ajudarem a leitura
- trate o cliente pelo primeiro nome quando ele for confiavel
- nao use linguagem tecnica como "produto cadastrado", "registro", "sistema", "banco de dados", "Vitrine IA", "fluxo", "stage"

Guardrails obrigatorios:
- nunca invente estoque
- nunca invente preco
- nunca invente desconto
- nunca prometa reserva
- nunca prometa entrega
- nunca confirme cashback, saldo ou validade sem dado real
- nunca valide PIN
- quando faltar informacao, diga isso com elegancia e conduza a conversa
- quando o assunto exigir humano (troca, reclamacao, negociacao, problema), sinalize isso
- so trate produto como disponivel quando o catalogo recebido indicar estoque positivo
- se o estoque estiver zero, diga que encontrou no catalogo mas sem estoque no momento e procure alternativa real
- se o estoque estiver negativo ou para conferencia, sinalize necessidade de confirmacao humana
- use historico de compras apenas como pista de gosto e preferencia, nunca como garantia de disponibilidade atual
- nunca revele CPF, documento, ticket medio, total gasto, score, classificacao interna ou qualquer dado sensivel do AEROINTEL ao cliente
- nunca sugira produto fora da lista de candidatos recebida
- nunca envie fotos sem o cliente pedir ou autorizar
- trate observacoes internas apenas como pistas comerciais discretas, nunca como frase literal para o cliente
- se nao encontrar produto, preco, cashback ou saldo confiavel, diga que vai verificar certinho antes de confirmar

Uso obrigatorio de dados reais:
- use somente os produtos reais recebidos no contexto
- considere busca por nome, SKU, Codigo Tiny, Codigo da etiqueta, Codigo de barras/EAN e Codigo interno
- use medidas, tamanhos, cashback e preferencias do cliente apenas quando vierem no contexto
- se houver estoque confiavel, voce pode informar disponibilidade
- se o estoque vier como pendente, auditoria ou conferência, diga que precisa validar antes de prometer
- limite sugestoes a no maximo 3 opcoes principais por resposta
- prefira perguntas curtas para avancar a venda

Politicas que voce pode informar quando relevante:
- Pix ou dinheiro: 10% de desconto
- Debito: 5% de desconto
- Cartao: ate 10x, sem desconto extra, para compras a partir de R$ 200,00
- Ribeirao Preto/SP: frete gratis por motoboy
- Entrega no mesmo dia em Ribeirao Preto se fechar ate as 16h
- Depois das 16h, precisa consultar a equipe
- Fora de Ribeirao Preto, o frete depende do CEP
- O bonus pode abater ate 50% da nova compra

Seu objetivo e ajudar o cliente a escolher produtos e estimular visita ou compra, sem inventar informacoes.
`;

const VENDEDOR_SYSTEM_PROMPT = `
${AEROSTORE_AI_BASE_SYSTEM_PROMPT}

Voce e um vendedor consultivo da AEROSTORE.
Responda de forma natural, consultiva, direta e focada em conversao.
Responda sempre em no maximo 2 ou 3 frases.
`;

const ATENDIMENTO_JSON_SYSTEM_PROMPT = `
${AEROSTORE_AI_BASE_SYSTEM_PROMPT}

Retorne apenas JSON com as chaves:
- resposta
- precisaHumano

Quando o cliente perguntar por produto, tamanho ou cor, responda de forma consultiva e diga que vai verificar com a equipe da AEROSTORE.
Se o cliente perguntar sobre cashback, nao invente saldo. Oriente que um vendedor pode confirmar com seguranca.
Nao inclua markdown.
`;

const CONVERSATIONAL_DECISION_SYSTEM_PROMPT = `
${AEROSTORE_AI_BASE_SYSTEM_PROMPT}

Voce e uma vendedora experiente da AEROSTORE. Voce fala como equipe real da loja atual, com tom humano, seguro, comercial e premium.

IDENTIDADE:
- aja como uma vendedora de loja fisica premium
- use linguagem informal profissional
- use "a gente" quando soar natural
- chame o cliente pelo primeiro nome quando isso vier no contexto
- use no maximo 1 ou 2 emojis quando ajudarem; nunca polua
- nunca comece com saudacao corporativa engessada

COMO VENDER:
- conduza a conversa para uma proxima acao concreta
- sempre que fizer sentido, termine com pergunta ou proposta: reservar, separar, confirmar tamanho, combinar visita, verificar transferencia
- se o estoque local estiver baixo, voce pode criar urgencia real, por exemplo "ultima unidade"
- se nao tiver o item exato, ofereca alternativa real antes de encerrar
- se o cliente estiver indeciso, faca uma pergunta curta de descoberta, sem interrogatorio

CONSCIENCIA DE LOJA:
- voce recebe a loja atual no contexto e deve responder como equipe dessa loja
- priorize sempre o estoque da loja atual
- se nao houver estoque local, analise estoque de outras lojas quando existir no contexto
- quando existir outra loja, voce pode sugerir transferencia ou retirada la, conforme a politica recebida
- nunca prometa transferencia como certeza; use linguagem como "posso verificar", "consigo solicitar", "posso pedir"
- se a politica indicar que nao pode transferir, nao ofereca transferencia

REGRAS DE TRANSFERENCIA:
- se a loja destino/origem for mesma regiao com prazo 0, pode dizer "consigo pegar pra voce hoje mesmo" ou "agora mesmo", sem parecer entrega garantida
- se houver prazo em dias uteis, informe o prazo do contexto
- nao ofereca transferencia quando o contexto marcar ultima unidade, restricao ou inviabilidade
- se for inviavel transferir, sugira visita direta a outra loja quando o contexto permitir

CASHBACK E CONDICOES:
- so fale cashback quando houver saldo oficial no contexto
- nunca invente desconto
- se o cliente pedir desconto fora da regra, diga que vai consultar gerente ou equipe

ESCALACAO HUMANA:
- se o cliente pedir humano, gerente, desconto especial, troca, devolucao, reclamacao, defeito ou demonstrar irritacao, priorize chamar humano
- se o contexto indicar escalacao obrigatoria, respeite isso

FORMATO DA MENSAGEM:
- no maximo 3 paragrafos curtos
- se listar produtos, no maximo 3 itens
- use formatacao de WhatsApp com *negrito* para nome/preco quando fizer sentido
- nunca use markdown tecnico, listas com ### ou tom de chatbot

JSON DE SAIDA:
Retorne APENAS JSON com estas chaves:
- resposta
- intencao
- acao
- precisaHumano
- produtoSugeridoId
- produtosAlternativosIds
- enviarFotos
- atualizarContexto
- motivo

Valores possiveis para intencao:
- saudacao
- produto
- alternativa
- foto
- cashback
- giftback
- troca
- desconto
- entrega
- pagamento
- loja
- reserva
- humano
- outro

Valores possiveis para acao:
- responder
- perguntar
- sugerir_produto
- oferecer_alternativas
- enviar_fotos
- chamar_humano
- ignorar

Em atualizarContexto use:
- categoria
- genero
- cor
- tamanho
- estilo
- produtoSugeridoId
- aguardando
`;

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOpenAIErrorStatus(error) {
  const status = Number(error?.status || error?.statusCode || error?.code || 0);
  return Number.isFinite(status) ? status : 0;
}

function isRetryableOpenAIError(error) {
  const status = getOpenAIErrorStatus(error);
  return OPENAI_RETRYABLE_STATUS_CODES.has(status);
}

function normalizeConversationContent(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).trim();
    } catch (error) {
      return "";
    }
  }
  return String(value).trim();
}

function isControlledSystemHistoryMessage(message) {
  return Boolean(
    message &&
    message.role === "system" &&
    (message.internal === true ||
      message.controlled === true ||
      message.source === "internal" ||
      message.source === "controlled")
  );
}

function sanitizeConversationHistory(conversationHistory = [], maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES, maxHistoryChars = DEFAULT_MAX_HISTORY_CHARS) {
  if (!Array.isArray(conversationHistory) || maxHistoryMessages <= 0 || maxHistoryChars <= 0) {
    return [];
  }

  const sanitized = [];
  let totalChars = 0;

  for (let index = conversationHistory.length - 1; index >= 0; index -= 1) {
    const rawMessage = conversationHistory[index];
    const role = String(rawMessage?.role || "").trim().toLowerCase();

    if (!ALLOWED_CONVERSATION_ROLES.has(role)) {
      continue;
    }
    if (role === "system" && !isControlledSystemHistoryMessage(rawMessage)) {
      continue;
    }

    const content = normalizeConversationContent(rawMessage?.content);
    if (!content) {
      continue;
    }

    if (totalChars + content.length > maxHistoryChars) {
      continue;
    }

    sanitized.unshift({ role, content });
    totalChars += content.length;

    if (sanitized.length >= maxHistoryMessages) {
      break;
    }
  }

  return sanitized;
}

function buildConversationMessages({
  systemPrompt,
  userMessage,
  conversationHistory,
  maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES,
  maxHistoryChars = DEFAULT_MAX_HISTORY_CHARS
}) {
  const messages = [];
  const systemContent = normalizeConversationContent(systemPrompt);
  const currentUserMessage = normalizeConversationContent(userMessage);
  const sanitizedHistory = sanitizeConversationHistory(
    conversationHistory,
    maxHistoryMessages,
    maxHistoryChars
  );

  if (systemContent) {
    messages.push({
      role: "system",
      content: systemContent
    });
  }

  if (sanitizedHistory.length) {
    messages.push(...sanitizedHistory);
  }

  if (currentUserMessage) {
    messages.push({
      role: "user",
      content: currentUserMessage
    });
  }

  return messages;
}

async function callOpenAIWithRetry(requestFactory) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestFactory();
    } catch (error) {
      lastError = error;
      if (!isRetryableOpenAIError(error) || attempt >= 2) {
        throw error;
      }
      await sleep(OPENAI_RETRY_DELAYS_MS[attempt] || OPENAI_RETRY_DELAYS_MS.at(-1));
    }
  }

  throw lastError;
}

function fallbackResposta({ intencao, nome = "" }) {
  const firstName = String(nome || "").trim().split(/\s+/)[0] || "";
  const prefix = firstName ? `${firstName}, ` : "";

  if (intencao === "cashback") {
    return `${prefix}consigo te ajudar com isso. Para consultar seu bonus AEROSTORE com seguranca, preciso localizar seu cadastro pelo telefone e um vendedor confirma certinho para voce.`;
  }
  if (intencao === "loja") {
    return `${prefix}posso te ajudar com isso. Me confirma qual loja da AEROSTORE voce quer consultar que eu verifico direitinho para voce.`;
  }
  if (intencao === "humano") {
    return `${prefix}vou direcionar seu atendimento para um vendedor da AEROSTORE te ajudar com mais cuidado.`;
  }
  if (intencao === "produto") {
    return `${prefix}posso te ajudar com isso. Voce prefere modelo basico, oversized ou polo? Eu verifico as opcoes disponiveis para voce com a equipe da AEROSTORE.`;
  }
  return `${prefix}posso te ajudar sim. Me conta um pouco melhor o que voce procura para eu te direcionar da melhor forma.`;
}

async function gerarRespostaVendedor(mensagemCliente, conversationHistory = []) {
  try {
    const response = await callOpenAIWithRetry(() => getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: buildConversationMessages({
        systemPrompt: VENDEDOR_SYSTEM_PROMPT,
        userMessage: mensagemCliente,
        conversationHistory,
        maxHistoryMessages: DEFAULT_MAX_HISTORY_MESSAGES,
        maxHistoryChars: DEFAULT_MAX_HISTORY_CHARS
      }),
      max_tokens: 150,
      temperature: 0.7
    }));

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("Erro ao gerar resposta da IA:", error);
    return "Desculpe, houve um erro ao processar sua mensagem. Tente novamente mais tarde.";
  }
}

async function gerarRespostaAtendimentoAerostore({
  mensagem,
  nome = "",
  intencao = "outro",
  precisaHumano = false,
  facts = {},
  contexto = "",
  conversationHistory = []
}) {
  const fallback = fallbackResposta({ intencao, nome, facts });

  try {
    const payload = {
      cliente: {
        nome,
        mensagem
      },
      classificacao: {
        intencao,
        precisaHumano
      },
      fatos_disponiveis: facts,
      contexto_adicional: contexto || ""
    };

    const response = await callOpenAIWithRetry(() => getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: buildConversationMessages({
        systemPrompt: ATENDIMENTO_JSON_SYSTEM_PROMPT,
        userMessage: JSON.stringify(payload),
        conversationHistory,
        maxHistoryMessages: DEFAULT_MAX_HISTORY_MESSAGES,
        maxHistoryChars: DEFAULT_MAX_HISTORY_CHARS
      }),
      max_tokens: 220,
      temperature: 0.4
    }));

    const content = response.choices?.[0]?.message?.content || "{}";
    const parsed = safeJsonParse(content) || {};

    return {
      resposta: String(parsed.resposta || fallback).trim(),
      precisaHumano: typeof parsed.precisaHumano === "boolean" ? parsed.precisaHumano : Boolean(precisaHumano)
    };
  } catch (error) {
    console.error("Erro ao gerar resposta estruturada da IA:", error);
    return {
      resposta: fallback,
      precisaHumano: Boolean(precisaHumano)
    };
  }
}

async function gerarDecisaoConversacionalAerostore(context = {}, conversationHistory = []) {
  const contextPayload = context && typeof context === "object" ? { ...context } : {};
  const effectiveConversationHistory = Array.isArray(conversationHistory) && conversationHistory.length
    ? conversationHistory
    : contextPayload.conversationHistory;

  delete contextPayload.conversationHistory;

  const fallback = {
    resposta: "Entendi. Me fala um pouco melhor o que voce procura que eu te ajudo a encontrar uma boa opcao na AEROSTORE.",
    intencao: "outro",
    acao: "responder",
    precisaHumano: false,
    produtoSugeridoId: null,
    produtosAlternativosIds: [],
    enviarFotos: false,
    atualizarContexto: {
      categoria: null,
      genero: null,
      cor: null,
      tamanho: null,
      estilo: null,
      produtoSugeridoId: null,
      aguardando: null
    },
    motivo: "fallback_safe_reply"
  };

  try {
    const response = await callOpenAIWithRetry(() => getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: buildConversationMessages({
        systemPrompt: CONVERSATIONAL_DECISION_SYSTEM_PROMPT,
        userMessage: JSON.stringify(contextPayload),
        conversationHistory: effectiveConversationHistory,
        maxHistoryMessages: DEFAULT_MAX_HISTORY_MESSAGES,
        maxHistoryChars: DEFAULT_MAX_HISTORY_CHARS
      }),
      max_tokens: 520,
      temperature: 0.45
    }));

    const content = response.choices?.[0]?.message?.content || "{}";
    const parsed = safeJsonParse(content) || {};
    return {
      resposta: String(parsed.resposta || fallback.resposta).trim(),
      intencao: String(parsed.intencao || fallback.intencao).trim() || "outro",
      acao: String(parsed.acao || fallback.acao).trim() || "responder",
      precisaHumano: Boolean(parsed.precisaHumano),
      produtoSugeridoId: parsed.produtoSugeridoId || null,
      produtosAlternativosIds: Array.isArray(parsed.produtosAlternativosIds) ? parsed.produtosAlternativosIds : [],
      enviarFotos: Boolean(parsed.enviarFotos),
      atualizarContexto: {
        categoria: parsed.atualizarContexto?.categoria || null,
        genero: parsed.atualizarContexto?.genero || null,
        cor: parsed.atualizarContexto?.cor || null,
        tamanho: parsed.atualizarContexto?.tamanho || null,
        estilo: parsed.atualizarContexto?.estilo || null,
        produtoSugeridoId: parsed.atualizarContexto?.produtoSugeridoId || null,
        aguardando: parsed.atualizarContexto?.aguardando || null
      },
      motivo: String(parsed.motivo || fallback.motivo).trim() || fallback.motivo
    };
  } catch (error) {
    console.error("Erro ao gerar decisao conversacional da IA:", error);
    return fallback;
  }
}

module.exports = {
  gerarRespostaVendedor,
  gerarRespostaAtendimentoAerostore,
  gerarDecisaoConversacionalAerostore,
  callOpenAIWithRetry,
  buildConversationMessages
};
