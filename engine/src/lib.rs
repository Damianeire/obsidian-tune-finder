//! A thin WebAssembly wrapper around FolkFriend's transcription and search
//! engine (https://github.com/TomWyllie/folkfriend, GPL-3.0-only).
//!
//! FolkFriend's own WASM API feeds audio one 1024-sample window at a time
//! through raw pointers. This wrapper takes a whole PCM slice instead, loads
//! the tune index from a JSON string, and returns compact JSON results.

use folkfriend::decode::FeatureDecoder;
use folkfriend::feature::FeatureExtractor;
use folkfriend::index::TuneIndex;
use folkfriend::query::QueryEngine;
use serde::Serialize;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct QueryResult<'a> {
    setting_id: &'a str,
    tune_id: &'a str,
    name: &'a str,
    score: f32,
    dance: &'a str,
    meter: &'a str,
    mode: &'a str,
}

#[derive(Serialize)]
struct SettingInfo<'a> {
    setting_id: &'a str,
    dance: &'a str,
    meter: &'a str,
    mode: &'a str,
}

#[wasm_bindgen]
pub struct Engine {
    query_engine: QueryEngine,
    loaded: bool,
    /// Setting ids for each tune, oldest first.
    settings_by_tune: HashMap<String, Vec<String>>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine {
            query_engine: QueryEngine::new(),
            loaded: false,
            settings_by_tune: HashMap::new(),
        }
    }

    /// Version of the FolkFriend engine this was built against.
    pub fn folkfriend_version() -> String {
        folkfriend::ff_config::VERSION.to_string()
    }

    /// Load the tune index (FolkFriend's `folkfriend-non-user-data.json`,
    /// ideally with each setting's `abc` emptied). Returns the number of
    /// settings loaded.
    pub fn load_index(&mut self, json: &str) -> Result<usize, JsError> {
        let index: TuneIndex = serde_json::from_str(json)
            .map_err(|e| JsError::new(&format!("Could not parse tune index: {}", e)))?;
        let count = index.settings.len();
        let mut by_tune: HashMap<String, Vec<String>> = HashMap::new();
        for (setting_id, setting) in &index.settings {
            by_tune.entry(setting.tune_id.clone()).or_default().push(setting_id.clone());
        }
        for ids in by_tune.values_mut() {
            ids.sort_by_key(|id| id.parse::<u64>().unwrap_or(u64::MAX));
        }
        self.settings_by_tune = by_tune;
        self.query_engine.use_tune_index(index);
        self.loaded = true;
        Ok(count)
    }

    pub fn is_loaded(&self) -> bool {
        self.loaded
    }

    /// Transcribe mono PCM audio into a FolkFriend contour string (one
    /// character per quaver).
    pub fn transcribe(&self, pcm: &[f32], sample_rate: u32) -> Result<String, JsError> {
        transcribe(pcm, sample_rate)
    }

    /// Search the index for a contour. Returns a JSON array of the best `n`
    /// tunes (one setting per tune), best first.
    pub fn query(&self, contour: &str, n: usize) -> Result<String, JsError> {
        if !self.loaded {
            return Err(JsError::new("Tune index is not loaded"));
        }
        let results = self
            .query_engine
            .run_contour_query(&contour.to_string())
            .map_err(|_| JsError::new("Query failed"))?;
        let out: Vec<QueryResult> = results
            .iter()
            .take(n)
            .map(|r| QueryResult {
                setting_id: &r.setting_id,
                tune_id: &r.setting.tune_id,
                name: &r.display_name,
                score: r.score,
                dance: &r.setting.dance,
                meter: &r.setting.meter,
                mode: &r.setting.mode,
            })
            .collect();
        Ok(serde_json::to_string(&out)?)
    }

    /// A tune's settings on thesession.org, oldest first, as a JSON array of
    /// {setting_id, dance, meter, mode}. Empty for an unknown tune. (FolkFriend's
    /// own lookup panics on unknown ids, which would kill the worker.)
    pub fn tune_settings(&self, tune_id: &str) -> String {
        let index = match &self.query_engine.tune_index {
            Some(index) => index,
            None => return "[]".to_string(),
        };
        let out: Vec<SettingInfo> = self
            .settings_by_tune
            .get(tune_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| {
                        index.settings.get(id).map(|s| SettingInfo {
                            setting_id: id,
                            dance: &s.dance,
                            meter: &s.meter,
                            mode: &s.mode,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        serde_json::to_string(&out).unwrap_or_else(|_| "[]".to_string())
    }

    /// Render a contour string as a rough ABC transcription.
    pub fn contour_to_abc(&self, contour: &str) -> String {
        let contour =
            folkfriend::decode::types::contour_string_to_contour(&contour.to_string());
        folkfriend::abc::contour_to_abc(&contour)
    }
}

pub fn transcribe(pcm: &[f32], sample_rate: u32) -> Result<String, JsError> {
    let mut extractor = FeatureExtractor::new(sample_rate)
        .map_err(|_| JsError::new(&format!("Unsupported sample rate {}", sample_rate)))?;
    let decoder = FeatureDecoder::new(sample_rate)
        .map_err(|_| JsError::new(&format!("Unsupported sample rate {}", sample_rate)))?;
    extractor.feed_signal(pcm.to_vec());
    let lattice_path = decoder
        .decode_lattice_path(&mut extractor.features)
        .map_err(|_| JsError::new("No notes detected"))?;
    decoder
        .decode_contour(&lattice_path, &extractor.features)
        .map_err(|_| JsError::new("No notes detected"))
}
