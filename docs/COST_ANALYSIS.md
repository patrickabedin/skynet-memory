# Cost Analysis

## Model Pricing (OpenRouter, March 2026)

| Model | Input | Output |
|---|---|---|
| Claude Haiku 4.5 | $0.25/M tokens | $1.25/M tokens |
| text-embedding-3-small | $0.02/M tokens | — |

## Per-Component Daily Cost

### IngestAgent (20 entries/day)
| Step | Input | Output | Cost |
|---|---|---|---|
| Entity extraction (Haiku) | 250 tokens/entry | 80 tokens/entry | $0.000163/entry |
| Embedding (text-embedding-3-small) | 50 tokens/entry | — | $0.000001/entry |
| **20 entries/day** | | | **$0.003/day** |

### ConsolidateAgent (48 runs/day × 30min interval)
| Scenario | Entries/run | Input tokens | Output tokens | Cost/run |
|---|---|---|---|---|
| Skip (0 entries) | 0 | 0 | 0 | $0.000 |
| Normal | 5 | ~650 | ~300 | $0.000538 |
| High activity | 10 | ~1,200 | ~450 | $0.000285 |

**Daily cost at 48 runs (mix of skip + normal):**
- Assume 40% skip rate (nights, quiet periods) → ~29 active runs
- 29 × $0.000538 = **~$0.016/day** (conservative)
- Worst case (all active): 48 × $0.000538 = **$0.026/day**

### QueryAgent (10 queries/day)
| Step | Input | Output | Cost |
|---|---|---|---|
| Query embedding | 20 tokens | — | $0.0000004 |
| Haiku synthesis | ~1,500 tokens | ~300 tokens | $0.000750 |
| **10 queries/day** | | | **$0.008/day** |

### Session Auto-Export (24 runs/day × 60min)
| Step | Input | Output | Cost |
|---|---|---|---|
| Session history read + extraction | ~800 tokens | ~200 tokens | $0.000450/run |
| **24 runs/day** | | | **$0.011/day** |

## Total Daily Cost

| Component | Daily Cost |
|---|---|
| IngestAgent | ~$0.003 |
| ConsolidateAgent | ~$0.016–$0.026 |
| QueryAgent | ~$0.008 |
| Session Auto-Export | ~$0.011 |
| Embeddings | ~$0.00003 |
| **Total** | **~$0.038–$0.048/day** |

**Monthly: ~$1.14–$1.44/month**

## Comparison: Incremental vs Naive

| Approach | Input tokens/run | Daily cost (48 runs) |
|---|---|---|
| **Incremental (this system)** | ~750 (new entries only) | ~$0.026 |
| **Naive full scan (500 entries)** | ~25,000 | ~$1.44 |

**Incremental processing = 55x cost reduction.**

## Cost Alerts

ConsolidateAgent alerts Patrick if:
- Daily cost exceeds $0.08 (approaching $0.10 limit)
- Single run costs > $0.005 (unexpectedly large batch)
