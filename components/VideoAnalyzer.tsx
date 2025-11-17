'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import styles from './VideoAnalyzer.module.css';
import HawkEyeView from './visuals/HawkEyeView';
import { DetectionPoint, HawkEyePoint } from '../types/analysis';
import { convertDetectionsToHawkEye, summarizeTrajectory } from '../lib/trajectory';

const SAMPLE_INTERVAL_SECONDS = 0.08;
const MAX_SAMPLES = 320;

async function ensureVideoReady(video: HTMLVideoElement) {
  if (video.readyState >= 2) {
    return;
  }
  await new Promise<void>((resolve) => {
    const handler = () => {
      video.removeEventListener('loadedmetadata', handler);
      resolve();
    };
    video.addEventListener('loadedmetadata', handler, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.01) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error('Failed to seek video frame.'));
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = Math.min(Math.max(time, 0), video.duration);
  });
}

const loadOpenCv = () =>
  new Promise<any>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window context is unavailable.'));
      return;
    }

    const existingCv = window.cv;
    if (existingCv && existingCv.Mat) {
      resolve(existingCv);
      return;
    }

    const scriptId = 'opencv-runtime';
    const attemptReady = () => {
      const cv = window.cv;
      if (cv && cv.Mat) {
        resolve(cv);
        return true;
      }
      return false;
    };

    if (attemptReady()) {
      return;
    }

    const handleRuntime = () => {
      if (!attemptReady()) {
        setTimeout(handleRuntime, 40);
      }
    };

    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.async = true;
      script.defer = true;
      script.src = 'https://docs.opencv.org/4.x/opencv.js';
      script.onload = handleRuntime;
      script.onerror = () => reject(new Error('Failed to load OpenCV JS runtime.'));
      document.body.appendChild(script);
    } else {
      handleRuntime();
    }
  });

function detectBall(
  cv: any,
  src: HTMLCanvasElement,
  downscaleWidth = 480
): { x: number; y: number; confidence: number } | null {
  const mat = cv.imread(src);
  if (mat.empty()) {
    mat.delete();
    return null;
  }

  const scale = mat.cols > downscaleWidth ? downscaleWidth / mat.cols : 1;
  const targetWidth = Math.round(mat.cols * scale);
  const targetSize = new cv.Size(targetWidth, Math.round(mat.rows * scale));
  const resized = new cv.Mat();
  cv.resize(mat, resized, targetSize, 0, 0, cv.INTER_AREA);

  const blurred = new cv.Mat();
  const ksize = new cv.Size(5, 5);
  cv.GaussianBlur(resized, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);

  const rgb = new cv.Mat();
  cv.cvtColor(blurred, rgb, cv.COLOR_RGBA2RGB);
  const hsv = new cv.Mat();
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

  const lowerRed1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 120, 80, 0]);
  const upperRed1 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [10, 255, 255, 255]);
  const lowerRed2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [170, 120, 80, 0]);
  const upperRed2 = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 255, 255, 255]);

  const mask1 = new cv.Mat();
  const mask2 = new cv.Mat();
  cv.inRange(hsv, lowerRed1, upperRed1, mask1);
  cv.inRange(hsv, lowerRed2, upperRed2, mask2);
  const mask = new cv.Mat();
  cv.add(mask1, mask2, mask);

  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let bestContourIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < contours.size(); i += 1) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);
    if (area < 15) {
      continue;
    }
    const perimeter = cv.arcLength(contour, true);
    if (perimeter === 0) {
      continue;
    }
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
    const score = circularity * area;
    if (score > bestScore) {
      bestScore = score;
      bestContourIndex = i;
    }
    contour.delete();
  }

  let result: { x: number; y: number; confidence: number } | null = null;
  if (bestContourIndex >= 0) {
    const contour = contours.get(bestContourIndex);
    const moments = cv.moments(contour);
    if (moments.m00 !== 0) {
      const scaleFactorX = mat.cols / resized.cols;
      const scaleFactorY = mat.rows / resized.rows;
      const cx = Math.round((moments.m10 / moments.m00) * scaleFactorX);
      const cy = Math.round((moments.m01 / moments.m00) * scaleFactorY);
      const confidence = Math.min(1, bestScore / 1500);
      result = { x: cx, y: cy, confidence };
    }
    contour.delete();
  }

  mat.delete();
  resized.delete();
  blurred.delete();
  rgb.delete();
  hsv.delete();
  mask.delete();
  mask1.delete();
  mask2.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();
  lowerRed1.delete();
  upperRed1.delete();
  lowerRed2.delete();
  upperRed2.delete();

  return result;
}

async function extractDetections(
  cv: any,
  video: HTMLVideoElement,
  onProgress: (progress: number) => void
): Promise<DetectionPoint[]> {
  await ensureVideoReady(video);
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error('Video dimensions unavailable. Please choose a different file.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create analysis surface.');
  }

  const detections: DetectionPoint[] = [];
  const duration = video.duration;
  const sampleInterval = Math.max(SAMPLE_INTERVAL_SECONDS, duration / MAX_SAMPLES);

  for (
    let time = 0, sampleIndex = 0;
    time <= duration && sampleIndex <= MAX_SAMPLES;
    time += sampleInterval, sampleIndex += 1
  ) {
    await seekVideo(video, time);
    ctx.drawImage(video, 0, 0, width, height);
    const detection = detectBall(cv, canvas);
    if (detection) {
      detections.push({
        time,
        x: detection.x,
        y: detection.y,
        normX: detection.x / width,
        normY: detection.y / height,
        confidence: detection.confidence
      });
    }
    onProgress(Math.min(1, time / duration));
  }

  return detections;
}

