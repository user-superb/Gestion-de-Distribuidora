// frontend/src/hooks/useInactivityTimer.ts
import { useEffect, useRef, useCallback } from 'react';

interface UseInactivityTimerOptions {
  timeoutMs?: number; // Por defecto 30 minutos (1800000 ms)
  onTimeout: () => void;
  enabled?: boolean;
}

export function useInactivityTimer({
  timeoutMs = 30 * 60 * 1000, // 30 minutos según política corporativa
  onTimeout,
  enabled = true,
}: UseInactivityTimerOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (enabled) {
      timerRef.current = setTimeout(() => {
        onTimeout();
      }, timeoutMs);
    }
  }, [enabled, timeoutMs, onTimeout]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    // Eventos que indican actividad e interacción del usuario
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

    const handleUserActivity = () => {
      // Throttle el reseteo para no sobrecargar en scroll continuo
      const now = Date.now();
      if (now - lastActivityRef.current > 1000) {
        resetTimer();
      }
    };

    events.forEach((event) => {
      window.addEventListener(event, handleUserActivity, { passive: true });
    });

    // Iniciar temporizador
    resetTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach((event) => {
        window.removeEventListener(event, handleUserActivity);
      });
    };
  }, [enabled, resetTimer]);

  return {
    resetTimer,
    triggerTimeoutNow: onTimeout,
  };
}
