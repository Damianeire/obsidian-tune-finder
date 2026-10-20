declare module "*.wasm" {
	const bytes: Uint8Array;
	export default bytes;
}

/** The engine worker's bundled code, built by esbuild.config.mjs. */
declare module "inline-worker" {
	const code: string;
	export default code;
}
