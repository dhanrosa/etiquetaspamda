import { createHash } from "crypto";

const LABELARY_MAX_REQUEST_BYTES = 1024 * 1024;
const LABELARY_MAX_LABEL_DIMENSION_INCHES = 15;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 800;
const REQUEST_TIMEOUT_MS = 7000;

let renderQueue = Promise.resolve();

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const parseBody = (body: unknown) => {
  if (typeof body === "string") {
    return JSON.parse(body);
  }

  return body || {};
};

const isValidZpl = (zpl: unknown) => {
  if (typeof zpl !== "string") return false;

  const value = zpl.trim();
  return value.length > 0 && /\^XA/i.test(value) && /\^XZ/i.test(value);
};

const isTemporaryStatus = (status: number) => status === 429 || status >= 500;

const labelaryErrorMessage = (status: number, body: string) => {
  if (status === 429) {
    return "Limite de requisicoes da Labelary atingido. A etiqueta sera processada em fila; tente novamente em alguns segundos.";
  }

  return body || `Labelary retornou erro HTTP ${status}.`;
};

async function callLabelaryWithRetry(params: {
  dpmm: number;
  width: number;
  height: number;
  zpl: string;
  labelaryIndex: number;
  labelNumber: string;
  run: string;
}) {
  const { dpmm, width, height, zpl, labelaryIndex, labelNumber, run } = params;
  const labelaryUrl = `https://api.labelary.com/v1/printers/${dpmm}dpmm/labels/${width}x${height}/${labelaryIndex}/`;
  let lastErrorMessage = "Falha desconhecida ao chamar a Labelary.";
  let lastStatus = 502;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      console.log(
        `[api/render] Chamando Labelary. label=${labelNumber} run=${run} tentativa=${attempt}/${MAX_ATTEMPTS} url=${labelaryUrl}`
      );

      const response = await fetch(labelaryUrl, {
        method: "POST",
        body: zpl,
        signal: controller.signal,
        headers: {
          Accept: "image/png",
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
      });

      clearTimeout(timeout);

      console.log(
        `[api/render] Resposta Labelary. label=${labelNumber} run=${run} tentativa=${attempt} status=${response.status} ok=${response.ok}`
      );

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get("content-type") || "image/png";

        console.log(
          `[api/render] PNG recebido. label=${labelNumber} run=${run} bytes=${buffer.length} contentType=${contentType}`
        );

        return {
          buffer,
          contentType,
          rateLimited: false,
        };
      }

      const errorBody = await response.text();
      lastStatus = response.status;
      lastErrorMessage = labelaryErrorMessage(response.status, errorBody);

      console.warn(
        `[api/render] Erro Labelary. label=${labelNumber} run=${run} tentativa=${attempt} status=${response.status} body=${errorBody}`
      );

      if (attempt < MAX_ATTEMPTS && isTemporaryStatus(response.status)) {
        await wait(RETRY_DELAY_MS);
        continue;
      }

      return {
        errorStatus: response.status,
        errorMessage: lastErrorMessage,
        rateLimited: response.status === 429,
      };
    } catch (error: any) {
      clearTimeout(timeout);
      lastStatus = 502;
      lastErrorMessage = error?.name === "AbortError"
        ? `Tempo esgotado ao chamar a Labelary apos ${REQUEST_TIMEOUT_MS}ms.`
        : error?.message || "Falha de rede ao chamar a Labelary.";

      console.error(
        `[api/render] Excecao ao chamar Labelary. label=${labelNumber} run=${run} tentativa=${attempt}`,
        error
      );

      if (attempt < MAX_ATTEMPTS) {
        await wait(RETRY_DELAY_MS);
        continue;
      }
    }
  }

  return {
    errorStatus: lastStatus,
    errorMessage: lastErrorMessage,
    rateLimited: lastStatus === 429,
  };
}

async function processRender(req: any, res: any) {
  const labelFromQuery = String(req.query?.label ?? "?");
  const runFromQuery = String(req.query?.run ?? "?");

  let body: any;
  try {
    body = parseBody(req.body);
  } catch (error) {
    console.error("[api/render] JSON invalido no body.", error);
    return res.status(400).json({ error: "JSON invalido no corpo da requisicao." });
  }

  const {
    dpmm,
    width,
    height,
    zpl,
    labelIndex,
    labelaryIndex,
  } = body;

  const labelNumber = typeof labelIndex === "number" ? String(labelIndex) : labelFromQuery;

  if (!isValidZpl(zpl)) {
    console.warn(`[api/render] ZPL vazio ou invalido. label=${labelNumber} run=${runFromQuery}`);
    return res.status(400).json({ error: "ZPL vazio ou inválido" });
  }

  const dpmmVal = Number(dpmm || 8);
  const widthVal = Number(width || 4);
  const heightVal = Number(height || 6);
  const labelaryIndexVal = Math.max(0, Number(labelaryIndex ?? 0));
  const zplText = String(zpl);
  const zplSizeBytes = Buffer.byteLength(zplText, "utf8");
  const zplHash = createHash("sha1").update(zplText).digest("hex").slice(0, 12);

  console.log(
    `[api/render] Requisicao recebida. label=${labelNumber} run=${runFromQuery} zplBytes=${zplSizeBytes} zplHash=${zplHash}`
  );

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

  const result = await callLabelaryWithRetry({
    dpmm: dpmmVal,
    width: widthVal,
    height: heightVal,
    zpl: zplText,
    labelaryIndex: labelaryIndexVal,
    labelNumber,
    run: runFromQuery,
  });

  if ("errorStatus" in result) {
    res.setHeader("X-Labelary-Rate-Limited", String(result.rateLimited));
    return res.status(result.errorStatus).json({
      error: result.errorMessage,
      rateLimited: result.rateLimited,
    });
  }

  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Labelary-Rate-Limited", String(result.rateLimited));
  res.setHeader("X-Labelary-Zpl-Hash", zplHash);
  return res.status(200).send(result.buffer);
}

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

  const queuedRender = renderQueue.then(() => processRender(req, res));
  renderQueue = queuedRender.catch(() => undefined);

  try {
    return await queuedRender;
  } catch (error: any) {
    console.error("[api/render] Erro completo no catch final:", {
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      error,
    });

    return res.status(500).json({
      error: error?.message || "Erro interno ao renderizar etiqueta.",
    });
  }
}
