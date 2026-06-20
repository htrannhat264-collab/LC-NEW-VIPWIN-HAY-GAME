const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ================================================================
// FILE LƯU DATA
// ================================================================
const DATA_FILE = path.join(__dirname, 'data.json');

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

// ================================================================
// CẤU HÌNH GAME
// ================================================================
const GAME_CONFIG = {
  'lc79_tx': {
    name: 'LC79 HŨ',
    link: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5'
  },
  'lc79_txmd5': {
    name: 'LC79 MD5',
    link: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8'
  }
};

// ================================================================
// KHỞI TẠO STORE
// ================================================================
let store = {};

function initStore() {
  const saved = readData();
  if (saved && Object.keys(saved).length > 0) {
    store = saved;
    console.log('✅ Load data từ file');
    return;
  }

  for (let key in GAME_CONFIG) {
    store[key] = {
      history: [],
      predictHistory: [],
      stats: { 
        tong: 0, dung: 0, sai: 0, tiLe: '0%',
        winStreak: 0, maxWinStreak: 0, loseStreak: 0, maxLoseStreak: 0
      },
      statsAdv: { 
        skewness: 0, kurtosis: 0, entropy: 0, variance: 0, stdDev: 0,
        momentum: 0, volatility: 0, rsi: 50, macd: 0, signal: 0,
        bollingerUpper: 0, bollingerMiddle: 0, bollingerLower: 0,
        stochastic: 0, williamsR: 0, cci: 0, adx: 0,
        aroonUp: 0, aroonDown: 0, cmf: 0, obv: 0
      },
      memory: {
        streak: { current: 0, max: 0 },
        zigzag: { pattern: [], length: 0 },
        markov: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {}, 8: {}, 9: {}, 10: {} },
        cycle: { detected: false, length: 0, confidence: 0 },
        pattern: { templates: [], matches: 0 },
        neural: { weights: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], bias: 0 }
      }
    };
  }
  writeData(store);
  console.log('✅ Tạo mới data');
}

initStore();

// ================================================================
// HÀM TOÁN NÂNG CẤP
// ================================================================
function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr, m) {
  if (!arr || arr.length === 0) return 0;
  if (m === undefined) m = mean(arr);
  return arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length;
}

function stddev(arr) {
  if (!arr || arr.length === 0) return 0;
  return Math.sqrt(variance(arr));
}

function skewness(arr) {
  if (!arr || arr.length < 3) return 0;
  const m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 0;
  const n = arr.length;
  return (n / ((n - 1) * (n - 2))) * arr.reduce((a, b) => a + Math.pow((b - m) / s, 3), 0);
}

