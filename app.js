const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ================================================================
// CẤU HÌNH GAME
// ================================================================
const GAME_CONFIG = {
  'lc79_tx': {
    name: 'LC79 HŨ VIP',
    raw_link: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    ai_link: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5'
  },
  'lc79_txmd5': {
    name: 'LC79 MD5 VIP',
    raw_link: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    ai_link: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8'
  }
};

// ================================================================
// STORE
// ================================================================
const store = {};

for (let key in GAME_CONFIG) {
  store[key] = {
    history: [],
    predictHistory: [],
    isLearned: false,
    learnCount: 0,
    stats: { tong: 0, dung: 0, sai: 0, tiLe: '0%', winStreak: 0, loseStreak: 0 },
    markov1: {}, markov2: {}, markov3: {}, markov4: {}, markov5: {},
    deepPatterns: [],
    learnedPatterns: [],
    statsAdv: { skewness: 0, kurtosis: 0, entropy: 0, variance: 0, stdDev: 0 }
  };
}

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

function chuanHoa(kq) {
  if (!kq) return null;
  const s = String(kq).toLowerCase().trim();
  if (s === 'tài' || s === 'tai' || s === 'big' || s === 'b') return 'Tài';
  if (s === 'xỉu' || s === 'xiu' || s === 'small' || s === 's') return 'Xỉu';
  return kq;
}

