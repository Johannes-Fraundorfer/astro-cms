import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Icon } from "./Icon.tsx";

interface Tab {
  id: number;
  title: string;
}

let nextId = 1;

export function TerminalPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: nextId++, title: "Terminal 1" }]);
  const [active, setActive] = useState(tabs[0].id);

  const add = () => {
    const tab = { id: nextId++, title: `Terminal ${tabs.length + 1}` };
    setTabs([...tabs, tab]);
    setActive(tab.id);
  };
  const close = (id: number) => {
    const rest = tabs.filter((t) => t.id !== id);
    if (!rest.length) return onClose();
    setTabs(rest);
    if (active === id) setActive(rest[rest.length - 1].id);
  };

  return (
    <div className="terminal">
      <div className="terminal-tabs" role="tablist">
        {tabs.map((t) => (
          <div key={t.id} className={`terminal-tab${t.id === active ? " is-active" : ""}`}>
            <button type="button" role="tab" aria-selected={t.id === active} onClick={() => setActive(t.id)}>
              <Icon name="terminal" size={13} /> {t.title}
            </button>
            <button type="button" className="terminal-tab-close" aria-label={`Close ${t.title}`} onClick={() => close(t.id)}>
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-icon btn-ghost" aria-label="New terminal" title="New terminal" onClick={add}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="terminal-body">
        {/* Every session stays mounted so its shell keeps running in the background. */}
        {tabs.map((t) => (
          <Session key={t.id} token={token} visible={t.id === active} />
        ))}
      </div>
    </div>
  );
}

function Session({ token, visible }: { token: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon>(null);
  const termRef = useRef<XTerm>(null);

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      allowProposedApi: false,
      theme: { background: "#101114", foreground: "#d4d4d8", cursor: "#22c55e", selectionBackground: "#3b82f655" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* hidden on mount */
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/__cms/terminal?token=${encodeURIComponent(token)}&cols=${term.cols}&rows=${term.rows}`,
    );
    ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : "");
    ws.onclose = () => term.write("\r\n\x1b[2m[disconnected]\x1b[0m\r\n");
    const send = (msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    const input = term.onData((data) => send({ type: "input", data }));
    const resize = term.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }));

    const observer = new ResizeObserver(() => {
      if (!host.current?.offsetParent) return;
      try {
        fit.fit();
      } catch {
        /* not laid out yet */
      }
    });
    observer.observe(host.current!);

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      ws.close();
      term.dispose();
    };
  }, [token]);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      termRef.current?.focus();
    });
  }, [visible]);

  return <div ref={host} className="terminal-session" hidden={!visible} />;
}
