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
  await pause(1200);
}

async function inspectSettings(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
    };
    const panel = document.getElementById("settings-store-config-panel");
    const form = document.getElementById("store-settings-form");
    const fieldState = (selector) => {
      const node = form?.querySelector(selector);
      if (!node) return null;
      return {
        disabled: Boolean(node.disabled),
        readOnly: Boolean(node.readOnly),
        value: node.type === "checkbox" ? Boolean(node.checked) : String(node.value || "")
      };
    };
    const activeSection = document.querySelector(".page.active");
    const panelTitles = Array.from(document.querySelectorAll("#settings .panel h3"))
      .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return {
      pathname: window.location.pathname,
      activeSectionId: activeSection?.id || "",
      accessDeniedTitle: (document.getElementById("access-denied-title")?.textContent || "").replace(/\s+/g, " ").trim(),
      panelVisible: visible(panel),
      panelTitles,
      panelTitle: (panel?.querySelector("h3")?.textContent || "").replace(/\s+/g, " ").trim(),
      panelBadge: (panel?.querySelector(".settings-badge")?.textContent || "").replace(/\s+/g, " ").trim(),
      panelNote: (panel?.querySelector(".settings-panel-note")?.textContent || "").replace(/\s+/g, " ").trim(),
      saveButtonDisabled: document.getElementById("store-settings-save-button")?.disabled ?? null,
      reloadButtonDisabled: document.getElementById("store-settings-reload-button")?.disabled ?? null,
      selector: fieldState('select[name="storeSelector"]'),
      displayName: fieldState('input[name="display_name"]'),
      companyCnpj: fieldState('input[name="company.cnpj"]'),
      contactWhatsapp: fieldState('input[name="contact.whatsapp"]'),
      notes: fieldState('textarea[name="policies.operational_notes"]'),
      terminalLabel: fieldState('input[name="terminal.default_terminal_label"]'),
      pagbankLabel: fieldState('input[name="integrations.pagbank_account_label"]')
    };
  });
}

async function inspectRole(browser, credentials) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    await loginToSettings(page, credentials);
    return await inspectSettings(page);
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
    const admin = await inspectRole(browser, USERS.admin);
    const manager = await inspectRole(browser, USERS.managerVila);
    const seller = await inspectRole(browser, USERS.sellerVila);

    console.log(JSON.stringify({ admin, manager, seller }, null, 2));

    assert(admin.activeSectionId === "settings", "Admin deveria abrir /settings.");
    assert(admin.panelVisible, "Admin deveria ver o bloco Configuracao da loja.");
    assert(admin.panelTitle.includes("Configuracao da loja"), "Admin deveria ver o titulo da configuracao da loja.");
    assert(admin.saveButtonDisabled === false, "Admin deveria ter salvar habilitado.");
    assert(admin.selector && admin.selector.disabled === false, "Admin deveria poder trocar a loja.");
    assert(admin.companyCnpj && admin.companyCnpj.disabled === false, "Admin deveria editar CNPJ.");
    assert(admin.contactWhatsapp && admin.contactWhatsapp.disabled === false, "Admin deveria editar WhatsApp.");
    assert(admin.pagbankLabel && admin.pagbankLabel.disabled === false, "Admin deveria editar o vinculo seguro de integracao.");

    assert(manager.activeSectionId === "settings", "Manager deveria abrir /settings.");
    assert(manager.panelVisible, "Manager deveria ver o bloco Configuracao da loja.");
    assert(manager.saveButtonDisabled === false, "Manager deveria ter salvar habilitado para campos limitados.");
    assert(manager.selector && manager.selector.disabled === true, "Manager deveria ficar travado na propria loja.");
    assert(manager.contactWhatsapp && manager.contactWhatsapp.disabled === false, "Manager deveria editar contato.");
    assert(manager.notes && manager.notes.disabled === false, "Manager deveria editar observacoes operacionais.");
    assert(manager.companyCnpj && manager.companyCnpj.disabled === true, "Manager nao deveria editar CNPJ.");
    assert(manager.terminalLabel && manager.terminalLabel.disabled === true, "Manager nao deveria editar terminal sensivel.");
    assert(manager.pagbankLabel && manager.pagbankLabel.disabled === true, "Manager nao deveria editar integracao sensivel.");

    if (seller.activeSectionId === "settings") {
      assert(!seller.panelVisible, "Seller nao deveria ver o bloco Configuracao da loja.");
    } else {
      assert(seller.activeSectionId === "access-denied", "Seller deveria cair em acesso restrito.");
      assert(/acesso restrito/i.test(seller.accessDeniedTitle), "Seller deveria ver mensagem de acesso restrito.");
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
