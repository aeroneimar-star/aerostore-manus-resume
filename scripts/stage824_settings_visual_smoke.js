"use strict";

const puppeteer = require("puppeteer-core");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const EDGE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const USERS = {
  admin: { email: "admin@aerostore.local", password: "123456" },
  managerVila: { email: "gerente@aerostore.local", password: "123456" },
  sellerVila: { email: "vendedor.vila@aerostore.local", password: "123456" }
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function pause(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginToSettings(page, credentials) {
  await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("#login-form", { timeout: 30000 });
  await page.$eval("#login-email", (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, credentials.email);
  await page.$eval("#login-password", (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, credentials.password);
  await page.$eval("#login-form", (form) => form.requestSubmit());
  await page.waitForFunction(() => {
    const label = document.getElementById("current-user-label");
    return label && !/sess[aã]o n[aã]o iniciada/i.test(label.textContent || "");
  }, { timeout: 30000 });
  await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle2", timeout: 30000 });
  await pause(1000);
}

async function extractSettingsSummary(page) {
  return page.evaluate(() => {
    const activeSection = document.querySelector(".page.active");
    const getText = (selector) => {
      const node = document.querySelector(selector);
      return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
    };
    const buttons = Array.from(document.querySelectorAll("#settings button"))
      .filter((button) => {
        const style = window.getComputedStyle(button);
        return style.display !== "none" && style.visibility !== "hidden" && button.getClientRects().length > 0;
      })
      .map((button) => ({
        text: (button.textContent || "").replace(/\s+/g, " ").trim(),
        disabled: Boolean(button.disabled)
      }));
    const panels = Array.from(document.querySelectorAll("#settings .panel"))
      .filter((panel) => {
        const style = window.getComputedStyle(panel);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((panel) => ({
        title: (panel.querySelector("h3")?.textContent || "").replace(/\s+/g, " ").trim(),
        eyebrow: (panel.querySelector(".eyebrow")?.textContent || "").replace(/\s+/g, " ").trim(),
        badge: (panel.querySelector(".settings-badge")?.textContent || "").replace(/\s+/g, " ").trim(),
        note: (panel.querySelector(".settings-panel-note")?.textContent || "").replace(/\s+/g, " ").trim()
      }));
    return {
      pathname: window.location.pathname,
      bodySection: document.body?.dataset?.section || "",
      activeSectionId: activeSection?.id || "",
      sectionTitle: getText("#section-title"),
      currentUser: getText("#current-user-label"),
      accessDeniedTitle: getText("#access-denied-title"),
      accessDeniedDetail: getText("#access-denied-detail"),
      menuLabels: Array.from(document.querySelectorAll("#sidebar-menu a, #sidebar-menu button")).map((item) =>
        (item.textContent || "").replace(/\s+/g, " ").trim()
      ),
      buttons,
      panels
    };
  });
}

async function inspectRole(browser, key, credentials) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    await loginToSettings(page, credentials);
    const snapshot = await extractSettingsSummary(page);
    return { role: key, snapshot };
  } finally {
    await page.close();
    await context.close();
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: EDGE_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const admin = await inspectRole(browser, "admin", USERS.admin);
    const manager = await inspectRole(browser, "managerVila", USERS.managerVila);
    const seller = await inspectRole(browser, "sellerVila", USERS.sellerVila);

    assert(admin.snapshot.activeSectionId === "settings", "Admin deveria abrir a tela de settings.");
    assert(
      admin.snapshot.menuLabels.some((label) => label.includes("Configurações operacionais") || label.includes("Configuracoes operacionais")),
      "Admin deveria ver o rotulo Configuracoes operacionais."
    );
    assert(admin.snapshot.panels.some((panel) => panel.title.includes("Politica de cashback")), "Admin deveria ver o bloco de cashback.");
    assert(admin.snapshot.buttons.some((button) => button.text === "Salvar configuracoes" && button.disabled === false), "Admin deveria ter botao ativo para salvar cashback.");
    assert(admin.snapshot.buttons.some((button) => button.text === "Atualizar status"), "Admin deveria ver Atualizar status no bloco WhatsApp.");
    assert(admin.snapshot.buttons.some((button) => button.text === "Abrir WhatsApp CRM"), "Admin deveria ver Abrir WhatsApp CRM no bloco WhatsApp.");

    assert(manager.snapshot.activeSectionId === "settings", "Manager deveria abrir a tela de settings.");
    assert(manager.snapshot.menuLabels.some((label) => label.includes("Loja / terminal")), "Manager deveria ver o rotulo Loja / terminal.");
    assert(manager.snapshot.buttons.some((button) => button.text === "Somente leitura neste perfil" && button.disabled === true), "Manager deveria ver cashback em somente leitura.");
    assert(!manager.snapshot.buttons.some((button) => button.text === "Salvar vendedor"), "Manager nao deveria ver criacao de vendedor editavel.");
    assert(
      manager.snapshot.panels.some((panel) => /somente leitura/i.test(panel.badge) && panel.title.includes("Vendedores da operacao")),
      "Manager deveria ver vendedores em somente leitura."
    );

    if (seller.snapshot.activeSectionId === "settings") {
      assert(!seller.snapshot.panels.some((panel) => panel.title.includes("Politica de cashback")), "Seller nao deveria ver politica global de cashback.");
      assert(!seller.snapshot.panels.some((panel) => panel.title.includes("Vendedores da operacao")), "Seller nao deveria ver bloco de vendedores.");
      assert(seller.snapshot.panels.some((panel) => panel.title.includes("Loja e terminal atual")), "Seller deveria ver somente o bloco local.");
      assert(seller.snapshot.panels.some((panel) => panel.title.includes("WhatsApp CRM da loja")), "Seller deveria ver somente diagnostico operacional do WhatsApp.");
    } else {
      assert(seller.snapshot.activeSectionId === "access-denied", "Seller deveria cair em acesso restrito ou frente limitada.");
      assert(/acesso restrito/i.test(seller.snapshot.accessDeniedTitle), "Seller deveria receber mensagem de acesso restrito.");
    }

    console.log(JSON.stringify({ admin, manager, seller }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
