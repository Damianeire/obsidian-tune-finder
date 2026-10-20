// Copy the built plugin into a vault: node scripts/install-plugin.mjs <vault>
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const vault = process.argv[2];
if (!vault || !existsSync(join(vault, ".obsidian"))) {
	console.error("Usage: node scripts/install-plugin.mjs <vault folder containing .obsidian>");
	process.exit(1);
}
const dest = join(vault, ".obsidian", "plugins", "tune-finder");
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, join(dest, f));
console.log(`Installed to ${dest}. Reload Obsidian (or turn the plugin off and on) to pick it up.`);
