"use strict";

const http = require("http");
const express = require("express");
const { registerPublicSiteRoutes } = require("../modules/public-site/routes/publicSiteRoutes");
const { isPublicSiteHost } = require("../modules/public-site/utils/publicSiteHost");

function request(port, host, path = "/") {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers: { Host: host }
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          location: res.headers.location || "",
          body
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const app = express();
  registerPublicSiteRoutes(app);
  app.get("/", (req, res, next) => {
    if (isPublicSiteHost(req)) {
      return next();
    }
    res.redirect(302, "/pdv");
  });

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const publicHome = await request(port, "aerostore.site", "/");
    if (publicHome.status !== 200) {
      throw new Error(`Public home expected 200, got ${publicHome.status}`);
    }
    if (!publicHome.body.includes("AEROSTORE")) {
      throw new Error("Public home missing AEROSTORE branding");
    }
    if (!publicHome.body.includes("61.080.150/0001-47")) {
      throw new Error("Public home missing real CNPJ");
    }
    if (!publicHome.body.includes("Ribeirão Preto")) {
      throw new Error("Public home missing Ribeirão Preto store data");
    }

    const publicPrivacy = await request(port, "aerostore.site", "/privacidade");
    if (publicPrivacy.status !== 200 || !publicPrivacy.body.includes("Política de Privacidade")) {
      throw new Error("Public privacy page failed");
    }

    const publicBlocked = await request(port, "aerostore.site", "/pdv");
    if (publicBlocked.status !== 404) {
      throw new Error(`Public /pdv expected 404, got ${publicBlocked.status}`);
    }

    const crmRoot = await request(port, "crm.aerostore.site", "/");
    if (crmRoot.status !== 302 || !String(crmRoot.location).includes("/pdv")) {
      throw new Error(`CRM root expected redirect /pdv, got ${crmRoot.status} ${crmRoot.location}`);
    }

    const localhostRoot = await request(port, "localhost:3000", "/");
    if (localhostRoot.status !== 302 || !String(localhostRoot.location).includes("/pdv")) {
      throw new Error(`localhost expected redirect /pdv, got ${localhostRoot.status}`);
    }

    console.log("PUBLIC_SITE_SMOKE_OK");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("PUBLIC_SITE_SMOKE_FAIL", error.message);
  process.exit(1);
});
