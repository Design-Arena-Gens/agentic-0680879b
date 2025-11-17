'use client';

import styles from './page.module.css';
import VideoAnalyzer from '../components/VideoAnalyzer';

export default function HomePage() {
  return (
    <main className={styles.main}>
      <header className={styles.hero}>
        <h1>Cricket Bowling Hawk-Eye Generator</h1>
        <p>
          Upload your cricket bowling footage to automatically detect the ball
          trajectory and visualize it using a Hawk-Eye inspired flight path.
        </p>
      </header>
      <VideoAnalyzer />
    </main>
  );
}
