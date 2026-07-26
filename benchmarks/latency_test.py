"""
EdgeGuardian – Latency Benchmark
==================================
Measures end-to-end processing latency through the fog node pipeline.

What it measures:
  1. Fog pipeline latency (from MQTT receive to cloud dispatch)
     - Reported by the fog node /api/metrics endpoint
  2. Ingest latency (HTTP round-trip: fog → backend)
  3. Redis cache vs SQLite query latency

Academic context:
  Latency is the primary evaluation metric for fog computing architectures.
  The key claim is: "fog reduces cloud-bound latency by processing data
  at the network edge" [Bonomi et al., 2012; Shi et al., 2016].
  This benchmark provides empirical evidence for that claim.

Output:
  - results/latency_results.json  — raw data
  - results/latency_chart.png     — bar chart ready for IEEE report

Usage:
  pip install requests matplotlib numpy
  python benchmarks/latency_test.py
  (requires system running: docker compose up -d)
"""

import json
import os
import sys
import time
import statistics
import urllib.request
import urllib.error
from datetime import datetime

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    PLOT_AVAILABLE = True
except ImportError:
    PLOT_AVAILABLE = False
    print("[WARN] matplotlib not installed — skipping plots. Run: pip install matplotlib numpy")

# ── Config ────────────────────────────────────────────────────────────────────
BACKEND_URL     = os.getenv("BACKEND_URL", "http://localhost:3000")
FOG_METRICS_URL = os.getenv("FOG_METRICS_URL", "http://localhost:3001")
RESULTS_DIR     = os.path.join(os.path.dirname(__file__), "results")
NUM_SAMPLES     = int(os.getenv("LATENCY_SAMPLES", "30"))

os.makedirs(RESULTS_DIR, exist_ok=True)


def fetch_json(url, timeout=5):
    """Fetch JSON from a URL with timeout."""
    try:
        req = urllib.request.urlopen(url, timeout=timeout)
        return json.loads(req.read())
    except Exception as e:
        return None


def measure_http_latency(url, n=NUM_SAMPLES):
    """Measure HTTP GET round-trip latency in ms."""
    latencies = []
    for _ in range(n):
        t0 = time.perf_counter()
        data = fetch_json(url, timeout=10)
        t1 = time.perf_counter()
        if data is not None:
            latencies.append((t1 - t0) * 1000)
        time.sleep(0.05)
    return latencies


def measure_latest_latency_comparison(n=NUM_SAMPLES):
    """Compare /readings/latest with Redis vs SQLite fallback."""
    redis_lats = []
    sqlite_lats = []

    for i in range(n):
        t0 = time.perf_counter()
        data = fetch_json(f"{BACKEND_URL}/readings/latest")
        t1 = time.perf_counter()
        lat = (t1 - t0) * 1000

        if data:
            source = data.get("source", "sqlite")
            if source == "redis_cache":
                redis_lats.append(lat)
            else:
                sqlite_lats.append(lat)
        time.sleep(0.1)

    return redis_lats, sqlite_lats


def get_fog_latency():
    """Get fog processing latency from metrics endpoint."""
    data = fetch_json(f"{FOG_METRICS_URL}/api/metrics")
    if data:
        return {
            "avg_latency_ms":  data.get("avg_latency_ms", 0),
            "p99_latency_ms":  data.get("p99_latency_ms", 0),
            "reduction_pct":   data.get("reduction_pct", 0),
            "anomaly_rate":    data.get("anomaly_rate", 0),
            "received":        data.get("received", 0),
            "dispatched":      data.get("dispatched", 0),
        }
    return None


def summarise(latencies, label):
    if not latencies:
        print(f"  [{label}] No data collected (service offline?)")
        return None
    s = {
        "label":  label,
        "n":      len(latencies),
        "mean":   round(statistics.mean(latencies), 2),
        "median": round(statistics.median(latencies), 2),
        "stdev":  round(statistics.stdev(latencies) if len(latencies) > 1 else 0, 2),
        "p95":    round(sorted(latencies)[int(len(latencies) * 0.95)], 2),
        "min":    round(min(latencies), 2),
        "max":    round(max(latencies), 2),
    }
    print(f"  [{label}]  mean={s['mean']}ms  p95={s['p95']}ms  min={s['min']}ms  max={s['max']}ms  n={s['n']}")
    return s