function kurtosis(arr) {
  if (!arr || arr.length < 4) return 0;
  const m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 0;
  const n = arr.length;
  return (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * arr.reduce((a, b) => a + Math.pow((b - m) / s, 4), 0) - (3 * Math.pow(n - 1, 2) / ((n - 2) * (n - 3)));
}

function entropy(arr) {
  if (!arr || arr.length === 0) return 0;
  const counts = {};
  arr.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
  let e = 0;
  Object.values(counts).forEach(c => { const p = c / arr.length; e -= p * Math.log2(p); });
  return e;
}

function correlation(arr1, arr2) {
  if (!arr1 || !arr2 || arr1.length !== arr2.length || arr1.length < 2) return 0;
  const n = arr1.length;
  const m1 = mean(arr1), m2 = mean(arr2);
  const s1 = stddev(arr1), s2 = stddev(arr2);
  if (s1 === 0 || s2 === 0) return 0;
  let cov = 0;
  for (let i = 0; i < n; i++) cov += (arr1[i] - m1) * (arr2[i] - m2);
  cov /= n;
  return cov / (s1 * s2);
}

function rsiCalculator(history, period = 14) {
  if (history.length < period + 1) return 50;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  let gains = 0, losses = 0;
  for (let i = num.length - period; i < num.length - 1; i++) {
    const diff = num[i + 1] - num[i];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function macdCalculator(history) {
  if (history.length < 26) return { macd: 0, signal: 0 };
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const ema12 = calculateEMA(num, 12);
  const ema26 = calculateEMA(num, 26);
  if (ema12.length < 2 || ema26.length < 2) return { macd: 0, signal: 0 };
  const macdLine = ema12[ema12.length - 1] - ema26[ema26.length - 1];
  const signalLine = calculateEMA([macdLine], 9);
  return { macd: macdLine, signal: signalLine[0] || 0 };
}

function calculateEMA(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  let ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function bollingerBands(history, period = 20, multiplier = 2) {
  if (history.length < period) return { upper: 0, middle: 0, lower: 0 };
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const recent = num.slice(0, period);
  const middle = mean(recent);
  const std = stddev(recent);
  return { upper: middle + std * multiplier, middle, lower: middle - std * multiplier };
}

function stochastic(history, period = 14) {
  if (history.length < period) return 50;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const recent = num.slice(0, period);
  const lowest = Math.min(...recent);
  const highest = Math.max(...recent);
  if (highest === lowest) return 50;
  return ((num[0] - lowest) / (highest - lowest)) * 100;
}

function williamsR(history, period = 14) {
  if (history.length < period) return -50;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const recent = num.slice(0, period);
  const highest = Math.max(...recent);
  const lowest = Math.min(...recent);
  if (highest === lowest) return -50;
  return -((highest - num[0]) / (highest - lowest)) * 100;
}

function cciCalculator(history, period = 20) {
  if (history.length < period) return 0;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const recent = num.slice(0, period);
  const meanVal = mean(recent);
  const mad = recent.reduce((a, b) => a + Math.abs(b - meanVal), 0) / period;
  if (mad === 0) return 0;
  return (num[0] - meanVal) / (0.015 * mad);
}

function adxCalculator(history, period = 14) {
  if (history.length < period + 1) return 0;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 0; i < period; i++) {
    const diff = num[i] - num[i + 1];
    if (diff > 0) plusDM += diff;
    else minusDM += Math.abs(diff);
    tr += Math.abs(num[i] - num[i + 1]);
  }
  if (tr === 0) return 0;
  const plusDI = (plusDM / tr) * 100;
  const minusDI = (minusDM / tr) * 100;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
  return dx;
}

function aroonIndicator(history, period = 14) {
  if (history.length < period) return { up: 0, down: 0 };
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const recent = num.slice(0, period);
  const maxIdx = recent.indexOf(Math.max(...recent));
  const minIdx = recent.indexOf(Math.min(...recent));
  return { up: ((period - 1 - maxIdx) / (period - 1)) * 100, down: ((period - 1 - minIdx) / (period - 1)) * 100 };
}

function chaikinMoneyFlow(history, period = 20) {
  if (history.length < period) return 0;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const mf = [];
  for (let i = 0; i < num.length - 1; i++) {
    mf.push(num[i + 1] - num[i]);
  }
  return mean(mf);
}

function obvCalculator(history) {
  if (history.length < 2) return 0;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  let obv = 0;
  for (let i = 0; i < num.length - 1; i++) {
    if (num[i + 1] > num[i]) obv += num[i + 1];
    else obv -= num[i + 1];
  }
  return obv;
}

function chuanHoa(kq) {
  if (!kq) return null;
  const s = String(kq).toLowerCase().trim();
  if (s === 'tài' || s === 'tai' || s === 'big' || s === 'b') return 'Tài';
  if (s === 'xỉu' || s === 'xiu' || s === 'small' || s === 's') return 'Xỉu';
  return kq;
}

// ================================================================
// 30 THUẬT TOÁN NÂNG CẤP - MỖI PHIÊN CHO TỈ LỆ RIÊNG
// ================================================================
function runAlgorithms(h, memory) {
  const results = [];

  // 1. Streak
  if (h.length >= 2) {
    let s = 1;
    for (let i = 1; i < h.length; i++) {
      if (h[i] === h[0]) s++;
      else break;
    }
    if (s >= 2) {
      const p = h[0] === 'Tài' ? 'Xỉu' : 'Tài';
      let conf = 55 + s * 8;
      if (s >= 5) conf = Math.min(98, 75 + (s - 4) * 8);
      results.push({ ten: 'Streak', du_doan: p, do_tin_cay: conf, mo_ta: `Bệt ${s} phiên` });
    }
  }

  // 2. Zigzag
  if (h.length >= 3) {
    let zigzag = true, length = 0;
    for (let i = 1; i < Math.min(h.length, 10); i++) {
      if (h[i] === h[i - 1]) { zigzag = false; break; }
      length++;
    }
    if (zigzag && length >= 2) {
      const p = h[0] === 'Tài' ? 'Xỉu' : 'Tài';
      let conf = 65 + length * 4;
      results.push({ ten: 'Zigzag', du_doan: p, do_tin_cay: Math.min(92, conf), mo_ta: `Cầu 1-1 dài ${length+1} phiên` });
    }
  }

  // 3. Momentum
  if (h.length >= 4) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const recent = num.slice(0, 2);
    const older = num.slice(2, 4);
    const diff = mean(recent) - mean(older);
    if (Math.abs(diff) > 0.15) {
      const p = diff > 0 ? 'Xỉu' : 'Tài';
      results.push({ ten: 'Momentum', du_doan: p, do_tin_cay: 65 + Math.abs(diff) * 50, mo_ta: `Động lượng ${(diff*100).toFixed(1)}%` });
    }
  }

  // 4. Volatility
  if (h.length >= 6) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const vol = stddev(num);
    if (vol > 0.4) {
      const p = h[0] === 'Tài' ? 'Xỉu' : 'Tài';
      results.push({ ten: 'Volatility', du_doan: p, do_tin_cay: 60 + vol * 40, mo_ta: `Biến động ${vol.toFixed(2)}` });
    }
  }

  // 5. Freq 3
  if (h.length >= 3) {
    const last3 = h.slice(0, 3);
    const t = last3.filter(r => r === 'Tài').length;
    if (t >= 2) results.push({ ten: 'Freq 3', du_doan: 'Xỉu', do_tin_cay: 68, mo_ta: '3 phiên có 2 Tài' });
    else if (t <= 1) results.push({ ten: 'Freq 3', du_doan: 'Tài', do_tin_cay: 68, mo_ta: '3 phiên có 2 Xỉu' });
  }

  // 6. Freq 5
  if (h.length >= 5) {
    const last5 = h.slice(0, 5);
    const t = last5.filter(r => r === 'Tài').length;
    if (t >= 3) results.push({ ten: 'Freq 5', du_doan: 'Xỉu', do_tin_cay: 75, mo_ta: '5 phiên có 3 Tài' });
    else if (t <= 2) results.push({ ten: 'Freq 5', du_doan: 'Tài', do_tin_cay: 75, mo_ta: '5 phiên có 3 Xỉu' });
  }

  // 7. Freq 8
  if (h.length >= 8) {
    const last8 = h.slice(0, 8);
    const t = last8.filter(r => r === 'Tài').length;
    if (t >= 5) results.push({ ten: 'Freq 8', du_doan: 'Xỉu', do_tin_cay: 80, mo_ta: '8 phiên có 5 Tài' });
    else if (t <= 3) results.push({ ten: 'Freq 8', du_doan: 'Tài', do_tin_cay: 80, mo_ta: '8 phiên có 5 Xỉu' });
  }

  // 8. Freq 10
  if (h.length >= 10) {
    const last10 = h.slice(0, 10);
    const t = last10.filter(r => r === 'Tài').length;
    if (t >= 6) results.push({ ten: 'Freq 10', du_doan: 'Xỉu', do_tin_cay: 83, mo_ta: '10 phiên có 6 Tài' });
    else if (t <= 4) results.push({ ten: 'Freq 10', du_doan: 'Tài', do_tin_cay: 83, mo_ta: '10 phiên có 6 Xỉu' });
  }

  // 9. Freq 15
  if (h.length >= 15) {
    const last15 = h.slice(0, 15);
    const t = last15.filter(r => r === 'Tài').length;
    if (t >= 8) results.push({ ten: 'Freq 15', du_doan: 'Xỉu', do_tin_cay: 86, mo_ta: '15 phiên có 8 Tài' });
    else if (t <= 7) results.push({ ten: 'Freq 15', du_doan: 'Tài', do_tin_cay: 86, mo_ta: '15 phiên có 8 Xỉu' });
  }

  // 10-14. Markov 1-5
  for (let level = 1; level <= 5; level++) {
    if (h.length >= level + 1) {
      const m = memory.markov[level];
      const lastState = h.slice(0, level).join('');
      for (let i = 0; i < h.length - level; i++) {
        const state = h.slice(i + 1, i + 1 + level).join('');
        const next = h[i];
        if (!m[state]) m[state] = { Tài: 0, Xỉu: 0 };
        m[state][next]++;
      }
      const d = m[lastState];
      if (d && (d.Tài + d.Xỉu) >= 2) {
        const p = d.Tài > d.Xỉu ? 'Tài' : 'Xỉu';
        const total = d.Tài + d.Xỉu;
        const conf = 55 + level * 5 + (Math.max(d.Tài, d.Xỉu) / total) * 25;
        results.push({ ten: `Markov ${level}`, du_doan: p, do_tin_cay: Math.min(95, conf), mo_ta: `M${level} [${lastState}]` });
      }
    }
  }

  // 15. Cycle
  if (h.length >= 8) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const lags = [2, 3, 4, 5, 6, 7];
    let bestLag = 0, bestCorr = 0;
    for (const lag of lags) {
      if (num.length > lag) {
        const a1 = num.slice(0, num.length - lag);
        const a2 = num.slice(lag);
        const m1 = mean(a1), m2 = mean(a2);
        const s1 = stddev(a1), s2 = stddev(a2);
        if (s1 === 0 || s2 === 0) continue;
        let cov = 0;
        for (let i = 0; i < a1.length; i++) cov += (a1[i] - m1) * (a2[i] - m2);
        cov /= a1.length;
        const corr = cov / (s1 * s2);
        if (Math.abs(corr) > Math.abs(bestCorr)) { bestCorr = corr; bestLag = lag; }
      }
    }
    if (Math.abs(bestCorr) > 0.3) {
      const idx = (h.length - 1) % bestLag;
      const val = num[num.length - 1 - idx];
      const p = val === 1 ? 'Tài' : 'Xỉu';
      const conf = 60 + Math.abs(bestCorr) * 50;
      results.push({ ten: 'Cycle', du_doan: p, do_tin_cay: Math.min(92, conf), mo_ta: `Chu kỳ ${bestLag} (r=${bestCorr.toFixed(2)})` });
    }
  }

  // 16. Skew Kurt
  if (h.length >= 8) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const skew = skewness(num);
    const kurt = kurtosis(num);
    const m = mean(num);
    const score = Math.abs(skew) * 0.5 + Math.abs(kurt) * 0.3;
    if (score > 0.8) {
      const p = m > 0.5 ? 'Xỉu' : 'Tài';
      const conf = 60 + score * 20;
      results.push({ ten: 'Skew Kurt', du_doan: p, do_tin_cay: Math.min(88, conf), mo_ta: `Skew=${skew.toFixed(2)}, Kurt=${kurt.toFixed(2)}` });
    }
  }

  // 17. Entropy Std
  if (h.length >= 8) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const ent = entropy(h);
    const std = stddev(num);
    const m = mean(num);
    const stability = (1 - ent) * 0.5 + std * 0.3;
    if (stability > 0.5) {
      const p = m > 0.5 ? 'Xỉu' : 'Tài';
      const conf = 60 + stability * 30;
      results.push({ ten: 'Entropy Std', du_doan: p, do_tin_cay: Math.min(88, conf), mo_ta: `Ent=${ent.toFixed(2)}, Std=${std.toFixed(2)}` });
    }
  }

  // 18. RSI
  if (h.length >= 10) {
    const rsi = rsiCalculator(h, 10);
    if (rsi > 65) {
      results.push({ ten: 'RSI', du_doan: 'Xỉu', do_tin_cay: 75, mo_ta: `RSI=${rsi.toFixed(1)} (Quá mua)` });
    } else if (rsi < 35) {
      results.push({ ten: 'RSI', du_doan: 'Tài', do_tin_cay: 75, mo_ta: `RSI=${rsi.toFixed(1)} (Quá bán)` });
    }
  }

  // 19. MACD
  if (h.length >= 20) {
    const { macd, signal } = macdCalculator(h);
    if (macd > signal && macd > 0.05) {
      results.push({ ten: 'MACD', du_doan: 'Xỉu', do_tin_cay: 78, mo_ta: `MACD cắt lên (${macd.toFixed(3)})` });
    } else if (macd < signal && macd < -0.05) {
      results.push({ ten: 'MACD', du_doan: 'Tài', do_tin_cay: 78, mo_ta: `MACD cắt xuống (${macd.toFixed(3)})` });
    }
  }

  // 20. Bollinger
  if (h.length >= 15) {
    const bb = bollingerBands(h, 15, 2);
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const current = num[0];
    if (current > bb.upper) {
      results.push({ ten: 'Bollinger', du_doan: 'Xỉu', do_tin_cay: 76, mo_ta: `Chạm upper (${bb.upper.toFixed(2)})` });
    } else if (current < bb.lower) {
      results.push({ ten: 'Bollinger', du_doan: 'Tài', do_tin_cay: 76, mo_ta: `Chạm lower (${bb.lower.toFixed(2)})` });
    }
  }

  // 21. Stochastic
  if (h.length >= 10) {
    const stoch = stochastic(h, 10);
    if (stoch > 75) {
      results.push({ ten: 'Stochastic', du_doan: 'Xỉu', do_tin_cay: 74, mo_ta: `Stoch=${stoch.toFixed(1)}` });
    } else if (stoch < 25) {
      results.push({ ten: 'Stochastic', du_doan: 'Tài', do_tin_cay: 74, mo_ta: `Stoch=${stoch.toFixed(1)}` });
    }
  }

  // 22. Williams R
  if (h.length >= 10) {
    const willR = williamsR(h, 10);
    if (willR < -75) {
      results.push({ ten: 'Williams R', du_doan: 'Tài', do_tin_cay: 74, mo_ta: `WilliamsR=${willR.toFixed(1)}` });
    } else if (willR > -25) {
      results.push({ ten: 'Williams R', du_doan: 'Xỉu', do_tin_cay: 74, mo_ta: `WilliamsR=${willR.toFixed(1)}` });
    }
  }

  // 23. CCI
  if (h.length >= 15) {
    const cci = cciCalculator(h, 15);
    if (cci > 80) {
      results.push({ ten: 'CCI', du_doan: 'Xỉu', do_tin_cay: 72, mo_ta: `CCI=${cci.toFixed(1)}` });
    } else if (cci < -80) {
      results.push({ ten: 'CCI', du_doan: 'Tài', do_tin_cay: 72, mo_ta: `CCI=${cci.toFixed(1)}` });
    }
  }

  // 24. ADX
  if (h.length >= 12) {
    const adx = adxCalculator(h, 12);
    if (adx > 20) {
      const num = h.map(r => r === 'Tài' ? 1 : 0);
      const trend = mean(num.slice(0, 4)) > 0.5 ? 'Tài' : 'Xỉu';
      results.push({ ten: 'ADX', du_doan: trend, do_tin_cay: 72, mo_ta: `ADX=${adx.toFixed(1)}` });
    }
  }

  // 25. Aroon
  if (h.length >= 10) {
    const aroon = aroonIndicator(h, 10);
    if (aroon.up > 70 && aroon.up > aroon.down) {
      results.push({ ten: 'Aroon', du_doan: 'Xỉu', do_tin_cay: 72, mo_ta: `Aroon Up=${aroon.up.toFixed(1)}` });
    } else if (aroon.down > 70 && aroon.down > aroon.up) {
      results.push({ ten: 'Aroon', du_doan: 'Tài', do_tin_cay: 72, mo_ta: `Aroon Down=${aroon.down.toFixed(1)}` });
    }
  }

  // 26. CMF
  if (h.length >= 15) {
    const cmf = chaikinMoneyFlow(h, 15);
    if (cmf > 0.05) {
      results.push({ ten: 'CMF', du_doan: 'Xỉu', do_tin_cay: 70, mo_ta: `CMF=${cmf.toFixed(3)}` });
    } else if (cmf < -0.05) {
      results.push({ ten: 'CMF', du_doan: 'Tài', do_tin_cay: 70, mo_ta: `CMF=${cmf.toFixed(3)}` });
    }
  }

  // 27. OBV
  if (h.length >= 8) {
    const obv = obvCalculator(h);
    if (obv > 3) {
      results.push({ ten: 'OBV', du_doan: 'Xỉu', do_tin_cay: 68, mo_ta: `OBV=${obv.toFixed(1)}` });
    } else if (obv < -3) {
      results.push({ ten: 'OBV', du_doan: 'Tài', do_tin_cay: 68, mo_ta: `OBV=${obv.toFixed(1)}` });
    }
  }

  // 28. Trend Reversal
  if (h.length >= 4) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const recent = mean(num.slice(0, 2));
    const older = mean(num.slice(2, 4));
    const diff = recent - older;
    if (diff > 0.25) {
      results.push({ ten: 'Trend Reversal', du_doan: 'Xỉu', do_tin_cay: 72, mo_ta: 'Đảo chiều giảm' });
    } else if (diff < -0.25) {
      results.push({ ten: 'Trend Reversal', du_doan: 'Tài', do_tin_cay: 72, mo_ta: 'Đảo chiều tăng' });
    }
  }

  // 29. Mean Reversion
  if (h.length >= 6) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const meanVal = mean(num);
    const current = num[0];
    if (current > meanVal + 0.15) {
      results.push({ ten: 'Mean Reversion', du_doan: 'Xỉu', do_tin_cay: 68, mo_ta: 'Quá cao, hồi về' });
    } else if (current < meanVal - 0.15) {
      results.push({ ten: 'Mean Reversion', du_doan: 'Tài', do_tin_cay: 68, mo_ta: 'Quá thấp, hồi về' });
    }
  }

  // 30. Neural
  if (h.length >= 7) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const weights = memory.neural.weights;
    const input = [
      num[0] || 0.5, num[1] || 0.5, num[2] || 0.5,
      num[3] || 0.5, num[4] || 0.5, num[5] || 0.5,
      num[6] || 0.5
    ];
    let sum = memory.neural.bias;
    for (let i = 0; i < 7; i++) {
      sum += input[i] * weights[i];
    }
    const output = 1 / (1 + Math.exp(-sum));
    const p = output > 0.5 ? 'Tài' : 'Xỉu';
    const conf = 55 + Math.abs(output - 0.5) * 80;
    results.push({ ten: 'Neural', du_doan: p, do_tin_cay: Math.min(90, conf), mo_ta: `NN=${output.toFixed(3)}` });
  }

  return results;
}

