import crypto from "crypto";

type LabelaryRenderRequest = {
  dpmm: number;
  width: number;
  height: number;
  zpl: string;
  labelIndex?: number;
  labelaryIndex?: number;
};

type LabelaryRenderResult = {
  buffer: Buffer;
  contentType: string;
  rateLimited: boolean;
};

type QueueJob = {
  id: number;
  request: LabelaryRenderRequest;
  resolve: (result: LabelaryRenderResult) => void;
  reject: (error: LabelaryServiceError) => void;
};

// Plano livre Labelary: ate 3 solicitacoes por segundo.
// Usamos 500ms para ficar abaixo do teto, com folga contra jitter de rede.
const REQUEST_DELAY_MS = 500;
const RATE_LIMIT_DEFAULT_WAIT_MS = 2000;
const REQUEST_TIMEOUT_MS = 25000;
const MAX_ATTEMPTS = 3;
export const LABELARY_MAX_REQUEST_BYTES = 1024 * 1024;
export const LABELARY_MAX_LABEL_DIMENSION_INCHES = 15;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class LabelaryServiceError extends Error {
  statusCode: number;
  rateLimited: boolean;

  constructor(message: string, statusCode = 500, rateLimited = false) {
    super(message);
    this.name = "LabelaryServiceError";
    this.statusCode = statusCode;
    this.rateLimited = rateLimited;
  }
}

class LabelaryService {
  private queue: QueueJob[] = [];
  private processing = false;
  private nextJobId = 1;
  private lastRequestStartedAt = 0;
  private rateLimitCooldownUntil = 0;

  render(request: LabelaryRenderRequest): Promise<LabelaryRenderResult> {
    return new Promise((resolve, reject) => {
      const job: QueueJob = {
        id: this.nextJobId++,
        request,
        resolve,
        reject,
      };

      // Fila: todos os uploads, inclusive simultaneos, entram no mesmo funil global.
      // Assim somente uma etiqueta por vez chega na API Labelary.
      this.queue.push(job);
      console.log(`[Labelary][fila] Etiqueta ${this.getLabelName(job)} adicionada. Pendentes: ${this.queue.length}`);
      void this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      console.log(`[Labelary][inicio] Etiqueta ${this.getLabelName(job)} iniciada.`);

      try {
        const result = await this.renderWithRetry(job);
        console.log(`[Labelary][ok] Etiqueta ${this.getLabelName(job)} convertida.`);
        job.resolve(result);
      } catch (error) {
        const serviceError = this.normalizeError(error);
        console.error(
          `[Labelary][falha-definitiva] Etiqueta ${this.getLabelName(job)} falhou: ${serviceError.message}`
        );
        job.reject(serviceError);
      }
    }

    this.processing = false;
  }

  private async renderWithRetry(job: QueueJob): Promise<LabelaryRenderResult> {
    let lastError: LabelaryServiceError | null = null;
    let wasRateLimited = false;

    // Retry: cada etiqueta tem ate 3 tentativas independentes.
    // Falhas definitivas rejeitam apenas a etiqueta atual; a fila segue para as proximas.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await this.waitForRequestSlot(job, attempt);

      try {
        const response = await this.callLabelary(job.request, job);

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          return {
            buffer: Buffer.from(arrayBuffer),
            contentType: response.headers.get("content-type") || "image/png",
            rateLimited: wasRateLimited,
          };
        }

        const errorText = await response.text();

        const isRateLimit = response.status === 429 || this.isRateLimitText(errorText);

        if (isRateLimit) {
          wasRateLimited = true;
          const retryAfterMs = this.getRetryAfterMs(response);
          this.setRateLimitCooldown(retryAfterMs);
          lastError = new LabelaryServiceError(
            errorText || "Request rate limit exceeded",
            response.status === 429 ? 429 : 503,
            true
          );

          // Rate limit: quando a Labelary informa Retry-After, respeitamos esse tempo
          // antes de tentar novamente. Sem header, aplicamos uma pausa global maior,
          // porque a Labelary pode liberar apenas uma pequena janela de etiquetas por minuto.
          if (attempt < MAX_ATTEMPTS) {
            console.warn(
              `[Labelary][rate-limit] Etiqueta ${this.getLabelName(job)} recebeu limite da Labelary. ` +
              `Tentativa ${attempt}/${MAX_ATTEMPTS}. Tempo de espera: ${retryAfterMs}ms.`
            );
            await wait(retryAfterMs);
            console.log(`[Labelary][retry] Etiqueta ${this.getLabelName(job)} realizando nova tentativa.`);
            continue;
          }
        } else {
          lastError = new LabelaryServiceError(
            errorText || `Labelary API returned HTTP ${response.status}`,
            response.status
          );

          if (attempt < MAX_ATTEMPTS && response.status >= 500) {
            const backoffMs = this.getBackoffMs(attempt);
            // Backoff: em erros temporarios do servidor, aumentamos a espera a cada retry.
            console.warn(
              `[Labelary][backoff] Etiqueta ${this.getLabelName(job)} recebeu HTTP ${response.status}. ` +
              `Tentativa ${attempt}/${MAX_ATTEMPTS}. Tempo de espera: ${backoffMs}ms.`
            );
            await wait(backoffMs);
            console.log(`[Labelary][retry] Etiqueta ${this.getLabelName(job)} realizando nova tentativa.`);
            continue;
          }
        }

        break;
      } catch (error: any) {
        lastError = new LabelaryServiceError(
          error?.message || "Falha de rede ao chamar a Labelary",
          502
        );

        if (attempt < MAX_ATTEMPTS) {
          const backoffMs = this.getBackoffMs(attempt);
          console.warn(
            `[Labelary][backoff] Etiqueta ${this.getLabelName(job)} teve falha de rede. ` +
            `Tentativa ${attempt}/${MAX_ATTEMPTS}. Tempo de espera: ${backoffMs}ms.`
          );
          await wait(backoffMs);
          console.log(`[Labelary][retry] Etiqueta ${this.getLabelName(job)} realizando nova tentativa.`);
          continue;
        }
      }
    }

