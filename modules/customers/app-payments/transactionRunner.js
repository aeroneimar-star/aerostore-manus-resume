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
    let commitHandled = false;

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
          locked = false;
          return true;
        } catch (commitErr) {
          // COMMIT falhou — ROLLBACK da transação atual ANTES de liberar a fila
          // Isso garante que:
          // 1. A fila NÃO é liberada até sabermos que o COMMIT falhou
          // 2. ROLLBACK é executado na transação CORRETA (a que falhou)
          // 3. A próxima fila só executa após o ROLLBACK
          locked = false;
          rolledBack = true;
          commitHandled = true; // signal to catch block: don't double-rollback
          try {
            await dbApi.run("ROLLBACK");
          } catch (rbErr) {
            // ignore: connection may already be clean after failed COMMIT
          }
          throw commitErr; // rethrow the original COMMIT error
        } finally {
          activeTransaction = null;
          processQueue(); // ONLY release queue after COMMIT success or ROLLBACK
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
          let currentRunner = null;
          resolve(
            (async () => {
              try {
                await dbApi.run("BEGIN IMMEDIATE");
                currentRunner = exclusiveRunner();
                const result = await callback(currentRunner);
                if (!currentRunner.isCommitted() && !currentRunner.isRolledBack()) {
                  // Se o callback não fez commit nem rollback, commitar automaticamente
                  try {
                    await currentRunner.commit();
                  } catch (commitErr) {
                    // commit() já fez ROLLBACK internamente se falhou, não tentar outro
                    throw commitErr;
                  }
                }
                return result;
              } catch (err) {
                // Se o runner já fez ROLLBACK internamente (commit falhou), NÃO tentar outro ROLLBACK.
                // commit() já liberou a fila via processQueue(). O activeTransaction pode ser
                // da próxima transação na fila (tx2), e fazer ROLLBACK aqui destruiria tx2.
                if (currentRunner && !currentRunner.isRolledBack()) {
                  if (activeTransaction) {
                    try {
                      await dbApi.run("ROLLBACK");
                    } catch (rbErr) {
                      // ignore double rollback or "no transaction active" errors
                    }
                    activeTransaction = null;
                    processQueue();
                  }
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
