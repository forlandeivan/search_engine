import { useEffect, useRef, useState } from "react";

type UseTypewriterOptions = {
  enabled?: boolean;
  resetKey?: string | number | null;
  minStep?: number;
  maxStep?: number;
};

/**
 * Returns a progressively revealed version of `target`,
 * useful for simulating a typing effect while text is streaming in.
 */
export function useTypewriter(
  target: string,
  { enabled = false, resetKey = null, minStep = 1, maxStep = 6 }: UseTypewriterOptions = {},
) {
  const [visible, setVisible] = useState(() => (enabled ? "" : target));
  const frameRef = useRef<number | null>(null);
  const previousResetRef = useRef(resetKey);

  useEffect(() => {
    if (previousResetRef.current === resetKey) {
      return;
    }
    previousResetRef.current = resetKey;
    setVisible(enabled ? "" : target);
  }, [enabled, resetKey, target]);

  useEffect(() => {
    if (!enabled) {
      setVisible(target);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    let mounted = true;

    const animate = () => {
      setVisible((prev) => {
        if (!mounted) {
          return prev;
        }
        if (prev === target) {
          return prev;
        }
        const remaining = Math.max(0, target.length - prev.length);
        if (remaining === 0) {
          return target;
        }
        const step = Math.min(
          maxStep,
          Math.max(minStep, Math.ceil(remaining / 8)),
        );
        return target.slice(0, prev.length + step);
      });
      if (mounted) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      mounted = false;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [enabled, maxStep, minStep, target]);

  return visible;
}
