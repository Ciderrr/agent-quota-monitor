// 燃烧速率预测引擎（v0.2 / F1）。纯函数、可单测、零 IO。
// 方法：新近加权最小二乘（区别于 ccusage 的端点法——端点对单点噪声敏感）；
// 已知坑的对策：重置跳升截断、斜率≈0 不预测、耗尽晚于重置不显示、
// 样本稀疏不预测（启发式预测普遍偏乐观约 35%，故只出区间+置信度，不出伪精确点）。
use crate::types::{PeriodType, QuotaBucket, Unit};
use serde::Serialize;

/// 桶级燃烧预测（已应用重置封顶/燃烧门槛/置信度过滤）
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BucketPrediction {
    pub provider_id: String,
    pub bucket_id: String,
    pub label: String,
    pub rate_pct_per_hour: f64,
    pub exhaust_at: String,
    pub exhaust_low: String,
    pub exhaust_high: String,
    pub confidence: String,
    pub window_hours: f64,
}

/// DeepSeek 余额日均消耗趋势（真实余额历史的线性外推，仅估趋势不伪造消费）
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BalancePrediction {
    pub provider_id: String,
    pub daily_burn: f64,
    pub currency: String,
    pub days_left: f64,
    pub confidence: String,
}

/// 切换建议条目（同组其他可用 Provider 的代表余量）
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Alternative {
    pub provider_id: String,
    pub name: String,
    pub remaining_pct: Option<f64>,
    pub reset_at: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub predictions: std::collections::HashMap<String, Vec<BucketPrediction>>,
    pub balance: std::collections::HashMap<String, BalancePrediction>,
    pub alternatives: std::collections::HashMap<String, Vec<Alternative>>,
}

pub fn ms_to_iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default()
}

pub fn iso_to_ms(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis())
}

/// 由拟合结果构造对外预测：套四道门槛（燃烧中 / 可耗尽 / 7 天内 / 重置先到则不出）
pub fn build_bucket_prediction(
    provider_id: &str,
    bucket_id: &str,
    label: String,
    fit: &Fit,
    confidence: &str,
    reset_ms: Option<i64>,
    now_ms: i64,
) -> Option<BucketPrediction> {
    if fit.slope_per_hour > -0.1 {
        return None; // 未在有效燃烧（≈0 或回升）
    }
    let exhaust_in_h = fit.last_pct / (-fit.slope_per_hour);
    if exhaust_in_h <= 0.0 || exhaust_in_h > 168.0 {
        return None; // 7 天外的预测没有行动价值
    }
    let exhaust_ms = now_ms + (exhaust_in_h * 3_600_000.0) as i64;
    if let Some(r) = reset_ms {
        if exhaust_ms >= r {
            return None; // 重置先到 → 额度会先回填，预测无意义
        }
    }
    let margin_ms = ((exhaust_in_h * 0.25).clamp(1.0 / 6.0, 6.0) * 3_600_000.0) as i64;
    Some(BucketPrediction {
        provider_id: provider_id.into(),
        bucket_id: bucket_id.into(),
        label,
        rate_pct_per_hour: fit.slope_per_hour,
        exhaust_at: ms_to_iso(exhaust_ms),
        exhaust_low: ms_to_iso(exhaust_ms - margin_ms),
        exhaust_high: ms_to_iso(exhaust_ms + margin_ms),
        confidence: confidence.into(),
        window_hours: fit.span_hours,
    })
}

