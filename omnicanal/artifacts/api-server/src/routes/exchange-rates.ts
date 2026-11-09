import { Router, type IRouter } from "express";
import {
  GetExchangeRatesResponse,
  RefreshExchangeRatesResponse,
  ListExchangeRateHistoryQueryParams,
  ListExchangeRateHistoryResponse,
} from "@workspace/api-zod";
import { requireView } from "../middlewares/auth";
import { getExchangeRatesStatus, getRateHistory, refreshExchangeRates } from "../lib/exchange-rates";
import { ExchangeRateError } from "../lib/popular-api";

const router: IRouter = Router();

const DEFAULT_HISTORY_LIMIT = 60;
const MAX_HISTORY_LIMIT = 500;

// Leer la tasa no es exclusivo del administrador: el agente humano la necesita
// para decirle a un cliente cuánto es en pesos mientras le atiende.
router.get("/exchange-rates", async (_req, res): Promise<void> => {
  res.json(GetExchangeRatesResponse.parse(await getExchangeRatesStatus()));
});

router.get("/exchange-rates/history", async (req, res): Promise<void> => {
  const query = ListExchangeRateHistoryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const limit = Math.min(Math.max(query.data.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
  res.json(ListExchangeRateHistoryResponse.parse(await getRateHistory(limit)));
});

// Cada consulta llama al banco, así que pedirla a mano queda para el administrador.
router.post("/exchange-rates/refresh", requireView("settings"), async (req, res): Promise<void> => {
  try {
    await refreshExchangeRates(req.user?.email ?? null);
  } catch (err) {
    if (err instanceof ExchangeRateError) {
      req.log.warn({ err }, "manual exchange rate refresh failed");
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
  res.json(RefreshExchangeRatesResponse.parse(await getExchangeRatesStatus()));
});

export default router;
