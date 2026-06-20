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
// ĐƯỜNG DẪN FILE LƯU DATA
// ================================================================
const DATA_FILE = path.join(__dirname, 'data.json');

// ================================================================
// HÀM ĐỌC/GHI DATA
// ================================================================
function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.log('Lỗi đọc file data, tạo mới');
  }
  return null;
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.log('Lỗi ghi file data');
  }
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
// KHỞI TẠO STORE - ĐỌC TỪ FILE HOẶC TẠO MỚI
// ================================================================
let store = {};

function initStore() {
  const saved = readData();
  if (saved) {
    store = saved;
    console.log('✅ Đã load dữ liệu từ file');
    return;
  }

  // Tạo mới nếu chưa có
  for (let key in GAME_CONFIG) {
    store[key] = {
      history: [],
      predictHistory: [],
      stats: { 
        tong: 0, dung: 0, sai: 0, tiLe: '0%', 
        winStreak: 0, maxWinStreak: 0, loseStreak: 0, maxLoseStreak: 0,
        tongTien: 0, loiNhuan: 0, tyLeThang: 0
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
        markov: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} },
        cycle: { detected: false, length: 0, confidence: 0 },
        pattern: { templates: [], matches: 0 },
        neural: { weights: [0.5, 0.5, 0.5, 0.5, 0.5], bias: 0 }
      }
    };
  }
  writeData(store);
  console.log('✅ Đã tạo mới dữ liệu');
}

initStore();

// ================================================================
// HÀM TOÁN
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

function chuanHoa(kq) {
  if (!kq) return null;
  const s = String(kq).toLowerCase().trim();
  if (s === 'tài' || s === 'tai' || s === 'big' || s === 'b') return 'Tài';
  if (s === 'xỉu' || s === 'xiu' || s === 'small' || s === 's') return 'Xỉu';
  return kq;
}

