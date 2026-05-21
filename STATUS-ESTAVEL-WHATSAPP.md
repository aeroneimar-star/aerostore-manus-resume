# Marco estavel - WhatsApp / Operacao

Registrar este ponto como referencia de estabilidade operacional do projeto.

Estado validado:

- WhatsApp conectado
- A tela de Operacao carrega a campanha corretamente
- O envio automatico com imagem/anexo funcionou
- O envio para `2` contatos reais foi bem-sucedido

Diretriz de manutencao neste ponto:

- Manter `MessageMedia` e o fluxo atual de envio sem refatorar neste momento
- Nao alterar o motor de envio enquanto este marco estiver sendo usado como base estavel

---

# Marco estavel - PIN antifraude do cashback

Registrar este ponto como referencia de estabilidade funcional do fluxo de PIN antifraude.

Estado validado:

- PIN enviado por WhatsApp
- PIN oculto na tela
- PIN validado corretamente
- Cashback confirmado somente apos validacao

Diretriz de manutencao neste ponto:

- Nao alterar o motor do PIN neste momento
- Manter o fluxo atual de envio e validacao como base estavel
- Evitar refatoracoes no caminho de PIN enquanto este marco estiver sendo usado como referencia
