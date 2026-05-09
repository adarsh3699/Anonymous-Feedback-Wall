// @ts-check
import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
    output: "hybrid",
    adapter: cloudflare()
});