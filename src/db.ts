import postgres from "postgres";
import { env } from "./config";

export const sql = postgres(env.databaseUrl, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});
