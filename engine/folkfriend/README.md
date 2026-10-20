# Vendored FolkFriend engine

These files are from [FolkFriend](https://github.com/TomWyllie/folkfriend) by Tom Wyllie, licensed under GPL-3.0-only (see `LICENSE`).

- Source: `rust/src` at commit `d1faa842fde4b5383e542980efe94e548e4789b2` (5 Dec 2024).
- Copied unchanged: `abc/`, `decode/`, `feature/`, `index/`, `query/`, `ff_config.rs`.
- Left out: `lib.rs` (WASM bindings) and `bin.rs` (CLI). They pull in `reqwest`, `image`, `indicatif` and others, and those no longer build for `wasm32` with current crate versions. The replacement `lib.rs` only declares the modules.
- `Cargo.toml` lists only the dependencies the engine modules use.

The WASM interface Tune Finder uses lives in `../src/lib.rs`.
