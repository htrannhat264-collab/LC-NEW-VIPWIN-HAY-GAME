const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ============================================================
// CẤU HÌNH GAME - 2 GAME, MỖI GAME 2 LINK
// ============================================================
const GAME_CONFIG = {
  'lc79_tx': {
    name: 'LC79 HŨ',
    raw_link: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    ai_link: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5',
    type: 'tx'
  },
  'lc79_txmd5': {
    name: 'LC79 MD5',
    raw_link: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    ai_link: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8',
    type: 'txmd5'
  }
};

// ============================================================
// LƯU TRỮ DỮ LIỆU CHI TIẾT
// ============================================================
const gameStore = {};

for (let key in GAME_CONFIG) {
  gameStore[key] = {
    // Lịch sử game (không phải dự đoán)
    history: [],
    rawHistory: [],
    aiHistory: [],
    // Lịch sử dự đoán
    predictHistory: [],
    // Dữ liệu cầu đã học (>=10 phiên)
    learnedPatterns: [],
    // Thống kê
    stats: { tong: 0, dung: 0, sai: 0, tiLe: '0%' },
    // Bộ nhớ cho 10 thuật toán con
    algoMemory: {
      algo1: { data: [] },
      algo2: { data: [] },
      algo3: { data: [] },
      algo4: { data: [] },
      algo5: { data: [] },
      algo6: { data: [] },
      algo7: { data: [] },
      algo8: { data: [] },
      algo9: { data: [] },
      algo10: { data: [] }
    },
    // Trạng thái học cầu
    isLearned: false,
    learnCount: 0,
    lastPrediction: null
  };
}

// ============================================================
// HÀM TIỆN ÍCH THỐNG KÊ NÂNG CAO
// ============================================================

// Trung bình
function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Phương sai
function variance(arr, m) {
  if (!arr || arr.length === 0) return 0;
  if (m === undefined) m = mean(arr);
  return arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length;
}

// Độ lệch chuẩn
function stddev(arr) {
  if (!arr || arr.length === 0) return 0;
  return Math.sqrt(variance(arr));
}

// Tương quan
function correlation(arr1, arr2) {
  if (!arr1 || !arr2 || arr1.length !== arr2.length || arr1.length < 2) return 0;
  const n = arr1.length;
  const m1 = mean(arr1);
  const m2 = mean(arr2);
  const s1 = stddev(arr1);
  const s2 = stddev(arr2);
  if (s1 === 0 || s2 === 0) return 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (arr1[i] - m1) * (arr2[i] - m2);
  }
  cov /= n;
  return cov / (s1 * s2);
}

// Entropy
function entropy(arr) {
  if (!arr || arr.length === 0) return 0;
  const counts = {};
  arr.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
  const total = arr.length;
  let e = 0;
  Object.values(counts).forEach(c => {
    const p = c / total;
    e -= p * Math.log2(p);
  });
  return e;
}

// Skewness
function skewness(arr) {
  if (!arr || arr.length < 3) return 0;
  const m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 0;
  const n = arr.length;
  const sum3 = arr.reduce((a, b) => a + Math.pow((b - m) / s, 3), 0);
  return (n / ((n - 1) * (n - 2))) * sum3;
}

// Kurtosis
function kurtosis(arr) {
  if (!arr || arr.length < 4) return 0;
  const m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 0;
  const n = arr.length;
  const sum4 = arr.reduce((a, b) => a + Math.pow((b - m) / s, 4), 0);
  return (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * sum4 - (3 * Math.pow(n - 1, 2) / ((n - 2) * (n - 3)));
}

// ============================================================
// CHUẨN HÓA KẾT QUẢ
// ============================================================
function chuanHoa(ketQua) {
  if (!ketQua) return null;
  const kq = String(ketQua).toLowerCase().trim();
  if (kq === 'tài' || kq === 'tai' || kq === 'big' || kq === 'b') return 'Tài';
  if (kq === 'xỉu' || kq === 'xiu' || kq === 'small' || kq === 's') return 'Xỉu';
  return ketQua;
}

// ============================================================
// FETCH DATA TỪ API
// ============================================================
async function fetchGameData(url) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    };
    const res = await axios.get(url, { timeout: 10000, headers });
    let data = res.data;
    if (!data) return null;
    if (data.list && Array.isArray(data.list) && data.list.length > 0) {
      const lastItem = data.list[data.list.length - 1];
      let ketQua = lastItem.resultTruyenThong || lastItem.result;
      if (ketQua === 'TAI' || ketQua === 'BIG') ketQua = 'Tài';
      if (ketQua === 'XIU' || ketQua === 'SMALL') ketQua = 'Xỉu';
      return {
        phien: lastItem.id,
        ket_qua: chuanHoa(ketQua),
        dice: lastItem.dices || [],
        tong: lastItem.point || lastItem.total || null,
        detail: lastItem
      };
    }
    return null;
  } catch (error) {
    console.error(`❌ Fetch lỗi:`, error.message);
    return null;
  }
}

