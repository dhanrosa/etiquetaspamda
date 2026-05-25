import { createHash } from "crypto";
import {
  labelaryService,
  LabelaryServiceError,
  LABELARY_MAX_LABEL_DIMENSION_INCHES,
  LABELARY_MAX_REQUEST_BYTES,
} from "../src/services/labelaryService";

export const config = {
  maxDuration: 60,
};

const parseBody = (body: unknown) => {
  if (typeof body === "string") {
    return JSON.parse(body);
  }

  return body || {};
};

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { dpmm, width, height, zpl, labelIndex, labelaryIndex } = parseBody(req.body) as any;

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
      `[render:serverless] Etiqueta #${typeof labelIndex === "number" ? labelIndex + 1 : "?"} recebida. ` +
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

    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-Labelary-Rate-Limited", String(result.rateLimited));
    res.setHeader("X-Labelary-Zpl-Hash", zplHash);
    return res.status(200).send(result.buffer);
  } catch (err: any) {
    console.error("Serverless ZPL rendering failed:", err);

    if (err instanceof LabelaryServiceError) {
      res.setHeader("X-Labelary-Rate-Limited", String(err.rateLimited));
      return res.status(err.statusCode).json({
        error: err.message || "Labelary API returned an error status",
        rateLimited: err.rateLimited,
      });
    }

    return res.status(500).json({
      error: "Ocorreu um erro no servidor ao gerar a etiqueta.",
    });
  }
}
