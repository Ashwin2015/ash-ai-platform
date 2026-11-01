import type { PlatformConfig } from "../config.ts";
import { PlatformDatabase } from "./database.ts";
import { PostgresDatabase } from "./postgres.ts";

export function wrapDatabase<T extends object>(database: T) {
  return new Proxy(database, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property === "close") {
        return () => Promise.resolve(value.apply(target, []));
      }
      return (...args: unknown[]) => Promise.resolve(value.apply(target, args));
    },
  }) as T;
}

export function openDatabase(config: PlatformConfig) {
  if (config.databaseUrl) {
    return wrapDatabase(new PostgresDatabase(config.databaseUrl, {
      applyMigrations: config.applyMigrations === true,
      migrationsDirectory: config.migrationsDirectory,
    }));
  }
  return wrapDatabase(new PlatformDatabase(config.databasePath));
}
