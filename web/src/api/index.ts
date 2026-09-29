import { createHttpApi, type BatonApi } from "./http";
import { createMockApi } from "./mock";

export type { BatonApi } from "./http";
export { ApiError } from "./http";

/** "mock" runs the scripted in-browser fake; anything else talks to FastAPI under /api. */
export const apiMode: "mock" | "http" = import.meta.env.VITE_API_MODE === "mock" ? "mock" : "http";

export const api: BatonApi = apiMode === "mock" ? createMockApi() : createHttpApi();