// ================================================================
// 15 THUẬT TOÁN - CHỈ TÍNH TOÁN, KHÔNG TRẢ VỀ KẾT QUẢ CUỐI
// ================================================================
function runAllAlgorithms(h, m) {
  const algos = [
    { name: 'Streak Super', fn: function(h) {
      if (h.length < 2) return null;
      let s = 1;
      for (let i = 1; i < h.length; i++) {
        if (h[i] === h[0]) s++;
        else break;
      }
      if (s >= 3) {
        const p = h[0] === 'Tài' ? 'Xỉu' : 'Tài';
        let conf = 60 + s * 8;
        if (s >= 6) conf = Math.min(98, 85 + (s - 5) * 3);
        return { pred: p, conf, desc: `🔥 Bệt ${s} phiên` };
      }
      return null;
    }},
    { name: 'Zigzag Pro', fn: function(h) {
      if (h.length < 4) return null;
      let zigzag = true, length = 0;
      for (let i = 1; i < Math.min(h.length, 10); i++) {
        if (h[i] === h[i - 1]) { zigzag = false; break; }
        length++;
      }
      if (zigzag && length >= 3) {
        const p = h[0] === 'Tài' ? 'Xỉu' : 'Tài';
        let conf = 75 + length * 3;
        return { pred: p, conf: Math.min(94, conf), desc: `🎯 Cầu 1-1 dài ${length+1} phiên` };
      }
      return null;
    }},
    { name: 'Momentum', fn: function(h) {
      if (h.length < 6) return null;
      const num = h.map(r => r === 'Tài' ? 1 : 0);
      const recent = num.slice(0, 3);
      const older = num.slice(3, 6);
      const mRecent = mean(recent);
      const mOlder = mean(older);
      const diff = mRecent - mOlder;
      if (Math.abs(diff) > 0.2) {
        const p = diff > 0 ? 'Xỉu' : 'Tài';
        return { pred: p, conf: 70 + Math.abs(diff) * 40, desc: `📈 Động lượng ${diff > 0 ? 'Tài' : 'Xỉu'}` };
      }
      return null;
    }},
    { name: 'Volatility', fn: function(h) {
      if (h.length < 8) return null;
      const num = h.map(r => r === 'Tài' ? 1 : 0);
      const vol = stddev(num);
      if (vol > 0.45) {
        const last = h[0];
        const p = last === 'Tài' ? 'Xỉu' : 'Tài';
        return { pred: p, conf: 65 + vol * 30, desc: `🌊 Biến động ${vol.toFixed(2)}` };
      }
      return null;
    }},
    { name: 'Freq 5', fn: function(h) {
      if (h.length < 5) return null;
      const last5 = h.slice(0, 5);
      const t = last5.filter(r => r === 'Tài').length;
      if (t >= 4) return { pred: 'Xỉu', conf: 82, desc: '5 phiên có 4 Tài' };
      if (t <= 1) return { pred: 'Tài', conf: 82, desc: '5 phiên có 4 Xỉu' };
      return null;
    }},
    { name: 'Freq 10', fn: function(h) {
      if (h.length < 10) return null;
      const last10 = h.slice(0, 10);
      const t = last10.filter(r => r === 'Tài').length;
      if (t >= 7) return { pred: 'Xỉu', conf: 87, desc: '10 phiên có 7 Tài' };
      if (t <= 3) return { pred: 'Tài', conf: 87, desc: '10 phiên có 7 Xỉu' };
      return null;
    }},
    { name: 'Freq 15', fn: function(h) {
      if (h.length < 15) return null;
      const last15 = h.slice(0, 15);
      const t = last15.filter(r => r === 'Tài').length;
      if (t >= 10) return { pred: 'Xỉu', conf: 90, desc: '15 phiên có 10 Tài' };
      if (t <= 5) return { pred: 'Tài', conf: 90, desc: '15 phiên có 10 Xỉu' };
      return null;
    }},
    { name: 'Markov 1', fn: function(h, m) {
      if (h.length < 3) return null;
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
        return { pred: p, conf: Math.min(90, conf), desc: `🔗 Markov1 [${last}]` };
      }
      return null;
    }},
    { name: 'Markov 2', fn: function(h, m) {
      if (h.length < 4) return null;
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
        return { pred: p, conf: Math.min(92, conf), desc: `🔗 Markov2 [${last2}]` };
      }
      return null;
    }},
    { name: 'Markov 3', fn: function(h, m) {
      if (h.length < 5) return null;
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
        return { pred: p, conf: Math.min(94, conf), desc: `🔗 Markov3 [${last3}]` };
      }
      return null;
    }},
    { name: 'Markov 4', fn: function(h, m) {
      if (h.length < 6) return null;
      const last4 = h.slice(0, 4).join('');
      for (let i = 0; i < h.length - 4; i++) {
        const state = h.slice(i + 1, i + 5).join('');
        const next = h[i];
        if (!m[state]) m[state] = { Tài: 0, Xỉu: 0 };
        m[state][next]++;
      }
      const d = m[last4];
      if (d && (d.Tài + d.Xỉu) >= 2) {
        const p = d.Tài > d.Xỉu ? 'Tài' : 'Xỉu';
        const total = d.Tài + d.Xỉu;
        const conf = 75 + (Math.max(d.Tài, d.Xỉu) / total) * 30;
        return { pred: p, conf: Math.min(95, conf), desc: `🔗 Markov4 [${last4}]` };
      }
      return null;
    }},
    { name: 'Markov 5', fn: function(h, m) {
      if (h.length < 7) return null;
      const last5 = h.slice(0, 5).join('');
      for (let i = 0; i < h.length - 5; i++) {
        const state = h.slice(i + 1, i + 6).join('');
        const next = h[i];
        if (!m[state]) m[state] = { Tài: 0, Xỉu: 0 };
        m[state][next]++;
      }
      const d = m[last5];
      if (d && (d.Tài + d.Xỉu) >= 2) {
        const p = d.Tài > d.Xỉu ? 'Tài' : 'Xỉu';
        const total = d.Tài + d.Xỉu;
        const conf = 80 + (Math.max(d.Tài, d.Xỉu) / total) * 30;
        return { pred: p, conf: Math.min(96, conf), desc: `🔗 Markov5 [${last5}]` };
      }
      return null;
    }},
    { name: 'Cycle', fn: function(h) {
      if (h.length < 8) return null;
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
      if (Math.abs(bestCorr) > 0.35) {
        const idx = (h.length - 1) % bestLag;
        const val = num[num.length - 1 - idx];
        const p = val === 1 ? 'Tài' : 'Xỉu';
        const conf = 65 + Math.abs(bestCorr) * 40;
        return { pred: p, conf: Math.min(90, conf), desc: `🔄 Chu kỳ ${bestLag} (r=${bestCorr.toFixed(2)})` };
      }
      return null;
    }},
    { name: 'Skew Kurt', fn: function(h) {
      if (h.length < 8) return null;
      const num = h.map(r => r === 'Tài' ? 1 : 0);
      const skew = skewness(num);
      const kurt = kurtosis(num);
      const m = mean(num);
      const score = Math.abs(skew) * 0.6 + Math.abs(kurt) * 0.4;
      if (score > 1) {
        const p = m > 0.5 ? 'Xỉu' : 'Tài';
        const conf = 65 + score * 15;
        return { pred: p, conf: Math.min(88, conf), desc: `📊 Skew=${skew.toFixed(2)}, Kurt=${kurt.toFixed(2)}` };
      }
      return null;
    }},
    { name: 'Entropy Std', fn: function(h) {
      if (h.length < 8) return null;
      const num = h.map(r => r === 'Tài' ? 1 : 0);
      const ent = entropy(h);
      const std = stddev(num);
      const m = mean(num);
      const stability = (1 - ent) * 0.6 + std * 0.4;
      if (stability > 0.6) {
        const p = m > 0.5 ? 'Xỉu' : 'Tài';
        const conf = 65 + stability * 25;
        return { pred: p, conf: Math.min(90, conf), desc: `🧠 Entropy=${ent.toFixed(2)}, Std=${std.toFixed(2)}` };
      }
      return null;
    }}
  ];

  const results = [];
  for (const algo of algos) {
    try {
      let r;
      if (algo.name.includes('Markov')) {
        const markovKey = 'markov' + algo.name.replace('Markov ', '');
        const memory = m[markovKey] || (m[markovKey] = {});
        r = algo.fn(h, memory);
      } else {
        r = algo.fn(h);
      }
      if (r) {
        results.push({
          ten: algo.name,
          du_doan: r.pred,
          do_tin_cay: r.conf,
          mo_ta: r.desc
        });
      }
    } catch (e) {}
  }

  return results;
}

