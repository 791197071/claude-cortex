//! 统计（stats）命令：把所有会话聚合成统计页所需的数据集。
//!
//! 纯本地、离线计算：从 `sessions::list_sessions` 拿到全部会话，再按「总量 / 按项目 /
//! 按天 / 按模型」四个维度聚合。日线只保留最近 14 天，避免图表过长。

use crate::commands::sessions::list_sessions;
use crate::models::{DayStats, ProjectStats, Stats};
use crate::util::day_key_from_timestamp;
use std::collections::HashMap;

/// 计算统计总览。
#[tauri::command]
pub fn get_stats() -> Stats {
    let sessions = list_sessions();
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut total_cache_read = 0u64;
    let mut total_cache_write = 0u64;
    let mut proj_map: HashMap<String, (u64, u64, u64)> = HashMap::new();
    let mut day_map: HashMap<String, (u64, u64, HashMap<String, u64>)> = HashMap::new();
    let mut model_totals: HashMap<String, u64> = HashMap::new();
    let mut model_input_totals: HashMap<String, u64> = HashMap::new();
    let mut model_output_totals: HashMap<String, u64> = HashMap::new();

    for s in &sessions {
        total_input += s.input_tokens;
        total_output += s.output_tokens;
        total_cache_read += s.cache_read_tokens;
        total_cache_write += s.cache_write_tokens;

        let p = proj_map.entry(s.project.clone()).or_default();
        p.0 += s.input_tokens;
        p.1 += s.output_tokens;
        p.2 += 1;

        let day = day_key_from_timestamp(s.timestamp);
        let d = day_map.entry(day).or_default();
        d.0 += s.input_tokens;
        d.1 += s.output_tokens;
        for (model, tokens) in &s.model_tokens {
            *d.2.entry(model.clone()).or_default() += tokens;
            *model_totals.entry(model.clone()).or_default() += tokens;
        }
        for (model, t) in &s.model_input_tokens {
            *model_input_totals.entry(model.clone()).or_default() += t;
        }
        for (model, t) in &s.model_output_tokens {
            *model_output_totals.entry(model.clone()).or_default() += t;
        }
    }

    let mut projects: Vec<ProjectStats> = proj_map
        .into_iter()
        .map(|(project, (i, o, c))| ProjectStats {
            project,
            input_tokens: i,
            output_tokens: o,
            session_count: c,
        })
        .collect();
    projects.sort_by(|a, b| (b.input_tokens + b.output_tokens).cmp(&(a.input_tokens + a.output_tokens)));

    let mut daily: Vec<DayStats> = day_map
        .into_iter()
        .map(|(date, (i, o, models))| DayStats { date, input_tokens: i, output_tokens: o, models })
        .collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));
    if daily.len() > 14 {
        daily = daily.split_off(daily.len() - 14);
    }

    Stats {
        daily,
        projects,
        total_input,
        total_output,
        session_count: sessions.len() as u64,
        model_totals,
        model_input_totals,
        model_output_totals,
        total_cache_read,
        total_cache_write,
    }
}
