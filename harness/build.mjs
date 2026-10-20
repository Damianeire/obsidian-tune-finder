import esbuild from "esbuild";
import { inlineWorker } from "../build/inline-worker.mjs";

await esbuild.build({
	entryPoints: ["harness/harness.ts"],
	bundle: true,
	format: "iife",
	target: "es2020",
	plugins: [inlineWorker(process.argv[2] === "production")],
	minify: process.argv[2] === "production",
	outfile: "harness/harness.js",
	logLevel: "info",
});