// ================================================================
// TỔNG HỢP KẾT QUẢ TỪ 15 THUẬT TOÁN
// ================================================================
function tongHopKetQua(results) {
  if (!results || results.length === 0) {
    return { pred: 'Tài', conf: 50, total: 0, voteTai: 0, voteXiu: 0 };
  }

  const vote = { Tài: 0, Xỉu: 0 };
  const confSum = { Tài: 0, Xỉu: 0 };
  for (const r of results) {
    vote[r.du_doan]++;
    confSum[r.du_doan] += r.do_tin_cay;
  }

  let finalPred = vote.Tài > vote.Xỉu ? 'Tài' : (vote.Xỉu > vote.Tài ? 'Xỉu' : results[0].du_doan);
  const avgConf = (confSum[finalPred] || 0) / (vote[finalPred] || 1);
  const consensusBonus = (Math.abs(vote.Tài - vote.Xỉu) / results.length) * 15;
  const finalConf = Math.min(99, Math.round(avgConf + consensusBonus));

  return {
    pred: finalPred,
    conf: finalConf,
    total: results.length,
    voteTai: vote.Tài,
    voteXiu: vote.Xỉu
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
    return {
      phien: item.id,
      ket_qua: chuanHoa(kq),
      tong: item.point || item.total || 0,
      dice: item.dices || []
    };
  } catch (e) {
    return null;
  }
}

