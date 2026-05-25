export default function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({ ok: true, service: "Etiquetas Pamda API" });
}
