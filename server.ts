import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createHash } from "crypto";
import {
  labelaryService,
  LabelaryServiceError,
  LABELARY_MAX_LABEL_DIMENSION_INCHES,
  LABELARY_MAX_REQUEST_BYTES,
} from "./src/services/labelaryService";

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// Increase payload limits for large ZPL inputs containing many labels
app.use(express.json({ limit: "20mb" }));
app.use(express.text({ limit: "20mb", type: "text/plain" }));

// API endpoint to proxy ZPL rendering to Labelary completely server-side
app.post("/api/render", async (req, res) => {
  try {
    const { dpmm, width, height, zpl, labelIndex, labelaryIndex } = req.body;

    if (!zpl) {
      return res.status(400).json({ error: "Missing ZPL code" });
    }

    const dpmmVal = dpmm || 8;
    const widthVal = width || 4;
    const heightVal = height || 6;
    const zplSizeBytes = Buffer.byteLength(String(zpl), "utf8");

    if (zplSizeBytes > LABELARY_MAX_REQUEST_BYTES) {
      return res.status(413).json({
        error: "Etiqueta maior que 1 MB. O plano livre da Labelary limita o corpo da requisicao a 1 MB.",
      });
    }

    if (
      widthVal <= 0 ||
      heightVal <= 0 ||
      widthVal > LABELARY_MAX_LABEL_DIMENSION_INCHES ||
      heightVal > LABELARY_MAX_LABEL_DIMENSION_INCHES
    ) {
      return res.status(400).json({
        error: "Dimensoes invalidas. O plano livre da Labelary permite etiquetas de ate 15 polegadas.",
      });
    }

    const zplHash = createHash("sha1").update(String(zpl)).digest("hex").slice(0, 12);

    console.log(
      `[render] Etiqueta #${typeof labelIndex === "number" ? labelIndex + 1 : "?"} recebida. ` +
      `ZPL hash: ${zplHash}. Tamanho: ${zplSizeBytes} bytes.`
    );

    const result = await labelaryService.render({
      dpmm: dpmmVal,
      width: widthVal,
      height: heightVal,
      zpl,
      labelIndex,
      labelaryIndex,
    });

    // Set image content-type headers so the browser renders it immediately
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-Labelary-Rate-Limited", String(result.rateLimited));
    res.setHeader("X-Labelary-Zpl-Hash", zplHash);
    return res.send(result.buffer);
  } catch (err: any) {
    console.error("Server-side ZPL rendering failed:", err);

    if (err instanceof LabelaryServiceError) {
      res.setHeader("X-Labelary-Rate-Limited", String(err.rateLimited));
      return res.status(err.statusCode).json({
        error: err.message || "Labelary API returned an error status",
        rateLimited: err.rateLimited,
      });
    }

    return res.status(500).json({
      error: "Ocorreu um erro no servidor ao gerar a etiqueta."
    });
  }
});

// Setup Vite & Frontend static assets
async function initServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // SPA catch-all routing
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ZPL to PDF Server running smoothly on http://0.0.0.0:${PORT}`);
  });
}

initServer();