// ================================================================
// TỔNG HỢP KẾT QUẢ - TRẢ VỀ TỈ LỆ CHO TỪNG PHIÊN
// ================================================================
function tongHopKetQua(results) {
  if (!results || results.length === 0) {
    return { pred: 'Tài', conf: 50, total: 0, voteTai: 0, voteXiu: 0 };
  }

  const vote = { Tài: 0, Xỉu: 0 };
  const weightVote = { Tài: 0, Xỉu: 0 };
  const confVote = { Tài: 0, Xỉu: 0 };

  for (const r of results) {
    vote[r.du_doan]++;
    weightVote[r.du_doan] += r.do_tin_cay / 100;
    confVote[r.du_doan] += r.do_tin_cay;
  }

  let finalPred = 'Tài';
  if (weightVote.Tài > weightVote.Xỉu) finalPred = 'Tài';
  else if (weightVote.Xỉu > weightVote.Tài) finalPred = 'Xỉu';
  else if (vote.Tài > vote.Xỉu) finalPred = 'Tài';
  else if (vote.Xỉu > vote.Tài) finalPred = 'Xỉu';
  else finalPred = results[0].du_doan;

  const totalWeight = weightVote.Tài + weightVote.Xỉu;
  const maxWeight = Math.max(weightVote.Tài, weightVote.Xỉu);
  const baseConf = totalWeight > 0 ? (maxWeight / totalWeight) * 100 : 50;
  const consensusBonus = (Math.abs(vote.Tài - vote.Xỉu) / results.length) * 20;
  const finalConf = Math.min(99, Math.round(baseConf + consensusBonus));

  return {
    pred: finalPred,
    conf: finalConf,
    total: results.length,
    voteTai: vote.Tài,
    voteXiu: vote.Xỉu,
    chiTiet: results.slice(0, 10) // Top 10 chi tiết
  };
}