/// 代表桶（与前端 pickPrimaryBucket 同语义）：聚合桶 > 5h > 月度 > 日 > 周/账期 > 其他 > 积分；reserve 永远垫底
pub fn representative_bucket(buckets: &[QuotaBucket]) -> Option<QuotaBucket> {
    let is_reserve = |b: &QuotaBucket| {
        let t = format!("{} {}", b.id, b.label_raw.clone().unwrap_or_default()).to_lowercase();
        t.contains("reserve")
    };
    let prio = |b: &QuotaBucket| -> i32 {
        if b.id.ends_with("/all") {
            return -1;
        }
        if is_reserve(b) {
            return 90;
        }
        match &b.period_type {
            PeriodType::Rolling { .. } => 0,
            PeriodType::Monthly => 10,
            PeriodType::Daily => 15,
            PeriodType::Weekly | PeriodType::BillingCycle => 20,
            _ => {
                if matches!(b.unit, Unit::Credits) {
                    80
                } else {
                    50
                }
            }
        }
    };
    let cands: Vec<&QuotaBucket> = buckets.iter().filter(|b| b.remaining_percent.is_some()).collect();
    if let Some(a) = cands.iter().find(|b| b.id.ends_with("/all")) {
        return Some((*a).clone());
    }
    let normal: Vec<&&QuotaBucket> = cands.iter().filter(|b| !is_reserve(b)).collect();
    let pool: Vec<&QuotaBucket> = if normal.is_empty() { cands } else { normal.into_iter().cloned().collect() };
    pool.into_iter()
        .min_by(|a, b| {
            let (pa, pb) = (prio(a), prio(b));
            if pa != pb {
                pa.cmp(&pb)
            } else {
                a.remaining_percent.partial_cmp(&b.remaining_percent).unwrap_or(std::cmp::Ordering::Equal)
            }
        })
        .cloned()
}

/// 一段样本序列的拟合结果：斜率（%/小时，负=燃烧中）、R²、样本数、跨度、最新剩余
pub struct Fit {
    pub slope_per_hour: f64,
    pub r2: f64,
    pub n: usize,
    pub span_hours: f64,
    pub last_pct: f64,
}

/// 对升序 (ts_ms, remaining_pct) 序列拟合燃烧速率。
/// 内部处理：重置跳升截断（>5 点的向上跳变切掉历史窗口）、样本不足返回 None。
pub fn fit_burn(samples: &[(i64, f64)]) -> Option<Fit> {
    if samples.len() < 3 {
        return None;
    }
    // 重置截断：剩余额度在两次重置之间只降不升，"新样本比紧邻前样本高出 30 点以上"
    // 只可能来自重置填充。从最新往回扫，找到最近一次跳升即截断其前历史。
    // （v0.2 单测抓过初版 bug：按"高于其后最小值+5"判会把单调下降序列误判为跳升。）
    let mut start = 0usize;
    for i in (0..samples.len() - 1).rev() {
        if samples[i].1 + 30.0 < samples[i + 1].1 {
            start = i + 1; // 跳升样本与其后为新窗口
            break;
        }
    }
    let s = &samples[start..];
    if s.len() < 3 {
        return None;
    }
    let span_ms = s[s.len() - 1].0 - s[0].0;
    if span_ms <= 0 {
        return None;
    }
    let span_hours = span_ms as f64 / 3_600_000.0;
    // 新近加权：w = 0.5 + x/span ∈ [0.5, 1.5]，最新样本权重最大
    let hours_from_start = |ts: i64| -> f64 { (ts - s[0].0) as f64 / 3_600_000.0 };
    let weight = |x: f64| -> f64 { 0.5 + x / span_hours };
    let mut sw = 0.0;
    let mut swx = 0.0;
    let mut swy = 0.0;
    for (ts, y) in s {
        let x = hours_from_start(*ts);
        let w = weight(x);
        sw += w;
        swx += w * x;
        swy += w * y;
    }
    let mx = swx / sw;
    let my = swy / sw;
    let mut sxx = 0.0;
    let mut sxy = 0.0;
    for (ts, y) in s {
        let x = hours_from_start(*ts);
        let w = weight(x);
        sxx += w * (x - mx) * (x - mx);
        sxy += w * (x - mx) * (y - my);
    }
    if sxx <= 1e-9 {
        return None;
    }
    let slope = sxy / sxx;
    let intercept = my - slope * mx;
    let mut ss_res = 0.0;
    let mut ss_tot = 0.0;
    for (ts, y) in s {
        let x = hours_from_start(*ts);
        let w = weight(x);
        let pred = intercept + slope * x;
        ss_res += w * (y - pred) * (y - pred);
        ss_tot += w * (y - my) * (y - my);
    }
    let r2 = if ss_tot > 1e-9 { 1.0 - ss_res / ss_tot } else { 0.0 };
    Some(Fit {
        slope_per_hour: slope,
        r2,
        n: s.len(),
        span_hours,
        last_pct: s[s.len() - 1].1,
    })
}

