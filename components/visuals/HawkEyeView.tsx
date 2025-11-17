'use client';

import { useMemo } from 'react';
import styles from './HawkEyeView.module.css';
import { DetectionPoint, HawkEyePoint } from '../../types/analysis';

interface HawkEyeViewProps {
  points: HawkEyePoint[];
  detections: DetectionPoint[];
}

const PITCH_LENGTH_METERS = 20.12;
const PITCH_WIDTH_METERS = 3.05;

export default function HawkEyeView({ points, detections }: HawkEyeViewProps) {
  const { pathD, pointMarkers, peakHeight, bouncePoint } = useMemo(() => {
    if (!points.length) {
      return {
        pathD: '',
        pointMarkers: [],
        peakHeight: 0,
        bouncePoint: null as HawkEyePoint | null
      };
    }

    const maxHeight = Math.max(...points.map((p) => p.height), 3);
    const lateralRange = PITCH_WIDTH_METERS / 2 + 0.6;

    let path = '';
    const viewMarkers: { x: number; y: number; height: number; confidence: number }[] = [];
    let bestBounce: HawkEyePoint | null = null;

    points.forEach((point, index) => {
      const x = 50 + (point.lateral / lateralRange) * 38;
      const y = 200 - (point.distance / PITCH_LENGTH_METERS) * 180;
      viewMarkers.push({ x, y, height: point.height, confidence: point.confidence });
      path += `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;

      const isBounceCandidate = index > 0 && point.height < points[index - 1].height;
      if (isBounceCandidate && !bestBounce) {
        bestBounce = point;
      }
    });

    const peak = points.reduce((acc, point) => (point.height > acc.height ? point : acc), points[0]);

    return {
      pathD: path.trim(),
      pointMarkers: viewMarkers,
      peakHeight: peak.height,
      bouncePoint: bestBounce
    };
  }, [points]);

  const heightSeries = useMemo(() => {
    if (!points.length) {
      return '';
    }
    const maxHeight = Math.max(...points.map((p) => p.height), 2);
    let d = '';
    points.forEach((point, index) => {
      const x = (point.distance / PITCH_LENGTH_METERS) * 100;
      const y = 60 - (point.height / maxHeight) * 50;
      d += `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
    });
    return d.trim();
  }, [points]);

  return (
    <div className={styles.container}>
      <div className={styles.pitchCard}>
        <h3>Hawk-Eye Projection</h3>
        <svg viewBox="0 0 100 220" className={styles.pitch}>
          <defs>
            <linearGradient id="pitchGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#5cb85c" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#7bd87d" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#5cb85c" stopOpacity="0.85" />
            </linearGradient>
            <radialGradient id="impactGlow">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ff3b3b" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="15" y="10" width="70" height="200" rx="6" ry="6" fill="url(#pitchGradient)" />
          <rect x="25" y="20" width="50" height="20" fill="#fff4" />
          <rect x="25" y="180" width="50" height="20" fill="#fff4" />
          <line x1="50" y1="10" x2="50" y2="210" stroke="#ffffffaa" strokeWidth="0.5" strokeDasharray="2 2" />

          <line x1="15" y1="60" x2="85" y2="60" stroke="#ffffffaa" strokeWidth="0.6" />
          <line x1="15" y1="160" x2="85" y2="160" stroke="#ffffffaa" strokeWidth="0.6" />

          {pathD && <path d={pathD} fill="none" stroke="#ff3737" strokeWidth="1.5" strokeLinecap="round" />}

          {pointMarkers.map((marker, index) => (
            <g key={`${marker.x}-${marker.y}-${index}`}>
              <circle
                cx={marker.x}
                cy={marker.y}
                r={2}
                fill="#fff"
                stroke="#ff3737"
                strokeWidth={0.8}
                opacity={marker.confidence * 0.6 + 0.2}
              />
              <circle
                cx={marker.x}
                cy={marker.y}
                r={marker.height * 0.5 + 1}
                fill="none"
                stroke="#ff9b9b"
                strokeWidth={0.4}
                opacity={0.12}
              />
            </g>
          ))}

          {bouncePoint && (
            <g>
              <circle
                cx={50 + (bouncePoint.lateral / (PITCH_WIDTH_METERS / 2 + 0.6)) * 38}
                cy={200 - (bouncePoint.distance / PITCH_LENGTH_METERS) * 180}
                r={4}
                fill="url(#impactGlow)"
              />
            </g>
          )}
        </svg>
        <footer className={styles.legend}>
          <span>
            <span className={styles.legendBullet} />
            Lateral deviation scale shown against pitch center-line
          </span>
        </footer>
      </div>

      <div className={styles.heightCard}>
        <h3>Flight Height Profile</h3>
        <svg viewBox="0 0 100 60" className={styles.heightChart}>
          <rect x="0" y="0" width="100" height="60" rx="6" fill="#071427" />
          <line x1="0" y1="55" x2="100" y2="55" stroke="#ffffff22" strokeWidth="0.5" />
          <line x1="0" y1="30" x2="100" y2="30" stroke="#ffffff11" strokeWidth="0.5" />
          <line x1="0" y1="5" x2="100" y2="5" stroke="#ffffff22" strokeWidth="0.5" />
          {heightSeries && (
            <path
              d={heightSeries}
              fill="none"
              stroke="url(#heightGradient)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          <defs>
            <linearGradient id="heightGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#63b3ff" />
              <stop offset="100%" stopColor="#4f86ff" />
            </linearGradient>
          </defs>
        </svg>
        <ul className={styles.heightSummary}>
          <li>
            Peak height: <strong>{peakHeight.toFixed(2)} m</strong>
          </li>
          <li>
            Samples captured: <strong>{points.length}</strong>
          </li>
          <li>
            Source frames analyzed: <strong>{detections.length}</strong>
          </li>
        </ul>
      </div>
    </div>
  );
}
