import pino from "pino";
import { persistErrorLog } from "./error-log";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  // Cada error se guarda además en la base de datos, que es lo que el panel le
  // muestra al administrador. El gancho no cambia lo que se imprime —llama al
  // método de siempre— y la copia va por su cuenta, así que un problema
  // guardándola no afecta al registro ni a la petición en curso.
  hooks: {
    logMethod(args, method, level) {
      if (level >= 50) {
        const bindings = typeof this.bindings === "function" ? this.bindings() : {};
        persistErrorLog(level >= 60 ? "fatal" : "error", args, bindings);
      }
      return method.apply(this, args);
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