// ================================================================
// 20 THUẬT TOÁN
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
    if (s >= 3) {
      const p = h[0] === 'Tài' ? 'Xỉu' : 'Tài';
      let conf = 60 + s * 10;
      if (s >= 5) conf = Math.min(99, 80 + (s - 4) * 8);
      results.push({ ten: 'Streak', du_doan: p, do_tin_cay: conf, mo_ta: `Bệt ${s} phiên` });
    }
  }

  // 2. Zigzag
  if (h.length >= 4) {
    let zigzag = true, length = 0;
    for (let i = 1; i < Math.min(h.length, 10); i++) {
      if (h[i] === h[i - 1]) { zigzag = false; break; }
      length++;
    }
    if (zigzag && length >= 3) {
      const p = h[0] === 'Tài' ? 'Xỉu' : 'Tài';
      let conf = 75 + length * 3;
      results.push({ ten: 'Zigzag', du_doan: p, do_tin_cay: Math.min(94, conf), mo_ta: `Cầu 1-1 dài ${length+1} phiên` });
    }
  }

  // 3. Momentum
  if (h.length >= 6) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const recent = num.slice(0, 3);
    const older = num.slice(3, 6);
    const mRecent = mean(recent);
    const mOlder = mean(older);
    const diff = mRecent - mOlder;
    if (Math.abs(diff) > 0.2) {
      const p = diff > 0 ? 'Xỉu' : 'Tài';
      results.push({ ten: 'Momentum', du_doan: p, do_tin_cay: 70 + Math.abs(diff) * 40, mo_ta: `Động lượng ${diff > 0 ? 'Tài' : 'Xỉu'}` });
    }
  }

  // 4. Volatility
  if (h.length >= 8) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const vol = stddev(num);
    if (vol > 0.45) {
      const last = h[0];
      const p = last === 'Tài' ? 'Xỉu' : 'Tài';
      results.push({ ten: 'Volatility', du_doan: p, do_tin_cay: 65 + vol * 30, mo_ta: `Biến động ${vol.toFixed(2)}` });
    }
  }

  // 5. Freq 5
  if (h.length >= 5) {
    const last5 = h.slice(0, 5);
    const t = last5.filter(r => r === 'Tài').length;
    if (t >= 4) results.push({ ten: 'Freq 5', du_doan: 'Xỉu', do_tin_cay: 82, mo_ta: '5 phiên có 4 Tài' });
    else if (t <= 1) results.push({ ten: 'Freq 5', du_doan: 'Tài', do_tin_cay: 82, mo_ta: '5 phiên có 4 Xỉu' });
  }

  // 6. Freq 10
  if (h.length >= 10) {
    const last10 = h.slice(0, 10);
    const t = last10.filter(r => r === 'Tài').length;
    if (t >= 7) results.push({ ten: 'Freq 10', du_doan: 'Xỉu', do_tin_cay: 87, mo_ta: '10 phiên có 7 Tài' });
    else if (t <= 3) results.push({ ten: 'Freq 10', du_doan: 'Tài', do_tin_cay: 87, mo_ta: '10 phiên có 7 Xỉu' });
  }

  // 7. Freq 15
  if (h.length >= 15) {
    const last15 = h.slice(0, 15);
    const t = last15.filter(r => r === 'Tài').length;
    if (t >= 10) results.push({ ten: 'Freq 15', du_doan: 'Xỉu', do_tin_cay: 90, mo_ta: '15 phiên có 10 Tài' });
    else if (t <= 5) results.push({ ten: 'Freq 15', du_doan: 'Tài', do_tin_cay: 90, mo_ta: '15 phiên có 10 Xỉu' });
  }

  // 8. Markov 1
  if (h.length >= 3) {
    const m = memory.markov[1];
    const last = h[0];
    for (let i = 0; i < h.length - 1; i++) {
      const state = h[i + 1];
      const next = h[i];
      if (!m[state]) m[state] = { Tài: 0, Xỉu: 0 };
      m[state][next]++;
    }
    const d = m[last];
    if (d && (d.Tài + d.Xỉu) >= 3) {
      const p = d.Tài > d.Xỉu ? 'Tài' : 'Xỉu';
      const total = d.Tài + d.Xỉu;
      const conf = 60 + (Math.max(d.Tài, d.Xỉu) / total) * 30;
      results.push({ ten: 'Markov 1', du_doan: p, do_tin_cay: Math.min(90, conf), mo_ta: `Markov1 [${last}]` });
    }
  }

  // 9. Markov 2
  if (h.length >= 4) {
    const m = memory.markov[2];
    const last2 = h.slice(0, 2).join('');
    for (let i = 0; i < h.length - 2; i++) {
      const state = h.slice(i + 1, i + 3).join('');
      const next = h[i];
      if (!m[state]) m[state] = { Tài: 0, Xỉu: 0 };
      m[state][next]++;
    }
    const d = m[last2];
    if (d && (d.Tài + d.Xỉu) >= 3) {
      const p = d.Tài > d.Xỉu ? 'Tài' : 'Xỉu';
      const total = d.Tài + d.Xỉu;
      const conf = 65 + (Math.max(d.Tài, d.Xỉu) / total) * 30;
      results.push({ ten: 'Markov 2', du_doan: p, do_tin_cay: Math.min(92, conf), mo_ta: `Markov2 [${last2}]` });
    }
  }

  // 10. Markov 3
  if (h.length >= 5) {
    const m = memory.markov[3];
    const last3 = h.slice(0, 3).join('');
    for (let i = 0; i < h.length - 3; i++) {
      const state = h.slice(i + 1, i + 4).join('');
      const next = h[i];
      if (!m[state]) m[state] = { Tài: 0, Xỉu: 0 };
      m[state][next]++;
    }
    const d = m[last3];
    if (d && (d.Tài + d.Xỉu) >= 2) {
      const p = d.Tài > d.Xỉu ? 'Tài' : 'Xỉu';
      const total = d.Tài + d.Xỉu;
      const conf = 70 + (Math.max(d.Tài, d.Xỉu) / total) * 30;
      results.push({ ten: 'Markov 3', du_doan: p, do_tin_cay: Math.min(94, conf), mo_ta: `Markov3 [${last3}]` });
    }
  }

  // 11. Cycle
  if (h.length >= 8) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const lags = [2, 3, 4, 5, 6];
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
    if (Math.abs(bestCorr) > 0.35) {
      const idx = (h.length - 1) % bestLag;
      const val = num[num.length - 1 - idx];
      const p = val === 1 ? 'Tài' : 'Xỉu';
      const conf = 65 + Math.abs(bestCorr) * 40;
      results.push({ ten: 'Cycle', du_doan: p, do_tin_cay: Math.min(90, conf), mo_ta: `Chu kỳ ${bestLag} (r=${bestCorr.toFixed(2)})` });
    }
  }

  // 12. Skew Kurt
  if (h.length >= 8) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const skew = skewness(num);
    const kurt = kurtosis(num);
    const m = mean(num);
    const score = Math.abs(skew) * 0.6 + Math.abs(kurt) * 0.4;
    if (score > 1) {
      const p = m > 0.5 ? 'Xỉu' : 'Tài';
      const conf = 65 + score * 15;
      results.push({ ten: 'Skew Kurt', du_doan: p, do_tin_cay: Math.min(88, conf), mo_ta: `Skew=${skew.toFixed(2)}, Kurt=${kurt.toFixed(2)}` });
    }
  }

  // 13. Entropy Std
  if (h.length >= 8) {
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const ent = entropy(h);
    const std = stddev(num);
    const m = mean(num);
    const stability = (1 - ent) * 0.6 + std * 0.4;
    if (stability > 0.6) {
      const p = m > 0.5 ? 'Xỉu' : 'Tài';
      const conf = 65 + stability * 25;
      results.push({ ten: 'Entropy Std', du_doan: p, do_tin_cay: Math.min(90, conf), mo_ta: `Entropy=${ent.toFixed(2)}, Std=${std.toFixed(2)}` });
    }
  }

  // 14. RSI
  if (h.length >= 15) {
    const rsi = rsiCalculator(h, 14);
    if (rsi > 70) {
      results.push({ ten: 'RSI', du_doan: 'Xỉu', do_tin_cay: 85, mo_ta: `RSI=${rsi.toFixed(1)} (Quá mua)` });
    } else if (rsi < 30) {
      results.push({ ten: 'RSI', du_doan: 'Tài', do_tin_cay: 85, mo_ta: `RSI=${rsi.toFixed(1)} (Quá bán)` });
    }
  }

  // 15. MACD
  if (h.length >= 26) {
    const { macd, signal } = macdCalculator(h);
    if (macd > signal && macd > 0.1) {
      results.push({ ten: 'MACD', du_doan: 'Xỉu', do_tin_cay: 88, mo_ta: `MACD cắt lên (${macd.toFixed(3)})` });
    } else if (macd < signal && macd < -0.1) {
      results.push({ ten: 'MACD', du_doan: 'Tài', do_tin_cay: 88, mo_ta: `MACD cắt xuống (${macd.toFixed(3)})` });
    }
  }

  // 16. Bollinger
  if (h.length >= 20) {
    const bb = bollingerBands(h, 20, 2);
    const num = h.map(r => r === 'Tài' ? 1 : 0);
    const current = num[0];
    if (current > bb.upper) {
      results.push({ ten: 'Bollinger', du_doan: 'Xỉu', do_tin_cay: 82, mo_ta: `Chạm upper (${bb.upper.toFixed(2)})` });
    } else if (current < bb.lower) {
      results.push({ ten: 'Bollinger', du_doan: 'Tài', do_tin_cay: 82, mo_ta: `Chạm lower (${bb.lower.toFixed(2)})` });
    }
  }

  // 17. Stochastic
  if (h.length >= 14) {
    const stoch = stochastic(h, 14);
    if (stoch > 80) {
      results.push({ ten: 'Stochastic', du_doan: 'Xỉu', do_tin_cay: 80, mo_ta: `Stoch=${stoch.toFixed(1)} (Quá mua)` });
    } else if (stoch < 20) {
      results.push({ ten: 'Stochastic', du_doan: 'Tài', do_tin_cay: 80, mo_ta: `Stoch=${stoch.toFixed(1)} (Quá bán)` });
    }
  }

  // 18. Williams R
  if (h.length >= 14) {
    const willR = williamsR(h, 14);
    if (willR < -80) {
      results.push({ ten: 'Williams R', du_doan: 'Tài', do_tin_cay: 80, mo_ta: `WilliamsR=${willR.toFixed(1)} (Quá bán)` });
    } else if (willR > -20) {
      results.push({ ten: 'Williams R', du_doan: 'Xỉu', do_tin_cay: 80, mo_ta: `WilliamsR=${willR.toFixed(1)} (Quá mua)` });
    }
  }

  // 19. CCI
  if (h.length >= 20) {
    const cci = cciCalculator(h, 20);
    if (cci > 100) {
      results.push({ ten: 'CCI', du_doan: 'Xỉu', do_tin_cay: 78, mo_ta: `CCI=${cci.toFixed(1)} (Quá mua)` });
    } else if (cci < -100) {
      results.push({ ten: 'CCI', du_doan: 'Tài', do_tin_cay: 78, mo_ta: `CCI=${cci.toFixed(1)} (Quá bán)` });
    }
  }

  // 20. ADX
  if (h.length >= 15) {
    const adx = adxCalculator(h, 14);
    if (adx > 25) {
      const num = h.map(r => r === 'Tài' ? 1 : 0);
      const recent = num.slice(0, 5);
      const trend = mean(recent) > 0.5 ? 'Tài' : 'Xỉu';
      results.push({ ten: 'ADX', du_doan: trend, do_tin_cay: 80, mo_ta: `ADX=${adx.toFixed(1)} (Xu hướng mạnh)` });
    }
  }

  return results;
}

