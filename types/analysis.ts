export interface DetectionPoint {
  time: number;
  x: number;
  y: number;
  normX: number;
  normY: number;
  confidence: number;
}

export interface HawkEyePoint {
  time: number;
  distance: number;
  lateral: number;
  height: number;
  confidence: number;
}
