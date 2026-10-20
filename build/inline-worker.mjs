import esbuild from "esbuild";

// The engine runs in a Web Worker. The worker (with the WebAssembly inlined)
// is bundled first, and its code is embedded in the main bundle as a string,
// because an Obsidian plugin ships as a single main.js.
export function inlineWorker(minify) {
	return {
		name: "inline-worker",
		setup(build) {
			build.onResolve({ filter: /^inline-worker$/ }, () => ({ path: "inline-worker", namespace: "inline-worker" }));
			build.onLoad({ filter: /.*/, namespace: "inline-worker" }, async () => {
				const result = await esbuild.build({
					entryPoints: ["src/worker.ts"],
					bundle: true,
					format: "iife",
					target: "es2020",
					loader: { ".wasm": "binary" },
					// The wasm-bindgen glue only reads import.meta.url when no module is
					// passed to init. The worker always passes the inlined bytes.
					define: { "import.meta.url": '"about:blank"' },
					minify,
					write: false,
					logLevel: "warning",
				});
				return {
					contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
					loader: "js",
					watchFiles: [
						"src/worker.ts",
						"src/search.ts",
						"src/engine-protocol.ts",
						"engine/pkg/tune_finder_engine.js",
						"engine/pkg/tune_finder_engine_bg.wasm",
					],
				};
			});
		},
	};
}