// ================================================================
// XỬ LÝ CHÍNH - TÁCH BIỆT DỰ ĐOÁN VÀ CHI TIẾT
// ================================================================
async function processGame(gameKey, useAI, returnDetail = false) {
  const config = GAME_CONFIG[gameKey];
  if (!config) throw new Error('Game không tồn tại');

  const g = store[gameKey];
  const link = useAI ? config.ai_link : config.raw_link;

  const data = await fetchData(link);
  if (!data) throw new Error('Không lấy được dữ liệu');

  const phien = data.phien;
  const kq = data.ket_qua;

  if (!g.history.find(h => h.phien === phien)) {
    g.history.unshift({ phien, ket_qua: kq, tong: data.tong, dice: data.dice, time: Date.now() });
    if (g.history.length > 500) g.history.pop();
  }

  if (g.predictHistory.length > 0 && g.predictHistory[0].status === 'CHỜ') {
    const last = g.predictHistory[0];
    if (last.pred) {
      const dung = kq === last.pred;
      if (dung) {
        g.stats.dung++;
        g.stats.winStreak++;
        g.stats.loseStreak = 0;
      } else {
        g.stats.sai++;
        g.stats.loseStreak++;
        g.stats.winStreak = 0;
      }
      g.stats.tong++;
      g.stats.tiLe = ((g.stats.dung / g.stats.tong) * 100).toFixed(1) + '%';
      last.status = dung ? 'ĐÚNG' : 'SAI';
      last.thuc_te = kq;
    }
  }

  const taiXiu = g.history.map(h => h.ket_qua).filter(k => k === 'Tài' || k === 'Xỉu');

  if (useAI && !g.isLearned) {
    if (taiXiu.length >= 10) {
      g.isLearned = true;
      g.learnCount = taiXiu.length;
      for (let i = 5; i < taiXiu.length; i++) {
        const pattern = taiXiu.slice(i - 5, i).join('-');
        g.learnedPatterns.push({ pattern, next: taiXiu[i - 5] });
      }
    } else {
      return {
        status: 'HỌC CẦU',
        message: `Đang học (${taiXiu.length}/10)`,
        phien: phien,
        ket_qua: kq,
        id: '@tranhoang2286'
      };
    }
  }

  // CHẠY 15 THUẬT TOÁN
  let algoResults = [];
  if (useAI && g.isLearned) {
    algoResults = runAllAlgorithms(taiXiu, g);
  } else if (!useAI) {
    const last = taiXiu[0] || 'Tài';
    const p = last === 'Tài' ? 'Xỉu' : 'Tài';
    algoResults = [{ ten: 'RAW', du_doan: p, do_tin_cay: 65, mo_ta: 'Dự đoán trực tiếp' }];
  }

  if (algoResults.length === 0) {
    algoResults = [{ ten: 'Fallback', du_doan: 'Tài', do_tin_cay: 50, mo_ta: 'Không có thuật toán' }];
  }

  // Tổng hợp kết quả
  const finalResult = tongHopKetQua(algoResults);

  // Cập nhật thống kê nâng cao
  if (taiXiu.length >= 8) {
    const num = taiXiu.map(r => r === 'Tài' ? 1 : 0);
    g.statsAdv.skewness = skewness(num);
    g.statsAdv.kurtosis = kurtosis(num);
    g.statsAdv.entropy = entropy(taiXiu);
    g.statsAdv.variance = variance(num);
    g.statsAdv.stdDev = stddev(num);
  }

  // Lưu dự đoán
  g.predictHistory.unshift({
    phien,
    pred: finalResult.pred,
    conf: finalResult.conf,
    status: 'CHỜ',
    link: useAI ? 'AI VIP' : 'RAW VIP',
    time: Date.now()
  });
  if (g.predictHistory.length > 100) g.predictHistory.pop();

  const baseResponse = {
    phien: phien,
    ket_qua: kq,
    du_doan: finalResult.pred,
    do_tin_cay: finalResult.conf + '%',
    so_thuat_toan: finalResult.total,
    vote: `Tài:${finalResult.voteTai} | Xỉu:${finalResult.voteXiu}`,
    ti_le: g.stats.tiLe,
    dung: g.stats.dung,
    sai: g.stats.sai,
    tong: g.stats.tong,
    win_streak: g.stats.winStreak,
    lose_streak: g.stats.loseStreak,
    link: useAI ? '🤖 VIP AI' : '⚡ VIP RAW',
    id: '@tranhoang2286'
  };

  if (returnDetail) {
    return {
      ...baseResponse,
      chi_tiet_15_thuat_toan: algoResults,
      thong_ke_nang_cao: g.statsAdv,
      lich_su_gan_day: taiXiu.slice(0, 10)
    };
  }

  return baseResponse;
}

// ================================================================
// API - TÁCH BIỆT HOÀN TOÀN
// ================================================================

app.get('/', (req, res) => {
  res.json({
    name: '🔥 LC79 VIP - TÁCH BIỆT CHI TIẾT 🔥',
    version: '6.0.0',
    games: Object.keys(GAME_CONFIG),
    endpoints: {
      'DỰ ĐOÁN + CHI TIẾT': '/api/predict/detail/:game?type=raw|ai',
      'CHỈ DỰ ĐOÁN (KHÔNG CHI TIẾT)': '/api/predict/simple/:game?type=raw|ai',
      'CHỈ CHI TIẾT THUẬT TOÁN': '/api/algorithms/:game?type=raw|ai',
      'Lịch sử': '/api/history/:game',
      'Thống kê': '/api/stats/:game'
    },
    id: '@tranhoang2286'
  });
});

// === API 1: DỰ ĐOÁN + CHI TIẾT THUẬT TOÁN (GỘP LẠI) ===
app.get('/api/predict/detail/:game', async (req, res) => {
  try {
    const type = req.query.type || 'ai';
    const useAI = type === 'ai';
    const result = await processGame(req.params.game, useAI, true);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, id: '@tranhoang2286' });
  }
});

// === API 2: CHỈ DỰ ĐOÁN (KHÔNG CHI TIẾT THUẬT TOÁN) ===
app.get('/api/predict/simple/:game', async (req, res) => {
  try {
    const type = req.query.type || 'ai';
    const useAI = type === 'ai';
    const result = await processGame(req.params.game, useAI, false);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, id: '@tranhoang2286' });
  }
});

