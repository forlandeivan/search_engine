import { useEffect, useMemo, useRef, useState } from "react";

export type CrawlerLogLevel = "info" | "warning" | "error" | "debug";

export interface CrawlerLogEntry {
  id: string;
  siteId: string;
  level: CrawlerLogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export type CrawlerLogConnectionState = "connecting" | "open" | "closed" | "error";

interface WebSocketMessage {
  type: "connected" | "log";
  data?: {
    siteId: string;
    level: CrawlerLogLevel;
    message: string;
    timestamp: string;
    context?: Record<string, unknown>;
  };
  siteId?: string | null;
  timestamp?: string;
}

const MAX_LOGS = 400;

export function useCrawlerLogs(siteId: string | null | undefined) {
  const [logs, setLogs] = useState<CrawlerLogEntry[]>([]);
  const [connectionState, setConnectionState] = useState<CrawlerLogConnectionState>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<number | null>(null);
  const counterRef = useRef(0);

  useEffect(() => {
    if (!siteId) {
      setLogs([]);
      setConnectionState("closed");
      return;
    }

    let shouldReconnect = true;

    const connect = () => {
      setConnectionState("connecting");
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      // Безопасное получение host с проверкой на undefined
      let host = window.location.host;
      if (!host || host.includes('undefined')) {
        // Fallback: собираем host вручную
        const hostname = window.location.hostname || 'localhost';
        const port = window.location.port;
        host = port ? `${hostname}:${port}` : hostname;
      }
      
      // Проверяем валидность URL перед созданием WebSocket
      if (!host || host.includes('undefined')) {
        console.error("[WebSocket] Invalid host:", host, "location:", window.location);
        setConnectionState("error");
        return;
      }
      
      const wsUrl = `${protocol}://${host}/ws/crawler-logs?siteId=${encodeURIComponent(siteId)}`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setConnectionState("open");
      };

      socket.onerror = () => {
        setConnectionState("error");
      };

      socket.onclose = () => {
        setConnectionState("closed");
        if (shouldReconnect) {
          reconnectTimeout.current = window.setTimeout(connect, 3000);
        }
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const payload: WebSocketMessage = JSON.parse(event.data);

          if (payload.type === "log" && payload.data) {
            const data = payload.data;
            if (data.siteId !== siteId) {
              return;
            }

            const entry: CrawlerLogEntry = {
              id: `${data.timestamp}-${counterRef.current++}`,
              siteId: data.siteId,
              level: data.level,
              message: data.message,
              timestamp: data.timestamp,
              context: data.context,
            };

            setLogs((prev) => {
              const next = [...prev, entry];
              if (next.length > MAX_LOGS) {
                return next.slice(next.length - MAX_LOGS);
              }
              return next;
            });
          }
        } catch (error) {
          console.error("Failed to parse crawler log message", error);
        }
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimeout.current) {
        window.clearTimeout(reconnectTimeout.current);
      }
      setConnectionState("closed");
      wsRef.current?.close();
    };
  }, [siteId]);

  const clearLogs = () => {
    setLogs([]);
  };

  const statusLabel = useMemo(() => {
    switch (connectionState) {
      case "open":
        return "Подключено";
      case "connecting":
        return "Подключаемся";
      case "error":
        return "Ошибка подключения";
      default:
        return "Отключено";
    }
  }, [connectionState]);

  return {
    logs,
    connectionState,
    statusLabel,
    clearLogs,
  };
}
