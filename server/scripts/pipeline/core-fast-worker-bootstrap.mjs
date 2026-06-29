try {
  const { tsImport } = await import("tsx/esm/api");
  await tsImport("../../src/pipeline/coreFastWorker.ts", import.meta.url);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code !== "ERR_MODULE_NOT_FOUND") {
    throw error;
  }
  await import("../../dist/pipeline/coreFastWorker.js");
}
