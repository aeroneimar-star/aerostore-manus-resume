"use strict";

/**
 * transactionRunner — Abstração segura para transações BEGIN IMMEDIATE
 * no driver SQLite de produção (singleton sqlite3).
 *
 * Problema resolvido:
 * O db.js usa uma conexão sqlite3 singleton. Se duas requisições HTTP
 * chegam simultaneamente e ambas chamam db.run("BEGIN IMMEDIATE"),
 * a segunda pode iniciar sua transação DENTRO da primeira, causando
 * interleaving e corrupção de dados.
 *
 * Solução:
 * A fila serializa todas as transações BEGIN IMMEDIATE. Enquanto uma
 * transação está ativa, qualquer outra é enfileirada e só executa
 * após COMMIT ou ROLLBACK da anterior.
 *
 * IMPORTANTE: A transação NUNCA deve manter o lock durante chamadas HTTP.
 * O fluxo correto é:
 *   BEGIN IMMEDIATE → validar/ler/escrever → COMMIT → (após COMMIT) chamar provider HTTP
 */

function createTransactionRunner(dbApi) {
  let activeTransaction = null;
  const queue = [];

  function processQueue() {
    if (activeTransaction) return; // still locked
    if (queue.length === 0) return;
    const next = queue.shift();
    next.resolve(exclusiveRunner());
  }

  function exclusiveRunner() {
    let locked = true;
    let committed = false;
    let rolledBack = false;

    const runner = {
      run: async (sql, params = []) => {
        if (!locked) {
          throw new Error("transaction_already_closed");
        }
        return dbApi.run(sql, params);
      },
      get: async (sql, params = []) => {
        if (!locked) {
          throw new Error("transaction_already_closed");
        }
        return dbApi.get(sql, params);
      },
      all: async (sql, params = []) => {
        if (!locked) {
          throw new Error("transaction_already_closed");
        }
        return dbApi.all(sql, params);
      },
      commit: async () => {
        if (!locked || committed || rolledBack) {
          return false;
        }
        try {
          await dbApi.run("COMMIT");
          committed = true;
          return true;
        } finally {
          locked = false;
          activeTransaction = null;
          processQueue();
        }
      },
      rollback: async () => {
        if (!locked || committed || rolledBack) {
          return false;
        }
        try {
          await dbApi.run("ROLLBACK");
          rolledBack = true;
          return true;
        } finally {
          locked = false;
          activeTransaction = null;
          processQueue();
        }
      },
      isActive: () => locked,
      isCommitted: () => committed,
      isRolledBack: () => rolledBack,
    };

    return runner;
  }

  return {
    /**
     * withImmediateTransaction(callback)
     *
     * Serializa a transação inteira:
     * 1. Aguarda a vez na fila (se há outra transação ativa)
     * 2. Executa BEGIN IMMEDIATE
     * 3. Chama o callback com o runner exclusivo
     * 4. Se o callback retornar normalmente: COMMIT
     * 5. Se o callback lançar: ROLLBACK + rethrow
     *
     * O callback NUNCA deve manter a transação aberta durante HTTP.
     * Se precisar chamar um provider, faça:
     *   await withImmediateTransaction(async (runner) => {
     *     // validar, inserir REQUESTING
     *     await runner.commit(); // transação FECHADA
     *     return { attemptId }; // retornar dados mínimos para usar fora
     *   });
     *   // Agora SIM pode chamar o provider HTTP
     */
    withImmediateTransaction: async (callback) => {
      return new Promise((resolve, reject) => {
        const enqueue = () => {
          activeTransaction = { pending: true };
          resolve(
            (async () => {
              try {
                await dbApi.run("BEGIN IMMEDIATE");
                const runner = exclusiveRunner();
                const result = await callback(runner);
                if (!runner.isCommitted() && !runner.isRolledBack()) {
                  // Se o callback não fez commit nem rollback, commitar automaticamente
                  try {
                    await runner.commit();
                  } catch (commitErr) {
                    try { await runner.rollback(); } catch (rbErr) { /* ignore */ }
                    throw commitErr;
                  }
                }
                return result;
              } catch (err) {
                if (activeTransaction) {
                  try {
                    await dbApi.run("ROLLBACK");
                  } catch (rbErr) {
                    // ignore double rollback
                  }
                  activeTransaction = null;
                  processQueue();
                }
                throw err;
              }
            })()
          );
        };

        if (activeTransaction) {
          // Enfileirar e aguardar
          queue.push({ resolve: enqueue, reject });
        } else {
          enqueue();
        }
      });
    },

    /**
     * Test helper: verificar se há transação ativa
     */
    isTransactionActive: () => activeTransaction !== null,

    /**
     * Test helper: forçar liberação da fila (apenas para testes)
     */
    _reset: () => {
      activeTransaction = null;
      queue.length = 0;
    },
  };
}

module.exports = { createTransactionRunner };
