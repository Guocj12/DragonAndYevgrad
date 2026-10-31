// src/debug.js — 调试跳层入口数据（自动生成，勿手改）
//
// 由 `node tools/gen-debug-jumps.mjs` 跑 v8.js 全流程模拟（= docs/数值设计.md §12 八层
// 检查点旅程）生成：每一项是**玩家第一次抵达该层**那一刻的完整状态（轮数、runTicks、
// 永久等级 F/U、钱包 WF/WS、累计统计）。tier 0..8 对应 stage 1..9，终局入口的 runTicks
// 与引擎一致取 0。对拍锚：入口轮次 = §12.2 首次成功轮，终局入口 = §12.1 检查点。
export const DEBUG_ENTRIES = [
  {
    "stage": 1,
    "run": 1,
    "runTicks": 0,
    "permanent": {
      "failure": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "success": [
        0,
        0,
        0,
        0
      ],
      "failureWallet": 0,
      "successWallet": 0
    },
    "stats": {
      "playTime": 0,
      "ticks": 0,
      "runs": 0,
      "guards": 0,
      "collapses": 0,
      "endgames": 0,
      "failures": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "guardsByStage": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "firstGuard": [
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false
      ],
      "firstCollapse": [
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false
      ],
      "releases": 0,
      "bufferSaved": 0,
      "cleared": {
        "mantissa": 0,
        "exponent": 0
      },
      "bestPowerLog": 0
    }
  },
  {
    "stage": 2,
    "run": 7,
    "runTicks": 5204,
    "permanent": {
      "failure": [
        7,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "success": [
        2,
        2,
        2,
        1
      ],
      "failureWallet": 0,
      "successWallet": 0
    },
    "stats": {
      "playTime": 5137.85,
      "ticks": 102757,
      "runs": 6,
      "guards": 1,
      "collapses": 6,
      "endgames": 0,
      "failures": [
        6,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "guardsByStage": [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "firstGuard": [
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false
      ],
      "firstCollapse": [
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false
      ],
      "releases": 0,
      "bufferSaved": 0,
      "cleared": {
        "mantissa": 0,
        "exponent": 0
      },
      "bestPowerLog": 24.396648435533486
    }
  },
  {
    "stage": 3,
    "run": 12,
    "runTicks": 10708,
    "permanent": {
      "failure": [
        7,
        6,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "success": [
        7,
        7,
        7,
        6
      ],
      "failureWallet": 86,
      "successWallet": 1
    },
    "stats": {
      "playTime": 8453.5,
      "ticks": 169070,
      "runs": 11,
      "guards": 7,
      "collapses": 11,
      "endgames": 0,
      "failures": [
        6,
        5,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "guardsByStage": [
        6,
        1,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "firstGuard": [
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        false
      ],
      "firstCollapse": [
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        false
      ],
      "releases": 0,
      "bufferSaved": 0,
      "cleared": {
        "mantissa": 0,
        "exponent": 0
      },
      "bestPowerLog": 249.41219385586888
    }
  },
  {
    "stage": 4,
    "run": 19,
    "runTicks": 10033,
    "permanent": {
      "failure": [
        7,
        6,
        8,
        0,
        0,
        0,
        0,
        0
      ],
      "success": [
        12,
        12,
        12,
        12
      ],
      "failureWallet": 4325,
      "successWallet": 282
    },
    "stats": {
      "playTime": 13029.75,
      "ticks": 260595,
      "runs": 18,
      "guards": 22,
      "collapses": 18,
      "endgames": 0,
      "failures": [
        6,
        5,
        7,
        0,
        0,
        0,
        0,
        0
      ],
      "guardsByStage": [
        13,
        8,
        1,
        0,
        0,
        0,
        0,
        0
      ],
      "firstGuard": [
        true,
        true,
        true,
        false,
        false,
        false,
        false,
        false
      ],
      "firstCollapse": [
        true,
        true,
        true,
        false,
        false,
        false,
        false,
        false
      ],
      "releases": 0,
      "bufferSaved": 0,
      "cleared": {
        "mantissa": 7.907082629345938,
        "exponent": 2480
      },
      "bestPowerLog": 2492.4122868579143
    }
  },
  {
    "stage": 5,
    "run": 23,
    "runTicks": 11729,
    "permanent": {
      "failure": [
        7,
        6,
        8,
        4,
        0,
        0,
        0,
        0
      ],
      "success": [
        17,
        17,
        16,
        16
      ],
      "failureWallet": 12958,
      "successWallet": 3025
    },
    "stats": {
      "playTime": 15935,
      "ticks": 318700,
      "runs": 22,
      "guards": 35,
      "collapses": 22,
      "endgames": 0,
      "failures": [
        6,
        5,
        7,
        4,
        0,
        0,
        0,
        0
      ],
      "guardsByStage": [
        17,
        12,
        5,
        1,
        0,
        0,
        0,
        0
      ],
      "firstGuard": [
        true,
        true,
        true,
        true,
        false,
        false,
        false,
        false
      ],
      "firstCollapse": [
        true,
        true,
        true,
        true,
        false,
        false,
        false,
        false
      ],
      "releases": 0,
      "bufferSaved": 0,
      "cleared": {
        "mantissa": 7.112060287417652,
        "exponent": 48249
      },
      "bestPowerLog": 24921.00930657302
    }
  },
  {
    "stage": 6,
    "run": 30,
    "runTicks": 12437,
    "permanent": {
      "failure": [
        7,
        6,
        8,
        4,
        9,
        0,
        0,
        0
      ],
      "success": [
        22,
        22,
        22,
        21
      ],
      "failureWallet": 417121,
      "successWallet": 51150
    },
    "stats": {
      "playTime": 21145.3,
      "ticks": 422906,
      "runs": 29,
      "guards": 64,
      "collapses": 29,
      "endgames": 0,
      "failures": [
        6,
        5,
        7,
        4,
        7,
        0,
        0,
        0
      ],
      "guardsByStage": [
        24,
        19,
        12,
        8,
        1,
        0,
        0,
        0
      ],
      "firstGuard": [
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false
      ],
      "firstCollapse": [
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false
      ],
      "releases": 0,
      "bufferSaved": 0,
      "cleared": {
        "mantissa": 8.349935809002755,
        "exponent": 628112
      },
      "bestPowerLog": 249246.81937623094
    }
  },
  {
    "stage": 7,
    "run": 37,
    "runTicks": 16372,
    "permanent": {
      "failure": [
        7,
        6,
        8,
        4,
        9,
        9,
        0,
        0
      ],
      "success": [
        27,
        27,
        27,
        26
      ],
      "failureWallet": 4536894,
      "successWallet": 304439
    },
    "stats": {
      "playTime": 27815.25,
      "ticks": 556305,
      "runs": 36,
      "guards": 100,
      "collapses": 36,
      "endgames": 0,
      "failures": [
        6,
        5,
        7,
        4,
        7,
        7,
        0,
        0
      ],
      "guardsByStage": [
        31,
        26,
        19,
        15,
        8,
        1,
        0,
        0
      ],
      "firstGuard": [
        true,
        true,
        true,
        true,
        true,
        true,
        false,
        false
      ],
      "firstCollapse": [
        true,
        true,
        true,
        true,
        true,
        true,
        false,
        false
      ],
      "releases": 285,
      "bufferSaved": 0,
      "cleared": {
        "mantissa": 4.926421028011125,
        "exponent": 7117373
      },
      "bestPowerLog": 2492271.1990352017
    }
  },
  {
    "stage": 8,
    "run": 42,
    "runTicks": 20356,
    "permanent": {
      "failure": [
        7,
        6,
        8,
        4,
        9,
        9,
        8,
        0
      ],
      "success": [
        32,
        31,
        31,
        31
      ],
      "failureWallet": 15657050,
      "successWallet": 7652134
    },
    "stats": {
      "playTime": 33917.45,
      "ticks": 678349,
      "runs": 41,
      "guards": 131,
      "collapses": 41,
      "endgames": 0,
      "failures": [
        6,
        5,
        7,
        4,
        7,
        7,
        5,
        0
      ],
      "guardsByStage": [
        36,
        31,
        24,
        20,
        13,
        6,
        1,
        0
      ],
      "firstGuard": [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        false
      ],
      "firstCollapse": [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        false
      ],
      "releases": 634,
      "bufferSaved": 25,
      "cleared": {
        "mantissa": 3.20530495073859,
        "exponent": 78624124
      },
      "bestPowerLog": 24922903.447448373
    }
  },
  {
    "stage": 9,
    "run": 50,
    "runTicks": 0,
    "permanent": {
      "failure": [
        7,
        6,
        8,
        4,
        9,
        9,
        8,
        9
      ],
      "success": [
        37,
        37,
        36,
        36
      ],
      "failureWallet": 446103510,
      "successWallet": 88739910
    },
    "stats": {
      "playTime": 44556.35,
      "ticks": 891127,
      "runs": 49,
      "guards": 188,
      "collapses": 49,
      "endgames": 1,
      "failures": [
        6,
        5,
        7,
        4,
        7,
        7,
        5,
        8
      ],
      "guardsByStage": [
        44,
        39,
        32,
        28,
        21,
        14,
        9,
        1
      ],
      "firstGuard": [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true
      ],
      "firstCollapse": [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true
      ],
      "releases": 1261,
      "bufferSaved": 113,
      "cleared": {
        "mantissa": 5.737835467874539,
        "exponent": 866678720
      },
      "bestPowerLog": 249258417.06651407
    }
  }
];
