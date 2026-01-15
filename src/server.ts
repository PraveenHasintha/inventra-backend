/**
 * server.ts = starts the backend server.
 */
import { app } from "./app";
import { ENV } from "./config/env";

app.listen(ENV.PORT, () => {
  console.log(`✅ Inventra backend running on http://localhost:${ENV.PORT}`);
});