export default function VideoAnalyzer() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setAnalyzing] = useState(false);
  const [detections, setDetections] = useState<DetectionPoint[]>([]);
  const [trajectory, setTrajectory] = useState<HawkEyePoint[]>([]);
  const [progress, setProgress] = useState(0);
  const [cvReady, setCvReady] = useState(false);
  const [analysisTimestamp, setAnalysisTimestamp] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    loadOpenCv()
      .then(() => setCvReady(true))
      .catch(() => setError('Unable to initialize the OpenCV engine. Please reload the page.'));
  }, []);

  useEffect(() => {
    if (!file) {
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setDetections([]);
    setTrajectory([]);
    setProgress(0);
    setAnalysisTimestamp(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const summary = useMemo(() => summarizeTrajectory(detections, trajectory), [detections, trajectory]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const candidate = event.target.files?.[0];
    if (!candidate) {
      return;
    }
    setFile(candidate);
    setError(null);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!videoRef.current) {
      setError('Video element is not ready yet.');
      return;
    }
    if (!cvReady) {
      setError('Computer vision engine is still loading. Please wait a moment.');
      return;
    }

    setAnalyzing(true);
    setError(null);
    setProgress(0);

    try {
      const cv = window.cv;
      const detectionPoints = await extractDetections(cv, videoRef.current, (value) => {
        setProgress(value);
      });

      if (!detectionPoints.length) {
        throw new Error(
          'No valid ball samples detected. Ensure the ball is clearly visible and contrasts with the pitch.'
        );
      }

      const hawkEyePoints = convertDetectionsToHawkEye(detectionPoints);
      setDetections(detectionPoints);
      setTrajectory(hawkEyePoints);
      setAnalysisTimestamp(Date.now());
      setProgress(1);
    } catch (analysisError) {
      console.error(analysisError);
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : 'Video analysis failed due to an unexpected error.'
      );
    } finally {
      setAnalyzing(false);
    }
  }, [cvReady]);

  const handleReset = useCallback(() => {
    setFile(null);
    setVideoUrl(null);
    setDetections([]);
    setTrajectory([]);
    setAnalysisTimestamp(null);
    setProgress(0);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  const dropHandler = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const candidate = event.dataTransfer.files?.[0];
    if (!candidate) {
      return;
    }
    setFile(candidate);
  }, []);

  const dragOverHandler = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  return (
    <section className={styles.wrapper}>
      <div
        className={styles.dropzone}
        onDrop={dropHandler}
        onDragOver={dragOverHandler}
        data-active={Boolean(file)}
      >
        <div>
          <p className={styles.dropzoneTitle}>Upload or drop a bowling video</p>
          <p className={styles.dropzoneSubtitle}>
            MP4, MOV or WebM preferred. Use a stable camera angle where the full delivery stride is visible.
          </p>
        </div>
        <label className={styles.uploadButton}>
          <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={handleFileChange} />
          Choose file
        </label>
      </div>

      {videoUrl && (
        <div className={styles.videoPanel}>
          <video
            ref={videoRef}
            className={styles.video}
            controls
            src={videoUrl}
            preload="metadata"
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? 'Analyzing…' : 'Analyze Delivery'}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={handleReset}>
              Reset
            </button>
          </div>
          {isAnalyzing && (
            <div className={styles.progressTrack}>
              <div className={styles.progressBar} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {trajectory.length > 0 && (
        <div className={styles.analysisSection}>
          <div className={styles.summaryPanel}>
            <h2>Delivery Insights</h2>
            <dl>
              <div>
                <dt>Release Speed</dt>
                <dd>{summary.releaseSpeed ? `${summary.releaseSpeed.toFixed(1)} km/h` : '—'}</dd>
              </div>
              <div>
                <dt>Peak Height</dt>
                <dd>{summary.peakHeight ? `${summary.peakHeight.toFixed(2)} m` : '—'}</dd>
              </div>
              <div>
                <dt>Bounce Point</dt>
                <dd>
                  {summary.bounceDistance
                    ? `${summary.bounceDistance.toFixed(2)} m from popping crease`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Lateral Movement</dt>
                <dd>
                  {summary.lateralMovement ? `${summary.lateralMovement.toFixed(2)} m deviation` : '—'}
                </dd>
              </div>
              <div>
                <dt>Trajectory Confidence</dt>
                <dd>{summary.confidence ? `${Math.round(summary.confidence * 100)}%` : '—'}</dd>
              </div>
            </dl>
            {analysisTimestamp && (
              <span className={styles.timestamp}>
                Last analyzed: {new Date(analysisTimestamp).toLocaleTimeString()}
              </span>
            )}
          </div>

          <HawkEyeView detections={detections} points={trajectory} />

          <div className={styles.detectionsPanel}>
            <h3>Detected Ball Samples</h3>
            <div className={styles.tableWrapper}>
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th>Sample #</th>
                    <th>Time (s)</th>
                    <th>Pitch Distance (m)</th>
                    <th>Lateral (m)</th>
                    <th>Height (m)</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {trajectory.map((point, index) => (
                    <tr key={point.time}>
                      <td>{index + 1}</td>
                      <td>{point.time.toFixed(2)}</td>
                      <td>{point.distance.toFixed(2)}</td>
                      <td>{point.lateral.toFixed(2)}</td>
                      <td>{point.height.toFixed(2)}</td>
                      <td>{Math.round(point.confidence * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
