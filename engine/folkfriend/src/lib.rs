// The engine modules of FolkFriend, copied unchanged from
// https://github.com/TomWyllie/folkfriend/tree/d1faa842fde4b5383e542980efe94e548e4789b2/rust/src
// Only the WASM bindings (lib.rs) and the CLI (bin.rs) are left out, because
// their extra dependencies no longer build for wasm32. See README.md.
pub mod abc;
pub mod decode;
pub mod feature;
pub mod ff_config;
pub mod index;
pub mod query;
