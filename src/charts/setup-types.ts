import type { ChartTimeframe } from "./chart-types-common.js";
import type { CompressionWindow } from "./indicators.js";

export type SetupKind = "DDB" | "FB" | "BB" | "RB" | "ARB" | "IRB" | "SB";

export type ChartMarker = {
  index: number;   // vị trí trong mảng candles
  price: number;
  label: string;   // ví dụ "Edge test #1", "Doji"
};

export type ChartLinePoint = {
  index: number;   // vị trí trong mảng candles
  price: number;
};

export type ChartLine = {
  points: ChartLinePoint[];   // >= 2 điểm, nối tuần tự bằng đoạn thẳng
  label?: string;             // ví dụ "Pullback", "W-pattern"
  style?: "pullback" | "pattern";  // gợi ý màu/nét vẽ cho renderer
};

export type ChartHighlight = {
  index: number;   // vị trí nến cần tô đậm
  label?: string;  // ví dụ "Doji", "Bottom 2"
};

export type ChartPatternLabel = {
  index: number;   // vị trí gần điểm breakout/tín hiệu
  price: number;   // giá đặt label (thường gần đỉnh/đáy pattern)
  text: string;    // tên setup hiển thị, ví dụ "BB", "DDB", "ARB"
};

export type SetupChartGeometry = {
  /** Box chính (range/block) — BB, RB, ARB dùng 1 box; IRB dùng boxes[0]=inner, boxes[1]=outer. */
  boxes: CompressionWindow[];
  /** Điểm mốc phụ, ví dụ các nến edge-test bị false break (ARB). */
  markers: ChartMarker[];
  /** Đường nối nhiều điểm — sóng pullback (DDB/FB), mô hình W/M (SB). Optional, không set thì không vẽ. */
  lines?: ChartLine[];
  /** Nến cần tô đậm — cụm doji (DDB), đáy/đỉnh W-M (SB). Optional. */
  highlightCandles?: ChartHighlight[];
  /** Vị trí + text label tên setup (kèm đường chỉ nhỏ khi vẽ). Optional — nếu không set, renderer dùng title mặc định như hiện tại. */
  patternLabel?: ChartPatternLabel;
};

export type DetectedSignal = {
  setup: SetupKind;
  pair: string;
  timeframe: ChartTimeframe;
  direction: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number; // 0-100
  triggerIndex: number; // index trong mảng candles nơi tín hiệu kích hoạt
  ruleTrace: string[];
  /** Optional — chỉ set bởi BB/RB/ARB/IRB, dùng để vẽ chart. Không set thì downstream vẫn hoạt động như cũ. */
  geometry?: SetupChartGeometry;
};

export type DetectionContext = {
  ma21: (number | null)[];
  atr14: (number | null)[];
  pair: string;
  timeframe: ChartTimeframe;
};