    throw lastError || new LabelaryServiceError("Falha desconhecida ao converter etiqueta.");
  }

  private async waitForRequestSlot(job: QueueJob, attempt: number) {
    const elapsed = Date.now() - this.lastRequestStartedAt;
    const delayWaitMs = Math.max(0, REQUEST_DELAY_MS - elapsed);
    const cooldownWaitMs = Math.max(0, this.rateLimitCooldownUntil - Date.now());
    const waitMs = Math.max(delayWaitMs, cooldownWaitMs);

    // Delay fixo: garante no minimo 2000ms entre chamadas reais para a Labelary,
    // mesmo quando muitos usuarios fazem upload ao mesmo tempo.
    // Cooldown de rate limit: quando a API bloqueia, a fila inteira desacelera antes
    // de seguir para a proxima etiqueta, evitando novas falhas em cascata.
    if (waitMs > 0) {
      console.log(
        `[Labelary][espera] Etiqueta ${this.getLabelName(job)} aguardando ${waitMs}ms antes da tentativa ${attempt}.`
      );
      await wait(waitMs);
    }

    this.lastRequestStartedAt = Date.now();
  }

  private async callLabelary(request: LabelaryRenderRequest, job: QueueJob) {
    const zplHash = crypto.createHash("sha1").update(request.zpl).digest("hex").slice(0, 12);
    const labelIndex = Math.max(0, request.labelaryIndex ?? request.labelIndex ?? 0);
    const labelaryUrl = `https://api.labelary.com/v1/printers/${request.dpmm}dpmm/labels/${request.width}x${request.height}/${labelIndex}/`;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.warn(
        `[Labelary][timeout] Etiqueta ${this.getLabelName(job)} excedeu ${REQUEST_TIMEOUT_MS}ms nesta tentativa.`
      );
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      return await fetch(labelaryUrl, {
        method: "POST",
        body: request.zpl,
        signal: controller.signal,
        headers: {
          "Accept": "image/png",
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private getRetryAfterMs(response: Response) {
    const retryAfter = response.headers.get("retry-after");

    if (!retryAfter) {
      return RATE_LIMIT_DEFAULT_WAIT_MS;
    }

    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) {
      return Math.max(RATE_LIMIT_DEFAULT_WAIT_MS, seconds * 1000);
    }

    const retryDate = Date.parse(retryAfter);
    if (!Number.isNaN(retryDate)) {
      return Math.max(RATE_LIMIT_DEFAULT_WAIT_MS, retryDate - Date.now());
    }

    return RATE_LIMIT_DEFAULT_WAIT_MS;
  }

  private getBackoffMs(attempt: number) {
    return REQUEST_DELAY_MS * attempt;
  }

  private normalizeError(error: unknown) {
    if (error instanceof LabelaryServiceError) {
      return error;
    }

    const message = error instanceof Error ? error.message : "Erro desconhecido ao converter etiqueta.";
    return new LabelaryServiceError(message);
  }

  private setRateLimitCooldown(waitMs: number) {
    const cooldownUntil = Date.now() + waitMs;
    this.rateLimitCooldownUntil = Math.max(this.rateLimitCooldownUntil, cooldownUntil);
    console.warn(`[Labelary][cooldown] Pausa global da fila por ${waitMs}ms por rate limit.`);
  }

  private isRateLimitText(text: string) {
    const normalized = text.toLowerCase();
    return normalized.includes("rate limit") || normalized.includes("too many requests");
  }

  private getLabelName(job: QueueJob) {
    const labelNumber = typeof job.request.labelIndex === "number" ? job.request.labelIndex + 1 : job.id;
    return `#${labelNumber} (job ${job.id})`;
  }
}

export const labelaryService = new LabelaryService();
