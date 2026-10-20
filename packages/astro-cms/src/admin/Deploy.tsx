import { useEffect, useState } from "react";
import { api, type Deploy, type DeployState } from "./api.ts";
import { Icon } from "./Icon.tsx";

const POLL = 8_000;
const SLOW = 5 * 60_000;

/** Follows the latest publish until the live site runs it (or its build fails). */
export function DeployChip({ deploy, onDone }: { deploy: Deploy & { title: string }; onDone: () => void }) {
  const [state, setState] = useState<DeployState>({ state: "building" });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const next = await api.deploy(deploy).catch(() => null);
      if (stop) return;
      if (next) setState(next);
      setNow(Date.now());
      if (next?.state === "unknown") return onDone();
      if (next?.state === "live" || next?.state === "failed") return;
      timer = setTimeout(check, POLL);
    };
    check();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [deploy.sha, deploy.since]);

  // A finished deploy stays visible for a moment, then gets out of the way.
  useEffect(() => {
    if (state.state !== "live") return;
    const t = setTimeout(onDone, 10_000);
    return () => clearTimeout(t);
  }, [state.state]);

  if (state.state === "live") {
    return (
      <span className="deploy-chip is-live" role="status">
        <Icon name="check" size={14} /> Live on the site
      </span>
    );
  }
  if (state.state === "failed") {
    return (
      <span className="deploy-chip is-failed" role="status">
        Build failed
        {state.detailsUrl && (
          <a href={state.detailsUrl} target="_blank" rel="noreferrer">
            Details
          </a>
        )}
        <button type="button" className="btn btn-icon btn-ghost" aria-label="Dismiss" onClick={onDone}>
          <Icon name="close" size={12} />
        </button>
      </span>
    );
  }
  const slow = now - deploy.since > SLOW;
  return (
    <span className={`deploy-chip${slow ? " is-slow" : ""}`} role="status" title={`Publishing "${deploy.title}"`}>
      <span className="spinner" aria-hidden="true" />
      {slow ? "Deploy is taking longer than usual" : "Deploying…"}
      {slow && (
        <button type="button" className="btn btn-icon btn-ghost" aria-label="Dismiss" onClick={onDone}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}