// ================================================================
// FETCH DATA
// ================================================================
async function fetchData(url) {
  try {
    const res = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.data || !res.data.list || res.data.list.length === 0) return null;
    const item = res.data.list[res.data.list.length - 1];
    let kq = item.resultTruyenThong || item.result;
    if (kq === 'TAI' || kq === 'BIG') kq = 'Tài';
    if (kq === 'XIU' || kq === 'SMALL') kq = 'Xỉu';
    return { phien: item.id, ket_qua: chuanHoa(kq) };
  } catch (e) {
    return null;
  }
}

// ================================================================
// XỬ LÝ CHÍNH - LƯU DATA, KHÔNG HIỂN THỊ ĐÚNG SAI
// ================================================================
async function processGame(gameKey) {
  const config = GAME_CONFIG[gameKey];
  if (!config) throw new Error('Game không tồn tại');

  const g = store[gameKey];
  const data = await fetchData(config.link);
  if (!data) throw new Error('Không lấy được dữ liệu');

  const phien = data.phien;
  const kq = data.ket_qua;

  // Lưu lịch sử
  if (!g.history.find(h => h.phien === phien)) {
    g.history.unshift({ phien, ket_qua: kq, time: Date.now() });
    if (g.history.length > 500) g.history.pop();
  }

  // Cập nhật thống kê tổng thể (KHÔNG HIỂN THỊ TRONG DỰ ĐOÁN)
  // Chỉ dùng để tính tỉ lệ tổng thể riêng
  if (g.predictHistory.length > 0 && g.predictHistory[0].status === 'CHỜ') {
    const last = g.predictHistory[0];
    if (last.pred) {
      const dung = kq === last.pred;
      if (dung) {
        g.stats.dung++;
        g.stats.winStreak++;
        if (g.stats.winStreak > g.stats.maxWinStreak) g.stats.maxWinStreak = g.stats.winStreak;
        g.stats.loseStreak = 0;
      } else {
        g.stats.sai++;
        g.stats.loseStreak++;
        if (g.stats.loseStreak > g.stats.maxLoseStreak) g.stats.maxLoseStreak = g.stats.loseStreak;
        g.stats.winStreak = 0;
      }
      g.stats.tong++;
      g.stats.tiLe = ((g.stats.dung / g.stats.tong) * 100).toFixed(1) + '%';
      last.status = dung ? 'ĐÚNG' : 'SAI';
      last.thuc_te = kq;
    }
  }

  const taiXiu = g.history.map(h => h.ket_qua).filter(k => k === 'Tài' || k === 'Xỉu');

  // Chạy 30 thuật toán
  const algoResults = runAlgorithms(taiXiu, g.memory);
  const finalResult = tongHopKetQua(algoResults);

  // Cập nhật thống kê nâng cao
  if (taiXiu.length >= 8) {
    const num = taiXiu.map(r => r === 'Tài' ? 1 : 0);
    g.statsAdv.skewness = skewness(num);
    g.statsAdv.kurtosis = kurtosis(num);
    g.statsAdv.entropy = entropy(taiXiu);
    g.statsAdv.variance = variance(num);
    g.statsAdv.stdDev = stddev(num);
    g.statsAdv.rsi = rsiCalculator(taiXiu);
    const { macd, signal } = macdCalculator(taiXiu);
    g.statsAdv.macd = macd;
    g.statsAdv.signal = signal;
    const bb = bollingerBands(taiXiu);
    g.statsAdv.bollingerUpper = bb.upper;
    g.statsAdv.bollingerMiddle = bb.middle;
    g.statsAdv.bollingerLower = bb.lower;
    g.statsAdv.stochastic = stochastic(taiXiu);
    g.statsAdv.williamsR = williamsR(taiXiu);
    g.statsAdv.cci = cciCalculator(taiXiu);
    g.statsAdv.adx = adxCalculator(taiXiu);
    const aroon = aroonIndicator(taiXiu);
    g.statsAdv.aroonUp = aroon.up;
    g.statsAdv.aroonDown = aroon.down;
    g.statsAdv.cmf = chaikinMoneyFlow(taiXiu);
    g.statsAdv.obv = obvCalculator(taiXiu);
  }

  // Lưu dự đoán mới - KHÔNG HIỂN THỊ ĐÚNG SAI TRONG NÀY
  g.predictHistory.unshift({
    phien: phien,
    pred: finalResult.pred,
    conf: finalResult.conf,
    chiTiet: finalResult.chiTiet,
    voteTai: finalResult.voteTai,
    voteXiu: finalResult.voteXiu,
    soThuatToan: finalResult.total,
    status: 'CHỜ',
    time: Date.now()
  });
  if (g.predictHistory.length > 100) g.predictHistory.pop();

  writeData(store);

  // ================================================================
  // TRẢ VỀ - KHÔNG CÓ ĐÚNG SAI, MỖI PHIÊN CÓ TỈ LỆ RIÊNG
  // ================================================================
  return {
    phiên: phien,
    kết_quả: kq,
    phiên_dự_đoán: phien + 1,
    dự_đoán: finalResult.pred,
    tỉ_lệ_phiên_này: finalResult.conf + '%',
    số_thuật_toán: finalResult.total,
    vote: `Tài:${finalResult.voteTai} | Xỉu:${finalResult.voteXiu}`,
    chi_tiet_thuật_toán: finalResult.chiTiet,
    thống_kê_tổng_thể: {
      tỉ_lệ_chung: g.stats.tiLe || '0%',
      đúng: g.stats.dung || 0,
      sai: g.stats.sai || 0,
      tổng: g.stats.tong || 0,
      win_streak: g.stats.winStreak || 0,
      lose_streak: g.stats.loseStreak || 0
    },
    id: '@tranhoang2286'
  };
}