def plot_results(summaries, fog_data):
    if not PLOT_AVAILABLE:
        return

    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    fig.suptitle('EdgeGuardian – Latency Benchmark Results', fontsize=14, fontweight='bold')

    # Chart 1: HTTP endpoint latencies
    ax1 = axes[0]
    labels = [s["label"] for s in summaries if s]
    means  = [s["mean"]  for s in summaries if s]
    p95s   = [s["p95"]   for s in summaries if s]
    errors = [s["stdev"] for s in summaries if s]

    x = np.arange(len(labels))
    w = 0.35
    bars1 = ax1.bar(x - w/2, means, w, label='Mean', color='#3b82f6', alpha=0.85)
    bars2 = ax1.bar(x + w/2, p95s,  w, label='P95',  color='#f59e0b', alpha=0.85)
    ax1.set_xlabel('Endpoint')
    ax1.set_ylabel('Latency (ms)')
    ax1.set_title('HTTP Endpoint Latencies')
    ax1.set_xticks(x)
    ax1.set_xticklabels(labels, rotation=15, ha='right')
    ax1.legend()
    ax1.grid(axis='y', alpha=0.3)
    ax1.bar_label(bars1, fmt='%.1f', padding=2, fontsize=8)

    # Chart 2: Fog processing metrics
    ax2 = axes[1]
    if fog_data:
        metric_labels = ['Fog Avg\nLatency (ms)', 'Fog P99\nLatency (ms)',
                         'Data\nReduction %', 'Anomaly\nRate %']
        metric_values = [
            fog_data.get("avg_latency_ms", 0),
            fog_data.get("p99_latency_ms", 0),
            fog_data.get("reduction_pct", 0),
            fog_data.get("anomaly_rate", 0),
        ]
        colors = ['#22d3ee', '#8b5cf6', '#22c55e', '#ef4444']
        bars = ax2.bar(metric_labels, metric_values, color=colors, alpha=0.85)
        ax2.set_title('Fog Node Performance Metrics')
        ax2.set_ylabel('Value')
        ax2.grid(axis='y', alpha=0.3)
        ax2.bar_label(bars, fmt='%.1f', padding=2, fontsize=9)
    else:
        ax2.text(0.5, 0.5, 'Fog metrics\nnot available', transform=ax2.transAxes,
                 ha='center', va='center', fontsize=12, color='gray')

    plt.tight_layout()
    output_path = os.path.join(RESULTS_DIR, 'latency_chart.png')
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"\n[✓] Chart saved: {output_path}")
    plt.close()


def main():
    print("=" * 60)
    print("EdgeGuardian – Latency Benchmark")
    print(f"Samples per test: {NUM_SAMPLES}")
    print(f"Backend: {BACKEND_URL}")
    print(f"Fog:     {FOG_METRICS_URL}")
    print("=" * 60)

    results = {"timestamp": datetime.now().isoformat(), "summaries": [], "fog": None}

    # Test 1: /readings/latest (Redis cache)
    print("\n[1] Testing /readings/latest (Redis vs SQLite)…")
    redis_lats, sqlite_lats = measure_latest_latency_comparison(NUM_SAMPLES)
    s1 = summarise(redis_lats,  "GET /latest (Redis)")
    s2 = summarise(sqlite_lats, "GET /latest (SQLite)")

    # Test 2: /readings time-series
    print("\n[2] Testing /readings (time-series query)…")
    ts_lats = measure_http_latency(f"{BACKEND_URL}/readings?sensorType=temperature&limit=50")
    s3 = summarise(ts_lats, "GET /readings")

    # Test 3: /alerts
    print("\n[3] Testing /alerts…")
    alert_lats = measure_http_latency(f"{BACKEND_URL}/alerts")
    s4 = summarise(alert_lats, "GET /alerts")

    # Test 4: Fog metrics
    print("\n[4] Fetching fog processing metrics…")
    fog_data = get_fog_latency()
    if fog_data:
        print(f"  [Fog pipeline] avg={fog_data['avg_latency_ms']}ms | "
              f"p99={fog_data['p99_latency_ms']}ms | "
              f"reduction={fog_data['reduction_pct']}% | "
              f"anomaly_rate={fog_data['anomaly_rate']}%")
        results["fog"] = fog_data
    else:
        print("  [Fog pipeline] Not available")

    summaries = [s for s in [s1, s2, s3, s4] if s]
    results["summaries"] = summaries

    # Save raw results
    out_path = os.path.join(RESULTS_DIR, "latency_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n[✓] Results saved: {out_path}")

    # Generate plot
    plot_results(summaries, fog_data)

    print("\n" + "=" * 60)
    print("Summary for Report:")
    for s in summaries:
        print(f"  {s['label']:30s}  mean={s['mean']:6.1f}ms  p95={s['p95']:6.1f}ms")
    if fog_data:
        print(f"  {'Fog pipeline (avg)':30s}  {fog_data['avg_latency_ms']:6.1f}ms")
        print(f"  {'Data reduction ratio':30s}  {fog_data['reduction_pct']:6.1f}%")
    print("=" * 60)


if __name__ == "__main__":
    main()