// ================================================================
// TỔNG HỢP KẾT QUẢ
// ================================================================
function tongHopKetQua(results) {
  if (!results || results.length === 0) {
    return { pred: 'Tài', conf: 50, total: 0 };
  }

  const vote = { Tài: 0, Xỉu: 0 };
  const weightVote = { Tài: 0, Xỉu: 0 };
  for (const r of results) {
    vote[r.du_doan]++;
    weightVote[r.du_doan] += r.do_tin_cay / 100;
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

  return { pred: finalPred, conf: finalConf, total: results.length };
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
// XỬ LÝ CHÍNH - LƯU VÀO FILE SAU MỖI LẦN CẬP NHẬT
// ================================================================
async function processGame(gameKey) {
  const config = GAME_CONFIG[gameKey];
  if (!config) throw new Error('Game không tồn tại');

  const g = store[gameKey];
  const data = await fetchData(config.link);
  if (!data) throw new Error('Không lấy được dữ liệu');

  const phien = data.phien;
  const kq = data.ket_qua;

  // Kiểm tra phiên trùng
  const exists = g.history.find(h => h.phien === phien);
  if (!exists) {
    g.history.unshift({ phien, ket_qua: kq, time: Date.now() });
    if (g.history.length > 500) g.history.pop();
  }

  // Kiểm tra dự đoán cũ
  if (g.predictHistory.length > 0 && g.predictHistory[0].status === 'CHỜ') {
    const last = g.predictHistory[0];
    if (last.pred) {
      const dung = kq === last.pred;
      if (dung) {
        g.stats.dung++;
        g.stats.winStreak++;
        if (g.stats.winStreak > g.stats.maxWinStreak) g.stats.maxWinStreak = g.stats.winStreak;
        g.stats.loseStreak = 0;
        g.stats.tongTien += 100;
      } else {
        g.stats.sai++;
        g.stats.loseStreak++;
        if (g.stats.loseStreak > g.stats.maxLoseStreak) g.stats.maxLoseStreak = g.stats.loseStreak;
        g.stats.winStreak = 0;
        g.stats.tongTien -= 100;
      }
      g.stats.tong++;
      g.stats.tiLe = ((g.stats.dung / g.stats.tong) * 100).toFixed(1) + '%';
      g.stats.loiNhuan = g.stats.tongTien;
      g.stats.tyLeThang = g.stats.tong > 0 ? ((g.stats.dung / g.stats.tong) * 100) : 0;
      last.status = dung ? 'ĐÚNG' : 'SAI';
      last.thuc_te = kq;
    }
  }

  // Lấy lịch sử Tài/Xỉu
  const taiXiu = g.history.map(h => h.ket_qua).filter(k => k === 'Tài' || k === 'Xỉu');

  // Chạy thuật toán
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
  }

  // Lưu dự đoán mới
  g.predictHistory.unshift({
    phien: phien,
    pred: finalResult.pred,
    conf: finalResult.conf,
    status: 'CHỜ',
    time: Date.now()
  });
  if (g.predictHistory.length > 100) g.predictHistory.pop();

  // LƯU VÀO FILE
  writeData(store);

  // Trả về kết quả gọn
  return {
    phiên: phien,
    kết_quả: kq,
    phiên_dự_đoán: phien + 1,
    dự_đoán: finalResult.pred,
    tỉ_lệ: g.stats.tiLe || '0.0%',
    đúng: g.stats.dung || 0,
    sai: g.stats.sai || 0,
    win_streak: g.stats.winStreak || 0,
    lose_streak: g.stats.loseStreak || 0,
    lợi_nhuận: g.stats.loiNhuan || 0,
    số_thuật_toán: finalResult.total || 0,
    id: '@tranhoang2286'
  };
}

// ================================================================
// API
// ================================================================

app.get('/', (req, res) => {
  res.json({
    name: '🔥 LC79 - LƯU DATA TỰ ĐỘNG 🔥',
    version: '12.0.0',
    games: Object.keys(GAME_CONFIG),
    endpoints: {
      'DỰ ĐOÁN': '/api/predict/:game',
      'LỊCH SỬ': '/api/history/:game',
      'THỐNG KÊ': '/api/stats/:game'
    },
    note: '✅ Dữ liệu được lưu vào file data.json, F5 không mất',
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
    lich_su_du_doan: g.predictHistory.slice(0, limit),
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
  console.log(`🔥 LC79 - LƯU DATA TỰ ĐỘNG`);
  console.log(`============================================================`);
  console.log(`✅ Dữ liệu được lưu vào file data.json`);
  console.log(`✅ F5 không làm mất tỉ lệ và lịch sử`);
  console.log(`📌 API: /api/predict/:game`);
  console.log(`============================================================`);
  console.log(`🚀 PORT: ${PORT}`);
  console.log(`🏷️ ID: @tranhoang2286`);
  console.log(`============================================================\n`);
});