/// 置信度分级：样本数 + 跨度 + 拟合优度。不达标返回 None（宁可不显示，不瞎猜）。
pub fn confidence_of(f: &Fit) -> Option<&'static str> {
    if f.n >= 8 && f.span_hours >= 0.75 && f.r2 >= 0.85 {
        Some("high")
    } else if f.n >= 4 && f.span_hours >= 0.33 {
        Some("medium")
    } else if f.n >= 3 && f.span_hours >= 0.15 {
        Some("low")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const H: i64 = 3_600_000;

    #[test]
    fn 均匀采样_线性燃烧_斜率准确() {
        // -10%/h：5 个点，每小时掉 10
        let s: Vec<(i64, f64)> = (0..5).map(|i| (i * H, 90.0 - 10.0 * i as f64)).collect();
        let f = fit_burn(&s).unwrap();
        assert!((f.slope_per_hour - (-10.0)).abs() < 0.01);
        assert_eq!(f.last_pct, 50.0);
        assert!(f.r2 > 0.999);
    }

    #[test]
    fn 不均匀采样_加权回归仍收敛() {
        // 间隔 5min/40min/7min/23min 混合，真实速率 -8%/h（±0.05 噪声）
        let pts = [(0, 80.0), (5, 79.35), (45, 74.0), (52, 73.05), (75, 70.0), (98, 66.95)];
        let s: Vec<(i64, f64)> = pts.iter().map(|(m, v)| (m * 60_000, *v)).collect();
        let f = fit_burn(&s).unwrap();
        assert!((f.slope_per_hour - (-8.0)).abs() < 0.5, "slope={}", f.slope_per_hour);
    }

    #[test]
    fn 重置跳升_截断旧窗口() {
        // 旧窗口烧到 40 → 重置跳回 90 → 再按 -10/h 烧；拟合只应使用重置后的样本
        let s = vec![
            (0 * H, 90.0),
            (1 * H, 80.0),
            (2 * H, 60.0),
            (3 * H, 40.0),
            (4 * H, 90.0), // 重置
            (5 * H, 80.0),
            (6 * H, 70.0),
        ];
        let f = fit_burn(&s).unwrap();
        assert_eq!(f.n, 3, "应只保留重置后的 3 个样本");
        assert!((f.slope_per_hour - (-10.0)).abs() < 0.2, "slope={}", f.slope_per_hour);
    }

    #[test]
    fn 样本不足_返回None() {
        assert!(fit_burn(&[(0, 50.0), (H, 40.0)]).is_none());
        assert!(fit_burn(&[]).is_none());
    }

    #[test]
    fn 空闲无燃烧_斜率近零() {
        let s: Vec<(i64, f64)> = (0..6).map(|i| (i * H, 80.0)).collect();
        let f = fit_burn(&s).unwrap();
        assert!(f.slope_per_hour.abs() < 0.001);
        assert!(confidence_of(&f).is_some()); // 数据质量够，只是没在燃烧 → 上层据斜率决定不显示
    }

    #[test]
    fn 高质量序列_高置信() {
        let s: Vec<(i64, f64)> = (0..10).map(|i| (i * H / 2, 90.0 - 5.0 * i as f64)).collect();
        let f = fit_burn(&s).unwrap();
        assert_eq!(confidence_of(&f), Some("high"));
    }

    #[test]
    fn 新近加权_近期减速时预测贴近近期速率() {
        // 前 4 小时 -20%/h，后 2 小时 -2%/h：普通 OLS 会被早期陡降拉偏，
        // 新近加权应明显贴近近期速率
        let mut s: Vec<(i64, f64)> = (0..4).map(|i| (i * H, 90.0 - 20.0 * i as f64)).collect();
        for i in 1..=3usize {
            s.push(((3 + i as i64) * H, 30.0 - 2.0 * i as f64));
        }
        let f = fit_burn(&s).unwrap();
        assert!(f.slope_per_hour > -14.0, "加权后斜率应明显缓于全窗平均：{}", f.slope_per_hour);
    }
}