// === API 3: CHỈ CHI TIẾT THUẬT TOÁN (KHÔNG DỰ ĐOÁN) ===
app.get('/api/algorithms/:game', async (req, res) => {
  try {
    const type = req.query.type || 'ai';
    const useAI = type === 'ai';
    const config = GAME_CONFIG[req.params.game];
    if (!config) throw new Error('Game không tồn tại');

    const g = store[req.params.game];
    const link = useAI ? config.ai_link : config.raw_link;

    const data = await fetchData(link);
    if (!data) throw new Error('Không lấy được dữ liệu');

    const phien = data.phien;
    const kq = data.ket_qua;

    if (!g.history.find(h => h.phien === phien)) {
      g.history.unshift({ phien, ket_qua: kq, tong: data.tong, dice: data.dice, time: Date.now() });
      if (g.history.length > 500) g.history.pop();
    }

    const taiXiu = g.history.map(h => h.ket_qua).filter(k => k === 'Tài' || k === 'Xỉu');

    if (useAI && !g.isLearned) {
      if (taiXiu.length >= 10) {
        g.isLearned = true;
        g.learnCount = taiXiu.length;
      } else {
        return res.json({
          status: 'HỌC CẦU',
          message: `Đang học (${taiXiu.length}/10)`,
          phien: phien,
          ket_qua: kq,
          id: '@tranhoang2286'
        });
      }
    }

    let algoResults = [];
    if (useAI && g.isLearned) {
      algoResults = runAllAlgorithms(taiXiu, g);
    } else if (!useAI) {
      const last = taiXiu[0] || 'Tài';
      const p = last === 'Tài' ? 'Xỉu' : 'Tài';
      algoResults = [{ ten: 'RAW', du_doan: p, do_tin_cay: 65, mo_ta: 'Dự đoán trực tiếp' }];
    }

    if (algoResults.length === 0) {
      algoResults = [{ ten: 'Fallback', du_doan: 'Tài', do_tin_cay: 50, mo_ta: 'Không có thuật toán' }];
    }

    const finalResult = tongHopKetQua(algoResults);

    res.json({
      phien: phien,
      ket_qua: kq,
      tong_hop: {
        du_doan: finalResult.pred,
        do_tin_cay: finalResult.conf + '%',
        so_thuat_toan: finalResult.total,
        vote: `Tài:${finalResult.voteTai} | Xỉu:${finalResult.voteXiu}`
      },
      chi_tiet_15_thuat_toan: algoResults,
      thong_ke_nang_cao: g.statsAdv,
      link: useAI ? '🤖 VIP AI' : '⚡ VIP RAW',
      id: '@tranhoang2286'
    });
  } catch (e) {
    res.status(500).json({ error: e.message, id: '@tranhoang2286' });
  }
});

// === LỊCH SỬ ===
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

// === THỐNG KÊ ===
app.get('/api/stats/:game', (req, res) => {
  const g = store[req.params.game];
  if (!g) return res.status(404).json({ error: 'Game không tồn tại', id: '@tranhoang2286' });
  res.json({
    game: req.params.game,
    stats: g.stats,
    advanced: g.statsAdv,
    is_learned: g.isLearned,
    learn_count: g.learnCount,
    id: '@tranhoang2286'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n============================================================`);
  console.log(`🔥 LC79 VIP - TÁCH BIỆT CHI TIẾT`);
  console.log(`============================================================`);
  console.log(`📌 API DỰ ĐOÁN + CHI TIẾT:`);
  console.log(`   GET /api/predict/detail/:game?type=raw|ai`);
  console.log(`📌 API CHỈ DỰ ĐOÁN (KHÔNG CHI TIẾT):`);
  console.log(`   GET /api/predict/simple/:game?type=raw|ai`);
  console.log(`📌 API CHỈ CHI TIẾT THUẬT TOÁN:`);
  console.log(`   GET /api/algorithms/:game?type=raw|ai`);
  console.log(`📌 API LỊCH SỬ:`);
  console.log(`   GET /api/history/:game`);
  console.log(`📌 API THỐNG KÊ:`);
  console.log(`   GET /api/stats/:game`);
  console.log(`============================================================`);
  console.log(`🚀 PORT: ${PORT}`);
  console.log(`🏷️ ID: @tranhoang2286`);
  console.log(`============================================================\n`);
});