// ============================================================
// 10 THUẬT TOÁN CON - KHÔNG RANDOM
// ============================================================

// ALGO 1: PHÁT HIỆN BỆT (STREAK DETECTION)
function algo1_Streak(history) {
  if (history.length < 2) return null;
  let streak = 1;
  for (let i = 1; i < history.length; i++) {
    if (history[i] === history[0]) streak++;
    else break;
  }
  if (streak >= 3) {
    const pred = history[0] === 'Tài' ? 'Xỉu' : 'Tài';
    const conf = Math.min(90, 60 + streak * 8);
    return { pred, conf, desc: `Bệt ${streak} phiên` };
  }
  return null;
}

// ALGO 2: CẦU 1-1 (ZIGZAG)
function algo2_Zigzag(history) {
  if (history.length < 4) return null;
  let isZigzag = true;
  for (let i = 1; i < Math.min(history.length, 6); i++) {
    if (history[i] === history[i - 1]) { isZigzag = false; break; }
  }
  if (isZigzag) {
    const pred = history[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return { pred, conf: 80, desc: 'Cầu 1-1' };
  }
  return null;
}

// ALGO 3: TẦN SUẤT 5 PHIÊN
function algo3_Frequency5(history) {
  if (history.length < 5) return null;
  const last5 = history.slice(0, 5);
  const tai = last5.filter(r => r === 'Tài').length;
  if (tai >= 4) return { pred: 'Xỉu', conf: 82, desc: '5 phiên có 4 Tài' };
  if (tai <= 1) return { pred: 'Tài', conf: 82, desc: '5 phiên có 4 Xỉu' };
  return null;
}

// ALGO 4: TẦN SUẤT 10 PHIÊN
function algo4_Frequency10(history) {
  if (history.length < 10) return null;
  const last10 = history.slice(0, 10);
  const tai = last10.filter(r => r === 'Tài').length;
  if (tai >= 7) return { pred: 'Xỉu', conf: 85, desc: '10 phiên có 7 Tài' };
  if (tai <= 3) return { pred: 'Tài', conf: 85, desc: '10 phiên có 7 Xỉu' };
  return null;
}

// ALGO 5: MARKOV CẤP 1
function algo5_Markov1(history, memory) {
  if (history.length < 3) return null;
  const last = history[0];
  const mc = memory.markov1 || {};
  if (!mc[last]) mc[last] = { Tài: 0, Xỉu: 0 };
  // Cập nhật
  for (let i = 0; i < history.length - 1; i++) {
    const state = history[i + 1];
    const next = history[i];
    if (!mc[state]) mc[state] = { Tài: 0, Xỉu: 0 };
    mc[state][next]++;
  }
  memory.markov1 = mc;
  const data = mc[last];
  if (data && (data.Tài + data.Xỉu) >= 3) {
    const pred = data.Tài > data.Xỉu ? 'Tài' : 'Xỉu';
    const total = data.Tài + data.Xỉu;
    const conf = Math.min(88, 60 + (Math.max(data.Tài, data.Xỉu) / total) * 30);
    return { pred, conf, desc: `Markov1 [${last}]` };
  }
  return null;
}

// ALGO 6: MARKOV CẤP 2
function algo6_Markov2(history, memory) {
  if (history.length < 4) return null;
  const last2 = history.slice(0, 2).join('');
  const mc = memory.markov2 || {};
  if (!mc[last2]) mc[last2] = { Tài: 0, Xỉu: 0 };
  for (let i = 0; i < history.length - 2; i++) {
    const state = history.slice(i + 1, i + 3).join('');
    const next = history[i];
    if (!mc[state]) mc[state] = { Tài: 0, Xỉu: 0 };
    mc[state][next]++;
  }
  memory.markov2 = mc;
  const data = mc[last2];
  if (data && (data.Tài + data.Xỉu) >= 3) {
    const pred = data.Tài > data.Xỉu ? 'Tài' : 'Xỉu';
    const total = data.Tài + data.Xỉu;
    const conf = Math.min(90, 65 + (Math.max(data.Tài, data.Xỉu) / total) * 30);
    return { pred, conf, desc: `Markov2 [${last2}]` };
  }
  return null;
}

// ALGO 7: MARKOV CẤP 3
function algo7_Markov3(history, memory) {
  if (history.length < 5) return null;
  const last3 = history.slice(0, 3).join('');
  const mc = memory.markov3 || {};
  if (!mc[last3]) mc[last3] = { Tài: 0, Xỉu: 0 };
  for (let i = 0; i < history.length - 3; i++) {
    const state = history.slice(i + 1, i + 4).join('');
    const next = history[i];
    if (!mc[state]) mc[state] = { Tài: 0, Xỉu: 0 };
    mc[state][next]++;
  }
  memory.markov3 = mc;
  const data = mc[last3];
  if (data && (data.Tài + data.Xỉu) >= 2) {
    const pred = data.Tài > data.Xỉu ? 'Tài' : 'Xỉu';
    const total = data.Tài + data.Xỉu;
    const conf = Math.min(92, 70 + (Math.max(data.Tài, data.Xỉu) / total) * 30);
    return { pred, conf, desc: `Markov3 [${last3}]` };
  }
  return null;
}

// ALGO 8: CHU KỲ TỰ TƯƠNG QUAN
function algo8_Cycle(history) {
  if (history.length < 8) return null;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const lags = [2, 3, 4, 5, 6];
  let bestLag = 0;
  let bestCorr = 0;
  for (const lag of lags) {
    if (num.length > lag) {
      const arr1 = num.slice(0, num.length - lag);
      const arr2 = num.slice(lag);
      const corr = correlation(arr1, arr2);
      if (Math.abs(corr) > Math.abs(bestCorr)) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
  }
  if (Math.abs(bestCorr) > 0.4) {
    const nextIdx = (history.length - 1) % bestLag;
    const nextVal = num[num.length - 1 - nextIdx];
    const pred = nextVal === 1 ? 'Tài' : 'Xỉu';
    const conf = Math.min(85, 65 + Math.abs(bestCorr) * 30);
    return { pred, conf, desc: `Chu kỳ ${bestLag} (tương quan ${bestCorr.toFixed(2)})` };
  }
  return null;
}

// ALGO 9: SKEWNESS + KURTOSIS
function algo9_SkewKurt(history) {
  if (history.length < 6) return null;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const skew = skewness(num);
  const kurt = kurtosis(num);
  const meanVal = mean(num);
  if (Math.abs(skew) > 0.5 && Math.abs(kurt) > 0.5) {
    const pred = meanVal > 0.5 ? 'Xỉu' : 'Tài';
    const conf = Math.min(82, 65 + Math.abs(skew) * 15 + Math.abs(kurt) * 10);
    return { pred, conf, desc: `Skew=${skew.toFixed(2)}, Kurt=${kurt.toFixed(2)}` };
  }
  return null;
}

// ALGO 10: ENTROPY + ĐỘ LỆCH CHUẨN
function algo10_EntropyStd(history) {
  if (history.length < 6) return null;
  const num = history.map(r => r === 'Tài' ? 1 : 0);
  const ent = entropy(history);
  const std = stddev(num);
  const meanVal = mean(num);
  if (ent < 0.9 && std > 0.4) {
    const pred = meanVal > 0.5 ? 'Xỉu' : 'Tài';
    const conf = Math.min(84, 65 + (1 - ent) * 30 + std * 20);
    return { pred, conf, desc: `Entropy=${ent.toFixed(2)}, Std=${std.toFixed(2)}` };
  }
  return null;
}

// ============================================================
// TỔNG HỢP 10 THUẬT TOÁN VÀO MỘT ENGINE
// ============================================================
function tongHop10Algo(history, memory) {
  const results = [];
  const algos = [
    algo1_Streak,
    algo2_Zigzag,
    algo3_Frequency5,
    algo4_Frequency10,
    (h, m) => algo5_Markov1(h, m),
    (h, m) => algo6_Markov2(h, m),
    (h, m) => algo7_Markov3(h, m),
    algo8_Cycle,
    algo9_SkewKurt,
    algo10_EntropyStd
  ];

  for (let i = 0; i < algos.length; i++) {
    try {
      const result = algos[i](history, memory);
      if (result) {
        results.push({
          algo: `Algo${i + 1}`,
          pred: result.pred,
          conf: result.conf,
          desc: result.desc
        });
      }
    } catch (e) {
      // Bỏ qua lỗi
    }
  }

  if (results.length === 0) return null;

  // Đếm số phiếu và độ tin cậy tổng hợp
  const vote = { Tài: 0, Xỉu: 0 };
  const confSum = { Tài: 0, Xỉu: 0 };
  for (const r of results) {
    vote[r.pred]++;
    confSum[r.pred] += r.conf;
  }

  const finalPred = vote.Tài > vote.Xỉu ? 'Tài' : (vote.Xỉu > vote.Tài ? 'Xỉu' : (results[0].pred));
  const totalConf = (confSum[finalPred] || 0) / (vote[finalPred] || 1);
  const finalConf = Math.min(95, Math.round(totalConf + (Math.abs(vote.Tài - vote.Xỉu) / results.length) * 10));

  return {
    pred: finalPred,
    conf: finalConf,
    details: results,
    voteTài: vote.Tài,
    voteXỉu: vote.Xỉu,
    totalAlgos: results.length
  };
}

// ============================================================
// XỬ LÝ GAME CHÍNH
// ============================================================
async function processGame(gameKey, useAI = false) {
  const config = GAME_CONFIG[gameKey];
  if (!config) throw new Error(`Game ${gameKey} không tồn tại`);

  const store = gameStore[gameKey];
  const link = useAI ? config.ai_link : config.raw_link;

  // Fetch data
  const data = await fetchGameData(link);
  if (!data) throw new Error(`Không lấy được dữ liệu từ ${gameKey}`);

  const phien = data.phien;
  const ketQuaThucTe = data.ket_qua;

  // Lưu lịch sử game (không phải dự đoán)
  const exists = store.history.find(h => h.phien === phien);
  if (!exists) {
    store.history.unshift({ phien, ket_qua: ketQuaThucTe, tong: data.tong, dice: data.dice, time: Date.now() });
    if (store.history.length > 500) store.history.pop();
    if (useAI) {
      store.aiHistory.unshift({ phien, ket_qua: ketQuaThucTe });
      if (store.aiHistory.length > 200) store.aiHistory.pop();
    } else {
      store.rawHistory.unshift({ phien, ket_qua: ketQuaThucTe });
      if (store.rawHistory.length > 200) store.rawHistory.pop();
    }
  }

  // Lấy lịch sử Tài/Xỉu
  const taiXiuHistory = store.history.map(h => h.ket_qua).filter(k => k === 'Tài' || k === 'Xỉu');
  const isLearned = store.isLearned;
  const learnCount = store.learnCount;

  // Nếu dùng AI và chưa học đủ 10 cầu
  if (useAI && !isLearned) {
    // Học thêm 1 cầu
    if (taiXiuHistory.length >= 10) {
      store.isLearned = true;
      store.learnCount = taiXiuHistory.length;
      // Học các pattern
      for (let i = 5; i < taiXiuHistory.length; i++) {
        const pattern = taiXiuHistory.slice(i - 5, i).join('-');
        const next = taiXiuHistory[i - 5];
        store.learnedPatterns.push({ pattern, next });
      }
    } else {
      return {
        game: gameKey,
        status: 'HỌC CẦU',
        message: `Đang học cầu (${taiXiuHistory.length}/10)`,
        phien_hien_tai: phien,
        ket_qua_thuc_te: ketQuaThucTe,
        da_hoc: taiXiuHistory.length,
        can_hoc: 10,
        lich_su_game: store.history.slice(0, 20)
      };
    }
  }

  // Dự đoán
  let predictionResult = null;
  if (useAI && isLearned) {
    // Dùng 10 thuật toán đã học
    const memory = store.algoMemory;
    predictionResult = tongHop10Algo(taiXiuHistory, memory);
    if (!predictionResult) {
      // Fallback nếu không có thuật toán nào cho kết quả
      const last = taiXiuHistory[0] || 'Tài';
      const pred = last === 'Tài' ? 'Xỉu' : 'Tài';
      predictionResult = {
        pred,
        conf: 60,
        details: [],
        voteTài: 0,
        voteXỉu: 0,
        totalAlgos: 0
      };
    }
  } else if (!useAI) {
    // Link RAW - dự đoán luôn, không học
    const last = taiXiuHistory[0] || 'Tài';
    const pred = last === 'Tài' ? 'Xỉu' : 'Tài';
    predictionResult = {
      pred,
      conf: 65,
      details: [{ algo: 'RAW', pred, conf: 65, desc: 'Dự đoán trực tiếp, không học cầu' }],
      voteTài: 1,
      voteXỉu: 0,
      totalAlgos: 1
    };
  }

  // Kiểm tra dự đoán cũ
  if (store.predictHistory.length > 0 && store.predictHistory[0].status === 'CHỜ') {
    const lastPred = store.predictHistory[0];
    if (lastPred.pred && lastPred.pred !== 'KHÔNG DỰ ĐOÁN') {
      const dung = (ketQuaThucTe === lastPred.pred);
      if (dung) store.stats.dung++;
      else store.stats.sai++;
      store.stats.tong++;
      store.stats.tiLe = ((store.stats.dung / store.stats.tong) * 100).toFixed(1) + '%';
      lastPred.status = dung ? 'ĐÚNG' : 'SAI';
      lastPred.thuc_te = ketQuaThucTe;
    }
  }

  // Lưu dự đoán mới
  const predictionEntry = {
    phien: phien,
    pred: predictionResult.pred,
    conf: predictionResult.conf,
    details: predictionResult.details || [],
    status: 'CHỜ',
    thoi_gian: Date.now(),
    link_type: useAI ? 'AI' : 'RAW',
    algo_count: predictionResult.totalAlgos || 0,
    vote: { Tài: predictionResult.voteTài || 0, Xỉu: predictionResult.voteXỉu || 0 }
  };
  store.predictHistory.unshift(predictionEntry);
  if (store.predictHistory.length > 100) store.predictHistory.pop();

  store.lastPrediction = predictionEntry;

  return {
    game: gameKey,
    link_type: useAI ? 'AI (Học cầu)' : 'RAW (Không học)',
    is_learned: useAI ? store.isLearned : false,
    learn_count: store.learnCount,
    phien_hien_tai: phien,
    ket_qua_thuc_te: ketQuaThucTe,
    tong_diem: data.tong,
    dice: data.dice,
    du_doan: {
      du_doan: predictionResult.pred,
      do_tin_cay: predictionResult.conf + '%',
      so_thuat_toan_dong_thuan: predictionResult.voteTài + predictionResult.voteXỉu,
      chi_tiet_thuat_toan: predictionResult.details || []
    },
    thong_ke: store.stats,
    lich_su_game: store.history.slice(0, 10),
    lich_su_du_doan: store.predictHistory.slice(0, 5),
    last_10: taiXiuHistory.slice(0, 10)
  };
}

// ============================================================
// API ENDPOINTS
// ============================================================

// Gốc
app.get('/', (req, res) => {
  res.json({
    name: '🔥 LC79 SUPER AI - 10 THUẬT TOÁN KHÔNG RANDOM 🔥',
    version: '5.0.0',
    games: Object.keys(GAME_CONFIG).map(k => ({
      key: k,
      name: GAME_CONFIG[k].name,
      raw_link: GAME_CONFIG[k].raw_link,
      ai_link: GAME_CONFIG[k].ai_link,
      is_learned: gameStore[k].isLearned,
      learn_count: gameStore[k].learnCount
    })),
    endpoints: {
      'LINK RAW (Dự đoán luôn)': '/api/raw/:game',
      'LINK AI (Học 10 cầu)': '/api/ai/:game',
      'Lịch sử game': '/api/history/:game',
      'Thống kê': '/api/stats/:game',
      'Reset học': '/api/reset/:game'
    }
  });
});

// RAW - Dự đoán luôn, không học
app.get('/api/raw/:game', async (req, res) => {
  const gameKey = req.params.game;
  if (!GAME_CONFIG[gameKey]) {
    return res.status(404).json({ error: 'Game không tồn tại', available: Object.keys(GAME_CONFIG) });
  }
  try {
    const result = await processGame(gameKey, false);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI - Học 10 cầu mới dự đoán
app.get('/api/ai/:game', async (req, res) => {
  const gameKey = req.params.game;
  if (!GAME_CONFIG[gameKey]) {
    return res.status(404).json({ error: 'Game không tồn tại', available: Object.keys(GAME_CONFIG) });
  }
  try {
    const result = await processGame(gameKey, true);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lịch sử game (không phải dự đoán)
app.get('/api/history/:game', (req, res) => {
  const gameKey = req.params.game;
  if (!GAME_CONFIG[gameKey]) {
    return res.status(404).json({ error: 'Game không tồn tại' });
  }
  const store = gameStore[gameKey];
  const limit = parseInt(req.query.limit) || 20;
  res.json({
    game: gameKey,
    total: store.history.length,
    is_learned: store.isLearned,
    learn_count: store.learnCount,
    lich_su_game: store.history.slice(0, limit),
    lich_su_raw: store.rawHistory.slice(0, limit),
    lich_su_ai: store.aiHistory.slice(0, limit),
    lich_su_du_doan: store.predictHistory.slice(0, limit)
  });
});

// Thống kê
app.get('/api/stats/:game', (req, res) => {
  const gameKey = req.params.game;
  if (!GAME_CONFIG[gameKey]) {
    return res.status(404).json({ error: 'Game không tồn tại' });
  }
  const store = gameStore[gameKey];
  res.json({
    game: gameKey,
    stats: store.stats,
    is_learned: store.isLearned,
    learn_count: store.learnCount,
    total_predictions: store.predictHistory.length,
    last_prediction: store.lastPrediction
  });
});

// Reset học cầu
app.post('/api/reset/:game', (req, res) => {
  const gameKey = req.params.game;
  if (!GAME_CONFIG[gameKey]) {
    return res.status(404).json({ error: 'Game không tồn tại' });
  }
  const store = gameStore[gameKey];
  store.isLearned = false;
  store.learnCount = 0;
  store.learnedPatterns = [];
  store.algoMemory = {
    algo1: { data: [] },
    algo2: { data: [] },
    algo3: { data: [] },
    algo4: { data: [] },
    algo5: { data: [], markov1: {} },
    algo6: { data: [], markov2: {} },
    algo7: { data: [], markov3: {} },
    algo8: { data: [] },
    algo9: { data: [] },
    algo10: { data: [] }
  };
  res.json({ success: true, message: `Reset học cầu cho ${gameKey} thành công` });
});

// Chạy server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n============================================================`);
  console.log(`🔥 LC79 SUPER AI - 10 THUẬT TOÁN KHÔNG RANDOM`);
  console.log(`============================================================`);
  console.log(`📊 2 GAME: lc79_tx (hũ) và lc79_txmd5 (md5)`);
  console.log(`📌 MỖI GAME CÓ 2 LINK:`);
  console.log(`   - RAW: Dự đoán luôn, không học cầu`);
  console.log(`   - AI: Học đủ 10 cầu mới dự đoán`);
  console.log(`🔬 10 THUẬT TOÁN CON: Không random, toàn thống kê`);
  console.log(`📖 LỊCH SỬ GAME: Lưu riêng, không phải lịch sử dự đoán`);
  console.log(`🚀 PORT: ${PORT}`);
  console.log(`============================================================\n`);
});