// ================================================================
// API
// ================================================================

app.get('/', (req, res) => {
  res.json({
    name: '🔥 LC79 PRO - MỖI PHIÊN TỈ LỆ RIÊNG 🔥',
    version: '15.0.0',
    games: Object.keys(GAME_CONFIG),
    endpoints: {
      'DỰ ĐOÁN': '/api/predict/:game',
      'LỊCH SỬ': '/api/history/:game',
      'THỐNG KÊ': '/api/stats/:game'
    },
    note: '✅ Mỗi phiên có tỉ lệ riêng, không hiển thị đúng sai',
    id: '@tranhoang2286'
  });
});

app.get('/api/predict/:game', async (req, res) => {
  try {
    const result = await processGame(req.params.game);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, id: '@tranhoang2286' });
  }
});

app.get('/api/history/:game', (req, res) => {
  const g = store[req.params.game];
  if (!g) return res.status(404).json({ error: 'Game không tồn tại', id: '@tranhoang2286' });
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    game: req.params.game,
    tong: g.history.length,
    lich_su_game: g.history.slice(0, limit),
    lich_su_du_doan: g.predictHistory.slice(0, limit).map(p => ({
      phien: p.phien,
      du_doan: p.pred,
      do_tin_cay: p.conf + '%',
      vote: `Tài:${p.voteTai} | Xỉu:${p.voteXiu}`,
      status: p.status,
      thuc_te: p.thuc_te || 'CHỜ'
    })),
    id: '@tranhoang2286'
  });
});

app.get('/api/stats/:game', (req, res) => {
  const g = store[req.params.game];
  if (!g) return res.status(404).json({ error: 'Game không tồn tại', id: '@tranhoang2286' });
  res.json({
    game: req.params.game,
    stats: g.stats,
    advanced: g.statsAdv,
    id: '@tranhoang2286'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n============================================================`);
  console.log(`🔥 LC79 PRO - MỖI PHIÊN TỈ LỆ RIÊNG`);
  console.log(`============================================================`);
  console.log(`✅ 30 THUẬT TOÁN NÂNG CẤP`);
  console.log(`✅ MỖI PHIÊN CÓ TỈ LỆ KHÁC NHAU`);
  console.log(`✅ KHÔNG HIỂN THỊ ĐÚNG SAI TRONG DỰ ĐOÁN`);
  console.log(`📌 /api/predict/:game - Dự đoán phiên mới`);
  console.log(`============================================================`);
  console.log(`🚀 PORT: ${PORT}`);
  console.log(`🏷️ ID: @tranhoang2286`);
  console.log(`============================================================\n`);
});
