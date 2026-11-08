"use client";

import { useEffect, useRef } from "react";

/**
 * Silent looping clip for Live Photos / Motion Photos. Plays only while
 * on screen so a grid full of them doesn't decode dozens of videos.
 */
export function MotionVideo({
  src,
  poster,
  className,
  style,
  alwaysPlay = false,
}: {
  src: string;
  poster: string;
  className?: string;
  style?: React.CSSProperties;
  alwaysPlay?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (alwaysPlay) {
      void video.play().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.5 }
    );
    io.observe(video);
    return () => io.disconnect();
  }, [alwaysPlay]);

  return (
    // Decorative motion: no audio track, so no captions needed.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload={alwaysPlay ? "auto" : "none"}
      className={className}
      style={style}
    />
  );
}
